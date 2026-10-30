// Rehearsal: boot the real Desktop profile composition (all bundles + this plugin)
// in a throwaway DSH home, the way dsh-desktop-host does, connect a WSL
// distribution and drive the merged API through the Host Gateway exactly as the
// browser's /api bridge and Remote mux do. Does not touch the running app.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals --import ./test/resolve-boot.mjs \
//     test/boot-desktop.mjs <profileDir> <windowsWorkspace> <distro>
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, winWs, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);

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
step('profile booted');

const gateway = ctx.get('typertGateway');
const peer = ctx.get('connection').browserPeer;
const rpc = (endpoint, args = {}) => gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
const stream = (endpoint, args, signal) => gateway.openWireStream(endpoint, { args }, (async function* () {})(), peer, signal, new AbortController());
const stop = new AbortController();
let failed = false;
try {
  // Nothing of the shipped composition is replaced.
  for (const [name, expected] of [['fs', 'SandboxedFileSystem'], ['subprocess', 'LocalSubprocessRuntime'], ['shell', 'SandboxPwshExecutor'], ['sessionController', 'SessionController'], ['wslRemote', 'WslRemoteService']]) {
    assert.equal(ctx.get(name)?.constructor?.name, expected, name);
  }

  step(`connecting ${distro}`);
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  await wsl.connection(distro).connect();
  assert.equal(wsl.connections.get(distro)?.state, 'connected');

  step('merged workspaces: register the WSL home as a WSL workspace');
  const home = wsl.connections.get(distro).facts.home;
  const created = await rpc('workspace/create', { request: { path: `\\\\wsl.localhost\\${distro}${home.replace(/\//g, '\\')}` } });
  assert.ok(created.ok, JSON.stringify(created.error));
  assert.match(created.value.workspace.path, /^\\\\wsl\.localhost\\/);
  const follow = await stream('workspace/follow', {}, stop.signal);
  const baseline = (await follow[Symbol.asyncIterator]().next()).value;
  assert.equal(baseline.type, 'baseline');
  const wslWorkspace = baseline.value.items.find((item) => item.workspaceId === created.value.workspace.workspaceId);
  assert.ok(wslWorkspace, 'the WSL workspace is in the merged follow baseline');

  step('a Windows session and a WSL session side by side');
  const winSession = await rpc('session/create', { request: { cwd: winWs } });
  assert.ok(winSession.ok, JSON.stringify(winSession.error));
  const wslSession = await rpc('session/create', { request: { workspaceId: wslWorkspace.workspaceId } });
  assert.ok(wslSession.ok, JSON.stringify(wslSession.error));
  const sessionId = wslSession.value.sessionId;
  assert.equal(ctx.get('sessions').get(sessionId), undefined, 'the WSL session does not live in the Windows Host');
  assert.notEqual(ctx.get('sessions').get(winSession.value.sessionId), undefined, 'the Windows session does');

  const list = await rpc('session/list', { _request: {} });
  const rows = new Map(list.value.items.map((item) => [item.sessionId, item]));
  assert.match(rows.get(sessionId)?.cwd ?? '', /^\\\\wsl\.localhost\\/);
  assert.ok(rows.has(winSession.value.sessionId));

  step('history, live assistant frames and forwarded events of the WSL session');
  const seen = new Set();
  (async () => {
    const events = await gateway.openWireStream('$events', { args: {} }, (async function* () {})(), peer, stop.signal, new AbortController());
    for await (const frame of events) if (frame?.type === 'emit' && JSON.stringify(frame.args).includes(sessionId)) seen.add(frame.event);
  })().catch(() => {});
  const history = await stream('session/follow', { request: { address: { kind: 'session', sessionId }, assistantStream: true } }, stop.signal);
  const reply = (async () => {
    let text = '';
    for await (const frame of history) {
      if (frame.type === 'snapshot') assert.match(frame.header.cwd, /^\\\\wsl\.localhost\\/);
      if (frame.type !== 'event') continue;
      if (frame.event.type === 'assistant/message') text += frame.event.data.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
      if (frame.event.type === 'turn/end') return text;
    }
  })();
  const prompted = await rpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: 'Reply with exactly: pong' }] } });
  assert.ok(prompted.ok, JSON.stringify(prompted.error));
  const text = await Promise.race([reply, new Promise((_, reject) => setTimeout(() => reject(new Error('no reply within 120 s')), 120000))]);
  console.log('   reply:', JSON.stringify(text));
  assert.ok(text.length > 0);
  assert.ok(seen.has('api-session/status'), `forwarded events: ${[...seen].join(', ')}`);

  step('Windows session untouched');
  const winProjections = await rpc('session/projections', { request: { sessionId: winSession.value.sessionId } });
  assert.ok(winProjections.ok);
  console.log('BOOT REHEARSAL PASSED');
} catch (error) {
  failed = true;
  console.error('BOOT REHEARSAL FAILED', error);
} finally {
  stop.abort();
  step('shutting down');
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  process.exit(failed ? 1 : 0);
}
