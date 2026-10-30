/**
 * Windows side of `dsh-harness` (the WSL command that opens this app, like
 * `code .`). The WSL script drops one request file per invocation into
 * `<DSH home>/wsl-remote/requests`, reached from WSL through /mnt/<drive>; this
 * watcher reads each file once, deletes it, and hands the Linux path to the Host.
 *
 * Format (NUL-separated, a Linux path can hold any byte except NUL):
 *   dsh-harness/1 \0 <WSL_DISTRO_NAME> \0 <absolute Linux path> \0
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import { isDistro } from './state.js';

const MAGIC = 'dsh-harness/1';
/** Requests older than this were left by a run the app never saw; drop them instead of acting late. */
const STALE_MS = 2 * 60 * 1000;
const POLL_MS = 1500;

/** @returns {{ distro: string, path: string } | undefined} */
export function parseRequest(buffer) {
  const fields = buffer.toString('utf8').split('\0');
  if (fields[0] !== MAGIC || fields.length < 3) return undefined;
  const [, distro, path] = fields;
  if (!isDistro(distro) || !path.startsWith('/') || path.length > 4096) return undefined;
  return { distro, path };
}

/**
 * Watch the request directory until the returned function is called.
 * @param {string} dir
 * @param {(request: { distro: string, path: string }) => void | Promise<void>} onRequest
 * @param {{ warn: Function }} logger
 */
export function watchRequests(dir, onRequest, logger) {
  mkdirSync(dir, { recursive: true });
  const seen = new Set();
  let closed = false;
  const scan = () => {
    if (closed) return;
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.req') || seen.has(name)) continue;
      const file = join(dir, name);
      seen.add(name);
      let request;
      try {
        const fresh = Date.now() - statSync(file).mtimeMs < STALE_MS;
        request = fresh ? parseRequest(readFileSync(file)) : undefined;
      } catch {}
      try {
        rmSync(file, { force: true });
      } catch {}
      seen.delete(name);
      if (request === undefined) continue;
      Promise.resolve()
        .then(() => onRequest(request))
        .catch((error) => logger.warn(`wsl-remote: dsh-harness request for ${request.distro}:${request.path} failed: ${error.message}`));
    }
  };
  // fs.watch on Windows misses writes made through the WSL 9P/drvfs bridge now and then; the poll covers that.
  let watcher;
  try {
    watcher = watch(dir, { persistent: false }, scan);
    watcher.on('error', () => {});
  } catch {}
  const timer = setInterval(scan, POLL_MS);
  timer.unref?.();
  scan();
  return () => {
    closed = true;
    clearInterval(timer);
    watcher?.close();
  };
}
