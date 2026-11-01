/**
 * Linux side of "Add workspace → WSL / SSH": list directories on a remote
 * host for the in-app folder picker, and spell the address a picked folder
 * is handed to `workspace/create` with:
 *   WSL  `\\wsl.localhost\<distro>\<path>` (also what DSH stored as paths before)
 *   SSH  `ssh://<dest>/<path>`
 * The address only names the host; the workspace keeps the Linux path.
 *
 * Listing runs `find` on the host itself (through wsl.exe or ssh), so it sees
 * exactly what the Linux user sees (permissions, symlinks, mounts).
 */
import { hostKind, isSshDest, runOn, sshDestOf, sshHostId } from './transport.js';

/** Most entries one listing returns; the picker shows a "truncated" note past it. */
export const MAX_ENTRIES = 2000;

const UNC = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;
const SSH_ADDRESS = /^ssh:\/\/([^/\s]+)(\/.*)?$/i;

/**
 * Normalise a Linux absolute path: collapse `//`, resolve `.` and `..`, drop the trailing slash.
 * @returns {string | undefined} undefined for relative or non-string input.
 */
export function normalizeLinuxPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) return undefined;
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** `\\wsl.localhost\<distro>\<path with backslashes>`; `/` maps to the distribution root. */
export function toUncPath(distro, linuxPath) {
  const path = normalizeLinuxPath(linuxPath);
  if (path === undefined) throw new Error(`not an absolute Linux path: ${linuxPath}`);
  return `\\\\wsl.localhost\\${distro}${path === '/' ? '\\' : path.replace(/\//g, '\\')}`;
}

/**
 * The distribution and Linux path behind a `\\wsl.localhost\…` or `\\wsl$\…` path.
 * @returns {{ distro: string, path: string } | undefined}
 */
export function fromUncPath(path) {
  const match = UNC.exec(String(path ?? ''));
  if (match === null) return undefined;
  return { distro: match[1], path: normalizeLinuxPath((match[2] ?? '\\').replace(/\\/g, '/')) ?? '/' };
}

/** The address a picked folder of any remote host is handed to `workspace/create` with. */
export function toRemoteAddress(hostId, linuxPath) {
  if (hostKind(hostId) === 'wsl') return toUncPath(hostId, linuxPath);
  const path = normalizeLinuxPath(linuxPath);
  if (path === undefined) throw new Error(`not an absolute Linux path: ${linuxPath}`);
  return `ssh://${sshDestOf(hostId)}${path}`;
}

/**
 * The host id (`distro` field: a distribution or `ssh:<dest>`) and Linux path
 * behind a WSL UNC path or an `ssh://` address.
 * @returns {{ distro: string, path: string } | undefined}
 */
export function fromRemoteAddress(value) {
  const unc = fromUncPath(value);
  if (unc !== undefined) return unc;
  const match = SSH_ADDRESS.exec(String(value ?? ''));
  if (match === null || !isSshDest(match[1])) return undefined;
  return { distro: sshHostId(match[1]), path: normalizeLinuxPath(match[2] ?? '/') ?? '/' };
}

/** `$HOME` of a host; login-shell noise around it (an SSH banner) is ignored. */
export async function remoteHome(hostId, { signal, timeoutMs = 60000 } = {}) {
  // `echo` only: no format string or backslash has to survive wsl.exe or ssh argument passing.
  const result = await runOn(hostId, ['sh', '-c', 'echo; echo "__WSLR__ home=$HOME"'], { timeoutMs, signal });
  const match = /^__WSLR__ home=(\/.*)$/m.exec(result.stdout.replace(/\r/g, ''));
  if (result.code !== 0 || match === null) {
    const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`;
    throw Object.assign(new Error(`Could not reach ${hostKind(hostId) === 'ssh' ? sshDestOf(hostId) : hostId}: ${detail}`), { stderr: result.stderr });
  }
  return match[1];
}

/** `/etc/os-release` → { name, version, pretty }; values may be quoted. */
export function parseOsRelease(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  if (!fields.NAME && !fields.PRETTY_NAME) return undefined;
  return { name: fields.NAME ?? '', version: fields.VERSION_ID ?? '', pretty: fields.PRETTY_NAME ?? '' };
}

/** Root → current, like DSH's DirectoryListing crumbs. */
export function crumbsOf(path) {
  const crumbs = [{ name: '/', path: '/', hidden: false }];
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += `/${part}`;
    crumbs.push({ name: part, path: current, hidden: part.startsWith('.') });
  }
  return crumbs;
}

/**
 * Parse `find -printf '%y\t%f\0'`-style output into directory entries.
 * `%y` is `d` for a directory; `l` entries are symlinks whose target type `find -L` resolved to `d`.
 */
export function parseEntries(stdout, dir) {
  const entries = [];
  for (const record of stdout.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const name = record.slice(tab + 1);
    if (!name || name === '.' || name === '..' || name.includes('/')) continue;
    entries.push({ name, path: dir === '/' ? `/${name}` : `${dir}/${name}`, hidden: name.startsWith('.') });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return entries;
}

/**
 * List the subdirectories of `path` (default: the Linux home) on a host
 * (a distribution or an `ssh:<dest>` id).
 * @returns {Promise<{ distro: string, path: string, home: string, unc: string, crumbs: object[], entries: object[], truncated: boolean }>}
 */
export async function listLinuxDirectory(distro, path, { home, signal } = {}) {
  const linuxHome = home || await remoteHome(distro, { signal });
  const dir = path === undefined || path === '' ? linuxHome : normalizeLinuxPath(path === '~' ? linuxHome : path.replace(/^~(?=\/)/, linuxHome));
  if (dir === undefined) throw new Error(`Enter an absolute Linux path such as ${linuxHome}`);
  // -L follows symlinks so a link to a directory lists as one; -maxdepth 1 keeps it to one level.
  // `cd` first gives a clear error for missing or unreadable directories.
  const script = 'cd -- "$1" 2>/dev/null || { [ -e "$1" ] && echo "not-a-directory-or-denied" >&2 || echo "missing" >&2; exit 3; }; find -L . -mindepth 1 -maxdepth 1 -type d -printf "%y\\t%f\\0" 2>/dev/null | head -z -n "$2"';
  const result = await runOn(distro, ['sh', '-c', script, 'sh', dir, String(MAX_ENTRIES + 1)], { timeoutMs: 60000, signal, maxBytes: 8 * 1024 * 1024 });
  if (result.code === 3) {
    const reason = result.stderr.trim().split(/\r?\n/).at(-1);
    throw Object.assign(new Error(reason === 'missing' ? `${dir} does not exist` : `${dir} is not a readable directory`), { code: reason === 'missing' ? 'missing' : 'unreadable' });
  }
  if (result.code !== 0) throw new Error(`Could not list ${dir}: ${result.stderr.trim() || `exit ${result.code}`}`);
  // Records start at the first NUL-separated `<type>\t<name>`; drop login-shell noise before it.
  const entries = parseEntries(result.stdout.replace(/^[^\0]*?(?=[a-z]\t)/s, ''), dir);
  const truncated = entries.length > MAX_ENTRIES;
  return { distro, path: dir, home: linuxHome, unc: toRemoteAddress(distro, dir), crumbs: crumbsOf(dir), entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries, truncated };
}

/** Create `name` inside `parent` (no path separators), like the browse picker's "New folder". */
export async function createLinuxDirectory(distro, parent, name, { signal } = {}) {
  const dir = normalizeLinuxPath(parent);
  if (dir === undefined) throw new Error('the parent must be an absolute Linux path');
  if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\0') || name === '.' || name === '..') throw new Error('Folder names cannot contain "/"');
  const target = dir === '/' ? `/${name}` : `${dir}/${name}`;
  const result = await runOn(distro, ['mkdir', '--', target], { timeoutMs: 30000, signal });
  if (result.code !== 0) throw new Error(result.stderr.trim().replace(/^mkdir: /, '') || `Could not create ${target}`);
  return target;
}
