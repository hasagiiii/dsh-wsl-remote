/**
 * @local/dsh-wsl-remote — WSL for DeepSeek Harness, Codex-style (Host half).
 *
 * Every WSL 2 distribution is a remote host next to this Windows Host:
 *  - Connecting starts the user's own `dsh` (installed with
 *    `npm i -g @deepseek-ai/dsh`) inside the distribution through the stdio
 *    of `wsl.exe` (no port opened by WSL); it uses the WSL `~/.dsh` profile,
 *    models, plugins, sessions and native ext4 files.
 *  - WSL workspaces and their sessions are merged into this window: the
 *    bridge (lib/bridge) routes every call that belongs to a WSL session or
 *    workspace to that dsh through DeepSeek Harness's own Client packages,
 *    and combines the session list, workspaces and live events.
 *  - The WSL dsh Web UI also stays reachable through a Windows loopback relay.
 *  - Sign-in can be shared: the WSL dsh then reads and writes credentials in
 *    the Windows store under its writer lock.
 * Nothing in the Windows composition is replaced.
 */
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { listDistros, runWsl } from './lib/wsl.js';
import { RemoteConnection } from './lib/remote.js';
import { MIN_DSH_VERSION } from './lib/version.js';
import { isDistro, isProfile, loadSettings, writeSettings } from './lib/state.js';
import { watchRequests } from './lib/requests.js';
import { createLinuxDirectory, listLinuxDirectory, parseOsRelease, toUncPath } from './lib/linux-fs.js';
import { WslBridge, wrapFetchRoutes, wrapGateway } from './lib/bridge/bridge.js';
import { RouteForwarder } from './lib/bridge/routes.js';
import { comparePlugins } from './lib/plugins.js';
import { PluginInstalls } from './lib/installs.js';

const packageDir = dirname(fileURLToPath(import.meta.url));
const ROUTE = '/api/local-wsl-remote';
/** Re-run discovery this often while distributions are listed, to pick up installs and removals. */
const DISCOVERY_TTL_MS = 30000;
/** Retry sooner while the list is empty or discovery failed, so a transient failure heals on its own. */
const RETRY_TTL_MS = 3000;
/** A `dsh-harness` request no window claimed within this time is dropped (the app was closed). */
const OPEN_REQUEST_TTL_MS = 5 * 60 * 1000;

/** `<DSH home>/wsl-remote/requests`: where WSL `dsh-harness` drops open requests. */
function requestDir() {
  const home = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh');
  return join(home, 'wsl-remote', 'requests');
}

/**
 * The Desktop executable `dsh-harness` starts from WSL. In the Desktop Host,
 * process.execPath is the Electron binary itself (run as Node); a plain Node
 * host (web/headless dsh) has no window to open, so no launcher is offered.
 */
function desktopExecutable() {
  const exe = process.execPath;
  return /\.exe$/i.test(exe) && !/[\\/]node\.exe$/i.test(exe) ? exe : undefined;
}

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

export default class WslRemoteService extends Service {
  static Config = schema.object({});

  constructor(ctx, config) {
    super(ctx, 'wslRemote');
    this.config = config;
    const { settings, migrated } = loadSettings();
    this.settings = settings;
    this.migrated = migrated;
    if (migrated) ctx.logger.info('wsl-remote: retired the startup execution-environment mode; WSL distributions are now remote connections');
    this.distros = [];
    this.discoveryError = undefined;
    this.discoveredAt = 0;
    this.discovering = undefined;
    this.connections = new Map();
    /** Bridge listeners told when a connection's state changes. */
    this.hostListeners = new Set();
    this.ready = this.discover();

    ctx.inject(['settings'], (scope) => {
      scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber), 'wsl-remote: no generated settings page');
    });

    ctx.effect(() => () => {
      for (const connection of this.connections.values()) connection.disconnect().catch(() => {});
      this.connections.clear();
    }, 'wsl-remote: connections');

    /** Folders `dsh-harness` asked to open, newest last; the client consumes them. */
    this.openRequests = [];
    this.windowsExe = process.platform === 'win32' ? desktopExecutable() : undefined;
    if (this.windowsExe !== undefined) {
      ctx.effect(() => watchRequests(requestDir(), (request) => this.openRequest(request), ctx.logger), 'wsl-remote: dsh-harness requests');
    }

    this.ready.then(() => {
      for (const distro of this.settings.autoConnect) {
        if (this.distros.some((entry) => entry.name === distro)) this.connection(distro).connect().catch(() => {});
      }
    });

    // The merge: WSL sessions and workspaces in this window.
    this.bridge = new WslBridge({
      logger: ctx.logger,
      hosts: {
        distros: () => this.distros.map((entry) => entry.name),
        connected: (distro) => this.connections.get(distro)?.state === 'connected',
        url: (distro) => this.connections.get(distro)?.openUrl(),
        ensure: (distro) => this.ensureConnected(distro),
        subscribe: (listener) => {
          this.hostListeners.add(listener);
          return () => this.hostListeners.delete(listener);
        },
        loadOrder: () => this.settings.workspaceOrder ?? [],
        saveOrder: (order) => this.save({ ...this.settings, workspaceOrder: order }),
      },
      windows: {
        knows: async (sessionId) => {
          if (ctx.get('sessions')?.get(sessionId) !== undefined) return true;
          return (await ctx.get('sessionPersistence')?.stat?.(sessionId)) !== undefined;
        },
        workspaces: () => {
          const registry = ctx.get('workspaceRegistry');
          if (registry === undefined) return undefined;
          try {
            return {
              items: registry.list().map((workspace) => ({
                workspaceId: workspace.id,
                path: workspace.path,
                title: workspace.title,
                sessionIds: [...workspace.sessionIds],
                createdAt: workspace.createdAt,
                updatedAt: workspace.updatedAt,
              })),
              archivedSessionIds: [...registry.archivedSessionIds],
              pinnedSessionIds: [...registry.pinnedSessionIds],
            };
          } catch {
            return undefined;
          }
        },
      },
    });
    ctx.effect(() => {
      this.bridge.start();
      return () => this.bridge.stop();
    }, 'wsl-remote: WSL session bridge');
    // Plugin installs into a distribution, as background jobs the WSL plugins panel polls.
    this.installs = new PluginInstalls({ client: (distro) => this.bridge.client(distro), events: this.bridge });
    ctx.effect(() => () => this.installs.dispose(), 'wsl-remote: plugin installs');
    ctx.inject(['typertGateway'], (scope) => {
      scope.effect(() => wrapGateway(scope.typertGateway, this.bridge), 'wsl-remote: Gateway merge');
    });
    ctx.inject(['connection'], (scope) => {
      scope.effect(() => wrapFetchRoutes(scope.connection, this.bridge), 'wsl-remote: Fetch route merge');
    });
    // Plugin routes (e.g. a file-tree sidebar's /sidebar/*) of WSL sessions are answered by the same plugin in WSL.
    ctx.inject(['connection', 'webServer'], (scope) => {
      scope.effect(() => new RouteForwarder({ bridge: this.bridge, connection: scope.connection, logger: ctx.logger }).install(scope.webServer), 'wsl-remote: plugin route merge');
    });

    ctx.inject(['tools'], (scope) => {
      scope.tools.register({
        name: 'wsl_remote_connections',
        description: 'List WSL remote connections: each WSL 2 distribution runs the user\'s own DeepSeek Harness (its WSL `dsh`, with its own models, plugins, sessions and Linux files); its WSL workspaces and sessions appear in this window. Reports connection state, the WSL dsh version and whether sign-in is shared with Windows. Read-only; connecting is a user action in Settings → General.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
        isConcurrencySafe: () => true,
        execute: async () => this.status(),
      });
    });

    ctx.inject(['connection'], (scope) => {
      const route = (path, methods, handler) => scope.connection.fetch.register({
        path: `${ROUTE}/${path}`,
        methods,
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return json(await handler(request));
          } catch (error) {
            return json({ error: error.message }, 400);
          }
        },
      });
      route('connections', ['GET'], () => this.status());
      route('connect', ['POST'], async (request) => {
        const { distro } = await body(request);
        await this.known(distro);
        this.remember(distro, true);
        await this.connection(distro).connect().catch(() => {});
        return this.status();
      });
      route('disconnect', ['POST'], async (request) => {
        const { distro } = await body(request);
        await this.known(distro);
        this.remember(distro, false);
        await this.connections.get(distro)?.disconnect();
        return this.status();
      });
      route('open', ['POST'], async (request) => {
        const { distro } = await body(request);
        await this.known(distro);
        const url = this.connections.get(distro)?.openUrl();
        if (url === undefined) throw new Error(`${distro} is not connected`);
        return { url };
      });
      route('settings', ['POST'], async (request) => {
        const { shareLogin, profile } = await body(request);
        const next = { ...this.settings };
        if (typeof shareLogin === 'boolean') next.shareLogin = shareLogin;
        if (profile !== undefined) {
          if (!isProfile(profile)) throw new Error('Profile names use letters, digits, ".", "_" and "-"');
          next.profile = profile;
        }
        this.save(next);
        return this.status();
      });
      // Linux folder picker for "Add workspace → WSL: <distro>".
      route('linux/list', ['POST'], async (request) => {
        const { distro, path } = await body(request);
        await this.known(distro);
        const info = await this.distroInfo(distro);
        return listLinuxDirectory(distro, typeof path === 'string' ? path : undefined, { home: info.home });
      });
      route('linux/mkdir', ['POST'], async (request) => {
        const { distro, parent, name } = await body(request);
        await this.known(distro);
        const path = await createLinuxDirectory(distro, parent, name);
        return { path, unc: toUncPath(distro, path) };
      });
      // Badge data for every distribution, connected or not: WSL workspaces of a
      // disconnected distribution still show which OS they live on.
      route('distros', ['GET'], async () => {
        await this.fresh();
        const distros = await Promise.all(this.distros.map(async (entry) => ({
          name: entry.name,
          isDefault: entry.isDefault,
          state: this.connections.get(entry.name)?.state ?? 'disconnected',
          autoConnect: this.settings.autoConnect.includes(entry.name),
          ...(await this.distroInfo(entry.name).catch(() => ({}))),
        })));
        return { distros, workspaces: this.bridge.workspaceHosts() };
      });
      // One distribution's own model catalog, for its sessions' model picker.
      route('model-catalog', ['POST'], async (request) => {
        const { distro } = await body(request);
        await this.known(distro);
        return { catalog: await this.bridge.modelCatalog(distro) };
      });
      // Plugins of a distribution's dsh, beside this Host's: where each one is installed.
      route('plugins', ['POST'], async (request) => {
        const { distro } = await body(request);
        await this.known(distro);
        return this.pluginsOf(distro);
      });
      // Manage a distribution's plugins from this window, through that dsh's own plugin manager.
      // Enable/disable/remove answer at once; an install runs as a background job (plugins/install).
      route('plugins/change', ['POST'], async (request) => {
        const { distro, action, name, enabled } = await body(request);
        await this.known(distro);
        const calls = {
          enable: () => ['pluginManager/setBundleEnabled', { name, enabled: enabled !== false }],
          remove: () => ['pluginManager/removeBundle', { name }],
        };
        if (!(action in calls)) throw new Error(`unknown plugin action ${String(action)}`);
        if (typeof name !== 'string' || !name) throw new Error('a plugin name is required');
        const [endpoint, args] = calls[action]();
        const client = await this.bridge.client(distro);
        const result = await client.call(endpoint, { args });
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
        return { result: result.value, ...(await this.pluginsOf(distro)) };
      });
      // Start installing a plugin into a distribution; poll plugins/install-status, stop with plugins/install-cancel.
      route('plugins/install', ['POST'], async (request) => {
        const { distro, spec } = await body(request);
        await this.known(distro);
        if (typeof spec !== 'string' || !spec.trim()) throw new Error('an install spec is required');
        return { job: this.installs.start(distro, spec.trim()) };
      });
      route('plugins/install-status', ['POST'], async (request) => {
        const { id, distro } = await body(request);
        const job = typeof id === 'string' ? this.installs.get(id) : typeof distro === 'string' ? this.installs.latest(distro) : undefined;
        return { job: job ?? null };
      });
      route('plugins/install-cancel', ['POST'], async (request) => {
        const { id } = await body(request);
        if (typeof id !== 'string') throw new Error('an installation id is required');
        return { job: await this.installs.cancel(id) };
      });
      // Restart a distribution's dsh so plugin changes that wait for a restart take effect.
      route('restart', ['POST'], async (request) => {
        const { distro } = await body(request);
        await this.known(distro);
        const connection = this.connection(distro);
        await connection.disconnect();
        await connection.connect().catch(() => {});
        this.remember(distro, true);
        return this.status();
      });
      // Folders `dsh-harness` asked to open. Every window polls; the first to claim one adds it.
      route('open-requests', ['GET'], () => {
        const cutoff = Date.now() - OPEN_REQUEST_TTL_MS;
        this.openRequests = this.openRequests.filter((entry) => entry.at >= cutoff);
        return { requests: this.openRequests.map(({ id, distro, path, at }) => ({ id, distro, path, unc: toUncPath(distro, path), age: Date.now() - at })) };
      });
      route('open-requests/claim', ['POST'], async (request) => {
        const { id } = await body(request);
        const before = this.openRequests.length;
        this.openRequests = this.openRequests.filter((entry) => entry.id !== id);
        return { claimed: this.openRequests.length < before };
      });
    });
  }

  /**
   * OS name/version and home of a distribution, read once per Host run (or
   * taken from the connection probe) and cached; os-release rarely changes.
   */
  distroInfo(distro) {
    this.infoCache ??= new Map();
    const probed = this.connections.get(distro)?.facts;
    if (probed?.os && probed.home) {
      const value = { os: probed.os, home: probed.home };
      this.infoCache.set(distro, Promise.resolve(value));
      return Promise.resolve(value);
    }
    let pending = this.infoCache.get(distro);
    if (pending === undefined) {
      pending = (async () => {
        // `cat` rather than sh printf: no format string has to survive wsl.exe argument passing.
        const [osRelease, home] = await Promise.all([
          runWsl(['-d', distro, '-e', 'cat', '/etc/os-release'], { timeoutMs: 60000 }),
          runWsl(['-d', distro, '--cd', '~', '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 60000 }),
        ]);
        const os = parseOsRelease(osRelease.code === 0 ? osRelease.stdout : '');
        const linuxHome = home.stdout.trim();
        return { ...(os ? { os } : {}), ...(linuxHome.startsWith('/') ? { home: linuxHome } : {}) };
      })();
      pending.catch(() => this.infoCache.delete(distro));
      this.infoCache.set(distro, pending);
    }
    return pending;
  }

  /**
   * The plugin bundles of one distribution's dsh, each marked against this
   * Host's: installed here too (same or another version) or only there.
   * Built-in bundles that ship with dsh itself (availability `installation`,
   * not declared by the profile) are left out: both sides have them.
   */
  async pluginsOf(distro) {
    const client = await this.bridge.client(distro);
    const remote = await client.call('pluginManager/listBundles', { args: {} });
    if (!remote.ok) throw new Error(`${remote.error.code}: ${remote.error.message}`);
    let windowsBundles = [];
    try {
      // A Promise when reached through the service proxy; the list itself otherwise.
      const listed = await this.ctx.get('pluginManager')?.listBundles?.();
      if (Array.isArray(listed)) windowsBundles = listed;
    } catch {}
    return { distro, ...comparePlugins(remote.value, windowsBundles) };
  }

  /** Run one discovery (single-flight). A failure keeps the previous list and records the reason. */
  discover() {
    if (process.platform !== 'win32') return Promise.resolve();
    this.discovering ??= (async () => {
      try {
        this.distros = await listDistros();
        this.discoveryError = undefined;
      } catch (error) {
        this.discoveryError = error.message;
        this.ctx.logger.warn(`wsl-remote: WSL discovery failed: ${error.message}`);
      } finally {
        this.discoveredAt = Date.now();
        this.discovering = undefined;
      }
    })();
    return this.discovering;
  }

  /** Re-discover when the last result is stale; empty or failed results go stale quickly. */
  async fresh() {
    await this.ready;
    const ttl = this.distros.length === 0 || this.discoveryError !== undefined ? RETRY_TTL_MS : DISCOVERY_TTL_MS;
    if (Date.now() - this.discoveredAt >= ttl) await this.discover();
  }

  save(next) {
    this.settings = writeSettings(next);
  }

  remember(distro, connect) {
    const set = new Set(this.settings.autoConnect);
    if (connect) set.add(distro);
    else set.delete(distro);
    this.save({ ...this.settings, autoConnect: [...set] });
  }

  async known(distro) {
    await this.fresh();
    if (isDistro(distro) && !this.distros.some((entry) => entry.name === distro)) await this.discover();
    if (!isDistro(distro) || !this.distros.some((entry) => entry.name === distro)) throw new Error(`Unknown WSL distribution: ${String(distro)}`);
  }

  connection(distro) {
    let connection = this.connections.get(distro);
    if (connection === undefined) {
      connection = new RemoteConnection({
        distro,
        packageDir,
        logger: this.ctx.logger,
        settings: () => this.settings,
        rememberPort: (name, port) => this.save({ ...this.settings, ports: { ...this.settings.ports, [name]: port } }),
        credentials: () => this.ctx.get('credentials'),
        launcher: this.windowsExe === undefined ? undefined : { windowsExe: this.windowsExe, requestDir: requestDir() },
        onCredentialEvents: (onRecord, onRef) => {
          const offRecord = this.ctx.on('credentials/record-updated', onRecord);
          const offRef = this.ctx.on('credentials/reference-updated', onRef);
          return () => {
            offRecord();
            offRef();
          };
        },
      });
      connection.on('change', () => {
        for (const listener of this.hostListeners) {
          try {
            listener();
          } catch {}
        }
      });
      this.connections.set(distro, connection);
    }
    return connection;
  }

  /**
   * Make a distribution's dsh reachable for the bridge: connect it (and
   * remember it for the next start) when the user opens a WSL session of a
   * disconnected distribution.
   */
  async ensureConnected(distro) {
    const connection = this.connection(distro);
    if (connection.state === 'connected') return;
    await this.known(distro);
    if (!this.settings.autoConnect.includes(distro)) this.remember(distro, true);
    await connection.connect();
    if (connection.state !== 'connected') throw new Error(connection.error ?? `${distro} is not connected`);
  }

  /**
   * `dsh-harness <path>` ran in WSL. Remember the folder for the client to add as
   * a WSL workspace, and connect the distribution if it is not connected yet.
   */
  async openRequest({ distro, path }) {
    await this.fresh();
    if (!this.distros.some((entry) => entry.name === distro)) await this.discover();
    if (!this.distros.some((entry) => entry.name === distro)) throw new Error(`unknown WSL distribution ${distro}`);
    this.ctx.logger.info(`wsl-remote: dsh-harness asked to open ${distro}:${path}`);
    this.openRequests.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, distro, path, at: Date.now() });
    if (this.openRequests.length > 20) this.openRequests.shift();
    this.ctx.emit?.('wsl-remote/open-request', { distro, path });
    const connection = this.connection(distro);
    if (connection.state !== 'connected' && connection.state !== 'connecting') {
      this.remember(distro, true);
      connection.connect().catch(() => {});
    }
  }

  /** Everything the Settings rows and the model tool show (never a token). */
  async status() {
    await this.fresh();
    return {
      platform: process.platform,
      ...(this.discoveryError !== undefined ? { discoveryError: this.discoveryError } : {}),
      minimumDsh: MIN_DSH_VERSION,
      shareLogin: this.settings.shareLogin,
      profile: this.settings.profile,
      credentialsAvailable: this.ctx.get('credentials') !== undefined,
      launcherAvailable: this.windowsExe !== undefined,
      ...(this.migrated ? { migratedFromStartupMode: true } : {}),
      distros: this.distros.map((entry) => ({
        isDefault: entry.isDefault,
        autoConnect: this.settings.autoConnect.includes(entry.name),
        ...(this.connections.get(entry.name)?.snapshot() ?? { name: entry.name, state: 'disconnected' }),
      })),
    };
  }
}
