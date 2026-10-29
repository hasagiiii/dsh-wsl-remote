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
assert.deepEqual([...routes.keys()].sort(), ['connect', 'connections', 'disconnect', 'open', 'settings'].map((p) => `/api/local-wsl-remote/${p}`).sort());
assert.equal(tools[0].name, 'wsl_remote_connections');
const bad = await routes.get('/api/local-wsl-remote/connect').fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ distro: 'no such distro' }) }));
assert.equal(bad.status, 400);
const saved = await (await routes.get('/api/local-wsl-remote/settings').fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ shareLogin: false, profile: 'web' }) }))).json();
assert.equal(saved.shareLogin, false);
console.log('PASS');
