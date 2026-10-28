/**
 * @local/dsh-wsl-remote — Host half.
 *
 * The execution environment (this Windows PC or one WSL distribution) is fixed
 * when DeepSeek Harness starts; the bundle patch mounts the matching execution
 * providers. This plugin:
 *  - reports the running environment and the one saved for the next start;
 *  - deploys the Linux runtime before a distribution can be selected;
 *  - saves the environment and per-distribution default shell from
 *    Settings → General (user-only actions), which take effect after a restart;
 *  - in WSL mode, gives every Agent the Linux `bash` tool in place of `pwsh`
 *    and one stable prompt section naming the execution world.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { listDistros } from './lib/wsl.js';
import { ensureServer, probeDistro, SERVER_VERSION } from './lib/deploy.js';
import { isDistro, isLinuxPath, readState, startupState, writeState } from './lib/boot.js';

const packageDir = dirname(fileURLToPath(import.meta.url));
const ROUTE = '/api/local-wsl-remote';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function body(request) {
  try {
    const value = await request.json();
    return value !== null && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function environmentSection(distro, shell) {
  return [
    `Execution environment: commands, file reads and edits, and searches run inside the WSL Linux distribution "${distro}", not on Windows.`,
    `The bash tool runs \`${shell} -c\`; use Linux commands and POSIX paths in commands.`,
    `Windows paths of this distribution such as \\\\wsl.localhost\\${distro}\\home\\me\\repo name the Linux path /home/me/repo, and drive paths such as C:\\work are /mnt/c/work. File tools accept either spelling; inside commands use the Linux spelling.`,
  ].join(' ');
}

export default class WslRemoteService extends Service {
  static Config = schema.object({
    // Retired 1.0 field, read once to migrate into wsl-remote.json.
    defaultShells: schema.dict(schema.string()).default({}).volatile(),
  });

  constructor(ctx, config) {
    super(ctx, 'wslRemote');
    this.config = config;
    this.started = startupState();
    this.distros = [];
    this.probes = new Map();
    this.operation = Promise.resolve();
    this.ready = this.discover().catch((error) => {
      ctx.logger.warn(`wsl-remote: WSL discovery failed: ${error.message}`);
    });

    ctx.inject(['settings'], (scope) => {
      scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber), 'wsl-remote: no generated settings page');
      this.settingsService = scope.settings;
    });

    if (this.started.active) this.installWslMode();

    ctx.inject(['tools'], (scope) => {
      scope.tools.register({
        name: 'wsl_environments',
        description: 'Report the execution environment this DeepSeek Harness process runs Agent commands in (Windows or a WSL distribution), the one saved for the next start, and installed WSL distributions. With `distro`, also probe that distribution for shells, Node.js and bubblewrap (this starts it if stopped). Read-only.',
        parameters: {
          type: 'object',
          properties: { distro: { type: 'string', description: 'WSL distribution to probe.' } },
          additionalProperties: false,
        },
        output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
        isConcurrencySafe: () => true,
        execute: async (args, exec) => {
          const result = await this.environments();
          if (typeof args?.distro === 'string') result.probe = await this.shellsOf(args.distro, exec.signal);
          return result;
        },
      });
    });

    ctx.inject(['connection'], (scope) => {
      const route = (path, methods, handler) => scope.connection.fetch.register({ path: `${ROUTE}/${path}`, methods, requestBody: 'buffered', fetch: handler });
      route('environments', ['GET'], async () => json(await this.environments()));
      route('shells', ['GET'], async (request) => {
        try {
          return json(await this.shellsOf(new URL(request.url).searchParams.get('distro'), request.signal));
        } catch (error) {
          return json({ error: error.message }, 400);
        }
      });
      route('select', ['POST'], async (request) => {
        const { environment } = await body(request);
        try {
          return json(await this.select(environment, request.signal));
        } catch (error) {
          return json({ error: error.message }, 400);
        }
      });
      route('shell', ['POST'], async (request) => {
        const { distro, shell } = await body(request);
        try {
          return json(await this.setShell(distro, shell, request.signal));
        } catch (error) {
          return json({ error: error.message }, 400);
        }
      });
    });
  }

  async discover() {
    if (process.platform !== 'win32') return;
    this.distros = await listDistros();
  }

  /** WSL mode: the Linux `bash` tool replaces `pwsh` for every Agent, plus one prompt section. */
  installWslMode() {
    const { active, shell } = this.started;
    this.ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.section({
        name: 'wsl-remote:environment',
        order: scope.systemPrompt.getSectionOrder('TOOL_BASH') - 1,
        text: environmentSection(active, shell ?? 'bash'),
        interpolate: false,
      });
    });
    const restrictions = new Map();
    this.ctx.effect(() => () => {
      for (const dispose of restrictions.values()) dispose();
      restrictions.clear();
    }, 'wsl-remote: per-agent pwsh restrictions');
    this.ctx.on('agent/created', ({ agent }) => {
      const tools = agent.ctx.get('tools');
      if (tools === undefined || tools.get('pwsh', agent) === undefined || tools.get('bash', agent) === undefined) return;
      try {
        const dispose = tools.restrict({ deny: ['pwsh'] });
        restrictions.set(agent, dispose);
        agent.ctx.effect(() => () => {
          if (restrictions.get(agent) === dispose) restrictions.delete(agent);
        }, 'wsl-remote: pwsh restriction');
      } catch (error) {
        this.ctx.logger.warn(`wsl-remote: could not hide pwsh for ${agent.id}: ${error.message}`);
      }
    });
  }

  /**
   * Move 1.0 settings into wsl-remote.json and clear what 1.0 left in the
   * profile: a default pointing at a removed `wsl-*` preset would make new
   * sessions fail. Each step is independent; failures are reported, not thrown.
   * @returns problems that remain, for the status report.
   */
  async migrate(settings) {
    const problems = [];
    const step = async (name, action) => {
      try {
        await action();
      } catch (error) {
        problems.push(`${name}: ${error.message}`);
        this.ctx.logger.warn(`wsl-remote: migration ${name} failed: ${error.message}`);
      }
    };
    const forms = () => settings.describe();
    await step('agent preset default', async () => {
      const form = forms().find((entry) => entry.ns === 'agent-preset-registry');
      const selected = form?.value?.selectedDefault;
      if (typeof selected === 'string' && selected.startsWith('wsl-')) {
        await settings.mutate('agent-preset-registry', [{ op: 'unset', path: ['selectedDefault'] }], form.revision);
      }
    });
    await step('default shells', async () => {
      const form = forms().find((entry) => entry.ns === 'local-wsl-remote');
      const legacy = form?.value?.defaultShells;
      if (legacy === null || typeof legacy !== 'object' || Object.keys(legacy).length === 0) return;
      const state = readState();
      for (const [distro, path] of Object.entries(legacy)) if (isDistro(distro) && isLinuxPath(path) && !state.shells[distro]) state.shells[distro] = path;
      writeState(state);
      await settings.mutate('local-wsl-remote', [{ op: 'unset', path: ['defaultShells'] }], form.revision);
    });
    return problems;
  }

  /**
   * Run the 1.0 migration once, from a request context: settings writes
   * reconcile the Loader through HMR, which cannot nest inside the transaction
   * that activated this plugin.
   */
  ensureMigrated() {
    if (this.migration === undefined && this.settingsService !== undefined) {
      this.migration = this.migrate(this.settingsService);
      this.migration.then((problems) => {
        if (problems.length > 0) this.migration = undefined;
      });
    }
    return this.migration ?? Promise.resolve([]);
  }

  /** Running environment, saved environment, and installed distributions. */
  async environments() {
    await this.ready;
    const migrationProblems = await this.ensureMigrated();
    const saved = readState();
    const next = saved.environment && saved.node && saved.serverDir ? saved.environment : '';
    const nextShell = next ? saved.shells[next] ?? null : null;
    const activeShell = this.started.active ? this.started.shell ?? null : null;
    return {
      platform: process.platform,
      serverVersion: SERVER_VERSION,
      active: this.started.active,
      activeShell,
      next,
      shells: saved.shells,
      restartRequired: next !== this.started.active || (next !== '' && nextShell !== activeShell),
      ...(migrationProblems.length ? { migrationProblems } : {}),
      distros: this.distros.map((entry) => ({ name: entry.name, isDefault: entry.isDefault })),
    };
  }

  knownDistro(distro) {
    if (!isDistro(distro) || !this.distros.some((entry) => entry.name === distro)) throw new Error(`Unknown WSL distribution: ${String(distro)}`);
  }

  probe(distro, signal) {
    let pending = this.probes.get(distro);
    if (pending === undefined) {
      pending = probeDistro(distro, signal);
      this.probes.set(distro, pending);
      pending.catch(() => this.probes.delete(distro));
    }
    return pending;
  }

  /** Installed shells in one distribution with the saved selection. */
  async shellsOf(distro, signal) {
    await this.ready;
    this.knownDistro(distro);
    const facts = await this.probe(distro, signal);
    return {
      distro,
      shells: facts.shells,
      loginShell: facts.loginShell,
      selected: readState().shells[distro] ?? null,
      node: facts.nodeVersion ?? null,
      nodeSupported: facts.nodeSupported,
      bwrap: facts.bwrap,
    };
  }

  /** Serialize writes to wsl-remote.json. */
  exclusive(task) {
    const run = this.operation.then(task, task);
    this.operation = run.catch(() => {});
    return run;
  }

  /**
   * Save the environment for the next start. A WSL distribution is saved only
   * after its runtime is deployed, so the next start never lacks it.
   */
  select(environment, signal) {
    return this.exclusive(async () => {
      await this.ready;
      const state = readState();
      if (environment === '' || environment === null || environment === undefined) {
        writeState({ ...state, environment: '' });
      } else {
        this.knownDistro(environment);
        const facts = await this.probe(environment, signal);
        const { dir } = await ensureServer(packageDir, environment, facts, signal, (line) => this.ctx.logger.info(`wsl-remote: ${line}`));
        writeState({ ...state, environment, node: facts.node, serverDir: dir });
      }
      return this.environments();
    });
  }

  /** Save one distribution's default shell ('' or null restores bash). */
  setShell(distro, shell, signal) {
    return this.exclusive(async () => {
      await this.ready;
      this.knownDistro(distro);
      const state = readState();
      if (shell === '' || shell === null || shell === undefined) delete state.shells[distro];
      else {
        const facts = await this.probe(distro, signal);
        if (!facts.shells.some((entry) => entry.path === shell)) throw new Error(`${shell} is not an installed shell in ${distro}`);
        state.shells[distro] = shell;
      }
      writeState(state);
      return this.environments();
    });
  }
}
