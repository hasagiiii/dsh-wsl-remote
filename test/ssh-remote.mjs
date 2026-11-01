/**
 * End-to-end over the SSH code path, with WSL standing in for the server:
 * test/fake-ssh.mjs receives ssh's real argv (options, `--`, host, one quoted
 * command string), prints a login banner on stdout, and runs the command in
 * the distribution's shell. Deploys the agent, probes, starts dsh, opens its
 * UI through the relay, lists folders, then disconnects and kills the group.
 *   $env:DSH_FAKE_SSH_DISTRO = 'Ubuntu-26.04'; node test/ssh-remote.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
process.env.DSH_WSL_REMOTE_SSH = JSON.stringify([process.execPath, join(here, 'fake-ssh.mjs')]);
const { RemoteConnection } = await import('../lib/remote.js');
const { listLinuxDirectory, toRemoteAddress } = await import('../lib/linux-fs.js');
const { runOn } = await import('../lib/transport.js');

const host = 'ssh:me@dev:2222';

// A failing ssh is reported with a hint, not a hang.
const unreachable = new RemoteConnection({
  distro: 'ssh:unreachable', packageDir: join(here, '..'), logger: { info() {}, warn() {}, debug() {} },
  settings: () => ({ shareLogin: false, profile: 'web', ports: {} }), rememberPort() {}, credentials: () => undefined, onCredentialEvents: () => () => {},
});
await assert.rejects(unreachable.connect(), /Could not resolve hostname/);
assert.equal(unreachable.snapshot().hint, 'network');
assert.equal(unreachable.snapshot().kind, 'ssh');
console.log('unreachable host reported:', unreachable.snapshot().hint);

const listing = await listLinuxDirectory(host, undefined);
assert.ok(listing.home.startsWith('/'), 'home read through the banner');
assert.ok(listing.entries.every((entry) => !entry.name.includes('Welcome')), 'banner is not a folder');
assert.equal(listing.unc, toRemoteAddress(host, listing.home));
console.log(`listed ${listing.entries.length} folders in ${listing.home} -> ${listing.unc}`);

const connection = new RemoteConnection({
  distro: host,
  packageDir: join(here, '..'),
  logger: { info: (m) => console.log(m), warn: (m) => console.warn(m), debug: () => {} },
  settings: () => ({ shareLogin: false, profile: process.env.WSL_PROFILE ?? 'web', ports: {} }),
  rememberPort: (name, port) => console.log(`relay port for ${name}: ${port}`),
  credentials: () => undefined,
  onCredentialEvents: () => () => {},
});
connection.on('change', (s) => console.log(`state: ${s.state}${s.error ? ` (${s.error})` : ''}`));
let linux;
try {
  await connection.connect();
  const snapshot = connection.snapshot();
  assert.equal(snapshot.state, 'connected');
  assert.equal(snapshot.kind, 'ssh');
  assert.equal(snapshot.dest, 'me@dev:2222');
  assert.equal(snapshot.launcher, undefined, 'no dsh-harness over SSH');
  console.log(`remote dsh ${snapshot.dsh} at ${snapshot.dshPath}`);
  linux = connection.session.linux;
  assert.ok(linux?.pid, 'process group reported');

  const url = connection.openUrl();
  const first = await fetch(url, { redirect: 'manual' });
  assert.ok([302, 303].includes(first.status), 'token exchange redirects');
  const cookie = first.headers.get('set-cookie')?.split(';')[0];
  const index = await fetch(new URL('./', url), { headers: { cookie } });
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<html/i);
  console.log('remote UI served through the relay');
} finally {
  await connection.disconnect();
}
assert.equal(connection.snapshot().state, 'disconnected');
const left = await runOn(host, ['sh', '-c', 'kill -0 -- "-$1" 2>/dev/null && echo alive || echo gone', 'sh', linux.pid]);
assert.equal(left.stdout.trim().split(/\r?\n/).at(-1), 'gone', 'the remote dsh process group ended');
console.log('PASS');
