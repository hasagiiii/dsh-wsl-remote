// Copy a REAL session log (read-only) into the throwaway boot home, then copy
// that session to a WSL workspace and back through the plugin, and resume both
// copies as Agents. Proves that real histories (request headers, tool calls,
// subagents, compactions) survive the copy and are accepted by the session
// validation of both hosts.
//   ELECTRON_RUN_AS_NODE=1 DSH_HOME=<boot home> "DeepSeek Harness.exe" --expose-internals \
//     --import ./test/resolve-boot.mjs test/boot-session-copy-real.mjs <profileDir> <sourceSessionDir> [distro]
// <sourceSessionDir> is a folder like ~/.dsh/sessions/--E-proj-x--/session-<id>; it is only read.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { runWsl } from '../lib/wsl.js';
import { exportSession } from '../server/session-copy.mjs';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, sourceDir, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const home = process.env.DSH_HOME;
assert.ok(home && home.includes('.scratch'), 'DSH_HOME must be the throwaway boot home');
const tag = randomUUID().slice(0, 8);
const winDir = join(home, 'copy-test', `real-${tag}`);
mkdirSync(winDir, { recursive: true });
// The stored log is keyed by its own recorded project folder; stage it under the same key here.
const sessionId = basename(sourceDir);
const key = basename(join(sourceDir, '..'));
const target = join(home, 'sessions', key, sessionId);
mkdirSync(join(home, 'sessions', key), { recursive: true });
cpSync(sourceDir, target, { recursive: true });
// Its images and files live in the real attachment store; copy that store too (content-addressed, read-only source).
const realAttachments = join(sourceDir, '..', '..', '..', 'attachments');
cpSync(realAttachments, join(home, 'attachments'), { recursive: true, force: false, errorOnExist: false });
console.log('   staged', sessionId, 'under', key);

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
let failed = false;
let wslHome;
const wslDir = () => `${wslHome}/.dsh-wsl-remote/copy-test/real-${tag}`;
const workspaceIds = [];
try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  await wsl.connection(distro).connect();
  step(`connected ${distro}`);
  wslHome = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 30000 })).stdout.trim();
  await runWsl(['-d', distro, '-e', 'mkdir', '-p', wslDir()], { timeoutMs: 30000 });

  // The staged session's own cwd decides where it shows; read it and register that folder.
  const exported = await exportSession(ctx, sessionId);
  const types = {};
  for (const event of exported.events) types[event.type] = (types[event.type] ?? 0) + 1;
  console.log(`   source: ${exported.events.length} events up to its last completed turn, ${exported.images.length} images, ${exported.files.length} files, cwd ${exported.cwd}`);
  console.log('   event types:', Object.entries(types).sort((a, b) => b[1] - a[1]).map(([type, n]) => `${type}×${n}`).join(' '));

  const winWs = (await rpc('workspace/create', { request: { path: winDir } })).workspace.workspaceId;
  const wslWs = (await rpc('workspace/create', { request: { path: `\\\\wsl.localhost\\${distro}${wslDir().replaceAll('/', '\\')}` } })).workspace.workspaceId;
  workspaceIds.push(winWs, wslWs);
  // The session's own folder as its workspace, so its root is known (it is the path its history names).
  const sourceRoot = exported.cwd;
  const sourceWs = (await rpc('workspace/create', { request: { path: sourceRoot } })).workspace.workspaceId;
  workspaceIds.push(sourceWs);
  await ctx.get('workspaceRegistry').get(sourceWs).attachSession(sessionId);
  await sleep(2500);
  const B = String.fromCharCode(92);
  const mountView = `/mnt/${sourceRoot[0].toLowerCase()}/${sourceRoot.slice(3).split(B).join('/')}`;
  const count = (events, needle) => events.reduce((sum, event) => sum + (event.type === 'assistant/message' ? 0 : JSON.stringify(event.data).split(needle).length - 1), 0);
  const jsonRoot = JSON.stringify(sourceRoot).slice(1, -1);
  console.log(`   source names its root ${count(exported.events, jsonRoot)}x (JSON spelling) and ${count(exported.events, mountView)}x as ${mountView}`);

  step('real session → WSL workspace');
  const toWsl = await wsl.copySession(sessionId, wslWs);
  console.log('   ', JSON.stringify(toWsl));
  assert.equal(toWsl.host, distro);
  const wslCopy = await wsl.connection(distro).exportSession(toWsl.sessionId);
  console.log(`   WSL copy: ${wslCopy.events.length} events, ${wslCopy.images.length} images, cwd ${wslCopy.cwd}`);
  assert.equal(wslCopy.cwd, wslDir());
  const left = { json: count(wslCopy.events, jsonRoot), mount: count(wslCopy.events, mountView), target: count(wslCopy.events, wslDir()) };
  console.log('   after rewrite: old root left', left.json, '| old /mnt view left', left.mount, '| new root', left.target);
  assert.equal(left.json, 0, 'no Windows spelling of the old root is left outside reasoning and replay');
  assert.equal(left.mount, 0, 'no /mnt spelling of the old root is left outside reasoning and replay');
  assert.ok(left.target > 0);
  // Reasoning and the replay stream are kept byte for byte.
  const kept = (events) => events.filter((event) => event.type === 'assistant/message').map((event) => JSON.stringify([event.data.message.content.filter((block) => block.type === 'reasoning'), event.data.stream, event.data.message.source]));
  assert.deepEqual(kept(wslCopy.events), kept(exported.events));
  const call = wslCopy.events.find((event) => event.type === 'tool/call' && event.data.arguments.includes(wslDir()));
  assert.ok(call, 'a tool call names the new root');
  JSON.parse(call.data.arguments);
  console.log('    sample call:', call.data.arguments.slice(0, 160));

  step('WSL copy → Windows workspace');
  const back = await wsl.copySession(toWsl.sessionId, winWs);
  console.log('   ', JSON.stringify(back));
  assert.equal(back.host, null);
  const backCopy = await exportSession(ctx, back.sessionId);
  const backLeft = { linux: count(backCopy.events, wslDir()), target: count(backCopy.events, JSON.stringify(winDir).slice(1, -1)) };
  console.log('   back on Windows: WSL root left', backLeft.linux, '| new Windows root', backLeft.target);
  assert.equal(backLeft.linux, 0);
  assert.ok(backLeft.target > 0);
  for (const event of backCopy.events) if (event.type === 'tool/call') JSON.parse(event.data.arguments);

  step('resume the Windows copy as an Agent; its model history derives');
  const resolved = await ctx.get('sessionController').agents.resolveAgent(back.sessionId);
  if ('error' in resolved) throw resolved.error;
  const agent = resolved.agent;
  assert.ok(agent, 'the copy resumes');
  const messages = agent.session.deriveMessages();
  console.log(`   ${messages.length} model-visible messages; working directory ${ctx.get('workingDirectory').get(agent.session)}`);
  assert.ok(messages.length > 2);
  assert.equal(ctx.get('workingDirectory').get(agent.session), winDir);
  console.log('REAL SESSION COPY PASSED');
} catch (error) {
  failed = true;
  console.error('REAL SESSION COPY FAILED', error);
} finally {
  for (const id of workspaceIds) await rpc('workspace/delete', { request: { workspaceId: id } }).catch(() => {});
  if (wslHome) await runWsl(['-d', distro, '-e', 'rm', '-rf', wslDir()], { timeoutMs: 30000 }).catch(() => {});
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  rmSync(target, { recursive: true, force: true });
  rmSync(winDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
