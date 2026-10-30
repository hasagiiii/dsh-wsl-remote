// Dispatch check: one composition, Windows and WSL calls routed by path.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --import ./test/resolve-dsh.mjs test/dispatch.mjs
// Environment: WSL_DISTRO, WSL_NODE, WSL_SERVER_DIR (see test/exec-e2e.mjs).
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy';
import { DispatchFileSystem, DispatchSandbox, DispatchShell, DispatchSubprocess, WslExecWorlds } from '../lib/exec/dispatch.js';

const distro = process.env.WSL_DISTRO ?? 'Ubuntu-26.04';
const node = process.env.WSL_NODE ?? '/home/jiantaoli/.nvm/versions/node/v24.19.0/bin/node';
const serverDir = process.env.WSL_SERVER_DIR ?? '/home/jiantaoli/.dsh-wsl-remote/server/1.1.0+dsh-0.2.1-rc.3';
const home = serverDir.replace(/\/\.dsh-wsl-remote\/.*$/, '');
const linuxRoot = `${home}/.dsh-wsl-remote/dispatch-test`;
const wslWs = `\\\\wsl.localhost\\${distro}${linuxRoot.replace(/\//g, '\\')}`;
const winWs = process.env.TEMP + '\\wslr-dispatch-test';
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(5)}ms] ${name}`);

const ctx = new Context();
await ctx.plugin(SessionProjectionRegistry);
await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: winWs });
await ctx.plugin(WslExecWorlds, {});
await ctx.inject(['wslExec'], async () => {});
ctx.wslExec.setLocator(async () => ({ node, serverDir }));
await ctx.plugin(DispatchSubprocess);
await ctx.plugin(DispatchSandbox);
await ctx.plugin(DispatchFileSystem);
await ctx.plugin(DispatchShell);
await ctx.inject(['fs', 'subprocess', 'sandbox', 'shell'], async () => {});
const { fs, shell, sandboxPolicy } = ctx;
const policy = (root, mode = 'workspace-write') => ({ ...sandboxPolicy.resolve({ mode }), workspaceRoot: root });

async function run(command, workdir, mode) {
  const spec = shell.resolve({ command, workdir, sandboxPolicy: policy(workdir, mode) });
  return (await shell.execute(spec)).result();
}

try {
  step('Windows world: pwsh in a Windows workspace');
  await import('node:fs/promises').then((m) => m.mkdir(winWs, { recursive: true }));
  // Windows confinement (restricted token) fails on some machines with 0xC0000142 regardless of
  // this plugin; WIN_MODE=workspace-write checks it where it works.
  const winMode = process.env.WIN_MODE ?? 'danger-full-access';
  let r = await run('Write-Output "pwsh:$($PSVersionTable.PSEdition):$((Get-Location).Path)"', winWs, winMode);
  console.log(' ', JSON.stringify(r.stdout.text.trim()), r.sandbox, r.exitCode);
  assert.match(r.stdout.text, /^pwsh:(Core|Desktop):/);
  assert.ok(r.stdout.text.includes('wslr-dispatch-test'));

  step('Windows world: fs write/read in the Windows workspace');
  const winTarget = await fs.resolve('a.txt', { cwd: winWs });
  await fs.writeText(winTarget, 'windows\n', undefined, undefined, policy(winWs));
  assert.equal(await fs.readText(await fs.resolve(`${winWs}\\a.txt`)), 'windows\n');
  assert.equal(fs.processPath(winTarget).toLowerCase(), `${(await import('node:fs')).realpathSync.native(winWs)}\\a.txt`.toLowerCase());

  step('WSL world: mkdir the Linux workspace through the dispatcher');
  r = await run(`mkdir -p ${linuxRoot}`, `\\\\wsl.localhost\\${distro}${home.replace(/\//g, '\\')}`, 'danger-full-access');
  assert.equal(r.exitCode, 0, r.stderr.text);

  step('WSL world: bash in the WSL workspace (bubblewrap)');
  r = await run('echo "$0|$PWD|$(uname -s)"; touch inside.txt && echo wrote', wslWs);
  console.log(' ', JSON.stringify(r.stdout.text.trim()), r.sandbox);
  assert.equal(r.stdout.text.split('\n')[0], `bash|${linuxRoot}|Linux`);
  assert.match(r.stdout.text, /wrote/);
  assert.equal(r.sandbox?.mode, 'workspace-write');

  step('WSL world: write outside the workspace is denied by bwrap');
  r = await run(`touch ${home}/.dsh-wsl-remote/dispatch-denied`, wslWs);
  assert.equal(r.sandbox?.denied, true, JSON.stringify(r));

  step('WSL world: fs relative + Linux absolute + UNC paths name one file');
  const rel = await fs.resolve('hello.txt', { cwd: wslWs });
  assert.equal(rel.displayPath, `${wslWs}\\hello.txt`);
  await fs.writeText(rel, 'one\ntwo\n', undefined, undefined, policy(wslWs));
  const abs = await fs.resolve(`${linuxRoot}/hello.txt`, { cwd: wslWs });
  const info = await fs.stat(abs);
  assert.equal(info.type, 'file');
  await fs.editText(abs, { oldString: 'two', newString: 'TWO', replaceAll: false }, { version: info.version }, undefined, policy(wslWs));
  assert.equal(await fs.readText(await fs.resolve(`${wslWs}\\hello.txt`)), 'one\nTWO\n');
  assert.equal(fs.processPath(abs), `${wslWs}\\hello.txt`);
  const listing = await fs.listDir(await fs.resolve(wslWs));
  assert.ok(listing.some((entry) => entry.name === 'hello.txt' && entry.target.displayPath === `${wslWs}\\hello.txt`));
  assert.equal((await fs.stat(listing.find((entry) => entry.name === 'hello.txt').target)).type, 'file');

  step('WSL world: fs sandbox denies a write outside the workspace');
  await assert.rejects(() => fs.writeText(fs.resolve(`${home}/.dsh-wsl-remote/fs-denied.txt`, { cwd: wslWs }).then((t) => t), 'x'), () => true);
  const outside = await fs.resolve(`${home}/.dsh-wsl-remote/fs-denied.txt`, { cwd: wslWs });
  await assert.rejects(() => fs.writeText(outside, 'x', undefined, undefined, policy(wslWs)), (error) => error.code === 'FS_SANDBOX_DENIED');

  step('WSL world: subprocess spawn with a WSL cwd (as grep/glob do), packaged rg path');
  const handle = ctx.subprocess.spawn({ argv: ['D:\\ds_harness\\resources\\app.asar.unpacked\\dsh\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe', '--no-config', '-n', 'TWO'], cwd: wslWs, stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 65536 } }, graceMs: 1000 });
  const outcome = await handle.done;
  console.log(' ', JSON.stringify(handle.collected.stdout.readFrom(0).text.trim()));
  assert.equal(outcome.exitCode, 0, handle.collected.stderr.readFrom(0).text);
  assert.match(handle.collected.stdout.readFrom(0).text, /hello\.txt:2:TWO/);

  step('Windows world still answers after WSL is mounted');
  r = await run('Write-Output ok', winWs, winMode);
  assert.equal(r.stdout.text.trim(), 'ok');

  step('cleanup');
  await run(`rm -rf ${linuxRoot} ${home}/.dsh-wsl-remote/dispatch-denied`, `\\\\wsl.localhost\\${distro}${home.replace(/\//g, '\\')}`, 'danger-full-access');
  await import('node:fs/promises').then((m) => m.rm(winWs, { recursive: true, force: true }));
  console.log('DISPATCH PASSED');
} catch (error) {
  console.error('DISPATCH FAILED', error);
  process.exitCode = 1;
} finally {
  setTimeout(() => process.exit(), 500).unref();
}
