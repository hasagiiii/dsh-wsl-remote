/**
 * How the Windows Host reaches a remote Linux host. Two kinds share every
 * other piece of a connection (deploy, probe, launch, relay, credentials,
 * process-group cleanup):
 *
 *   WSL  host id `<distro>`        wsl.exe -d <distro> --cd ~ -e <argv…>
 *   SSH  host id `ssh:<dest>`      ssh -T -o BatchMode=yes … -- <dest> '<argv…>'
 *
 * Both run a Linux argv in the user's home directory with binary-safe stdio.
 * SSH hands the remote login shell one command string, so every argument is
 * single-quoted; no user text reaches a Windows shell either way.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decode, isDistroName, wslExecutable } from './wsl.js';

export const SSH_PREFIX = 'ssh:';

/** `[user@]host[:port]` or a `Host` alias of ~/.ssh/config; never starts with `-`. */
const SSH_DEST = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]{0,63}@)?[A-Za-z0-9_][A-Za-z0-9._-]{0,127}(?::[0-9]{1,5})?$/;

export const isSshDest = (value) => typeof value === 'string' && SSH_DEST.test(value) && portOf(value) !== null;
export const isSshHost = (id) => typeof id === 'string' && id.startsWith(SSH_PREFIX) && isSshDest(id.slice(SSH_PREFIX.length));
export const sshDestOf = (id) => (isSshHost(id) ? id.slice(SSH_PREFIX.length) : undefined);
export const sshHostId = (dest) => `${SSH_PREFIX}${dest}`;
/** A WSL distribution name or an SSH host id. */
export const isHostId = (value) => isDistroName(value) || isSshHost(value);
export const hostKind = (id) => (isSshHost(id) ? 'ssh' : 'wsl');

/** The port of `host:port` (undefined without one, null when out of range). */
function portOf(dest) {
  const match = /:([0-9]{1,5})$/.exec(dest);
  if (match === null) return undefined;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Split a destination into the ssh argv pieces: `-p <port>` and `[user@]host`. */
export function sshTarget(dest) {
  if (!isSshDest(dest)) throw new Error(`not an SSH destination: ${String(dest)}`);
  const port = portOf(dest);
  return { host: port === undefined ? dest : dest.replace(/:[0-9]+$/, ''), port };
}

/** Single-quoted POSIX sh literal (also read correctly by bash, zsh and fish). */
export const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** Options for every ssh call: no prompts (the window cannot answer them), no tty, keepalives. */
export const SSH_OPTIONS = [
  '-T',
  '-e', 'none',
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=15',
  '-o', 'ServerAliveCountMax=3',
];

/** Windows' bundled OpenSSH client, else `ssh` from PATH. */
export function sshExecutable() {
  if (process.platform === 'win32') {
    const bundled = join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (existsSync(bundled)) return bundled;
  }
  return 'ssh';
}

/**
 * The ssh program and any leading arguments. Tests set DSH_WSL_REMOTE_SSH to
 * a JSON argv (for example a fake ssh script run by Node); otherwise the
 * system client.
 */
function sshProgram() {
  const override = process.env.DSH_WSL_REMOTE_SSH;
  if (override) {
    const argv = JSON.parse(override);
    if (Array.isArray(argv) && argv.length > 0 && argv.every((item) => typeof item === 'string')) return { file: argv[0], prefix: argv.slice(1) };
  }
  return { file: sshExecutable(), prefix: [] };
}

/** Program and argv that run one Linux argv on a host, in its home directory. */
export function commandFor(hostId, argv) {
  const dest = sshDestOf(hostId);
  if (dest !== undefined) {
    const { host, port } = sshTarget(dest);
    const { file, prefix } = sshProgram();
    return { file, args: [...prefix, ...SSH_OPTIONS, ...(port === undefined ? [] : ['-p', String(port)]), '--', host, argv.map(shQuote).join(' ')] };
  }
  if (!isDistroName(hostId)) throw new Error(`unknown remote host ${String(hostId)}`);
  return { file: wslExecutable(), args: ['-d', hostId, '--cd', '~', '-e', ...argv] };
}

/** Start one Linux argv on a host with piped stdio (the connection's long-lived pipe). */
export function spawnOn(hostId, argv) {
  const { file, args } = commandFor(hostId, argv);
  return spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } });
}

/**
 * Run one Linux argv on a host and collect bounded output.
 * @param {{ input?: string | Buffer, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function runOn(hostId, argv, options = {}) {
  const { input, timeoutMs = 60000, signal, maxBytes = 4 * 1024 * 1024 } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnOn(hostId, argv);
    } catch (error) {
      reject(error);
      return;
    }
    const out = [];
    const err = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      fn(value);
    };
    const abort = () => {
      child.kill();
      finish(reject, signal.reason instanceof Error ? signal.reason : new Error('remote call aborted'));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`${hostLabel(hostId)}: ${argv[0]} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) out.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (err.length < 64) err.push(chunk);
    });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => {
      finish(resolve, { code, stdout: decode(Buffer.concat(out)), stderr: decode(Buffer.concat(err)) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** How a host is named to the user: `WSL: Ubuntu`, `SSH: dev-box`. */
export function hostLabel(hostId) {
  const dest = sshDestOf(hostId);
  return dest === undefined ? `WSL: ${hostId}` : `SSH: ${dest}`;
}

/**
 * Concrete `Host` aliases of an OpenSSH client config (patterns and negations
 * are skipped: they do not name one machine). `Include` is not followed.
 * @returns {string[]}
 */
export function parseSshConfig(text) {
  const hosts = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^Host(?:\s*=\s*|\s+)(.+)$/i.exec(line);
    if (match === null) continue;
    for (const name of match[1].split(/\s+/)) {
      if (!name || /[*?!]/.test(name) || !isSshDest(name) || hosts.includes(name)) continue;
      hosts.push(name);
    }
  }
  return hosts;
}

/** `~/.ssh/config` of the Windows user; missing or unreadable means no aliases. */
export function readSshConfigHosts(file = join(homedir(), '.ssh', 'config')) {
  try {
    return parseSshConfig(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/** Why an SSH call failed, in words the user can act on (the raw ssh text follows). */
export function sshHint(stderr) {
  const text = String(stderr ?? '');
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) return 'host-key';
  if (/Permission denied|publickey|password/i.test(text)) return 'auth';
  if (/Could not resolve hostname|Connection refused|timed out|No route to host|Network is unreachable/i.test(text)) return 'network';
  return undefined;
}
