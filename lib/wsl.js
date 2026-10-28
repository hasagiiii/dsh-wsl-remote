/**
 * Small helpers around `wsl.exe` used by the Windows Host.
 * Every call uses a fixed argv; no user text reaches a Windows shell.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/** Absolute `wsl.exe`, so PATH cannot substitute another program. */
export function wslExecutable() {
  return join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', 'wsl.exe');
}

/** Distributions that only host other products and never run user work. */
const HIDDEN = /^(docker-desktop(-data)?|rancher-desktop(-data)?)$/i;

/** Valid WSL distribution names; also the guard for every argv we build. */
export function isDistroName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

/**
 * Run `wsl.exe` with a fixed argv and collect bounded output.
 * @param {string[]} args
 * @param {{ input?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number }} [options]
 */
export function runWsl(args, options = {}) {
  const { input, timeoutMs = 60000, signal, maxBytes = 4 * 1024 * 1024 } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(wslExecutable(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, WSL_UTF8: '1' },
    });
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
      finish(reject, signal.reason instanceof Error ? signal.reason : new Error('wsl.exe call aborted'));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`wsl.exe ${args.join(' ')} timed out after ${timeoutMs} ms`));
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

/** wsl.exe writes UTF-16LE unless WSL_UTF8 is honoured; accept both. */
export function decode(buffer) {
  if (buffer.length >= 2 && buffer.length % 2 === 0) {
    let zeros = 0;
    for (let i = 1; i < Math.min(buffer.length, 64); i += 2) if (buffer[i] === 0) zeros++;
    if (zeros > 4) return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

/**
 * List installed distributions without starting any of them.
 * @returns {Promise<{ name: string, isDefault: boolean }[]>}
 */
export async function listDistros(signal) {
  const verbose = await runWsl(['--list', '--verbose'], { timeoutMs: 15000, signal });
  if (verbose.code !== 0) return [];
  const rows = [];
  for (const raw of verbose.stdout.replace(/\0/g, '').split(/\r?\n/).slice(1)) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) continue;
    const isDefault = line.trimStart().startsWith('*');
    const parts = line.replace(/^\s*\*?\s*/, '').split(/\s+/);
    const name = parts[0];
    const version = Number(parts[parts.length - 1]);
    if (!isDistroName(name) || HIDDEN.test(name)) continue;
    if (Number.isFinite(version) && version !== 2) continue;
    rows.push({ name, isDefault });
  }
  return rows;
}
