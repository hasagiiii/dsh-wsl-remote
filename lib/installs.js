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

  /** Start installing `spec` into `distro`; returns the job at once. */
  start(distro, spec, onSettled) {
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
        const result = await client.call('pluginManager/installBundle', { args: { spec, options: { enabled: true, requestId: id } } });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        const status = result.value?.application === 'cancelled' ? 'cancelled' : result.value?.application === 'failed' || result.value?.status === 'refused' ? 'failed' : 'done';
        await job.settle({ result: result.value, status });
      } catch (error) {
        await job.settle({ error: error instanceof Error ? error.message : String(error), status: 'failed' });
      }
    })();
    return this.view(job);
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
