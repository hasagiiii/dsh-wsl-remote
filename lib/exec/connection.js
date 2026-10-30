/**
 * `ctx.ssh`-compatible connection to one WSL distribution.
 *
 * DeepSeek Harness's SSH providers (fs-ssh, subprocess-ssh, sandbox-ssh) only
 * need `request()`, `connectStream()` and `dispose()` from their connection.
 * This service supplies the same contract over a `wsl.exe` child instead of an
 * OpenSSH master, so those providers run unchanged. Unlike the SSH service it
 * reconnects lazily: the bridge starts on first use, a lost bridge fails only
 * the operations it carried, and the next operation starts a new one.
 */
import { spawn } from 'node:child_process';
import { Service } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { SshRpcPeer } from './vendor/ssh-protocol.js';
import { helloSchema } from './vendor/ssh-schemas.js';
import { FRAME, Mux } from '../mux.js';
import { createPathMapper } from './paths.js';
import { isDistroName, wslExecutable } from '../wsl.js';

const bridgeHelloSchema = z.object({
  bridge: z.literal(1),
  node: z.string(),
  shell: z.string(),
  shells: z.array(z.object({ name: z.string(), path: z.string() })),
  home: z.string().startsWith('/'),
  environmentResolved: z.boolean(),
  rg: z.string().optional(),
}).passthrough();

const posixPath = schema.string().pattern(/^\//);

export class WslConnection extends Service {
  static inject = [];

  static Config = schema.object({
    distro: schema.string().required(),
    node: posixPath,
    serverDir: posixPath,
    shell: posixPath,
    requestTimeoutMs: schema.natural().default(30000),
    startTimeoutMs: schema.natural().default(60000),
    maxFrameBytes: schema.natural().default(64 * 1024 * 1024),
    maxPending: schema.natural().default(128),
    leaseMs: schema.natural().default(30000),
    idleMs: schema.natural().default(15 * 60 * 1000),
  });

  constructor(ctx, config) {
    super(ctx, 'ssh');
    if (!isDistroName(config.distro)) throw new Error(`wsl-remote: invalid distribution name ${JSON.stringify(config.distro)}`);
    this.config = config;
    this.paths = createPathMapper(config.distro);
    this.session = undefined;
    this.disposed = false;
    this.lastUse = Date.now();
    this.pending = 0;
    ctx.effect(() => {
      const timer = setInterval(() => this.reapIdle(), 60000);
      timer.unref?.();
      return () => clearInterval(timer);
    }, 'wsl-remote: idle reaper');
    ctx.effect(() => () => this.close(), 'wsl-remote: connection');
  }

  /** Shell the Agent command tool runs with `-c` (fixed for this process). */
  get agentShell() {
    return this.config.shell ?? 'bash';
  }

  /** Locate node and the deployed runtime (fixed at startup by the bundle patch). */
  async locate() {
    if (this.config.node && this.config.serverDir) return { node: this.config.node, serverDir: this.config.serverDir };
    throw new Error('wsl-remote: the WSL runtime location is missing; choose the environment again in Settings → General');
  }

  /** Facts reported by the live bridge, if one is running. */
  get info() {
    return this.session?.bridge;
  }

  /**
   * Send one helper operation, starting the bridge when needed.
   * Cancellation never replays an ambiguous mutation.
   */
  async request(method, params, result, signal, wait = false) {
    this.assertOpen();
    this.pending++;
    this.lastUse = Date.now();
    try {
      const session = await this.ensure(signal);
      const bounded = wait
        ? signal
        : signal === undefined
          ? AbortSignal.timeout(this.config.requestTimeoutMs)
          : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)]);
      return await session.rpc.request(method, params, result, bounded);
    } finally {
      this.pending--;
      this.lastUse = Date.now();
    }
  }

  /** Open one helper stream endpoint through the bridge as a plaintext Duplex. */
  async connectStream(endpoint, signal) {
    this.assertOpen();
    const session = await this.ensure(signal);
    if (session.failure) throw session.failure;
    if (!endpoint.path.startsWith(`${session.hello.root}/`) || /[:\r\n\0]/u.test(endpoint.path)) {
      throw new Error('WSL helper returned an invalid stream path');
    }
    signal?.throwIfAborted();
    const id = session.nextChannel++;
    const stream = session.mux.attach(id);
    stream.on('error', () => {});
    const opened = Promise.withResolvers();
    session.opens.set(id, opened);
    const abort = () => opened.reject(signal.reason instanceof Error ? signal.reason : new Error('stream allocation aborted'));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => opened.reject(new Error('WSL stream allocation timed out')), this.config.requestTimeoutMs);
    try {
      session.mux.sendJson(FRAME.OPEN, id, { path: endpoint.path, capability: endpoint.capability });
      await opened.promise;
    } catch (error) {
      stream.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
      session.opens.delete(id);
      signal?.removeEventListener('abort', abort);
    }
    this.lastUse = Date.now();
    stream.once('close', () => {
      this.lastUse = Date.now();
    });
    return stream;
  }

  /** Drop the current bridge (providers call this when remote cleanup cannot be confirmed). */
  dispose() {
    const session = this.session;
    if (session) this.fail(session, new Error('WSL connection reset'));
    return Promise.resolve();
  }

  assertOpen() {
    if (this.disposed) throw new Error('WSL connection is closed');
  }

  ensure(signal) {
    let session = this.session;
    if (session === undefined || session.failure !== undefined) {
      session = this.start();
      this.session = session;
    }
    if (signal === undefined) return session.ready;
    return Promise.race([
      session.ready,
      new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    ]);
  }

  start() {
    const session = { failure: undefined, child: undefined, stderr: [], opens: new Map() };
    session.ready = this.locate().then((located) => {
      if (session.failure !== undefined) throw session.failure;
      return this.launch(session, located);
    });
    session.ready.catch((error) => this.fail(session, error));
    return session;
  }

  launch(session, { node, serverDir }) {
    const { distro } = this.config;
    const args = ['-d', distro, '--cd', '~', '-e', node, '--disable-sigusr1', `${serverDir}/bridge.mjs`];
    const child = spawn(wslExecutable(), args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    Object.assign(session, {
      child,
      nextChannel: 1,
      opens: new Map(),
      stderr: [],
      heartbeat: undefined,
      bridge: undefined,
      hello: undefined,
    });
    const bridgeHello = Promise.withResolvers();
    bridgeHello.promise.catch(() => {});
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      session.stderr.push(text);
      if (session.stderr.length > 40) session.stderr.shift();
      for (const line of text.split('\n')) if (line.trim()) this.ctx.logger?.debug?.(`[${distro}] ${line}`);
    });
    child.once('error', (error) => this.fail(session, error));
    child.once('exit', (code, sig) => {
      this.fail(session, new Error(`WSL bridge exited (${code ?? sig})${this.tail(session)}`));
    });
    child.stdin.on('error', () => {});
    session.mux = new Mux(child.stdout, child.stdin, {
      closed: (error) => this.fail(session, error ?? new Error('WSL bridge pipe closed')),
      frame: (type, channel, payload) => {
        if (type === FRAME.HELLO) {
          try {
            bridgeHello.resolve(bridgeHelloSchema.parse(JSON.parse(payload.toString('utf8'))));
          } catch (error) {
            bridgeHello.reject(error);
          }
        } else if (type === FRAME.OPENED) session.opens.get(channel)?.resolve();
        else if (type === FRAME.OPEN_FAIL) {
          const stream = session.mux.channels.get(channel);
          if (stream) stream.remoteClosed = true;
          session.opens.get(channel)?.reject(new Error(`WSL stream allocation failed: ${payload.toString('utf8')}`));
        }
      },
    });
    const admin = session.mux.attach(0);
    admin.on('error', () => {});
    session.rpc = new SshRpcPeer(admin, admin, this.config.maxFrameBytes, this.config.maxPending);
    session.rpc.once('closed', (error) => this.fail(session, error));
    session.bridgeHello = bridgeHello;
    return (async () => {
      const deadline = AbortSignal.timeout(this.config.startTimeoutMs);
      const timeout = new Promise((_resolve, reject) => {
        deadline.addEventListener('abort', () => reject(new Error(`WSL bridge did not start within ${this.config.startTimeoutMs} ms${this.tail(session)}`)), { once: true });
      });
      session.bridge = await Promise.race([bridgeHello.promise, timeout]);
      session.hello = await session.rpc.request('hello', {
        protocol: 2,
        workspace: session.bridge.home,
        leaseMs: this.config.leaseMs,
      }, helloSchema, AbortSignal.any([deadline, AbortSignal.timeout(this.config.requestTimeoutMs)]));
      let pendingBeat;
      session.heartbeat = setInterval(() => {
        pendingBeat ??= session.rpc.request('heartbeat', {}, z.null(), AbortSignal.timeout(this.config.leaseMs / 2))
          .catch((error) => this.fail(session, error))
          .finally(() => {
            pendingBeat = undefined;
          });
      }, Math.floor(this.config.leaseMs / 3));
      session.heartbeat.unref?.();
      this.ctx.logger?.info?.(`WSL ${distro} bridge ready (${session.bridge.node}, shell ${session.bridge.shell})`);
      return session;
    })();
  }

  tail(session) {
    const text = session.stderr.join('').trim();
    return text ? `: ${text.split('\n').slice(-6).join(' | ')}` : '';
  }

  fail(session, error) {
    if (session.failure !== undefined) return;
    session.failure = error instanceof Error ? error : new Error(String(error));
    if (session.heartbeat) clearInterval(session.heartbeat);
    session.bridgeHello?.reject(session.failure);
    for (const open of session.opens.values()) open.reject(session.failure);
    session.rpc?.close(session.failure);
    session.mux?.fail(session.failure);
    try {
      session.child?.kill();
    } catch {}
    if (this.session === session) this.session = undefined;
  }

  reapIdle() {
    const session = this.session;
    if (session === undefined || session.failure !== undefined || session.hello === undefined) return;
    if (this.pending > 0 || session.mux.channels.size > 1 || this.ctx.get('subprocess')?.live?.size > 0) return;
    if (Date.now() - this.lastUse < this.config.idleMs) return;
    this.closeSession(session).catch(() => {});
  }

  async closeSession(session) {
    try {
      await session.rpc.request('close', {}, z.null(), AbortSignal.timeout(this.config.requestTimeoutMs));
    } catch {}
    this.fail(session, new Error('WSL connection closed'));
  }

  async close() {
    this.disposed = true;
    const session = this.session;
    if (session === undefined) return;
    await session.ready.then(() => this.closeSession(session), () => this.fail(session, new Error('WSL connection closed')));
  }
}

export default WslConnection;
