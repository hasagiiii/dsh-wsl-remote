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
import { applyWorkspaceFrame, emptyWorkspaceState, insertBefore, mergeModelCatalogs, mergeWorkspaces, sessionHints, splitBytes, toHostArgs, wslSummary, baselineFrames } from '../lib/bridge/merge.js';
import { fromUncPath, toUncPath } from '../lib/linux-fs.js';

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
  assert.deepEqual(settings, { ports: {}, version: 2, shareLogin: true, profile: 'web', autoConnect: [], workspaceOrder: [] });
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
  assert.deepEqual(baseline.items.map((item) => item.path), ['\\\\wsl.localhost\\Ubuntu\\srv\\x', 'C:\\work', '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo']);
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

await test('merge: WSL values shown in the Windows spelling, sent back as Linux', () => {
  assert.deepEqual(wslSummary('Ubuntu', { sessionId: 's', cwd: '/home/me' }), { sessionId: 's', cwd: '\\\\wsl.localhost\\Ubuntu\\home\\me' });
  assert.deepEqual(wslSummary('Ubuntu', { sessionId: 's' }), { sessionId: 's' });
  const ids = { w2: 'l1' };
  assert.deepEqual(toHostArgs('session/create', { request: { workspaceId: 'w2' } }, (id) => ids[id]), { request: { workspaceId: 'l1' } });
  assert.deepEqual(toHostArgs('workspace/create', { request: { path: '\\\\wsl.localhost\\Ubuntu\\srv' } }, () => undefined), { request: { path: '/srv' } });
  assert.deepEqual(toHostArgs('session/prompt', { request: { sessionId: 's' } }, () => undefined), { request: { sessionId: 's' } });
});

await test('merge: model catalogs and control baselines', () => {
  const windows = { default: { provider: 'p1', model: 'm1' }, routableProviders: ['p1'], groups: [{ id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }] }], failures: [] };
  const wsl = { default: { provider: 'p2', model: 'm2' }, routableProviders: ['p2', 'p1'], groups: [{ id: 'p2', name: 'P2', models: [{ id: 'm2', name: 'M2' }] }, { id: 'p1', name: 'P1', models: [{ id: 'm1', name: 'M1' }, { id: 'm3', name: 'M3' }] }], failures: [] };
  const merged = mergeModelCatalogs(windows, [{ distro: 'Ubuntu', catalog: wsl }]);
  assert.deepEqual(merged.default, windows.default);
  assert.deepEqual(merged.routableProviders, ['p1', 'p2']);
  assert.deepEqual(merged.groups.map((group) => `${group.id}:${group.models.map((model) => model.id).join('+')}`), ['p1:m1+m3', 'p2:m2']);
  assert.deepEqual(baselineFrames({ projections: { s: { asOfSeq: 7, values: { title: 't' } } } }), [{ type: 'projection', sessionId: 's', key: 'title', value: 't', seq: 7 }]);
});

await test('settings: invalid fields are dropped', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wslr-')), 'wsl-remote.json');
  const value = writeSettings({ shareLogin: false, profile: 'bad name', autoConnect: ['Ubuntu', 'x y', 'Ubuntu'], ports: { Ubuntu: 40123, Bad: 80 } }, file);
  assert.deepEqual(value, { ports: { Ubuntu: 40123 }, version: 2, shareLogin: false, profile: 'web', autoConnect: ['Ubuntu'], workspaceOrder: [] });
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
  assert.equal(hello.agent, 1);

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
  dispose();
});

process.exitCode = failures === 0 ? 0 : 1;
