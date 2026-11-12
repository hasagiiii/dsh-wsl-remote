// Windows joins a dsh already running in WSL with this plugin installed (scratch DSH_HOME there),
// through the real RemoteConnection: deploy, probe finds the socket, attach, hello, relay, API.
// Then disconnecting leaves that dsh running, and with no listener the connection starts its own dsh.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/remote-attach.mjs <distro> <socket> <dsh pid>
// Through fake-ssh the same: DSH_WSL_REMOTE_SSH=["<node>","test/fake-ssh.mjs"], host id ssh:me@dev.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteConnection } from '../lib/remote.js';
import { runOn } from '../lib/transport.js';
import { HostClient } from '../lib/bridge/host-client.js';

const [host = 'Ubuntu-26.04', socket, pid] = process.argv.slice(2);
assert.ok(socket?.startsWith('/'), 'the scratch resident socket path is required');
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const windowsReads = [];
const connection = new RemoteConnection({
  distro: host,
  packageDir,
  residentSocket: socket,
  logger: { info: (m) => console.log(`   ${m}`), warn: (m) => console.warn(`   ${m}`), debug: () => {} },
  // Sharing is on in the window's settings: a joined dsh must still keep its own sign-in.
  settings: () => ({ shareLogin: true, profile: 'web', ports: {} }),
  rememberPort: () => {},
  credentials: () => ({ resolve: async (ref) => (windowsReads.push(ref), undefined), listRecords: async () => [] }),
  onCredentialEvents: () => () => {},
});
const alive = async () => (await runOn(host, ['sh', '-c', `kill -0 ${pid} && echo alive || echo gone`], { timeoutMs: 30000 })).stdout.trim().split('\n').at(-1);

let failed = false;
try {
  await connection.connect();
  const snap = connection.snapshot();
  console.log('snapshot:', JSON.stringify({ state: snap.state, attached: snap.attached, shareLogin: snap.shareLogin, residentSocket: snap.residentSocket }));
  assert.equal(snap.state, 'connected');
  assert.equal(snap.attached, true, 'joined the running dsh');
  assert.equal(snap.shareLogin, false, 'sign-in is not shared with a joined dsh');
  assert.equal(connection.session.linux, undefined, 'no process group of ours to kill');

  // The relay reaches that dsh's web listener, and the API admits this window.
  const url = connection.openUrl();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
  const client = await HostClient.open({ url });
  const bundles = await client.call('pluginManager/listBundles', { args: {} });
  const mine = (bundles.value ?? []).find((bundle) => bundle.name === '@local/dsh-wsl-remote');
  console.log('that dsh lists this plugin:', JSON.stringify(mine && { version: mine.version, enabled: mine.enabled }));
  assert.ok(mine?.enabled, 'answered by the dsh that has the plugin installed');
  await client.close();

  await connection.disconnect();
  assert.equal(await alive(), 'alive', 'disconnecting leaves the joined dsh running');
  console.log('after disconnect: the joined dsh is still running');

  // Reconnect: joins again (a resident agent serves every window, one after another).
  await connection.connect();
  assert.equal(connection.snapshot().attached, true);
  await connection.disconnect();
  assert.equal(await alive(), 'alive');
  assert.equal(windowsReads.length, 0, 'the joined dsh never read the Windows credential store');
  console.log('REMOTE ATTACH PASSED');
} catch (error) {
  failed = true;
  console.error('REMOTE ATTACH FAILED', error);
} finally {
  await connection.disconnect().catch(() => {});
  process.exit(failed ? 1 : 0);
}
