/**
 * Load the Host plugin with a fake Cordis context (no WSL connect):
 *   node --import ./test/stub-cordis.mjs test/smoke-host.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'wslr-home-'));
const { default: WslRemoteService } = await import('../index.js');

const routes = new Map();
const tools = [];
const ctx = {
  logger: { info: (m) => console.log(m), warn: (m) => console.warn(m), debug() {} },
  effect() {},
  on: () => () => {},
  get: (name) => (name === 'credentials' ? {} : undefined),
  inject(names, callback) {
    if (names[0] === 'connection') callback({ connection: { fetch: { register: (route) => routes.set(route.path, route) } } });
    if (names[0] === 'tools') callback({ tools: { register: (tool) => tools.push(tool) } });
  },
};
const service = new WslRemoteService(ctx, {});
const status = await service.status();
console.log(JSON.stringify(status, null, 2));
assert.equal(status.shareLogin, true);
assert.ok(Array.isArray(status.distros));
assert.deepEqual([...routes.keys()].sort(), ['connect', 'connections', 'disconnect', 'open', 'settings', 'linux/list', 'linux/mkdir', 'distros', 'open-requests', 'open-requests/claim'].map((p) => `/api/local-wsl-remote/${p}`).sort());
assert.equal(tools[0].name, 'wsl_remote_connections');
const bad = await routes.get('/api/local-wsl-remote/connect').fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ distro: 'no such distro' }) }));
assert.equal(bad.status, 400);
const saved = await (await routes.get('/api/local-wsl-remote/settings').fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ shareLogin: false, profile: 'web' }) }))).json();
assert.equal(saved.shareLogin, false);
const post = async (path, value) => routes.get(`/api/local-wsl-remote/${path}`).fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify(value) }));
assert.equal((await post('linux/list', { distro: 'no such distro' })).status, 400);
const distro = status.distros[0]?.name;
if (distro !== undefined) {
  // Needs a real WSL distribution: the picker's first page is the Linux home.
  const listing = await (await post('linux/list', { distro })).json();
  assert.ok(listing.path.startsWith('/'), JSON.stringify(listing));
  assert.equal(listing.unc, `\\\\wsl.localhost\\${distro}${listing.path.replace(/\//g, '\\')}`);
  const info = await (await routes.get('/api/local-wsl-remote/distros').fetch(new Request('http://x/'))).json();
  console.log('distros:', JSON.stringify(info.distros));
  assert.ok(info.distros.find((entry) => entry.name === distro)?.os?.name, 'os-release read');
}
console.log('PASS');
