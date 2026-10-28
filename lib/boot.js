/**
 * Startup execution environment shared by the bundle patch and the plugin.
 *
 * The bundle patch decides, while the Loader mounts rows, whether the Windows
 * or the WSL execution providers start. Its `!!js` expressions run
 * `MODE_EXPRESSION`, which reads `<DSH home>/wsl-remote.json` once and caches
 * the answer on `globalThis.__dshWslRemote`; `startupState()` reads the same
 * cache, so the plugin always reports what this process actually runs.
 * Writing the file only affects the next start.
 *
 * File: { environment, node?, serverDir?, shells?: { <distro>: <path> } }.
 * WSL mode needs environment, node and serverDir together; they are written
 * only after the Linux runtime deployed successfully.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const KEY = '__dshWslRemote';
const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// No backslashes: the expression below is embedded verbatim in the YAML patch.
const LINUX_PATH = /^[/][A-Za-z0-9._/+@-]{0,1023}$/;

export const isDistro = (value) => typeof value === 'string' && DISTRO.test(value);
export const isLinuxPath = (value) => typeof value === 'string' && LINUX_PATH.test(value);

/** Same home resolution as the patch expression (DSH_HOME, else ~/.dsh). */
export function stateFile() {
  const configured = (process.env.DSH_HOME ?? '').trim();
  return join(configured || join(homedir(), '.dsh'), 'wsl-remote.json');
}

function normalize(value) {
  const source = value !== null && typeof value === 'object' ? value : {};
  const shells = {};
  if (source.shells !== null && typeof source.shells === 'object') {
    for (const [distro, path] of Object.entries(source.shells)) if (isDistro(distro) && isLinuxPath(path)) shells[distro] = path;
  }
  return {
    environment: isDistro(source.environment) ? source.environment : '',
    ...(isLinuxPath(source.node) ? { node: source.node } : {}),
    ...(isLinuxPath(source.serverDir) ? { serverDir: source.serverDir } : {}),
    shells,
  };
}

/** What the next start will use. */
export function readState() {
  try {
    return normalize(JSON.parse(readFileSync(stateFile(), 'utf8')));
  } catch {
    return normalize(undefined);
  }
}

/** Atomically replace the file. */
export function writeState(state) {
  const file = stateFile();
  const value = normalize(state);
  if (value.environment === '' && Object.keys(value.shells).length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}

/**
 * Self-contained Loader expression: the active distribution or ''.
 * It uses no backslashes, so it embeds as a plain JSON/YAML string.
 */
export const MODE_EXPRESSION = `((globalThis.${KEY} ??= (() => {
  try {
    if (process.platform !== 'win32') return {};
    const fs = process.getBuiltinModule('node:fs');
    const os = process.getBuiltinModule('node:os');
    const path = process.getBuiltinModule('node:path');
    const home = (process.env.DSH_HOME ?? '').trim() || path.join(os.homedir(), '.dsh');
    const s = JSON.parse(fs.readFileSync(path.join(home, 'wsl-remote.json'), 'utf8'));
    const ok = (v) => typeof v === 'string' && ${LINUX_PATH}.test(v);
    if (typeof s.environment !== 'string' || !${DISTRO}.test(s.environment) || !ok(s.node) || !ok(s.serverDir)) return {};
    const shell = s.shells && ok(s.shells[s.environment]) ? s.shells[s.environment] : undefined;
    return { active: s.environment, node: s.node, serverDir: s.serverDir, shell };
  } catch {
    return {};
  }
})()).active || '')`.replace(/\s*\n\s*/g, ' ');

/** The environment this process started with. */
export function startupState() {
  if (globalThis[KEY] === undefined) {
    // eslint-disable-next-line no-new-func
    new Function(`return ${MODE_EXPRESSION}`)();
  }
  const cached = globalThis[KEY] ?? {};
  return {
    active: isDistro(cached.active) ? cached.active : '',
    node: cached.node,
    serverDir: cached.serverDir,
    shell: isLinuxPath(cached.shell) ? cached.shell : undefined,
  };
}
