/**
 * SSH remote hosts: argv building, picker addresses, ~/.ssh/config aliases,
 * the login-shell preamble before mux frames, settings and routing.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { SSH_OPTIONS, commandFor, hostKind, hostLabel, isHostId, isSshDest, isSshHost, parseSshConfig, shQuote, sshDestOf, sshHint, sshTarget } from '../lib/transport.js';
import { fromRemoteAddress, toRemoteAddress } from '../lib/linux-fs.js';
import { MUX_MARKER, skipPreamble } from '../lib/remote.js';
import { encodeFrame, createDecoder, FRAME } from '../lib/mux.js';
import { writeSettings } from '../lib/state.js';
import { toHostArgs } from '../lib/bridge/merge.js';
import { comparePlugins, wslInstallSpec } from '../lib/plugins.js';
import { createModelPluginService } from '../lib/model-plugins.js';

test('plugins: Windows local folders do not install on an SSH server', async () => {
  assert.equal(wslInstallSpec({ name: 'x', source: 'link:F:/proj/x' }, 'ssh'), 'x');
  assert.equal(wslInstallSpec({ name: 'x', source: 'x@^1' }, 'ssh'), 'x@^1');
  assert.equal(wslInstallSpec({ name: 'x', source: 'link:F:/proj/x' }), 'link:/mnt/f/proj/x');
  const { windowsOnly } = comparePlugins([], [{ name: 'y', availability: 'profile', installed: true, source: 'link:F:/y' }], 'ssh');
  assert.equal(windowsOnly[0].installSpec, 'y');
  const provider = { provider: 'p', settingsNs: 'row' };
  const bundle = { name: '@x/p', source: 'link:F:/p', enabled: true, rows: [{ rowId: 'row' }] };
  const service = createModelPluginService({ call: async (host, endpoint) => ({ ok: true, value: endpoint === 'llm/listConfigurableProviders' ? [provider] : host === null ? [bundle] : [] }) });
  const plan = await service.plan({ distro: 'ssh:dev', direction: 'windows-to-wsl', provider: 'p', settingsNs: 'row' });
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.reason, 'unsupported-source-platform');
});

test('SSH destinations and host ids', () => {
  for (const ok of ['dev', 'me@dev.example.com', 'me@10.0.0.2:2222', 'host_1', '9.134.54.232']) assert.ok(isSshDest(ok), ok);
  for (const bad of ['', '-oProxyCommand=x', 'me@', '@host', 'a b', 'host:0', 'host:70000', 'h;rm', "h'x", 'ssh://h']) assert.ok(!isSshDest(bad), bad);
  assert.ok(isSshHost('ssh:me@dev'));
  assert.ok(!isSshHost('Ubuntu'));
  assert.ok(isHostId('Ubuntu-26.04') && isHostId('ssh:dev:2222'));
  assert.equal(hostKind('ssh:dev'), 'ssh');
  assert.equal(hostKind('Ubuntu'), 'wsl');
  assert.equal(sshDestOf('ssh:me@dev'), 'me@dev');
  assert.equal(hostLabel('ssh:me@dev'), 'SSH: me@dev');
  assert.equal(hostLabel('Ubuntu'), 'WSL: Ubuntu');
  assert.deepEqual(sshTarget('me@dev:2222'), { host: 'me@dev', port: 2222 });
  assert.deepEqual(sshTarget('dev'), { host: 'dev', port: undefined });
});

test('one Linux argv runs over wsl.exe or ssh without a Windows shell', () => {
  const wsl = commandFor('Ubuntu', ['sh', '-c', 'echo "$HOME"']);
  assert.match(wsl.file, /wsl\.exe$/i);
  assert.deepEqual(wsl.args, ['-d', 'Ubuntu', '--cd', '~', '-e', 'sh', '-c', 'echo "$HOME"']);

  const ssh = commandFor('ssh:me@dev:2222', ['sh', '-c', "echo it's", 'sh', '/home/a b']);
  assert.match(ssh.file, /ssh(\.exe)?$/i);
  assert.deepEqual(ssh.args.slice(0, SSH_OPTIONS.length), SSH_OPTIONS);
  assert.ok(ssh.args.includes('BatchMode=yes'), 'never prompts: the window cannot answer');
  assert.deepEqual(ssh.args.slice(SSH_OPTIONS.length), ['-p', '2222', '--', 'me@dev', `'sh' '-c' 'echo it'\\''s' 'sh' '/home/a b'`]);
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
  assert.throws(() => commandFor('not a host!', ['true']));
});

test('picker addresses name the host; workspaces keep the Linux path', () => {
  assert.equal(toRemoteAddress('ssh:me@dev', '/home/me/repo/'), 'ssh://me@dev/home/me/repo');
  assert.deepEqual(fromRemoteAddress('ssh://me@dev:2222/home/me/x/../repo'), { distro: 'ssh:me@dev:2222', path: '/home/me/repo' });
  assert.deepEqual(fromRemoteAddress('ssh://dev'), { distro: 'ssh:dev', path: '/' });
  assert.equal(fromRemoteAddress('ssh://-oProxyCommand=x/home'), undefined);
  assert.deepEqual(fromRemoteAddress('\\\\wsl.localhost\\Ubuntu\\home\\me'), { distro: 'Ubuntu', path: '/home/me' });
  assert.equal(toRemoteAddress('Ubuntu', '/home/me'), '\\\\wsl.localhost\\Ubuntu\\home\\me');
  assert.equal(fromRemoteAddress('C:\\work'), undefined);
  const args = toHostArgs('workspace/create', { request: { path: 'ssh://dev/srv/app' } }, () => undefined);
  assert.deepEqual(args, { request: { path: '/srv/app' } });
});

test('~/.ssh/config aliases: concrete hosts only', () => {
  const text = [
    'Host 9.134.54.232',
    '  HostName 9.134.54.232',
    '  Port 36000',
    'Host dev prod # two aliases',
    'Host *.internal !bad',
    'Host=jump',
    'Match host x',
    'host dev',
  ].join('\n');
  assert.deepEqual(parseSshConfig(text), ['9.134.54.232', 'dev', 'prod', 'jump']);
  assert.deepEqual(parseSshConfig(''), []);
});

test('ssh failures are explained', () => {
  assert.equal(sshHint('me@dev: Permission denied (publickey).'), 'auth');
  assert.equal(sshHint('Host key verification failed.'), 'host-key');
  assert.equal(sshHint('ssh: Could not resolve hostname nope'), 'network');
  assert.equal(sshHint('something else'), undefined);
});

test('login-shell output before the mux marker is dropped, frames pass intact', async () => {
  const input = new PassThrough();
  const output = input.pipe(skipPreamble());
  const frames = [];
  const decode = createDecoder((type, channel, payload) => frames.push([type, channel, payload.toString()]));
  output.on('data', decode);
  const frame = encodeFrame(FRAME.DATA, 0, '{"method":"hello"}');
  const stream = Buffer.concat([Buffer.from('Welcome to Ubuntu\nLast login: today\n'), Buffer.from(MUX_MARKER), frame, encodeFrame(FRAME.DATA, 3, 'x')]);
  // Split mid-marker and mid-frame.
  for (let i = 0; i < stream.length; i += 7) input.write(stream.subarray(i, i + 7));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(frames, [[FRAME.DATA, 0, '{"method":"hello"}'], [FRAME.DATA, 3, 'x']]);
});

test('settings keep SSH hosts and their ids', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'wslr-ssh-')), 'wsl-remote.json');
  const value = writeSettings({
    sshHosts: ['dev', 'me@box:2222', 'bad host', 'dev'],
    autoConnect: ['Ubuntu', 'ssh:dev', 'ssh:bad host'],
    ports: { 'ssh:dev': 41000, 'ssh:-x': 41001 },
  }, file);
  assert.deepEqual(value.sshHosts, ['dev', 'me@box:2222']);
  assert.deepEqual(value.autoConnect, ['Ubuntu', 'ssh:dev']);
  assert.deepEqual(value.ports, { 'ssh:dev': 41000 });
});

test('bridge: an ssh:// picker address creates the workspace on that host', async () => {
  const { WslBridge } = await import('../lib/bridge/bridge.js');
  const bridge = new WslBridge({
    logger: { info() {}, warn() {} },
    hosts: { distros: () => ['Ubuntu', 'ssh:dev'], connected: () => true, url: () => undefined, ensure: async () => {}, subscribe: () => () => {}, loadOrder: () => [], saveOrder() {} },
    windows: { knows: async () => false, workspaces: () => undefined },
  });
  assert.equal((await bridge.route('workspace/create', { request: { path: 'ssh://dev/srv/app' } })).host, 'ssh:dev');
  assert.equal((await bridge.route('workspace/create', { request: { path: 'ssh://other/srv/app' } })).host, 'windows', 'an unknown SSH host is not guessed');
  assert.equal(bridge.linuxArgs('ssh:dev', { request: { path: 'ssh://dev/srv/app' } }).request.path, '/srv/app');
  // "Open in app" turns WSL paths into \\wsl.localhost; SSH files have no Windows path.
  bridge.workspaceStates.set('ssh:dev', { items: [{ workspaceId: 'w1', path: '/srv/app', sessionIds: [] }], archivedSessionIds: [], pinnedSessionIds: [] });
  const open = await bridge.route('session/openWorkspacePath', { request: { path: '/srv/app/x.txt' } });
  assert.equal(open.args.request.path, '/srv/app/x.txt');
});
