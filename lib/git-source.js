/**
 * A plugin installed from a local folder can still reach another host when
 * that folder is a git checkout whose commit is on a remote: the target then
 * installs the same commit from git. The folder is inspected on the host it
 * lives on (Windows, a WSL distribution or an SSH server) with that host's git.
 *
 *   repository root only        a package in a subfolder of a repository is not handled
 *   HEAD on a remote branch     installs HEAD
 *   HEAD not pushed             installs the newest pushed ancestor on its upstream, and says so
 *   uncommitted changes         not included, and said so
 *
 * The install spec pins the commit (`#<sha>`), so the target gets exactly
 * what was pushed, whatever the branch does later.
 */

/** GitHub remotes in any of their spellings: scp-like, ssh:// or https://. */
const GITHUB = /^(?:git@github\.com:|(?:git\+)?ssh:\/\/git@github\.com\/|(?:git\+)?https?:\/\/(?:[^@/]*@)?github\.com\/)([^/\s]+)\/([^/\s#]+?)(?:\.git)?\/?$/i;
const SCP_LIKE = /^([^@/:\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;

/**
 * The spec pnpm installs `commit` of a git remote with, or undefined for a
 * remote other hosts cannot use (a local path, an unknown scheme).
 * @param {string} url - `git remote get-url` output.
 * @param {string} commit - full commit id.
 */
export function gitInstallSpec(url, commit) {
  const remote = String(url ?? '').trim();
  if (!remote || !/^[0-9a-f]{7,64}$/i.test(commit)) return undefined;
  const github = GITHUB.exec(remote);
  if (github !== null) return `github:${github[1]}/${github[2]}#${commit}`;
  if (/^(?:git\+)?ssh:\/\//i.test(remote)) return `${remote.replace(/^(?:git\+)?/i, 'git+')}#${commit}`;
  if (/^(?:git\+)?https?:\/\//i.test(remote)) {
    // Never pass a token or password in the URL on to another host.
    const plain = remote.replace(/^(?:git\+)?(https?:\/\/)[^/]*@/i, '$1').replace(/^(?:git\+)?/i, 'git+');
    return `${plain}#${commit}`;
  }
  if (/^git:\/\//i.test(remote)) return `${remote}#${commit}`;
  // `user@host:path`, but not a Windows drive path such as `C:\repo`.
  const scp = SCP_LIKE.exec(remote);
  if (scp !== null && !/^[A-Za-z]$/.test(scp[2])) return `git+ssh://${scp[1] ?? ''}${scp[2]}/${scp[3].replace(/^\//, '')}#${commit}`;
  return undefined;
}

/** Same folder, whatever the slashes, trailing separator or (on Windows) letter case. */
function sameFolder(a, b, windows) {
  const norm = (path) => {
    const value = String(path).trim().replace(/\\/g, '/').replace(/\/+$/, '');
    return windows ? value.toLowerCase() : value;
  };
  return norm(a) === norm(b);
}

/**
 * Inspect `dir` with `git` on its host.
 * @param {(args: string[]) => Promise<{ code: number | null, stdout: string }>} git - runs `git <args>` on the folder's host.
 * @param {string} dir - the folder as that host spells it.
 * @param {{ windows?: boolean }} [options]
 * @returns {Promise<{ ok: true, spec: string, commit: string, remote: string, dirty: boolean, unpushed: number }
 *   | { ok: false, reason: 'not-git' | 'git-subfolder' | 'git-unpushed' | 'git-remote' }>}
 */
export async function inspectGitSource(git, dir, { windows = false } = {}) {
  const out = async (...args) => {
    try {
      const result = await git(['-C', dir, ...args]);
      return result.code === 0 ? String(result.stdout).trim() : undefined;
    } catch {
      return undefined;
    }
  };
  const top = await out('rev-parse', '--show-toplevel');
  if (!top) return { ok: false, reason: 'not-git' };
  if (!sameFolder(top, dir, windows)) return { ok: false, reason: 'git-subfolder' };
  const [head, containing, upstream, status] = await Promise.all([
    out('rev-parse', 'HEAD'),
    out('branch', '-r', '--contains', 'HEAD', '--format=%(refname:short)'),
    out('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'),
    out('status', '--porcelain', '--untracked-files=no'),
  ]);
  if (!head) return { ok: false, reason: 'not-git' };
  const branches = (containing ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.endsWith('/HEAD'));
  let commit = head;
  let unpushed = 0;
  let ref = branches.find((name) => name === upstream) ?? branches[0];
  if (ref === undefined) {
    // HEAD itself is local only: fall back to what the upstream branch already has.
    if (!upstream) return { ok: false, reason: 'git-unpushed' };
    const base = await out('merge-base', 'HEAD', '@{u}');
    if (!base) return { ok: false, reason: 'git-unpushed' };
    commit = base;
    unpushed = Number(await out('rev-list', '--count', `${base}..HEAD`)) || 0;
    ref = upstream;
  }
  const remoteName = ref.split('/', 1)[0];
  const url = await out('remote', 'get-url', remoteName);
  const spec = url ? gitInstallSpec(url, commit) : undefined;
  if (spec === undefined) return { ok: false, reason: 'git-remote' };
  return { ok: true, spec, commit, remote: spec.replace(/#.*$/, ''), dirty: Boolean(status), unpushed };
}
