/**
 * The Windows/WSL merge. The Windows DeepSeek Harness client talks to one
 * Host; this bridge sits inside that Host's Gateway (it wraps the Gateway's
 * unary dispatch and stream opening, and the Connection's exact Fetch routes)
 * and sends every call that belongs to a WSL Session or WSL workspace to the
 * user's own dsh in that distribution, through the official DSH client
 * (host-client.js). Collections — the Session list, search, model catalog,
 * the workspace follow stream, the Session control stream and the
 * forwarded-event stream — are combined from all hosts.
 *
 * Nothing in the Windows composition is replaced: removing the bridge only
 * removes these wrappers.
 */
import { EventEmitter } from 'node:events';
import { HostClient } from './host-client.js';
import { toUncPath } from '../linux-fs.js';
import {
  WINDOWS,
  applyWorkspaceFrame,
  baselineFrames,
  displayPath,
  distroOfPath,
  emptyWorkspaceState,
  insertBefore,
  isLinuxPath,
  mergeWorkspaces,
  sessionHints,
  splitBytes,
  toHostArgs,
  wslPathOf,
  wslSummary,
} from './merge.js';

const ORIGINAL = Symbol.for('cordis.original');
const WRAPPED = Symbol.for('wsl-remote.wrapped-fetch');
/** How long a merged stream waits for a connected distribution's first state before opening without it. */
const BASELINE_WAIT_MS = 3000;
const RESTART_DELAY_MS = 2000;

/** WSL events the Windows client receives: Session-scoped ones. Host-global ones (settings, plugins…) stay in WSL. */
const FORWARDED_EVENTS = new Set([
  'agent-preset/selected',
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
  'commands/change',
  'goal/activation-changed',
  'schedule/changed',
]);

const ARCHIVE_ENDPOINTS = new Set(['workspace/archiveSession', 'workspace/unarchiveSession']);
const PIN_ENDPOINTS = new Set(['workspace/pinSession', 'workspace/unpinSession']);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const failure = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const union = (...lists) => [...new Set(lists.flat())];

function rpcFailure(error) {
  if (isRecord(error) && error.isDSHRemoteError === true && typeof error.code === 'string') return failure(error.code, error.message, isRecord(error.details) ? error.details : {});
  return failure('gateway/internal', error instanceof Error ? error.message : String(error));
}

const success = (value) => ({ ok: true, ...splitBytes(value) });

/** Pull-driven inbox shared by the pumps of one merged stream. */
class Inbox {
  items = [];
  wake = undefined;
  closed = false;

  push(item) {
    if (this.closed) return;
    this.items.push(item);
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  close() {
    this.closed = true;
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  /** The next item, or undefined once closed or aborted. */
  async next(signal) {
    while (this.items.length === 0) {
      if (this.closed || signal?.aborted) return undefined;
      await new Promise((resolve) => {
        this.wake = resolve;
        signal?.addEventListener('abort', resolve, { once: true });
      });
    }
    return this.items.shift();
  }
}

/** Feed one async iterator into an inbox as { tag, value } / { tag, end } / { tag, error }. */
function pump(iterator, inbox, tag) {
  (async () => {
    try {
      while (true) {
        const step = await iterator.next();
        if (step.done) {
          inbox.push({ tag, end: true });
          return;
        }
        inbox.push({ tag, value: step.value });
      }
    } catch (error) {
      inbox.push({ tag, error });
    }
  })();
}

const timeout = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

export class WslBridge extends EventEmitter {
  /**
   * @param {object} options
   * @param {object} options.hosts - distributions: { distros(), connected(d), url(d), ensure(d), subscribe(fn), loadOrder(), saveOrder(order) }.
   * @param {object} options.windows - this Host: { knows(sessionId): Promise<boolean>, workspaces(): object | undefined }.
   * @param {object} options.logger
   */
  constructor({ hosts, windows, logger }) {
    super();
    this.setMaxListeners(0);
    this.hosts = hosts;
    this.windows = windows;
    this.logger = logger;
    /** sessionId → WINDOWS or distribution. */
    this.sessionHosts = new Map();
    /** distribution → last workspace follow state (kept while disconnected). */
    this.workspaceStates = new Map();
    /** distribution → last Session list items (kept while disconnected). */
    this.sessionCache = new Map();
    /** distribution → Map(sessionId → { asOfSeq, values }). */
    this.projections = new Map();
    /** distribution → live connection entry. */
    this.live = new Map();
    /** Open merged `$events` streams of Windows windows. */
    this.eventStreams = new Set();
    /** Public waterfall id → pending WSL waterfall. */
    this.waterfalls = new Map();
    this.stopped = false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle of the per-distribution clients.
  // ---------------------------------------------------------------------------

  start() {
    this.offHosts = this.hosts.subscribe(() => this.sync());
    this.sync();
  }

  async stop() {
    this.stopped = true;
    this.offHosts?.();
    await Promise.all([...this.live.keys()].map((distro) => this.drop(distro)));
  }

  sync() {
    if (this.stopped) return;
    for (const distro of this.hosts.distros()) {
      const connected = this.hosts.connected(distro);
      const entry = this.live.get(distro);
      if (connected && entry === undefined) this.startHost(distro);
      else if (connected && entry !== undefined && entry.url !== this.hosts.url(distro)) this.drop(distro).then(() => this.sync());
      else if (!connected && entry !== undefined) this.drop(distro);
    }
  }

  startHost(distro) {
    const url = this.hosts.url(distro);
    const abort = new AbortController();
    const ready = {};
    const resolvers = {};
    for (const kind of ['workspace', 'control', 'events']) {
      const { promise, resolve } = Promise.withResolvers();
      ready[kind] = promise;
      resolvers[kind] = resolve;
    }
    const entry = { url, abort, ready, resolvers, eventClientId: undefined };
    entry.client = HostClient.open({ url }).then((client) => {
      if (abort.signal.aborted) {
        client.close();
        throw new Error('stopped');
      }
      this.logger.info(`wsl-remote: merged the dsh in ${distro} into this window`);
      this.runPump(distro, entry, client, 'workspace', () => this.followWorkspaces(distro, entry, client));
      this.runPump(distro, entry, client, 'control', () => this.followControl(distro, entry, client));
      this.runPump(distro, entry, client, 'events', () => this.followEvents(distro, entry, client));
      return client;
    });
    entry.client.catch((error) => {
      if (abort.signal.aborted) return;
      this.logger.warn(`wsl-remote: ${distro}: could not reach the WSL dsh API: ${error.message}`);
      this.restartLater(distro, entry);
    });
    this.live.set(distro, entry);
    return entry;
  }

  runPump(distro, entry, client, kind, body) {
    body().catch((error) => {
      if (entry.abort.signal.aborted) return;
      this.logger.warn(`wsl-remote: ${distro}: ${kind} stream ended: ${error?.message ?? error}`);
      this.restartLater(distro, entry);
    });
  }

  restartLater(distro, entry) {
    if (this.live.get(distro) !== entry) return;
    this.drop(distro).then(async () => {
      await timeout(RESTART_DELAY_MS);
      this.sync();
    });
  }

  async drop(distro) {
    const entry = this.live.get(distro);
    if (entry === undefined) return;
    this.live.delete(distro);
    entry.abort.abort(new Error(`${distro} disconnected`));
    for (const resolve of Object.values(entry.resolvers)) resolve();
    for (const [id, waterfall] of [...this.waterfalls]) if (waterfall.distro === distro) this.endWaterfall(id);
    try {
      (await entry.client)?.close();
    } catch {}
  }

  /** The client of a distribution, connecting it first when needed. */
  async client(distro) {
    await this.hosts.ensure(distro);
    let entry = this.live.get(distro);
    if (entry === undefined || entry.url !== this.hosts.url(distro)) {
      if (entry !== undefined) await this.drop(distro);
      entry = this.startHost(distro);
    }
    const client = await entry.client;
    if (client.broken) {
      await this.drop(distro);
      return (await this.startHost(distro).client);
    }
    return client;
  }

  /** Wait (bounded) until every connected distribution delivered its first `kind` state. */
  async hostsReady(kind) {
    const pending = [...this.live.values()].map((entry) => entry.ready[kind]);
    if (pending.length > 0) await Promise.race([Promise.all(pending), timeout(BASELINE_WAIT_MS)]);
  }

  // ---------------------------------------------------------------------------
  // Background streams per distribution.
  // ---------------------------------------------------------------------------

  async followWorkspaces(distro, entry, client) {
    for await (const frame of client.stream('workspace/follow', { args: {} }, entry.abort.signal)) {
      // Built on the shared state, so workspaces this bridge already learned
      // from a unary result (see adoptWorkspace) survive until the stream echoes them.
      const state = applyWorkspaceFrame(this.workspaceStates.get(distro) ?? emptyWorkspaceState(), frame);
      this.workspaceStates.set(distro, state);
      for (const item of state.items) for (const id of item.sessionIds) this.sessionHosts.set(id, distro);
      entry.resolvers.workspace();
      this.emit('workspace');
    }
    throw new Error('workspace/follow ended');
  }

  /**
   * A distribution returned a workspace from a unary call (create, rename,
   * move). Merge it into that host's state at once: the client acts on the
   * reply right away (it creates a session in a workspace it just added), and
   * the WSL follow stream may deliver the same change only later.
   */
  adoptWorkspace(distro, workspace) {
    if (!isRecord(workspace) || typeof workspace.workspaceId !== 'string') return;
    const state = applyWorkspaceFrame(this.workspaceStates.get(distro) ?? emptyWorkspaceState(), { type: 'upsert', workspace });
    this.workspaceStates.set(distro, state);
    for (const id of workspace.sessionIds ?? []) this.sessionHosts.set(id, distro);
    this.emit('workspace');
  }

  async followControl(distro, entry, client) {
    for await (const frame of client.stream('session/control', { args: {} }, entry.abort.signal)) {
      let cache = this.projections.get(distro);
      if (frame.type === 'baseline') {
        cache = new Map(Object.entries(frame.value?.projections ?? {}));
        this.projections.set(distro, cache);
        for (const id of cache.keys()) this.sessionHosts.set(id, distro);
        const frames = baselineFrames(frame.value);
        if (entry.controlStarted) for (const item of frames) this.emit('projection', item);
        entry.controlStarted = true;
        entry.resolvers.control();
        continue;
      }
      if (frame.type !== 'projection') continue;
      if (cache === undefined) {
        cache = new Map();
        this.projections.set(distro, cache);
      }
      const current = cache.get(frame.sessionId) ?? { asOfSeq: 0, values: {} };
      cache.set(frame.sessionId, { asOfSeq: Math.max(current.asOfSeq, frame.seq), values: { ...current.values, [frame.key]: frame.value } });
      this.sessionHosts.set(frame.sessionId, distro);
      this.emit('projection', frame);
    }
    throw new Error('session/control ended');
  }

  async followEvents(distro, entry, client) {
    for await (const value of client.stream('$events', { args: {} }, entry.abort.signal)) {
      if (entry.eventClientId === undefined) {
        if (value?.type !== 'ready') throw new Error('the WSL event stream did not start with ready');
        entry.eventClientId = value.clientId;
        entry.resolvers.events();
        continue;
      }
      this.receiveEvent(distro, value);
    }
    throw new Error('$events ended');
  }

  receiveEvent(distro, frame) {
    if (frame?.type === 'emit') {
      // A distribution's plugin installs report progress here; the WSL plugins panel reads it by request id.
      if (frame.event === 'plugin-manager/install-log' || frame.event === 'plugin-manager/install-state') {
        this.emit('plugin-install', { distro, event: frame.event, value: frame.args?.[0] });
        return;
      }
      if (!FORWARDED_EVENTS.has(frame.event)) return;
      let args = frame.args;
      if (frame.event === 'api-session/added' && isRecord(args[0])) {
        this.sessionHosts.set(args[0].sessionId, distro);
        args = [wslSummary(distro, args[0]), ...args.slice(1)];
      } else if (frame.event.startsWith('api-session/') && typeof args[0] === 'string') {
        this.sessionHosts.set(args[0], distro);
      }
      this.broadcast({ type: 'emit', event: frame.event, args });
      return;
    }
    if (frame?.type === 'waterfall') {
      const id = `wsl:${distro}:${frame.eventId}`;
      const waterfall = { distro, eventId: frame.eventId, frame: { ...frame, eventId: id }, deliveries: new Set() };
      this.waterfalls.set(id, waterfall);
      for (const stream of this.eventStreams) this.deliver(waterfall, stream);
      return;
    }
    if (frame?.type === 'cancel') this.endWaterfall(`wsl:${distro}:${frame.eventId}`);
  }

  broadcast(frame) {
    for (const stream of this.eventStreams) stream.inbox.push({ tag: 'wsl', value: frame });
  }

  deliver(waterfall, stream) {
    waterfall.deliveries.add(stream);
    stream.inbox.push({ tag: 'wsl', value: waterfall.frame });
  }

  endWaterfall(id) {
    const waterfall = this.waterfalls.get(id);
    if (waterfall === undefined) return;
    this.waterfalls.delete(id);
    for (const stream of waterfall.deliveries) stream.inbox.push({ tag: 'wsl', value: { type: 'cancel', eventId: id } });
  }

  /** A Windows window answered a forwarded WSL waterfall through `$events/result`. */
  async answerWaterfall(result) {
    const waterfall = this.waterfalls.get(result.eventId);
    if (waterfall === undefined) return { ok: true, value: undefined };
    const stream = [...waterfall.deliveries].find((candidate) => candidate.clientId === result.clientId);
    if (stream !== undefined) waterfall.deliveries.delete(stream);
    const outcome = result.outcome;
    if (outcome?.kind === 'next' && waterfall.deliveries.size > 0) return { ok: true, value: undefined };
    this.waterfalls.delete(result.eventId);
    for (const other of waterfall.deliveries) other.inbox.push({ tag: 'wsl', value: { type: 'cancel', eventId: result.eventId } });
    await this.sendWaterfallResult(waterfall, outcome);
    return { ok: true, value: undefined };
  }

  async sendWaterfallResult(waterfall, outcome) {
    const entry = this.live.get(waterfall.distro);
    if (entry?.eventClientId === undefined) return;
    try {
      const client = await entry.client;
      const response = await client.call('$events/result', { args: { clientId: entry.eventClientId, eventId: waterfall.eventId, outcome } });
      if (!response.ok) this.logger.warn(`wsl-remote: ${waterfall.distro}: answer to ${waterfall.frame.event} was refused: ${response.error.message}`);
    } catch (error) {
      this.logger.warn(`wsl-remote: ${waterfall.distro}: could not answer ${waterfall.frame.event}: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Ownership.
  // ---------------------------------------------------------------------------

  isHost(distro) {
    return this.hosts.distros().some((name) => name.toLowerCase() === String(distro).toLowerCase());
  }

  hostName(distro) {
    return this.hosts.distros().find((name) => name.toLowerCase() === String(distro).toLowerCase()) ?? distro;
  }

  /** The distribution a Linux path belongs to: by its WSL workspace, else the only connected one. */
  hostOfPath(path) {
    const roots = [];
    for (const [distro, state] of this.workspaceStates) for (const item of state.items) roots.push({ distro, path: item.path });
    const connected = this.hosts.distros().filter((distro) => this.hosts.connected(distro));
    return distroOfPath(path, roots, connected);
  }

  /** Which host owns one of these Session ids. Unknown ids are asked of Windows, then of each connected distribution. */
  async ownerOf(ids) {
    for (const id of ids) {
      const known = this.sessionHosts.get(id);
      if (known !== undefined) return known;
    }
    for (const id of ids) {
      if (await this.windows.knows(id).catch(() => false)) {
        this.sessionHosts.set(id, WINDOWS);
        return WINDOWS;
      }
      for (const distro of this.hosts.distros()) {
        if (!this.hosts.connected(distro)) continue;
        try {
          const client = await this.client(distro);
          const found = await client.call('session/projections', { args: { request: { sessionId: id } } });
          if (found.ok && found.value !== null && found.value !== undefined) {
            this.sessionHosts.set(id, distro);
            return distro;
          }
        } catch {}
      }
    }
    return WINDOWS;
  }

  /** The Windows registry as a follow-state value (fresh for unary calls). */
  windowsWorkspaceState() {
    return this.windows.workspaces() ?? emptyWorkspaceState();
  }

  merged(windowsState = this.windowsWorkspaceState()) {
    const hosts = [...this.workspaceStates].map(([distro, state]) => ({ distro, state }));
    return mergeWorkspaces({ windows: windowsState, hosts, order: this.hosts.loadOrder() });
  }

  /** Merged workspace id → owning distribution, for the client's WSL badges. */
  workspaceHosts() {
    const out = {};
    for (const [id, owner] of this.merged().owners) if (owner.host !== WINDOWS) out[id] = owner.host;
    return out;
  }

  /** Map merged workspace ids to the ids `host` knows. */
  hostWorkspaceId(owners, host) {
    return (id) => {
      const owner = owners.get(id);
      if (owner === undefined) return undefined;
      if (owner.host === host) return owner.id;
      if (host === WINDOWS && owner.legacy !== undefined) return owner.legacy;
      return undefined;
    };
  }

  /** The merged id of a workspace view a distribution returned. */
  publicWorkspace(owners, distro, view) {
    if (!isRecord(view)) return view;
    let id = view.workspaceId;
    for (const [publicId, owner] of owners) if (owner.host === distro && owner.id === view.workspaceId) id = publicId;
    return { ...view, workspaceId: id, path: displayPath(distro, view.path) };
  }

  /** Convert `\\wsl.localhost\<distro>\…` strings of one distribution to Linux paths (deep, JSON values only). */
  linuxArgs(distro, value) {
    if (typeof value === 'string') {
      const unc = wslPathOf(value);
      return unc !== undefined && unc.distro.toLowerCase() === distro.toLowerCase() ? unc.path : value;
    }
    if (Array.isArray(value)) return value.map((item) => this.linuxArgs(distro, item));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.linuxArgs(distro, item)]));
    return value;
  }

  /**
   * Where one call goes.
   * @returns {Promise<{ host: string, args: object }>}
   */
  async route(endpoint, args) {
    const request = isRecord(args?.request) ? args.request : undefined;
    if (endpoint === 'workspace/create') {
      // From the WSL folder picker: `\\wsl.localhost\<distro>\…` names the distribution.
      const unc = wslPathOf(request?.path);
      if (unc !== undefined && this.isHost(unc.distro)) return { host: this.hostName(unc.distro), args };
      return { host: WINDOWS, args };
    }
    if (endpoint === 'session/create') {
      const { owners } = this.merged();
      const owner = request?.workspaceId === undefined ? undefined : owners.get(request.workspaceId);
      if (owner !== undefined && owner.host !== WINDOWS) return { host: owner.host, args };
      if (request?.workspaceId === undefined && isLinuxPath(request?.cwd)) {
        const distro = this.hostOfPath(request.cwd);
        if (distro !== undefined) return { host: distro, args };
      }
      const workspace = owner === undefined ? undefined : this.windowsWorkspaceState().items.find((item) => item.workspaceId === request.workspaceId);
      const unc = wslPathOf(request?.cwd) ?? wslPathOf(workspace?.path);
      if (unc !== undefined && this.isHost(unc.distro)) {
        // A WSL folder known only as a Windows workspace: register it in WSL, then create there.
        const distro = this.hostName(unc.distro);
        const client = await this.client(distro);
        const created = await client.call('workspace/create', { args: { request: { path: unc.path } } });
        if (!created.ok) throw Object.assign(new Error(created.error.message), { isDSHRemoteError: true, code: created.error.code, details: created.error.details });
        this.adoptWorkspace(distro, created.value.workspace);
        const { workspaceId: _drop, cwd: _cwd, ...rest } = request ?? {};
        return { host: distro, args: { ...args, request: { ...rest, workspaceId: created.value.workspace.workspaceId } }, raw: true };
      }
      return { host: WINDOWS, args };
    }
    if (endpoint.startsWith('workspace/') && request?.workspaceId !== undefined && request?.sessionId === undefined) {
      const owner = this.merged().owners.get(request.workspaceId);
      return { host: owner?.host ?? WINDOWS, args };
    }
    if (endpoint === 'session/openWorkspacePath' || endpoint === 'session/workspacePathApplications') {
      // Windows opens WSL files through \\wsl.localhost (9P).
      const distro = isLinuxPath(request?.path) ? this.hostOfPath(request.path) : undefined;
      if (distro !== undefined) return { host: WINDOWS, args: { ...args, request: { ...request, path: toUncPath(distro, request.path) } } };
      return { host: WINDOWS, args };
    }
    const hints = sessionHints(args);
    if (hints.length === 0) return { host: WINDOWS, args };
    return { host: await this.ownerOf(hints), args };
  }

  // ---------------------------------------------------------------------------
  // Unary calls.
  // ---------------------------------------------------------------------------

  /** The wrapped Gateway unary dispatch. `windows` runs the original. */
  async dispatchRpc(endpoint, payload, signal, peer, windows) {
    try {
      if (endpoint === '$events/result') {
        const result = payload?.args;
        if (typeof result?.eventId === 'string' && result.eventId.startsWith('wsl:')) return await this.answerWaterfall(result);
        return windows(endpoint, payload, signal, peer);
      }
      const args = isRecord(payload?.args) ? payload.args : {};
      switch (endpoint) {
        case 'session/list':
          return await this.mergedList(await windows(endpoint, payload, signal, peer), args, signal);
        case 'session/search':
          return await this.mergedSearch(await windows(endpoint, payload, signal, peer), args, signal);
        case 'workspace/insertBefore':
          return this.reorder(args);
        case 'workspace/delete':
          return await this.deleteWorkspace(args, payload, signal, peer, windows);
        default:
          break;
      }
      const route = await this.route(endpoint, args);
      let result;
      if (route.host === WINDOWS) {
        result = await windows(endpoint, route.args === args ? payload : { ...payload, args: route.args }, signal, peer);
        if (result.ok && (endpoint === 'session/create' || endpoint === 'session/fork') && isRecord(result.value)) this.sessionHosts.set(result.value.sessionId, WINDOWS);
      } else {
        result = await this.forward(route.host, endpoint, route.args, signal, route.raw === true);
      }
      if (result.ok && (ARCHIVE_ENDPOINTS.has(endpoint) || PIN_ENDPOINTS.has(endpoint))) return success(this.mergedSets(endpoint, route.host, result.value));
      return result;
    } catch (error) {
      return rpcFailure(error);
    }
  }

  /** One unary call in a distribution; results come back in the Windows spelling. */
  async forward(distro, endpoint, args, signal, raw = false) {
    const client = await this.client(distro);
    const owners = this.merged().owners;
    const hostArgs = raw ? args : toHostArgs(endpoint, this.linuxArgs(distro, args), this.hostWorkspaceId(owners, distro));
    const result = await client.call(endpoint, { args: hostArgs }, signal);
    if (!result.ok) return result;
    let value = result.value;
    if ((endpoint === 'session/create' || endpoint === 'session/fork') && isRecord(value)) this.sessionHosts.set(value.sessionId, distro);
    if (isRecord(value) && isRecord(value.workspace)) {
      this.adoptWorkspace(distro, value.workspace);
      value = { ...value, workspace: this.publicWorkspace(this.merged().owners, distro, value.workspace) };
    }
    if (endpoint === 'session/create' && isRecord(value) && isRecord(hostArgs?.request) && typeof hostArgs.request.workspaceId === 'string') {
      // The new session belongs to that workspace now; list it there before the stream says so.
      const state = this.workspaceStates.get(distro);
      const item = state?.items.find((entry) => entry.workspaceId === hostArgs.request.workspaceId);
      if (item !== undefined && !item.sessionIds.includes(value.sessionId)) this.adoptWorkspace(distro, { ...item, sessionIds: [...item.sessionIds, value.sessionId] });
    }
    return success(value);
  }

  mergedSets(endpoint, host, value) {
    const key = ARCHIVE_ENDPOINTS.has(endpoint) ? 'archivedSessionIds' : 'pinnedSessionIds';
    const own = Array.isArray(value?.[key]) ? value[key] : [];
    const others = [];
    if (host !== WINDOWS) others.push(this.windowsWorkspaceState()[key] ?? []);
    for (const [distro, state] of this.workspaceStates) if (distro !== host) others.push(state[key] ?? []);
    return { ...value, [key]: union(own, ...others) };
  }

  async mergedList(windowsResult, args, signal) {
    if (!windowsResult.ok) return windowsResult;
    const items = [...(windowsResult.value?.items ?? [])];
    for (const item of items) if (!this.sessionHosts.has(item.sessionId)) this.sessionHosts.set(item.sessionId, WINDOWS);
    await Promise.all(this.hosts.distros().map(async (distro) => {
      if (this.hosts.connected(distro)) {
        try {
          const client = await this.client(distro);
          const result = await client.call('session/list', { args }, signal);
          if (result.ok) this.sessionCache.set(distro, (result.value?.items ?? []).map((item) => wslSummary(distro, item)));
        } catch (error) {
          this.logger.warn(`wsl-remote: ${distro}: session list unavailable: ${error.message}`);
        }
      }
      for (const item of this.sessionCache.get(distro) ?? []) {
        this.sessionHosts.set(item.sessionId, distro);
        items.push(item);
      }
    }));
    return success({ ...windowsResult.value, items });
  }

  async mergedSearch(windowsResult, args, signal) {
    if (!windowsResult.ok) return windowsResult;
    let { items = [], hasMore = false } = windowsResult.value ?? {};
    items = [...items];
    await Promise.all([...this.live.keys()].map(async (distro) => {
      try {
        const client = await this.client(distro);
        const result = await client.call('session/search', { args }, signal);
        if (!result.ok) return;
        items.push(...(result.value?.items ?? []));
        hasMore ||= Boolean(result.value?.hasMore);
      } catch {}
    }));
    return success({ ...windowsResult.value, items, hasMore });
  }

  /**
   * One distribution's own model catalog. The window's catalog stays the
   * Windows one; the client shows this one in the model picker of that
   * distribution's sessions, so they only offer models their dsh can route.
   */
  async modelCatalog(distro, signal) {
    const client = await this.client(distro);
    const result = await client.call('session/modelCatalog', { args: {} }, signal);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
  }

  /** Workspace order across hosts is kept here; same-host moves are also applied on that host. */
  reorder(args) {
    const { workspaceId, beforeWorkspaceId } = args.request ?? {};
    const { order, owners } = this.merged();
    if (!order.includes(workspaceId) || (beforeWorkspaceId !== undefined && !order.includes(beforeWorkspaceId))) {
      return failure('workspace/order-invalid', `unknown workspace ${String(beforeWorkspaceId !== undefined && !order.includes(beforeWorkspaceId) ? beforeWorkspaceId : workspaceId)}`);
    }
    const next = insertBefore(order, workspaceId, beforeWorkspaceId);
    this.hosts.saveOrder(next);
    const owner = owners.get(workspaceId);
    if (owner?.host !== undefined && owner.host !== WINDOWS && (beforeWorkspaceId === undefined || owners.get(beforeWorkspaceId)?.host === owner.host)) {
      this.forward(owner.host, 'workspace/insertBefore', args).catch(() => {});
    }
    this.emit('workspace');
    return success({ workspaceIds: next });
  }

  async deleteWorkspace(args, payload, signal, peer, windows) {
    const id = args.request?.workspaceId;
    const owner = this.merged().owners.get(id);
    if (owner === undefined || owner.host === WINDOWS) return windows('workspace/delete', payload, signal, peer);
    const result = await this.forward(owner.host, 'workspace/delete', args, signal);
    if (result.ok && owner.legacy !== undefined) await windows('workspace/delete', payload, signal, peer);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Streams.
  // ---------------------------------------------------------------------------

  /** The wrapped Gateway stream opening. `windows` opens the original. */
  async openStream(endpoint, payload, uplink, peer, signal, windows) {
    if (endpoint === '$events') return this.mergedEvents(await windows(), signal);
    if (endpoint === 'workspace/follow') return this.mergedWorkspaceFollow(await windows(), signal);
    if (endpoint === 'session/control') return this.mergedControl(await windows(), signal);
    const args = isRecord(payload?.args) ? payload.args : {};
    const route = await this.route(endpoint, args);
    if (route.host === WINDOWS) return windows();
    const client = await this.client(route.host);
    const hostArgs = toHostArgs(endpoint, this.linuxArgs(route.host, route.args), this.hostWorkspaceId(this.merged().owners, route.host));
    const source = client.stream(endpoint, { args: hostArgs }, signal, uplink);
    return endpoint === 'session/follow' ? this.windowsHeaders(route.host, source) : source;
  }

  /** History snapshots name the Session directory as the Windows client knows it. */
  async *windowsHeaders(distro, source) {
    for await (const frame of source) {
      if (frame?.type === 'snapshot' && isRecord(frame.header) && isLinuxPath(frame.header.cwd)) yield { ...frame, header: { ...frame.header, cwd: displayPath(distro, frame.header.cwd) } };
      else yield frame;
    }
  }

  async *mergedWorkspaceFollow(source, signal) {
    const iterator = source[Symbol.asyncIterator]();
    const inbox = new Inbox();
    const changed = () => inbox.push({ tag: 'wsl' });
    this.on('workspace', changed);
    pump(iterator, inbox, 'windows');
    let windowsState;
    let last;
    let opened = false;
    try {
      await this.hostsReady('workspace');
      while (true) {
        const next = await inbox.next(signal);
        if (next === undefined) return;
        if (next.tag === 'windows') {
          if (next.error) throw next.error;
          if (next.end) return;
          windowsState = applyWorkspaceFrame(windowsState ?? emptyWorkspaceState(), next.value);
        }
        if (windowsState === undefined) continue;
        const { baseline } = this.merged(windowsState);
        const text = JSON.stringify(baseline);
        if (text === last) continue;
        last = text;
        yield { type: opened ? 'replace' : 'baseline', value: baseline };
        opened = true;
      }
    } finally {
      this.off('workspace', changed);
      inbox.close();
      iterator.return?.().catch(() => {});
    }
  }

  async *mergedControl(source, signal) {
    const iterator = source[Symbol.asyncIterator]();
    const inbox = new Inbox();
    const projected = (frame) => inbox.push({ tag: 'wsl', value: frame });
    this.on('projection', projected);
    pump(iterator, inbox, 'windows');
    let opened = false;
    const held = [];
    try {
      while (true) {
        const next = await inbox.next(signal);
        if (next === undefined) return;
        if (next.tag === 'windows' && next.error) throw next.error;
        if (next.tag === 'windows' && next.end) return;
        if (!opened) {
          if (next.tag === 'wsl') {
            held.push(next.value);
            continue;
          }
          if (next.value?.type !== 'baseline') continue;
          await this.hostsReady('control');
          const projections = { ...(next.value.value?.projections ?? {}) };
          for (const cache of this.projections.values()) for (const [id, entry] of cache) projections[id] = entry;
          opened = true;
          yield { type: 'baseline', value: { ...next.value.value, projections } };
          continue;
        }
        yield next.value;
      }
    } finally {
      this.off('projection', projected);
      inbox.close();
      iterator.return?.().catch(() => {});
    }
  }

  async *mergedEvents(source, signal) {
    const iterator = source[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) return;
    yield first.value;
    const stream = { clientId: first.value?.clientId, inbox: new Inbox() };
    pump(iterator, stream.inbox, 'windows');
    this.eventStreams.add(stream);
    for (const waterfall of this.waterfalls.values()) this.deliver(waterfall, stream);
    try {
      while (true) {
        const next = await stream.inbox.next(signal);
        if (next === undefined) return;
        if (next.tag === 'windows' && next.error) throw next.error;
        if (next.tag === 'windows' && next.end) return;
        yield next.value;
      }
    } finally {
      this.eventStreams.delete(stream);
      stream.inbox.close();
      for (const [id, waterfall] of [...this.waterfalls]) {
        if (!waterfall.deliveries.delete(stream) || waterfall.deliveries.size > 0) continue;
        this.waterfalls.delete(id);
        this.sendWaterfallResult(waterfall, { kind: 'next' });
      }
      iterator.return?.().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Exact Fetch routes (session log export, raw upload, file reads, changes).
  // ---------------------------------------------------------------------------

  async fetchRoute(path, request, original) {
    const url = new URL(request.url);
    let distro;
    const sessionId = url.searchParams.get('sessionId');
    if (sessionId) {
      const owner = await this.ownerOf([sessionId]);
      if (owner !== WINDOWS) distro = owner;
    } else if (path === '/api/file') {
      const target = url.searchParams.get('path');
      const unc = wslPathOf(target);
      if (unc !== undefined && this.isHost(unc.distro)) {
        distro = this.hostName(unc.distro);
        url.searchParams.set('path', unc.path);
      } else if (isLinuxPath(target)) {
        distro = this.hostOfPath(target);
      }
    }
    if (distro === undefined) return original(request);
    const client = await this.client(distro);
    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'content-length', 'range']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
    return client.fetch(`${path.slice(1)}${url.search}`, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
      signal: request.signal,
    });
  }
}

/**
 * Wrap the Gateway of this Host. The Gateway's own closures call
 * `this.dispatchRpc` / `this.openWireStream`, so own properties on the
 * instance take effect for the HTTP bridge, the WebSocket mux and the
 * in-process carrier alike; deleting them restores the class methods.
 * @returns disposer
 */
export function wrapGateway(gateway, bridge) {
  const raw = Reflect.get(gateway, ORIGINAL) ?? gateway;
  const dispatch = raw.dispatchRpc;
  const open = raw.openWireStream;
  if (typeof dispatch !== 'function' || typeof open !== 'function') throw new Error('this DeepSeek Harness Gateway has no dispatchRpc/openWireStream to merge WSL into');
  Object.defineProperty(raw, 'dispatchRpc', {
    configurable: true,
    writable: true,
    value: (endpoint, payload, signal, peer) => bridge.dispatchRpc(endpoint, payload, signal, peer, (...args) => dispatch.apply(raw, args)),
  });
  Object.defineProperty(raw, 'openWireStream', {
    configurable: true,
    writable: true,
    value: (endpoint, payload, uplink, peer, signal, control, window) => bridge.openStream(endpoint, payload, uplink, peer, signal, () => open.call(raw, endpoint, payload, uplink, peer, signal, control, window)),
  });
  return () => {
    delete raw.dispatchRpc;
    delete raw.openWireStream;
  };
}

/**
 * Wrap the Connection's exact Fetch routes (present and future) so the ones
 * addressed by a WSL Session are answered by its distribution.
 * @returns disposer
 */
export function wrapFetchRoutes(connection, bridge) {
  const raw = Reflect.get(connection, ORIGINAL) ?? connection;
  const routes = raw.fetchRoutes;
  if (!(routes instanceof Map)) return () => {};
  const wrap = (path, route) => {
    if (route === null || typeof route !== 'object' || route[WRAPPED] !== undefined) return;
    const original = route.fetch;
    route[WRAPPED] = original;
    route.fetch = (request) => bridge.fetchRoute(path, request, original);
  };
  for (const [path, route] of routes) wrap(path, route);
  const set = routes.set;
  Object.defineProperty(routes, 'set', {
    configurable: true,
    writable: true,
    value(path, route) {
      wrap(path, route);
      return set.call(this, path, route);
    },
  });
  return () => {
    delete routes.set;
    for (const route of routes.values()) {
      if (route?.[WRAPPED] === undefined) continue;
      route.fetch = route[WRAPPED];
      delete route[WRAPPED];
    }
  };
}
