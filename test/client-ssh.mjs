import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

/**
 * Load client.js with a tiny hook host (state and effects kept per component
 * type) and collect the components it registers.
 */
function load(reply, options = {}) {
  const registered = new Map();
  const requests = [];
  const frames = new Map();
  const pending = [];
  let frame;
  let cursor = 0;
  const subscribed = new Set();
  const React = {
    Fragment: 'Fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++;
      const owner = frame;
      if (!(i in owner)) owner[i] = typeof initial === 'function' ? initial() : initial;
      return [owner[i], (v) => { owner[i] = typeof v === 'function' ? v(owner[i]) : v; }];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const owner = frame;
      const previous = owner[i];
      if (previous === undefined || deps === undefined || deps.some((value, k) => value !== previous.deps[k])) {
        // As React does: the previous run's cleanup goes first, then the new effect.
        const slot = { deps: deps ?? [], cleanup: undefined };
        owner[i] = slot;
        pending.push(() => {
          previous?.cleanup?.();
          const cleanup = fn();
          if (typeof cleanup === 'function') slot.cleanup = cleanup;
        });
      }
    },
    useLayoutEffect() {}, useId: () => 'id',
    useRef(value) { const i = cursor++; if (!(i in frame)) frame[i] = { current: value }; return frame[i]; },
    useMemo(make) { cursor++; return make(); },
    useCallback(fn, deps) {
      const i = cursor++;
      const previous = frame[i];
      if (previous && deps.every((value, k) => value === previous.deps[k])) return previous.fn;
      frame[i] = { fn, deps };
      return fn;
    },
    useSyncExternalStore: (subscribe, getSnapshot) => {
      cursor++;
      if (!subscribed.has(subscribe)) { subscribed.add(subscribe); subscribe(() => {}); }
      return getSnapshot();
    },
  };
  const primitives = { Modal: 'Modal', Button: 'Button' };
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { plugin = value; } }, addEventListener() {}, removeEventListener() {}, confirm: () => true },
    document: { head: { appendChild() {} }, createElement: () => ({ remove() {} }), querySelectorAll: () => [], body: {} },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    console, AbortController, setInterval: () => 1, clearInterval() {}, setTimeout: options.setTimeout ?? (() => 1), clearTimeout() {},
    fetch: async (path, init = {}) => {
      const payload = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ path, payload });
      return { ok: true, json: async () => reply(path, payload) };
    },
  });
  var plugin;
  const locale = { register: () => () => {}, bind: () => (key) => key, subscribe: () => () => {}, getSnapshot: () => 0, translate: (ns, key) => `native:${ns}.${key}` };
  plugin.factory((name) => (name === 'react' ? React : name === 'react-dom' ? {} : name === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : {})).apply({
    inject() {}, effect: (start, label) => { if (options.runEffects?.includes(label)) start(); }, get: () => undefined,
    locale,
    slots: { inject: (_name, start) => start(), register: (options, component) => { registered.set(options.id ?? options.name, component); return () => {}; }, entries: () => [], subscribe: () => () => {} },
  });
  const expand = (node) => {
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      if (!frames.has(node.type)) frames.set(node.type, []);
      frame = frames.get(node.type);
      cursor = 0;
      return expand(node.type(node.props));
    }
    const props = { ...node.props };
    for (const key of ['children', 'footer']) {
      if (props[key] === undefined) continue;
      props[key] = [props[key]].flat(Infinity).map(expand);
    }
    return { ...node, props };
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  /** Render, run the effects it scheduled, let fetches settle, and render again until stable. */
  const render = async (element) => {
    let tree;
    for (let round = 0; round < 6; round++) {
      tree = expand(element);
      if (pending.length === 0) break;
      for (const effect of pending.splice(0)) effect();
      await flush();
      await flush();
    }
    return tree;
  };
  const kids = (node) => ['children', 'footer'].flatMap((key) => [node.props?.[key] ?? []].flat(Infinity));
  const text = (node) => (node == null || node === false ? '' : typeof node !== 'object' ? String(node) : node.type === 'style' ? '' : kids(node).map(text).join(' '));
  const all = (node) => (node == null || typeof node !== 'object' ? [] : [node, ...kids(node).flatMap(all)]);
  const button = (tree, label) => {
    const found = all(tree).find((node) => (node.type === 'button' || node.type === 'Button') && text(node).trim() === label);
    assert.ok(found, `button ${label} is present`);
    return found;
  };
  return { registered, requests, render, text, all, button, React, flush, locale };
}

const status = {
  platform: 'win32', minimumDsh: '0.2.1-rc.5', shareLogin: true, profile: 'web', credentialsAvailable: true,
  sshConfigHosts: ['prod'],
  distros: [
    { name: 'Ubuntu', kind: 'wsl', state: 'connected', isDefault: true },
    { name: 'ssh:me@dev', kind: 'ssh', dest: 'me@dev', state: 'error', error: 'Permission denied (publickey).', hint: 'auth' },
  ],
};

test('Settings list WSL distributions and SSH hosts with the same actions, plus add/remove', async () => {
  const f = load(() => status);
  const Row = f.registered.get('local-wsl-remote-connections');
  await f.render(f.React.createElement(Row, {}));
  await f.flush();
  const tree = await f.render(f.React.createElement(Row, {}));
  const words = f.text(tree);
  assert.match(words, /WSL: Ubuntu/);
  assert.match(words, /SSH: me@dev/);
  assert.match(words, /ssh\.hint\.auth/, 'an SSH failure explains what to do');
  f.button(tree, 'retry').props.onClick();
  f.button(tree, 'ssh.remove').props.onClick();
  f.button(tree, '+ prod').props.onClick();
  await f.flush();
  const posts = f.requests.filter((request) => request.payload).map((request) => [request.path.replace('api/local-wsl-remote/', ''), request.payload]);
  assert.deepEqual(posts, [['connect', { distro: 'ssh:me@dev' }], ['ssh/remove', { distro: 'ssh:me@dev' }], ['ssh/add', { dest: 'prod' }]]);
});

test('Add workspace: the SSH card picks an SSH host and the picker hands back an ssh:// address', async () => {
  const f = load((path) => {
    if (path.endsWith('/distros')) return { distros: [{ name: 'Ubuntu', state: 'connected', isDefault: true }, { name: 'ssh:me@dev', state: 'disconnected' }], workspaces: {} };
    if (path.endsWith('/linux/list')) return { distro: 'ssh:me@dev', path: '/home/me', home: '/home/me', crumbs: [{ name: '/', path: '/' }], entries: [], truncated: false };
    return status;
  });
  const Flow = f.registered.get('sidebar.workspaces.directoryFlow');
  const picked = [];
  const element = f.React.createElement(Flow, { open: true, busy: false, onPicked: (path) => picked.push(path), onCancel() {}, onError() {} });
  let tree = await f.render(element);
  assert.match(f.text(tree), /ws\.ssh/, 'the chooser offers SSH beside Local and WSL');
  const sshCard = f.all(tree).find((node) => node.props?.role === 'radio' && /ws\.ssh/.test(f.text(node)));
  assert.equal(sshCard.props.disabled, false);
  sshCard.props.onClick();
  tree = await f.render(element);
  const options = f.all(tree).filter((node) => node.type === 'option').map((node) => f.text(node).trim());
  assert.deepEqual(options, ['SSH: me@dev'], 'only SSH hosts are listed under SSH');
  assert.match(f.text(tree), /ws\.notConnectedSsh/);
  f.button(tree, 'ws.next').props.onClick();
  tree = await f.render(element);
  assert.ok(f.requests.some((request) => request.path.endsWith('/linux/list') && request.payload.distro === 'ssh:me@dev'), 'the picker lists folders on the SSH host');
  f.button(tree, 'picker.open').props.onClick();
  assert.deepEqual(picked, ['ssh://me@dev/home/me']);
});

test('Plugin sync panel: compare two hosts, sync the selected plugins, show the run', async () => {
  const plan = {
    source: null, target: 'ssh:me@dev', targetOnly: [{ name: 'only-there' }],
    rows: [
      { name: 'a', version: '1.0.0', state: 'missing', action: 'install', spec: 'a@1.0.0' },
      { name: 'b', version: '2.0.0', targetVersion: '1.0.0', state: 'differ', action: 'update', spec: 'b@2.0.0', git: { remote: 'github:me/b', commit: 'dbc31b3a4311b41ed287792dd4b9d149698d2609', dirty: true } },
      { name: 'd', version: '1.0.0', state: 'unsupported', reason: 'local-path', source: 'link:F:/d' },
      { name: 'e', version: '1.0.0', state: 'same' },
    ],
  };
  const run = { id: 'run-1', source: null, target: 'ssh:me@dev', status: 'done', restartRequired: true, elapsedMs: 3000, items: [{ name: 'a', action: 'install', status: 'done' }] };
  const hosts = { ...status, distros: [{ name: 'Ubuntu', state: 'connected' }, { name: 'ssh:me@dev', state: 'connected' }] };
  const f = load((path) => {
    if (path.endsWith('/sync-plan')) return plan;
    if (path.endsWith('/plugins/sync')) return { run };
    if (path.endsWith('/sync-status')) return { run: null };
    if (path.endsWith('/plugins')) return { distro: 'Ubuntu', plugins: [], windowsOnly: [] };
    return hosts;
  });
  const Tab = f.registered.get('wsl-plugins');
  const element = f.React.createElement(Tab, {});
  await f.render(element);
  await f.flush();
  let tree = await f.render(element);
  const panel = f.all(tree).find((node) => node.props?.['data-lwr-plugin-sync'] === '');
  assert.ok(panel, 'the remote plugins tab has a sync panel');
  const selects = f.all(panel).filter((node) => node.type === 'select');
  assert.deepEqual(f.all(selects[0]).filter((node) => node.type === 'option').map((node) => f.text(node).trim()), ['Windows', 'WSL: Ubuntu', 'SSH: me@dev'], 'any host can be the source');
  selects[1].props.onChange({ target: { value: 'ssh:me@dev' } });
  tree = await f.render(element);
  f.button(tree, 'sync.load').props.onClick();
  await f.flush();
  tree = await f.render(element);
  assert.deepEqual(f.requests.find((request) => request.path.endsWith('/sync-plan')).payload, { source: null, target: 'ssh:me@dev' });
  const words = f.text(tree);
  assert.match(words, /sync\.reason\.local-path/, 'an unsyncable plugin says why');
  assert.match(words, /only-there/, 'target-only plugins are listed as kept');
  const gitNote = f.all(tree).find((node) => node.props?.['data-lwr-sync-git'] === 'b');
  assert.match(f.text(gitNote), /sync\.git\.from/, 'a plugin installed from git says so');
  assert.match(f.text(gitNote), /sync\.git\.dirty/, 'and that uncommitted changes are left out');
  const boxes = f.all(tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox');
  assert.deepEqual(boxes.map((box) => [box.props.checked, box.props.disabled]), [[true, false], [true, false], [false, true], [false, true]], 'only syncable plugins can be picked, and they start picked');
  const ones = f.all(tree).filter((node) => node.type === 'button' && node.props['data-lwr-sync-one']);
  assert.deepEqual(ones.map((node) => [node.props['data-lwr-sync-one'], f.text(node).trim()]), [['a', 'sync.action.install'], ['b', 'sync.action.update']], 'each syncable plugin has its own sync button');
  f.button(tree, 'sync.run').props.onClick();
  await f.flush();
  tree = await f.render(element);
  assert.deepEqual(f.requests.find((request) => request.path.endsWith('/plugins/sync')).payload, { source: null, target: 'ssh:me@dev', names: ['a', 'b'] });
  const after = f.text(tree);
  assert.match(after, /Windows → SSH: me@dev/);
  assert.match(after, /sync\.done/);
  assert.match(after, /sync\.restartRemote/);
});

test('Plugin sync panel: a row syncs just its plugin; while running, other rows can still be queued', async () => {
  const plan = {
    source: null, target: 'ssh:me@dev', targetOnly: [],
    rows: [
      { name: 'a', version: '1.0.0', state: 'missing', action: 'install', spec: 'a@1.0.0' },
      { name: 'b', version: '2.0.0', state: 'missing', action: 'install', spec: 'b@2.0.0' },
    ],
  };
  let run = { id: 'run-1', source: null, target: 'ssh:me@dev', status: 'running', elapsedMs: 0, items: [{ name: 'a', action: 'install', status: 'running' }] };
  const hosts = { ...status, distros: [{ name: 'ssh:me@dev', state: 'connected' }] };
  const f = load((path, payload) => {
    if (path.endsWith('/sync-plan')) return plan;
    if (path.endsWith('/plugins/sync')) {
      run = { ...run, items: [...run.items, ...payload.names.filter((name) => name !== 'a').map((name) => ({ name, action: 'install', status: 'pending' }))] };
      return { run };
    }
    if (path.endsWith('/sync-status')) return { run: null };
    if (path.endsWith('/plugins')) return { distro: 'ssh:me@dev', plugins: [], windowsOnly: [] };
    return hosts;
  });
  const element = f.React.createElement(f.registered.get('wsl-plugins'), {});
  await f.render(element);
  await f.flush();
  let tree = await f.render(element);
  f.button(tree, 'sync.load').props.onClick();
  await f.flush();
  tree = await f.render(element);
  const one = (name) => f.all(tree).find((node) => node.type === 'button' && node.props['data-lwr-sync-one'] === name);
  const tag = (name) => f.text(f.all(tree).find((node) => node.props?.['data-lwr-sync-status'] === name));
  const syncs = () => f.requests.filter((request) => request.path.endsWith('/plugins/sync')).map((request) => request.payload.names);
  one('a').props.onClick();
  await f.flush();
  tree = await f.render(element);
  assert.deepEqual(syncs(), [['a']], 'only that plugin is sent');
  assert.equal(one('a'), undefined, 'a plugin in the run shows its progress instead of a button');
  assert.match(tag('a'), /sync\.item\.running/);
  assert.equal(one('b').props.disabled, false, 'another plugin can join the running sync');
  one('b').props.onClick();
  await f.flush();
  tree = await f.render(element);
  assert.deepEqual(syncs(), [['a'], ['b']]);
  assert.match(tag('b'), /sync\.item\.pending/);
  assert.equal(f.button(tree, 'sync.run').props.disabled, true, 'queued plugins are not offered again for batch sync');
});

test('Plugin sync panel: the comparison below is made again after a sync, even when the page re-renders first', async () => {
  // In React, setRun() re-renders before the new plan arrives, which runs the
  // poll effect's cleanup. The new plan must still replace the old one.
  let installed = false;
  let releasePlan;
  const before = { source: null, target: 'ssh:me@dev', targetOnly: [], rows: [{ name: 'dsh-ops', version: '0.4.4', state: 'missing', action: 'install', spec: 'dsh-ops@0.4.4' }] };
  const after = { source: null, target: 'ssh:me@dev', targetOnly: [], rows: [{ name: 'dsh-ops', version: '0.4.4', targetVersion: '0.4.4', state: 'same' }] };
  let run = { id: 'run-1', source: null, target: 'ssh:me@dev', status: 'running', elapsedMs: 0, items: [{ name: 'dsh-ops', action: 'install', status: 'running' }] };
  const hosts = { ...status, distros: [{ name: 'ssh:me@dev', state: 'connected' }] };
  const timers = [];
  const f = load((path) => {
    if (path.endsWith('/sync-plan')) return installed ? new Promise((resolve) => { releasePlan = () => resolve(after); }) : before;
    if (path.endsWith('/plugins/sync')) return { run };
    if (path.endsWith('/sync-status')) return { run: installed ? run : null };
    if (path.endsWith('/plugins')) return { distro: 'ssh:me@dev', plugins: [], windowsOnly: [] };
    if (path.endsWith('/install-status')) return { job: null };
    return hosts;
  }, { setTimeout: (fn) => { timers.push(fn); return timers.length; } });
  const element = f.React.createElement(f.registered.get('wsl-plugins'), {});
  await f.render(element);
  await f.flush();
  let tree = await f.render(element);
  f.button(tree, 'sync.load').props.onClick();
  await f.flush();
  tree = await f.render(element);
  f.all(tree).find((node) => node.type === 'button' && node.props['data-lwr-sync-one'] === 'dsh-ops').props.onClick();
  await f.flush();
  tree = await f.render(element);
  installed = true;
  run = { ...run, status: 'done', items: [{ name: 'dsh-ops', action: 'install', status: 'done' }] };
  // The poll sees the run done; the page re-renders while the new plan is still on its way.
  const polls = timers.splice(0).map((fire) => fire());
  for (let round = 0; round < 3; round++) {
    await f.flush();
    tree = await f.render(element);
  }
  assert.equal(typeof releasePlan, 'function', 'a new comparison was requested');
  // Until it answers, the row neither goes back to "Install" nor claims success.
  const waiting = f.all(tree).find((node) => node.props?.['data-lwr-sync-row'] === 'dsh-ops');
  assert.match(f.text(f.all(waiting).find((node) => node.props?.['data-lwr-sync-status'] === 'dsh-ops')), /sync\.item\.confirming/, 'the row says the result is being confirmed');
  assert.equal(f.all(waiting).some((node) => node.props?.['data-lwr-sync-one'] === 'dsh-ops'), false, 'no Install button while confirming');
  assert.equal(f.all(waiting).find((node) => node.type === 'input').props.disabled, true);
  releasePlan();
  await Promise.all(polls);
  for (let round = 0; round < 3; round++) {
    await f.flush();
    tree = await f.render(element);
  }
  const row = f.all(tree).find((node) => node.props?.['data-lwr-sync-row'] === 'dsh-ops');
  assert.match(f.text(row), /sync\.state\.same/, 'the row now says in sync');
  assert.equal(f.all(row).some((node) => node.props?.['data-lwr-sync-one'] === 'dsh-ops'), false, 'no install button is left');
});

test('Plugin sync panel: when a sync ends, its own comparison is made again (no stale "install" left)', async () => {
  let installed = false;
  const before = { source: null, target: 'ssh:me@dev', targetOnly: [], rows: [{ name: 'dsh-ops', version: '0.4.4', state: 'missing', action: 'install', spec: 'dsh-ops@0.4.4' }] };
  const after = { source: null, target: 'ssh:me@dev', targetOnly: [], rows: [{ name: 'dsh-ops', version: '0.4.4', targetVersion: '0.4.4', state: 'same' }] };
  let run = { id: 'run-1', source: null, target: 'ssh:me@dev', status: 'running', elapsedMs: 0, items: [{ name: 'dsh-ops', action: 'install', status: 'running' }] };
  const hosts = { ...status, distros: [{ name: 'ssh:me@dev', state: 'connected' }] };
  const timers = [];
  const f = load((path) => {
    if (path.endsWith('/sync-plan')) return installed ? after : before;
    if (path.endsWith('/plugins/sync')) return { run };
    if (path.endsWith('/sync-status')) return { run: installed ? run : null };
    if (path.endsWith('/plugins')) return { distro: 'ssh:me@dev', plugins: [], windowsOnly: [] };
    if (path.endsWith('/install-status')) return { job: null };
    return hosts;
  }, { setTimeout: (fn) => { timers.push(fn); return timers.length; } });
  const element = f.React.createElement(f.registered.get('wsl-plugins'), {});
  await f.render(element);
  await f.flush();
  let tree = await f.render(element);
  f.button(tree, 'sync.load').props.onClick();
  await f.flush();
  tree = await f.render(element);
  f.all(tree).find((node) => node.type === 'button' && node.props['data-lwr-sync-one'] === 'dsh-ops').props.onClick();
  await f.flush();
  tree = await f.render(element);
  installed = true;
  run = { ...run, status: 'done', items: [{ name: 'dsh-ops', action: 'install', status: 'done' }] };
  for (let round = 0; round < 4; round++) {
    for (const fire of timers.splice(0)) await fire();
    await f.flush();
    tree = await f.render(element);
  }
  const row = f.all(tree).find((node) => node.props?.['data-lwr-sync-row'] === 'dsh-ops');
  assert.match(f.text(row), /sync\.state\.same/, 'the row now says in sync');
  assert.equal(f.all(row).some((node) => node.props?.['data-lwr-sync-one'] === 'dsh-ops'), false, 'no install button is left');
  assert.match(f.text(tree), /sync\.done/);
});

test('"Session in use" on a remote host names the dsh holding the lock; other text stays native', async () => {
  let holder = null;
  const f = load((path) => {
    if (path.endsWith('/session-holder')) return { holder };
    return status;
  }, { runEffects: ['wsl-remote: remote session-in-use message'] });
  const ask = () => f.locale.translate('conversation', 'error.sessionInUse');
  assert.equal(ask(), 'native:conversation.error.sessionInUse', 'nothing known yet: the page\'s own words');
  holder = { sessionId: 's1', host: 'ssh:bwg', hostLabel: 'SSH: bwg', holder: 'dsh (pid 4184571, port 3080, https://dsh.opentk.ai)' };
  await f.flush();
  await f.flush();
  assert.equal(ask(), 'session.heldRemote', 'the holder found by the Host is described');
  assert.ok(f.requests.some((request) => request.path.endsWith('/session-holder')));
  assert.equal(f.locale.translate('conversation', 'queue.steer'), 'native:conversation.queue.steer');
});
