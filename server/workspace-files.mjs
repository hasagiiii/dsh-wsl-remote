/**
 * The files a Session created or changed, for "copy session to another
 * workspace": collected from its history, read on the source host, written on
 * the target host.
 *
 *  - A file inside the source workspace lands at the same path relative to
 *    the target workspace.
 *  - A file outside it lands under `.dsh-external/` in the target workspace,
 *    at a path derived from its absolute path (Windows `E:` + `data/a.csv` →
 *    `.dsh-external/E/data/a.csv`; `/tmp/b.txt` → `.dsh-external/tmp/b.txt`),
 *    so nothing is ever written outside the target workspace.
 *
 * More than ZIP_THRESHOLD files travel as one zip (built and unpacked here
 * with `node:zlib` only); fewer travel as separate base64 entries. The result
 * on disk is the same.
 *
 * Plain `node:fs`, `node:path` and `node:zlib` only, so the same file runs in
 * the Windows Host and, deployed beside the agent, in a remote dsh. Paths a
 * Session names are in its own host's spelling (Windows drive paths,
 * `/home/me/x/a.js`, a WSL session's `/mnt/e/...`); `relativeInside` decides
 * membership with the source host's path rules.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/** One file larger than this is listed but not copied. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** All copied files together stay under this (they travel in one pipe message with the session). */
export const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
/** Most files offered at once. */
export const MAX_FILES = 500;
/** More chosen files than this travel as one zip. */
export const ZIP_THRESHOLD = 20;
/** Folder in the target workspace that receives files from outside the source workspace. */
export const EXTERNAL_DIR = '.dsh-external';

/** Tools whose successful call writes the file it names. */
const WRITERS = new Set(['write', 'edit', 'multi_edit', 'str_replace_editor', 'notebook_edit', 'apply_patch']);
const BACKSLASH = String.fromCharCode(92);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The path flavour of an absolute path: Windows drive/UNC, else POSIX. */
export function pathFlavor(path) {
  if (typeof path !== 'string') return posix;
  if (/^[A-Za-z]:/.test(path) && (path[2] === '/' || path[2] === BACKSLASH)) return win32;
  if (path.startsWith(BACKSLASH + BACKSLASH)) return win32;
  return posix;
}

/**
 * The workspace-relative POSIX path of `file`, when it lies inside `root`.
 * @returns {string | undefined}
 */
export function relativeInside(root, file) {
  if (typeof root !== 'string' || typeof file !== 'string' || root.length === 0 || file.length === 0) return undefined;
  const flavor = pathFlavor(root);
  if (pathFlavor(file) !== flavor) return undefined;
  if (!flavor.isAbsolute(file)) return undefined;
  const relative = flavor.relative(flavor.resolve(root), flavor.resolve(file));
  if (relative === '' || relative.startsWith('..') || flavor.isAbsolute(relative)) return undefined;
  const parts = relative.split(flavor.sep);
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined;
  return parts.join('/');
}

/**
 * Where a file from outside the source workspace goes in the target
 * workspace: `.dsh-external/` plus its absolute path with the drive (or UNC
 * server and share) as the first segment.
 * @returns {string | undefined} a workspace-relative POSIX path.
 */
export function externalRelative(file) {
  if (typeof file !== 'string' || file.length === 0) return undefined;
  const flavor = pathFlavor(file);
  if (!flavor.isAbsolute(file)) return undefined;
  const normalized = flavor.normalize(file);
  let parts;
  if (flavor === win32) {
    const drive = /^([A-Za-z]):/.exec(normalized);
    const rest = normalized.split(BACKSLASH).filter(Boolean);
    // `E:\a\b` → ['E', 'a', 'b'];  `\\server\share\a` → ['server', 'share', 'a'].
    parts = drive ? [drive[1].toUpperCase(), ...rest.slice(1)] : rest;
  } else {
    parts = normalized.split('/').filter(Boolean);
  }
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..' || part.includes(':'))) return undefined;
  return [EXTERNAL_DIR, ...parts].join('/');
}

/** Parse a tool call's JSON arguments. */
function argumentsOf(call) {
  const raw = call?.data?.arguments;
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  try {
    const value = JSON.parse(raw);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Files the Session created or changed with its file tools (successful calls
 * only), plus the files it presented as deliverables, in first-touched order.
 * Paths are absolute in the source host's spelling; relative ones resolve
 * against the working directory the Session had at that point.
 * @returns {{ path: string, sources: string[] }[]}
 */
export function touchedFiles(events, initialCwd) {
  const calls = new Map();
  const found = new Map();
  let cwd = initialCwd;
  const add = (path, source) => {
    if (typeof path !== 'string' || path.length === 0) return;
    const flavor = pathFlavor(cwd ?? path);
    const absolute = flavor.isAbsolute(path) || cwd === undefined ? path : flavor.resolve(cwd, path);
    const entry = found.get(absolute) ?? { path: absolute, sources: [] };
    if (!entry.sources.includes(source)) entry.sources.push(source);
    found.set(absolute, entry);
  };
  for (const event of events) {
    if (event.type === 'working-directory/change' && typeof event.data?.cwd === 'string') cwd = event.data.cwd;
    if (event.type === 'tool/call' && typeof event.data?.callId === 'string') calls.set(event.data.callId, event);
    if (event.type === 'tool/result') {
      const message = event.data?.message;
      const callId = message?.toolCallId ?? message?.source?.callId;
      const call = calls.get(callId);
      const name = call?.data?.name;
      if (call === undefined || !WRITERS.has(name) || message?.isError === true) continue;
      const meta = event.data?.meta;
      const args = argumentsOf(call);
      if (name === 'str_replace_editor' && args?.command === 'view') continue;
      const metaPaths = [meta?.path, ...(Array.isArray(meta?.diffs) ? meta.diffs.map((diff) => diff?.path) : [])].filter((path) => typeof path === 'string');
      const paths = metaPaths.length > 0 ? metaPaths : [args?.file_path ?? args?.path ?? args?.notebook_path];
      for (const path of paths) add(path, name);
    }
    if (event.type === 'deliverables/presented' && Array.isArray(event.data?.files)) {
      for (const file of event.data.files) add(isRecord(file) ? file.path : file, 'present');
    }
  }
  return [...found.values()];
}

/**
 * What a copy offers: each touched file with where it lands in the target
 * workspace (`relative`; `external` when it came from outside the source
 * workspace) and its current size, and the ones that cannot go (gone, a
 * directory, too large, an unmappable path).
 * @returns {Promise<{ files: { relative: string, path: string, bytes: number, sources: string[], external: boolean }[], skipped: { path: string, reason: string, bytes?: number }[] }>}
 */
export async function planFiles(events, root, initialCwd) {
  const files = [];
  const skipped = [];
  const taken = new Set();
  for (const entry of touchedFiles(events, initialCwd ?? root)) {
    const inside = relativeInside(root, entry.path);
    const relative = inside ?? externalRelative(entry.path);
    if (relative === undefined || taken.has(relative)) {
      skipped.push({ path: entry.path, reason: 'unmappable' });
      continue;
    }
    let info;
    try {
      info = await stat(entry.path);
    } catch {
      skipped.push({ path: entry.path, reason: 'missing' });
      continue;
    }
    if (!info.isFile()) {
      skipped.push({ path: entry.path, reason: 'not-file' });
      continue;
    }
    if (info.size > MAX_FILE_BYTES) {
      skipped.push({ path: entry.path, reason: 'too-large', bytes: info.size });
      continue;
    }
    if (files.length >= MAX_FILES) {
      skipped.push({ path: entry.path, reason: 'too-many' });
      continue;
    }
    taken.add(relative);
    files.push({ relative, path: entry.path, bytes: info.size, sources: entry.sources, external: inside === undefined });
  }
  return { files, skipped };
}

// ---- zip: the stored/deflated subset needed to move files, no dependencies ----

const DOS_EPOCH = { date: (1 << 5) | 1, time: 0 }; // 1980-01-01 00:00

/**
 * Pack files into one zip (deflate, UTF-8 names).
 * @param {{ name: string, data: Buffer }[]} entries
 * @returns {Buffer}
 */
export function zipFiles(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_EPOCH.time, 10);
    local.writeUInt16LE(DOS_EPOCH.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_EPOCH.time, 12);
    central.writeUInt16LE(DOS_EPOCH.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * Unpack a zip made by `zipFiles` (stored or deflated entries), checking each CRC.
 * @returns {{ name: string, data: Buffer }[]}
 */
export function unzipFiles(zip) {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('copied files: not a zip');
  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  const out = [];
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('copied files: broken zip directory');
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const body = zip.subarray(dataAt, dataAt + compressed);
    const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body) : undefined;
    if (data === undefined) throw new Error(`copied files: unsupported zip method ${method}`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`copied files: ${name} is damaged`);
    out.push({ name, data });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/**
 * Read the chosen files (by target-relative path, re-checked against the plan)
 * for the copy: separate base64 entries for a few, one zip for many. Files
 * whose total would pass MAX_TOTAL_BYTES are refused.
 * @returns {Promise<{ files?: { relative: string, data: string }[], zip?: string, count: number }>}
 */
export async function readFiles(events, root, initialCwd, relatives) {
  const { files } = await planFiles(events, root, initialCwd);
  const byRelative = new Map(files.map((file) => [file.relative, file]));
  const read = [];
  let total = 0;
  for (const relative of relatives) {
    const file = byRelative.get(relative);
    if (file === undefined) throw new Error(`${relative} is not a file this session changed`);
    const data = await readFile(file.path);
    if (data.byteLength > MAX_FILE_BYTES) throw new Error(`${relative} is larger than ${MAX_FILE_BYTES / 1048576} MB`);
    total += data.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error(`the chosen files add up to more than ${MAX_TOTAL_BYTES / 1048576} MB; choose fewer`);
    read.push({ relative, data });
  }
  if (read.length > ZIP_THRESHOLD) {
    return { zip: zipFiles(read.map(({ relative, data }) => ({ name: relative, data }))).toString('base64'), count: read.length };
  }
  return { files: read.map(({ relative, data }) => ({ relative, data: data.toString('base64') })), count: read.length };
}

/** The `{ relative, data }` entries of a `readFiles` bundle (or a plain list), unpacking a zip. */
export function bundleEntries(bundle) {
  if (Array.isArray(bundle)) return bundle.map(({ relative, data }) => ({ relative, data: Buffer.from(data, 'base64') }));
  if (!isRecord(bundle)) return [];
  if (typeof bundle.zip === 'string') return unzipFiles(Buffer.from(bundle.zip, 'base64')).map(({ name, data }) => ({ relative: name, data }));
  return (bundle.files ?? []).map(({ relative, data }) => ({ relative, data: Buffer.from(data, 'base64') }));
}

/** Where a relative path lands in the target workspace, refusing anything that would leave it. */
export function targetPath(root, relative) {
  if (typeof relative !== 'string' || relative.length === 0) throw new Error('empty file path');
  const flavor = pathFlavor(root);
  const parts = relative.split('/');
  // No empty, `.` or `..` segments; no backslash anywhere; no `:` when the target is Windows (drive or stream syntax).
  const bad = (part) => part === '' || part === '.' || part === '..' || part.includes(BACKSLASH) || (flavor === win32 && part.includes(':'));
  if (parts.some(bad)) throw new Error(`invalid file path ${relative}`);
  const full = flavor.join(root, ...parts);
  if (relativeInside(root, full) !== relative) throw new Error(`invalid file path ${relative}`);
  return full;
}

/** Whether something exists at this path. */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which of these relative paths already exist in the target workspace.
 * @returns {Promise<string[]>}
 */
export async function existingFiles(root, relatives) {
  const out = [];
  for (const relative of relatives) {
    if (await exists(targetPath(root, relative))) out.push(relative);
  }
  return out;
}

/**
 * Write copied files into the target workspace. An existing file is kept
 * unless `overwrite` is set. Each write goes to a temporary sibling first and
 * is renamed into place.
 * @param bundle - a `readFiles` result, or a list of `{ relative, data }` (base64).
 * @returns {Promise<{ written: string[], kept: string[] }>}
 */
export async function writeFiles(root, bundle, { overwrite = false } = {}) {
  const flavor = pathFlavor(root);
  const entries = bundleEntries(bundle);
  // Check every path before writing any, so a bad entry leaves the workspace untouched.
  const targets = entries.map(({ relative }) => targetPath(root, relative));
  const written = [];
  const kept = [];
  for (const [index, { relative, data }] of entries.entries()) {
    const full = targets[index];
    if (!overwrite && await exists(full)) {
      kept.push(relative);
      continue;
    }
    await mkdir(flavor.dirname(full), { recursive: true });
    const temporary = `${full}.dsh-copy-${process.pid}-${Date.now()}`;
    await writeFile(temporary, data);
    await rename(temporary, full);
    written.push(relative);
  }
  return { written, kept };
}
