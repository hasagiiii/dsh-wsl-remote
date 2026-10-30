/**
 * Route one execution-world call to Windows or to a WSL distribution.
 *
 * DeepSeek Harness mounts exactly one `ctx.shell` / `ctx.fs` /
 * `ctx.subprocess` / `ctx.sandbox` per composition, but every tool call
 * carries its Session's working directory (shell `workdir`, fs `cwd` or an
 * absolute path, subprocess `cwd`, sandbox policy `workspaceRoot` from the
 * Session header). A WSL workspace's directory is the UNC path
 * `\\wsl.localhost\<distro>\…`, so the path alone names the execution world.
 *
 * Linux absolute paths (`/home/me/x`) only mean something inside a WSL
 * Session; they are routed to the distribution of the call's `cwd`.
 */

const UNC = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/]|$)/i;
const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The distribution a `\\wsl.localhost\<distro>\…` (or `\\wsl$\…`) path lives in, else undefined. */
export function distroOf(path) {
  if (typeof path !== 'string') return undefined;
  const match = UNC.exec(path);
  return match !== null && DISTRO.test(match[1]) ? match[1] : undefined;
}

/** Whether a value is a POSIX absolute path (not a `//server` UNC spelling). */
export function isLinuxAbsolute(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
}

/**
 * Pick the world for a path resolved against `cwd`: an explicit UNC path wins,
 * then the cwd's world; a Linux absolute path without a WSL cwd stays Windows
 * (Windows treats it as drive-relative, which is what the shipped tools did).
 * @returns {string | undefined} the distribution, or undefined for Windows.
 */
export function worldOf(path, cwd) {
  const direct = distroOf(path);
  if (direct !== undefined) return direct;
  if (typeof path === 'string' && /^[A-Za-z]:[\\/]/.test(path)) return undefined;
  return distroOf(cwd);
}
