// Rehearsal: boot the real Desktop profile composition (all bundles + this plugin)
// in a throwaway DSH home, the way dsh-desktop-host does, then exercise the
// execution services from inside it. Does not touch the running app.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals test/boot-desktop.mjs <profileDir>
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const projectDir = process.argv[2];
const winWs = process.argv[3];
const wslWs = process.argv[4];
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);

const profile = loadProfileDirectory('dsh', projectDir, installAnchor);
reportSkippedBundles('dsh', profile);
step(`bundles: ${profile.bundles?.map?.((b) => b.name ?? b).join(', ') ?? '(?)'}`);
const app = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'desktop',
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
});
const { ctx } = app;
step('profile booted');

let failed = false;
try {
  const get = (name) => ctx.get(name);
  for (const name of ['wslRemote', 'wslExec', 'subprocess', 'sandbox', 'fs', 'shell', 'sandboxPolicy', 'workingDirectory', 'tools']) {
    const value = get(name);
    console.log(`  ${name.padEnd(17)} ${value === undefined ? 'MISSING' : value.constructor?.name}`);
  }
  assert.equal(get('subprocess')?.constructor?.name, 'DispatchSubprocess');
  assert.equal(get('shell')?.constructor?.name, 'DispatchShell');
  assert.equal(get('fs')?.constructor?.name, 'DispatchFileSystem');
  assert.equal(get('sandbox')?.constructor?.name, 'DispatchSandbox');
  assert.ok(get('wslExec'), 'wslExec mounted');

  const policy = (root, mode) => ({ ...get('sandboxPolicy').resolve(mode ? { mode } : {}), workspaceRoot: root });
  const run = async (command, workdir, mode) => (await get('shell').execute(get('shell').resolve({ command, workdir, sandboxPolicy: policy(workdir, mode) }))).result();

  step('Windows: pwsh (full access; restricted-token sandbox is checked separately)');
  let r = await run('Write-Output "win:$((Get-Location).Path)"', winWs, 'danger-full-access');
  console.log('  ', JSON.stringify(r.stdout.text.trim()), r.exitCode);
  assert.match(r.stdout.text, /^win:/);

  step('Windows: fs read of a real file');
  const readme = await get('fs').resolve('package.json', { cwd: winWs });
  assert.match(await get('fs').readText(readme), /dsh-wsl-remote/);

  step('WSL: first call deploys/locates the runtime and runs bash with bubblewrap');
  r = await run('echo "$0|$PWD|$(uname -s)"', wslWs);
  console.log('  ', JSON.stringify(r.stdout.text.trim()), r.sandbox, r.exitCode, r.stderr.text.slice(0, 300));
  assert.match(r.stdout.text, /\|Linux/);
  assert.equal(r.sandbox?.enforcement, 'full');

  step('WSL: fs read through the dispatcher');
  const target = await get('fs').resolve('README.md', { cwd: wslWs });
  console.log('  ', target.displayPath, (await get('fs').stat(target))?.type);
  assert.ok((await get('fs').readText(target)).length > 0);

  step('Host status');
  const status = await get('wslRemote').status();
  console.log('  ', JSON.stringify({ workspaceExecution: status.workspaceExecution, distros: status.distros.map((d) => ({ name: d.name, execProblem: d.execProblem })) }));

  step('real sessions through the session controller (preset-mounted Agents)');
  const controller = get('sessionController');
  const sessionTools = async (cwd) => {
    const { sessionId } = await controller.create({ cwd });
    const agent = get('agents').get(sessionId);
    const tools = get('tools');
    const has = (name) => tools.get(name, agent) !== undefined;
    const assembly = await get('systemPrompt').assemble({ agent, scope: agent });
    const env = assembly.sections.find((section) => section.name === 'wsl-remote:environment');
    const toolNames = assembly.tools.map((tool) => tool.name);
    return { agent, sessionId, bash: has('bash'), pwsh: has('pwsh'), env: env?.text, toolNames };
  };
  const winSession = await sessionTools(winWs);
  const wslSession = await sessionTools(wslWs);
  console.log('   windows session:', JSON.stringify({ bash: winSession.bash, pwsh: winSession.pwsh, env: Boolean(winSession.env), shellTools: winSession.toolNames.filter((n) => n === 'bash' || n === 'pwsh') }));
  console.log('   wsl session:    ', JSON.stringify({ bash: wslSession.bash, pwsh: wslSession.pwsh, env: Boolean(wslSession.env), shellTools: wslSession.toolNames.filter((n) => n === 'bash' || n === 'pwsh') }));
  console.log('   env section:', wslSession.env);
  assert.ok(winSession.pwsh && !winSession.bash && !winSession.env, 'Windows session keeps pwsh only');
  assert.ok(wslSession.bash && !wslSession.pwsh && wslSession.env, 'WSL session gets bash, no pwsh, env section');
  assert.ok(wslSession.toolNames.includes('bash') && !wslSession.toolNames.includes('pwsh'), 'model-facing schemas follow');

  step('real bash tool call inside the WSL session');
  const bash = get('tools').get('bash', wslSession.agent);
  const value = await bash.execute({ command: 'echo "$PWD $(uname -s)"; ls README.md', description: 'probe' }, { agent: wslSession.agent, signal: new AbortController().signal, callId: 'probe-1', rootCallId: 'probe-1' });
  console.log('  ', JSON.stringify({ kind: value.kind, cwd: value.cwd, exit: value.exitCode, out: value.stdout?.text?.trim(), sandbox: value.sandbox }));
  assert.equal(value.exitCode, 0);
  assert.match(value.stdout.text, /\/home\/jiantaoli\/dsh-wsl-remote Linux/);

  step('real read tool inside the WSL session');
  const read = get('tools').get('read', wslSession.agent);
  const readValue = await read.execute({ file_path: 'package.json', limit: 3 }, { agent: wslSession.agent, signal: new AbortController().signal, callId: 'probe-2', rootCallId: 'probe-2' });
  console.log('  ', JSON.stringify(readValue).slice(0, 240));

  step('real grep tool inside the WSL session');
  const grep = get('tools').get('grep', wslSession.agent);
  const grepValue = await grep.execute({ pattern: 'WslConnection', include: '*.js' }, { agent: wslSession.agent, signal: new AbortController().signal, callId: 'probe-3', rootCallId: 'probe-3' });
  console.log('  ', JSON.stringify(grepValue).slice(0, 300));
  assert.ok(JSON.stringify(grepValue).includes('connection.js'), 'grep found the Linux files');

  step('real glob tool inside the WSL session');
  const glob = get('tools').get('glob', wslSession.agent);
  const globValue = await glob.execute({ pattern: 'server/**/*.mjs' }, { agent: wslSession.agent, signal: new AbortController().signal, callId: 'probe-4', rootCallId: 'probe-4' });
  console.log('  ', JSON.stringify(globValue).slice(0, 300));
  assert.ok(JSON.stringify(globValue).includes('bridge.mjs'), 'glob found the Linux files');

  step('real write + edit tools inside the WSL session (workspace-write)');
  const write = get('tools').get('write', wslSession.agent);
  const edit = get('tools').get('edit', wslSession.agent);
  const exec = (id) => ({ agent: wslSession.agent, signal: new AbortController().signal, callId: id, rootCallId: id });
  await write.execute({ file_path: '.wslr-rehearsal.txt', content: 'alpha\n' }, exec('probe-5'));
  await read.execute({ file_path: '.wslr-rehearsal.txt' }, exec('probe-6'));
  await edit.execute({ file_path: '.wslr-rehearsal.txt', old_string: 'alpha', new_string: 'beta' }, exec('probe-7'));
  const check = await bash.execute({ command: 'cat .wslr-rehearsal.txt; rm .wslr-rehearsal.txt', description: 'verify' }, exec('probe-8'));
  console.log('  ', JSON.stringify(check.stdout?.text));
  assert.equal(check.stdout.text, 'beta\n');
  console.log('BOOT REHEARSAL PASSED');
} catch (error) {
  failed = true;
  console.error('BOOT REHEARSAL FAILED', error);
} finally {
  step('shutting down');
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  process.exit(failed ? 1 : 0);
}
