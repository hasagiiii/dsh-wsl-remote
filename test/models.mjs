import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelService } from '../lib/models.js';

const provider = (name = 'custom', ns = 'llm-pi-ai') => ({ provider: name, settingsNs: ns, settingsPath: ['providers', name] });
const namespace = (providers, secrets = [], ns = 'llm-pi-ai') => ({ ns, revision: 1, value: { providers }, user: { providers }, secrets });
function fixture(source, target, options = {}) {
  let timestamp = 1000;
  const calls = [], writes = [];
  let intercept;
  const hosts = new Map([[null, source], ['Ubuntu', target]]);
  const service = createModelService({ now: () => timestamp, ttlMs: 1000,
    call: async (host, endpoint, args) => {
      calls.push({ host, endpoint, args: structuredClone(args) });
      if (intercept) { const response = await intercept(host, endpoint, args); if (response !== undefined) return response; }
      const side = hosts.get(host);
      if (endpoint === 'llm/listProviders') return { ok: true, value: [] };
      if (endpoint === 'llm/listConfigurableProviders') return { ok: true, value: side.configurable };
      if (endpoint === 'settings/describe') return { ok: true, value: structuredClone({ writable: true, namespaces: side.namespaces }) };
      if (endpoint === 'credentials/describe') return { ok: true, value: Object.fromEntries(args.refs.map((ref) => [ref, { configured: !!side.credentials?.[ref], writable: true }])) };
      if (endpoint === 'settings/mutate') {
        const targetNs = side.namespaces.find((item) => item.ns === args.ns);
        if (targetNs.revision !== args.expectedRevision) return { ok: false, error: { code: 'settings/conflict', message: 'Changed' } };
        writes.push({ host, ...structuredClone(args) });
        for (const operation of args.ops) {
          let parent = targetNs.value;
          for (const key of operation.path.slice(0, -1)) parent = parent[key] ??= {};
          parent[operation.path.at(-1)] = structuredClone(operation.value);
        }
        targetNs.user = structuredClone(targetNs.value); targetNs.revision++;
        return { ok: true, value: structuredClone(targetNs) };
      }
      return { ok: true, value: undefined };
    }, ...options });
  return { service, source, target, calls, writes,
    preview: () => service.preview({ distro: 'Ubuntu', direction: 'windows-to-wsl' }),
    advance: (value) => { timestamp += value; }, intercept: (fn) => { intercept = fn; } };
}
const side = (providers, secrets = [], extra = {}) => ({ configurable: Object.keys(providers).map((name) => provider(name)), namespaces: [namespace(providers, secrets)], ...extra });
const path = (...tail) => ['providers', 'custom', ...tail];

 test('new custom routes sync without preexisting target provider, preserving target-only data and known credentials', async () => {
  const f = fixture(side({ custom: { baseURL: 'https://source.test', apiKeyEnv: 'SHARED_KEY', models: [{ id: 'a', name: 'Source A' }] } }, [], { credentials: { SHARED_KEY: true } }),
    side({ targetOnly: { models: [{ id: 'z' }] } }, [], { credentials: { SHARED_KEY: true } }));
  const preview = await f.preview();
  assert.ok(preview.changes.length);
  assert.deepEqual(preview.missingCredentials, []);
  assert.ok(f.calls.some((call) => call.host === 'Ubuntu' && call.endpoint === 'credentials/describe' && call.args.refs.includes('SHARED_KEY')));
  assert.ok(preview.changes.some((change) => change.after?.baseURL === 'https://source.test'));
  const result = await f.service.apply({ token: preview.token });
  assert.equal(result.error, undefined);
  assert.deepEqual(f.target.namespaces[0].value.providers.targetOnly.models, [{ id: 'z' }]);
  assert.equal(f.target.namespaces[0].value.providers.custom.baseURL, 'https://source.test');
  assert.equal(f.calls.some((call) => call.endpoint === 'credentials/set'), false);
});

test('models merge by id even when an adjacent secret forces leaf writes; target fields and overrides survive', async () => {
  const secret = { path: path('apiKey'), set: true };
  const f = fixture(side({ custom: { models: [{ id: 'a', name: 'new' }], modelOverrides: { a: { contextWindow: 100 } } } }, [secret]),
    side({ custom: { apiKey: 'hidden-target-key', baseURL: 'https://target.test', models: [{ id: 'a', name: 'old', maxTokens: 42 }, { id: 'b' }], modelOverrides: { a: { maxTokens: 42 }, b: { name: 'B' } } } }, [secret]));
  // A real describe response omits secrets; preserve one in the fixture's
  // backing state while ensuring the mocked response is redacted too.
  f.intercept((_host, endpoint, args) => {
    if (endpoint !== 'settings/describe') return undefined;
    const original = _host === null ? f.source : f.target;
    const namespaces = structuredClone(original.namespaces);
    delete namespaces[0].value.providers.custom.apiKey;
    delete namespaces[0].user.providers.custom.apiKey;
    return { ok: true, value: { writable: true, namespaces } };
  });
  const preview = await f.preview();
  assert.equal(JSON.stringify(preview).includes('hidden-target-key'), false);
  await f.service.apply({ token: preview.token });
  const result = f.target.namespaces[0].value.providers.custom;
  assert.equal(result.apiKey, 'hidden-target-key');
  assert.deepEqual(result.models, [{ id: 'a', name: 'new', maxTokens: 42 }, { id: 'b' }]);
  assert.deepEqual(result.modelOverrides, { a: { contextWindow: 100, maxTokens: 42 }, b: { name: 'B' } });
  assert.equal(result.baseURL, 'https://target.test');
  assert.ok(f.writes[0].ops.every((operation) => !operation.path.includes('apiKey')));
});

test('source secret paths protect new routes; arrays containing secrets are skipped without index writes', async () => {
  const secrets = [{ path: path('headers', 'Authorization'), set: true }, { path: path('models', '0', 'headers', 'Authorization'), set: true }];
  const f = fixture(side({ custom: { headers: { 'X-Project': 'source' }, models: [{ id: 'source-model', headers: {} }], baseURL: 'https://source.test' } }, secrets), side({}));
  const preview = await f.preview();
  assert.ok(preview.warnings.some((warning) => warning.includes('array')));
  await f.service.apply({ token: preview.token });
  const ops = f.writes[0].ops;
  assert.ok(ops.some((operation) => operation.path.join('/') === path('headers', 'X-Project').join('/')));
  assert.ok(ops.every((operation) => !operation.path.includes('models') && !operation.path.includes('Authorization') && operation.path.length > 2));
});

test('stale previews perform zero writes and expired or consumed tokens cannot apply', async () => {
  const f = fixture(side({ custom: { baseURL: 'new' } }), side({ custom: { baseURL: 'old' } }));
  const stale = await f.preview();
  f.target.namespaces[0].revision++;
  const refused = await f.service.apply({ token: stale.token });
  assert.equal(refused.failed[0].code, 'settings/conflict'); assert.equal(f.writes.length, 0);
  await assert.rejects(f.service.apply({ token: stale.token }), { code: 'models/token-expired' });
  const expired = await f.preview(); f.advance(1001);
  await assert.rejects(f.service.apply({ token: expired.token }), { code: 'models/token-expired' });
  const valid = await f.preview(); await f.service.apply({ token: valid.token });
  await assert.rejects(f.service.apply({ token: valid.token }), { code: 'models/token-expired' });
});

test('one token cannot be applied concurrently; partial failures report completed namespaces', async () => {
  const source = side({ custom: { baseURL: 'new' } });
  const target = side({ custom: { baseURL: 'old' } });
  source.configurable.push(provider('second', 'other-model-adapter'));
  target.configurable.push(provider('second', 'other-model-adapter'));
  source.namespaces.push(namespace({ second: { baseURL: 'new' } }, [], 'other-model-adapter'));
  target.namespaces.push(namespace({ second: { baseURL: 'old' } }, [], 'other-model-adapter'));
  const f = fixture(source, target);
  const preview = await f.preview();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.intercept(async (_host, endpoint, args) => {
    if (endpoint === 'settings/mutate' && args.ns === 'llm-pi-ai') await gate;
    if (endpoint === 'settings/mutate' && args.ns === 'other-model-adapter') return { ok: false, error: { code: 'test/refused', message: 'simulated refusal' } };
  });
  const first = f.service.apply({ token: preview.token });
  await assert.rejects(f.service.apply({ token: preview.token }), { code: 'models/apply-in-progress' });
  release();
  const result = await first;
  assert.deepEqual(result.applied, ['llm-pi-ai']); assert.deepEqual(result.remaining, ['other-model-adapter']);
  assert.equal(result.failed[0].code, 'test/refused'); assert.ok(result.error);
});

test('RPC allowlist rejects inherited endpoint names, unknown fields and unsafe paths before dispatch', async () => {
  const f = fixture(side({}), side({}));
  for (const endpoint of ['session/delete', 'constructor', 'toString', '__proto__']) {
    await assert.rejects(f.service.rpc('Ubuntu', endpoint, {}), { code: 'models/endpoint-not-allowed' });
  }
  await assert.rejects(f.service.rpc('Ubuntu', 'settings/describe', { extra: true }), { code: 'models/arguments-invalid' });
  await assert.rejects(f.service.rpc('Ubuntu', 'settings/mutate', { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['__proto__', 'a'], value: true }] }), { code: 'models/arguments-invalid' });
  assert.equal(f.calls.length, 0);
  f.service.dispose();
  await assert.rejects(f.preview(), { code: 'models/disposed' });
});

test('single-provider sync isolates writes and credential hints within a shared settings namespace', async () => {
  const source = side({ custom: { baseURL: 'new', apiKeyEnv: 'CUSTOM_KEY' }, other: { baseURL: 'unrelated-new', apiKeyEnv: 'OTHER_KEY' } }, [], { credentials: { CUSTOM_KEY: true, OTHER_KEY: true } });
  const f = fixture(source, side({ custom: { baseURL: 'old' }, other: { baseURL: 'unrelated-old' } }));
  const preview = await f.service.preview({ distro: 'Ubuntu', direction: 'windows-to-wsl', provider: 'custom', settingsNs: 'llm-pi-ai' });
  assert.deepEqual(preview.missingCredentials, ['CUSTOM_KEY']);
  assert.ok(preview.changes.every((item) => item.provider === 'custom'));
  await f.service.apply({ token: preview.token });
  assert.equal(f.target.namespaces[0].value.providers.custom.baseURL, 'new');
  assert.equal(f.target.namespaces[0].value.providers.other.baseURL, 'unrelated-old');
  const reverse = await f.service.preview({ distro: 'Ubuntu', direction: 'wsl-to-windows', provider: 'other', settingsNs: 'llm-pi-ai' });
  await f.service.apply({ token: reverse.token });
  assert.equal(f.source.namespaces[0].value.providers.other.baseURL, 'unrelated-old');
  assert.equal(f.source.namespaces[0].value.providers.custom.baseURL, 'new');
  for (const selector of [{ provider: 'custom' }, { provider: '', settingsNs: 'llm-pi-ai' }, { provider: 'missing', settingsNs: 'llm-pi-ai' }, { provider: 'custom', settingsNs: 'unrelated' }]) {
    await assert.rejects(f.service.preview({ distro: 'Ubuntu', direction: 'windows-to-wsl', ...selector }));
  }
  assert.equal(f.writes.length, 2);
});

test('API keys copy only when asked, only where missing or different, and their values never leave the service', async () => {
  const values = { null: { CUSTOM_KEY: 'sk-source-1', SAME_KEY: 'sk-same', DIFF_KEY: 'sk-new' }, Ubuntu: { SAME_KEY: 'sk-same', DIFF_KEY: 'sk-old' } };
  const reads = [];
  const providers = { custom: { baseURL: 'new', apiKeyEnv: 'CUSTOM_KEY' }, same: { apiKeyEnv: 'SAME_KEY' }, diff: { apiKeyEnv: 'DIFF_KEY' } };
  const source = side(providers, [], { credentials: { CUSTOM_KEY: true, SAME_KEY: true, DIFF_KEY: true } });
  const target = side({ custom: { baseURL: 'old' }, same: {}, diff: {} }, [], { credentials: { SAME_KEY: true, DIFF_KEY: true } });
  const f = fixture(source, target, {
    secrets: { read: async (host, ref) => { reads.push([host, ref]); return values[String(host)][ref]; } },
  });
  const sets = [];
  f.intercept((host, endpoint, args) => {
    if (endpoint !== 'credentials/set') return undefined;
    sets.push([host, args.ref, args.value]);
    values[String(host)][args.ref] = args.value;
    return { ok: true, value: undefined };
  });
  const preview = await f.preview();
  assert.deepEqual(preview.credentials, [{ ref: 'CUSTOM_KEY', action: 'add' }, { ref: 'DIFF_KEY', action: 'update' }], 'same values are left alone');
  assert.deepEqual(preview.missingCredentials, [], 'a key that can be copied is not reported as missing');
  assert.equal(/sk-/.test(JSON.stringify(preview)), false, 'no value in the preview');

  // Without the opt-in, only settings are written.
  const plain = await f.service.apply({ token: preview.token });
  assert.deepEqual([plain.credentialsApplied, sets], [[], []]);

  const again = await f.preview();
  const result = await f.service.apply({ token: again.token, credentials: true });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.credentialsApplied, ['CUSTOM_KEY', 'DIFF_KEY']);
  assert.deepEqual(sets, [['Ubuntu', 'CUSTOM_KEY', 'sk-source-1'], ['Ubuntu', 'DIFF_KEY', 'sk-new']], 'written on the target through credentials/set');
  assert.equal(/sk-/.test(JSON.stringify(result)), false, 'no value in the result');
  await assert.rejects(f.service.apply({ token: again.token, credentials: true }), { code: 'models/token-expired' }, 'a preview copies keys once');
  assert.ok(reads.every(([host]) => host === null || host === 'Ubuntu'));
});

test('a key that cannot be copied is reported by name and can be retried with the same preview', async () => {
  const source = side({ custom: { apiKeyEnv: 'CUSTOM_KEY' } }, [], { credentials: { CUSTOM_KEY: true } });
  const f = fixture(source, side({ custom: { apiKeyEnv: 'CUSTOM_KEY' } }), { secrets: { read: async (host) => (host === null ? 'sk-secret' : undefined) } });
  let refuse = true;
  f.intercept((_host, endpoint) => (endpoint === 'credentials/set' ? (refuse ? { ok: false, error: { code: 'credential/rejected', message: 'store is read-only' } } : { ok: true, value: undefined }) : undefined));
  const preview = await f.preview();
  assert.equal(preview.changes.length, 0, 'configuration already matches');
  assert.deepEqual(preview.credentials, [{ ref: 'CUSTOM_KEY', action: 'add' }]);
  const failed = await f.service.apply({ token: preview.token, credentials: true });
  assert.deepEqual(failed.credentialsFailed.map((item) => item.ref), ['CUSTOM_KEY']);
  assert.ok(failed.error);
  assert.equal(JSON.stringify(failed).includes('sk-secret'), false);
  refuse = false;
  const retried = await f.service.apply({ token: preview.token, credentials: true });
  assert.deepEqual(retried.credentialsApplied, ['CUSTOM_KEY']);
  await assert.rejects(f.service.apply({ token: preview.token, credentials: 'yes' }), { code: 'models/arguments-invalid' });
  await assert.rejects(f.service.apply({ token: preview.token, credentials: true }), { code: 'models/token-expired' }, 'done once every key is copied');
});

test('without a secret reader (or when it fails) keys are listed as missing, as before', async () => {
  const source = side({ custom: { apiKeyEnv: 'CUSTOM_KEY' } }, [], { credentials: { CUSTOM_KEY: true } });
  const plain = await fixture(source, side({ custom: {} })).preview();
  assert.deepEqual([plain.credentials, plain.missingCredentials], [[], ['CUSTOM_KEY']]);
  const broken = await fixture(source, side({ custom: {} }), { secrets: { read: async () => { throw new Error('agent too old'); } } }).preview();
  assert.deepEqual([broken.credentials, broken.missingCredentials], [[], ['CUSTOM_KEY']]);
  assert.ok(broken.warnings.some((warning) => warning.includes('CUSTOM_KEY') && warning.includes('agent too old')));
});

test('reverse sync targets Windows and unavailable adapters are reported instead of copied', async () => {
  const f = fixture(side({ custom: { baseURL: 'windows' } }), side({ custom: { baseURL: 'wsl' } }));
  const preview = await f.service.preview({ distro: 'Ubuntu', direction: 'wsl-to-windows' });
  await f.service.apply({ token: preview.token });
  assert.equal(f.writes[0].host, null);
  const missing = fixture(side({ custom: {} }), { configurable: [], namespaces: [] });
  const skipped = await missing.preview();
  assert.equal(skipped.changes.length, 0); assert.ok(skipped.warnings.length);
});
