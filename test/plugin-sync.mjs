/**
 * Plugin sync between hosts: spec translation per platform pair, the plan,
 * and background runs (sequential installs, enable, failure, cancel).
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { PluginSyncRuns, mapPluginSpec, planPluginSync, platformOf } from '../lib/plugin-sync.js';
import { PluginInstalls } from '../lib/installs.js';

test('platforms of host ids', () => {
  assert.equal(platformOf(null), 'windows');
  assert.equal(platformOf('Ubuntu'), 'wsl');
  assert.equal(platformOf('ssh:dev'), 'ssh');
});

test('install specs translate between Windows, WSL and SSH', () => {
  const registry = { name: 'dsh-x', version: '1.2.3', source: 'dsh-x@^1.0.0' };
  for (const [from, to] of [['windows', 'wsl'], ['wsl', 'ssh'], ['ssh', 'windows']]) {
    assert.deepEqual(mapPluginSpec(registry, from, to), { ok: true, spec: 'dsh-x@1.2.3' }, 'registry installs are pinned to the source version');
  }
  assert.deepEqual(mapPluginSpec({ name: '@s/x', version: '2.0.0', source: '@s/x' }, 'windows', 'ssh'), { ok: true, spec: '@s/x@2.0.0' });
  assert.deepEqual(mapPluginSpec({ name: 'x', version: '1.0.0', source: 'github:me/x#main' }, 'windows', 'ssh'), { ok: true, spec: 'github:me/x#main' }, 'git specs stay as recorded');
  assert.deepEqual(mapPluginSpec({ name: 'x', source: 'link:F:\\proj\\x' }, 'windows', 'wsl'), { ok: true, spec: 'link:/mnt/f/proj/x' });
  assert.deepEqual(mapPluginSpec({ name: 'x', source: 'file:/mnt/c/work/x' }, 'wsl', 'windows'), { ok: true, spec: 'file:C:/work/x' });
  assert.deepEqual(mapPluginSpec({ name: 'x', source: 'link:/mnt/f/x' }, 'wsl', 'wsl'), { ok: true, spec: 'link:/mnt/f/x' }, 'another distribution sees the same drive');
  assert.equal(mapPluginSpec({ name: 'x', source: 'link:F:/proj/x' }, 'windows', 'ssh').reason, 'local-path', 'an SSH server cannot see Windows drives');
  assert.equal(mapPluginSpec({ name: 'x', source: 'link:/home/me/x' }, 'wsl', 'windows').reason, 'local-path', 'native Linux folders stay on their host');
  assert.equal(mapPluginSpec({ name: 'x', source: 'link:/home/me/x' }, 'ssh', 'wsl').reason, 'local-path');
  assert.equal(mapPluginSpec({ name: 'x' }, 'windows', 'wsl').reason, 'source-missing');
});

test('plan: what each plugin needs on the target', () => {
  const source = [
    { name: '@deepseek-ai/dsh-base', availability: 'installation', installed: false, version: '0.2.1' },
    { name: 'a', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'a@^1' },
    { name: 'b', availability: 'profile', installed: true, version: '2.0.0', enabled: true, source: 'b@2.0.0' },
    { name: 'c', availability: 'profile', installed: true, version: '3.0.0', enabled: true, source: 'c' },
    { name: 'd', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'link:F:/d' },
    { name: 'e', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'e' },
    { name: '@local/dsh-wsl-remote', availability: 'profile', installed: true, version: '4.1.0', source: 'link:F:/proj/dsh-wsl-remote' },
  ];
  const target = [
    { name: '@deepseek-ai/dsh-base', availability: 'installation', installed: false, version: '0.2.1' },
    { name: 'b', availability: 'profile', installed: true, version: '1.9.0', enabled: true },
    { name: 'c', availability: 'profile', installed: true, version: '3.0.0', enabled: false },
    { name: 'e', availability: 'profile', installed: true, version: '1.0.0', enabled: true },
    { name: 'only-there', availability: 'profile', installed: true, version: '0.1.0', enabled: true },
  ];
  const { rows, targetOnly } = planPluginSync(source, target, 'windows', 'ssh');
  assert.deepEqual(rows.map((row) => [row.name, row.state, row.action ?? null, row.spec ?? row.reason ?? null]), [
    ['a', 'missing', 'install', 'a@1.0.0'],
    ['b', 'differ', 'update', 'b@2.0.0'],
    ['c', 'disabled', 'enable', null],
    ['d', 'unsupported', null, 'local-path'],
    ['e', 'same', null, null],
  ], 'shipped bundles and this plugin itself are left out');
  assert.deepEqual(targetOnly.map((item) => item.name), ['only-there'], 'target-only plugins are reported, never removed');
});

function fakeHosts() {
  const bundles = {
    windows: [
      { name: 'a', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'a@^1' },
      { name: 'b', availability: 'profile', installed: true, version: '2.0.0', enabled: true, source: 'b' },
      { name: 'c', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'c' },
    ],
    'ssh:dev': [{ name: 'c', availability: 'profile', installed: true, version: '1.0.0', enabled: false }],
  };
  const key = (host) => host ?? 'windows';
  const calls = [];
  const finish = new Map();
  const events = new EventEmitter();
  const installs = new PluginInstalls({
    events,
    client: async (host) => ({
      call: async (endpoint, { args }) => {
        calls.push([key(host), endpoint, args.spec ?? args.requestId]);
        if (endpoint === 'pluginManager/cancelInstall') {
          finish.get(args.requestId)?.({ ok: true, value: { application: 'cancelled' } });
          return { ok: true, value: { status: 'cancelled' } };
        }
        return new Promise((resolve) => finish.set(args.options.requestId, resolve));
      },
    }),
  });
  const runs = new PluginSyncRuns({
    list: async (host) => bundles[key(host)],
    enable: async (host, name) => {
      calls.push([key(host), 'enable', name]);
      bundles[key(host)].find((bundle) => bundle.name === name).enabled = true;
      return { application: 'applied' };
    },
    installs,
  });
  const settle = async (value) => {
    await new Promise((resolve) => setImmediate(resolve));
    const [id, resolve] = [...finish].at(-1);
    finish.delete(id);
    resolve(value);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { runs, calls, settle, installs };
}

test('a run installs selected plugins one by one and enables disabled ones', async () => {
  const { runs, calls, settle } = fakeHosts();
  await assert.rejects(runs.start(null, null, ['a']), /two different hosts/);
  await assert.rejects(runs.start(null, 'ssh:dev', []), /at least one/);
  const started = await runs.start(null, 'ssh:dev', ['a', 'b', 'c', 'unknown']);
  assert.deepEqual(started.items.map((item) => [item.name, item.action, item.spec ?? null]), [['a', 'install', 'a@1.0.0'], ['b', 'install', 'b@2.0.0'], ['c', 'enable', null]], 'the Host re-plans; names it cannot sync are dropped');
  await assert.rejects(runs.start(null, 'ssh:dev', ['a']), /already queued/);
  await settle({ ok: true, value: { application: 'applied' } });
  assert.equal(runs.get(started.id).items[0].status, 'done');
  assert.equal(runs.get(started.id).items[1].status, 'running', 'one install at a time');
  await settle({ ok: true, value: { application: 'restart-required' } });
  const done = runs.get(started.id);
  assert.equal(done.status, 'done');
  assert.equal(done.restartRequired, true);
  assert.deepEqual(calls.map((call) => call.slice(0, 2)), [['ssh:dev', 'pluginManager/installBundle'], ['ssh:dev', 'pluginManager/installBundle'], ['ssh:dev', 'enable']]);
  assert.equal(runs.latest('ssh:dev').id, started.id);
});

test('single plugins sync on their own; more while running are queued in the same run', async () => {
  const { runs, calls, settle } = fakeHosts();
  const first = await runs.start(null, 'ssh:dev', ['b']);
  assert.deepEqual(first.items.map((item) => [item.name, item.status]), [['b', 'running']], 'only the chosen plugin');
  const more = await runs.start(null, 'ssh:dev', ['a', 'b']);
  assert.equal(more.id, first.id, 'joins the running run');
  assert.deepEqual(more.items.map((item) => item.name), ['b', 'a'], 'already queued plugins are not added twice');
  await assert.rejects(runs.start(null, 'ssh:dev', ['b']), /already queued/);
  await assert.rejects(runs.start('Ubuntu', 'ssh:dev', ['a']), /already running/, 'another source into the same target waits');
  await settle({ ok: true, value: { application: 'applied' } });
  assert.equal(runs.get(first.id).items[1].status, 'running', 'the appended plugin runs next');
  await settle({ ok: true, value: { application: 'applied' } });
  const done = runs.get(first.id);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.items.map((item) => item.status), ['done', 'done']);
  assert.deepEqual(calls.map((call) => call[2]), ['b@2.0.0', 'a@1.0.0']);
  const next = await runs.start(null, 'ssh:dev', ['c']);
  assert.notEqual(next.id, first.id, 'a finished run is not reused');
  assert.deepEqual(next.items.map((item) => [item.name, item.action]), [['c', 'enable']]);
});

test('an install call that never answers still ends when the plugin manager confirms the cancel', async () => {
  const events = new EventEmitter();
  let answer = { status: 'cancelled' };
  const installs = new PluginInstalls({
    events,
    client: async () => ({
      call: async (endpoint) => (endpoint === 'pluginManager/cancelInstall' ? { ok: true, value: answer } : new Promise(() => {})),
    }),
  });
  const runs = new PluginSyncRuns({
    list: async (host) => (host === null ? [{ name: 'a', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'a' }] : []),
    enable: async () => ({}),
    installs,
  });
  const run = await runs.start(null, 'Ubuntu', ['a']);
  await new Promise((resolve) => setImmediate(resolve));
  await runs.cancel(run.id);
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs.get(run.id).status, 'cancelled', 'the run ends without the install call answering');

  answer = { status: 'not-running' };
  const lost = installs.start('Ubuntu', 'b');
  await installs.cancel(lost.id);
  assert.equal(installs.get(lost.id).status, 'failed', 'an install the plugin manager no longer has is ended too');
  assert.match(installs.get(lost.id).error, /no longer has/);
  installs.dispose();
});

test('a failed install is reported; cancelling stops the current install and skips the rest', async () => {
  const { runs, settle } = fakeHosts();
  const first = await runs.start(null, 'ssh:dev', ['a', 'b']);
  await settle({ ok: true, value: { application: 'failed', error: { message: 'pnpm exited 1' } } });
  await settle({ ok: true, value: { application: 'applied' } });
  const failed = runs.get(first.id);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.items.map((item) => [item.status, item.error ?? null]), [['failed', 'pnpm exited 1'], ['done', null]]);

  const second = await runs.start(null, 'ssh:dev', ['a', 'b']);
  await new Promise((resolve) => setImmediate(resolve));
  await runs.cancel(second.id);
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setImmediate(resolve));
  const cancelled = runs.get(second.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.items.map((item) => item.status), ['cancelled', 'skipped']);
});
