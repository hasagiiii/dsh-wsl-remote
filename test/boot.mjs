// Offline check: the generated patch picks Windows or WSL rows from wsl-remote.json at startup.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
const rows = [];
let current;
for (const line of patch.split('\n')) {
  const id = /^\s*-\s+id:\s+(\S+)/.exec(line);
  if (id) rows.push((current = { id: id[1] }));
  const disabled = /^\s+disabled:\s+!!js "(.*)"$/.exec(line);
  if (disabled && current) current.disabled = JSON.parse(`"${disabled[1]}"`);
  const field = /^\s+(distro|node|serverDir|shell|launch):\s+!!js "(.*)"$/.exec(line);
  if (field && current) (current.config ??= {})[field[1]] = JSON.parse(`"${field[2]}"`);
}
const evaluate = (expr) => new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')({ dshHomePath: () => '' }, expr);

function boot(state) {
  const home = mkdtempSync(join(tmpdir(), 'wsl-remote-boot-'));
  if (state !== undefined) writeFileSync(join(home, 'wsl-remote.json'), JSON.stringify(state));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  delete globalThis.__dshWslRemote;
  try {
    const result = {};
    for (const row of rows) {
      const off = row.disabled === undefined ? false : Boolean(evaluate(row.disabled));
      const config = off || row.config === undefined ? undefined : Object.fromEntries(Object.entries(row.config).map(([k, v]) => [k, evaluate(v)]));
      result[row.id] = { off, config };
    }
    return result;
  } finally {
    process.env.DSH_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

const wslRows = ['local-wsl-connection', 'local-wsl-fs', 'local-wsl-subprocess', 'local-wsl-sandbox', 'local-wsl-shell', 'tool-bash'];
const winRows = ['subprocess', 'sandbox', 'pwsh-sandbox', 'fs-sandbox'];

for (const [label, state] of [['no file', undefined], ['local', { environment: '' }], ['not deployed', { environment: 'Ubuntu-26.04' }], ['bad name', { environment: 'x;rm -rf /', node: '/n', serverDir: '/s' }], ['bad path', { environment: 'Ubuntu-26.04', node: '/n\\x', serverDir: '/s' }]]) {
  const r = boot(state);
  for (const id of wslRows) assert.equal(r[id].off, true, `${label}: ${id} must be off`);
  for (const id of winRows) assert.equal(r[id].off, false, `${label}: ${id} must be on`);
  assert.equal(r['ptc-runtime'].config.launch, undefined, `${label}: ptc launch default`);
  console.log(`ok  ${label}: Windows providers`);
}

const r = boot({ environment: 'Ubuntu-26.04', node: '/home/u/.nvm/versions/node/v24.19.0/bin/node', serverDir: '/home/u/.dsh-wsl-remote/server/1.1.0+dsh-0.2.1-rc.3', shells: { 'Ubuntu-26.04': '/usr/bin/zsh' } });
for (const id of wslRows) assert.equal(r[id].off, false, `wsl: ${id} must be on`);
for (const id of winRows) assert.equal(r[id].off, true, `wsl: ${id} must be off`);
assert.deepEqual(r['local-wsl-connection'].config, { distro: 'Ubuntu-26.04', node: '/home/u/.nvm/versions/node/v24.19.0/bin/node', serverDir: '/home/u/.dsh-wsl-remote/server/1.1.0+dsh-0.2.1-rc.3', shell: '/usr/bin/zsh' });
assert.deepEqual(r['ptc-runtime'].config.launch, { kind: 'node-script', executable: '/home/u/.nvm/versions/node/v24.19.0/bin/node', bootstrapPath: '/home/u/.dsh-wsl-remote/server/1.1.0+dsh-0.2.1-rc.3/ptc/process.js' });
console.log('ok  wsl: WSL providers, connection and PTC launch');
console.log('BOOT PASSED');
