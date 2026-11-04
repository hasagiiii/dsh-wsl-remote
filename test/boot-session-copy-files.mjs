// Rehearsal: copying a session carries the workspace files it created or
// changed, Windows → WSL → Windows, through the real Desktop composition
// (throwaway DSH home) and a real WSL distribution.
//   ELECTRON_RUN_AS_NODE=1 DSH_HOME=<boot home> "DeepSeek Harness.exe" --expose-internals \
//     --import ./test/resolve-boot.mjs test/boot-session-copy-files.mjs <profileDir> [distro]
// The source session is a recorded history whose write/edit/present tool calls
// name real files in a scratch workspace (no model call).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { runWsl } from '../lib/wsl.js';
import { exportSession } from '../server/session-copy.mjs';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const t0 = Date.now();
const step = (name) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const gateway = ctx.get('typertGateway');
const peer = ctx.get('connection').browserPeer;
const rpc = async (endpoint, args = {}) => {
  const result = await gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
  if (!result.ok) throw new Error(`${endpoint}: ${result.error.code}: ${result.error.message}`);
  return result.value;
};
const wslRead = async (path) => {
  const result = await runWsl(['-d', distro, '-e', 'cat', path], { timeoutMs: 30000 });
  return result.code === 0 ? result.stdout : undefined;
};

const tag = randomUUID().slice(0, 8);
const winSrc = join(process.env.DSH_HOME, 'copy-test', `files-src-${tag}`);
const winBack = join(process.env.DSH_HOME, 'copy-test', `files-back-${tag}`);
const outside = join(process.env.DSH_HOME, 'copy-test', `outside-${tag}.txt`);
let wslHome;
const wslDst = () => `${wslHome}/.dsh-wsl-remote/copy-test/files-${tag}`;
const workspaceIds = [];
let failed = false;

/** One completed turn whose tool calls wrote these files (absolute, relative, edit, present, failed, outside). */
function history(root, at = join, outsidePath = outside) {
  const time = Date.now();
  const events = [];
  const add = (type, data, extra = {}) => events.push({ type, seq: events.length, time, data, ...extra });
  const call = (name, args, meta, isError = false) => {
    const callId = `call-${randomUUID()}`;
    add('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) });
    add('tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'ok' }], isError, id: randomUUID() }, ...(meta ? { meta } : {}) }, { surfaceOp: 'append', sourceEventSeqs: [events.length - 1] });
  };
  add('turn/start', { turn: 1 });
  add('user/message', { id: randomUUID(), role: 'user', content: [{ type: 'text', text: `make files ${tag}` }], source: { kind: 'user' } }, { surfaceOp: 'append' });
  add('step/start', { turn: 1, step: 1 });
  call('write', { file_path: at(root, 'src', 'main.js'), content: 'x' }, { operation: 'create', path: at(root, 'src', 'main.js'), diffs: [] });
  call('write', { file_path: 'notes.md', content: 'x' }, { operation: 'create', path: at(root, 'notes.md'), diffs: [] });
  call('edit', { file_path: at(root, 'README.md'), old_string: 'a', new_string: 'b' }, { path: at(root, 'README.md'), diffs: [{ path: at(root, 'README.md'), oldText: 'a', newText: 'b' }] });
  call('write', { file_path: at(root, 'failed.txt'), content: 'x' }, undefined, true);
  call('write', { file_path: outsidePath, content: 'x' }, { operation: 'create', path: outsidePath, diffs: [] });
  call('read', { file_path: at(root, 'README.md') }, { path: at(root, 'README.md') });
  add('deliverables/presented', { turn: 1, callId: 'present-1', files: [{ path: at(root, 'report.txt') }] });
  add('step/end', { turn: 1, step: 1 });
  add('turn/end', { turn: 1, reason: { kind: 'completed' } });
  return events;
}

try {
  const wsl = ctx.get('wslRemote');
  await wsl.ready;
  await wsl.connection(distro).connect();
  step(`connected ${distro}`);
  wslHome = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 30000 })).stdout.trim();
  await runWsl(['-d', distro, '-e', 'mkdir', '-p', wslDst()], { timeoutMs: 30000 });
  // The target already has README.md (kept unless overwrite) — and nothing else.
  await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf "target readme" > "$1/README.md"', 'sh', wslDst()], { timeoutMs: 30000 });

  // Source workspace on Windows: the files the history names.
  mkdirSync(join(winSrc, 'src'), { recursive: true });
  mkdirSync(winBack, { recursive: true });
  writeFileSync(join(winSrc, 'src', 'main.js'), `console.log("${tag}")\n`);
  writeFileSync(join(winSrc, 'notes.md'), `# notes ${tag}\n`);
  writeFileSync(join(winSrc, 'README.md'), `source readme ${tag}\n`);
  writeFileSync(join(winSrc, 'report.txt'), Buffer.from([0, 1, 2, 255, 254, 10]));
  writeFileSync(outside, 'outside the workspace');

  const winWs = (await rpc('workspace/create', { request: { path: winSrc } })).workspace.workspaceId;
  const backWs = (await rpc('workspace/create', { request: { path: winBack } })).workspace.workspaceId;
  const wslWs = (await rpc('workspace/create', { request: { path: `\\\\wsl.localhost\\${distro}${wslDst().replaceAll('/', '\\')}` } })).workspace.workspaceId;
  workspaceIds.push(winWs, backWs, wslWs);
  await sleep(2500);

  const source = `session-${randomUUID()}`;
  const seeded = history(winSrc);
  seeded.push({ type: 'session/end-seed', seq: seeded.length, time: seeded.at(-1).time, data: {} });
  await ctx.get('agents').create({ sessionId: source, seed: seeded, meta: { cwd: winSrc } });
  await ctx.get('workspaceRegistry').get(winWs).attachSession(source);

  step('plan: Windows session → WSL workspace (workspace files, and one from outside it)');
  const plan = await wsl.copySessionPlan(source, wslWs);
  console.log('   files:', plan.files.map((file) => `${file.relative}${file.external ? ' [external]' : ''}(${file.bytes}B, ${file.sources.join('+')})`).join(' '));
  console.log('   skipped:', plan.skipped.map((entry) => `${entry.path.split(/[\\/]/).pop()}:${entry.reason}`).join(' ') || '(none)');
  console.log('   existing in target:', JSON.stringify(plan.existing), 'sameHost', plan.sameHost, 'sameFolder', plan.sameFolder);
  const outsideRelative = plan.files.find((file) => file.external)?.relative;
  assert.ok(outsideRelative?.startsWith('.dsh-external/'), `the outside file is offered under .dsh-external: ${outsideRelative}`);
  assert.ok(outsideRelative.endsWith(`/copy-test/outside-${tag}.txt`), outsideRelative);
  assert.match(outsideRelative, /^\.dsh-external\/[A-Z]\//, 'the drive letter is the first folder');
  assert.deepEqual(plan.files.filter((file) => !file.external).map((file) => file.relative).sort(), ['README.md', 'notes.md', 'report.txt', 'src/main.js']);
  assert.ok(!plan.files.some((file) => file.relative.endsWith('failed.txt')), 'a failed write is not offered');
  assert.deepEqual(plan.existing, ['README.md']);
  assert.equal(plan.targetRoot, wslDst());
  assert.equal(plan.sameHost, false);
  assert.equal(plan.sameFolder, false);

  step('copy with all files (outside one included), existing README kept (no overwrite)');
  const toWsl = await wsl.copySession(source, wslWs, { files: plan.files.map((file) => file.relative), overwrite: false });
  console.log('   ', JSON.stringify(toWsl.files));
  assert.deepEqual(toWsl.files.written.sort(), [outsideRelative, 'notes.md', 'report.txt', 'src/main.js'].sort());
  assert.deepEqual(toWsl.files.kept, ['README.md']);
  assert.equal(await wslRead(`${wslDst()}/src/main.js`), `console.log("${tag}")\n`);
  assert.equal(await wslRead(`${wslDst()}/notes.md`), `# notes ${tag}\n`);
  assert.equal(await wslRead(`${wslDst()}/${outsideRelative}`), 'outside the workspace');
  assert.equal(await wslRead(`${wslDst()}/README.md`), 'target readme', 'existing file kept');
  const binary = await runWsl(['-d', distro, '-e', 'sh', '-c', 'od -An -tx1 "$1" | tr -d " \\n"', 'sh', `${wslDst()}/report.txt`], { timeoutMs: 30000 });
  assert.equal(binary.stdout.trim(), '000102fffe0a', 'binary bytes are exact');

  step('copy again with overwrite: README replaced');
  const again = await wsl.copySession(source, wslWs, { files: ['README.md'], overwrite: true });
  assert.deepEqual(again.files.written, ['README.md']);
  assert.equal(await wslRead(`${wslDst()}/README.md`), `source readme ${tag}\n`);

  step('Windows → another Windows workspace; the model is told which files came along, and where outside ones went');
  const sameHostPlan = await wsl.copySessionPlan(source, backWs);
  assert.equal(sameHostPlan.sameHost, true, 'same host: the outside file is already at its original path');
  const toBack = await wsl.copySession(source, backWs, { files: ['src/main.js', 'notes.md', outsideRelative] });
  assert.deepEqual(toBack.files.written.sort(), [outsideRelative, 'notes.md', 'src/main.js'].sort());
  assert.equal(readFileSync(join(winBack, 'src', 'main.js'), 'utf8'), `console.log("${tag}")\n`);
  assert.equal(readFileSync(join(winBack, ...outsideRelative.split('/')), 'utf8'), 'outside the workspace');
  {
    const resolved = await ctx.get('sessionController').agents.resolveAgent(toBack.sessionId);
    if ('error' in resolved) throw resolved.error;
    const pending = [...(resolved.agent.inbox.nextStep ?? []), ...(resolved.agent.inbox.nextTurn ?? [])];
    const text = pending.flatMap((message) => message.content ?? []).map((part) => part.text ?? '').join('\n');
    console.log('   notice:', text.slice(0, 700));
    assert.match(text, /copied to the same paths relative to the new working directory: (src\/main\.js, notes\.md|notes\.md, src\/main\.js)\./);
    assert.ok(text.includes(`${outside} → ${outsideRelative}`), 'the outside file is listed with its original path');
  }

  step('many files travel as one zip and land in their places');
  const many = Array.from({ length: 25 }, (_, index) => `gen/file-${String(index).padStart(2, '0')}.txt`);
  mkdirSync(join(winSrc, 'gen'), { recursive: true });
  const manyHistory = history(winSrc);
  const turnEnd = manyHistory.pop();
  const stepEnd = manyHistory.pop();
  for (const relative of many) {
    writeFileSync(join(winSrc, ...relative.split('/')), `generated ${relative} ${tag}\n`.repeat(50));
    const callId = `call-${randomUUID()}`;
    const time = turnEnd.time;
    manyHistory.push({ type: 'tool/call', seq: manyHistory.length, time, data: { turn: 1, step: 1, callId, name: 'write', arguments: JSON.stringify({ file_path: join(winSrc, ...relative.split('/')) }) } });
    manyHistory.push({ type: 'tool/result', seq: manyHistory.length, time, data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'ok' }], isError: false, id: randomUUID() }, meta: { path: join(winSrc, ...relative.split('/')) } }, surfaceOp: 'append', sourceEventSeqs: [manyHistory.length - 1] });
  }
  manyHistory.push({ ...stepEnd, seq: manyHistory.length }, { ...turnEnd, seq: manyHistory.length + 1 });
  manyHistory.push({ type: 'session/end-seed', seq: manyHistory.length, time: turnEnd.time, data: {} });
  const manySource = `session-${randomUUID()}`;
  await ctx.get('agents').create({ sessionId: manySource, seed: manyHistory, meta: { cwd: winSrc } });
  await ctx.get('workspaceRegistry').get(winWs).attachSession(manySource);
  const bundle = await exportSession(ctx, manySource, { files: many });
  assert.equal(typeof bundle.workspaceFiles.zip, 'string', 'more than 20 files are sent as a zip');
  assert.equal(bundle.workspaceFiles.count, 25);
  const plainSize = many.reduce((sum, relative) => sum + `generated ${relative} ${tag}\n`.repeat(50).length, 0);
  console.log(`   zip: ${Buffer.from(bundle.workspaceFiles.zip, 'base64').length} bytes for ${plainSize} bytes of files`);
  const viaZip = await wsl.copySession(manySource, wslWs, { files: many });
  assert.equal(viaZip.files.written.length, 25);
  assert.equal(await wslRead(`${wslDst()}/gen/file-07.txt`), `generated gen/file-07.txt ${tag}\n`.repeat(50));
  const listed = await runWsl(['-d', distro, '-e', 'sh', '-c', 'ls "$1/gen" | wc -l', 'sh', wslDst()], { timeoutMs: 30000 });
  assert.equal(listed.stdout.trim(), '25');

  step('a WSL session that wrote Linux files → Windows workspace, with its files');
  // A WSL session whose own history wrote files under its Linux workspace (the shape a WSL agent records).
  const linuxHistory = history(wslDst(), posix.join, '/tmp/outside.txt');
  const made = await wsl.connection(distro).importSession({ format: 1, cwd: wslDst(), events: linuxHistory, images: [], files: [] }, { workspaceId: wsl.bridge.merged().owners.get(wslWs).id });
  wsl.bridge.noteSession(made.sessionId, distro);
  await runWsl(['-d', distro, '-e', 'sh', '-c', 'mkdir -p "$1/src" && printf "linux main" > "$1/src/main.js" && printf "linux notes" > "$1/notes.md" && printf "linux report" > "$1/report.txt" && printf "linux tmp" > /tmp/outside.txt', 'sh', wslDst()], { timeoutMs: 30000 });
  const linuxPlan = await wsl.copySessionPlan(made.sessionId, backWs);
  console.log('   WSL session offers:', linuxPlan.files.map((file) => file.relative).join(' '), '| existing in target:', JSON.stringify(linuxPlan.existing));
  assert.deepEqual(linuxPlan.files.map((file) => file.relative).sort(), ['.dsh-external/tmp/outside.txt', 'README.md', 'notes.md', 'report.txt', 'src/main.js']);
  assert.deepEqual(linuxPlan.existing.sort(), ['notes.md', 'src/main.js'], 'the earlier copy put these two there');
  const toWin = await wsl.copySession(made.sessionId, backWs, { files: ['report.txt', 'notes.md', '.dsh-external/tmp/outside.txt'], overwrite: false });
  assert.deepEqual(toWin.files, { written: ['report.txt', '.dsh-external/tmp/outside.txt'], kept: ['notes.md'] });
  assert.equal(readFileSync(join(winBack, 'report.txt'), 'utf8'), 'linux report');
  assert.equal(readFileSync(join(winBack, '.dsh-external', 'tmp', 'outside.txt'), 'utf8'), 'linux tmp');
  assert.equal(readFileSync(join(winBack, 'notes.md'), 'utf8'), `# notes ${tag}\n`, 'kept the existing Windows file');

  step('WSL copy → Windows: its history was rewritten to its Linux workspace, so the files it now names there are offered');
  const backPlan = await wsl.copySessionPlan(toWsl.sessionId, backWs);
  console.log('   WSL copy offers:', backPlan.files.map((file) => file.relative).join(' ') || '(none)', '| skipped:', backPlan.skipped.map((entry) => entry.reason).join(',') || '(none)');
  // The copy's history names /home/.../files-<tag>/..., which exist in the WSL workspace (the first copy put them there).
  assert.ok(backPlan.files.some((file) => file.relative === 'src/main.js' && !file.external), 'workspace files are found under the rewritten paths');
  assert.ok(backPlan.files.some((file) => file.relative === outsideRelative && !file.external), 'the outside file now lives inside the copy\'s workspace');

  step('copy without files is still a plain session copy');
  const plain = await wsl.copySession(source, backWs, { files: [] });
  assert.deepEqual(plain.files, { written: [], kept: [] });
  const local = await exportSession(ctx, plain.sessionId);
  assert.equal(local.cwd, winBack);

  step('same folder: nothing to copy');
  const same = await wsl.copySessionPlan(source, winWs);
  assert.equal(same.sameFolder, true);

  step('a relative path that would leave the workspace is refused');
  await assert.rejects(wsl.copySession(source, wslWs, { files: ['../escape.txt'] }), /not a file this session changed/);
  console.log('SESSION FILE COPY PASSED');
} catch (error) {
  failed = true;
  console.error('SESSION FILE COPY FAILED', error);
} finally {
  for (const id of workspaceIds) await rpc('workspace/delete', { request: { workspaceId: id } }).catch(() => {});
  if (wslHome) await runWsl(['-d', distro, '-e', 'rm', '-rf', wslDst(), '/tmp/outside.txt'], { timeoutMs: 30000 }).catch(() => {});
  const settled = await Promise.race([app.shutdown.shutdown(0).then(() => 'clean', (error) => `error: ${error.message}`), new Promise((r) => setTimeout(() => r('timeout'), 15000))]);
  step(`shutdown ${settled}`);
  for (const path of [winSrc, winBack, outside]) rmSync(path, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
