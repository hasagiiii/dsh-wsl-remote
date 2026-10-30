// End-to-end check of the WSL execution providers against a real distribution,
// using the installed DeepSeek Harness packages (rc.5):
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/exec-e2e.mjs
// Environment: WSL_DISTRO (default Ubuntu-26.04), WSL_NODE, WSL_SERVER_DIR.
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import { WslConnection } from '../lib/exec/connection.js';
import { WslFileSystem, WslSubprocessRuntime, WslSandboxProvider } from '../lib/exec/providers.js';

const distro = process.env.WSL_DISTRO ?? 'Ubuntu-26.04';
const node = process.env.WSL_NODE ?? '/home/jiantaoli/.nvm/versions/node/v24.19.0/bin/node';
const serverDir = process.env.WSL_SERVER_DIR ?? '/home/jiantaoli/.dsh-wsl-remote/server/1.1.0+dsh-0.2.1-rc.3';
const home = serverDir.replace(/\/\.dsh-wsl-remote\/.*$/, '');
const linuxRoot = `${home}/.dsh-wsl-remote/e2e`;
const workspaceWin = `\\\\wsl.localhost\\${distro}${linuxRoot.replace(/\//g, '\\')}`;
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(5)}ms] ${name}`);

const ctx = new Context();
await ctx.plugin(SessionProjectionRegistry);
await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspaceWin });
await ctx.plugin(WslConnection, { distro, node, serverDir });
await ctx.plugin(WslFileSystem);
await ctx.plugin(WslSubprocessRuntime);
await ctx.plugin(WslSandboxProvider);
await ctx.inject(['fs', 'subprocess', 'sandbox', 'ssh'], async () => {});
const { fs, subprocess, sandbox, ssh } = ctx;

async function run(argv, cwd, stdin) {
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: { stdin: stdin === undefined ? 'ignore' : { data: stdin }, stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } },
    graceMs: 2000,
  });
  const outcome = await handle.done;
  return { ...outcome, stdout: handle.collected.stdout.readFrom(0).text, stderr: handle.collected.stderr.readFrom(0).text };
}

try {
  step('bridge start + uname');
  const uname = await run(['uname', '-sr'], home);
  assert.equal(uname.exitCode, 0, uname.stderr);
  assert.match(uname.stdout, /Linux/);
  console.log('bridge:', JSON.stringify(ssh.info));

  step('mkdir workspace');
  assert.equal((await run(['mkdir', '-p', linuxRoot], home)).exitCode, 0);

  step('fs.writeText via Windows UNC path');
  const target = await fs.resolve(`${workspaceWin}\\hello.txt`);
  assert.equal(fs.processPath(target), `${linuxRoot}/hello.txt`);
  const written = await fs.writeText(target, 'line one\nline two\n', undefined, undefined, ctx.sandboxPolicy.resolve());
  assert.ok(written.operation === 'create' || written.operation === 'update', JSON.stringify(written));

  step('fs.editText + readText + listDir + relative resolve');
  const info = await fs.stat(target);
  await fs.editText(target, { oldString: 'two', newString: 'TWO', replaceAll: false }, { version: info.version }, undefined, ctx.sandboxPolicy.resolve());
  assert.equal(await fs.readText(target), 'line one\nline TWO\n');
  assert.ok((await fs.listDir(await fs.resolve(workspaceWin))).some((entry) => entry.name === 'hello.txt'));
  assert.equal(fs.processPath(await fs.resolve('hello.txt', { cwd: workspaceWin })), `${linuxRoot}/hello.txt`);
  assert.equal(fs.processPath(await fs.resolve(`${linuxRoot}/hello.txt`, { cwd: workspaceWin })), `${linuxRoot}/hello.txt`);

  step('sandbox: file write outside the workspace is denied');
  const outside = await fs.resolve(`${home}/.dsh-wsl-remote/outside.txt`);
  await assert.rejects(() => fs.writeText(outside, 'x', undefined, undefined, ctx.sandboxPolicy.resolve()), (error) => error.code === 'FS_SANDBOX_DENIED');

  step('confined command in the workspace');
  const confined = await sandbox.confine(['bash', '-c', `echo inside > in.txt && cat in.txt && pwd && (echo nope > ${home}/.dsh-wsl-remote/denied.txt; echo rc=$?)`], ctx.sandboxPolicy.resolve(), undefined);
  console.log('enforcement', confined.enforcement, 'runner', confined.argv[0]);
  const confinedRun = await run(confined.argv, workspaceWin);
  assert.equal(confinedRun.exitCode, 0, confinedRun.stderr);
  assert.match(confinedRun.stdout, /inside/);
  assert.ok(confinedRun.stdout.includes(linuxRoot));
  assert.match(confinedRun.stdout, /rc=[1-9]/);

  step('stdin + login environment');
  const envRun = await run(['bash', '-c', 'cat; echo; command -v node git || true'], workspaceWin, 'from-stdin');
  console.log(envRun.stdout.trim().split('\n').join(' | '));
  assert.match(envRun.stdout, /from-stdin/);

  step('packaged Windows ripgrep path runs Linux rg');
  const rg = await run(['D:\\ds_harness\\resources\\app.asar.unpacked\\dsh\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe', '--no-config', '--json', 'TWO', workspaceWin], workspaceWin);
  assert.equal(rg.exitCode, 0, rg.stderr);
  assert.match(rg.stdout, /line TWO/);

  step('terminal environment + PTY');
  console.log('terminal env ->', JSON.stringify(await subprocess.terminalEnvironment()));
  const term = await subprocess.spawnTerminal({ argv: ['bash', '--norc', '-i'], cwd: workspaceWin, env: {}, graceMs: 1000, rows: 24, cols: 80, terminalType: 'xterm-256color' });
  let screen = '';
  term.output.on('data', (chunk) => {
    screen += chunk.toString();
  });
  await term.write('echo pty-$((6*7))\r');
  for (let i = 0; i < 30 && !/pty-42/.test(screen); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  await term.terminate();
  assert.match(screen, /pty-42/);

  step('cleanup');
  await run(['rm', '-rf', linuxRoot], home);
  console.log('E2E PASSED');
} catch (error) {
  console.error('E2E FAILED', error);
  process.exitCode = 1;
} finally {
  setTimeout(() => process.exit(), 500).unref();
}
