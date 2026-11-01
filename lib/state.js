/**
 * Persistent settings of the WSL remote connections, in
 * `<DSH home>/wsl-remote.json`.
 *
 * Version 2: { version: 2, shareLogin, profile, autoConnect: [distro],
 * ports: { <distro>: <Windows relay port> } }. A stable relay port keeps the
 * WSL dsh browser cookie (bound to host:port) valid across reconnects.
 * A version-1 file (the retired "execution environment" mode that swapped the
 * Host's execution providers at startup) is migrated one way: its fields are
 * dropped and the defaults written, like Codex turning `runCodexInWsl` off
 * once WSL remote connections are adopted.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isHostId, isSshDest } from './transport.js';

const DISTRO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const isDistro = (value) => typeof value === 'string' && DISTRO.test(value);
export const isProfile = (value) => typeof value === 'string' && PROFILE.test(value);

/** `sshHosts` lists SSH destinations the user added; their host ids (`ssh:<dest>`) key autoConnect and ports like distributions. */
export const DEFAULT_SETTINGS = Object.freeze({ version: 2, shareLogin: true, profile: 'web', autoConnect: [], ports: {}, workspaceOrder: [], sshHosts: [] });

/** DSH_HOME, else ~/.dsh. */
export function stateFile() {
  const configured = (process.env.DSH_HOME ?? '').trim();
  return join(configured || join(homedir(), '.dsh'), 'wsl-remote.json');
}

export function normalizeSettings(value) {
  const source = value !== null && typeof value === 'object' && value.version === 2 ? value : {};
  const ports = {};
  if (source.ports !== null && typeof source.ports === 'object') {
    for (const [host, port] of Object.entries(source.ports)) if (isHostId(host) && Number.isInteger(port) && port > 1023 && port < 65536) ports[host] = port;
  }
  return {
    ports,
    version: 2,
    shareLogin: typeof source.shareLogin === 'boolean' ? source.shareLogin : DEFAULT_SETTINGS.shareLogin,
    profile: isProfile(source.profile) ? source.profile : DEFAULT_SETTINGS.profile,
    autoConnect: Array.isArray(source.autoConnect) ? [...new Set(source.autoConnect.filter(isHostId))] : [],
    // Sidebar order of the merged Windows + remote workspaces (ids of any host).
    workspaceOrder: Array.isArray(source.workspaceOrder) ? [...new Set(source.workspaceOrder.filter((id) => typeof id === 'string' && id.length > 0 && id.length < 200))] : [],
    sshHosts: Array.isArray(source.sshHosts) ? [...new Set(source.sshHosts.filter(isSshDest))] : [],
  };
}

export function writeSettings(settings, file = stateFile()) {
  const value = normalizeSettings({ ...settings, version: 2 });
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return value;
}

/**
 * Read the settings, migrating a version-1 file in place.
 * @returns {{ settings: object, migrated: boolean }}
 */
export function loadSettings(file = stateFile()) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { settings: normalizeSettings(undefined), migrated: false };
  }
  if (raw !== null && typeof raw === 'object' && raw.version === 2) return { settings: normalizeSettings(raw), migrated: false };
  return { settings: writeSettings(DEFAULT_SETTINGS, file), migrated: true };
}
