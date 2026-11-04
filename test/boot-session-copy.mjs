// Rehearsal: copy sessions between workspaces and hosts through the real
// Desktop composition (throwaway DSH home) and a real WSL distribution.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals --import ./test/resolve-boot.mjs \
//     test/boot-session-copy.mjs <profileDir> [distro]
// Needs DSH_HOME pointing at test/boot-home.mjs's home. Creates two scratch
// workspaces on each side (removed again at the end), never touches the user's.
//
// A source session with completed turns is built from a recorded history
// (no model call): user message, assistant reply with an image, turn end.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { runWsl } from '../lib/wsl.js';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A 1x1 PNG, so the copy carries an image attachment across hosts.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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
const rpc = async (endpoint, args = {}) => {
  const result = await gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
  if (!result.ok) throw new Error(`${endpoint}: ${result.error.code}: ${result.error.message}`);
  return result.value;
};
const stream = (endpoint, args, signal) => gateway.openWireStream(endpoint, { args }, (async function* () {})(), peer, signal, new AbortController());

const tag = randomUUID().slice(0, 8);
const winDirs = [join(process.env.DSH_HOME, 'copy-test', `win-a-${tag}`), join(process.env.DSH_HOME, 'copy-test', `win-b-${tag}`)];
let wslHome;
const wslDirs = () => [`${wslHome}/.dsh-wsl-remote/copy-test/wsl-a-${tag}`, `${wslHome}/.dsh-wsl-remote/copy-test/wsl-b-${tag}`];
const created = [];
const stop = new AbortController();
let failed = false;
let workspaces;

/** A recorded two-turn history, the way an Agent writes it, with one image. */
async function recordedHistory(attachments, marker) {
  const image = await attachments.saveImage({ data: new Uint8Array(PNG), mediaType: 'image/png', name: 'dot.png' });
  const time = Date.now();
  const events = [];
  const add = (type, data, extra = {}) => events.push({ type, seq: events.length, time, data, ...extra });
  const message = (role, content, source) => ({ id: randomUUID(), role, content, ...(source ? { source } : {}) });
  for (const [turn, text] of [[1, `first question ${marker}`], [2, `second question ${marker}`]]) {
    add('turn/start', { turn });
    add('user/message', { ...message('user', turn === 1 ? [{ type: 'text', text }, { type: 'image', attachment: image }] : [{ type: 'text', text }], { kind: 'user' }) }, { surfaceOp: 'append' });
    add('turn/end', { turn, reason: { kind: 'completed' } });
  }
  return { events, image };
}

try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  await wsl.connection(distro).connect();
  step(`connected ${distro}`);
  wslHome = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 30000 })).stdout.trim();
  for (const dir of winDirs) mkdirSync(dir, { recursive: true });
  for (const dir of wslDirs()) await runWsl(['-d', distro, '-e', 'mkdir', '-p', dir], { timeoutMs: 30000 });

  (async () => {
    for await (const frame of await stream('workspace/follow', {}, stop.signal)) workspaces = frame.value;
  })().catch((error) => console.log('   workspace/follow failed:', error.message));
  const addWorkspace = async (path) => {
    const value = await rpc('workspace/create', { request: { path } });
    return value.workspace?.workspaceId ?? value.workspaceId;
  };
  const ws = {
    winA: await addWorkspace(winDirs[0]),
    winB: await addWorkspace(winDirs[1]),
    wslA: await addWorkspace(`\\\\wsl.localhost\\${distro}${wslDirs()[0].replaceAll('/', '\\')}`),
    wslB: await addWorkspace(`\\\\wsl.localhost\\${distro}${wslDirs()[1].replaceAll('/', '\\')}`),
  };
  await sleep(2500);
  console.log('   workspaces:', JSON.stringify(ws));
  for (const id of Object.values(ws)) assert.ok(workspaces.items.some((item) => item.workspaceId === id), `workspace ${id} is listed`);

  step('build a Windows source session with two completed turns and an image');
  const winRegistry = ctx.get('workspaceRegistry');
  const { events: winEvents } = await recordedHistory(ctx.get('attachments'), `win-${tag}`);
  const winSource = `session-${randomUUID()}`;
  const winWorkspace = winRegistry.get(ws.winA);
  await ctx.get('agents').create({
    sessionId: winSource,
    seed: [...winEvents, { type: 'session/end-seed', seq: winEvents.length, time: winEvents.at(-1).time, data: {} }],
    meta: { cwd: winWorkspace.path },
  });
  await winWorkspace.attachSession(winSource);
  created.push({ host: null, sessionId: winSource });

  const copy = async (sessionId, workspaceId) => wsl.copySession(sessionId, workspaceId);
  /** The copy's stored log, read on its own host (the plugin's export path; it sees what a resume sees). */
  const logOf = async (host, sessionId) => {
    const { events } = await (host === null ? exportSessionLocal(sessionId) : wsl.connection(host).exportSession(sessionId)).catch(async (error) => {
      // A copy has no completed turn of its own yet, so export (latest completed prefix) still covers the inherited turns.
      throw error;
    });
    return events;
  };
  const exportSessionLocal = (sessionId) => import('../server/session-copy.mjs').then((m) => m.exportSession(ctx, sessionId));
  /** Check a copy: history, image, working directory, workspace membership. */
  const check = async (label, result, expectHost, expectCwd, marker) => {
    console.log(`   ${label}:`, JSON.stringify(result));
    assert.equal(result.host, expectHost, `${label}: created on ${expectHost ?? 'Windows'}`);
    created.push({ host: result.host, sessionId: result.sessionId });
    const text = JSON.stringify(await logOf(result.host, result.sessionId));
    assert.ok(text.includes(`first question ${marker}`) && text.includes(`second question ${marker}`), `${label}: the copied history is there`);
    assert.ok(text.includes('"type":"image"'), `${label}: the image block is there`);
    const projections = await rpc('session/projections', { request: { sessionId: result.sessionId } });
    const cwd = projections?.values?.workingDirectory ?? projections?.workingDirectory;
    console.log(`   ${label} working directory:`, JSON.stringify(cwd));
    assert.equal(cwd, expectCwd, `${label}: working directory is the target workspace`);
    await sleep(1500);
    const row = workspaces.items.find((item) => item.workspaceId === result.workspaceId);
    assert.ok(row?.sessionIds.includes(result.sessionId), `${label}: listed under the target workspace`);
  };

  step('Windows → Windows (another workspace)');
  const toWin = await copy(winSource, ws.winB);
  await check('win→win', toWin, null, winDirs[1], `win-${tag}`);

  step('what the copy\'s model gets next: the inherited messages, then the move notice');
  {
    const controller = ctx.get('sessionController');
    const resolved = await controller.agents.resolveAgent(toWin.sessionId);
    const agent = resolved.agent ?? ctx.get('agents').get(toWin.sessionId);
    assert.ok(agent, 'the copy resumes as an ordinary Agent');
    const messages = agent.session.deriveMessages();
    const roles = messages.map((message) => `${message.role}:${JSON.stringify(message.content).slice(0, 40)}`);
    console.log('   model history:', roles.join(' | '));
    assert.ok(JSON.stringify(messages).includes(`second question win-${tag}`), 'inherited user messages are model-visible');
    const pending = [...(agent.inbox.nextStep ?? []), ...(agent.inbox.nextTurn ?? [])];
    const notices = JSON.stringify([...pending, ...messages]);
    console.log('   pending inbox:', pending.map((message) => JSON.stringify(message.content).slice(0, 120)).join(' | ') || '(none)');
    assert.ok(/copied from another workspace|copied here from/.test(notices), 'the move notice reaches the model before its next request');
  }

  step('Windows → WSL');
  const toWsl = await copy(winSource, ws.wslA);
  await check('win→wsl', toWsl, distro, wslDirs()[0], `win-${tag}`);

  step('WSL → WSL (another workspace on the same distribution)');
  await check('wsl→wsl', await copy(toWsl.sessionId, ws.wslB), distro, wslDirs()[1], `win-${tag}`);

  step('WSL → Windows');
  await check('wsl→win', await copy(toWsl.sessionId, ws.winA), null, winDirs[0], `win-${tag}`);

  step('the source is untouched');
  const source = JSON.stringify(await logOf(null, winSource));
  assert.ok(!source.includes('copied from another workspace') && !source.includes('working-directory/change'), 'nothing was added to the source');

  step('a session with no completed turn is refused');
  const blank = await rpc('session/create', { request: { workspaceId: ws.winA } });
  await assert.rejects(copy(blank.sessionId, ws.winB), /no completed turn/);
  console.log('SESSION COPY REHEARSAL PASSED');
} catch (error) {
  failed = true;
  console.error('SESSION COPY REHEARSAL FAILED', error);
} finally {
  stop.abort();
  // Remove the scratch workspaces (sessions go with them on each host).
  try {
    for (const item of workspaces?.items ?? []) {
      if (!/copy-test[\\/](win|wsl)-[ab]-/.test(item.path)) continue;
      await rpc('workspace/delete', { request: { workspaceId: item.workspaceId } }).catch((error) => console.log('   cleanup:', error.message));
    }
  } catch {}
  for (const dir of winDirs) rmSync(dir, { recursive: true, force: true });
  if (wslHome) await runWsl(['-d', distro, '-e', 'rm', '-rf', ...wslDirs()], { timeoutMs: 30000 }).catch(() => {});
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  process.exit(failed ? 1 : 0);
}
