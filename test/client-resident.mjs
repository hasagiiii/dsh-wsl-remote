import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// The model picker's per-session directory: a WSL/SSH session on Windows gets its host's catalog;
// a session of a dsh on Linux (this plugin installed there as the resident agent) is that dsh's own,
// so its picker must stay exactly as shipped (it used to fail with "this WSL session's distribution
// is not known yet" when switching models in that dsh's own web UI).
async function pickerFixture({ resident, distros }) {
  const requests = [];
  const services = {};
  let plugin;
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { plugin = value; } }, addEventListener() {}, removeEventListener() {} },
    document: { head: { appendChild() {} }, createElement: () => ({ remove() {} }), querySelectorAll: () => [], body: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    console, AbortController, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: async (path) => {
      requests.push(path);
      const value = path.endsWith('/connections') ? (resident ? { resident: true, platform: 'linux', distros: [] } : { platform: 'win32', bridgeReady: true, distros })
        : path.endsWith('/distros') ? (resident ? { resident: true, distros: [], workspaces: {} } : { distros, workspaces: {} })
          : path.endsWith('/model-catalog') ? { catalog: { groups: [] } } : {};
      return { ok: true, json: async () => value };
    },
  });
  const effects = [];
  const React = { createElement: () => null, useSyncExternalStore: (_s, get) => get(), useState: (v) => [v, () => {}], useEffect() {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: () => ({}) };
  plugin.factory((name) => (name === 'react' ? React : name === '@deepseek-ai/dsh-client-ui-primitives' ? { Modal: 'Modal', Button: 'Button' } : {})).apply({
    inject() {},
    effect: (start) => { effects.push(start); },
    get: (name) => services[name],
    locale: { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {}, getSnapshot: () => 0, translate: () => '' },
    slots: { inject() {}, register: () => () => {}, entries: () => [], subscribe: () => () => {} },
  });
  // The shipped model-directories service, and one session of a dsh whose paths are Linux ones.
  const calls = [];
  const shippedCatalog = { name: 'shipped' };
  const service = {
    catalog: shippedCatalog,
    directoryFor(sessionId) { calls.push({ sessionId, catalog: this.catalog }); return { sessionId }; },
  };
  services.modelDirectories = service;
  services.sessions = { list: { getSnapshot: () => ({ byId: { s1: { cwd: '/home/me/project' } } }) } };
  services.workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', path: '/home/me/project', sessionIds: ['s1'] }] }) } };
  await new Promise((resolve) => setImmediate(resolve));
  const original = service.directoryFor;
  for (const start of effects.splice(0)) {
    try {
      start();
    } catch {} // effects for other UI parts may need services this fixture does not provide
  }
  assert.notEqual(service.directoryFor, original, 'the picker wrapper is installed');
  await new Promise((resolve) => setImmediate(resolve));
  return { service, calls, shippedCatalog, requests };
}

test('a dsh on Linux (resident host) keeps the shipped model picker for its own Linux sessions', async () => {
  const { service, calls, shippedCatalog, requests } = await pickerFixture({ resident: true, distros: [] });
  service.directoryFor('s1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].catalog, shippedCatalog, 'the shipped catalog, not a WSL host catalog');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!requests.some((path) => path.endsWith('/model-catalog')), 'no remote catalog is asked for');
});

test('a Windows window with a connected WSL host still gives a Linux session that host\'s catalog', async () => {
  const { service, calls, shippedCatalog } = await pickerFixture({ resident: false, distros: [{ name: 'Ubuntu', state: 'connected', kind: 'wsl' }] });
  service.directoryFor('s1');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].catalog, shippedCatalog, 'the WSL host\'s catalog is used for that one call');
  assert.equal(service.catalog, shippedCatalog, 'and the shared catalog is restored after it');
});
