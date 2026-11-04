// Session copy over the SSH code path, with a WSL distribution standing in for
// the server (test/fake-ssh.mjs): Windows → SSH host workspace → Windows.
//   ELECTRON_RUN_AS_NODE=1 DSH_HOME=<boot home> DSH_FAKE_SSH_DISTRO=Ubuntu-26.04 "DeepSeek Harness.exe" \
//     --expose-internals --import ./test/resolve-boot.mjs test/boot-session-copy-ssh.mjs <profileDir>
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DSH_WSL_REMOTE_SSH = JSON.stringify([process.execPath, join(here, 'fake-ssh.mjs')]);
const { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } = await import('@deepseek-ai/dsh-app-boot');
const { runProfile } = await import('@deepseek-ai/dsh/profile-boot');
const { runWsl } = await import('../lib/wsl.js');
const { exportSession } = await import('../server/session-copy.mjs');

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir] = process.argv.slice(2);
const distro = process.env.DSH_FAKE_SSH_DISTRO ?? 'Ubuntu-26.04';
const host = 'ssh:me@copytest';
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
const rpc = async (endpoint, args = {}) => {
  const result = await gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
  if (!result.ok) throw new Error(`${endpoint}: ${result.error.code}: ${result.error.message}`);
  return result.value;
};
const tag = randomUUID().slice(0, 8);
const winDir = join(process.env.DSH_HOME, 'copy-test', `ssh-win-${tag}`);
mkdirSync(winDir, { recursive: true });
let remoteHome;
const remoteDir = () => `${remoteHome}/.dsh-wsl-remote/copy-test/ssh-${tag}`;
const workspaceIds = [];
let failed = false;
try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  // Add the (fake) SSH host the way Settings does, then connect it.
  wsl.save({ ...wsl.settings, sshHosts: [...new Set([...(wsl.settings.sshHosts ?? []), 'me@copytest'])] });
  assert.ok(wsl.hostIds().includes(host), `SSH host is known: ${JSON.stringify(wsl.hostIds())}`);
  await wsl.connection(host).connect();
  step(`connected ${host} (${wsl.connections.get(host)?.state})`);
  remoteHome = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 30000 })).stdout.trim();
  await runWsl(['-d', distro, '-e', 'mkdir', '-p', remoteDir()], { timeoutMs: 30000 });

  const winWs = (await rpc('workspace/create', { request: { path: winDir } })).workspace.workspaceId;
  const sshWs = (await rpc('workspace/create', { request: { path: `ssh://me@copytest${remoteDir()}` } })).workspace.workspaceId;
  workspaceIds.push(winWs, sshWs);
  await sleep(2500);
  assert.equal(wsl.bridge.workspaceHosts()[sshWs], host, 'the SSH workspace belongs to the SSH host');

  step('Windows source session');
  const time = Date.now();
  const events = [
    { type: 'turn/start', seq: 0, time, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time, data: { id: randomUUID(), role: 'user', content: [{ type: 'text', text: `over ssh ${tag}` }], source: { kind: 'user' } }, surfaceOp: 'append' },
    { type: 'turn/end', seq: 2, time, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'session/end-seed', seq: 3, time, data: {} },
  ];
  const source = `session-${randomUUID()}`;
  await ctx.get('agents').create({ sessionId: source, seed: events, meta: { cwd: winDir } });
  await ctx.get('workspaceRegistry').get(winWs).attachSession(source);

  step('Windows → SSH');
  const toSsh = await wsl.copySession(source, sshWs);
  console.log('   ', JSON.stringify(toSsh));
  assert.equal(toSsh.host, host);
  assert.equal(toSsh.cwd, remoteDir());
  const remote = await wsl.connection(host).exportSession(toSsh.sessionId);
  assert.ok(JSON.stringify(remote.events).includes(`over ssh ${tag}`));

  step('SSH → Windows');
  const back = await wsl.copySession(toSsh.sessionId, winWs);
  console.log('   ', JSON.stringify(back));
  assert.equal(back.host, null);
  const local = await exportSession(ctx, back.sessionId);
  assert.ok(JSON.stringify(local.events).includes(`over ssh ${tag}`));
  assert.equal(local.cwd, winDir);
  console.log('SSH SESSION COPY PASSED');
} catch (error) {
  failed = true;
  console.error('SSH SESSION COPY FAILED', error);
} finally {
  for (const id of workspaceIds) await rpc('workspace/delete', { request: { workspaceId: id } }).catch(() => {});
  if (remoteHome) await runWsl(['-d', distro, '-e', 'rm', '-rf', remoteDir()], { timeoutMs: 30000 }).catch(() => {});
  await ctx.get('wslRemote').connection(host).disconnect().catch(() => {});
  // Leave the throwaway home as it was: no fake SSH host to auto-connect next time.
  const service = ctx.get('wslRemote');
  service.save({
    ...service.settings,
    sshHosts: (service.settings.sshHosts ?? []).filter((dest) => dest !== 'me@copytest'),
    autoConnect: (service.settings.autoConnect ?? []).filter((id) => id !== host),
  });
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  rmSync(winDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
