/**
 * Load the Host plugin with a fake Cordis context (no WSL connect):
 *   node --import ./test/stub-cordis.mjs test/smoke-host.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'wslr-home-'));
const { default: WslRemoteService } = await import('../index.js');

const routes = new Map();
const tools = [];
const hostServices = { credentials: {} };
const ctx = {
  logger: { info: (m) => console.log(m), warn: (m) => console.warn(m), debug() {} },
  effect() {},
  on: () => () => {},
  get: (name) => hostServices[name],
  inject(names, callback) {
    if (names[0] === 'connection') callback({ effect() {}, connection: { fetch: { register: (route) => routes.set(route.path, route) } } });
    if (names[0] === 'tools') callback({ effect() {}, tools: { register: (tool) => tools.push(tool) } });
  },
};
const service = new WslRemoteService(ctx, {});
const status = await service.status();
console.log(JSON.stringify(status, null, 2));
assert.equal(status.shareLogin, true);
assert.ok(Array.isArray(status.distros));
assert.deepEqual([...routes.keys()].sort(), ['connect', 'connections', 'disconnect', 'open', 'settings', 'linux/list', 'linux/mkdir', 'distros', 'model-catalog', 'models/rpc', 'models/preview', 'models/apply', 'models/provider-plugin', 'models/install-provider', 'session-holder', 'plugins', 'plugins/change', 'plugins/install', 'plugins/install-status', 'plugins/install-cancel', 'restart', 'open-requests', 'open-requests/claim', 'ssh/add', 'ssh/remove', 'plugins/sync-plan', 'plugins/sync', 'plugins/sync-status', 'plugins/sync-cancel'].map((p) => `/api/local-wsl-remote/${p}`).sort());
assert.equal(tools[0].name, 'wsl_remote_connections');
const bad = await routes.get('/api/local-wsl-remote/connect').fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ distro: 'no such distro' }) }));
assert.equal(bad.status, 400);
const saved = await (await routes.get('/api/local-wsl-remote/settings').fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ shareLogin: false, profile: 'web' }) }))).json();
assert.equal(saved.shareLogin, false);
const post = async (path, value) => routes.get(`/api/local-wsl-remote/${path}`).fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify(value) }));
assert.equal((await post('linux/list', { distro: 'no such distro' })).status, 400);
const distro = status.distros[0]?.name;
if (distro !== undefined) {
  // Needs a real WSL distribution: the picker's first page is the Linux home.
  const listing = await (await post('linux/list', { distro })).json();
  assert.ok(listing.path.startsWith('/'), JSON.stringify(listing));
  assert.equal(listing.unc, `\\\\wsl.localhost\\${distro}${listing.path.replace(/\//g, '\\')}`);
  const info = await (await routes.get('/api/local-wsl-remote/distros').fetch(new Request('http://x/'))).json();
  console.log('distros:', JSON.stringify(info.distros));
  assert.ok(info.distros.find((entry) => entry.name === distro)?.os?.name, 'os-release read');
}
// Exercise the real Host adapters using in-memory service doubles only.
const localCases = [
  ['llm/listProviders', 'llm', 'listProviders', {}, []],
  ['llm/listConfigurableProviders', 'llm', 'listConfigurableProviders', {}, []],
  ['llm/discoverModels', 'llm', 'discoverModels', { settingsNs: 'llm-pi-ai', request: { provider: 'demo' } }, ['llm-pi-ai', { provider: 'demo' }]],
  ['settings/describe', 'settingsController', 'describe', {}, []],
  ['settings/mutate', 'settingsController', 'mutate', { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', 'demo'], value: {} }], expectedRevision: 4 }, ['llm-pi-ai', [{ op: 'set', path: ['providers', 'demo'], value: {} }], 4]],
  ['credentials/describe', 'credentialsController', 'describe', { refs: ['DEMO_API_KEY'] }, [['DEMO_API_KEY']]],
  ['credentials/set', 'credentialsController', 'set', { ref: 'DEMO_API_KEY', value: 'test-only' }, ['DEMO_API_KEY', 'test-only']],
  ['credentials/unset', 'credentialsController', 'unset', { ref: 'DEMO_API_KEY' }, ['DEMO_API_KEY']],
  ['session/modelCatalog', 'sessionController', 'modelCatalog', {}, []],
];
for (const [endpoint, name, method, args, expected] of localCases) {
  hostServices[name] ??= {};
  let received;
  hostServices[name][method] = async (...values) => { received = values; return 'fixture-result'; };
  assert.deepEqual(await service.models.rpc(null, endpoint, args), { ok: true, value: 'fixture-result' });
  assert.deepEqual(received, expected, endpoint);
}
hostServices.settingsController.mutate = async () => { throw Object.assign(new Error('fixture conflict'), { code: 'settings/conflict' }); };
assert.deepEqual(await service.models.rpc(null, 'settings/mutate', { ns: 'demo', ops: [], expectedRevision: 1 }), { ok: false, error: { code: 'settings/conflict', message: 'fixture conflict' } });
service.fresh = async () => {};
service.distros = [{ name: 'Fixture-Ubuntu' }];
const remoteCalls = [];
service.bridge.client = async (host) => ({ call: async (endpoint, payload) => {
  remoteCalls.push({ host, endpoint, payload });
  return { ok: true, value: endpoint === 'settings/describe' ? { writable: true, namespaces: [] } : [] };
} });
const rpc = await post('models/rpc', { distro: 'Fixture-Ubuntu', endpoint: 'credentials/describe', args: { refs: ['DEMO_API_KEY'] } });
assert.equal(rpc.status, 200);
assert.deepEqual(await rpc.json(), { ok: true, value: [] });
assert.deepEqual(remoteCalls[0], { host: 'Fixture-Ubuntu', endpoint: 'credentials/describe', payload: { args: { refs: ['DEMO_API_KEY'] } } });
assert.equal((await post('models/rpc', { distro: 'Fixture-Ubuntu', endpoint: 'credentials/read', args: {} })).status, 400);
hostServices.llm.listProviders = hostServices.llm.listConfigurableProviders = async () => [];
hostServices.settingsController.describe = async () => ({ writable: true, namespaces: [] });
const preview = await (await post('models/preview', { distro: 'Fixture-Ubuntu', direction: 'windows-to-wsl' })).json();
assert.equal(typeof preview.token, 'string');
assert.deepEqual(preview.changes, []);
const applied = await (await post('models/apply', { token: preview.token })).json();
assert.deepEqual(applied.remaining, []);
assert.deepEqual(applied.failed, []);
assert.equal((await post('models/apply', { token: preview.token })).status, 400);
// Provider installs are derived from actual bundle ownership; user-supplied specs
// are only compared with a fresh plan and are never executed directly.
const providerEntry = { provider: 'fixture-provider', settingsNs: 'fixture-row', settingsPath: [] };
const bundleEntry = { name: '@fixture/provider', source: '@fixture/provider@1.2.3', enabled: true, installed: true, rows: [{ rowId: 'fixture-row' }] };
let windowsBundles = [structuredClone(bundleEntry)], wslBundles = [];
const installs = [], enables = [];
hostServices.llm.listConfigurableProviders = async () => [providerEntry];
hostServices.pluginManager = {
  listBundles: async () => windowsBundles,
  installBundle: async (spec, options) => { installs.push({ host: null, spec, options }); windowsBundles = [structuredClone(bundleEntry)]; return { application: 'applied' }; },
  setBundleEnabled: async (name, enabled) => { enables.push({ name, enabled }); windowsBundles[0].enabled = enabled; return { application: 'applied' }; },
  cancelInstall: async (requestId) => ({ requestId, cancelled: true }),
};
service.bridge.client = async (host) => ({ call: async (endpoint, { args }) => {
  if (endpoint === 'llm/listConfigurableProviders') return { ok: true, value: [providerEntry] };
  if (endpoint === 'pluginManager/listBundles') return { ok: true, value: wslBundles };
  if (endpoint === 'pluginManager/installBundle') { installs.push({ host, ...args }); wslBundles = [structuredClone(bundleEntry)]; return { ok: true, value: { application: 'applied' } }; }
  throw new Error(`Unexpected fixture endpoint: ${endpoint}`);
} });
const selector = { distro: 'Fixture-Ubuntu', direction: 'windows-to-wsl', provider: providerEntry.provider, settingsNs: providerEntry.settingsNs };
const inspect = async (selection) => {
  const response = await post('models/provider-plugin', selection);
  assert.equal(response.status, 200);
  return response.json();
};
const requestInstall = async (selection, plan) => post('models/install-provider', { ...selection, expected: { status: plan.status, name: plan.name, spec: plan.spec } });
const toWsl = await inspect(selector);
assert.equal(toWsl.status, 'install');
assert.equal(toWsl.spec, bundleEntry.source);
assert.equal(installs.length, 0);
assert.equal((await requestInstall(selector, { ...toWsl, spec: 'unrelated-package' })).status, 400);
assert.equal(installs.length, 0);
const wslJob = await (await requestInstall(selector, toWsl)).json();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(service.installs.get(wslJob.job.id).status, 'done');
assert.equal(installs[0].host, 'Fixture-Ubuntu');
assert.equal(installs[0].options.requestId, wslJob.job.id);
assert.equal((await inspect(selector)).status, 'available');
windowsBundles = [];
const reverse = { ...selector, direction: 'wsl-to-windows' };
const toWindows = await inspect(reverse);
assert.equal(toWindows.status, 'install');
const winJob = await (await requestInstall(reverse, toWindows)).json();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(service.installs.get(winJob.job.id).status, 'done');
assert.equal(installs[1].host, null);
assert.equal(installs[1].spec, bundleEntry.source);
assert.deepEqual(installs[1].options, { enabled: true, requestId: winJob.job.id });
windowsBundles[0].enabled = false;
const disabled = await inspect(reverse);
assert.equal(disabled.status, 'enable');
assert.equal((await requestInstall(reverse, disabled)).status, 200);
assert.deepEqual(enables, [{ name: bundleEntry.name, enabled: true }]);
assert.equal((await post('models/rpc', { distro: 'Fixture-Ubuntu', endpoint: 'pluginManager/installBundle', args: {} })).status, 400);
assert.equal((await inspect({ ...selector, provider: 'missing' })).status, 'blocked');
// Plugin sync through the routes: Windows → a distribution, re-planned by the Host.
windowsBundles = [structuredClone(bundleEntry)];
wslBundles = [];
installs.length = 0;
const syncPlan = await (await post('plugins/sync-plan', { source: null, target: 'Fixture-Ubuntu' })).json();
assert.deepEqual(syncPlan.rows.map((row) => [row.name, row.action, row.spec]), [['@fixture/provider', 'install', '@fixture/provider@1.2.3']]);
assert.equal((await post('plugins/sync-plan', { source: null, target: 'no such host' })).status, 400);
assert.equal((await post('plugins/sync', { source: null, target: 'Fixture-Ubuntu', names: ['not-listed'] })).status, 400, 'only planned plugins can be synced');
const syncRun = await (await post('plugins/sync', { source: null, target: 'Fixture-Ubuntu', names: ['@fixture/provider'] })).json();
for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
const syncDone = await (await post('plugins/sync-status', { id: syncRun.run.id })).json();
assert.equal(syncDone.run.status, 'done');
assert.equal(installs[0].host, 'Fixture-Ubuntu');
assert.equal(installs[0].spec, '@fixture/provider@1.2.3');
service.installs.dispose();
service.models.dispose();
console.log('PASS');
