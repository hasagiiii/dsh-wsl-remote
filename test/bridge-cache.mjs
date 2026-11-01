/** Standalone cache checks: Electron Node or node test/bridge-cache.mjs. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { bridgeCacheFile, loadBridgeCache, writeBridgeCache } from '../lib/bridge/cache.js';
import { stateFile } from '../lib/state.js';

const scratch = fileURLToPath(new URL('../.scratch/', import.meta.url));
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(join(scratch, 'bridge-cache-'));
const file = (name) => join(root, name, 'cache.json');
const emptyWorkspace = () => ({ items: [], archivedSessionIds: [], pinnedSessionIds: [] });
const item = () => ({ workspaceId: 'w1', path: '/home/me/project', title: 'Project', sessionIds: ['s1'], createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z' });
const session = () => ({ sessionId: 's1', updatedAt: 123, agentAvailable: true, running: true, blank: false });
const raw = (target, value) => {
  fs.mkdirSync(dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
};

// Delete only this test's verified mkdtemp tree, unlinking links instead of traversing them.
function removeTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) removeTree(target);
    else fs.unlinkSync(target);
  }
  fs.rmdirSync(directory);
}
after(() => {
  assert.equal(dirname(root), scratch.replace(/[\\/]$/, ''));
  assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
  removeTree(root);
});

test('cache path is the settings sibling and resolves DSH_HOME at call time', () => {
  const previous = process.env.DSH_HOME;
  try {
    process.env.DSH_HOME = join(root, 'home');
    assert.equal(bridgeCacheFile(), join(dirname(stateFile()), 'wsl-remote-cache.json'));
    assert.equal(bridgeCacheFile(), join(root, 'home', 'wsl-remote-cache.json'));
    process.env.DSH_HOME = `  ${join(root, 'second-home')}  `;
    assert.equal(bridgeCacheFile(), join(root, 'second-home', 'wsl-remote-cache.json'));
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});

test('round-trip retains only sidebar fields and marks summaries offline', () => {
  const target = file('round-trip');
  const secret = 'PRIVATE-CONTENT-MUST-NOT-BE-PERSISTED';
  const hosts = {
    Ubuntu: {
      workspace: { ...emptyWorkspace(), items: [{ ...item(), credentials: secret }], archivedSessionIds: ['s0'], pinnedSessionIds: ['s1'], prompts: secret },
      sessions: [{ ...session(), parentSessionId: 'parent', origin: 'subagent', cwd: '/home/me/project', formatStatus: 'current', prompts: secret, tools: secret, projections: {
        kind: 'sequenced', asOfSeq: 9000, credentials: secret,
        values: { title: 'A title', workingDirectory: '/home/me/project', agentPreset: 'coder', sessionListMetadata: { blank: false, lastPromptAt: 100, prompt: secret }, inbox: { 'next-turn': [secret] }, tools: secret, credentials: secret, todos: secret },
      } }],
      credentials: secret,
    },
  };
  const normalized = writeBridgeCache('web', hosts, target);
  const expected = { Ubuntu: {
    workspace: { ...emptyWorkspace(), items: [item()], archivedSessionIds: ['s0'], pinnedSessionIds: ['s1'] },
    sessions: [{ ...session(), agentAvailable: false, running: false, parentSessionId: 'parent', origin: 'subagent', cwd: '/home/me/project', formatStatus: 'current', projections: {
      kind: 'cached', asOfSeq: 0, values: { title: 'A title', workingDirectory: '/home/me/project', agentPreset: 'coder', sessionListMetadata: { blank: false, lastPromptAt: 100 } },
    } }],
  } };
  assert.deepEqual(normalized, expected);
  assert.deepEqual(loadBridgeCache('web', target), expected);
  assert.equal(hosts.Ubuntu.sessions[0].running, true, 'caller state is not mutated');
  const persisted = fs.readFileSync(target, 'utf8');
  assert.equal(persisted.includes(secret), false);
  assert.deepEqual(JSON.parse(persisted), { version: 1, profile: 'web', hosts: expected });
  assert.deepEqual(fs.readdirSync(dirname(target)), ['cache.json']);
});

test('empty states, null projections, and missing sessions retain their distinct meaning', () => {
  const target = file('empty');
  const hosts = {
    Ubuntu: { workspace: emptyWorkspace() },
    Debian: { sessions: [] },
    Arch: {},
    Alpine: { sessions: [{ ...session(), blank: true, updatedAt: 0, cwd: '', projections: { values: { title: '', workingDirectory: null, agentPreset: null, sessionListMetadata: { blank: true, lastPromptAt: null } } } }] },
    Fedora: { sessions: [{ ...session(), projections: { values: {} } }] },
  };
  const result = writeBridgeCache('web', hosts, target);
  assert.deepEqual(loadBridgeCache('web', target), result);
  assert.deepEqual(result.Ubuntu, { workspace: emptyWorkspace() });
  assert.equal(Object.hasOwn(result.Ubuntu, 'sessions'), false);
  assert.deepEqual(result.Debian, { sessions: [] });
  assert.deepEqual(result.Arch, {});
  assert.deepEqual(result.Alpine.sessions[0].projections.values, hosts.Alpine.sessions[0].projections.values);
  assert.deepEqual(result.Fedora.sessions[0].projections, { kind: 'cached', asOfSeq: 0, values: {} });
  assert.deepEqual(writeBridgeCache('web', {}, target), {});
  assert.deepEqual(loadBridgeCache('web', target), {});
});

test('missing, corrupt, invalid envelope and wrong-profile files are read-only misses', () => {
  const target = file('invalid');
  assert.deepEqual(loadBridgeCache('web', target), {});
  for (const value of ['{broken', 'null', '[]', '1', {}, { version: 2, profile: 'web', hosts: {} }, { version: 1, profile: 'other', hosts: { Ubuntu: { sessions: [] } } }, { version: 1, profile: 'web', hosts: [] }, { version: 1, profile: 'web', hosts: null }, { version: 1, profile: 123, hosts: {} }]) {
    raw(target, value);
    const before = fs.readFileSync(target, 'utf8');
    assert.deepEqual(loadBridgeCache('web', target), {});
    assert.equal(fs.readFileSync(target, 'utf8'), before);
  }
  assert.deepEqual(loadBridgeCache(undefined, target), {});
  assert.throws(() => writeBridgeCache(undefined, {}, target), TypeError);
});

test('validates distro names, workspace fields, ids, and session core types', () => {
  const target = file('validation');
  const badWorkspace = { ...item(), path: 42 };
  const hosts = Object.fromEntries([
    ['bad name', { sessions: [] }], ['../Ubuntu', { sessions: [] }], ['__proto__', { sessions: [] }],
    ['Ubuntu-26.04', { workspace: { ...emptyWorkspace(), items: [null, badWorkspace, { ...item(), title: '', sessionIds: ['s1', 7, '', 's1', 's2'] }], archivedSessionIds: ['a', 'a', null, ''], pinnedSessionIds: ['p', {}, 'p'] }, sessions: [null, [], { ...session(), sessionId: '' }, { ...session(), updatedAt: '123' }, { ...session(), updatedAt: -1 }, { ...session(), updatedAt: Infinity }, { ...session(), blank: 'false' }, { ...session(), cwd: {}, parentSessionId: 3, origin: 'unknown', formatStatus: 'unknown' }] }],
    ['constructor', { sessions: [] }], ['Debian', { workspace: {}, sessions: null }], ['Arch', []],
  ]);
  const result = writeBridgeCache('web', hosts, target);
  assert.deepEqual(Object.keys(result), ['Ubuntu-26.04', 'constructor', 'Debian']);
  assert.deepEqual(result['Ubuntu-26.04'].workspace, { items: [{ ...item(), title: '', sessionIds: ['s1', 's2'] }], archivedSessionIds: ['a'], pinnedSessionIds: ['p'] });
  assert.deepEqual(result['Ubuntu-26.04'].sessions, [{ ...session(), agentAvailable: false, running: false }]);
  assert.deepEqual(result.Debian, {});
  assert.deepEqual(loadBridgeCache('web', target), result);
});

test('load applies the same projection validation and allowlist to hand-edited data', () => {
  const target = file('unsafe-load');
  raw(target, { version: 1, profile: 'web', hosts: { Ubuntu: { sessions: [{ ...session(), formatStatus: 'migration-required', projections: { kind: 'sequenced', asOfSeq: 100, values: { title: { text: 'not a string' }, agentPreset: ['bad'], workingDirectory: false, sessionListMetadata: { blank: true, lastPromptAt: 'yesterday' }, inbox: { text: 'private' } } } }] } } });
  const result = loadBridgeCache('web', target).Ubuntu.sessions[0];
  assert.deepEqual(result, { ...session(), agentAvailable: false, running: false, formatStatus: 'migration-required', projections: { kind: 'cached', asOfSeq: 0, values: {} } });
  for (const metadata of [null, {}, { blank: 'true', lastPromptAt: null }, { blank: true, lastPromptAt: -1 }, { blank: true, lastPromptAt: NaN }]) {
    const written = writeBridgeCache('web', { Ubuntu: { sessions: [{ ...session(), projections: { values: { sessionListMetadata: metadata } } }] } }, target);
    assert.deepEqual(written.Ubuntu.sessions[0].projections.values, {});
  }
});

test('atomic replacement leaves the old complete snapshot visible until rename', () => {
  const target = file('atomic');
  writeBridgeCache('web', { Ubuntu: { sessions: [] } }, target);
  const before = fs.readFileSync(target, 'utf8');
  const rename = fs.renameSync;
  let renames = 0;
  try {
    fs.renameSync = (temporary, destination) => {
      renames++;
      assert.equal(destination, target);
      assert.equal(dirname(temporary), dirname(target));
      assert.notEqual(temporary, target);
      assert.equal(fs.readFileSync(target, 'utf8'), before);
      assert.deepEqual(JSON.parse(fs.readFileSync(temporary, 'utf8')).hosts, { Debian: { sessions: [] } });
      return rename(temporary, destination);
    };
    syncBuiltinESMExports();
    writeBridgeCache('web', { Debian: { sessions: [] } }, target);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
  assert.equal(renames, 1);
  assert.deepEqual(loadBridgeCache('web', target), { Debian: { sessions: [] } });
  assert.deepEqual(fs.readdirSync(dirname(target)), ['cache.json']);
});

test('failed atomic rename preserves the old snapshot and cleans its temporary file', () => {
  const target = file('rename-failure');
  writeBridgeCache('web', { Ubuntu: { sessions: [] } }, target);
  const before = fs.readFileSync(target, 'utf8');
  const rename = fs.renameSync;
  const failure = Object.assign(new Error('simulated rename refusal'), { code: 'EACCES' });
  try {
    fs.renameSync = () => { throw failure; };
    syncBuiltinESMExports();
    assert.throws(() => writeBridgeCache('web', { Debian: { sessions: [] } }, target), (error) => error === failure);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
  assert.equal(fs.readFileSync(target, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(dirname(target)), ['cache.json']);
});
