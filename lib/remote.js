/**
 * One WSL remote connection: the user's own `dsh` running inside a WSL
 * distribution, started and reached the way Codex reaches its WSL remote
 * hosts — through the stdio of a `wsl.exe` child, never a network port
 * opened by the distribution.
 *
 *   wsl.exe -d <distro> --cd ~ -e /bin/sh <agent>/launch.sh run <profile> <share>
 *     stdout  (Linux fd 3) <- mux frames from the WSL agent plugin
 *     stdin   (Linux fd 4) -> mux frames to the WSL agent plugin
 *     stderr               <- dsh's own output (logs, the `dsh web:` line)
 *
 * Mux channel 0 carries JSON messages (hello, credential forwarding);
 * every other channel is one TCP connection accepted by a Windows loopback
 * relay and forwarded to the WSL dsh web listener, so the WSL dsh UI opens at
 * http://127.0.0.1:<relay port>/ on Windows with its own token and cookie.
 */
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FRAME, Mux } from './mux.js';
import { runWsl, wslExecutable } from './wsl.js';
import { dshRequirement, requirementMessage } from './requirements.js';

/** Bump when anything deployed into WSL (server/agent.mjs, server/launch.sh, server/dsh-harness.sh, lib/mux.js) changes. */
export const AGENT_VERSION = '2.1.0';

const AGENT_FILES = [
  ['server/agent.mjs', 'agent.mjs'],
  ['server/launch.sh', 'launch.sh'],
  ['lib/mux.js', 'mux.js'],
];

/** Where `dsh-harness` goes in WSL: per user, no sudo, on Ubuntu's default login PATH. */
const LAUNCHER_DIR = '.local/bin';
const LAUNCHER_NAME = 'dsh-harness';
const LAUNCHER_MARK = '@local/dsh-wsl-remote';

const START_TIMEOUT_MS = 120000;
const RETRY_DELAYS_MS = [2000, 5000, 15000];
const URL_LINE = /dsh web:\s+(https?:\/\/\S+)/;

/** Values crossing the pipe are JSON; `undefined` travels as null. */
const wire = (value) => (value === undefined ? null : value);
const unwire = (value) => (value === null ? undefined : value);

/**
 * Parse `launch.sh probe` output (`__WSLR__ key=value` lines; other lines are login-shell noise).
 * @returns {{ dsh: string, dshPath: string, shell: string, home: string, node: string, nodeVersion: string, npm: string, nvm: boolean, localBinOnPath: boolean, os?: { name: string, version: string, pretty: string } }}
 */
export function parseProbe(stdout) {
  const raw = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const match = /^__WSLR__ (\w+)=(.*)$/.exec(line.trim());
    if (match) raw[match[1]] = match[2].trim();
  }
  const facts = {
    dsh: raw.dsh ?? '',
    dshPath: raw.path ?? '',
    shell: raw.shell ?? '',
    home: raw.home ?? '',
    node: raw.node ?? '',
    nodeVersion: raw.nodeVersion ?? '',
    npm: raw.npm ?? '',
    nvm: raw.nvm === '1',
    localBinOnPath: raw.localBinOnPath === '1',
  };
  if (raw.osName || raw.osPretty) facts.os = { name: raw.osName ?? '', version: raw.osVersion ?? '', pretty: raw.osPretty ?? '' };
  return facts;
}

/** Single-quoted sh literal. */
const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** Fill the launcher template; values become sh literals, never code. */
export function renderLauncher(template, { windowsExe, requestDir }) {
  return template
    .replace(`WINDOWS_EXE='@@WINDOWS_EXE@@'`, () => `WINDOWS_EXE=${shQuote(windowsExe)}`)
    .replace(`REQUEST_DIR='@@REQUEST_DIR@@'`, () => `REQUEST_DIR=${shQuote(requestDir)}`);
}

export class RemoteConnection extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.distro
   * @param {string} options.packageDir - this plugin's directory (deploy source).
   * @param {() => object} options.settings - current { shareLogin, profile, ports }.
   * @param {(distro: string, port: number) => void} options.rememberPort
   * @param {() => any} options.credentials - Windows ctx.credentials, or undefined.
   * @param {{ windowsExe?: string, requestDir?: string }} [options.launcher] - where `dsh-harness` reaches the Windows app.
   * @param {{ info: Function, warn: Function, debug?: Function }} options.logger
   */
  constructor(options) {
    super();
    this.options = options;
    this.distro = options.distro;
    this.state = 'disconnected';
    this.error = undefined;
    this.requirement = undefined;
    this.launcher = undefined;
    this.facts = undefined;
    this.session = undefined;
    this.wanted = false;
    this.attempt = 0;
    this.retryTimer = undefined;
  }

  /** Status safe for the UI and the model (no token). */
  snapshot() {
    const session = this.session;
    const facts = this.facts;
    return {
      name: this.distro,
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      ...(this.requirement ? { requirement: this.requirement } : {}),
      ...(facts?.dshPath ? { dsh: facts.dsh, dshPath: facts.dshPath } : {}),
      ...(facts?.shell ? { shell: facts.shell } : {}),
      ...(facts?.os ? { os: facts.os } : {}),
      ...(facts?.home ? { home: facts.home } : {}),
      ...(this.launcher ? { launcher: this.launcher } : {}),
      ...(session?.relayPort ? { relayPort: session.relayPort } : {}),
      ...(session?.shareLogin !== undefined && this.state === 'connected' ? { shareLogin: session.shareLogin, profile: session.profile } : {}),
    };
  }

  /** Tokenized address of the WSL dsh UI through the Windows relay. */
  openUrl() {
    const session = this.session;
    if (this.state !== 'connected' || session?.remoteUrl === undefined || session.relayPort === undefined) return undefined;
    const url = new URL(session.remoteUrl);
    url.hostname = '127.0.0.1';
    url.port = String(session.relayPort);
    return url.href;
  }

  setState(state, error) {
    this.state = state;
    this.error = error;
    if (state === 'connecting' || state === 'connected') this.requirement = undefined;
    this.emit('change', this.snapshot());
  }

  connect() {
    this.wanted = true;
    this.attempt = 0;
    clearTimeout(this.retryTimer);
    if (this.state === 'connecting' || this.state === 'connected') return this.pending ?? Promise.resolve();
    this.pending = this.start().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  async disconnect() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    const session = this.session;
    if (session) await this.stop(session, undefined);
    this.setState('disconnected');
  }

  async start() {
    this.setState('connecting');
    try {
      const dir = await this.deploy();
      this.facts = await this.probe(dir);
      // Independent of dsh: `dsh-harness` only needs Windows interop, so install it even when dsh is missing.
      await this.installLauncher().catch((error) => {
        this.launcher = { installed: false, error: error.message };
        this.options.logger.warn(`wsl-remote: ${this.distro}: could not install ${LAUNCHER_NAME}: ${error.message}`);
      });
      const requirement = dshRequirement(this.facts);
      if (requirement !== undefined) {
        this.wanted = false; // a missing program will not appear by retrying; the user reconnects after installing
        throw Object.assign(new Error(requirementMessage(this.distro, requirement)), { requirement });
      }
      await this.launch(dir);
      this.attempt = 0;
      this.setState('connected');
    } catch (error) {
      if (this.session) await this.stop(this.session, error);
      this.setState('error', error.message);
      if (error.requirement) this.requirement = error.requirement;
      this.emit('change', this.snapshot());
      throw error;
    }
  }

  /** Copy the agent into `~/.dsh-wsl-remote/agent/<version>` once (no npm install needed). */
  async deploy() {
    const home = await runWsl(['-d', this.distro, '--cd', '~', '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 90000 });
    const homeDir = home.stdout.trim();
    if (home.code !== 0 || !homeDir.startsWith('/')) throw new Error(`Could not start ${this.distro}: ${(home.stderr || home.stdout).trim() || `exit ${home.code}`}`);
    const dir = `${homeDir}/.dsh-wsl-remote/agent/${AGENT_VERSION}`;
    const ready = await runWsl(['-d', this.distro, '-e', 'test', '-f', `${dir}/.ready`], { timeoutMs: 30000 });
    if (ready.code === 0) return dir;
    this.options.logger.info(`wsl-remote: deploying agent ${AGENT_VERSION} to ${this.distro}:${dir}`);
    const overlay = [
      '# Generated by @local/dsh-wsl-remote: loads the WSL agent into this dsh when the',
      '# Windows DeepSeek Harness starts it (dsh --patch <this file>). Not used otherwise.',
      '- insert:',
      '    - id: wsl-remote-agent',
      `      name: ${dir}/agent.mjs`,
      '',
    ].join('\n');
    const files = [];
    for (const [from, to] of AGENT_FILES) files.push([to, await readFile(join(this.options.packageDir, from))]);
    files.push(['overlay.yml', Buffer.from(overlay)]);
    files.push(['package.json', Buffer.from('{ "private": true, "type": "module" }\n')]);
    const staging = `${dir}.partial`;
    await runWsl(['-d', this.distro, '-e', 'rm', '-rf', staging], { timeoutMs: 30000 });
    for (const [name, content] of files) {
      const target = `${staging}/${name}`;
      const write = await runWsl(['-d', this.distro, '-e', 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', target], { input: content, timeoutMs: 30000 });
      if (write.code !== 0) throw new Error(`Could not write ${target}: ${write.stderr.trim()}`);
    }
    const publish = await runWsl(['-d', this.distro, '-e', 'sh', '-c', 'rm -rf "$2" && mv "$1" "$2" && : > "$2/.ready"', 'sh', staging, dir], { timeoutMs: 30000 });
    if (publish.code !== 0) throw new Error(`Could not publish ${dir}: ${publish.stderr.trim()}`);
    return dir;
  }

  /** `dsh --version` through the login shell (like Codex's `codex --version` gate), plus OS and install facts. */
  async probe(dir) {
    const result = await runWsl(['-d', this.distro, '--cd', '~', '-e', '/bin/sh', `${dir}/launch.sh`, 'probe'], { timeoutMs: 90000 });
    return parseProbe(result.stdout);
  }

  /**
   * Write `~/.local/bin/dsh-harness`, which opens the Windows app from WSL.
   * A file of the same name that this plugin did not write is left alone.
   */
  async installLauncher() {
    const { windowsExe, requestDir } = this.options.launcher ?? {};
    if (!windowsExe || !requestDir) {
      this.launcher = undefined;
      return;
    }
    const home = this.facts?.home;
    if (!home?.startsWith('/')) throw new Error('the WSL home directory is unknown');
    const target = `${home}/${LAUNCHER_DIR}/${LAUNCHER_NAME}`;
    const template = await readFile(join(this.options.packageDir, 'server', 'dsh-harness.sh'), 'utf8');
    const script = renderLauncher(template, { windowsExe, requestDir });
    const write = await runWsl(['-d', this.distro, '-e', 'sh', '-c', [
      't=$1; m=$2',
      'if [ -e "$t" ] && ! grep -q "$m" "$t" 2>/dev/null; then echo foreign; exit 0; fi',
      'mkdir -p "$(dirname "$t")" && cat > "$t.tmp" && chmod 755 "$t.tmp" && mv "$t.tmp" "$t" && echo ok',
    ].join('\n'), 'sh', target, LAUNCHER_MARK], { input: script, timeoutMs: 30000 });
    if (write.code !== 0) throw new Error((write.stderr || write.stdout).trim() || `exit ${write.code}`);
    const outcome = write.stdout.trim();
    if (outcome === 'foreign') {
      this.launcher = { installed: false, path: target, conflict: true };
      return;
    }
    this.launcher = { installed: true, path: target, onPath: Boolean(this.facts?.localBinOnPath) };
  }

  launch(dir) {
    const { shareLogin, profile } = this.options.settings();
    const args = ['-d', this.distro, '--cd', '~', '-e', '/bin/sh', `${dir}/launch.sh`, 'run', profile, shareLogin ? '1' : '0'];
    const child = spawn(wslExecutable(), args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const session = {
      child,
      shareLogin,
      profile,
      stderr: [],
      nextChannel: 1,
      nextId: 1,
      pending: new Map(),
      opens: new Map(),
      remoteUrl: undefined,
      relay: undefined,
      relayPort: undefined,
      failure: undefined,
      disposers: [],
    };
    this.session = session;
    const hello = Promise.withResolvers();
    const url = Promise.withResolvers();
    hello.promise.catch(() => {});
    url.promise.catch(() => {});
    session.hello = hello;
    session.url = url;

    let line = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      line += text;
      const lines = line.split('\n');
      line = lines.pop() ?? '';
      for (const raw of lines) {
        const match = URL_LINE.exec(raw);
        if (match) {
          session.remoteUrl = match[1];
          url.resolve(match[1]);
          continue; // never log the launch token
        }
        if (!raw.trim()) continue;
        session.stderr.push(raw);
        if (session.stderr.length > 40) session.stderr.shift();
        this.options.logger.debug?.(`[wsl:${this.distro}] ${raw}`);
      }
    });
    child.once('error', (error) => this.lost(session, error));
    child.once('exit', (code, signal) => this.lost(session, new Error(`dsh in ${this.distro} exited (${code ?? signal})${this.tail(session)}`)));
    child.stdin.on('error', () => {});

    session.mux = new Mux(child.stdout, child.stdin, {
      control: (payload) => {
        let message;
        try {
          message = JSON.parse(payload.toString('utf8'));
        } catch {
          return;
        }
        this.receive(session, message).catch((error) => this.options.logger.warn(`wsl-remote: ${this.distro}: ${error.message}`));
      },
      frame: (type, channel, payload) => {
        if (type === FRAME.OPENED) session.opens.get(channel)?.resolve();
        else if (type === FRAME.OPEN_FAIL) {
          const stream = session.mux.channels.get(channel);
          if (stream) stream.remoteClosed = true;
          session.opens.get(channel)?.reject(new Error(payload.toString('utf8') || 'open failed'));
        }
      },
      closed: (error) => this.lost(session, error ?? new Error('WSL pipe closed')),
    });

    if (shareLogin) this.forwardCredentialEvents(session);

    return (async () => {
      const deadline = new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`dsh in ${this.distro} did not start within ${START_TIMEOUT_MS / 1000} s${this.tail(session)}`)), START_TIMEOUT_MS);
        session.disposers.push(() => clearTimeout(timer));
      });
      await Promise.race([Promise.all([hello.promise, url.promise]), deadline]);
      await this.listen(session);
      this.options.logger.info(`wsl-remote: connected to dsh ${this.facts?.version ?? ''} in ${this.distro} (UI relay 127.0.0.1:${session.relayPort}, shared login ${shareLogin ? 'on' : 'off'})`);
    })();
  }

  /** Windows loopback relay: each accepted socket becomes one mux channel to the WSL listener. */
  async listen(session) {
    const remotePort = Number(new URL(session.remoteUrl).port);
    const server = createServer({ allowHalfOpen: true }, (socket) => this.relay(session, socket, remotePort));
    server.on('error', (error) => this.options.logger.warn(`wsl-remote: relay for ${this.distro}: ${error.message}`));
    const preferred = this.options.settings().ports?.[this.distro] ?? 0;
    const bind = (port) => new Promise((resolve, reject) => {
      const fail = (error) => reject(error);
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', fail);
        resolve(server.address().port);
      });
    });
    let port;
    try {
      port = await bind(preferred);
    } catch (error) {
      if (preferred === 0) throw error;
      port = await bind(0);
    }
    session.relay = server;
    session.relayPort = port;
    // A stable relay port keeps the WSL dsh browser cookie valid across reconnects.
    if (port !== preferred) this.options.rememberPort(this.distro, port);
  }

  relay(session, socket, remotePort) {
    socket.on('error', () => {});
    if (session.failure) {
      socket.destroy();
      return;
    }
    const id = session.nextChannel++;
    const stream = session.mux.attach(id);
    stream.on('error', () => {});
    socket.pause();
    const opened = Promise.withResolvers();
    session.opens.set(id, opened);
    session.mux.sendJson(FRAME.OPEN, id, { port: remotePort });
    opened.promise.then(() => {
      session.opens.delete(id);
      socket.on('end', () => stream.end());
      stream.on('end', () => socket.end());
      socket.on('close', () => stream.destroy());
      stream.on('close', () => socket.destroy());
      socket.pipe(stream, { end: false });
      stream.pipe(socket, { end: false });
      socket.resume();
    }, () => {
      session.opens.delete(id);
      stream.destroy();
      socket.destroy();
    });
  }

  send(session, message) {
    session.mux.send(FRAME.DATA, 0, Buffer.from(JSON.stringify(message)));
  }

  request(session, method, params) {
    const id = session.nextId++;
    const done = Promise.withResolvers();
    session.pending.set(id, done);
    this.send(session, { id, method, params });
    return done.promise;
  }

  async receive(session, message) {
    if (message.method === undefined) {
      const waiter = session.pending.get(message.id);
      if (waiter === undefined) return;
      session.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(unwire(message.result));
      return;
    }
    if (message.method === 'hello') {
      session.agent = message.params;
      session.hello.resolve(message.params);
      return;
    }
    if (typeof message.method === 'string' && message.method.startsWith('credentials/') && message.id !== undefined) {
      try {
        const result = await this.credential(session, message.method.slice('credentials/'.length), message.params ?? {});
        this.send(session, { id: message.id, result: wire(result) });
      } catch (error) {
        this.send(session, { id: message.id, error: error?.message ?? String(error) });
      }
    }
  }

  /** Answer the WSL dsh's credential calls from the Windows credential store. */
  async credential(session, method, params) {
    const store = session.shareLogin ? this.options.credentials() : undefined;
    if (store === undefined) throw new Error('the Windows credential store is not shared with this connection');
    switch (method) {
      case 'resolve':
        return store.resolve(params.ref);
      case 'describe':
        return store.describe(params.ref);
      case 'set':
        return store.set(params.ref, params.value);
      case 'unset':
        return store.unset(params.ref);
      case 'readRecord':
        return store.readRecord(params.key);
      case 'describeRecord':
        return store.describeRecord(params.key);
      case 'listRecords':
        return (await store.listRecords()).filter((entry) => !String(entry.key).startsWith('client-connection/'));
      case 'deleteRecord':
        return store.deleteRecord(params.key);
      case 'modifyRecord':
        // The WSL-side mutation runs while the Windows store holds its writer lock,
        // so a refresh in WSL and one on Windows can never overwrite each other.
        return store.modifyRecord(params.key, async (current) => unwire(await this.request(session, 'mutate', { mid: params.mid, current: wire(current) })));
      default:
        throw new Error(`unknown credential method ${method}`);
    }
  }

  forwardCredentialEvents(session) {
    const onRecord = (key) => {
      if (!session.failure && !String(key).startsWith('client-connection/')) this.send(session, { method: 'record-updated', params: { key } });
    };
    const onRef = (ref) => {
      if (!session.failure) this.send(session, { method: 'reference-updated', params: { ref } });
    };
    session.disposers.push(this.options.onCredentialEvents(onRecord, onRef));
  }

  tail(session) {
    const text = session.stderr.join('\n').trim();
    return text ? `: ${text.split('\n').slice(-6).join(' | ')}` : '';
  }

  /** The pipe or process went away. */
  lost(session, error) {
    if (session.failure) return;
    this.stop(session, error).catch(() => {});
    if (this.session !== undefined) return;
    if (this.state === 'connecting') return; // start() reports the failure
    if (!this.wanted) {
      this.setState('disconnected');
      return;
    }
    const delay = RETRY_DELAYS_MS[this.attempt];
    if (delay === undefined) {
      this.setState('error', error.message);
      return;
    }
    this.attempt++;
    this.setState('error', `${error.message} — reconnecting`);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (!this.wanted || this.state === 'connecting' || this.state === 'connected') return;
      this.pending = this.start().catch(() => {}).finally(() => {
        this.pending = undefined;
      });
    }, delay);
    this.retryTimer.unref?.();
  }

  async stop(session, error) {
    if (session.failure === undefined) session.failure = error ?? new Error('disconnected');
    if (this.session === session) this.session = undefined;
    for (const dispose of session.disposers.splice(0)) {
      try {
        dispose();
      } catch {}
    }
    session.hello.reject(session.failure);
    session.url.reject(session.failure);
    for (const waiter of session.pending.values()) waiter.reject(session.failure);
    session.pending.clear();
    for (const open of session.opens.values()) open.reject(session.failure);
    session.relay?.close();
    session.mux?.fail(session.failure);
    const child = session.child;
    if (child.exitCode === null && child.signalCode === null) {
      // Closing stdin ends the agent's input; it stops dsh gracefully.
      try {
        child.stdin.end();
      } catch {}
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {}
          resolve();
        }, 10000);
        timer.unref?.();
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
