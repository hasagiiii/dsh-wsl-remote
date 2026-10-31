// Rehearsal of managing a distribution's plugins from the Windows window, against the real
// Desktop composition (throwaway DSH home) and the real WSL dsh, through the plugin's Host routes:
// list with Windows/WSL markers, disable and re-enable one WSL bundle.
//   ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" --expose-internals --import ./test/resolve-boot.mjs \
//     test/boot-wsl-plugins.mjs <profileDir> <distro> [bundle]
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro = 'Ubuntu-26.04', bundle = 'dsh-vscode-mode'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const step = (() => {
  const t0 = Date.now();
  return (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);
})();

const profile = loadProfileDirectory('dsh', projectDir, installAnchor);
reportSkippedBundles('dsh', profile);
const app = await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'desktop',
  resolvedProfile: { profile, installAnchor },
  patchFiles: [],
  args: ['--no-open', '--host', '127.0.0.1', '--port', '0'],
});
const { ctx } = app;
let failed = false;
try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  await wsl.connection(distro).connect();
  step('connected');
  const base = `http://127.0.0.1:${ctx.get('webServer').port}`;
  const login = await fetch(ctx.get('connection').authenticatedUrl(`${base}/`), { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  const post = async (path, value) => {
    const response = await fetch(`${base}/api/local-wsl-remote/${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(value) });
    const body = await response.json();
    assert.ok(response.ok, `${path}: ${body.error}`);
    return body;
  };

  const listed = await post('plugins', { distro });
  for (const plugin of listed.plugins) console.log(`   WSL ${plugin.name}@${plugin.version} ${plugin.where}${plugin.windows ? ` (Windows ${plugin.windows.version})` : ''}${plugin.enabled ? '' : ' disabled'}`);
  for (const plugin of listed.windowsOnly) console.log(`   Windows only ${plugin.name}@${plugin.version}`);
  assert.ok(listed.plugins.every((plugin) => ['wsl', 'both', 'both-differ'].includes(plugin.where)));
  const target = listed.plugins.find((plugin) => plugin.name === bundle);
  assert.ok(target, `${bundle} is installed in WSL`);
  assert.equal(target.enabled, true, `${bundle} starts enabled`);

  step(`disable ${bundle} in WSL`);
  const off = await post('plugins/change', { distro, action: 'enable', name: bundle, enabled: false });
  console.log('   result:', JSON.stringify(off.result).slice(0, 300));
  assert.equal(off.plugins.find((plugin) => plugin.name === bundle)?.enabled, false);

  step(`enable ${bundle} again`);
  const on = await post('plugins/change', { distro, action: 'enable', name: bundle, enabled: true });
  console.log('   result:', JSON.stringify(on.result).slice(0, 300));
  assert.equal(on.plugins.find((plugin) => plugin.name === bundle)?.enabled, true);

  // Install a Windows-only plugin into WSL as a background job, then remove it again.
  const candidate = listed.windowsOnly[0];
  if (candidate !== undefined) {
    const poll = async (id, until) => {
      for (let i = 0; i < 120; i++) {
        const { job } = await post('plugins/install-status', { id });
        if (until(job)) return job;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error('the installation did not reach the expected state');
    };
    step(`install ${candidate.installSpec} and cancel it at once`);
    const started = (await post('plugins/install', { distro, spec: candidate.installSpec })).job;
    assert.equal(started.status, 'running');
    const cancelled = (await post('plugins/install-cancel', { id: started.id })).job;
    console.log('   cancel request:', cancelled.cancelRequested);
    const afterCancel = await poll(started.id, (job) => job.status !== 'running');
    console.log(`   cancel outcome: ${afterCancel.status} (${afterCancel.result?.application ?? afterCancel.error})`);
    if (afterCancel.status === 'done') await post('plugins/change', { distro, action: 'remove', name: candidate.name });
    assert.ok(!(await post('plugins', { distro })).plugins.some((plugin) => plugin.name === candidate.name), 'cancelled: not installed');

    step(`install ${candidate.installSpec} to completion`);
    const job = (await post('plugins/install', { distro, spec: candidate.installSpec })).job;
    const done = await poll(job.id, (value) => value.status !== 'running');
    console.log(`   ${done.status} in ${Math.round(done.elapsedMs / 100) / 10}s, phase ${done.phase}, ${done.lines.length} log lines; last: ${done.lines.at(-1)}`);
    assert.equal(done.status, 'done', done.error ?? JSON.stringify(done.result));
    assert.ok(done.lines.some((line) => /Done in/.test(line)), 'pnpm output reached the job');
    const installed = await post('plugins', { distro });
    assert.ok(installed.plugins.some((plugin) => plugin.name === candidate.name), 'installed in WSL');

    step(`remove ${candidate.name} again`);
    const removed = await post('plugins/change', { distro, action: 'remove', name: candidate.name });
    assert.ok(!removed.plugins.some((plugin) => plugin.name === candidate.name), 'removed from WSL');
  }

  await wsl.connection(distro).disconnect();
  console.log('PLUGINS REHEARSAL PASSED');
} catch (error) {
  failed = true;
  console.error('PLUGINS REHEARSAL FAILED', error);
} finally {
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  process.exit(failed ? 1 : 0);
}
