/**
 * Unit checks that need neither WSL nor DeepSeek Harness:
 *   node test/unit.mjs
 * Covers the version gate, the version-1 → 2 settings migration, and the
 * credential-sharing protocol between RemoteConnection (Windows) and the WSL
 * agent plugin, wired back to back over an in-memory pipe.
 */
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PassThrough } from 'node:stream';
import { compareVersions } from '../lib/version.js';
import { loadSettings, writeSettings } from '../lib/state.js';
import { RemoteConnection, parseProbe, renderLauncher } from '../lib/remote.js';
import { Mux } from '../lib/mux.js';
import { decode, parseDistros } from '../lib/wsl.js';
import { dshRequirement, requirementMessage } from '../lib/requirements.js';
import { parseRequest } from '../lib/requests.js';
import { applyWorkspaceFrame, distroOfPath, emptyWorkspaceState, insertBefore, mergeWorkspaces, requestSessionHints, sessionHints, splitBytes, toHostArgs, wslSummary, baselineFrames } from '../lib/bridge/merge.js';
import { fromUncPath, toUncPath } from '../lib/linux-fs.js';
import { comparePlugins, wslInstallSpec } from '../lib/plugins.js';
import { PluginInstalls, STALL_MS } from '../lib/installs.js';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';

let failures = 0;
async function test(name, body) {
  try {
    await body();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}\n     ${error.stack}`);
  }
}

await test('version precedence', () => {
  assert.ok(compareVersions('0.2.1-rc.2', '0.2.1-rc.3') < 0);
  assert.ok(compareVersions('0.2.1-rc.10', '0.2.1-rc.9') > 0);
  assert.ok(compareVersions('0.2.1', '0.2.1-rc.9') > 0);
  assert.ok(compareVersions('0.2.2-alpha.2', '0.2.1-rc.5') > 0);
  assert.equal(compareVersions('dsh 0.2.1-rc.3\n', '0.2.1-rc.3'), 0);
  assert.ok(compareVersions('', '0.0.1') < 0);
});

await test('settings: version-1 file migrates to remote connections', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wslr-')), 'wsl-remote.json');
  writeFileSync(file, JSON.stringify({ environment: 'Ubuntu', node: '/usr/bin/node', serverDir: '/x', shells: { Ubuntu: '/usr/bin/zsh' } }));
  const { settings, migrated } = loadSettings(file);
  assert.equal(migrated, true);
  assert.deepEqual(settings, { ports: {}, version: 2, shareLogin: true, profile: 'web', autoConnect: [], workspaceOrder: [], sshHosts: [] });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2);
  assert.equal(loadSettings(file).migrated, false);
});

await test('wsl --list --verbose parsing', () => {
  const english = '  NAME            STATE           VERSION\r\n* Ubuntu-26.04    Running         2\r\n  Debian          Stopped         1\r\n  docker-desktop  Running         2\r\n';
  assert.deepEqual(parseDistros(english), [{ name: 'Ubuntu-26.04', isDefault: true }]);
  const chinese = '  名称            状态           版本\r\n* Ubuntu-26.04    Stopped         2\r\n  Arch            Running         2\r\n';
  assert.deepEqual(parseDistros(chinese), [{ name: 'Ubuntu-26.04', isDefault: true }, { name: 'Arch', isDefault: false }]);
  assert.deepEqual(parseDistros(decode(Buffer.from(`\uFEFF${english}`, 'utf16le'))), [{ name: 'Ubuntu-26.04', isDefault: true }]);
  assert.deepEqual(parseDistros(''), []);
});

await test('probe: dsh, OS and install facts', () => {
  const stdout = [
    '__WSLR__ shell=/usr/bin/zsh',
    '__WSLR__ osName=Ubuntu',
    '__WSLR__ osVersion=26.04',
    '__WSLR__ osPretty=Ubuntu 26.04 LTS',
    '__WSLR__ home=/home/me',
    'motd noise from the login shell',
    '',
    '__WSLR__ path=/home/me/.nvm/versions/node/v24.19.0/bin/dsh',
    '__WSLR__ dsh=0.2.1-rc.5',
    '__WSLR__ node=/home/me/.nvm/versions/node/v24.19.0/bin/node',
    '__WSLR__ nodeVersion=v24.19.0',
    '__WSLR__ npm=/home/me/.nvm/versions/node/v24.19.0/bin/npm',
    '__WSLR__ nvm=1',
    '__WSLR__ localBinOnPath=1',
  ].join('\n');
  const facts = parseProbe(stdout);
  assert.equal(facts.dshPath, '/home/me/.nvm/versions/node/v24.19.0/bin/dsh');
  assert.equal(facts.dsh, '0.2.1-rc.5');
  assert.deepEqual(facts.os, { name: 'Ubuntu', version: '26.04', pretty: 'Ubuntu 26.04 LTS' });
  assert.equal(facts.home, '/home/me');
  assert.equal(facts.nvm, true);
  assert.equal(facts.localBinOnPath, true);
  assert.equal(dshRequirement(facts), undefined);
  assert.equal(dshRequirement({ ...facts, dsh: '0.2.1-rc.2' }).reason, 'dsh-outdated', 'merged sessions need the same DSH release on both sides');
  assert.equal(parseProbe('').os, undefined);
});

await test('install guidance: missing dsh, missing node, outdated dsh', () => {
  const withNode = dshRequirement({ dshPath: '', node: '/usr/bin/node', npm: '/usr/bin/npm', nvm: false });
  assert.equal(withNode.reason, 'dsh-missing');
  assert.deepEqual(withNode.steps.map((step) => step.command), ['npm install -g @deepseek-ai/dsh', 'dsh --version']);

  const bare = dshRequirement({ dshPath: '', node: '', npm: '', nvm: false });
  assert.deepEqual(bare.steps.map((step) => step.note), ['nvm', 'node-after-nvm', 'install', 'verify']);
  assert.match(bare.steps[0].command, /nvm-sh\/nvm\/.*install\.sh \| bash$/);
  assert.equal(bare.steps[1].command, 'nvm install --lts');

  const nvmOnly = dshRequirement({ dshPath: '', node: '', npm: '', nvm: true });
  assert.deepEqual(nvmOnly.steps.map((step) => step.note), ['node', 'install', 'verify']);

  const old = dshRequirement({ dshPath: '/usr/bin/dsh', dsh: '0.2.0', node: '/usr/bin/node', npm: '/usr/bin/npm' });
  assert.equal(old.reason, 'dsh-outdated');
  assert.equal(old.found, '0.2.0');
  assert.deepEqual(old.steps.map((step) => step.note), ['update', 'verify']);
  assert.match(requirementMessage('Ubuntu', old), /^dsh 0\.2\.0 in Ubuntu is older than the required .*: npm install -g @deepseek-ai\/dsh$/);
  assert.match(requirementMessage('Ubuntu', bare), /not found on the login PATH of Ubuntu.*&& nvm install --lts && npm install -g @deepseek-ai\/dsh$/);
});

await test('dsh-harness: launcher template and request files', () => {
  const template = readFileSync(new URL('../server/dsh-harness.sh', import.meta.url), 'utf8');
  const script = renderLauncher(template, { windowsExe: "D:\\it's\\DeepSeek Harness.exe", requestDir: 'C:\\Users\\me\\.dsh\\wsl-remote\\requests' });
  assert.match(script, /^WINDOWS_EXE='D:\\it'\\''s\\DeepSeek Harness\.exe'$/m);
  assert.match(script, /^REQUEST_DIR='C:\\Users\\me\\\.dsh\\wsl-remote\\requests'$/m);
  assert.ok(!script.includes('@@'));
  assert.ok(script.includes('@local/dsh-wsl-remote'), 'the ownership mark guards against overwriting a foreign file');

  assert.deepEqual(parseRequest(Buffer.from("dsh-harness/1\0Ubuntu-26.04\0/tmp/a b/中文 'q'\0")), { distro: 'Ubuntu-26.04', path: "/tmp/a b/中文 'q'" });
  assert.equal(parseRequest(Buffer.from('dsh-harness/1\0Ubuntu\0relative/path\0')), undefined);
  assert.equal(parseRequest(Buffer.from('dsh-harness/1\0bad name\0/x\0')), undefined);
  assert.equal(parseRequest(Buffer.from('something else')), undefined);
});

await test('WSL path spelling round-trips', () => {
  assert.equal(toUncPath('Ubuntu-26.04', '/home/me/repo'), '\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo');
  assert.equal(toUncPath('Ubuntu-26.04', '/'), '\\\\wsl.localhost\\Ubuntu-26.04\\');
  assert.deepEqual(fromUncPath('\\\\wsl.localhost\\Ubuntu-26.04\\home\\me\\repo'), { distro: 'Ubuntu-26.04', path: '/home/me/repo' });
  assert.deepEqual(fromUncPath('\\\\wsl$\\Debian\\x\\..\\y'), { distro: 'Debian', path: '/y' });
  assert.equal(fromUncPath('C:\\work'), undefined);
});

await test('merge: which Session a Remote call names', () => {
  assert.deepEqual(sessionHints({ request: { sessionId: 's1' } }), ['s1']);
  assert.deepEqual(sessionHints({ agentId: 'a1', line: '/x' }), ['a1']);
  assert.deepEqual(sessionHints({ workspaceFileScopeId: 's2', path: 'x' }), ['s2']);
  assert.deepEqual(sessionHints({ request: { address: { kind: 'subagent', parentSessionId: 'p', childSessionId: 'c' } } }), ['p', 'c']);
  assert.deepEqual(sessionHints({ childSessionId: 'c', parentSessionId: 'p' }), ['p', 'c']);
  assert.deepEqual(sessionHints({}), []);
  assert.deepEqual(sessionHints(undefined), []);
});

await test('merge: byte results split into attachments', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(splitBytes({ a: 1 }), { value: { a: 1 } });
  const split = splitBytes({ file: { data: bytes, size: 3 }, list: [bytes] });
  assert.deepEqual(split.value, { file: { data: null, size: 3 }, list: [null] });
  assert.deepEqual(split.attachments.map((item) => item.path), [['file', 'data'], ['list', 0]]);
  assert.equal(split.attachments[0].bytes, bytes);
});

await test('merge: workspace follow frames', () => {
  let state = emptyWorkspaceState();
  const a = { workspaceId: 'a', path: '/a', title: 'a', sessionIds: [], createdAt: '1', updatedAt: '1' };
  const b = { workspaceId: 'b', path: '/b', title: 'b', sessionIds: ['s'], createdAt: '1', updatedAt: '1' };
  state = applyWorkspaceFrame(state, { type: 'baseline', value: { items: [a], archivedSessionIds: [], pinnedSessionIds: [] } });
  state = applyWorkspaceFrame(state, { type: 'upsert', workspace: b });
  assert.deepEqual(state.items.map((item) => item.workspaceId), ['a', 'b']);
  state = applyWorkspaceFrame(state, { type: 'order', workspaceIds: ['b', 'a'] });
  assert.deepEqual(state.items.map((item) => item.workspaceId), ['b', 'a']);
  state = applyWorkspaceFrame(state, { type: 'archived', archivedSessionIds: ['s'] });
  state = applyWorkspaceFrame(state, { type: 'remove', workspaceId: 'b' });
  assert.deepEqual(state, { items: [a], archivedSessionIds: ['s'], pinnedSessionIds: [] });
});

await test('merge: Windows and WSL workspaces in one list', () => {
  const win = { workspaceId: 'w1', path: 'C:\\work', title: 'work', sessionIds: ['ws1'], createdAt: '2026-01-01', updatedAt: '2026-01-02' };
  const legacy = { workspaceId: 'w2', path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', title: 'repo', sessionIds: ['old'], createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const linux = { workspaceId: 'l1', path: '/home/me/repo', title: 'repo', sessionIds: ['ls1'], createdAt: '2026-02-01', updatedAt: '2026-02-03' };
  const other = { workspaceId: 'l2', path: '/srv/x', title: 'x', sessionIds: [], createdAt: '2026-02-01', updatedAt: '2026-02-01' };
  const { baseline, owners, order } = mergeWorkspaces({
    windows: { items: [win, legacy], archivedSessionIds: ['a1'], pinnedSessionIds: [] },
    hosts: [{ distro: 'Ubuntu', state: { items: [linux, other], archivedSessionIds: ['a2'], pinnedSessionIds: ['p2'] } }],
    order: ['l2'],
  });
  assert.deepEqual(order, ['l2', 'w1', 'w2']);
  // WSL workspaces keep their Linux paths; a legacy \\wsl.localhost row shows the WSL one's.
  assert.deepEqual(baseline.items.map((item) => item.path), ['/srv/x', 'C:\\work', '/home/me/repo']);
  // The legacy Windows row and the WSL row of the same folder are one row, under the Windows id.
  const merged = baseline.items[2];
  assert.equal(merged.workspaceId, 'w2');
  assert.deepEqual(merged.sessionIds, ['ls1', 'old']);
  assert.equal(merged.updatedAt, '2026-02-03');
  assert.deepEqual(owners.get('w2'), { host: 'Ubuntu', id: 'l1', legacy: 'w2' });
  assert.deepEqual(owners.get('l2'), { host: 'Ubuntu', id: 'l2' });
  assert.deepEqual(owners.get('w1'), { host: 'windows', id: 'w1' });
  assert.deepEqual(baseline.archivedSessionIds, ['a1', 'a2']);
  assert.deepEqual(baseline.pinnedSessionIds, ['p2']);
  assert.deepEqual(insertBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(insertBefore(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
});

await test('merge: WSL values keep Linux paths; picker UNC input is sent as Linux', () => {
  assert.deepEqual(wslSummary('Ubuntu', { sessionId: 's', cwd: '/home/me' }), { sessionId: 's', cwd: '/home/me' });
  assert.deepEqual(wslSummary('Ubuntu', { sessionId: 's' }), { sessionId: 's' });
  const ids = { w2: 'l1' };
  assert.deepEqual(toHostArgs('session/create', { request: { workspaceId: 'w2' } }, (id) => ids[id]), { request: { workspaceId: 'l1' } });
  assert.deepEqual(toHostArgs('workspace/create', { request: { path: '\\\\wsl.localhost\\Ubuntu\\srv' } }, () => undefined), { request: { path: '/srv' } });
  assert.deepEqual(toHostArgs('session/prompt', { request: { sessionId: 's' } }, () => undefined), { request: { sessionId: 's' } });
});

await test('merge: which distribution a Linux path belongs to', () => {
  const roots = [{ distro: 'Ubuntu', path: '/home/me' }, { distro: 'Debian', path: '/home/me/deb' }, { distro: 'Arch', path: '/srv' }];
  assert.equal(distroOfPath('/home/me/repo/a.txt', roots), 'Ubuntu');
  assert.equal(distroOfPath('/home/me/deb/x', roots), 'Debian', 'the deepest workspace wins');
  assert.equal(distroOfPath('/home/me', roots), 'Ubuntu');
  assert.equal(distroOfPath('/home/meow', roots), undefined, 'a sibling prefix is not inside');
  assert.equal(distroOfPath('/tmp/x', roots, ['Ubuntu']), 'Ubuntu', 'outside every workspace: the only connected distribution');
  assert.equal(distroOfPath('/tmp/x', roots, ['Ubuntu', 'Arch']), undefined);
  assert.equal(distroOfPath('C:\\work', roots, ['Ubuntu']), undefined);
});

await test('merge: control baselines', () => {
  assert.deepEqual(baselineFrames({ projections: { s: { asOfSeq: 7, values: { title: 't' } } } }), [{ type: 'projection', sessionId: 's', key: 'title', value: 't', seq: 7 }]);
});

await test('routes: which WSL session a plugin request names', () => {
  const id = 'session-9a0d2c7e-1b2f-4c3d-8e9f-0a1b2c3d4e5f';
  assert.deepEqual(requestSessionHints(new URL(`http://x/sidebar/file?sessionId=${id}&path=a`)), [id]);
  assert.deepEqual(requestSessionHints(new URL(`http://x/sidebar/html/${encodeURIComponent(id)}/index.html`)), [id], 'a session-id path segment');
  assert.deepEqual(requestSessionHints(new URL('http://x/sidebar/api/fs.tree'), { sessionId: id, cwd: '/home/me' }), [id], 'a JSON body field');
  assert.deepEqual(requestSessionHints(new URL('http://x/sidebar/api/teams.taskCreate'), { rootSessionId: id }), [id]);
  assert.deepEqual(requestSessionHints(new URL('http://x/sidebar/api/x'), { request: { sessionId: id } }), [id]);
  assert.deepEqual(requestSessionHints(new URL('http://x/sidebar/bundle/client-editor.js')), [], 'shared assets name no session');
});

await test('bridge: a WSL workspace just added is routable before its follow stream echoes it', async () => {
  const { WslBridge } = await import('../lib/bridge/bridge.js');
  const calls = [];
  const fake = {
    call: async (endpoint, { args }) => {
      calls.push([endpoint, args]);
      if (endpoint === 'workspace/create') return { ok: true, value: { workspace: { workspaceId: 'l9', path: args.request.path, title: 'x', sessionIds: [], createdAt: '1', updatedAt: '1' } } };
      if (endpoint === 'session/create') return { ok: true, value: { sessionId: 'ws-new' } };
      return { ok: false, error: { code: 'x', message: 'x', details: {} } };
    },
  };
  const bridge = new WslBridge({
    logger: { info() {}, warn() {} },
    hosts: { distros: () => ['Ubuntu'], connected: () => true, url: () => 'u', ensure: async () => {}, subscribe: () => () => {}, loadOrder: () => [], saveOrder() {} },
    windows: { knows: async () => false, workspaces: () => ({ items: [], archivedSessionIds: [], pinnedSessionIds: [] }) },
  });
  bridge.client = async () => fake; // no follow stream at all: only unary results inform the merge
  let windowsCalls = 0;
  const windows = async () => {
    windowsCalls++;
    return { ok: false, error: { code: 'workspace/not-found', message: 'not a Windows workspace', details: {} } };
  };
  const added = await bridge.dispatchRpc('workspace/create', { args: { request: { path: '\\\\wsl.localhost\\Ubuntu\\home\\me\\x' } } }, undefined, undefined, windows);
  assert.ok(added.ok);
  assert.equal(added.value.workspace.path, '/home/me/x', 'shown with its Linux path');
  assert.deepEqual(calls[0], ['workspace/create', { request: { path: '/home/me/x' } }]);
  const created = await bridge.dispatchRpc('session/create', { args: { request: { workspaceId: added.value.workspace.workspaceId } } }, undefined, undefined, windows);
  assert.ok(created.ok, JSON.stringify(created));
  assert.equal(windowsCalls, 0, 'never sent to Windows');
  assert.deepEqual(calls[1], ['session/create', { request: { workspaceId: 'l9' } }]);
  assert.deepEqual(bridge.merged().baseline.items[0].sessionIds, ['ws-new'], 'the new session is listed in its workspace at once');
  assert.deepEqual(bridge.workspaceHosts(), { l9: 'Ubuntu' });
});

// A bounded wait makes a leaked stream an assertion failure, not a hung unit run.
async function within(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function pendingSource(first) {
  let initial = true;
  let waiting;
  let closed = false;
  return {
    returned: false,
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (closed) return Promise.resolve({ done: true });
      if (initial) {
        initial = false;
        return Promise.resolve({ value: first, done: false });
      }
      return new Promise((resolve) => { waiting = resolve; });
    },
    return() {
      this.returned = true;
      closed = true;
      waiting?.({ done: true });
      return Promise.resolve({ done: true });
    },
  };
}

for (const [method, opening] of [
  ['mergedWorkspaceFollow', { type: 'baseline', value: emptyWorkspaceState() }],
  ['mergedControl', { type: 'baseline', value: { projections: {} } }],
  ['mergedEvents', { type: 'ready', clientId: 'browser-before-reload' }],
]) {
  await test(`bridge lifecycle: stop closes active ${method} and its Windows source`, async () => {
    const { WslBridge } = await import('../lib/bridge/bridge.js');
    const bridge = new WslBridge({
      logger: { info() {}, warn() {} },
      hosts: { distros: () => [], loadOrder: () => [], subscribe: () => () => {} },
      windows: { knows: async () => false, workspaces: emptyWorkspaceState },
    });
    const source = pendingSource(opening);
    const controller = new AbortController();
    const stream = bridge[method](source, controller.signal);
    let pending;
    try {
      assert.equal((await within(stream.next(), `${method}: no opening frame`)).done, false);
      pending = stream.next();
      // In particular, let mergedEvents register after yielding its initial ready frame.
      await Promise.resolve();
      await within(bridge.stop(), `${method}: bridge.stop hung`);
      assert.equal((await within(pending, `${method}: consumer remained open after bridge.stop`)).done, true);
      assert.equal(source.returned, true, 'the original Windows iterator is released');
      assert.equal(bridge.listenerCount('workspace'), 0);
      assert.equal(bridge.listenerCount('projection'), 0);
      assert.equal(bridge.eventStreams.size, 0);
    } finally {
      controller.abort();
      await source.return();
      if (pending) await within(pending, `${method}: cleanup failed`).catch(() => {});
      await within(stream.return(), `${method}: iterator cleanup failed`).catch(() => {});
    }
  });
}

await test('bridge lifecycle: stop during control readiness cannot yield a retired baseline', async () => {
  const { WslBridge } = await import('../lib/bridge/bridge.js');
  const bridge = new WslBridge({
    logger: { info() {}, warn() {} },
    hosts: { distros: () => [], loadOrder: () => [], subscribe: () => () => {} },
    windows: { knows: async () => false, workspaces: emptyWorkspaceState },
  });
  const ready = Promise.withResolvers();
  const enteredReadiness = Promise.withResolvers();
  bridge.live.set('Ubuntu', {
    abort: new AbortController(),
    ready: { control: ready.promise },
    resolvers: { control: ready.resolve },
    client: Promise.resolve({ close() {} }),
  });
  const originalReady = bridge.hostsReady.bind(bridge);
  bridge.hostsReady = (kind) => { enteredReadiness.resolve(); return originalReady(kind); };
  const source = pendingSource({ type: 'baseline', value: { projections: {} } });
  const controller = new AbortController();
  const stream = bridge.mergedControl(source, controller.signal);
  const first = stream.next();
  try {
    await within(enteredReadiness.promise, 'control did not reach host-readiness wait');
    await within(bridge.stop(), 'stop during readiness hung');
    assert.equal((await within(first, 'stopped control still awaits its first frame')).done, true,
      'a bridge stopped during its readiness wait must not publish an opening baseline');
  } finally {
    controller.abort();
    ready.resolve();
    await source.return();
    await within(stream.return(), 'control readiness cleanup failed').catch(() => {});
  }
});

for (const cancellation of ['bridge stop', 'consumer abort']) {
  await test(`bridge lifecycle: ${cancellation} cancels a pending Windows source through Gateway`, async () => {
    const { WslBridge, wrapGateway } = await import('../lib/bridge/bridge.js');
    const bridge = new WslBridge({
      logger: { info() {}, warn() {} },
      hosts: { distros: () => [], loadOrder: () => [], subscribe: () => () => {} },
      windows: { knows: async () => false, workspaces: emptyWorkspaceState },
    });
    const caller = new AbortController();
    const sourceEnded = Promise.withResolvers();
    let sourceSignal;
    const gateway = {
      dispatchRpc() {},
      openWireStream(endpoint, payload, uplink, peer, signal) {
        sourceSignal = signal;
        return (async function* () {
          try {
            yield { type: 'baseline', value: emptyWorkspaceState() };
            if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
          } finally {
            sourceEnded.resolve();
          }
        })();
      },
    };
    const dispose = wrapGateway(gateway, bridge);
    const stream = await gateway.openWireStream('workspace/follow', {}, undefined, undefined, caller.signal);
    try {
      assert.equal((await within(stream.next(), 'no Windows opening snapshot')).done, false);
      const pending = stream.next();
      if (cancellation === 'bridge stop') await bridge.stop();
      else caller.abort();
      assert.equal((await within(pending, 'merged stream did not terminate')).done, true);
      await within(sourceEnded.promise, 'Windows generator remained blocked after cancellation');
      assert.equal(sourceSignal.aborted, true);
      assert.equal(caller.signal.aborted, cancellation === 'consumer abort', 'bridge stop must not abort its caller controller');
      assert.equal(bridge.lifetime.signal.aborted, cancellation === 'bridge stop', 'consumer cancellation must not stop the shared bridge');
    } finally {
      caller.abort();
      await bridge.stop();
      await within(stream.return(), 'Windows source cleanup failed').catch(() => {});
      dispose();
    }
  });
}

function gatewayFixture() {
  const calls = [];
  const gateway = {};
  const dispatch = function () { assert.equal(this, gateway); calls.push('original-rpc'); return 'rpc-result'; };
  const open = function () { assert.equal(this, gateway); calls.push('original-stream'); return 'stream-result'; };
  Object.defineProperty(gateway, 'dispatchRpc', { configurable: true, enumerable: false, writable: false, value: dispatch });
  Object.defineProperty(gateway, 'openWireStream', { configurable: true, enumerable: true, writable: true, value: open });
  const descriptors = Object.getOwnPropertyDescriptors(gateway);
  const bridge = (name) => ({
    dispatchRpc(endpoint, payload, signal, peer, windows) {
      calls.push(`${name}-rpc`);
      return windows(endpoint, payload, signal, peer);
    },
    openStream(endpoint, payload, uplink, peer, signal, windows) {
      calls.push(`${name}-stream`);
      return windows();
    },
  });
  return { gateway, calls, descriptors, bridge };
}

await test('bridge lifecycle: replacing Gateway wrappers does not dispatch through the old bridge', async () => {
  const { wrapGateway } = await import('../lib/bridge/bridge.js');
  const { gateway, calls, bridge } = gatewayFixture();
  const disposeA = wrapGateway(gateway, bridge('old'));
  const disposeB = wrapGateway(gateway, bridge('new'));
  try {
    assert.equal(await gateway.dispatchRpc('session/create', {}), 'rpc-result');
    assert.equal(await gateway.openWireStream('workspace/follow', {}), 'stream-result');
    assert.deepEqual(calls, ['new-rpc', 'original-rpc', 'new-stream', 'original-stream']);
  } finally {
    disposeA();
    disposeB();
  }
});

await test('bridge lifecycle: an old disposer cannot remove a newer Gateway wrapper', async () => {
  const { wrapGateway } = await import('../lib/bridge/bridge.js');
  const { gateway, calls, bridge } = gatewayFixture();
  const disposeA = wrapGateway(gateway, bridge('old'));
  const disposeB = wrapGateway(gateway, bridge('new'));
  try {
    disposeA();
    assert.equal(typeof gateway.dispatchRpc, 'function', 'new RPC wrapper survives old disposal');
    assert.equal(typeof gateway.openWireStream, 'function', 'new stream wrapper survives old disposal');
    assert.equal(await gateway.dispatchRpc('session/create', {}), 'rpc-result');
    assert.equal(await gateway.openWireStream('workspace/follow', {}), 'stream-result');
    assert.deepEqual(calls, ['new-rpc', 'original-rpc', 'new-stream', 'original-stream']);
  } finally {
    disposeB();
  }
});

await test('bridge lifecycle: Gateway disposal restores original own property descriptors', async () => {
  const { wrapGateway } = await import('../lib/bridge/bridge.js');
  const { gateway, descriptors, bridge } = gatewayFixture();
  const dispose = wrapGateway(gateway, bridge('only'));
  dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(gateway, 'dispatchRpc'), descriptors.dispatchRpc);
  assert.deepEqual(Object.getOwnPropertyDescriptor(gateway, 'openWireStream'), descriptors.openWireStream);
});

function clientActivationFixture() {
  const requests = [];
  const timers = new Map();
  let nextTimer = 0;
  let reconnects = 0;
  let connectionInjection;
  let dispose;
  let plugin;
  runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load(value) { plugin = value; } } },
    AbortController,
    console,
    fetch(path, init) {
      const deferred = Promise.withResolvers();
      requests.push({ path, init, ...deferred });
      return deferred.promise;
    },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, { filename: 'client.js' });
  const client = plugin.factory((name) => {
    if (name === 'react') return { createElement() {} };
    return {};
  });
  client.apply({
    inject(services, callback) {
      if (services.length === 1 && services[0] === 'connection') connectionInjection = callback;
    },
    effect() {},
    slots: { inject() {} },
    locale: { bind: () => (key) => key },
  });
  assert.equal(typeof connectionInjection, 'function', 'the browser plugin registers activation with its connection');
  connectionInjection({
    connection: { reconnect() { reconnects++; } },
    effect(start) { dispose = start(); },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    requests,
    timers,
    reconnects: () => reconnects,
    dispose: () => dispose(),
    async respond(index, status) {
      requests[index].resolve({ ok: true, json: async () => status });
      await flush();
    },
    async fail(index) {
      requests[index].reject(new Error('Host plugin is still loading'));
      await flush();
    },
    async retry() {
      assert.equal(timers.size, 1, 'only one readiness retry is scheduled');
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      await flush();
    },
  };
}

await test('browser activation: wait for bridge readiness, retry failures, reconnect exactly once', async () => {
  const client = clientActivationFixture();
  try {
    assert.equal(client.requests.length, 1);
    assert.equal(client.requests[0].path, 'api/local-wsl-remote/connections');
    assert.equal(client.requests[0].init.credentials, 'same-origin');
    assert.equal(client.reconnects(), 0);
    await client.respond(0, { bridgeReady: false });
    assert.equal(client.reconnects(), 0, 'opening streams before the Host merge is ready would retain Windows-only state');
    await client.retry();
    await client.fail(1);
    assert.equal(client.reconnects(), 0);
    await client.retry();
    await client.respond(2, { bridgeReady: true });
    assert.equal(client.reconnects(), 1);
    assert.equal(client.requests.length, 3);
    assert.equal(client.timers.size, 0, 'ready activation must not leave a recurring reconnect timer');
  } finally {
    client.dispose();
  }
});

await test('browser activation: disposal aborts pending readiness fetch and ignores its late response', async () => {
  const client = clientActivationFixture();
  const signal = client.requests[0].init.signal;
  assert.equal(signal.aborted, false);
  client.dispose();
  assert.equal(signal.aborted, true);
  // A fetch implementation may finish despite cancellation; no retired instance may reconnect.
  await client.respond(0, { bridgeReady: true });
  assert.equal(client.reconnects(), 0);
  assert.equal(client.timers.size, 0);
});

await test('browser activation: disposal cancels a scheduled readiness retry', async () => {
  const client = clientActivationFixture();
  await client.respond(0, { bridgeReady: false });
  assert.equal(client.timers.size, 1);
  client.dispose();
  assert.equal(client.timers.size, 0);
  assert.equal(client.requests.length, 1);
  assert.equal(client.reconnects(), 0);
});

await test('plugins: where each one is installed, and how a Windows one installs in WSL', () => {
  const wsl = [
    { name: '@deepseek-ai/dsh-base', availability: 'installation', installed: false, version: '0.2.1', enabled: true },
    { name: 'dsh-better-sidebar', availability: 'profile', installed: true, version: '0.28.1', enabled: true, removable: true, source: 'dsh-better-sidebar@^0.28.1' },
    { name: 'dsh-vscode-mode', availability: 'profile', installed: true, version: '0.19.2', enabled: false, removable: true },
    { name: 'same', availability: 'profile', installed: true, version: '1.0.0', enabled: true },
  ];
  const windows = [
    { name: '@deepseek-ai/dsh-base', availability: 'installation', installed: false, version: '0.2.1' },
    { name: 'dsh-better-sidebar', availability: 'profile', installed: true, version: '0.28.2', source: 'dsh-better-sidebar@^0.28.2' },
    { name: 'same', availability: 'profile', installed: true, version: '1.0.0' },
    { name: 'dsh-llm-tencent-intranet', availability: 'profile', installed: true, version: '2.0.2', source: 'link:F:/proj/dsh-llm-tencent-intranet' },
    { name: '@local/dsh-wsl-remote', availability: 'profile', installed: true, version: '4.0.0', source: 'link:F:/proj/dsh-wsl-remote' },
  ];
  const { plugins, windowsOnly } = comparePlugins(wsl, windows);
  assert.deepEqual(plugins.map((plugin) => [plugin.name, plugin.where, plugin.windows?.version ?? null, plugin.enabled]), [
    ['dsh-better-sidebar', 'both-differ', '0.28.2', true],
    ['dsh-vscode-mode', 'wsl', null, false],
    ['same', 'both', '1.0.0', true],
  ], 'shipped bundles are left out');
  assert.deepEqual(windowsOnly.map((plugin) => [plugin.name, plugin.installSpec]), [['dsh-llm-tencent-intranet', 'link:/mnt/f/proj/dsh-llm-tencent-intranet']], 'this plugin itself is never offered to WSL');
  assert.equal(wslInstallSpec({ name: 'x', source: 'x@^1.2.0' }), 'x@^1.2.0');
  assert.equal(wslInstallSpec({ name: 'x', source: 'file:C:\\work\\x' }), 'file:/mnt/c/work/x');
  assert.equal(wslInstallSpec({ name: 'x', source: 'link:\\\\server\\share\\x' }), 'x', 'a UNC folder falls back to the registry name');
  assert.equal(wslInstallSpec({ name: 'x' }), 'x');
});

await test('plugin installs: background job with live output, stall notice and cancel', async () => {
  let now = 1_000_000;
  const events = new EventEmitter();
  const calls = [];
  let finishInstall;
  const client = {
    call: async (endpoint, { args }) => {
      calls.push([endpoint, args]);
      if (endpoint === 'pluginManager/installBundle') return new Promise((resolve) => { finishInstall = resolve; });
      if (endpoint === 'pluginManager/cancelInstall') return { ok: true, value: { status: 'cancelled' } };
      return { ok: false, error: { code: 'x', message: 'x' } };
    },
  };
  const installs = new PluginInstalls({ client: async () => client, events, now: () => now });
  const job = installs.start('Ubuntu', 'dsh-x@1');
  assert.equal(job.status, 'running');
  assert.throws(() => installs.start('Ubuntu', 'dsh-y'), /already running/, 'one install per distribution at a time');
  await new Promise((resolve) => setImmediate(resolve));
  const [endpoint, args] = calls[0];
  assert.equal(endpoint, 'pluginManager/installBundle');
  assert.equal(args.options.requestId, job.id, 'the job id is the plugin manager request id');
  events.emit('plugin-install', { distro: 'Ubuntu', event: 'plugin-manager/install-state', value: { requestId: job.id, phase: 'installing' } });
  events.emit('plugin-install', { distro: 'Ubuntu', event: 'plugin-manager/install-log', value: { requestId: job.id, text: 'Progress: resolved 1\nDone in 1.5s\n' } });
  events.emit('plugin-install', { distro: 'Ubuntu', event: 'plugin-manager/install-log', value: { requestId: 'someone-else', text: 'not ours' } });
  let seen = installs.get(job.id);
  assert.equal(seen.phase, 'installing');
  assert.deepEqual(seen.lines, ['Progress: resolved 1', 'Done in 1.5s']);
  assert.equal(seen.stalled, false);
  now += STALL_MS + 1;
  assert.equal(installs.get(job.id).stalled, true, 'silent past the bound: stalled');
  seen = await installs.cancel(job.id);
  assert.deepEqual(calls[1], ['pluginManager/cancelInstall', { requestId: job.id }]);
  assert.equal(seen.cancelRequested, 'cancelled');
  finishInstall({ ok: true, value: { application: 'cancelled', changed: false } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installs.get(job.id).status, 'cancelled');
  assert.equal(installs.latest('Ubuntu').id, job.id);
  const next = installs.start('Ubuntu', 'dsh-y');
  await new Promise((resolve) => setImmediate(resolve));
  finishInstall({ ok: true, value: { application: 'applied', bundle: 'dsh-y' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(installs.get(next.id).status, 'done');
  installs.dispose();
  assert.equal(events.listenerCount('plugin-install'), 0);
});

await test('settings: invalid fields are dropped', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wslr-')), 'wsl-remote.json');
  const value = writeSettings({ shareLogin: false, profile: 'bad name', autoConnect: ['Ubuntu', 'x y', 'Ubuntu'], ports: { Ubuntu: 40123, Bad: 80 } }, file);
  assert.deepEqual(value, { ports: { Ubuntu: 40123 }, version: 2, shareLogin: false, profile: 'web', autoConnect: ['Ubuntu'], workspaceOrder: [], sshHosts: [] });
});

/** A credentials provider shaped like dsh-credentials-local (serialized modifyRecord). */
function memoryStore(label) {
  const refs = new Map();
  const records = new Map();
  const listeners = new Set();
  let chain = Promise.resolve();
  return {
    label,
    refs,
    records,
    listeners,
    notifyRecordUpdated(key) {
      for (const listener of listeners) listener(key);
    },
    notifyUpdated() {},
    resolve: async (ref) => (refs.has(ref) ? { value: refs.get(ref), source: label } : undefined),
    describe: async (ref) => (refs.has(ref) ? { configured: true, source: label, writable: true } : { configured: false, writable: true }),
    set: async (ref, value) => void refs.set(ref, value),
    unset: async (ref) => void refs.delete(ref),
    readRecord: async (key) => records.get(key),
    describeRecord: async (key) => (records.has(key) ? { configured: true, kind: records.get(key).kind, writable: true } : { configured: false, writable: true }),
    listRecords: async () => [...records].map(([key, record]) => ({ key, kind: record.kind })),
    modifyRecord(key, mutate) {
      const run = chain.then(async () => {
        const next = await mutate(records.get(key));
        if (next === undefined) return records.get(key);
        records.set(key, next);
        return next;
      });
      chain = run.catch(() => {});
      return run;
    },
    deleteRecord: async (key) => void records.delete(key),
  };
}

/** Serve the WSL agent against a fake ctx over in-memory streams. */
async function startAgent(input, output, wslStore) {
  // Deployed layout: agent.mjs and mux.js side by side.
  const dir = mkdtempSync(join(tmpdir(), 'wslr-agent-'));
  copyFileSync(new URL('../server/agent.mjs', import.meta.url), join(dir, 'agent.mjs'));
  copyFileSync(new URL('../lib/mux.js', import.meta.url), join(dir, 'mux.js'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const { serve } = await import(pathToFileURL(join(dir, 'agent.mjs')).href);
  const disposers = [];
  const ctx = {
    effect(factory) {
      const dispose = factory();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
    inject(_names, callback) {
      callback({ credentials: wslStore, effect: (factory) => disposers.push(factory()) });
    },
    get: (name) => (name === 'credentials' ? wslStore : undefined),
  };
  serve(ctx, input, output, { shareLogin: true });
  return () => disposers.forEach((dispose) => dispose());
}

await test('shared login: WSL reads and refreshes the Windows store under its lock', async () => {
  const windowsStore = memoryStore('windows');
  const wslStore = memoryStore('wsl');
  windowsStore.refs.set('DEEPSEEK_API_KEY', 'sk-windows');
  windowsStore.records.set('deepseek-account-platform/default', { kind: 'grant', payload: { version: 1, token: 'tok-1', issuer: 'https://platform.deepseek.com' } });
  wslStore.records.set('client-connection/browser-session', { kind: 'grant', payload: { secret: 'wsl-own' } });

  const toWindows = new PassThrough();
  const toWsl = new PassThrough();
  const connection = new RemoteConnection({
    distro: 'Test',
    packageDir: '.',
    logger: { info() {}, warn() {}, debug() {} },
    settings: () => ({ shareLogin: true, profile: 'web', ports: {} }),
    rememberPort() {},
    credentials: () => windowsStore,
    onCredentialEvents: (onRecord) => {
      windowsStore.listeners.add(onRecord);
      return () => windowsStore.listeners.delete(onRecord);
    },
  });
  // Windows side of the pipe, as launch() would build it.
  const session = {
    shareLogin: true, nextId: 1, pending: new Map(), opens: new Map(), disposers: [], stderr: [],
    hello: Promise.withResolvers(), url: Promise.withResolvers(),
  };
  session.mux = new Mux(toWindows, toWsl, {
    control: (payload) => connection.receive(session, JSON.parse(payload.toString('utf8'))),
  });
  connection.forwardCredentialEvents(session);

  const dispose = await startAgent(toWsl, toWindows, wslStore);
  const hello = await session.hello.promise;
  assert.equal(hello.agent, 2);

  // Reads come from Windows; the WSL-only cookie secret stays local.
  assert.deepEqual(await wslStore.resolve('DEEPSEEK_API_KEY'), { value: 'sk-windows', source: 'windows' });
  assert.equal((await wslStore.readRecord('deepseek-account-platform/default')).payload.token, 'tok-1');
  assert.equal((await wslStore.readRecord('client-connection/browser-session')).payload.secret, 'wsl-own');
  const keys = (await wslStore.listRecords()).map((entry) => entry.key).sort();
  assert.deepEqual(keys, ['client-connection/browser-session', 'deepseek-account-platform/default']);

  // A refresh in WSL runs inside the Windows store's serialized modify.
  const seen = [];
  const updated = new Promise((resolve) => wslStore.listeners.add((key) => key === 'deepseek-account-platform/default' && resolve()));
  const result = await wslStore.modifyRecord('deepseek-account-platform/default', async (current) => {
    seen.push(current.payload.token);
    return { kind: 'grant', payload: { ...current.payload, token: 'tok-2' } };
  });
  assert.equal(result.payload.token, 'tok-2');
  assert.deepEqual(seen, ['tok-1']);
  assert.equal(windowsStore.records.get('deepseek-account-platform/default').payload.token, 'tok-2');
  windowsStore.notifyRecordUpdated('deepseek-account-platform/default');
  await updated;

  // Concurrent refreshes on both sides never lose an update.
  await Promise.all([
    wslStore.modifyRecord('counter/x', async (current) => ({ kind: 'grant', payload: { n: (current?.payload.n ?? 0) + 1 } })),
    windowsStore.modifyRecord('counter/x', async (current) => ({ kind: 'grant', payload: { n: (current?.payload.n ?? 0) + 1 } })),
    wslStore.modifyRecord('counter/x', async (current) => ({ kind: 'grant', payload: { n: (current?.payload.n ?? 0) + 1 } })),
  ]);
  assert.equal(windowsStore.records.get('counter/x').payload.n, 3);

  // Writes and sign-out land on Windows.
  await wslStore.set('OTHER_KEY', 'v');
  assert.equal(windowsStore.refs.get('OTHER_KEY'), 'v');
  await wslStore.deleteRecord('deepseek-account-platform/default');
  assert.equal(windowsStore.records.has('deepseek-account-platform/default'), false);

  // A throwing WSL mutation surfaces as an error and leaves Windows unchanged.
  await assert.rejects(wslStore.modifyRecord('counter/x', async () => {
    throw new Error('refresh failed');
  }), /refresh failed/);
  assert.equal(windowsStore.records.get('counter/x').payload.n, 3);

  // Model sync reads one API key from the remote dsh through its agent.
  connection.session = session;
  connection.state = 'connected';
  session.agent = hello;
  assert.equal(await connection.resolveCredential('DEEPSEEK_API_KEY'), 'sk-windows', 'as the remote dsh resolves it');
  assert.equal(await connection.resolveCredential('UNSET_KEY'), undefined);
  await assert.rejects(connection.resolveCredential('bad name'), /invalid credential reference/);
  session.agent = { agent: 1 };
  await assert.rejects(connection.resolveCredential('DEEPSEEK_API_KEY'), /too old/, 'an old agent is asked to reconnect');
  dispose();
});

process.exitCode = failures === 0 ? 0 : 1;
