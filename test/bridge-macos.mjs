import assert from 'node:assert/strict';
import test from 'node:test';
import { WslBridge } from '../lib/bridge/bridge.js';
import { WINDOWS, emptyWorkspaceState } from '../lib/bridge/merge.js';

function fixture(platform, host = 'ssh:dev') {
  const workspace = (workspaceId) => ({ workspaceId, path: '/tmp/project', sessionIds: [], createdAt: '2026-01-01', updatedAt: '2026-01-01' });
  const bridge = new WslBridge({
    platform,
    logger: {},
    hosts: { distros: () => [host], connected: () => true, loadOrder: () => [] },
    windows: { knows: async () => false, workspaces: () => ({ ...emptyWorkspaceState(), items: [workspace('local-workspace')] }) },
  });
  bridge.workspaceStates.set(host, { ...emptyWorkspaceState(), items: [workspace('remote-workspace')] });
  bridge.sessionHosts.set('local-session', WINDOWS);
  bridge.sessionHosts.set('remote-session', host);
  const requests = [];
  bridge.client = async (owner) => ({ fetch: async (path) => { requests.push({ owner, path }); return 'remote'; } });
  const fetchFile = (path, sessionId) => {
    const url = new URL('http://localhost/api/file');
    url.searchParams.set('path', path);
    if (sessionId) url.searchParams.set('sessionId', sessionId);
    return bridge.fetchRoute('/api/file', new Request(url), async () => 'local');
  };
  return { bridge, fetchFile, requests };
}

for (const platform of ['darwin', 'linux']) {
  test(`${platform}: bare local paths stay local with one SSH host, including colliding workspace paths`, async () => {
    const { bridge, fetchFile, requests } = fixture(platform);
    for (const path of ['/Users/me/project', '/tmp/project/file.txt']) {
      assert.equal((await bridge.route('session/create', { request: { cwd: path } })).host, WINDOWS);
      assert.equal(await fetchFile(path), 'local');
    }
    assert.deepEqual(requests, []);
  });

  test(`${platform}: explicit workspace and session owners still route to the correct host`, async () => {
    const { bridge, fetchFile, requests } = fixture(platform);
    for (const [workspaceId, host] of [['local-workspace', WINDOWS], ['remote-workspace', 'ssh:dev']]) {
      assert.equal((await bridge.route('session/create', { request: { workspaceId, cwd: '/tmp/project' } })).host, host);
    }
    assert.equal(await fetchFile('/tmp/project/file.txt', 'local-session'), 'local');
    assert.equal(await fetchFile('/tmp/project/file.txt', 'remote-session'), 'remote');
    assert.deepEqual(requests, [{ owner: 'ssh:dev', path: 'api/file?path=%2Ftmp%2Fproject%2Ffile.txt&sessionId=remote-session' }]);
  });

  test(`${platform}: explicit SSH picker addresses continue to route remotely`, async () => {
    const { bridge, fetchFile, requests } = fixture(platform);
    assert.equal((await bridge.route('workspace/create', { request: { path: 'ssh://dev/tmp/project' } })).host, 'ssh:dev');
    assert.equal(await fetchFile('ssh://dev/tmp/project/file.txt'), 'remote');
    assert.deepEqual(requests, [{ owner: 'ssh:dev', path: 'api/file?path=%2Ftmp%2Fproject%2Ffile.txt' }]);
  });
}

test('Windows preserves remote path inference for WSL and SSH', async () => {
  for (const host of ['Ubuntu', 'ssh:dev']) {
    const { bridge, fetchFile } = fixture('win32', host);
    for (const path of ['/tmp/project/file.txt', '/home/me/other']) {
      assert.equal((await bridge.route('session/create', { request: { cwd: path } })).host, host);
      assert.equal(await fetchFile(path), 'remote');
    }
    assert.equal((await bridge.route('session/create', { request: { cwd: 'C:\\work' } })).host, WINDOWS);
    assert.equal(await fetchFile('C:\\work\\file.txt'), 'local');
  }
});

test('bridge defaults to the actual local platform', () => {
  assert.equal(fixture().bridge.platform, process.platform);
});
