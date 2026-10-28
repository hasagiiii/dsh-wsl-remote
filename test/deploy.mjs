// Deploy the Linux runtime with the same code the settings row uses, then talk to its helper.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/deploy.mjs
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { listDistros } from '../lib/wsl.js';
import { ensureServer } from '../lib/deploy.js';
import { WslConnection } from '../lib/connection.js';
import { settings } from './settings.mjs';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const { distro, facts } = await settings();
const distros = await listDistros();
assert.ok(distros.some((entry) => entry.name === distro), `${distro} is not an installed WSL 2 distribution`);
console.log('facts', JSON.stringify(facts));

const started = Date.now();
const deployed = await ensureServer(packageDir, distro, facts, undefined, console.log);
console.log('deployed', JSON.stringify(deployed), `${Date.now() - started}ms`);
assert.equal((await ensureServer(packageDir, distro, facts)).installed, false, 'second deployment must reuse the runtime');

const ctx = new Context();
await ctx.plugin(WslConnection, { distro, node: facts.node, serverDir: deployed.dir });
await ctx.inject(['ssh'], async () => {});
const environment = await ctx.ssh.request('terminal.environment', {}, z.any());
assert.equal(environment.platform, 'posix');
console.log('helper rg ->', await ctx.ssh.request('executable', { command: 'rg' }, z.string()));
console.log(`WSL_NODE=${facts.node}`);
console.log(`WSL_SERVER_DIR=${deployed.dir}`);
console.log('DEPLOY PASSED');
setTimeout(() => process.exit(), 300);
