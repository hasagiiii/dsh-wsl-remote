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
import { RemoteConnection } from '../lib/remote.js';
import { Mux } from '../lib/mux.js';

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
  assert.deepEqual(settings, { ports: {}, version: 2, shareLogin: true, profile: 'web', autoConnect: [] });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2);
  assert.equal(loadSettings(file).migrated, false);
});

await test('settings: invalid fields are dropped', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wslr-')), 'wsl-remote.json');
  const value = writeSettings({ shareLogin: false, profile: 'bad name', autoConnect: ['Ubuntu', 'x y', 'Ubuntu'], ports: { Ubuntu: 40123, Bad: 80 } }, file);
  assert.deepEqual(value, { ports: { Ubuntu: 40123 }, version: 2, shareLogin: false, profile: 'web', autoConnect: ['Ubuntu'] });
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
