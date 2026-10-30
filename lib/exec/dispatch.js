/**
 * Execution-world dispatchers: the single `ctx.subprocess`, `ctx.sandbox`,
 * `ctx.fs` and `ctx.shell` of this composition, routing every call to the
 * shipped Windows provider or to one WSL distribution by the path it names.
 *
 *  - Windows calls reach the exact shipped classes (dsh-subprocess-local,
 *    dsh-sandbox-local, dsh-fs-sandbox, dsh-pwsh-sandbox) with the shipped
 *    configuration, mounted privately below this plugin.
 *  - A path under `\\wsl.localhost\<distro>\` (or a Linux path resolved
 *    against such a cwd) reaches that distribution's providers: DeepSeek
 *    Harness's own POSIX helper, started in the distribution through
 *    `wsl.exe` stdio (lib/exec/connection.js), wrapped by the WSL path
 *    translators (lib/exec/providers.js); bubblewrap confines commands there.
 *
 * Each world is mounted in isolation realms of its own, so its service names
 * never collide with the public ones the dispatchers provide.
 */
import { Duplex, PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Service } from '@deepseek-ai/cordis';
import schema from '@deepseek-ai/schemastery';
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox';
import { FileSystem } from '@deepseek-ai/dsh-fs';
import { ShellExecutor } from '@deepseek-ai/dsh-shell';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local';
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox';
import { SandboxPwshExecutor } from '@deepseek-ai/dsh-pwsh-sandbox';
import { WslConnection } from './connection.js';
import { WslFileSystem, WslSandboxProvider, WslShellExecutor, WslSubprocessRuntime } from './providers.js';
import { distroOf, isLinuxAbsolute, worldOf } from './route.js';

const SERVICES = ['subprocess', 'sandbox', 'fs', 'shell', 'ssh'];
const MOUNT_TIMEOUT_MS = 30000;

/** Isolate every execution service name, so a nested stack neither sees nor shadows the public ones. */
function isolated(ctx) {
  let scope = ctx;
  for (const name of SERVICES) scope = scope.isolate(name);
  return scope;
}

/**
 * Mount plugins in a private realm and resolve their services. A plugin that
 * fails to construct only logs in Cordis, so the wait is bounded.
 */
function mountWorld(ctx, label, plugins, names) {
  const scope = isolated(ctx);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} execution providers did not start within ${MOUNT_TIMEOUT_MS / 1000} s; see the DeepSeek Harness log`)), MOUNT_TIMEOUT_MS);
    timer.unref?.();
    try {
      for (const [plugin, config] of plugins) scope.plugin(plugin, config);
      scope.inject(names, (inner) => {
        clearTimeout(timer);
        resolve(Object.fromEntries(names.map((name) => [name, inner[name]])));
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** `\\wsl.localhost\<distro>\…` spelling of a Linux path. */
export function uncOf(distro, linux) {
  if (!isLinuxAbsolute(linux)) return linux;
  return `\\\\wsl.localhost\\${distro}${linux === '/' ? '\\' : linux.replace(/\/+$/, '').replace(/\//g, '\\')}`;
}

/**
 * The worlds behind the dispatchers, shared by all four (`ctx.wslExec`).
 * Ready worlds are also kept synchronously, because `processPath`,
 * `contains` and `shell.resolve` are synchronous seams.
 */
export class WslExecWorlds extends Service {
  static inject = ['sandboxPolicy'];

  static Config = schema.object({
    /** Windows `dsh-sandbox-local` config (the shipped `sandbox` row). */
    sandbox: schema.any(),
    /** Windows `dsh-fs-sandbox` config (the shipped `fs-sandbox` row). */
    fs: schema.any(),
    /** Windows `dsh-pwsh-sandbox` config (the shipped `pwsh-sandbox` row). */
    pwsh: schema.any(),
    /** `dsh-bash-sandbox` config for commands run in WSL. */
    bash: schema.any(),
  });

  constructor(ctx, config) {
    super(ctx, 'wslExec');
    // Calls through the context proxy see `this.ctx` as the caller's traced
    // context; plugins mounted from that never activate. Mount from our own.
    this.home = ctx;
    this.config = config ?? {};
    this.pending = new Map();
    this.ready = new Map();
    this.locator = undefined;
    // The Windows world is what every ordinary session uses: start it with the Host, not on first call.
    this.world(undefined).catch((error) => this.home.logger.error(`wsl-remote: Windows execution providers failed to start: ${error.message}`));
  }

  /** The Host plugin supplies where a distribution's Linux runtime is (deploying it when needed). */
  setLocator(locator) {
    this.locator = locator;
  }

  /** Synchronous view of a mounted world, or undefined when it is not ready. */
  readyWorld(distro) {
    return this.ready.get(distro ?? '');
  }

  /** Mounted world for a distribution (undefined = Windows), mounting it on first use. */
  world(distro) {
    const key = distro ?? '';
    const ready = this.ready.get(key);
    if (ready !== undefined) return Promise.resolve(ready);
    let pending = this.pending.get(key);
    if (pending === undefined) {
      pending = (distro === undefined ? this.mountWindows() : this.mountWsl(distro)).then((world) => {
        this.ready.set(key, world);
        this.pending.delete(key);
        return world;
      }, (error) => {
        this.pending.delete(key);
        throw error;
      });
      this.pending.set(key, pending);
    }
    return pending;
  }

  mountWindows() {
    const { sandbox = {}, fs = {}, pwsh = {} } = this.config;
    return mountWorld(this.home, 'Windows', [
      [LocalSubprocessRuntime, undefined],
      [LocalSandboxProvider, sandbox],
      [SandboxedFileSystem, fs],
      [SandboxPwshExecutor, pwsh],
    ], ['subprocess', 'sandbox', 'fs', 'shell']);
  }

  async mountWsl(distro) {
    if (this.locator === undefined) throw new Error(`WSL execution for ${distro} is not available yet`);
    const located = await this.locator(distro);
    const world = await mountWorld(this.home, `WSL ${distro}`, [
      [WslConnection, { distro, node: located.node, serverDir: located.serverDir, ...(located.shell ? { shell: located.shell } : {}) }],
      [WslSubprocessRuntime, undefined],
      [WslSandboxProvider, undefined],
      [WslFileSystem, undefined],
      [WslShellExecutor, this.config.bash ?? { timeoutMs: 60000 }],
    ], ['subprocess', 'sandbox', 'fs', 'shell', 'ssh']);
    return { ...world, distro };
  }
}

/** Forward a pending subprocess handle synchronously, as the seam requires. */
function deferredHandle(pending, spec) {
  let real;
  const ready = pending.then((handle) => {
    real = handle;
    return handle;
  });
  ready.catch(() => {});
  const empty = { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) };
  const collected = {};
  for (const name of ['stdout', 'stderr']) {
    if (spec.stdio?.[name] !== null && typeof spec.stdio?.[name] === 'object') collected[name] = { readFrom: (offset) => (real?.collected?.[name] ?? empty).readFrom(offset) };
  }
  const piped = (name) => {
    if (spec.stdio?.[name] !== 'pipe') return undefined;
    const stream = new PassThrough();
    stream.on('error', () => {});
    ready.then((handle) => {
      const other = handle[name];
      if (other === undefined) return stream.end();
      if (name === 'stdin') stream.pipe(other);
      else other.pipe(stream);
    }, (error) => stream.destroy(error));
    return stream;
  };
  let controlStream;
  if (spec.stdio?.control === 'pipe') {
    const toReal = new PassThrough();
    const fromReal = new PassThrough();
    controlStream = Duplex.from({ writable: toReal, readable: fromReal });
    controlStream.on('error', () => {});
    ready.then((handle) => {
      if (handle.control === undefined) {
        fromReal.end();
        return;
      }
      toReal.pipe(handle.control);
      handle.control.pipe(fromReal);
    }, (error) => fromReal.destroy(error));
  }
  let terminated = false;
  return {
    stdin: piped('stdin'),
    stdout: piped('stdout'),
    stderr: piped('stderr'),
    control: controlStream,
    collected,
    done: ready.then((handle) => handle.done),
    terminate() {
      if (terminated) return;
      terminated = true;
      ready.then((handle) => handle.terminate(), () => {});
    },
    async waitForExit(signal) {
      let handle;
      try {
        handle = await ready;
      } catch {
        return true;
      }
      return handle.waitForExit(signal);
    },
  };
}

/** A spawn belongs to its cwd's world (a UNC argv[0] also names one). */
function spawnWorld(spec) {
  return distroOf(spec?.cwd) ?? distroOf(spec?.argv?.[0]);
}

export class DispatchSubprocess extends SubprocessRuntime {
  static inject = ['wslExec'];

  spawn(spec) {
    const distro = spawnWorld(spec);
    const ready = this.ctx.wslExec.readyWorld(distro);
    // The common case (a mounted world) returns the provider's own handle unchanged.
    if (ready !== undefined) return ready.subprocess.spawn(spec);
    return deferredHandle(this.ctx.wslExec.world(distro).then((world) => world.subprocess.spawn(spec)), spec);
  }

  async resolveExecutable(command, env, signal) {
    return (await this.ctx.wslExec.world(distroOf(command))).subprocess.resolveExecutable(command, env, signal);
  }

  async terminalEnvironment(signal) {
    return (await this.ctx.wslExec.world(undefined)).subprocess.terminalEnvironment(signal);
  }

  async spawnTerminal(spec) {
    return (await this.ctx.wslExec.world(spawnWorld(spec))).subprocess.spawnTerminal(spec);
  }
}

export class DispatchSandbox extends SandboxProvider {
  static inject = ['wslExec'];

  /** A policy's workspace root (the Session cwd for tool calls) names its world. */
  async confine(argv, policy, signal) {
    return (await this.ctx.wslExec.world(distroOf(policy?.workspaceRoot))).sandbox.confine(argv, policy, signal);
  }
}

/**
 * `ctx.fs` dispatcher. Targets are opaque per provider, so every target this
 * dispatcher hands out carries its world, and for WSL the provider's own
 * target, in non-enumerable properties; operations on it return to the
 * provider that resolved it with that original target. WSL targets show their
 * `\\wsl.localhost` spelling, so displayed paths can be passed back.
 */
const WORLD = Symbol.for('wsl-remote.world');
const INNER = Symbol.for('wsl-remote.inner-target');

function tag(target, distro, inner) {
  if (target !== null && typeof target === 'object') {
    Object.defineProperty(target, WORLD, { value: distro ?? null, enumerable: false, configurable: true });
    if (inner !== undefined) Object.defineProperty(target, INNER, { value: inner, enumerable: false, configurable: true });
  }
  return target;
}

function targetWorld(target) {
  if (target !== null && typeof target === 'object' && Object.hasOwn(target, WORLD)) return target[WORLD] ?? undefined;
  return distroOf(target?.displayPath);
}

/** The target the owning provider issued (the dispatcher's copy only differs in displayPath). */
function innerTarget(target) {
  if (target !== null && typeof target === 'object' && Object.hasOwn(target, INNER)) return target[INNER];
  // A target rebuilt from JSON: a WSL key is the Linux path; let the provider re-display it.
  return target;
}

function wslTarget(distro, target) {
  return tag({ ...target, displayPath: uncOf(distro, String(target.targetKey)) }, distro, target);
}

export class DispatchFileSystem extends FileSystem {
  static inject = ['wslExec', 'sandboxPolicy'];

  get sandboxMode() {
    return this.ctx.sandboxPolicy.defaultMode;
  }

  async provider(distro) {
    return (await this.ctx.wslExec.world(distro)).fs;
  }

  syncProvider(distro) {
    return this.ctx.wslExec.readyWorld(distro)?.fs;
  }

  async resolve(path, opts) {
    const distro = worldOf(path, opts?.cwd);
    const target = await (await this.provider(distro)).resolve(path, opts);
    return distro === undefined ? tag(target, undefined) : wslTarget(distro, target);
  }

  async lstat(path, opts, signal) {
    return (await this.provider(worldOf(path, opts?.cwd))).lstat(path, opts, signal);
  }

  /** WSL targets keep the Windows spelling Host services (working directory, policy, workspace views) expect. */
  processPath(target) {
    const distro = targetWorld(target);
    if (distro !== undefined) return uncOf(distro, String(target.targetKey));
    const fs = this.syncProvider(undefined);
    return fs === undefined ? String(target.targetKey) : fs.processPath(target);
  }

  processPathFromHostPath(hostPath) {
    if (distroOf(hostPath) !== undefined) return hostPath;
    return this.syncProvider(undefined)?.processPathFromHostPath(hostPath);
  }

  fileUrl(target) {
    const distro = targetWorld(target);
    if (distro === undefined) return this.syncProvider(undefined)?.fileUrl(target) ?? pathToFileURL(String(target.targetKey)).href;
    return pathToFileURL(uncOf(distro, String(target.targetKey))).href;
  }

  contains(parent, child) {
    const world = targetWorld(parent);
    if (world !== targetWorld(child)) return false;
    const fs = this.syncProvider(world);
    return fs === undefined ? false : fs.contains(innerTarget(parent), innerTarget(child));
  }

  async onTarget(target, call) {
    const distro = targetWorld(target);
    return call(await this.provider(distro), innerTarget(target), distro);
  }

  stat(target, signal) {
    return this.onTarget(target, (fs, inner) => fs.stat(inner, signal));
  }

  readText(target, signal) {
    return this.onTarget(target, (fs, inner) => fs.readText(inner, signal));
  }

  streamText(target, signal) {
    return this.onTarget(target, (fs, inner) => fs.streamText(inner, signal));
  }

  readBytes(target, signal, maxBytes) {
    return this.onTarget(target, (fs, inner) => fs.readBytes(inner, signal, maxBytes));
  }

  readByteRange(target, range, signal) {
    return this.onTarget(target, (fs, inner) => fs.readByteRange(inner, range, signal));
  }

  listDir(target, signal) {
    return this.onTarget(target, async (fs, inner, distro) => {
      const entries = await fs.listDir(inner, signal);
      return entries.map((entry) => ({ ...entry, target: distro === undefined ? tag(entry.target, undefined) : wslTarget(distro, entry.target) }));
    });
  }

  writeText(target, content, expected, signal, sandboxPolicy) {
    return this.onTarget(target, (fs, inner) => fs.writeText(inner, content, expected, signal, sandboxPolicy));
  }

  editText(target, edit, expected, signal, sandboxPolicy) {
    return this.onTarget(target, (fs, inner) => fs.editText(inner, edit, expected, signal, sandboxPolicy));
  }

  watch(target, changed, signal) {
    return this.onTarget(target, (fs, inner) => fs.watch(inner, changed, signal));
  }
}

/**
 * `ctx.shell` dispatcher. A command whose working directory is in WSL runs
 * through the WSL bash executor (bubblewrap confined); everything else runs
 * through the shipped PowerShell executor. `resolve` is synchronous, so a
 * world that is still mounting resolves at execute time instead.
 */
const DEFERRED = Symbol.for('wsl-remote.deferred-shell-request');

export class DispatchShell extends ShellExecutor {
  static inject = ['wslExec', 'sandboxPolicy'];

  get sandboxMode() {
    return this.ctx.sandboxPolicy.defaultMode;
  }

  static worldOf(request) {
    return distroOf(request.workdir) ?? distroOf(request.sandboxPolicy?.workspaceRoot);
  }

  resolve(request) {
    const distro = DispatchShell.worldOf(request);
    const shell = this.ctx.wslExec.readyWorld(distro)?.shell;
    if (shell === undefined) return { ...request, workdir: request.workdir ?? '', timeoutMs: request.timeoutMs ?? 120000, onExpiry: request.onExpiry ?? 'kill', [DEFERRED]: { distro, request } };
    return shell.resolve(request);
  }

  async execute(spec) {
    const deferred = spec[DEFERRED];
    const distro = deferred === undefined ? DispatchShell.worldOf(spec) : deferred.distro;
    const world = await this.ctx.wslExec.world(distro);
    if (deferred === undefined) return world.shell.execute(spec);
    // Keep fields the tool layer added after resolve (signal, onExpiry for background jobs).
    const { [DEFERRED]: _drop, ...rest } = spec;
    return world.shell.execute(world.shell.resolve({ ...deferred.request, ...pick(rest, ['signal', 'onExpiry', 'sandboxPolicy', 'dshEnv', 'env', 'stdin']) }));
  }
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]));
}
