/**
 * @local/dsh-wsl-remote — WSL remote connections (Host half).
 *
 * Modelled on the Codex desktop app's "WSL remote connections": every WSL 2
 * distribution is a separate remote host next to this Windows Host, instead
 * of one application-wide switch that needs a restart.
 *  - Connecting starts the user's own `dsh` inside the distribution through
 *    the stdio of `wsl.exe` (no port opened by WSL); it uses the WSL
 *    `~/.dsh` profile, sessions, plugins and native ext4 files.
 *  - Its Web UI is relayed to a stable Windows loopback port and opens in the
 *    right sidebar or the system browser.
 *  - Sign-in can be shared: the WSL dsh then reads and writes credentials,
 *    including DeepSeek sign-in and token refreshes, in the Windows store
 *    under its writer lock. Turned off, each side signs in on its own.
 * Sessions stay where they started; nothing on this Host is replaced.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { listDistros } from './lib/wsl.js';
import { RemoteConnection } from './lib/remote.js';
import { MIN_DSH_VERSION } from './lib/version.js';
import { isDistro, isProfile, loadSettings, writeSettings } from './lib/state.js';

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
    this.connections = new Map();
    this.ready = this.discover().catch((error) => {
      ctx.logger.warn(`wsl-remote: WSL discovery failed: ${error.message}`);
    });

    ctx.inject(['settings'], (scope) => {
      scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber), 'wsl-remote: no generated settings page');
    });

    ctx.effect(() => () => {
      for (const connection of this.connections.values()) connection.disconnect().catch(() => {});
      this.connections.clear();
    }, 'wsl-remote: connections');

    this.ready.then(() => {
      for (const distro of this.settings.autoConnect) {
        if (this.distros.some((entry) => entry.name === distro)) this.connection(distro).connect().catch(() => {});
      }
    });

    ctx.inject(['tools'], (scope) => {
      scope.tools.register({
        name: 'wsl_remote_connections',
        description: 'List WSL remote connections: each WSL 2 distribution can run its own DeepSeek Harness (the user\'s WSL `dsh`, with its own sessions, plugins and Linux files) beside this Windows one. Reports connection state, the WSL dsh version and whether sign-in is shared with Windows. Read-only; connecting is a user action in Settings → General.',
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
    });
  }

  async discover() {
    if (process.platform !== 'win32') return;
    this.distros = await listDistros();
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
    await this.ready;
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
        onCredentialEvents: (onRecord, onRef) => {
          const offRecord = this.ctx.on('credentials/record-updated', onRecord);
          const offRef = this.ctx.on('credentials/reference-updated', onRef);
          return () => {
            offRecord();
            offRef();
          };
        },
      });
      this.connections.set(distro, connection);
    }
    return connection;
  }

  /** Everything the Settings rows and the model tool show (never a token). */
  async status() {
    await this.ready;
    return {
      platform: process.platform,
      minimumDsh: MIN_DSH_VERSION,
      shareLogin: this.settings.shareLogin,
      profile: this.settings.profile,
      credentialsAvailable: this.ctx.get('credentials') !== undefined,
      ...(this.migrated ? { migratedFromStartupMode: true } : {}),
      distros: this.distros.map((entry) => ({
        isDefault: entry.isDefault,
        autoConnect: this.settings.autoConnect.includes(entry.name),
        ...(this.connections.get(entry.name)?.snapshot() ?? { name: entry.name, state: 'disconnected' }),
      })),
    };
  }
}
