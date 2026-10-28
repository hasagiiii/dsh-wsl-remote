/**
 * Stream multiplexer carried over one byte pipe (the stdio of a `wsl.exe` child).
 *
 * Shared verbatim by the Windows provider and the Linux bridge. Channel 0 is the
 * helper's administrative RPC byte stream; other channels are program streams
 * (stdout, stderr, stdin, fd 7 control, PTY) opened by the Windows side.
 *
 * Frame: u32 length (of everything after it) | u8 type | u32 channel | payload.
 * Program channels use a credit window so one slow consumer cannot make either
 * process buffer without bound; channel 0 relies on the helper's own frame limits.
 */
import { Duplex } from 'node:stream';

export const FRAME = Object.freeze({
  DATA: 1,
  END: 2,
  CLOSE: 3,
  OPEN: 4,
  OPENED: 5,
  OPEN_FAIL: 6,
  ACK: 7,
  HELLO: 8,
  ERROR: 9,
});

/** Unacknowledged bytes allowed per direction of a program channel. */
export const WINDOW_BYTES = 1024 * 1024;
const MAX_CHUNK = 64 * 1024;
const MAX_FRAME = 80 * 1024 * 1024;

/** Encode one frame. */
export function encodeFrame(type, channel, payload) {
  const body = payload === undefined ? Buffer.alloc(0) : Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = Buffer.allocUnsafe(9);
  header.writeUInt32BE(body.length + 5, 0);
  header.writeUInt8(type, 4);
  header.writeUInt32BE(channel, 5);
  return Buffer.concat([header, body]);
}

/** Incremental frame decoder. */
export function createDecoder(onFrame) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const size = buffered.readUInt32BE(0);
      if (size < 5 || size > MAX_FRAME) throw new Error(`wsl-remote: invalid mux frame length ${size}`);
      if (buffered.length < size + 4) break;
      const type = buffered.readUInt8(4);
      const channel = buffered.readUInt32BE(5);
      const payload = buffered.subarray(9, size + 4);
      buffered = buffered.subarray(size + 4);
      onFrame(type, channel, Buffer.from(payload));
    }
  };
}

/**
 * One multiplexed endpoint over a readable/writable pair.
 * `send` writes raw frames; inbound frames are dispatched to channels or `onControl`.
 */
export class Mux {
  constructor(input, output, handlers = {}) {
    this.output = output;
    this.handlers = handlers;
    this.channels = new Map();
    this.closed = false;
    const decode = createDecoder((type, channel, payload) => this.receive(type, channel, payload));
    input.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch (error) {
        this.fail(error);
      }
    });
    input.on('end', () => this.fail(new Error('wsl-remote: mux input ended')));
    input.on('error', (error) => this.fail(error));
    output.on('error', (error) => this.fail(error));
  }

  send(type, channel, payload) {
    if (this.closed) return false;
    return this.output.write(encodeFrame(type, channel, payload));
  }

  sendJson(type, channel, value) {
    return this.send(type, channel, Buffer.from(JSON.stringify(value)));
  }

  receive(type, channel, payload) {
    if (this.closed) return;
    const stream = this.channels.get(channel);
    switch (type) {
      case FRAME.DATA:
        if (stream) stream.receiveData(payload);
        else if (channel === 0) this.handlers.control?.(payload);
        return;
      case FRAME.ACK:
        stream?.receiveAck(payload.readUInt32BE(0));
        return;
      case FRAME.END:
        stream?.receiveEnd();
        return;
      case FRAME.CLOSE:
        stream?.receiveClose(payload.length > 0 ? payload.toString('utf8') : undefined);
        return;
      default:
        this.handlers.frame?.(type, channel, payload);
    }
  }

  /** Create the local half of a program channel. */
  attach(channel) {
    const stream = new MuxChannel(this, channel);
    this.channels.set(channel, stream);
    stream.once('close', () => {
      if (this.channels.get(channel) === stream) this.channels.delete(channel);
    });
    return stream;
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const stream of [...this.channels.values()]) stream.destroy(error);
    this.channels.clear();
    this.handlers.closed?.(error);
  }
}

/** A credit-windowed Duplex for one channel. */
export class MuxChannel extends Duplex {
  constructor(mux, id) {
    super({ allowHalfOpen: true });
    this.mux = mux;
    this.id = id;
    this.unacked = 0;
    this.blocked = [];
    this.received = 0;
    this.remoteClosed = false;
  }

  _write(chunk, _encoding, callback) {
    for (let offset = 0; offset < chunk.length; offset += MAX_CHUNK) {
      this.mux.send(FRAME.DATA, this.id, chunk.subarray(offset, offset + MAX_CHUNK));
    }
    this.unacked += chunk.length;
    if (this.unacked <= WINDOW_BYTES) callback();
    else this.blocked.push(callback);
  }

  _final(callback) {
    this.mux.send(FRAME.END, this.id);
    callback();
  }

  _read() {
    this.flushAck();
  }

  _destroy(error, callback) {
    if (!this.remoteClosed) this.mux.send(FRAME.CLOSE, this.id, error ? Buffer.from(String(error.message ?? error)) : undefined);
    for (const blocked of this.blocked.splice(0)) blocked(error ?? new Error('wsl-remote: channel closed'));
    callback(error);
  }

  receiveData(payload) {
    this.received += payload.length;
    if (this.push(payload)) this.flushAck();
  }

  flushAck() {
    if (this.received === 0) return;
    const ack = Buffer.allocUnsafe(4);
    ack.writeUInt32BE(this.received, 0);
    this.received = 0;
    this.mux.send(FRAME.ACK, this.id, ack);
  }

  receiveAck(bytes) {
    this.unacked = Math.max(0, this.unacked - bytes);
    while (this.unacked <= WINDOW_BYTES && this.blocked.length > 0) this.blocked.shift()();
  }

  receiveEnd() {
    this.push(null);
  }

  receiveClose(message) {
    this.remoteClosed = true;
    this.destroy(message ? new Error(message) : undefined);
  }
}
