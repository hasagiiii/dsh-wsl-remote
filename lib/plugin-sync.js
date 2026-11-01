/**
 * Plugin sync between any two hosts: Windows (`null`), a WSL distribution,
 * or an SSH host (`ssh:<dest>`). Planning compares the two plugin-manager
 * listings and derives each install spec from the source bundle's recorded
 * source (never from user text), translated to the target platform:
 *
 *   registry / git spec      unchanged (a registry spec is pinned to the source version)
 *   link:/file: X:\path      Windows ↔ WSL through /mnt/x/path; an SSH server cannot see it
 *   link:/file: /mnt/x/path  the same Windows folder, seen from WSL
 *   other Linux paths        stay on their host
 *   any local folder         when the target cannot reach it but it is a git checkout whose
 *                            commit is pushed, that commit from git (lib/git-source.js)
 *
 * Runs install one plugin at a time through the target's own plugin manager
 * (lib/installs.js), so progress, logs and cancellation work as for a single
 * install. Nothing is removed from the target.
 */
import { randomUUID } from 'node:crypto';
import { hostKind } from './transport.js';

/** Never installed elsewhere: this plugin is made for the Windows Host only. */
const WINDOWS_ONLY = new Set(['@local/dsh-wsl-remote']);
const LOCAL = /^(link|file):(.*)$/is;
const WINDOWS_PATH = /^([A-Za-z]):[\\/](.*)$/s;
const WSL_MOUNT = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/s;
/** Finished runs are kept this long for windows to read their outcome. */
const KEEP_MS = 10 * 60_000;

/** `windows`, `wsl` or `ssh`. */
export const platformOf = (host) => (host === null ? 'windows' : hostKind(host));

/** A bundle the user installed (the profile declares it), not one shipped with dsh itself. */
export const userBundle = (bundle) => Boolean(bundle?.installed) || bundle?.availability === 'profile';

/** A registry spec of this package (`name`, `name@range`), as opposed to git, tarball or local specs. */
function registrySpec(spec, name) {
  if (spec === name) return true;
  if (!spec.startsWith(`${name}@`)) return false;
  const range = spec.slice(name.length + 1);
  return range.length > 0 && !/[:/\\]/.test(range);
}

/**
 * The spec that installs `bundle` (listed on a `from` host) on a `to` host.
 * @param {{ name: string, version?: string | null, source?: string }} bundle
 * @param {'windows' | 'wsl' | 'ssh'} from
 * @param {'windows' | 'wsl' | 'ssh'} to
 * @returns {{ ok: true, spec: string } | { ok: false, reason: 'source-missing' | 'local-path', source?: string }}
 */
export function mapPluginSpec(bundle, from, to) {
  const source = typeof bundle?.source === 'string' ? bundle.source.trim() : '';
  if (!source) return { ok: false, reason: 'source-missing' };
  const local = LOCAL.exec(source);
  if (local === null) {
    // Pin registry installs to the source's version, so "update" means "the same version".
    if (bundle.version && registrySpec(source, bundle.name)) return { ok: true, spec: `${bundle.name}@${bundle.version}` };
    return { ok: true, spec: source };
  }
  const protocol = local[1].toLowerCase();
  const path = local[2];
  // The Windows drive and path behind the source folder, when it has one.
  let drive;
  const windows = from === 'windows' ? WINDOWS_PATH.exec(path) : null;
  const mount = from === 'wsl' ? WSL_MOUNT.exec(path) : null;
  if (windows) drive = { letter: windows[1], tail: windows[2].replace(/\\/g, '/') };
  else if (mount) drive = { letter: mount[1], tail: mount[2] ?? '' };
  if (drive === undefined || to === 'ssh') return { ok: false, reason: 'local-path', source };
  if (to === 'windows') return { ok: true, spec: `${protocol}:${drive.letter.toUpperCase()}:/${drive.tail}` };
  return { ok: true, spec: `${protocol}:/mnt/${drive.letter.toLowerCase()}/${drive.tail}` };
}

const errorOf = (bundle) => bundle?.error?.message ?? bundle?.error?.diagnostic ?? (bundle?.error?.code ? String(bundle.error.code) : typeof bundle?.error === 'string' ? bundle.error : undefined);

/**
 * Compare a source host's plugins with a target's.
 * Each row: { name, version, targetVersion, state, action?, spec?, reason? }
 *   state  missing | differ | disabled | same | builtin | error | unsupported
 *   action install | update | enable (absent when nothing can or needs to be done)
 * @returns {{ rows: object[], targetOnly: object[] }}
 */
export function planPluginSync(sourceBundles, targetBundles, from, to) {
  const targets = new Map((targetBundles ?? []).map((bundle) => [bundle.name, bundle]));
  const rows = [];
  for (const bundle of sourceBundles ?? []) {
    if (!userBundle(bundle) || WINDOWS_ONLY.has(bundle.name)) continue;
    const target = targets.get(bundle.name);
    const row = {
      name: bundle.name,
      version: bundle.version ?? null,
      targetVersion: target?.version ?? null,
      meta: bundle.meta,
      ...(bundle.enabled === false ? { sourceDisabled: true } : {}),
    };
    if (target !== undefined && !userBundle(target)) {
      rows.push({ ...row, state: 'builtin' });
      continue;
    }
    if (target !== undefined && errorOf(target) !== undefined) {
      rows.push({ ...row, state: 'error', reason: errorOf(target) });
      continue;
    }
    if (target !== undefined && (target.version ?? null) === (bundle.version ?? null)) {
      if (bundle.enabled !== false && target.enabled === false) rows.push({ ...row, state: 'disabled', action: 'enable' });
      else rows.push({ ...row, state: 'same' });
      continue;
    }
    const mapped = mapPluginSpec(bundle, from, to);
    const state = target === undefined ? 'missing' : 'differ';
    if (!mapped.ok) rows.push({ ...row, state: 'unsupported', reason: mapped.reason, wanted: state, ...(mapped.source ? { source: mapped.source } : {}) });
    else rows.push({ ...row, state, action: target === undefined ? 'install' : 'update', spec: mapped.spec });
  }
  const names = new Set(rows.map((row) => row.name));
  const targetOnly = (targetBundles ?? [])
    .filter((bundle) => userBundle(bundle) && !names.has(bundle.name) && !(sourceBundles ?? []).some((item) => item.name === bundle.name))
    .map((bundle) => ({ name: bundle.name, version: bundle.version ?? null, meta: bundle.meta }));
  return { rows, targetOnly };
}

/**
 * Background sync runs. One run installs its items one after another; at most
 * one run per target host at a time. Syncing more plugins (for example one at
 * a time from its row) between the same two hosts while a run works appends
 * them to that run.
 */
export class PluginSyncRuns {
  /**
   * @param {object} options
   * @param {(host: string | null) => Promise<object[]>} options.list - a host's `pluginManager/listBundles`.
   * @param {(host: string | null, name: string) => Promise<object>} options.enable - enable one bundle; resolves to the plugin-manager result.
   * @param {import('./installs.js').PluginInstalls} options.installs
   * @param {(host: string | null, dir: string) => Promise<object>} [options.gitSource] - inspect a local
   *   source folder on its host (lib/git-source.js `inspectGitSource`); lets a folder the target cannot
   *   reach install from its pushed git commit instead.
   * @param {() => number} [options.now]
   */
  constructor({ list, enable, installs, gitSource, now = Date.now }) {
    this.list = list;
    this.enable = enable;
    this.installs = installs;
    this.gitSource = gitSource;
    this.now = now;
    this.runs = new Map();
  }

  async plan(source, target) {
    if (source === target) throw new Error('choose two different hosts');
    const [sourceBundles, targetBundles] = await Promise.all([this.list(source), this.list(target)]);
    const plan = planPluginSync(sourceBundles, targetBundles, platformOf(source), platformOf(target));
    plan.rows = await Promise.all(plan.rows.map((row) => this.viaGit(source, row)));
    return { source, target, ...plan };
  }

  /**
   * A row whose local folder the target cannot reach: when that folder is a
   * git checkout with its commit on a remote, install that commit from git.
   */
  async viaGit(source, row) {
    if (row.state !== 'unsupported' || row.reason !== 'local-path' || this.gitSource === undefined) return row;
    const local = LOCAL.exec(row.source ?? '');
    if (local === null) return row;
    let found;
    try {
      found = await this.gitSource(source, local[2]);
    } catch {
      return row;
    }
    if (!found?.ok) return found?.reason && found.reason !== 'not-git' ? { ...row, reason: found.reason } : row;
    const { wanted, reason: _reason, ...rest } = row;
    return {
      ...rest,
      state: wanted,
      action: wanted === 'missing' ? 'install' : 'update',
      spec: found.spec,
      git: { remote: found.remote, commit: found.commit, ...(found.dirty ? { dirty: true } : {}), ...(found.unpushed ? { unpushed: found.unpushed } : {}) },
    };
  }

  /** The run into `target` that is still working, if any. */
  running(target) {
    for (const run of this.runs.values()) if (run.target === target && run.status === 'running') return run;
    return undefined;
  }

  /**
   * Start syncing `names` (one plugin or several) from `source` to `target`.
   * The plan is made again here, so a stale window can only pick plugins,
   * never specs. While a run from the same source into the same target is
   * working, the plugins are queued at its end instead.
   */
  async start(source, target, names) {
    if (!Array.isArray(names) || names.length === 0 || !names.every((name) => typeof name === 'string')) throw new Error('choose at least one plugin');
    const busy = this.running(target);
    if (busy !== undefined && (busy.source !== source || busy.cancelled)) throw new Error('a plugin sync into this host is already running');
    const plan = await this.plan(source, target);
    const wanted = new Set(names);
    const items = plan.rows.filter((row) => wanted.has(row.name) && row.action !== undefined)
      .map((row) => ({ name: row.name, action: row.action, spec: row.spec, version: row.version, status: 'pending' }));
    if (items.length === 0) throw new Error('nothing to sync: the selected plugins are already up to date on the target');
    // Planning awaited; look again so two quick clicks still share one run.
    const current = this.running(target);
    if (current !== undefined) {
      if (current.source !== source || current.cancelled) throw new Error('a plugin sync into this host is already running');
      const queued = new Set(current.items.filter((item) => item.status === 'pending' || item.status === 'running').map((item) => item.name));
      const added = items.filter((item) => !queued.has(item.name));
      if (added.length === 0) throw new Error('the selected plugins are already queued in the running sync');
      // drive() iterates run.items with for…of, so appended items are picked up.
      current.items.push(...added);
      return this.view(current);
    }
    const run = { id: randomUUID(), source, target, items, status: 'running', startedAt: this.now(), cancelled: false };
    this.runs.set(run.id, run);
    this.drive(run);
    return this.view(run);
  }

  async drive(run) {
    for (const item of run.items) {
      if (run.cancelled) {
        item.status = 'skipped';
        continue;
      }
      item.status = 'running';
      try {
        if (item.action === 'enable') {
          const result = await this.enable(run.target, item.name);
          this.settle(item, result);
          continue;
        }
        const finished = Promise.withResolvers();
        const job = this.installs.start(run.target, item.spec, (settled) => finished.resolve(settled));
        item.jobId = job.id;
        const settled = await finished.promise;
        if (settled.status === 'done') this.settle(item, settled.result);
        else {
          item.status = settled.status === 'cancelled' ? 'cancelled' : 'failed';
          item.error = settled.error ?? settled.result?.error?.message ?? settled.result?.reason ?? undefined;
        }
      } catch (error) {
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : String(error);
      }
    }
    run.status = run.cancelled ? 'cancelled' : run.items.some((item) => item.status === 'failed') ? 'failed' : 'done';
    run.finishedAt = this.now();
    this.prune();
  }

  settle(item, result) {
    const application = result?.application;
    if (application === 'failed' || application === 'cancelled' || result?.status === 'refused') {
      item.status = application === 'cancelled' ? 'cancelled' : 'failed';
      item.error = result?.error?.diagnostic ?? result?.error?.message ?? result?.reason ?? application;
      return;
    }
    item.status = 'done';
    if (application === 'restart-required') item.restartRequired = true;
  }

  /** Stop after the current plugin: its install is cancelled, the rest are skipped. */
  async cancel(id) {
    const run = this.runs.get(id);
    if (run === undefined) throw new Error('no such plugin sync');
    if (run.status !== 'running') return this.view(run);
    run.cancelled = true;
    const current = run.items.find((item) => item.status === 'running' && item.jobId !== undefined);
    if (current !== undefined) await this.installs.cancel(current.jobId).catch(() => {});
    return this.view(run);
  }

  get(id) {
    const run = this.runs.get(id);
    return run === undefined ? undefined : this.view(run);
  }

  /** The running or most recent run into `target`. */
  latest(target) {
    let latest;
    for (const run of this.runs.values()) if (run.target === target && (latest === undefined || run.startedAt > latest.startedAt)) latest = run;
    return latest === undefined ? undefined : this.view(latest);
  }

  view(run) {
    const current = run.items.find((item) => item.status === 'running');
    const job = current?.jobId === undefined ? undefined : this.installs.get(current.jobId);
    return {
      id: run.id,
      source: run.source,
      target: run.target,
      status: run.status,
      ...(run.cancelled && run.status === 'running' ? { cancelRequested: true } : {}),
      restartRequired: run.items.some((item) => item.restartRequired),
      elapsedMs: (run.finishedAt ?? this.now()) - run.startedAt,
      items: run.items.map((item) => ({ name: item.name, action: item.action, ...(item.spec ? { spec: item.spec } : {}), status: item.status, ...(item.error ? { error: item.error } : {}), ...(item.restartRequired ? { restartRequired: true } : {}) })),
      ...(job ? { job } : {}),
    };
  }

  prune() {
    const cutoff = this.now() - KEEP_MS;
    for (const [id, run] of this.runs) if (run.status !== 'running' && (run.finishedAt ?? 0) < cutoff) this.runs.delete(id);
  }
}
