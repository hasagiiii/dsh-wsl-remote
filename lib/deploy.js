/**
 * Deploy the Linux runtime into one distribution, the way VS Code installs its
 * WSL server: a versioned directory under the Linux home, created on first use.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runWsl } from './wsl.js';

/** Bump when anything under `server/` or `lib/mux.js` changes. */
export const SERVER_VERSION = '1.1.0+dsh-0.2.1-rc.3';
const MIN_NODE_MAJOR = 22;

const FILES = [
  ['server/package.json', 'package.json'],
  ['server/bridge.mjs', 'bridge.mjs'],
  ['lib/mux.js', 'mux.js'],
  ['server/helper/helper.js', 'helper/helper.js'],
  ['server/helper/protocol.js', 'helper/protocol.js'],
  ['server/helper/schemas.js', 'helper/schemas.js'],
  ['server/helper/stream-security-DJlQsPG-.js', 'helper/stream-security-DJlQsPG-.js'],
  ['server/helper/LICENSE', 'helper/LICENSE'],
  ['server/ptc/process.js', 'ptc/process.js'],
  ['server/ptc/LICENSE', 'ptc/LICENSE'],
];

const PROBE = String.raw`
s="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)"; [ -x "$s" ] || s=/bin/sh
printf 'home=%s\nuser=%s\nshell=%s\n' "$HOME" "$(id -un)" "$s"
n="$("$s" -ilc 'command -v node' 2>/dev/null </dev/null | tail -n 1)"
[ -n "$n" ] || n="$(command -v node 2>/dev/null)"
if [ -n "$n" ] && [ -x "$n" ]; then printf 'node=%s\nnodeVersion=%s\n' "$n" "$("$n" -v)"; fi
for c in bwrap rg; do printf '%s=%s\n' "$c" "$(command -v $c 2>/dev/null)"; done
printf 'shells='; grep -E '^/' /etc/shells 2>/dev/null | while read -r p; do [ -x "$p" ] && printf '%s:' "$p"; done; printf '\n'
`;

/** Read facts about one distribution (starts it if stopped). */
export async function probeDistro(distro, signal) {
  const result = await runWsl(['-d', distro, '--cd', '~', '-e', 'sh', '-s'], { input: PROBE, timeoutMs: 90000, signal });
  if (result.code !== 0) throw new Error(`Could not start ${distro}: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
  const facts = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) facts[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  const shells = new Map();
  for (const path of (facts.shells ?? '').split(':').filter(Boolean)) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (['rbash', 'screen', 'tmux', 'nologin', 'false', 'git-shell'].includes(name)) continue;
    if (!shells.has(name) || path.startsWith('/usr/bin/')) shells.set(name, path);
  }
  const major = Number(/^v(\d+)/.exec(facts.nodeVersion ?? '')?.[1]);
  return {
    home: facts.home,
    user: facts.user,
    loginShell: facts.shell,
    node: facts.node || undefined,
    nodeVersion: facts.nodeVersion || undefined,
    nodeSupported: Number.isFinite(major) && major >= MIN_NODE_MAJOR,
    bwrap: Boolean(facts.bwrap),
    shells: [...shells.entries()].map(([name, path]) => ({ name, path })),
  };
}

/** Linux directory of the deployed runtime. */
export function serverDir(home) {
  return `${home}/.dsh-wsl-remote/server/${SERVER_VERSION}`;
}

/**
 * Make sure the versioned runtime exists, copying files and running `npm install`
 * inside the distribution when it does not.
 * @returns {Promise<{ dir: string, installed: boolean }>}
 */
export async function ensureServer(packageDir, distro, facts, signal, log = () => {}) {
  if (!facts.node || !facts.nodeSupported) {
    throw new Error(`${distro} needs Node.js ${MIN_NODE_MAJOR}+ on the login PATH (found ${facts.nodeVersion ?? 'none'}).`);
  }
  const dir = serverDir(facts.home);
  const ready = await runWsl(['-d', distro, '-e', 'test', '-f', `${dir}/.ready`], { timeoutMs: 30000, signal });
  if (ready.code === 0) return { dir, installed: false };

  log(`deploying WSL runtime ${SERVER_VERSION} to ${distro}:${dir}`);
  const staging = `${dir}.partial`;
  await runWsl(['-d', distro, '-e', 'rm', '-rf', staging], { timeoutMs: 30000, signal });
  for (const [from, to] of FILES) {
    const content = await readFile(join(packageDir, from));
    const target = `${staging}/${to}`;
    const write = await runWsl(['-d', distro, '-e', 'sh', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'sh', target], {
      input: content,
      timeoutMs: 30000,
      signal,
    });
    if (write.code !== 0) throw new Error(`Could not write ${target}: ${write.stderr.trim()}`);
  }
  const nodeDir = facts.node.slice(0, facts.node.lastIndexOf('/'));
  const install = await runWsl(
    ['-d', distro, '--cd', staging, '-e', 'env', `PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`, 'npm', 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
    { timeoutMs: 10 * 60 * 1000, signal },
  );
  if (install.code !== 0) throw new Error(`npm install failed in ${distro}: ${(install.stderr || install.stdout).trim().split('\n').slice(-6).join(' | ')}`);
  const publish = await runWsl(
    ['-d', distro, '-e', 'sh', '-c', 'rm -rf "$2" && mv "$1" "$2" && : > "$2/.ready"', 'sh', staging, dir],
    { timeoutMs: 30000, signal },
  );
  if (publish.code !== 0) throw new Error(`Could not publish ${dir}: ${publish.stderr.trim()}`);
  log(`WSL runtime ready in ${distro}`);
  return { dir, installed: true };
}
