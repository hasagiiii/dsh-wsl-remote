// Like serve-desktop.mjs, plus: two scratch workspaces (Windows, WSL) and one
// Windows session with completed turns, so the "Copy to workspace" UI can be
// driven in a browser. Prints SERVE READY <url> and the ids, then keeps running.
//   ELECTRON_RUN_AS_NODE=1 DSH_HOME=<boot home> "DeepSeek Harness.exe" --expose-internals \
//     --import ./test/resolve-boot.mjs test/serve-session-copy.mjs <profileDir> [distro]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadLayeredEnv, loadProfileDirectory, reportSkippedBundles } from '@deepseek-ai/dsh-app-boot';
import { runProfile } from '@deepseek-ai/dsh/profile-boot';
import { runWsl } from '../lib/wsl.js';

const runtimeDir = process.env.DSH_ROOT ?? 'D:\\ds_harness\\resources\\app.asar\\dsh';
const [projectDir, distro = 'Ubuntu-26.04'] = process.argv.slice(2);
const installAnchor = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
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
const wsl = ctx.get('wslRemote');
await wsl.ready;
await wsl.connection(distro).connect();
const gateway = ctx.get('typertGateway');
const peer = ctx.get('connection').browserPeer;
const rpc = async (endpoint, args = {}) => {
  const result = await gateway.dispatchRpc(endpoint, { args }, new AbortController().signal, peer);
  if (!result.ok) throw new Error(`${endpoint}: ${result.error.message}`);
  return result.value;
};
const winDir = join(process.env.DSH_HOME, 'copy-ui', 'windows-project');
mkdirSync(winDir, { recursive: true });
const wslHome = (await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 30000 })).stdout.trim();
const wslDir = `${wslHome}/.dsh-wsl-remote/copy-ui/linux-project`;
await runWsl(['-d', distro, '-e', 'mkdir', '-p', wslDir], { timeoutMs: 30000 });
const winWs = (await rpc('workspace/create', { request: { path: winDir } })).workspace.workspaceId;
const wslWs = (await rpc('workspace/create', { request: { path: `\\\\wsl.localhost\\${distro}${wslDir.replaceAll('/', '\\')}` } })).workspace.workspaceId;

const time = Date.now();
const events = [];
const add = (type, data, extra = {}) => events.push({ type, seq: events.length, time, data, ...extra });
// One turn that wrote two files and edited a third (the target gets a README of its own, to show "exists").
const call = (name, path) => {
  const callId = `call-${randomUUID()}`;
  add('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify({ file_path: path }) });
  add('tool/result', { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'ok' }], isError: false, id: randomUUID() }, meta: { path } }, { surfaceOp: 'append', sourceEventSeqs: [events.length - 1] });
};
mkdirSync(join(winDir, 'src'), { recursive: true });
writeFileSync(join(winDir, 'src', 'app.js'), 'console.log("hello from windows")\n');
writeFileSync(join(winDir, 'NOTES.md'), '# notes\n');
writeFileSync(join(winDir, 'README.md'), 'windows readme\n');
await runWsl(['-d', distro, '-e', 'sh', '-c', 'printf "linux readme" > "$1/README.md"', 'sh', wslDir], { timeoutMs: 30000 });
add('turn/start', { turn: 1 });
add('user/message', { id: randomUUID(), role: 'user', content: [{ type: 'text', text: 'Copy me to WSL please' }], source: { kind: 'user' } }, { surfaceOp: 'append' });
add('step/start', { turn: 1, step: 1 });
call('write', join(winDir, 'src', 'app.js'));
call('write', join(winDir, 'NOTES.md'));
call('edit', join(winDir, 'README.md'));
// Files outside the workspace (copied into .dsh-external at the target), with long paths, and one that is gone.
const outsideDir = join(process.env.DSH_HOME, 'outside-the-workspace', 'deeply', 'nested', 'folder', 'structure');
mkdirSync(outsideDir, { recursive: true });
for (const name of ['a-very-long-generated-report-name-for-the-quarterly-review-final-v3.md', 'another-extremely-long-file-name-that-keeps-going-and-going.txt']) {
  writeFileSync(join(outsideDir, name), `outside file ${name}\n`);
  call('write', join(outsideDir, name));
}
call('write', join(winDir, 'deleted-after-the-turn', 'some-file-that-no-longer-exists-on-disk.log'));
// Enough generated files that the selection passes 20 and travels as a zip.
mkdirSync(join(winDir, 'gen'), { recursive: true });
for (let index = 0; index < 20; index++) {
  const path = join(winDir, 'gen', `part-${String(index).padStart(2, '0')}.txt`);
  writeFileSync(path, `generated part ${index}\n`.repeat(20));
  call('write', path);
}
add('step/end', { turn: 1, step: 1 });
add('turn/end', { turn: 1, reason: { kind: 'completed' } });
add('session/end-seed', {});
const sessionId = `session-${randomUUID()}`;
const handle = await ctx.get('agents').create({ sessionId, seed: events, meta: { cwd: winDir } });
ctx.get('sessionTitle')?.rename?.(ctx.get('sessions').get(sessionId) ?? handle.agent.session, 'Copy UI source');
await ctx.get('workspaceRegistry').get(winWs).attachSession(sessionId);
const url = ctx.get('connection').authenticatedUrl(`http://127.0.0.1:${ctx.get('webServer').port}/`);
console.log(`SERVE READY ${url}`);
console.log(JSON.stringify({ sessionId, winWs, wslWs, winDir, wslDir }));
