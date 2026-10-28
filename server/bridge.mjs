#!/usr/bin/env node
/**
 * Linux half of @local/dsh-wsl-remote, started by the Windows Host through
 * `wsl.exe -d <distro> -e <node> bridge.mjs`.
 *
 * Like VS Code's WSL server, it resolves the user's login-shell environment
 * once, then runs DeepSeek Harness's own POSIX execution helper (the
 * `@deepseek-ai/dsh-ssh` helper, unchanged) with that environment. stdin and
 * stdout of this process carry one multiplexed pipe:
 *   channel 0  -> the helper's administrative RPC (its stdio)
 *   channel n  -> one helper stream endpoint (Unix socket + TLS-PSK),
 *                 authenticated here and forwarded as plaintext.
 * Nothing listens on a network port. Diagnostics go to stderr only.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mux, FRAME } from './mux.js';
import { n as authenticateStream } from './helper/stream-security-DJlQsPG-.js';

const here = dirname(fileURLToPath(import.meta.url));
const log = (message) => process.stderr.write(`[wsl-remote bridge] ${message}\n`);
const MARK = '__DSH_WSL_REMOTE_ENV__';
const DROP = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'TERM', 'COLUMNS', 'LINES', 'PS1', 'PS2', 'ZDOTDIR_ORIG']);

function loginShell() {
  if (process.env.SHELL) return process.env.SHELL;
  try {
    const user = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim();
    const line = execFileSync('getent', ['passwd', user], { encoding: 'utf8' }).trim();
    return line.split(':')[6] || '/bin/sh';
  } catch {
    return '/bin/sh';
  }
}

/** Resolve the interactive login environment once, as VS Code does for remote servers. */
function resolveEnvironment(shell) {
  try {
    const out = execFileSync(shell, ['-ilc', `printf '%s' '${MARK}'; env -0; printf '%s' '${MARK}'`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, DSH_WSL_REMOTE_RESOLVING: '1' },
    });
    const text = out.toString('utf8');
    const start = text.indexOf(MARK);
    const end = text.lastIndexOf(MARK);
    if (start < 0 || end <= start) throw new Error('environment markers missing');
    const env = {};
    for (const entry of text.slice(start + MARK.length, end).split('\0')) {
      const eq = entry.indexOf('=');
      if (eq > 0) env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
    for (const key of DROP) delete env[key];
    delete env.DSH_WSL_REMOTE_RESOLVING;
    return { env, resolved: true };
  } catch (error) {
    log(`login environment unavailable (${error.message}); using the default environment`);
    return { env: { ...process.env }, resolved: false };
  }
}

function ripgrep() {
  for (const arch of [process.arch === 'arm64' ? 'arm64' : 'x64']) {
    const candidate = join(here, 'node_modules', '@vscode', `ripgrep-linux-${arch}`, 'bin', 'rg');
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  try {
    return execFileSync('sh', ['-c', 'command -v rg'], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function shells() {
  const found = new Map();
  let lines = [];
  try {
    lines = readFileSync('/etc/shells', 'utf8').split('\n');
  } catch {}
  for (const raw of lines) {
    const path = raw.trim();
    if (!path.startsWith('/') || !existsSync(path)) continue;
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (['rbash', 'screen', 'tmux', 'nologin', 'false'].includes(name)) continue;
    if (!found.has(name) || path.startsWith('/usr/bin/')) found.set(name, path);
  }
  return [...found.entries()].map(([name, path]) => ({ name, path }));
}

const shell = loginShell();
const { env, resolved } = resolveEnvironment(shell);
const home = env.HOME || process.env.HOME || '/';
const rg = ripgrep();
// The deployed ripgrep stays reachable as plain `rg`; a distribution's own copy keeps precedence.
if (rg !== undefined) env.PATH = `${env.PATH ?? '/usr/bin:/bin'}:${dirname(rg)}`;
const helperPath = join(here, 'helper', 'helper.js');

const helper = spawn(process.execPath, ['--disable-sigusr1', helperPath], {
  cwd: home,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
helper.stderr.on('data', (chunk) => process.stderr.write(chunk));

let exiting = false;
function shutdown(code) {
  if (exiting) return;
  exiting = true;
  if (helper.exitCode === null && helper.signalCode === null) {
    helper.kill('SIGTERM');
    setTimeout(() => helper.kill('SIGKILL'), 5000).unref();
    helper.once('exit', () => process.exit(code));
  } else process.exit(code);
}

const mux = new Mux(process.stdin, process.stdout, {
  closed: (error) => {
    if (error) log(`pipe closed: ${error.message}`);
    shutdown(0);
  },
  frame: (type, channel, payload) => {
    if (type === FRAME.OPEN) openStream(channel, payload);
  },
});

helper.once('exit', (code, signal) => {
  log(`helper exited (${code ?? signal})`);
  mux.fail(new Error('helper exited'));
  shutdown(code ?? 1);
});
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.once(signal, () => shutdown(0));

const admin = mux.attach(0);
admin.pipe(helper.stdin);
helper.stdout.pipe(admin);
admin.on('error', () => {});
helper.stdin.on('error', () => {});

function openStream(channel, payload) {
  let endpoint;
  try {
    endpoint = JSON.parse(payload.toString('utf8'));
    if (typeof endpoint.path !== 'string' || !endpoint.path.startsWith('/tmp/') || !/^[0-9a-f]{64}$/.test(endpoint.capability)) throw new Error('invalid endpoint');
  } catch (error) {
    mux.send(FRAME.OPEN_FAIL, channel, Buffer.from(error.message));
    return;
  }
  const socket = createConnection({ path: endpoint.path, allowHalfOpen: true });
  const failed = (error) => {
    socket.destroy();
    mux.send(FRAME.OPEN_FAIL, channel, Buffer.from(String(error?.message ?? error)));
  };
  socket.once('error', failed);
  socket.once('connect', async () => {
    socket.off('error', failed);
    socket.on('error', () => {});
    let stream;
    try {
      stream = await authenticateStream(socket, endpoint.capability, 30000);
    } catch (error) {
      failed(error);
      return;
    }
    const forwarded = mux.attach(channel);
    mux.send(FRAME.OPENED, channel);
    stream.on('error', (error) => forwarded.destroy(error));
    forwarded.on('error', () => stream.destroy());
    stream.on('end', () => forwarded.end());
    forwarded.on('end', () => stream.end());
    stream.on('close', () => forwarded.destroy());
    forwarded.on('close', () => stream.destroy());
    stream.pipe(forwarded, { end: false });
    forwarded.pipe(stream, { end: false });
    stream.resume();
  });
}

mux.sendJson(FRAME.HELLO, 0, {
  bridge: 1,
  node: process.version,
  shell,
  shells: shells(),
  home,
  environmentResolved: resolved,
  rg,
});
