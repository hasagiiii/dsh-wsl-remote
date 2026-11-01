import assert from 'node:assert/strict';
import test from 'node:test';
import { WslBridge } from '../lib/bridge/bridge.js';
import { emptyWorkspaceState } from '../lib/bridge/merge.js';

const workspace = { workspaceId: 'wsl-project', path: '/home/test/project', title: 'project', sessionIds: ['remote-session'], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const summary = { sessionId: 'remote-session', agentAvailable: false, running: false, blank: false, updatedAt: 42, cwd: workspace.path, projections: { kind: 'cached', asOfSeq: 0, values: { title: 'Existing WSL conversation' } } };
const snapshot = { workspace: { ...emptyWorkspaceState(), items: [workspace] }, sessions: [summary] };
const windowsResult = { ok: true, value: { items: [] } };
function fixture(saved = {}) {
  const writes = [];
  const bridge = new WslBridge({
    logger: { info() {}, warn() {} },
    hosts: { distros: () => [], loadOrder: () => [], subscribe: () => () => {}, connected: () => false },
    windows: { knows: async () => false, workspaces: emptyWorkspaceState },
    cache: { load: () => structuredClone(saved), save: (hosts) => writes.push(structuredClone(hosts)) },
  });
  return { bridge, writes };
}
function source(first) {
  let initial = true;
  let wake;
  let closed = false;
  return {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (closed) return Promise.resolve({ done: true });
      if (initial) { initial = false; return Promise.resolve({ value: first, done: false }); }
      return new Promise((resolve) => { wake = resolve; });
    },
    return() { closed = true; wake?.({ done: true }); return Promise.resolve({ done: true }); },
  };
}
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('startup remained blocked or update never arrived')), 300); })]); }
  finally { clearTimeout(timer); }
}
function entry() {
  return { abort: new AbortController(), resolvers: { events() {}, workspace() {}, control() {} } };
}
async function frames(bridge, method, value, result = windowsResult) {
  const current = entry();
  const client = { stream: async function* () { yield value; }, call: async (endpoint, payload) => {
    assert.equal(endpoint, 'session/list');
    assert.deepEqual(payload, { args: { _request: {} } });
    return result;
  } };
  await bridge[method]('Ubuntu', current, client).catch((error) => {
    if (!error.message.endsWith(' ended')) throw error;
  });
}

test('cold start: late WSL connection publishes existing sessions and first projections', async () => {
  const { bridge } = fixture();
  const events = bridge.mergedEvents(source({ type: 'ready', clientId: 'browser' }));
  const workspaces = bridge.mergedWorkspaceFollow(source({ type: 'baseline', value: emptyWorkspaceState() }));
  const controls = bridge.mergedControl(source({ type: 'baseline', value: { projections: {} } }));
  try {
    assert.equal((await bridge.mergedList(windowsResult, {})).value.items.length, 0);
    await within(events.next());
    assert.equal((await within(workspaces.next())).value.value.items.length, 0);
    await within(controls.next());
    const nextEvent = events.next();
    const nextWorkspace = workspaces.next();
    const nextControl = controls.next();
    await frames(bridge, 'followWorkspaces', { type: 'baseline', value: snapshot.workspace });
    await frames(bridge, 'followControl', { type: 'baseline', value: { projections: { 'remote-session': { asOfSeq: 8, values: { title: 'Fresh title' } } } } });
    await frames(bridge, 'followEvents', { type: 'ready', clientId: 'wsl' }, { ok: true, value: { items: [summary] } });
    assert.equal((await within(nextWorkspace)).value.value.items[0].workspaceId, workspace.workspaceId);
    assert.equal((await within(nextControl)).value.value, 'Fresh title');
    const event = (await within(nextEvent)).value;
    assert.equal(event.event, 'api-session/added');
    assert.equal(event.args[0].sessionId, summary.sessionId);
    assert.equal(event.args[0].projections.values.title, 'Fresh title', 'a list reply must not overwrite a newer control projection');
    assert.equal((await bridge.mergedList(windowsResult, {})).value.items[0].sessionId, summary.sessionId);
  } finally {
    await bridge.stop();
    await Promise.all([events.return(), workspaces.return(), controls.return()]);
  }
});

test('warm start: first workspace and session responses include cached WSL before discovery or readiness', async () => {
  const { bridge } = fixture({ Ubuntu: snapshot });
  const never = new Promise(() => {});
  bridge.live.set('Ubuntu', { ready: { workspace: never }, abort: new AbortController(), resolvers: {}, client: Promise.resolve({ close() {} }) });
  const stream = bridge.mergedWorkspaceFollow(source({ type: 'baseline', value: emptyWorkspaceState() }));
  try {
    const baseline = (await within(stream.next())).value;
    assert.equal(baseline.type, 'baseline');
    assert.deepEqual(baseline.value.items.map((item) => item.workspaceId), [workspace.workspaceId]);
    // This is the native sidebar's destructive retainAccountKeys behavior.
    for (const expanded of [true, false]) {
      const expansion = { 'wsl-project': expanded };
      const kept = Object.fromEntries(Object.entries(expansion).filter(([id]) => baseline.value.items.some((item) => item.workspaceId === id)));
      assert.equal(kept['wsl-project'], expanded);
    }
    const manualOrder = { 'wsl-project': ['remote-session'] };
    const keptOrder = Object.fromEntries(Object.entries(manualOrder).filter(([id]) => baseline.value.items.some((item) => item.workspaceId === id)));
    assert.deepEqual(keptOrder, manualOrder);
    const list = await within(bridge.mergedList(windowsResult, {}));
    assert.equal(list.value.items[0].projections.values.title, 'Existing WSL conversation');
    assert.equal(await bridge.ownerOf(['remote-session']), 'Ubuntu');
  } finally { await bridge.stop(); await stream.return(); }
});

test('browser opening events after hydration still receives remote summaries', async () => {
  const { bridge } = fixture();
  assert.equal((await bridge.mergedList(windowsResult, {})).value.items.length, 0);
  await frames(bridge, 'followEvents', { type: 'ready', clientId: 'wsl' }, { ok: true, value: { items: [summary] } });
  const events = bridge.mergedEvents(source({ type: 'ready', clientId: 'browser' }));
  try {
    await events.next();
    assert.equal((await within(events.next())).value.args[0].sessionId, summary.sessionId);
  } finally { await bridge.stop(); await events.return(); }
});

test('reconnect replaces stale summaries and broadcasts removals; failed refresh retains cache', async () => {
  const { bridge, writes } = fixture({ Ubuntu: snapshot });
  const sent = [];
  bridge.broadcast = (event) => sent.push(event);
  try {
    await assert.rejects(bridge.refreshSessions('Ubuntu', entry(), { call: async () => ({ ok: false, error: { message: 'offline' } }) }), /offline/);
    assert.equal(bridge.sessionCache.get('Ubuntu').length, 1);
    await bridge.refreshSessions('Ubuntu', entry(), { call: async () => ({ ok: true, value: { items: [] } }) });
    assert.deepEqual(sent, [{ type: 'emit', event: 'api-session/removed', args: ['remote-session'] }]);
    assert.deepEqual((await bridge.mergedList(windowsResult, {})).value.items, []);
    bridge.flushCache();
    assert.deepEqual(writes.at(-1).Ubuntu.sessions, []);
  } finally { await bridge.stop(); }
});

test('live additions, titles, activity and deletion keep the restart snapshot current', async () => {
  const { bridge, writes } = fixture();
  try {
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/added', args: [structuredClone(summary)] });
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/activity', args: ['remote-session', 100] });
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/status', args: ['remote-session', true] });
    await frames(bridge, 'followControl', { type: 'projection', sessionId: 'remote-session', seq: 9, key: 'title', value: 'Renamed' });
    bridge.flushCache();
    assert.equal(writes.at(-1).Ubuntu.sessions[0].projections.values.title, 'Renamed');
    assert.equal(writes.at(-1).Ubuntu.sessions[0].updatedAt, 100);
    assert.equal(writes.at(-1).Ubuntu.sessions[0].running, true);
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/removed', args: ['remote-session'] });
    bridge.flushCache();
    assert.deepEqual(writes.at(-1).Ubuntu.sessions, []);
  } finally { await bridge.stop(); }
});

test('a deletion between initial list and events open is replayed to the new browser', async () => {
  const { bridge } = fixture({ Ubuntu: snapshot });
  const list = await bridge.mergedList(windowsResult, {});
  assert.equal(list.value.items.length, 1);
  await bridge.refreshSessions('Ubuntu', entry(), { call: async () => ({ ok: true, value: { items: [] } }) });
  const events = bridge.mergedEvents(source({ type: 'ready', clientId: 'browser' }));
  try {
    await events.next();
    assert.deepEqual((await within(events.next())).value, { type: 'emit', event: 'api-session/removed', args: ['remote-session'] });
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/added', args: [summary] });
    assert.equal(bridge.removedSessions.has('remote-session'), false);
  } finally { await bridge.stop(); await events.return(); }
});

test('fresh list watermarks win over an older control block', async () => {
  const { bridge } = fixture();
  bridge.projections.set('Ubuntu', new Map([['remote-session', { asOfSeq: 2, values: { title: 'Old' } }]]));
  await bridge.refreshSessions('Ubuntu', entry(), { call: async () => ({ ok: true, value: { items: [{ ...summary, projections: { kind: 'sequenced', asOfSeq: 5, values: { title: 'New' } } }] } }) });
  assert.equal(bridge.sessionCache.get('Ubuntu')[0].projections.values.title, 'New');
  await bridge.stop();
});

test('native status and disposal semantics survive a later list request', async () => {
  const { bridge } = fixture();
  try {
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/added', args: [{ ...summary, blank: true, origin: 'subagent' }] });
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/status', args: ['remote-session', true] });
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/activity', args: ['remote-session', 100] });
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/activity', args: ['remote-session', 50] });
    const running = (await bridge.mergedList(windowsResult, {})).value.items[0];
    assert.equal(running.running, true);
    assert.equal(running.agentAvailable, true);
    assert.equal(running.blank, false);
    assert.equal(running.updatedAt, 100);
    bridge.receiveEvent('Ubuntu', { type: 'emit', event: 'api-session/removed', args: ['remote-session'] });
    const disposed = (await bridge.mergedList(windowsResult, {})).value.items[0];
    assert.equal(disposed.sessionId, 'remote-session');
    assert.equal(disposed.running, false);
    assert.equal(disposed.agentAvailable, false);
  } finally { await bridge.stop(); }
});

test('a cancelled old host cannot overwrite the new list', async () => {
  const { bridge } = fixture({ Ubuntu: snapshot });
  const current = entry();
  const pending = Promise.withResolvers();
  const refreshing = bridge.refreshSessions('Ubuntu', current, { call: () => pending.promise });
  current.abort.abort();
  pending.resolve({ ok: true, value: { items: [] } });
  await refreshing;
  assert.equal(bridge.sessionCache.get('Ubuntu').length, 1);
  await bridge.stop();
});
