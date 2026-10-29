/**
 * End-to-end check against a real WSL distribution (needs dsh installed there):
 *   $env:WSL_DISTRO = 'Ubuntu-26.04'; node test/remote.mjs
 * Deploys the agent, starts the WSL dsh through wsl.exe stdio, loads its UI
 * through the Windows relay with the launch token, and checks that the WSL
 * dsh answers credentials from a (fake) Windows store when sharing is on.
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RemoteConnection } from '../lib/remote.js';

const distro = process.env.WSL_DISTRO ?? 'Ubuntu';
const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const reads = [];
const windowsStore = {
  resolve: async (ref) => (reads.push(ref), ref === 'WSLR_PROBE_KEY' ? { value: 'from-windows', source: 'file' } : undefined),
  describe: async () => ({ configured: false, writable: true }),
  set: async () => {},
  unset: async () => {},
  readRecord: async (key) => (reads.push(key), undefined),
  describeRecord: async () => ({ configured: false, writable: true }),
  listRecords: async () => [],
  modifyRecord: async () => undefined,
  deleteRecord: async () => {},
};

const connection = new RemoteConnection({
  distro,
  packageDir,
  logger: { info: (m) => console.log(m), warn: (m) => console.warn(m), debug: () => {} },
  settings: () => ({ shareLogin: true, profile: process.env.WSL_PROFILE ?? 'web', ports: {} }),
  rememberPort: (name, port) => console.log(`relay port for ${name}: ${port}`),
  credentials: () => windowsStore,
  onCredentialEvents: () => () => {},
});
connection.on('change', (s) => console.log(`state: ${s.state}${s.error ? ` (${s.error})` : ''}`));

try {
  await connection.connect();
  const snapshot = connection.snapshot();
  assert.equal(snapshot.state, 'connected');
  console.log(`WSL dsh ${snapshot.dsh} at ${snapshot.dshPath}`);

  const url = connection.openUrl();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
  const first = await fetch(url, { redirect: 'manual' });
  console.log(`GET /?token -> ${first.status}`);
  assert.ok([302, 303].includes(first.status), 'token exchange redirects');
  const cookie = first.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'token exchange sets the session cookie');
  const index = await fetch(new URL('./', url), { headers: { cookie } });
  const html = await index.text();
  console.log(`GET / -> ${index.status}, ${html.length} bytes`);
  assert.equal(index.status, 200);
  assert.match(html, /<html/i);

  // The WSL dsh boot reads its credentials; with sharing on, those reads reach Windows.
  for (let i = 0; i < 50 && reads.length === 0; i++) await new Promise((r) => setTimeout(r, 200));
  console.log(`credential reads answered by Windows: ${reads.length} (${[...new Set(reads)].slice(0, 6).join(', ')})`);
  assert.ok(reads.length > 0, 'shared credentials are read from Windows');
  console.log('PASS');
} finally {
  await connection.disconnect();
  console.log(`after disconnect: ${connection.snapshot().state}`);
}
