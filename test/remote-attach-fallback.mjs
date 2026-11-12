// The fallbacks: a stale socket file (nothing listening) or a disabled plugin → the connection
// starts its own dsh as before; disconnecting that one ends it.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/remote-attach-fallback.mjs <host> <stale socket path>
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteConnection } from '../lib/remote.js';
import { runOn } from '../lib/transport.js';

const [host = 'Ubuntu-26.04', socket] = process.argv.slice(2);
assert.ok(socket?.startsWith('/'));
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// A socket file with nobody behind it, as a dsh that ended without cleanup leaves.
const stale = await runOn(host, ['sh', '-c', `mkdir -p "$(dirname "$1")" && rm -f "$1" && python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "$1" && test -S "$1" && echo made`, 'sh', socket], { timeoutMs: 30000 });
assert.equal(stale.stdout.trim().split('\n').at(-1), 'made', `stale socket: ${stale.stderr}`);
const connection = new RemoteConnection({
  distro: host,
  packageDir,
  residentSocket: socket,
  logger: { info: (m) => console.log(`   ${m}`), warn: (m) => console.warn(`   ${m}`), debug: () => {} },
  settings: () => ({ shareLogin: false, profile: 'web', ports: {} }),
  rememberPort: () => {},
  credentials: () => undefined,
  onCredentialEvents: () => () => {},
});
let failed = false;
try {
  await connection.connect();
  const snap = connection.snapshot();
  console.log('snapshot:', JSON.stringify({ state: snap.state, attached: snap.attached ?? false }));
  assert.equal(snap.state, 'connected');
  assert.equal(snap.attached, undefined, 'nobody answered: a dsh was started for this window');
  const started = connection.session.linux;
  assert.ok(started?.pid, 'its process group is known, to end it on disconnect');
  await connection.disconnect();
  const gone = await runOn(host, ['sh', '-c', `kill -0 ${started.pid} 2>/dev/null && echo alive || echo gone`], { timeoutMs: 30000 });
  assert.equal(gone.stdout.trim().split('\n').at(-1), 'gone', 'the started dsh ends with the connection');
  console.log('FALLBACK PASSED');
} catch (error) {
  failed = true;
  console.error('FALLBACK FAILED', error);
} finally {
  await connection.disconnect().catch(() => {});
  await runOn(host, ['rm', '-f', socket], { timeoutMs: 30000 }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
