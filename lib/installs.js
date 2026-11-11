/**
 * Plugin installs into a distribution's dsh, run as background jobs so the
 * Windows window never waits on one: the install call is started with a
 * request id, its pnpm output and phase arrive as the WSL dsh's
 * `plugin-manager/install-log` / `install-state` events, and the panel polls
 * the job. A job can be cancelled through the WSL plugin manager's own
 * `cancelInstall`, which stops pnpm and restores the profile files. A job
 * whose output has been silent for a while is marked stalled, so the panel
 * offers to cancel it instead of waiting for the plugin manager's idle
 * timeout.
 */
import { randomUUID } from 'node:crypto';

/** Words for the plugin manager's failure codes (its own locale is not on this side). */
const FAILURE_TEXT = {
  'already-installed': 'it is already installed on the target, and this dsh can only update it through its own plugin page',
  'incompatible-version': 'the target dsh refuses this version',
  'invalid-spec': 'the install address is not valid',
  'not-bundle': 'the package is not a dsh plugin bundle',
  'not-a-bundle': 'the package is not a dsh plugin bundle',
  'not-a-package': 'the package could not be read',
  'ambiguous-install': 'the install changed more than one package',
  'unsupported-platform': 'the plugin does not support the target platform',
  'operation-error': 'the plugin manager reported an error',
};

/**
 * The target dsh has no such Remote method. DSH 0.2.1's gateway claims only the
 * endpoints it knows, so an unknown one never reaches its dispatcher: the HTTP
 * layer answers 404, which the client reports as `gateway/internal … HTTP 404`.
 * A known-but-unavailable method comes back as a gateway code instead.
 */
export function missingMethod(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`;
  return /invocation-unavailable|method-unavailable|definition-unavailable|no active Remote method/i.test(text)
    || /transport failure for \S+: HTTP 404\b/i.test(text);
}

/** The useful last lines of pnpm's output: its own error lines first, else the tail. */
function outputReason(lines) {
  const text = (lines ?? []).map((line) => String(line).trim()).filter(Boolean);
  const errors = text.filter((line) => /^\[?ERR_|ERR_PNPM|^error\b|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(line));
  const picked = errors.length > 0 ? [...new Set(errors)].slice(-3) : text.slice(-2);
  return picked.join(' | ');
}

/**
 * Why an install did not succeed, in one line, from whatever the plugin manager
 * and pnpm left: a refusal reason, an error diagnostic or code, a thrown error,
 * pnpm's error lines. Never empty.
 * @param {{ error?: string, result?: object, lines?: string[] }} job
 */
export function installFailureReason(job) {
  const result = job?.result;
  const error = result?.error;
  const code = typeof error?.code === 'string' ? error.code : typeof result?.problem === 'string' ? result.problem : undefined;
  const incompatible = Array.isArray(error?.incompatible) && error.incompatible.length > 0
    ? error.incompatible.map((item) => `${item.name ?? ''}@${item.version ?? ''} needs ${JSON.stringify(item.requirements ?? {})} (target dsh ${item.runtimeVersion ?? '?'})`).join('; ')
    : undefined;
  const parts = [
    typeof job?.error === 'string' && job.error ? job.error : undefined,
    typeof result?.reason === 'string' && result.reason ? result.reason : undefined,
    typeof error?.diagnostic === 'string' && error.diagnostic ? error.diagnostic : undefined,
    typeof error?.message === 'string' && error.message ? error.message : undefined,
    typeof error === 'string' && error ? error : undefined,
    incompatible,
    code !== undefined ? `${FAILURE_TEXT[code] ?? 'failed'} (${code})` : undefined,
  ].filter(Boolean);
  // A long pnpm diagnostic is the whole log: keep its error lines only.
  const shortened = parts.map((part) => (part.length > 400 ? outputReason(part.split(/\r?\n/)) || part.slice(-400) : part));
  // Reasons are built again at each layer (job, sync item): keep every piece once.
  const pieces = shortened.flatMap((part) => part.split(' — ')).map((piece) => piece.trim()).filter(Boolean);
  const reason = [...new Set(pieces)].join(' — ');
  if (reason) return reason;
  return outputReason(job?.lines) || (result?.application ? `the install ended as "${result.application}" with no message` : 'the install failed with no message');
}

/** Silence after which a running install is reported as stalled. */
export const STALL_MS = 60_000;
/** Output lines kept per job. */
const MAX_LINES = 400;
/** Finished jobs are kept this long for the panel to read their outcome. */
const KEEP_MS = 10 * 60_000;

export class PluginInstalls {
  /**
   * @param {object} options
   * @param {(distro: string) => Promise<{ call: Function }>} options.client - the WSL dsh client of a distribution.
   * @param {import('node:events').EventEmitter} options.events - emits `plugin-install` { distro, event, value }.
   * @param {() => number} [options.now]
   */
  constructor({ client, events, now = Date.now }) {
    this.client = client;
    this.now = now;
    this.jobs = new Map();
    this.listener = (message) => this.observe(message);
    events.on('plugin-install', this.listener);
    this.dispose = () => events.off('plugin-install', this.listener);
  }

  /**
   * Start installing `spec` into `distro`; returns the job at once.
   * @param {{ update?: { name: string, version: string } }} [options] - replace an
   *   installed registry plugin with that version through the target's own
   *   `pluginManager/updateBundle` (DSH 0.2.2+). A plain install of an installed
   *   package is refused as "already-installed" by the target, so an update must
   *   go this way; a target without it falls back to the plain install.
   */
  start(distro, spec, onSettled, options = {}) {
    for (const job of this.jobs.values()) {
      if (job.distro === distro && job.status === 'running') throw new Error(`an installation into ${distro} is already running (${job.spec})`);
    }
    const id = randomUUID();
    const job = { id, distro, spec, status: 'running', phase: 'starting', lines: [], startedAt: this.now(), lastOutputAt: this.now(), result: undefined, error: undefined };
    // Settled once: by the install call's answer, or by a cancellation the
    // plugin manager confirmed (its answer to the install call may never come).
    job.settle = async (update) => {
      if (job.status !== 'running') return;
      Object.assign(job, update);
      // A failure always says why, even when the plugin manager gave no message.
      if (job.status === 'failed') job.error = installFailureReason(job);
      job.finishedAt = this.now();
      try {
        await onSettled?.(job);
      } catch {}
      this.prune();
    };
    this.jobs.set(id, job);
    (async () => {
      try {
        const client = await this.client(distro);
        let value;
        if (options.update !== undefined) {
          const updated = await client.call('pluginManager/updateBundle', { args: { name: options.update.name, version: options.update.version, options: { requestId: id } } });
          if (updated.ok) {
            // { from, to, step, result }: `result` is the last step's install/remove result.
            value = { ...(updated.value?.result ?? {}), step: updated.value?.step, from: updated.value?.from, to: updated.value?.to };
          } else if (missingMethod(updated.error)) {
            // An older target (DSH 0.2.1) has no updateBundle: do what it does there.
            value = await this.replace(client, job, spec, options.update);
          } else {
            throw new Error(`${updated.error.code}: ${updated.error.message}`);
          }
        }
        if (value === undefined) {
          const result = await client.call('pluginManager/installBundle', { args: { spec, options: { enabled: true, requestId: id } } });
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
          value = result.value;
        }
        const status = value?.application === 'cancelled' ? 'cancelled' : value?.application === 'failed' || value?.status === 'refused' ? 'failed' : 'done';
        await job.settle({ result: value, status });
      } catch (error) {
        await job.settle({ error: error instanceof Error ? error.message : String(error), status: 'failed' });
      }
    })();
    return this.view(job);
  }

  /**
   * Update on a target without `updateBundle`, as DSH 0.2.2's own update does:
   * remove the installed version, install the new one, and when that does not
   * succeed install the removed version again, so the plugin is never lost.
   * @returns the plugin-manager result of the step that decided the outcome.
   */
  async replace(client, job, spec, { name, from }) {
    const call = async (endpoint, args) => {
      const result = await client.call(endpoint, { args });
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      return result.value;
    };
    const ended = (value) => ['failed', 'cancelled'].includes(value?.application) || value?.status === 'refused';
    job.phase = 'removing';
    const removed = await call('pluginManager/removeBundle', { name });
    if (ended(removed)) return { ...removed, step: 'remove' };
    job.phase = 'installing';
    const installed = await call('pluginManager/installBundle', { spec, options: { enabled: true, requestId: job.id } });
    if (!ended(installed)) return { ...installed, step: 'install' };
    if (typeof from !== 'string' || !from) return { ...installed, step: 'install' };
    job.phase = 'restoring';
    const restored = await call('pluginManager/installBundle', { spec: `${name}@${from}`, options: { enabled: true } }).catch((error) => ({ application: 'failed', error: { message: error.message } }));
    const note = ended(restored)
      ? `${name} ${from} could not be installed again either; install it on the target by hand`
      : `${name} ${from} was installed again`;
    return { ...installed, step: 'install', reinstalled: !ended(restored), reason: [installFailureReason({ result: installed }), note].join(' — ') };
  }

  /** Ask the WSL plugin manager to stop the job's pnpm run and restore the profile. */
  async cancel(id) {
    const job = this.jobs.get(id);
    if (job === undefined) throw new Error('no such installation');
    if (job.status !== 'running') return this.view(job);
    const client = await this.client(job.distro);
    const result = await client.call('pluginManager/cancelInstall', { args: { requestId: id } });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    job.cancelRequested = result.value?.status ?? 'requested';
    // `cancelled` answers once pnpm is gone and the profile files are back;
    // `not-running` means the plugin manager no longer has this install. Either
    // way it is over there, so stop waiting for the install call's answer.
    if (result.value?.status === 'cancelled') await job.settle({ status: 'cancelled' });
    else if (result.value?.status === 'not-running') await job.settle({ status: 'failed', error: 'the plugin manager no longer has this installation; refresh the plugin list to see whether it was installed' });
    return this.view(job);
  }

  get(id) {
    const job = this.jobs.get(id);
    return job === undefined ? undefined : this.view(job);
  }

  /** The running or most recent job of a distribution. */
  latest(distro) {
    let latest;
    for (const job of this.jobs.values()) if (job.distro === distro && (latest === undefined || job.startedAt > latest.startedAt)) latest = job;
    return latest === undefined ? undefined : this.view(latest);
  }

  observe({ distro, event, value }) {
    const job = typeof value?.requestId === 'string' ? this.jobs.get(value.requestId) : undefined;
    if (job === undefined || job.distro !== distro) return;
    if (event === 'plugin-manager/install-state') {
      job.phase = String(value.state ?? value.phase ?? job.phase);
      job.lastOutputAt = this.now();
      return;
    }
    if (typeof value.text === 'string' && value.text.length > 0) {
      job.lastOutputAt = this.now();
      for (const line of value.text.split(/\r?\n/)) if (line.trim()) job.lines.push(line);
      if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES);
    }
  }

  view(job) {
    const silentMs = this.now() - job.lastOutputAt;
    return {
      id: job.id,
      distro: job.distro,
      spec: job.spec,
      status: job.status,
      phase: job.phase,
      stalled: job.status === 'running' && silentMs >= STALL_MS,
      silentMs,
      elapsedMs: (job.finishedAt ?? this.now()) - job.startedAt,
      lines: job.lines.slice(-60),
      ...(job.cancelRequested ? { cancelRequested: job.cancelRequested } : {}),
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }

  prune() {
    const cutoff = this.now() - KEEP_MS;
    for (const [id, job] of this.jobs) if (job.status !== 'running' && (job.finishedAt ?? 0) < cutoff) this.jobs.delete(id);
  }
}
