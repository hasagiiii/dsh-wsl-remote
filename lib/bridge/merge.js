/**
 * Pure helpers of the Windows/WSL merge: which host a Remote call belongs
 * to, how WSL values are presented on Windows (Linux paths as
 * `\\wsl.localhost\<distro>\…`), and how the per-host workspace states,
 * session lists, catalogs and archive sets combine into the one view the
 * DeepSeek Harness client sees. No I/O here; everything is unit tested.
 */
import { fromUncPath, toUncPath } from '../linux-fs.js';

export const WINDOWS = 'windows';

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isLinuxPath = (value) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');

/** `\\wsl.localhost\<distro>\…` for a Linux path of that distribution; other values unchanged. */
export function displayPath(distro, path) {
  return isLinuxPath(path) ? toUncPath(distro, path) : path;
}

/** The distribution and Linux path behind a `\\wsl.localhost\…` path, else undefined. */
export const wslPathOf = (path) => (typeof path === 'string' ? fromUncPath(path) : undefined);

/** Every Session (or Agent, or workspace-file scope) identity a Remote call's wire args name. */
export function sessionHints(args) {
  const ids = [];
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0 && !ids.includes(value)) ids.push(value);
  };
  if (!isRecord(args)) return ids;
  for (const key of ['agentId', 'workspaceFileScopeId', 'sessionId', 'parentSessionId', 'childSessionId']) add(args[key]);
  const request = args.request;
  if (isRecord(request)) {
    for (const key of ['sessionId', 'parentSessionId', 'childSessionId']) add(request[key]);
    if (isRecord(request.address)) for (const key of ['sessionId', 'parentSessionId', 'childSessionId']) add(request.address[key]);
  }
  return ids;
}

/** Remote error codes meaning "this Host does not know that Session", worth asking the other hosts. */
export const NOT_FOUND_CODES = new Set(['session/not-found', 'gateway/lookup-not-found', 'gateway/context-not-found', 'workspace/unknown-session']);

/**
 * Split byte values out of a Remote result, as the Host Gateway does before
 * the Connection writes multipart parts: each Uint8Array becomes null at its
 * path and travels as an attachment.
 */
export function splitBytes(input) {
  const attachments = [];
  const path = [];
  const walk = (value) => {
    if (value instanceof Uint8Array) {
      attachments.push({ path: [...path], bytes: value });
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => {
        path.push(index);
        const out = walk(item);
        path.pop();
        return out;
      });
    }
    if (isRecord(value)) {
      const out = {};
      for (const key of Object.keys(value)) {
        path.push(key);
        out[key] = walk(value[key]);
        path.pop();
      }
      return out;
    }
    return value;
  };
  const value = walk(input);
  return attachments.length === 0 ? { value } : { value, attachments };
}

// ---------------------------------------------------------------------------
// Workspace follow state (one per host), and the merged view.
// ---------------------------------------------------------------------------

export function emptyWorkspaceState() {
  return { items: [], archivedSessionIds: [], pinnedSessionIds: [] };
}

/** Apply one `workspace/follow` frame of one host. */
export function applyWorkspaceFrame(state, frame) {
  switch (frame?.type) {
    case 'baseline':
    case 'replace':
      return {
        items: [...(frame.value?.items ?? [])],
        archivedSessionIds: [...(frame.value?.archivedSessionIds ?? [])],
        pinnedSessionIds: [...(frame.value?.pinnedSessionIds ?? [])],
      };
    case 'upsert': {
      const items = [...state.items];
      const index = items.findIndex((item) => item.workspaceId === frame.workspace.workspaceId);
      if (index >= 0) items[index] = frame.workspace;
      else items.push(frame.workspace);
      return { ...state, items };
    }
    case 'remove':
      return { ...state, items: state.items.filter((item) => item.workspaceId !== frame.workspaceId) };
    case 'order': {
      const byId = new Map(state.items.map((item) => [item.workspaceId, item]));
      const ordered = frame.workspaceIds.map((id) => byId.get(id)).filter(Boolean);
      const rest = state.items.filter((item) => !frame.workspaceIds.includes(item.workspaceId));
      return { ...state, items: [...ordered, ...rest] };
    }
    case 'archived':
      return { ...state, archivedSessionIds: [...frame.archivedSessionIds] };
    case 'pinned':
      return { ...state, pinnedSessionIds: [...frame.pinnedSessionIds] };
    default:
      return state;
  }
}

const union = (...lists) => [...new Set(lists.flat())];
const workspaceKey = (distro, linuxPath) => `${distro.toLowerCase()}|${linuxPath}`;

/**
 * Combine the Windows workspace state with each distribution's.
 *
 * A Windows workspace whose path is `\\wsl.localhost\<distro>\<path>` (made
 * by the earlier WSL-workspace mode) and a WSL workspace of the same folder
 * are one row: it keeps the Windows id, so the client's selection survives,
 * and lists both hosts' sessions; workspace operations on it go to WSL.
 *
 * @param {{ windows: object, hosts: { distro: string, state: object }[], order?: string[] }} input
 * @returns {{ baseline: object, owners: Map<string, { host: string, id: string, legacy?: string }>, order: string[] }}
 */
export function mergeWorkspaces({ windows, hosts, order = [] }) {
  const owners = new Map();
  const wsl = new Map();
  for (const { distro, state } of hosts) {
    for (const item of state.items) wsl.set(workspaceKey(distro, item.path), { distro, item });
  }
  const used = new Set();
  const views = [];
  for (const item of windows.items) {
    const legacy = wslPathOf(item.path);
    const match = legacy === undefined ? undefined : wsl.get(workspaceKey(legacy.distro, legacy.path));
    if (match === undefined) {
      owners.set(item.workspaceId, { host: WINDOWS, id: item.workspaceId });
      views.push(item);
      continue;
    }
    used.add(match.item.workspaceId);
    owners.set(item.workspaceId, { host: match.distro, id: match.item.workspaceId, legacy: item.workspaceId });
    views.push({
      ...match.item,
      workspaceId: item.workspaceId,
      path: displayPath(match.distro, match.item.path),
      sessionIds: union(match.item.sessionIds, item.sessionIds),
      createdAt: item.createdAt < match.item.createdAt ? item.createdAt : match.item.createdAt,
      updatedAt: item.updatedAt > match.item.updatedAt ? item.updatedAt : match.item.updatedAt,
    });
  }
  for (const { distro, state } of hosts) {
    for (const item of state.items) {
      if (used.has(item.workspaceId) || owners.has(item.workspaceId)) continue;
      owners.set(item.workspaceId, { host: distro, id: item.workspaceId });
      views.push({ ...item, path: displayPath(distro, item.path) });
    }
  }
  const byId = new Map(views.map((view) => [view.workspaceId, view]));
  const ordered = order.filter((id) => byId.has(id));
  const mergedOrder = [...ordered, ...views.map((view) => view.workspaceId).filter((id) => !ordered.includes(id))];
  return {
    owners,
    order: mergedOrder,
    baseline: {
      items: mergedOrder.map((id) => byId.get(id)),
      archivedSessionIds: union(windows.archivedSessionIds, ...hosts.map((host) => host.state.archivedSessionIds)),
      pinnedSessionIds: union(windows.pinnedSessionIds, ...hosts.map((host) => host.state.pinnedSessionIds)),
    },
  };
}

/** Move one id DOM-insertBefore-like within an order (append without an anchor). */
export function insertBefore(order, id, beforeId) {
  const without = order.filter((item) => item !== id);
  const at = beforeId === undefined ? without.length : without.indexOf(beforeId);
  return [...without.slice(0, at < 0 ? without.length : at), id, ...without.slice(at < 0 ? without.length : at)];
}

// ---------------------------------------------------------------------------
// Sessions, catalogs, projections.
// ---------------------------------------------------------------------------

/** A WSL Session summary as the Windows client shows it (its directory as a `\\wsl.localhost` path). */
export function wslSummary(distro, summary) {
  return isRecord(summary) && isLinuxPath(summary.cwd) ? { ...summary, cwd: toUncPath(distro, summary.cwd) } : summary;
}

/** Union of model catalogs: the Windows default stays; providers of either side are offered. */
export function mergeModelCatalogs(windows, others) {
  const groups = new Map(windows.groups.map((group) => [group.id, { ...group, models: [...group.models] }]));
  for (const { catalog } of others) {
    for (const group of catalog.groups ?? []) {
      const existing = groups.get(group.id);
      if (existing === undefined) {
        groups.set(group.id, { ...group, models: [...group.models] });
        continue;
      }
      for (const model of group.models) if (!existing.models.some((item) => item.id === model.id)) existing.models.push(model);
    }
  }
  return {
    ...windows,
    routableProviders: union(windows.routableProviders, ...others.map(({ catalog }) => catalog.routableProviders ?? [])),
    groups: [...groups.values()],
    failures: [...windows.failures, ...others.flatMap(({ catalog }) => catalog.failures ?? [])],
  };
}

/** Frames carrying one `session/control` baseline into an already-open merged control stream. */
export function baselineFrames(baseline) {
  const frames = [];
  for (const [sessionId, entry] of Object.entries(baseline?.projections ?? {})) {
    for (const [key, value] of Object.entries(entry?.values ?? {})) {
      if (value === undefined) continue;
      frames.push({ type: 'projection', sessionId, key, value, seq: entry.asOfSeq });
    }
  }
  return frames;
}

/**
 * Rewrite the wire args of a call that goes to a distribution: merged
 * workspace ids become that host's ids, `\\wsl.localhost` paths become Linux paths.
 * @param {(workspaceId: string) => string | undefined} hostWorkspaceId
 */
export function toHostArgs(endpoint, args, hostWorkspaceId) {
  if (!isRecord(args) || !isRecord(args.request)) return args;
  const request = { ...args.request };
  for (const key of ['workspaceId', 'beforeWorkspaceId']) {
    if (typeof request[key] === 'string') request[key] = hostWorkspaceId(request[key]) ?? request[key];
  }
  for (const key of ['cwd', 'path']) {
    const linux = wslPathOf(request[key]);
    if (linux !== undefined && (endpoint === 'session/create' || endpoint === 'workspace/create')) request[key] = linux.path;
  }
  return { ...args, request };
}
