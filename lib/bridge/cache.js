/** Small, profile-scoped sidebar hints; never Session history or full projections. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateFile } from '../state.js';
import { isHostId } from '../transport.js';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';
const isId = (value) => isString(value) && value.length > 0 && !value.includes('\0');
const isTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const ids = (value) => [...new Set(value.filter(isId))];

/** Keep this beside the connection settings, respecting DSH_HOME in stateFile(). */
export function bridgeCacheFile() {
  return join(dirname(stateFile()), 'wsl-remote-cache.json');
}

function workspaceItem(value) {
  if (!isRecord(value) || !isId(value.workspaceId) || !isId(value.path)
    || !isString(value.title) || !Array.isArray(value.sessionIds)
    || !isId(value.createdAt) || !isId(value.updatedAt)) return undefined;
  return {
    workspaceId: value.workspaceId,
    path: value.path,
    title: value.title,
    sessionIds: ids(value.sessionIds),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function workspace(value) {
  if (!isRecord(value) || !Array.isArray(value.items)
    || !Array.isArray(value.archivedSessionIds) || !Array.isArray(value.pinnedSessionIds)) return undefined;
  return {
    items: value.items.map(workspaceItem).filter((item) => item !== undefined),
    archivedSessionIds: ids(value.archivedSessionIds),
    pinnedSessionIds: ids(value.pinnedSessionIds),
  };
}

function projections(value) {
  if (!isRecord(value) || !isRecord(value.values)) return undefined;
  const values = {};
  for (const key of ['title', 'workingDirectory', 'agentPreset']) {
    const item = value.values[key];
    if (item === null || isString(item)) values[key] = item;
  }
  const metadata = value.values.sessionListMetadata;
  if (isRecord(metadata) && typeof metadata.blank === 'boolean'
    && (metadata.lastPromptAt === null || isTime(metadata.lastPromptAt))) {
    values.sessionListMetadata = { blank: metadata.blank, lastPromptAt: metadata.lastPromptAt };
  }
  // A saved watermark belongs to an old connection. It must not suppress live frames.
  return { kind: 'cached', asOfSeq: 0, values };
}

function summary(value) {
  if (!isRecord(value) || !isId(value.sessionId) || !isTime(value.updatedAt)
    || typeof value.blank !== 'boolean') return undefined;
  const result = {
    sessionId: value.sessionId,
    updatedAt: value.updatedAt,
    agentAvailable: false,
    running: false,
    blank: value.blank,
  };
  if (isId(value.parentSessionId)) result.parentSessionId = value.parentSessionId;
  if (value.origin === 'subagent') result.origin = value.origin;
  if (isString(value.cwd)) result.cwd = value.cwd;
  if (value.formatStatus === 'current' || value.formatStatus === 'migration-required') result.formatStatus = value.formatStatus;
  const hints = projections(value.projections);
  if (hints !== undefined) result.projections = hints;
  return result;
}

function normalizeHosts(value) {
  if (!isRecord(value)) return {};
  const hosts = [];
  for (const [distro, source] of Object.entries(value)) {
    if (!isHostId(distro) || !isRecord(source)) continue;
    const host = {};
    const state = workspace(source.workspace);
    if (state !== undefined) host.workspace = state;
    // Omitted means no complete list was received; [] means the host is known empty.
    if (Array.isArray(source.sessions)) host.sessions = source.sessions.map(summary).filter((item) => item !== undefined);
    hosts.push([distro, host]);
  }
  // fromEntries also handles valid distro names such as "constructor" safely.
  return Object.fromEntries(hosts);
}

/** Synchronously read expendable metadata. Missing, corrupt and other-profile files are cache misses. */
export function loadBridgeCache(profile, file = bridgeCacheFile()) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof profile !== 'string' || !isRecord(value) || value.version !== 1
      || value.profile !== profile || !isRecord(value.hosts)) return {};
    return normalizeHosts(value.hosts);
  } catch {
    return {};
  }
}

/** Atomically replace the metadata snapshot and return the sanitized, offline hosts. I/O errors propagate. */
export function writeBridgeCache(profile, hosts, file = bridgeCacheFile()) {
  if (typeof profile !== 'string') throw new TypeError('Bridge cache profile must be a string');
  const normalized = normalizeHosts(hosts);
  const text = `${JSON.stringify({ version: 1, profile, hosts: normalized }, null, 2)}\n`;
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return normalized;
}
