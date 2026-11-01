import { randomUUID } from 'node:crypto';

/**
 * Configuration-only model/provider synchronisation over the Remote API.
 *
 * The service deliberately keeps the call boundary small. `call` receives the
 * host (`null` for the Windows host or a WSL distribution name), the canonical
 * endpoint, and the endpoint's named arguments. It returns the normal Remote
 * envelope: `{ ok: true, value }` or `{ ok: false, error }`.
 */

const REF = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CREDENTIAL_BATCH = 64;
const DIRECTIONS = new Set(['windows-to-wsl', 'wsl-to-windows']);

const ENDPOINTS = Object.freeze({
  'llm/listProviders': (args) => emptyArgs(args),
  'llm/listConfigurableProviders': (args) => emptyArgs(args),
  'credentials/describe': (args) => {
    objectArgs(args, ['refs']);
    if (!Array.isArray(args.refs) || args.refs.length > CREDENTIAL_BATCH || args.refs.some((ref) => typeof ref !== 'string' || !REF.test(ref))) invalid('credentials/describe.refs', 'an array of at most 64 credential reference names');
  },
  'credentials/set': (args) => {
    objectArgs(args, ['ref', 'value']);
    if (typeof args.ref !== 'string' || !REF.test(args.ref)) invalid('credentials/set.ref', 'a valid credential reference name');
    if (typeof args.value !== 'string' || args.value.length === 0) invalid('credentials/set.value', 'a non-empty string');
  },
  'credentials/unset': (args) => {
    objectArgs(args, ['ref']);
    if (typeof args.ref !== 'string' || !REF.test(args.ref)) invalid('credentials/unset.ref', 'a valid credential reference name');
  },
  'settings/describe': (args) => emptyArgs(args),
  'settings/mutate': (args) => {
    objectArgs(args, ['ns', 'ops', 'expectedRevision']);
    if (typeof args.ns !== 'string' || args.ns.length === 0) invalid('settings/mutate.ns', 'a non-empty string');
    if (!Array.isArray(args.ops) || args.ops.some((op) => !validOperation(op))) invalid('settings/mutate.ops', 'an array of valid set/unset path operations');
    if (args.expectedRevision !== undefined && (!Number.isFinite(args.expectedRevision) || args.expectedRevision < 0)) invalid('settings/mutate.expectedRevision', 'a non-negative number');
  },
  'llm/discoverModels': (args) => {
    objectArgs(args, ['settingsNs', 'request']);
    if (typeof args.settingsNs !== 'string' || args.settingsNs.length === 0) invalid('llm/discoverModels.settingsNs', 'a non-empty string');
    if (!isRecord(args.request)) invalid('llm/discoverModels.request', 'an object');
    objectArgs(args.request, ['provider', 'baseURL', 'api', 'apiKey']);
    for (const key of ['provider', 'baseURL', 'api', 'apiKey']) if (args.request[key] !== undefined && typeof args.request[key] !== 'string') invalid(`llm/discoverModels.request.${key}`, 'a string');
  },
  'session/modelCatalog': (args) => emptyArgs(args),
});

export class ModelServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ModelServiceError';
    this.code = code;
    this.details = details;
  }
}

function invalid(field, expected) {
  throw new ModelServiceError('models/arguments-invalid', `${field} must be ${expected}`, { field });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function objectArgs(value, allowed) {
  if (!isRecord(value)) invalid('args', 'an object');
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key) || value[key] === undefined) invalid(`args.${key}`, 'an allowed, defined field');
}

function emptyArgs(value) {
  objectArgs(value, []);
}

function validPath(path) {
  return Array.isArray(path) && path.every((part) => typeof part === 'string' && !['__proto__', 'prototype', 'constructor'].includes(part));
}

function validJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validJson);
  if (isRecord(value)) return Object.values(value).every(validJson);
  return false;
}

function validOperation(operation) {
  if (!isRecord(operation) || !['set', 'unset'].includes(operation.op) || !validPath(operation.path)) return false;
  if (operation.op === 'set' && (!Object.hasOwn(operation, 'value') || !validJson(operation.value))) return false;
  return Object.keys(operation).every((key) => key === 'op' || key === 'path' || (key === 'value' && operation.op === 'set'));
}

function hostOf(host) {
  if (host !== null && (typeof host !== 'string' || host.length === 0)) throw new ModelServiceError('models/host-invalid', 'host must be null or a non-empty distribution name');
  return host;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) for (const item of value) freeze(item);
  else for (const item of Object.values(value)) freeze(item);
  return value;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getPath(value, path) {
  let current = value;
  for (const part of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = Object.hasOwn(current, part) ? current[part] : undefined;
  }
  return current;
}

function hasPrefix(path, prefix) {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

function secretTouches(path, secrets) {
  return secrets.some((secret) => hasPrefix(path, secret) || hasPrefix(secret, path));
}

function keyedModels(source, target) {
  const sourceItems = Array.isArray(source) ? source : [];
  const targetItems = Array.isArray(target) ? target : [];
  const targetById = new Map(targetItems.filter((item) => isRecord(item) && typeof item.id === 'string').map((item) => [item.id, item]));
  const used = new Set();
  const result = [];
  for (const item of sourceItems) {
    const id = isRecord(item) && typeof item.id === 'string' ? item.id : undefined;
    const previous = id === undefined ? undefined : targetById.get(id);
    if (id !== undefined) used.add(id);
    result.push(previous === undefined ? clone(item) : mergeValue(item, previous));
  }
  for (const item of targetItems) {
    const id = isRecord(item) && typeof item.id === 'string' ? item.id : undefined;
    if (id === undefined || !used.has(id)) result.push(clone(item));
  }
  return result;
}

/** Source fields overlay target fields; absent source fields remain untouched. */
function mergeValue(source, target, path = []) {
  if (Array.isArray(source)) return path.at(-1) === 'models' ? keyedModels(source, target) : clone(source);
  if (!isRecord(source)) return clone(source);
  const result = isRecord(target) ? clone(target) : {};
  for (const [key, value] of Object.entries(source)) {
    if (!validPath([key])) continue;
    result[key] = mergeValue(value, Object.hasOwn(result, key) ? result[key] : undefined, [...path, key]);
  }
  return result;
}

/**
 * Build edits only for fields present in the redacted source user section.
 * Secret paths are always descended into or skipped, never replaced by an
 * object write that could erase a hidden value.
 */
function sourceOperations(base, source, target, secrets, operations, skipped) {
  if (!validPath(base)) return;
  if (!isRecord(source) && !Array.isArray(source)) {
    if (!secretTouches(base, secrets) && !equal(source, target)) operations.push({ op: 'set', path: base, value: clone(source) });
    return;
  }
  if (secretTouches(base, secrets) && secrets.some((secret) => hasPrefix(base, secret))) return;
  if (Array.isArray(source)) {
    if (!secretTouches(base, secrets)) {
      const merged = mergeValue(source, target, base);
      if (!equal(merged, target)) operations.push({ op: 'set', path: base, value: merged });
    } else {
      // Redacted array members cannot safely be reordered or matched by index.
      skipped.push(base);
    }
    return;
  }
  if (!secretTouches(base, secrets)) {
    const merged = mergeValue(source, target, base);
    if (!equal(merged, target)) operations.push({ op: 'set', path: base, value: merged });
    return;
  }
  for (const [key, value] of Object.entries(source)) sourceOperations([...base, key], value, isRecord(target) ? target[key] : undefined, secrets, operations, skipped);
}

function namespaceMap(side) {
  return new Map((side.settings.namespaces ?? []).filter((item) => isRecord(item) && typeof item.ns === 'string').map((item) => [item.ns, item]));
}

function providerMap(side) {
  return new Map((side.configurable ?? []).filter((item) => isRecord(item) && typeof item.provider === 'string').map((item) => [item.provider, item]));
}

function collectRefs(value, refs) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'apiKeyEnv' && typeof item === 'string' && REF.test(item)) refs.add(item);
    collectRefs(item, refs);
  }
}

function collectSideRefs(side) {
  const refs = new Set();
  const namespaces = namespaceMap(side);
  for (const entry of side.configurable ?? []) {
    const namespace = namespaces.get(entry.settingsNs);
    if (namespace && validPath(entry.settingsPath)) {
      collectRefs(getPath(namespace.value, entry.settingsPath), refs);
      collectRefs(getPath(namespace.user, entry.settingsPath), refs);
    }
    for (const ref of entry.nativeAuth?.env ?? []) if (typeof ref === 'string' && REF.test(ref)) refs.add(ref);
  }
  return [...refs];
}

function errorObject(error, fallbackCode = 'models/call-failed') {
  if (error?.error && typeof error.error === 'object') return error.error;
  return { code: error?.code ?? fallbackCode, message: error?.message ?? String(error), details: error?.details ?? {} };
}

async function invoke(rpc, host, endpoint, args) {
  let envelope;
  try {
    envelope = await rpc(host, endpoint, args);
  } catch (error) {
    throw new ModelServiceError(error?.code ?? 'models/call-failed', error?.message ?? String(error), error?.details ?? {});
  }
  if (envelope?.ok === true) return envelope.value;
  if (envelope?.ok === false) {
    const error = errorObject(envelope);
    throw new ModelServiceError(error.code, error.message, error.details);
  }
  throw new ModelServiceError('models/envelope-invalid', `${endpoint} returned an invalid Remote envelope`);
}

async function readCredentials(rpc, host, refs) {
  const result = {};
  let error;
  for (let index = 0; index < refs.length; index += CREDENTIAL_BATCH) {
    try {
      const batch = await invoke(rpc, host, 'credentials/describe', { refs: refs.slice(index, index + CREDENTIAL_BATCH) });
      if (isRecord(batch)) Object.assign(result, batch);
    } catch (caught) {
      error = caught;
      break;
    }
  }
  return { result, error };
}

function warningText(warning) {
  if (typeof warning === 'string') return warning;
  if (warning.kind === 'unsupported-provider') return `Provider ${warning.provider} is not supported on the target`;
  if (warning.kind === 'unsupported-namespace') return `Settings namespace ${warning.ns} is not available on the target`;
  if (warning.kind === 'read-only') return `Settings namespace ${warning.ns} is read-only on the target`;
  if (warning.kind === 'source-path') return `Provider ${warning.provider} has no source configuration at its declared path`;
  if (warning.kind === 'credential-read') return `Could not inspect target credentials: ${warning.message}`;
  if (warning.kind === 'secret-slot') return `Secret slot ${warning.ns}:${warning.path.join('.')} is configured on the source but not on the target; it was left unchanged`;
  return warning.message ?? 'Model synchronization warning';
}

function sourceLabel(host) {
  return host === null ? 'Windows' : host;
}

function targetLabel(host) {
  return sourceLabel(host);
}

/**
 * @param {object} options
 * @param {(host: string | null, endpoint: string, args: object) => Promise<object>} options.call
 * @param {{ read: (host: string | null, ref: string) => Promise<string | undefined> }} [options.secrets] -
 *   reads one credential value on a host, inside the Windows Host only. With it,
 *   a sync can also copy the provider's API keys: values go from the source
 *   host's credential store to the target's `credentials/set` and are never
 *   returned to a window, kept in a preview, or compared anywhere but here.
 */
export function createModelService({ call, secrets, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  if (typeof call !== 'function') throw new TypeError('createModelService requires call(host, endpoint, args)');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive number');

  const tokens = new Map();
  const applying = new Set();
  let disposed = false;

  function ensureLive() {
    if (disposed) throw new ModelServiceError('models/disposed', 'model service has been disposed');
  }

  function purgeExpired() {
    const timestamp = now();
    for (const [token, record] of tokens) if (record.expiresAt <= timestamp && !applying.has(token)) tokens.delete(token);
  }

  async function rpc(distro, endpoint, args = {}) {
    ensureLive();
    hostOf(distro);
    const validator = typeof endpoint === 'string' && Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
    if (validator === undefined) throw new ModelServiceError('models/endpoint-not-allowed', `Endpoint ${endpoint} is not allowed for model synchronization`, { endpoint });
    const normalized = args === undefined ? {} : args;
    validator(normalized);
    return call(distro, endpoint, clone(normalized));
  }

  async function readSide(host, selection) {
    const [providers, configurable, settings] = await Promise.all([
      invoke(rpc, host, 'llm/listProviders', {}),
      invoke(rpc, host, 'llm/listConfigurableProviders', {}),
      invoke(rpc, host, 'settings/describe', {}),
    ]);
    if (!Array.isArray(providers) || !Array.isArray(configurable) || !isRecord(settings) || !Array.isArray(settings.namespaces)) throw new ModelServiceError('models/response-invalid', `Host ${sourceLabel(host)} returned an invalid model settings snapshot`);
    const selected = selection ? configurable.filter((entry) => entry.provider === selection.provider && entry.settingsNs === selection.settingsNs) : configurable;
    if (selection && selected.length !== 1) throw new ModelServiceError('models/provider-unavailable', 'The selected provider is no longer available or is ambiguous; refresh the model list');
    const provisional = { host, providers: clone(providers), configurable: clone(selected), settings: clone(settings), credentials: {}, credentialError: undefined };
    const refs = collectSideRefs(provisional);
    const credentials = await readCredentials(rpc, host, refs);
    provisional.credentials = credentials.result;
    provisional.credentialError = credentials.error;
    return provisional;
  }

  function buildPlan(source, target, direction, distro) {
    const targetProviders = providerMap(target);
    const sourceNamespaces = namespaceMap(source);
    const targetNamespaces = namespaceMap(target);
    const warnings = [];
    const missingCredentials = [];
    const namespacePlans = new Map();
    const changes = [];

    if (target.settings.writable === false) warnings.push({ kind: 'read-only', ns: '(settings)' });

    for (const sourceEntry of source.configurable) {
      const provider = sourceEntry?.provider;
      if (typeof provider !== 'string') continue;
      // pi-ai exposes a dynamic providers map. A new custom route need not
      // already exist on the target, provided that adapter is installed there.
      const dynamicPi = sourceEntry.settingsNs === 'llm-pi-ai'
        && sourceEntry.settingsPath?.length === 2
        && sourceEntry.settingsPath[0] === 'providers'
        && validPath(sourceEntry.settingsPath)
        && targetNamespaces.has('llm-pi-ai');
      const targetEntry = targetProviders.get(provider) ?? (dynamicPi ? sourceEntry : undefined);
      if (targetEntry === undefined) {
        warnings.push({ kind: 'unsupported-provider', provider });
        continue;
      }
      if (sourceEntry.settingsNs !== targetEntry.settingsNs || equal(sourceEntry.settingsPath, targetEntry.settingsPath) === false) {
        warnings.push({ kind: 'unsupported-provider', provider });
        continue;
      }
      const sourceNamespace = sourceNamespaces.get(sourceEntry.settingsNs);
      const targetNamespace = targetNamespaces.get(targetEntry.settingsNs);
      if (sourceNamespace === undefined || targetNamespace === undefined) {
        warnings.push({ kind: 'unsupported-namespace', ns: targetEntry.settingsNs });
        continue;
      }
      if (target.settings.writable === false) continue;
      const sourceProfile = getPath(sourceNamespace.value ?? sourceNamespace.user, sourceEntry.settingsPath);
      if (sourceProfile === undefined) continue;
      const targetProfile = getPath(targetNamespace.value ?? targetNamespace.user, targetEntry.settingsPath);
      const operations = [];
      const skipped = [];
      const secretPaths = [...(sourceNamespace.secrets ?? []), ...(targetNamespace.secrets ?? [])]
        .filter((secret) => Array.isArray(secret.path)).map((secret) => secret.path);
      sourceOperations(targetEntry.settingsPath, sourceProfile, targetProfile, secretPaths, operations, skipped);
      for (const path of skipped) warnings.push(`Secret-bearing array ${targetNamespace.ns}:${path.join('.')} was left unchanged; edit it on the target.`);
      if (operations.length === 0) continue;
      const existing = namespacePlans.get(targetNamespace.ns);
      if (existing === undefined) namespacePlans.set(targetNamespace.ns, { ns: targetNamespace.ns, revision: targetNamespace.revision, providers: [], ops: [] });
      const plan = namespacePlans.get(targetNamespace.ns);
      plan.providers.push(provider);
      plan.ops.push(...operations);
      for (const operation of operations) changes.push({
        ns: targetNamespace.ns, provider, path: operation.path, kind: operation.op,
        before: clone(getPath(targetNamespace.value ?? targetNamespace.user, operation.path)),
        after: clone(operation.value),
      });
    }

    for (const sourceNamespace of source.settings.namespaces ?? []) {
      const targetNamespace = targetNamespaces.get(sourceNamespace.ns);
      if (targetNamespace === undefined) continue;
      for (const secret of sourceNamespace.secrets ?? []) {
        if (!secret.set || !Array.isArray(secret.path)) continue;
        if (!source.configurable.some((entry) => entry.settingsNs === sourceNamespace.ns && validPath(entry.settingsPath) && hasPrefix(secret.path, entry.settingsPath))) continue;
        const targetSecret = (targetNamespace.secrets ?? []).find((candidate) => equal(candidate.path, secret.path));
        if (targetSecret?.set !== true) warnings.push({ kind: 'secret-slot', ns: targetNamespace.ns, path: secret.path });
      }
    }

    const targetCredentials = target.credentials;
    for (const ref of collectSideRefs(source)) {
      const sourceInfo = source.credentials[ref];
      const targetInfo = targetCredentials[ref];
      if (sourceInfo?.configured === true && targetInfo?.configured !== true) {
        missingCredentials.push(ref);
      }
    }
    if (target.credentialError !== undefined) warnings.push({ kind: 'credential-read', message: target.credentialError.message });

    const plans = [...namespacePlans.values()].map((plan) => ({
      ns: plan.ns,
      revision: plan.revision,
      providers: [...new Set(plan.providers)],
      ops: plan.ops.map(clone),
    }));
    const snapshot = freeze(clone({ direction, distro, source, target, plans }));
    return { snapshot, plans, changes, warnings, missingCredentials, source: sourceLabel(source.host), target: targetLabel(target.host) };
  }

  async function preview({ distro, direction, provider, settingsNs } = {}) {
    ensureLive();
    purgeExpired();
    hostOf(distro);
    if (!DIRECTIONS.has(direction)) throw new ModelServiceError('models/direction-invalid', 'direction must be windows-to-wsl or wsl-to-windows');
    if (typeof distro !== 'string' || distro.length === 0) throw new ModelServiceError('models/distro-required', 'a WSL distribution is required');
    let selection;
    if (provider !== undefined || settingsNs !== undefined) {
      if (typeof provider !== 'string' || !provider || typeof settingsNs !== 'string' || !settingsNs) invalid('provider/settingsNs', 'a non-empty provider and settings namespace');
      selection = { provider, settingsNs };
    }
    const sourceHost = direction === 'windows-to-wsl' ? null : distro;
    const targetHost = direction === 'windows-to-wsl' ? distro : null;
    const [source, target] = await Promise.all([readSide(sourceHost, selection), readSide(targetHost)]);
    const extraRefs = collectSideRefs(source).filter((ref) => !Object.hasOwn(target.credentials, ref));
    const extra = await readCredentials(rpc, targetHost, extraRefs);
    Object.assign(target.credentials, extra.result);
    target.credentialError ??= extra.error;
    ensureLive();
    const plan = buildPlan(source, target, direction, distro);
    const keys = await planCredentials(source, target);
    ensureLive();
    // Bound retained previews even when a window repeatedly requests new ones.
    for (const key of tokens.keys()) {
      if (tokens.size < 64) break;
      if (!applying.has(key)) tokens.delete(key);
    }
    const token = randomUUID();
    const expiresAt = now() + ttlMs;
    tokens.set(token, { token, expiresAt, snapshot: plan.snapshot, completed: new Set(), credentials: keys.copy.map((item) => item.ref), credentialsDone: false });
    const copied = new Set(keys.copy.map((item) => item.ref));
    return {
      token,
      expiresAt,
      source: plan.source,
      target: plan.target,
      direction,
      changes: plan.changes.map(clone),
      warnings: [...plan.warnings.map(warningText), ...keys.warnings],
      missingCredentials: [...new Set(plan.missingCredentials)].filter((ref) => !copied.has(ref)),
      // Names only: which keys this sync can copy (`add` on a target without
      // it, `update` where the target holds a different value).
      credentials: keys.copy,
    };
  }

  /**
   * Which of the source provider's credential references the target lacks or
   * holds differently. Values are read here, compared, and dropped; only the
   * reference names leave this function.
   */
  async function planCredentials(source, target) {
    const result = { copy: [], warnings: [] };
    if (secrets === undefined) return result;
    for (const ref of collectSideRefs(source)) {
      if (source.credentials[ref]?.configured !== true) continue;
      const info = target.credentials[ref];
      if (info?.writable === false) {
        result.warnings.push(`API key ${ref} cannot be written on ${targetLabel(target.host)}; set it there by hand.`);
        continue;
      }
      let value;
      try {
        value = await secrets.read(source.host, ref);
      } catch (error) {
        result.warnings.push(`API key ${ref} could not be read on ${sourceLabel(source.host)}: ${error?.message ?? error}`);
        continue;
      }
      if (typeof value !== 'string' || value.length === 0) continue;
      if (info?.configured !== true) {
        result.copy.push({ ref, action: 'add' });
        continue;
      }
      let current;
      try {
        current = await secrets.read(target.host, ref);
      } catch {
        // Unknown target value: never overwrite a key that may be correct.
        continue;
      }
      if (typeof current === 'string' && current !== value) result.copy.push({ ref, action: 'update' });
    }
    return result;
  }

  /** Copy the planned keys: read each again on the source, write it on the target. */
  async function copyCredentials(record) {
    const applied = [];
    const failed = [];
    const { source, target } = record.snapshot;
    for (const ref of record.credentials) {
      try {
        const value = await secrets.read(source.host, ref);
        if (typeof value !== 'string' || value.length === 0) throw new ModelServiceError('models/credential-missing', `API key ${ref} is no longer set on ${sourceLabel(source.host)}`);
        await invoke(rpc, target.host, 'credentials/set', { ref, value });
        applied.push(ref);
      } catch (error) {
        // Messages name the reference only; a value never reaches a result.
        failed.push({ ref, error: error?.message ?? String(error), code: error?.code ?? 'models/credential-failed' });
      }
    }
    return { applied, failed };
  }

  /**
   * @param {{ token: string, credentials?: boolean }} request - `credentials`: also copy the
   *   API keys the preview listed.
   */
  async function apply({ token, credentials = false } = {}) {
    ensureLive();
    purgeExpired();
    if (typeof token !== 'string' || token.length === 0) throw new ModelServiceError('models/token-invalid', 'a preview token is required');
    if (typeof credentials !== 'boolean') invalid('credentials', 'a boolean');
    const record = tokens.get(token);
    if (record === undefined) throw new ModelServiceError('models/token-expired', 'preview token is expired or unknown');
    if (applying.has(token)) throw new ModelServiceError('models/apply-in-progress', 'preview token is already being applied');
    applying.add(token);
    try {
      if (record.expiresAt <= now()) {
        tokens.delete(token);
        throw new ModelServiceError('models/token-expired', 'preview token is expired');
      }
      const snapshot = record.snapshot;
      const target = await readSide(snapshot.target.host);
      const targetNamespaces = namespaceMap(target);
      const pending = snapshot.plans.filter((plan) => !record.completed.has(plan.ns));
      const stale = pending.filter((plan) => targetNamespaces.get(plan.ns)?.revision !== plan.revision);
      if (stale.length > 0) {
        tokens.delete(token);
        return {
          token,
          applied: [],
          failed: stale.map((plan) => ({ ns: plan.ns, error: 'target settings changed since preview', code: 'settings/conflict' })),
          warnings: ['The target settings changed since this preview; review a new preview before applying.'],
          error: 'stale preview',
        };
      }
      const applied = [];
      const failed = [];
      const warnings = [];
      for (const plan of pending) {
        if (record.expiresAt <= now()) {
          failed.push({ ns: plan.ns, error: 'preview token expired', code: 'models/token-expired' });
          continue;
        }
        try {
          const envelope = await rpc(snapshot.target.host, 'settings/mutate', { ns: plan.ns, ops: plan.ops, expectedRevision: plan.revision });
          if (envelope?.ok !== true) {
            const error = errorObject(envelope);
            failed.push({ ns: plan.ns, error: error.message, code: error.code });
            continue;
          }
          record.completed.add(plan.ns);
          applied.push(plan.ns);
        } catch (error) {
          failed.push({ ns: plan.ns, error: error.message, code: error.code ?? 'models/call-failed' });
        }
      }
      // Keys go after the settings that name them, and only once per preview.
      let keys = { applied: [], failed: [] };
      if (credentials && secrets !== undefined && !record.credentialsDone && record.credentials.length > 0) {
        keys = await copyCredentials(record);
        if (keys.failed.length === 0) record.credentialsDone = true;
        else record.credentials = keys.failed.map((item) => item.ref);
      }
      const remaining = snapshot.plans.filter((plan) => !record.completed.has(plan.ns)).map((plan) => plan.ns);
      if (remaining.length === 0 && (keys.failed.length === 0 || !credentials)) tokens.delete(token);
      const result = { token, applied, failed, warnings, remaining, credentialsApplied: keys.applied, credentialsFailed: keys.failed };
      if (failed.length > 0) result.error = applied.length > 0 ? 'Some settings namespaces could not be applied' : 'No settings namespaces were applied';
      else if (keys.failed.length > 0) result.error = 'Some API keys could not be copied';
      return result;
    } finally {
      applying.delete(token);
    }
  }

  function dispose() {
    disposed = true;
    tokens.clear();
    applying.clear();
  }

  return Object.freeze({ rpc, preview, apply, dispose });
}

export { ENDPOINTS as MODEL_ENDPOINTS };
