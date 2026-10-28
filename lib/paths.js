/**
 * Windows <-> WSL path translation for one distribution.
 *
 * The Windows Host keeps Session working directories in Windows spelling
 * (`\\wsl.localhost\<distro>\home\me\repo`, `C:\work`). The Linux helper only
 * accepts POSIX paths, so every path that crosses into WSL is translated here.
 */

const UNC = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;
const DRIVE = /^([A-Za-z]):(?:[\\/](.*))?$/;

/**
 * Create a translator bound to one distribution.
 * @param {string} distro - WSL distribution name.
 * @param {string} [mountRoot] - automount root, `/mnt/` by default.
 */
export function createPathMapper(distro, mountRoot = '/mnt/') {
  const root = mountRoot.endsWith('/') ? mountRoot : `${mountRoot}/`;
  const wanted = distro.toLowerCase();

  /** Whether a value is an absolute Windows path that this mapper can translate. */
  function isWindowsAbsolute(value) {
    if (typeof value !== 'string') return false;
    const unc = UNC.exec(value);
    if (unc) return unc[1].toLowerCase() === wanted;
    return DRIVE.test(value) && (value.length === 2 || value[2] === '\\' || value[2] === '/');
  }

  /**
   * Translate one path into the distribution's POSIX namespace.
   * POSIX paths are returned unchanged; other distributions' UNC paths too.
   * @param {string} value
   * @returns {string}
   */
  function toLinux(value) {
    if (typeof value !== 'string' || value.length === 0) return value;
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    const unc = UNC.exec(value);
    if (unc) {
      if (unc[1].toLowerCase() !== wanted) return value;
      const rest = (unc[2] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
      return `/${rest}`;
    }
    const drive = DRIVE.exec(value);
    if (drive && (value.length === 2 || value[2] === '\\' || value[2] === '/')) {
      const rest = (drive[2] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
      return `${root}${drive[1].toLowerCase()}${rest ? `/${rest}` : ''}`;
    }
    return value.includes('\\') ? value.replace(/\\/g, '/') : value;
  }

  /** Translate a resolved sandbox policy's workspace root. */
  function policy(value) {
    if (value === undefined) return value;
    return { ...value, workspaceRoot: toLinux(value.workspaceRoot) };
  }

  /** Windows UNC spelling of a POSIX path inside this distribution. */
  function toWindows(value) {
    if (typeof value !== 'string' || !value.startsWith('/')) return value;
    return `\\\\wsl.localhost\\${distro}${value.replace(/\//g, '\\')}`;
  }

  return { distro, toLinux, toWindows, policy, isWindowsAbsolute };
}
