/**
 * Linux side of "Add workspace → WSL": list directories inside a distribution
 * for the in-app folder picker, and map Linux paths to the `\\wsl.localhost`
 * UNC paths DSH stores as workspace paths.
 *
 * Listing goes through `wsl.exe -e find`, so it sees exactly what the Linux
 * user sees (permissions, symlinks, mounts) instead of the 9P view from Windows.
 */
import { runWsl } from './wsl.js';

/** Most entries one listing returns; the picker shows a "truncated" note past it. */
export const MAX_ENTRIES = 2000;

const UNC = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$/i;

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
 * List the subdirectories of `path` (default: the Linux home) in `distro`.
 * @returns {Promise<{ distro: string, path: string, home: string, unc: string, crumbs: object[], entries: object[], truncated: boolean }>}
 */
export async function listLinuxDirectory(distro, path, { home, signal } = {}) {
  let linuxHome = home;
  if (!linuxHome) {
    const result = await runWsl(['-d', distro, '--cd', '~', '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 60000, signal });
    linuxHome = result.stdout.trim();
    if (result.code !== 0 || !linuxHome.startsWith('/')) throw new Error(`Could not start ${distro}: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
  }
  const dir = path === undefined || path === '' ? linuxHome : normalizeLinuxPath(path === '~' ? linuxHome : path.replace(/^~(?=\/)/, linuxHome));
  if (dir === undefined) throw new Error(`Enter an absolute Linux path such as ${linuxHome}`);
  // -L follows symlinks so a link to a directory lists as one; -maxdepth 1 keeps it to one level.
  // `cd` first gives a clear error for missing or unreadable directories.
  const script = 'cd -- "$1" 2>/dev/null || { [ -e "$1" ] && echo "not-a-directory-or-denied" >&2 || echo "missing" >&2; exit 3; }; find -L . -mindepth 1 -maxdepth 1 -type d -printf "%y\\t%f\\0" 2>/dev/null | head -z -n "$2"';
  const result = await runWsl(['-d', distro, '-e', 'sh', '-c', script, 'sh', dir, String(MAX_ENTRIES + 1)], { timeoutMs: 60000, signal, maxBytes: 8 * 1024 * 1024 });
  if (result.code === 3) {
    const reason = result.stderr.trim();
    throw Object.assign(new Error(reason === 'missing' ? `${dir} does not exist` : `${dir} is not a readable directory`), { code: reason === 'missing' ? 'missing' : 'unreadable' });
  }
  if (result.code !== 0) throw new Error(`Could not list ${dir}: ${result.stderr.trim() || `exit ${result.code}`}`);
  const entries = parseEntries(result.stdout, dir);
  const truncated = entries.length > MAX_ENTRIES;
  return { distro, path: dir, home: linuxHome, unc: toUncPath(distro, dir), crumbs: crumbsOf(dir), entries: truncated ? entries.slice(0, MAX_ENTRIES) : entries, truncated };
}

/** Create `name` inside `parent` (no path separators), like the browse picker's "New folder". */
export async function createLinuxDirectory(distro, parent, name, { signal } = {}) {
  const dir = normalizeLinuxPath(parent);
  if (dir === undefined) throw new Error('the parent must be an absolute Linux path');
  if (typeof name !== 'string' || !name.trim() || name.includes('/') || name.includes('\0') || name === '.' || name === '..') throw new Error('Folder names cannot contain "/"');
  const target = dir === '/' ? `/${name}` : `${dir}/${name}`;
  const result = await runWsl(['-d', distro, '-e', 'mkdir', '--', target], { timeoutMs: 30000, signal });
  if (result.code !== 0) throw new Error(result.stderr.trim().replace(/^mkdir: /, '') || `Could not create ${target}`);
  return target;
}
