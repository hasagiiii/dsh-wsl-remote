import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Drive the shipped component's callbacks with a minimal hook host. The native
// editor is a spy, so any accidental Windows operation from WSL fails loudly.
function fixture() {
  const requests = [], cleanups = [], subscriptions = [], frames = new Map();
  let plugin, frame, cursor, status = { distros: [{ name: 'Ubuntu', state: 'connected' }, { name: 'Debian', state: 'connected' }] };
  let reply = () => ({ ok: true, value: {} });
  const effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useId: () => 'models-test',
    useState(initial) {
      const index = cursor++;
      if (!(index in frame)) frame[index] = typeof initial === 'function' ? initial() : initial;
      const owner = frame;
      return [owner[index], (value) => { owner[index] = typeof value === 'function' ? value(owner[index]) : value; }];
    },
    useMemo(make, deps) {
      const index = cursor++;
      if (!frame[index] || deps.some((value, i) => value !== frame[index].deps[i])) frame[index] = { value: make(), deps };
      return frame[index].value;
    },
    useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
    useEffect(fn, deps) { React.useMemo(() => { effects.push(fn); }, deps); },
    useSyncExternalStore(subscribe, getSnapshot) {
      React.useMemo(() => { subscriptions.push(subscribe(() => {})); }, [subscribe]);
      return getSnapshot();
    },
  };
  const window = { __ModuleLoader__: { load(value) { plugin = value; } }, addEventListener() {}, removeEventListener() {} };
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window, console, AbortController,
    setInterval: () => 1, clearInterval() {},
    fetch: async (path, init = {}) => {
      const payload = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path, payload });
      return { ok: true, json: async () => path.endsWith('/connections') ? status : reply(path, payload) };
    },
  });
  const Native = () => null;
  const entry = { options: { id: 'models' }, component: Native };
  let listener;
  plugin.factory((name) => name === 'react' ? React : {}).apply({
    inject() {},
    effect(start) { const cleanup = start(); if (typeof cleanup === 'function') cleanups.push(cleanup); },
    locale: { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {}, getSnapshot: () => 0 },
    slots: {
      inject(key, start) { if (key === 'settings.section') cleanups.push(start()); },
      entries: () => [entry], subscribe(_key, callback) { listener = callback; return () => { listener = undefined; }; },
    },
  });
  class Controller {
    constructor(ctx) { this.remote = ctx.remote; this.store = { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready' }) }; }
    load() {}
  }
  const props = { controller: new Controller({ remote: { windows: true } }), schema: {},
    operations: { writeSettings() { throw new Error('WINDOWS WRITE'); } },
    useSnapshot: () => ({ status: 'ready' }), renderSlot: () => 'windows-slot' };
  const render = (node, key = node.type) => {
    frame = frames.get(key) ?? [];
    frames.set(key, frame); cursor = 0;
    const tree = node.type(node.props);
    for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    return tree;
  };
  const root = () => render(entry.component(props));
  const all = (tree) => tree == null || typeof tree !== 'object' ? [] : [tree, ...(tree.props?.children ?? []).flat(Infinity).flatMap(all)];
  const find = (tree, match) => { const result = all(tree).find(match); assert.ok(result, 'requested UI element is present'); return result; };
  const card = (tree, provider = { provider: 'custom', settingsNs: 'llm-pi-ai', displayName: 'Custom' }) => {
    const native = all(tree).find((node) => node.type === Native) ?? render(find(tree, (node) => node.props?.distro));
    return native.props.renderSlot('settings.models.provider-card', { provider, configured: true });
  };
  return { requests, entry, Native, props, root, render, find, card,
    reply: (fn) => { reply = fn; },
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    dispose: () => { for (const cleanup of [...cleanups, ...subscriptions].reverse()) cleanup?.(); },
    notify: () => listener?.(),
  };
}

test('Models tabs keep native Windows props and bind every WSL editor operation to its host', async () => {
  const f = fixture();
  try {
    let tree = f.root(); await f.flush(); tree = f.root();
    const windows = f.find(tree, (node) => node.type === f.Native);
    assert.equal(windows.props.operations, f.props.operations);
    f.find(tree, (node) => node.props?.role === 'tab' && node.props.children[0] === 'WSL').props.onClick();
    tree = f.root();
    const remoteNode = f.find(tree, (node) => typeof node.type === 'function' && node.props.distro === 'Ubuntu');
    const remote = f.render(remoteNode);
    assert.notEqual(remote.props.controller, f.props.controller);
    assert.equal(remote.props.renderSlot('settings.models.footer', {}), null);
    assert.equal(remote.props.renderSlot('settings.models.provider-card', {}, { fallback: 'generic-editor' }), 'generic-editor');
    await remote.props.controller.remote.llm.listProviders();
    await remote.props.controller.remote.session.modelCatalog();
    await remote.props.operations.storeCredential('MY_KEY', 'new-value');
    await remote.props.operations.removeCredential('MY_KEY');
    await remote.props.operations.discoverModels('llm-pi-ai', { provider: 'custom' });
    await remote.props.operations.writeSettings('llm-pi-ai', [{ op: 'set', path: ['providers', 'custom', 'baseURL'], value: 'https://example.test' }], 7);
    const calls = f.requests.filter((request) => request.path.endsWith('/models/rpc'));
    assert.ok(calls.length >= 6);
    assert.ok(calls.every(({ payload }) => payload.distro === 'Ubuntu'));
    assert.deepEqual(calls.find(({ payload }) => payload.endpoint === 'credentials/set').payload.args, { ref: 'MY_KEY', value: 'new-value' });
    assert.equal(calls.find(({ payload }) => payload.endpoint === 'settings/mutate').payload.args.expectedRevision, 7);
    f.reply(() => ({ ok: false, error: { code: 'settings/conflict', message: 'Changed elsewhere' } }));
    assert.equal((await remote.props.operations.writeSettings('llm-pi-ai', [], 7)).kind, 'conflict');
    f.find(tree, (node) => node.type === 'select' && node.props.value === 'Ubuntu').props.onChange({ target: { value: 'Debian' } });
    tree = f.root();
    const debian = f.render(f.find(tree, (node) => node.props?.distro === 'Debian'), 'Debian');
    await debian.props.operations.storeCredential('OTHER_KEY', 'debian-value');
    assert.equal(f.requests.at(-1).payload.distro, 'Debian');
  } finally { f.dispose(); }
  assert.equal(f.entry.component, f.Native, 'unload restores the original native entry');
});

test('Sync writes require a preview token and switching the target discards the preview', async () => {
  const f = fixture();
  try {
    f.root(); await f.flush(); let tree = f.root();
    f.reply((path) => path.endsWith('/preview') ? {
      token: 'preview-token', source: 'Windows', target: 'Ubuntu',
      changes: [{ ns: 'llm-pi-ai', path: ['providers', 'custom', 'baseURL'] }], warnings: [], missingCredentials: ['MY_KEY'],
    } : path.endsWith('/provider-plugin') ? { status: 'available' } : { applied: ['llm-pi-ai'] });
    f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.syncToWsl').props.onClick();
    await f.flush(); tree = f.root();
    assert.deepEqual(f.requests.at(-1).payload, { distro: 'Ubuntu', direction: 'windows-to-wsl', provider: 'custom', settingsNs: 'llm-pi-ai' });
    f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.apply').props.onClick();
    await f.flush(); tree = f.root();
    assert.deepEqual(f.requests.at(-1).payload, { token: 'preview-token', credentials: false }, 'no keys listed: none copied');
    assert.equal(f.find(tree, (node) => node.props?.role === 'status').props.children[0], 'models.done');
    f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.syncToWsl').props.onClick();
    await f.flush(); tree = f.root();
    f.find(tree, (node) => node.type === 'select' && node.props.value === 'Ubuntu').props.onChange({ target: { value: 'Debian' } });
    f.root(); tree = f.root();
    assert.equal(JSON.stringify(tree).includes('preview-token'), false);
    const replacement = () => null;
    f.entry.component = replacement;
    f.dispose();
    assert.equal(f.entry.component, replacement, 'an old disposer must not undo another wrapper');
  } finally { f.dispose(); }
});

test('API keys the preview lists are copied with the sync unless unticked; only names are shown', async () => {
  const f = fixture();
  try {
    f.root(); await f.flush(); let tree = f.root();
    f.reply((path) => path.endsWith('/preview') ? {
      token: 'keys-token', source: 'Windows', target: 'Ubuntu', changes: [], warnings: [], missingCredentials: [],
      credentials: [{ ref: 'MY_KEY', action: 'add' }, { ref: 'OLD_KEY', action: 'update' }],
    } : path.endsWith('/provider-plugin') ? { status: 'available' } : { applied: [], credentialsApplied: ['MY_KEY', 'OLD_KEY'] });
    const open = async () => {
      f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.syncToWsl').props.onClick();
      await f.flush(); tree = f.root();
    };
    await open();
    const label = f.find(f.card(tree), (node) => node.props?.['data-lwr-copy-keys'] === '');
    const box = f.find(label, (node) => node.type === 'input');
    assert.equal(box.props.checked, true, 'copying keys is on by default');
    assert.match(JSON.stringify(label.props.children), /MY_KEY.*OLD_KEY.*models\.keyUpdate/, 'names, and which ones will be replaced');
    const confirm = () => f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.apply');
    assert.equal(confirm().props.disabled, false, 'keys alone are worth confirming');
    confirm().props.onClick();
    await f.flush(); tree = f.root();
    assert.deepEqual(f.requests.at(-1).payload, { token: 'keys-token', credentials: true });
    assert.equal(f.find(tree, (node) => node.props?.role === 'status').props.children[0], 'models.doneKeys');

    await open();
    f.find(f.find(f.card(tree), (node) => node.props?.['data-lwr-copy-keys'] === ''), (node) => node.type === 'input').props.onChange({ target: { checked: false } });
    tree = f.root();
    assert.equal(confirm().props.disabled, true, 'nothing left to do without the keys');
  } finally { f.dispose(); }
});

test('a WSL provider installs its plugin on Windows before configuration preview and still needs sync confirmation', async () => {
  const f = fixture();
  let installed = false;
  try {
    f.root(); await f.flush(); let tree = f.root();
    f.find(tree, (node) => node.props?.role === 'tab' && node.props.children[0] === 'WSL').props.onClick();
    f.root(); tree = f.root();
    f.reply((path) => {
      if (path.endsWith('/provider-plugin')) return { status: installed ? 'available' : 'install', name: '@example/provider', spec: '@example/provider@1' };
      if (path.endsWith('/install-provider')) return { job: { id: 'install-job', status: 'running' } };
      if (path.endsWith('/install-status')) { installed = true; return { job: { id: 'install-job', status: 'done', result: { application: 'applied' } } }; }
      if (path.endsWith('/preview')) return { token: 'provider-token', source: 'Ubuntu', target: 'Windows', changes: [{ ns: 'llm-pi-ai', path: ['providers', 'custom'] }], warnings: [], missingCredentials: [] };
      return { ok: true, value: {} };
    });
    f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.syncToWindows').props.onClick();
    await f.flush(); tree = f.root();
    assert.equal(f.requests.at(-1).payload.direction, 'wsl-to-windows');
    assert.equal(f.requests.some((item) => item.path.endsWith('/preview')), false);
    f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.installProvider').props.onClick();
    await f.flush(); f.root(); await f.flush(); tree = f.root();
    assert.ok(installed);
    assert.deepEqual(f.requests.find((item) => item.path.endsWith('/install-provider')).payload, { distro: 'Ubuntu', direction: 'wsl-to-windows', provider: 'custom', settingsNs: 'llm-pi-ai', expected: { status: 'install', name: '@example/provider', spec: '@example/provider@1' } });
    assert.ok(f.find(f.card(tree), (node) => node.type === 'button' && node.props.children[0] === 'models.apply'));
    assert.equal(f.requests.some((item) => item.path.endsWith('/apply')), false, 'installation never silently applies configuration');
  } finally { f.dispose(); }
});
