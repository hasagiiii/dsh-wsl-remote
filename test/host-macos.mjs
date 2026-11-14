import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run with --import ./test/stub-cordis.mjs. No live profile or SSH connection.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'wslr-macos-'));
Object.defineProperty(process, 'platform', { value: 'darwin' });
const { default: WslRemoteService } = await import('../index.js');
const routes = new Map();
const ctx = {
  logger: { info() {}, warn() {}, debug() {} },
  effect() {}, on: () => () => {}, get: () => undefined,
  inject(names, callback) {
    if (names.length === 1 && names[0] === 'connection') callback({
      effect() {}, connection: { fetch: { register: (route) => routes.set(route.path, route) } },
    });
  },
};
const service = new WslRemoteService(ctx, {});
const status = await service.status();
assert.equal(status.platform, 'darwin');
assert.notEqual(status.resident, true);
assert.equal(status.sshAvailable, true);
assert.equal(status.discoveryError, undefined);
assert.deepEqual(status.distros, []);
for (const name of ['ssh/add', 'connect', 'models/rpc', 'linux/list']) {
  assert.ok(routes.has(`/api/local-wsl-remote/${name}`), `${name} registered on macOS`);
}
const added = await routes.get('/api/local-wsl-remote/ssh/add').fetch(new Request('http://fixture/', {
  method: 'POST', body: JSON.stringify({ dest: 'fixture-server' }),
}));
assert.equal(added.status, 200);
const value = await added.json();
assert.ok(value.distros.some((host) => host.name === 'ssh:fixture-server' && host.kind === 'ssh'));
let connected;
service.connection = (id) => ({ connect: async () => { connected = id; } });
const response = await routes.get('/api/local-wsl-remote/connect').fetch(new Request('http://fixture/', {
  method: 'POST', body: JSON.stringify({ distro: 'ssh:fixture-server' }),
}));
assert.equal(response.status, 200);
assert.equal(connected, 'ssh:fixture-server');
console.log('macOS host: SSH add/connect and remote settings routes pass');

// Linux must retain its resident role, rather than exposing an outgoing manager.
Object.defineProperty(process, 'platform', { value: 'linux' });
routes.clear();
const resident = new WslRemoteService(ctx, {});
assert.equal(resident.resident, true);
assert.ok(!routes.has('/api/local-wsl-remote/ssh/add'));
console.log('Linux host: resident role retained');
