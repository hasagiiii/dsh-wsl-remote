// Rehearsal of what a Windows window does with a WSL session, against the real
// Desktop composition (throwaway DSH home) and a real distribution:
//  - pick a WSL workspace: create/reuse its blank session;
//  - plugin routes of that session (dsh-better-sidebar /sidebar/api) answered by WSL,
//    a Windows session's still answered by Windows;
//  - the distribution's own model catalog;
//  - disconnecting leaves no dsh process group behind in WSL.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals --import ./test/resolve-boot.mjs \
//     test/boot-select.mjs <profileDir> <distro>
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { runWsl } from '../lib/wsl.js';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = loadProfileDirectory('dsh', projectDir, installAnchor);
reportSkippedBundles('dsh', profile);
const app = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'desktop',
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
});
const { ctx } = app;
const gateway = ctx.get('typertGateway');
const peer = ctx.get('connection').browserPeer;
const rpc = (endpoint, args = {}) => gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
const stream = (endpoint, args, signal) => gateway.openWireStream(endpoint, { args }, (async function* () {})(), peer, signal, new AbortController());
const stop = new AbortController();
let failed = false;
try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  await wsl.connection(distro).connect();
  step('connected');

  let workspaces;
  (async () => {
    for await (const frame of await stream('workspace/follow', {}, stop.signal)) workspaces = frame.value;
  })().catch((error) => console.log('   workspace/follow failed:', error.message));
  await sleep(3000);
  const row = workspaces.items.find((item) => item.path.startsWith('/'));
  assert.ok(row, 'a WSL workspace is listed, with its Linux path');

  step(`pick the WSL workspace ${row.path}`);
  const list = await rpc('session/list', { _request: {} });
  assert.ok(list.ok, JSON.stringify(list.error));
  const blank = list.value.items.find((item) => item.blank && item.cwd === row.path && row.sessionIds.includes(item.sessionId));
  const created = await rpc('session/create', { request: { workspaceId: row.workspaceId, ...(blank ? { sessionId: blank.sessionId } : {}) } });
  assert.ok(created.ok, JSON.stringify(created.error));
  const sessionId = created.value.sessionId;
  assert.equal(ctx.get('sessions').get(sessionId), undefined, 'the session lives in WSL');

  step('plugin routes of the WSL session (dsh-better-sidebar)');
  const web = ctx.get('webServer');
  const base = `http://127.0.0.1:${web.port}`;
  const login = await fetch(ctx.get('connection').authenticatedUrl(`${base}/`), { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'browser cookie');
  if (web.prefixes?.has?.('/sidebar/api')) {
    const call = async (method, payload) => {
      const response = await fetch(`${base}/sidebar/api/${method}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    const cwd = await call('session.cwd', { sessionId, cwd: row.path });
    console.log('   session.cwd ->', cwd.status, JSON.stringify(cwd.body).slice(0, 200));
    assert.equal(cwd.status, 200);
    assert.equal(cwd.body.value?.cwd, row.path, 'answered by the WSL dsh: a Linux path');
    const tree = await call('fs.tree', { sessionId, cwd: row.path, path: row.path });
    console.log('   fs.tree ->', tree.status, JSON.stringify(tree.body).slice(0, 200));
    assert.equal(tree.status, 200, 'the WSL folder lists');
    const winRow = workspaces.items.find((item) => /^[A-Za-z]:/.test(item.path));
    if (winRow !== undefined) {
      const winSession = await rpc('session/create', { request: { workspaceId: winRow.workspaceId } });
      assert.ok(winSession.ok, JSON.stringify(winSession.error));
      const winCwd = await call('session.cwd', { sessionId: winSession.value.sessionId });
      console.log('   windows session.cwd ->', winCwd.status, JSON.stringify(winCwd.body).slice(0, 160));
      assert.match(winCwd.body.value?.cwd ?? '', /^[A-Za-z]:/, 'a Windows session stays on Windows');
    }
  } else {
    console.log('   (dsh-better-sidebar is not in this profile; skipped)');
  }

  step('the distribution\'s own model catalog');
  const catalog = await wsl.bridge.modelCatalog(distro);
  console.log('   WSL providers:', catalog.groups.map((group) => `${group.id}(${group.models.length})`).join(', ') || '(none)');
  const windowsCatalog = await rpc('session/modelCatalog', {});
  assert.ok(windowsCatalog.ok);
  console.log('   Windows providers:', windowsCatalog.value.groups.map((group) => group.id).join(', ') || '(none)');

  step('disconnect: no dsh process group left in WSL');
  const linux = wsl.connections.get(distro).session?.linux;
  assert.ok(linux, 'the launch reported its Linux pid and start time');
  console.log(`   dsh process group ${linux.pid} (start ${linux.started})`);
  await wsl.connection(distro).disconnect();
  await sleep(1000);
  const left = await runWsl(['-d', distro, '-e', 'sh', '-c', 'ps -o pid= -g "$1" | wc -l', 'sh', linux.pid], { timeoutMs: 30000 });
  console.log(`   processes left in group ${linux.pid}:`, left.stdout.trim());
  assert.equal(left.stdout.trim(), '0');
  console.log('SELECT REHEARSAL PASSED');
} catch (error) {
  failed = true;
  console.error('SELECT REHEARSAL FAILED', error);
} finally {
  stop.abort();
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  process.exit(failed ? 1 : 0);
}
