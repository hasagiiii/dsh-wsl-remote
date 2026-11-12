// The original problem: a workspace created from the Windows window must be the running dsh's own,
// so its web UI (same process) shows it in place, not as Ungrouped. Desktop boot (throwaway Windows home)
// joins the resident scratch dsh in WSL, creates a workspace there, then asks THAT dsh directly.
//   ELECTRON_RUN_AS_NODE=1 DSH_HOME=<boot home> "DeepSeek Harness.exe" --expose-internals --import ./test/resolve-boot.mjs \
//     test/boot-attach-workspace.mjs <profileDir> <distro> <resident socket> <resident web url>
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { runWsl } from '../lib/wsl.js';
import { HostClient } from '../lib/bridge/host-client.js';
import { applyWorkspaceFrame, emptyWorkspaceState } from '../lib/bridge/merge.js';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro, socket, residentUrl, storePath] = process.argv.slice(2);
assert.ok(socket && residentUrl && storePath, 'resident socket, web url and workspace store path are required');
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const profile = loadProfileDirectory('dsh', projectDir, installAnchor);
reportSkippedBundles('dsh', profile);
const app = await runProfile({ environment: loadLayeredEnv('dsh'), profile: 'desktop', resolvedProfile: { profile, installAnchor }, patchFiles: [], args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] });
const { ctx } = app;
const gateway = ctx.get('typertGateway');
const peer = ctx.get('connection').browserPeer;
const rpc = async (endpoint, args = {}) => {
  const result = await gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
  if (!result.ok) throw new Error(`${endpoint}: ${result.error.code}: ${result.error.message}`);
  return result.value;
};
const tag = randomUUID().slice(0, 8);
let folder;
let created;
let failed = false;
try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  const connection = wsl.connection(distro);
  // The throwaway home may auto-connect at boot; let that attempt settle, then reconnect against
  // the scratch resident dsh, not the user's.
  for (let i = 0; i < 20 && connection.pending === undefined && connection.state === 'disconnected'; i++) await sleep(250);
  await connection.pending?.catch(() => {});
  await connection.disconnect();
  connection.options.residentSocket = socket;
  await connection.connect();
  const snap = connection.snapshot();
  step(`connected: attached=${snap.attached} shareLogin=${snap.shareLogin} residentSocket=${snap.residentSocket} option=${connection.options.residentSocket} agentDir=${connection.session?.dir}`);
  assert.equal(snap.attached, true);

  const home = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 30000 })).stdout.trim();
  folder = `${home}/.dsh-wsl-remote/resident-test/ws-${tag}`;
  await runWsl(['-d', distro, '-e', 'mkdir', '-p', folder], { timeoutMs: 30000 });
  created = await rpc('workspace/create', { request: { path: `\\\\wsl.localhost\\${distro}${folder.replaceAll('/', '\\')}` } });
  step(`created ${created.workspace.workspaceId} for ${folder}`);
  await sleep(1500);
  const owner = wsl.bridge.merged().owners.get(created.workspace.workspaceId);
  console.log('   owner in the merge:', JSON.stringify(owner));
  assert.equal(owner?.host, distro, 'routed to the joined host');
  // The resident dsh's own durable store: the workspace is written there, in the running dsh.
  const stored = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'cat "$1"', 'sh', storePath], { timeoutMs: 30000 })).stdout;
  const paths = Object.values(JSON.parse(stored).tables.workspaces).map((workspace) => workspace.path);
  console.log('   the running dsh stores:', paths.join(', ') || '(none)');
  assert.ok(paths.includes(folder), 'the workspace created from Windows is in the running dsh\'s own store');

  // Ask the resident dsh itself, through its own web API (what its browser UI follows).
  const direct = await HostClient.open({ url: residentUrl });
  const abort = new AbortController();
  let followed = emptyWorkspaceState();
  for await (const frame of direct.stream('workspace/follow', { args: {} }, abort.signal)) {
    followed = applyWorkspaceFrame(followed, frame);
    if (followed.items.length > 0) break;
  }
  abort.abort();
  const mine = followed.items.find((item) => item.path === folder);
  console.log('   the running dsh\'s own UI follows:', followed.items.map((item) => item.path.split('/').pop()).join(', '));
  assert.ok(mine, 'its own UI shows the workspace in place (not Ungrouped)');
  await direct.close();
  console.log('ATTACH WORKSPACE PASSED');
} catch (error) {
  failed = true;
  console.error('ATTACH WORKSPACE FAILED', error);
} finally {
  if (created) await rpc('workspace/delete', { request: { workspaceId: created.workspace.workspaceId } }).catch(() => {});
  if (folder) await runWsl(['-d', distro, '-e', 'rm', '-rf', folder], { timeoutMs: 30000 }).catch(() => {});
  await ctx.get('wslRemote').connection(distro).disconnect().catch(() => {});
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), sleep(15000).then(() => 'timeout')]);
  step(`shutdown ${settled}`);
  process.exit(failed ? 1 : 0);
}
