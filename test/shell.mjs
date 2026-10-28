// Shell executor, sandbox modes, PTC worker and default-shell selection against a real distribution.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/shell.mjs
// Environment: WSL_DISTRO, WSL_NODE, WSL_SERVER_DIR (see deploy.mjs), WSL_ALT_SHELL (default /usr/bin/zsh; skipped if absent).
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node';
import { WslConnection } from '../lib/connection.js';
import { WslFileSystem, WslSubprocessRuntime, WslSandboxProvider, WslShellExecutor } from '../lib/providers.js';
import { settings } from './settings.mjs';

const { distro, node, serverDir, home, facts } = await settings();
const linuxRoot = `${home}/.dsh-wsl-remote/shell-test`;
const ws = `\\\\wsl.localhost\\${distro}${linuxRoot.replace(/\//g, '\\')}`;
const altShell = process.env.WSL_ALT_SHELL ?? '/usr/bin/zsh';

async function compose(shell) {
  const ctx = new Context();
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: ws });
  await ctx.plugin(WslConnection, { distro, node, serverDir, ...(shell ? { shell } : {}) });
  await ctx.plugin(WslFileSystem);
  await ctx.plugin(WslSubprocessRuntime);
  await ctx.plugin(WslSandboxProvider);
  await ctx.plugin(WslShellExecutor, {});
  await ctx.plugin(NodePtcRuntime, { launch: { kind: 'node-script', executable: node, bootstrapPath: `${serverDir}/ptc/process.js` } });
  await ctx.inject(['shell', 'ptcRuntime', 'subprocess'], async () => {});
  return ctx;
}
async function run(ctx, command, mode = 'workspace-write') {
  const spec = ctx.shell.resolve({ command, workdir: ws, sandboxPolicy: ctx.sandboxPolicy.resolve({ mode }) });
  return (await ctx.shell.execute(spec)).result();
}
try {
  const bash = await compose();
  // The workdir must exist before the executor can start a shell in it.
  const mkdir = bash.subprocess.spawn({ argv: ['mkdir', '-p', linuxRoot], cwd: home, stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } }, graceMs: 1000 });
  assert.equal((await mkdir.done).exitCode, 0);
  let r;

  r = await run(bash, 'echo "$0 $PWD"; git --version');
  console.log('bash:', JSON.stringify(r.stdout.text), r.sandbox);
  assert.ok(r.stdout.text.startsWith(`bash ${linuxRoot}\n`));
  assert.equal(r.sandbox.mode, 'workspace-write');

  r = await run(bash, `touch ${home}/.dsh-wsl-remote/should-fail`);
  console.log('write outside workspace:', r.sandbox);
  assert.equal(r.sandbox.denied, true);

  r = await run(bash, 'touch ./probe', 'read-only');
  console.log('read-only write:', r.sandbox);
  assert.equal(r.sandbox.denied, true);

  const ptc = bash.ptcRuntime.resolve({ program: 'return { platform: process.platform, cwd: process.cwd() };', bindings: [], cwd: ws, sandboxPolicy: bash.sandboxPolicy.resolve() });
  const result = await bash.ptcRuntime.run(ptc);
  console.log('ptc:', JSON.stringify(result));
  assert.equal(result.error, undefined);
  assert.equal(result.value.platform, 'linux');
  assert.equal(result.value.cwd, linuxRoot);

  if (facts.shells.some((shell) => shell.path === altShell)) {
    const alt = await compose(altShell);
    r = await run(alt, 'echo "$0"');
    console.log('alt shell:', JSON.stringify(r.stdout.text));
    assert.equal(r.stdout.text.trim(), altShell);
  } else console.log(`alt shell: ${altShell} not installed, skipped`);

  await run(bash, `rm -rf ${linuxRoot}`, 'danger-full-access');
  console.log('SHELL PASSED');
} catch (error) {
  console.error('SHELL FAILED', error);
  process.exitCode = 1;
}
setTimeout(() => process.exit(), 300);
