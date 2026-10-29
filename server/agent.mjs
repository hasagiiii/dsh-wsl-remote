/**
 * WSL half of @local/dsh-wsl-remote: a Cordis plugin inserted into the user's
 * own WSL `dsh` (through `dsh --patch <overlay>`), the way Codex's WSL remote
 * connection runs the user's own `codex app-server` inside the distribution.
 *
 * The Windows Host starts `dsh` through `wsl.exe` with the pipe to Windows on
 * fds 3 (to Windows) and 4 (from Windows); dsh's own stdout and stderr both
 * go to the stderr of `wsl.exe`. One multiplexed pipe carries:
 *   channel 0  -> JSON messages (hello, credential forwarding, notifications)
 *   channel n  -> one TCP connection from the Windows loopback relay to this
 *                 process's loopback web listener.
 * Nothing listens on a non-loopback address, and nothing here needs a package
 * import, because this file is loaded by absolute path outside any profile.
 *
 * Credential sharing (optional, chosen on Windows): `ctx.credentials` keeps
 * its local provider, but every read and write is answered by the Windows
 * Host's credential store first, so one DeepSeek sign-in, API key or
 * refreshed token serves both sides and is never refreshed twice.
 */
import { Socket, createConnection } from 'node:net';
import { FRAME, Mux } from './mux.js';

export const name = 'wsl-remote-agent';

/** Records that stay in this distribution: its own browser-cookie secret. */
const LOCAL_ONLY = /^client-connection\//;
const AGENT_PROTOCOL = 1;

const log = (message) => process.stderr.write(`[wsl-remote agent] ${message}\n`);

export function apply(ctx) {
  if (process.env.DSH_WSL_REMOTE_OVERLAY === undefined) return; // not started by the Windows Host
  let input;
  let output;
  try {
    input = new Socket({ fd: 4, readable: true, writable: false });
    output = new Socket({ fd: 3, readable: false, writable: true });
  } catch (error) {
    log(`no Windows pipe on fds 3/4 (${error.message}); running without the Windows connection`);
    return;
  }
  serve(ctx, input, output, {
    shareLogin: process.env.DSH_WSL_REMOTE_SHARE_LOGIN === '1',
    onClosed: (reason) => {
      log(`Windows connection closed (${reason}); stopping dsh`);
      setTimeout(() => process.exit(0), 8000).unref();
      process.kill(process.pid, 'SIGTERM');
    },
  });
}

/**
 * Serve the Windows connection over one byte pipe (exported for tests).
 * @param {object} options - { shareLogin: boolean, onClosed(reason) }.
 */
export function serve(ctx, input, output, options) {
  let closing = false;
  const shutdown = (reason) => {
    if (closing) return;
    closing = true;
    options.onClosed?.(reason);
  };

  const pending = new Map();
  const mutators = new Map();
  let nextId = 1;
  let shared;

  const mux = new Mux(input, output, {
    control: (payload) => {
      let message;
      try {
        message = JSON.parse(payload.toString('utf8'));
      } catch {
        return;
      }
      receive(message).catch((error) => log(`message failed: ${error.message}`));
    },
    frame: (type, channel, payload) => {
      if (type === FRAME.OPEN) openTcp(channel, payload);
    },
    closed: (error) => shutdown(error?.message ?? 'end'),
  });

  const send = (message) => mux.send(FRAME.DATA, 0, Buffer.from(JSON.stringify(message)));
  const request = (method, params) => {
    const id = nextId++;
    const done = Promise.withResolvers();
    pending.set(id, done);
    send({ id, method, params });
    return done.promise;
  };

  async function receive(message) {
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(message.result ?? undefined);
      return;
    }
    if (message.method === 'mutate') {
      const mutate = mutators.get(message.params?.mid);
      try {
        if (mutate === undefined) throw new Error('unknown mutation');
        const next = await mutate(message.params.current ?? undefined);
        send({ id: message.id, result: next ?? null });
      } catch (error) {
        send({ id: message.id, error: error?.message ?? String(error) });
      }
      return;
    }
    if (message.method === 'record-updated' && shared !== undefined) shared.notifyRecordUpdated?.(message.params.key);
    if (message.method === 'reference-updated' && shared !== undefined) shared.notifyUpdated?.(message.params.ref);
  }

  function openTcp(channel, payload) {
    let port;
    try {
      port = JSON.parse(payload.toString('utf8')).port;
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
    } catch (error) {
      mux.send(FRAME.OPEN_FAIL, channel, Buffer.from(error.message));
      return;
    }
    const socket = createConnection({ host: '127.0.0.1', port, allowHalfOpen: true });
    socket.once('error', (error) => mux.send(FRAME.OPEN_FAIL, channel, Buffer.from(error.message)));
    socket.once('connect', () => {
      socket.removeAllListeners('error');
      const stream = mux.attach(channel);
      mux.send(FRAME.OPENED, channel);
      socket.on('error', (error) => stream.destroy(error));
      stream.on('error', () => socket.destroy());
      socket.on('end', () => stream.end());
      stream.on('end', () => socket.end());
      socket.on('close', () => stream.destroy());
      stream.on('close', () => socket.destroy());
      socket.pipe(stream, { end: false });
      stream.pipe(socket, { end: false });
    });
  }

  /** Answer `ctx.credentials` from the Windows store, keeping the local one as fallback. */
  function shareCredentials(provider) {
    const original = {};
    for (const key of ['resolve', 'describe', 'set', 'unset', 'readRecord', 'describeRecord', 'listRecords', 'modifyRecord', 'deleteRecord']) {
      original[key] = provider[key];
    }
    const local = (method, ...args) => original[method].apply(provider, args);
    const remote = (method, params) => request(`credentials/${method}`, params);
    const wrapped = {
      async resolve(ref) {
        return (await remote('resolve', { ref })) ?? local('resolve', ref);
      },
      async describe(ref) {
        const info = await remote('describe', { ref });
        return info?.configured ? info : local('describe', ref);
      },
      set: (ref, value) => remote('set', { ref, value }),
      unset: (ref) => remote('unset', { ref }),
      readRecord: (key) => (LOCAL_ONLY.test(key) ? local('readRecord', key) : remote('readRecord', { key })),
      describeRecord: (key) => (LOCAL_ONLY.test(key) ? local('describeRecord', key) : remote('describeRecord', { key })),
      async listRecords() {
        const [windows, mine] = await Promise.all([remote('listRecords', {}), local('listRecords')]);
        return [...(windows ?? []), ...mine.filter((entry) => LOCAL_ONLY.test(entry.key))];
      },
      async modifyRecord(key, mutate) {
        if (LOCAL_ONLY.test(key)) return local('modifyRecord', key, mutate);
        const mid = nextId++;
        mutators.set(mid, mutate);
        try {
          return await remote('modifyRecord', { key, mid });
        } finally {
          mutators.delete(mid);
        }
      },
      deleteRecord: (key) => (LOCAL_ONLY.test(key) ? local('deleteRecord', key) : remote('deleteRecord', { key })),
    };
    Object.assign(provider, wrapped);
    shared = provider;
    log('sharing the Windows credential store');
    // Consumers that already read the (empty) local store re-read now.
    remote('listRecords', {}).then((records) => {
      for (const entry of records ?? []) provider.notifyRecordUpdated?.(entry.key);
    }, () => {});
    return () => {
      Object.assign(provider, original);
      if (shared === provider) shared = undefined;
    };
  }

  // Decided by the Windows Host when it launched this dsh; fixed for the process.
  if (options.shareLogin) {
    ctx.inject(['credentials'], (scope) => {
      scope.effect(() => shareCredentials(scope.credentials), 'wsl-remote agent: shared credentials');
    });
  }

  ctx.effect(() => () => {
    closing = true;
    mux.fail(new Error('agent unloaded'));
  }, 'wsl-remote agent: Windows pipe');

  send({ method: 'hello', params: { agent: AGENT_PROTOCOL, pid: process.pid, node: process.version, shareLogin: options.shareLogin } });
}
