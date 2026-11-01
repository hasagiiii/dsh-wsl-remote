import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelPluginService, mapModelPluginInstallSpec } from '../lib/model-plugins.js';

const provider = (name = 'custom', settingsNs = 'provider-plugin') => ({
  provider: name,
  displayName: name,
  settingsNs,
  settingsPath: ['providers', name],
});
const row = (settingsNs = 'provider-plugin') => ({ rowId: settingsNs, moduleName: '@example/provider-plugin' });
const bundle = (name = 'provider-plugin', options = {}) => ({
  name,
  availability: 'profile',
  installed: true,
  enabled: true,
  version: '1.0.0',
  source: 'provider-plugin@^1.0.0',
  rows: [row()],
  ...options,
});

function fixture({ source = {}, target = {}, direction = 'windows-to-wsl' } = {}) {
  const calls = [];
  const sides = direction === 'windows-to-wsl'
    ? new Map([[null, source], ['Ubuntu', target]])
    : new Map([[null, target], ['Ubuntu', source]]);
  const call = async (host, endpoint, args) => {
    calls.push({ host, endpoint, args });
    const side = sides.get(host);
    if (endpoint === 'llm/listConfigurableProviders') return { ok: true, value: side.providers ?? [] };
    if (endpoint === 'pluginManager/listBundles') return { ok: true, value: side.bundles ?? [] };
    return { ok: true, value: { changed: true, application: 'applied' } };
  };
  const service = createModelPluginService({ call });
  const selector = { distro: 'Ubuntu', direction, provider: 'custom', settingsNs: 'provider-plugin' };
  return { service, selector, calls };
}

function standardSource(options = {}) {
  return { providers: [provider()], bundles: [bundle('provider-plugin', options)] };
}
function standardTarget(options = {}) {
  return { providers: [provider()], bundles: [bundle('provider-plugin', options)] };
}

test('windows-to-wsl maps a Windows local source and reports an install plan', async () => {
  const f = fixture({ source: standardSource({ source: 'link:F:\\proj\\provider-plugin' }), target: { providers: [], bundles: [] } });
  const plan = await f.service.plan(f.selector);
  assert.equal(plan.status, 'install');
  assert.equal(plan.targetState, 'missing');
  assert.equal(plan.sourceBundleName, 'provider-plugin');
  assert.equal(plan.name, 'provider-plugin');
  assert.equal(plan.installSpec, 'link:/mnt/f/proj/provider-plugin');
  assert.equal(plan.spec, plan.installSpec);
  assert.equal(plan.targetHost, 'Ubuntu');
  assert.equal(f.calls.filter((call) => call.endpoint.includes('install')).length, 0);
});

test('wsl-to-windows preserves registry and git sources', async () => {
  for (const source of ['provider-plugin@^2.0.0', 'github:example/provider-plugin', 'git+https://example.test/provider-plugin.git']) {
    const f = fixture({ source: standardSource({ source }), target: { providers: [], bundles: [] }, direction: 'wsl-to-windows' });
    const plan = await f.service.plan(f.selector);
    assert.equal(plan.status, 'install');
    assert.equal(plan.installSpec, source);
    assert.equal(plan.targetHost, null);
  }
});

test('wsl-to-windows maps /mnt drive paths', async () => {
  const f = fixture({ source: standardSource({ source: 'file:/mnt/d/proj/provider-plugin' }), target: { providers: [], bundles: [] }, direction: 'wsl-to-windows' });
  const plan = await f.service.plan(f.selector);
  assert.equal(plan.installSpec, 'file:D:\\proj\\provider-plugin');
});

test('native Linux local source is explicitly unsupported', async () => {
  const f = fixture({ source: standardSource({ source: 'link:/home/me/provider-plugin' }), target: { providers: [], bundles: [] } });
  const plan = await f.service.plan(f.selector);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.reason, 'unsupported-source-platform');
});

test('enabled target is available and disabled target requests exact bundle enablement', async () => {
  const available = fixture({ source: standardSource(), target: standardTarget() });
  const ready = await available.service.inspect(available.selector);
  assert.equal(ready.status, 'available');
  assert.equal(ready.targetState, 'available');

  const disabled = fixture({ source: standardSource(), target: standardTarget({ enabled: false }) });
  const plan = await disabled.service.plan(disabled.selector);
  assert.equal(plan.status, 'enable');
  assert.equal(plan.targetState, 'disabled');
  assert.equal(plan.targetBundleName, 'provider-plugin');
  await disabled.service.install(disabled.selector);
  assert.deepEqual(disabled.calls.at(-1), {
    host: 'Ubuntu', endpoint: 'pluginManager/setBundleEnabled', args: { name: 'provider-plugin', enabled: true },
  });
});

test('existing target does not require a source install spec', async () => {
  const f = fixture({ source: standardSource({ source: undefined }), target: standardTarget() });
  const plan = await f.service.plan(f.selector);
  assert.equal(plan.status, 'available');
  assert.equal(plan.targetState, 'available');
  assert.equal(plan.installSpec, undefined);
});

test('ambiguous ownership and unavailable ownership are blocked without guessed installs', async () => {
  const ambiguous = fixture({ source: { providers: [provider()], bundles: [bundle(), bundle('other', { rows: [row()] })] }, target: { providers: [], bundles: [] } });
  const first = await ambiguous.service.plan(ambiguous.selector);
  assert.equal(first.reason, 'source-owner-ambiguous');
  assert.equal(ambiguous.calls.some((call) => call.endpoint === 'pluginManager/installBundle'), false);

  const unavailable = fixture({ source: standardSource(), target: { providers: [], bundles: [bundle('provider-plugin', { availability: 'missing', rows: [] })] } });
  const second = await unavailable.service.plan(unavailable.selector);
  assert.equal(second.reason, 'target-owner-unavailable');
  assert.equal(second.status, 'blocked');
});

test('matching enabled owner is usable before target route discovery, while incompatible target reports a reason', async () => {
  const absent = fixture({ source: standardSource(), target: { providers: [], bundles: standardTarget().bundles } });
  const noProvider = await absent.service.plan(absent.selector);
  assert.equal(noProvider.status, 'available');
  assert.equal(noProvider.targetState, 'available');

  const incompatible = fixture({ source: standardSource(), target: { providers: [provider()], bundles: [bundle('provider-plugin', { error: { code: 'incompatible-version', diagnostic: 'requires newer dsh' } })] } });
  const bad = await incompatible.service.plan(incompatible.selector);
  assert.equal(bad.reason, 'target-incompatible');
  assert.equal(bad.status, 'blocked');
});

test('mapping helper rejects unsupported directions and malformed local specs', () => {
  assert.deepEqual(mapModelPluginInstallSpec('provider-plugin@1', 'windows-to-wsl'), { ok: true, spec: 'provider-plugin@1' });
  assert.equal(mapModelPluginInstallSpec('link:/srv/provider', 'wsl-to-windows').reason, 'unsupported-source-platform');
  assert.equal(mapModelPluginInstallSpec('file:F:/provider', 'wsl-to-windows').reason, 'unsupported-source-platform');
  assert.equal(mapModelPluginInstallSpec('', 'windows-to-wsl').reason, 'source-install-spec-missing');
});
