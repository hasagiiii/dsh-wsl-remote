/**
 * Resolve the plugin bundle that owns one configurable model provider.
 *
 * `llm/listConfigurableProviders` deliberately exposes no package ownership.
 * `pluginManager/listBundles` exposes the composition patch rows instead; a
 * provider's settings namespace is an exact patch row id. This module joins
 * those two descriptors and never derives a package name from a provider name.
 *
 * The call boundary is the same as the model service: `call(host, endpoint,
 * args)` returns `{ ok: true, value }` or `{ ok: false, error }`. `null` is
 * the Windows host and a distribution name is a WSL host.
 */

const DIRECTIONS = new Set(['windows-to-wsl', 'wsl-to-windows']);
const LOCAL_SPEC = /^(link|file):(.*)$/is;
const WINDOWS_PATH = /^([A-Za-z]):[\\/](.*)$/s;
const WSL_MOUNT = /^\/mnt\/([A-Za-z])(?:\/(.*))?$/s;

export class ModelPluginError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ModelPluginError';
    this.code = code;
    this.details = details;
  }
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectorError(selector, reason) {
  return {
    status: 'blocked',
    targetState: 'unavailable',
    reason,
    selector: record(selector) ? { ...selector } : selector,
  };
}

function hostPair(selector) {
  if (!record(selector) || typeof selector.distro !== 'string' || selector.distro.trim() === '') {
    return { error: selectorError(selector, 'invalid-distro') };
  }
  if (!DIRECTIONS.has(selector.direction)) {
    return { error: selectorError(selector, 'invalid-direction') };
  }
  if (typeof selector.provider !== 'string' || selector.provider.length === 0 ||
      typeof selector.settingsNs !== 'string' || selector.settingsNs.length === 0) {
    return { error: selectorError(selector, 'invalid-provider-selector') };
  }
  return selector.direction === 'windows-to-wsl'
    ? { sourceHost: null, targetHost: selector.distro }
    : { sourceHost: selector.distro, targetHost: null };
}

function resultValue(reply) {
  if (reply?.ok === true) return { value: reply.value };
  const error = reply?.error;
  return {
    error: {
      code: typeof error?.code === 'string' ? error.code : 'call-failed',
      message: typeof error?.message === 'string' ? error.message : 'remote call failed',
    },
  };
}

function exactProvider(entries, provider, settingsNs) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry?.provider === provider && entry?.settingsNs === settingsNs);
}

function owners(bundles, settingsNs) {
  if (!Array.isArray(bundles)) return [];
  return bundles.filter((bundle) => Array.isArray(bundle?.rows) &&
    bundle.rows.some((row) => row?.rowId === settingsNs));
}

function bundleError(bundle) {
  const error = bundle?.error;
  if (typeof error === 'string') return error;
  if (record(error)) return error.diagnostic ?? error.code ?? 'bundle-error';
  return undefined;
}

function isLocalSource(source) {
  return typeof source === 'string' && LOCAL_SPEC.exec(source) !== null;
}

/**
 * Map one recorded local pnpm spec between the two supported platforms.
 * Registry and git specs are returned byte-for-byte. Native Linux paths have
 * no safe Windows counterpart and are rejected instead of being guessed.
 */
export function mapModelPluginInstallSpec(source, direction) {
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, reason: 'source-install-spec-missing' };
  }
  if (!DIRECTIONS.has(direction)) return { ok: false, reason: 'invalid-direction' };
  const local = LOCAL_SPEC.exec(source);
  if (local === null) return { ok: true, spec: source };
  const protocol = local[1].toLowerCase();
  const path = local[2];
  if (direction === 'windows-to-wsl') {
    const windows = WINDOWS_PATH.exec(path);
    if (windows === null) return { ok: false, reason: 'unsupported-source-platform', source };
    return {
      ok: true,
      spec: `${protocol}:/mnt/${windows[1].toLowerCase()}/${windows[2].replaceAll('\\', '/')}`,
    };
  }
  const wsl = WSL_MOUNT.exec(path);
  if (wsl === null) return { ok: false, reason: 'unsupported-source-platform', source };
  const tail = (wsl[2] ?? '').replaceAll('/', '\\');
  return { ok: true, spec: `${protocol}:${wsl[1].toUpperCase()}:\\${tail}` };
}

function copyBundle(bundle) {
  if (!record(bundle)) return undefined;
  return {
    name: bundle.name,
    ...(bundle.version === undefined ? {} : { version: bundle.version }),
    ...(bundle.source === undefined ? {} : { source: bundle.source }),
    ...(bundle.availability === undefined ? {} : { availability: bundle.availability }),
    ...(bundle.enabled === undefined ? {} : { enabled: Boolean(bundle.enabled) }),
    ...(bundle.installed === undefined ? {} : { installed: Boolean(bundle.installed) }),
    ...(bundle.error === undefined ? {} : { error: bundle.error }),
  };
}

function selectorOf(selector) {
  return {
    distro: selector.distro,
    direction: selector.direction,
    provider: selector.provider,
    settingsNs: selector.settingsNs,
  };
}

/**
 * Create the provider-plugin planning service. Planning performs four read-only
 * calls. `install` re-plans before executing one of the plugin-manager actions,
 * so a stale UI plan cannot install an unrelated package.
 */
export function createModelPluginService({ call }) {
  if (typeof call !== 'function') throw new TypeError('model plugin service requires call');

  async function read(host, endpoint) {
    let reply;
    try {
      reply = await call(host, endpoint, {});
    } catch (error) {
      return { error: { code: 'call-failed', message: error instanceof Error ? error.message : String(error) } };
    }
    return resultValue(reply);
  }

  async function plan(selector) {
    const pair = hostPair(selector);
    if (pair.error !== undefined) return pair.error;
    const selected = selectorOf(selector);
    const [sourceProviders, sourceBundles, targetProviders, targetBundles] = await Promise.all([
      read(pair.sourceHost, 'llm/listConfigurableProviders'),
      read(pair.sourceHost, 'pluginManager/listBundles'),
      read(pair.targetHost, 'llm/listConfigurableProviders'),
      read(pair.targetHost, 'pluginManager/listBundles'),
    ]);
    for (const [side, result] of [['source', sourceProviders], ['source', sourceBundles], ['target', targetProviders], ['target', targetBundles]]) {
      if (result.error !== undefined) {
        return {
          status: 'blocked',
          targetState: 'unavailable',
          reason: `${side}-unavailable`,
          error: result.error,
          selector: selected,
        };
      }
    }

    const sourceEntries = exactProvider(sourceProviders.value, selector.provider, selector.settingsNs);
    if (sourceEntries.length === 0) return { status: 'blocked', targetState: 'unavailable', reason: 'source-provider-unavailable', selector: selected };
    if (sourceEntries.length > 1) return { status: 'blocked', targetState: 'unavailable', reason: 'source-provider-ambiguous', selector: selected, count: sourceEntries.length };
    const sourceOwners = owners(sourceBundles.value, selector.settingsNs);
    if (sourceOwners.length === 0) return { status: 'blocked', targetState: 'unavailable', reason: 'source-owner-unavailable', selector: selected };
    if (sourceOwners.length > 1) return { status: 'blocked', targetState: 'unavailable', reason: 'source-owner-ambiguous', selector: selected, count: sourceOwners.length };
    const sourceBundle = sourceOwners[0];
    const sourceError = bundleError(sourceBundle);
    if (sourceError !== undefined) return { status: 'blocked', targetState: 'unavailable', reason: 'source-owner-unavailable', error: sourceError, selector: selected, sourceBundle: copyBundle(sourceBundle) };
    const targetOwners = owners(targetBundles.value, selector.settingsNs);
    const common = {
      selector: selected,
      sourceHost: pair.sourceHost,
      targetHost: pair.targetHost,
      sourceProvider: sourceEntries[0],
      sourceBundle: copyBundle(sourceBundle),
      sourceBundleName: sourceBundle.name,
      name: sourceBundle.name,
    };
    if (targetOwners.length > 1) return { ...common, status: 'blocked', targetState: 'unavailable', reason: 'target-owner-ambiguous', count: targetOwners.length };
    if (targetOwners.length === 1) {
      const targetBundle = targetOwners[0];
      const targetError = bundleError(targetBundle);
      if (targetError !== undefined) return { ...common, status: 'blocked', targetState: 'unavailable', reason: targetError === 'incompatible-version' || targetBundle.error?.code === 'incompatible-version' ? 'target-incompatible' : 'target-owner-unavailable', error: targetError, targetBundle: copyBundle(targetBundle) };
      if (!targetBundle.enabled) return { ...common, status: 'enable', targetState: 'disabled', targetBundle: copyBundle(targetBundle), targetBundleName: targetBundle.name };
      return { ...common, status: 'available', targetState: 'available', targetBundle: copyBundle(targetBundle), targetBundleName: targetBundle.name };
    }

    // A same-named target bundle without the exact owner row is evidence of an
    // unreadable or incompatible composition; never install it by name.
    const namedTarget = Array.isArray(targetBundles.value) ? targetBundles.value.filter((bundle) => bundle?.name === sourceBundle.name) : [];
    if (namedTarget.length > 0) {
      return { ...common, status: 'blocked', targetState: 'unavailable', reason: 'target-owner-unavailable', targetBundle: copyBundle(namedTarget[0]) };
    }
    const mapped = String(selector.distro).startsWith('ssh:') && isLocalSource(sourceBundle.source)
      // Local folders do not cross between Windows and an SSH server (no shared drive).
      ? { ok: false, reason: 'unsupported-source-platform' }
      : mapModelPluginInstallSpec(sourceBundle.source, selector.direction);
    if (!mapped.ok) return { ...common, status: 'blocked', targetState: 'unavailable', reason: mapped.reason, source: sourceBundle.source };
    return { ...common, status: 'install', targetState: 'missing', installSpec: mapped.spec, spec: mapped.spec };
  }

  async function install(selector) {
    const planned = await plan(selector);
    if (planned.status === 'blocked') return planned;
    if (planned.status === 'available') return { ...planned, action: 'none' };
    if (planned.status === 'enable') {
      const reply = await call(planned.targetHost, 'pluginManager/setBundleEnabled', { name: planned.targetBundleName, enabled: true });
      return { ...planned, action: 'enable', result: reply };
    }
    const reply = await call(planned.targetHost, 'pluginManager/installBundle', {
      spec: planned.installSpec,
      options: { enabled: true },
    });
    return { ...planned, action: 'install', result: reply };
  }

  return Object.freeze({ plan, inspect: plan, install });
}

export const MODEL_PLUGIN_ENDPOINTS = Object.freeze([
  'llm/listConfigurableProviders',
  'pluginManager/listBundles',
  'pluginManager/setBundleEnabled',
  'pluginManager/installBundle',
]);
