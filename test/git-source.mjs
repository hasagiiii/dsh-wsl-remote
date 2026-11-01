/**
 * A local plugin folder the target cannot reach installs from git when its
 * commit is pushed: remote URL → install spec, the git inspection, and the
 * sync plan taking that route.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { gitInstallSpec, inspectGitSource } from '../lib/git-source.js';
import { PluginSyncRuns } from '../lib/plugin-sync.js';

const SHA = 'dbc31b3a4311b41ed287792dd4b9d149698d2609';

test('git remotes become pinned install specs other hosts can use', () => {
  for (const url of ['git@github.com:me/x.git', 'https://github.com/me/x', 'https://tok@github.com/me/x.git', 'ssh://git@github.com/me/x.git']) {
    assert.equal(gitInstallSpec(url, SHA), `github:me/x#${SHA}`, url);
  }
  assert.equal(gitInstallSpec('git@gitlab.example.com:team/x.git', SHA), `git+ssh://git@gitlab.example.com/team/x.git#${SHA}`);
  assert.equal(gitInstallSpec('https://user:secret@git.example.com/team/x.git', SHA), `git+https://git.example.com/team/x.git#${SHA}`, 'credentials in the URL are dropped');
  assert.equal(gitInstallSpec('ssh://git@git.example.com:2222/x.git', SHA), `git+ssh://git@git.example.com:2222/x.git#${SHA}`);
  assert.equal(gitInstallSpec('C:\\repos\\x', SHA), undefined, 'a local remote is no use to another host');
  assert.equal(gitInstallSpec('/srv/git/x.git', SHA), undefined);
  assert.equal(gitInstallSpec('git@github.com:me/x.git', 'main'), undefined, 'only a commit id is pinned');
});

/** A fake `git` answering from a table keyed by the arguments after `-C <dir>`. */
function fakeGit(answers) {
  const calls = [];
  const git = async (args) => {
    calls.push(args);
    const key = args.slice(2).join(' ');
    return key in answers ? { code: 0, stdout: `${answers[key]}\n` } : { code: 1, stdout: '' };
  };
  return { git, calls };
}

const pushed = {
  'rev-parse --show-toplevel': 'F:/proj/x',
  'rev-parse HEAD': SHA,
  'branch -r --contains HEAD --format=%(refname:short)': 'origin/HEAD\norigin/master',
  'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/master',
  'status --porcelain --untracked-files=no': '',
  'remote get-url origin': 'git@github.com:me/x.git',
};

test('a pushed checkout installs its HEAD commit; caveats are reported', async () => {
  const { git, calls } = fakeGit(pushed);
  assert.deepEqual(await inspectGitSource(git, 'F:\\proj\\x', { windows: true }), {
    ok: true, spec: `github:me/x#${SHA}`, commit: SHA, remote: 'github:me/x', dirty: false, unpushed: 0,
  });
  assert.ok(calls.every((args) => args[0] === '-C' && args[1] === 'F:\\proj\\x'), 'git runs in the source folder');

  const dirty = fakeGit({ ...pushed, 'status --porcelain --untracked-files=no': ' M index.js' });
  assert.equal((await inspectGitSource(dirty.git, 'F:/proj/x', { windows: true })).dirty, true);

  const base = 'a'.repeat(40);
  const ahead = fakeGit({ ...pushed, 'branch -r --contains HEAD --format=%(refname:short)': '', 'merge-base HEAD @{u}': base, [`rev-list --count ${base}..HEAD`]: '2' });
  const found = await inspectGitSource(ahead.git, 'F:/proj/x', { windows: true });
  assert.deepEqual([found.ok, found.commit, found.unpushed], [true, base, 2], 'unpushed commits: the newest pushed ancestor');
});

test('folders git cannot serve say why', async () => {
  assert.equal((await inspectGitSource(fakeGit({}).git, '/home/me/x')).reason, 'not-git');
  assert.equal((await inspectGitSource(fakeGit({ ...pushed, 'rev-parse --show-toplevel': 'F:/proj' }).git, 'F:/proj/x', { windows: true })).reason, 'git-subfolder');
  const local = { ...pushed, 'branch -r --contains HEAD --format=%(refname:short)': '' };
  delete local['rev-parse --abbrev-ref --symbolic-full-name @{u}'];
  assert.equal((await inspectGitSource(fakeGit(local).git, 'F:/proj/x', { windows: true })).reason, 'git-unpushed');
  assert.equal((await inspectGitSource(fakeGit({ ...pushed, 'remote get-url origin': '/srv/git/x.git' }).git, 'F:/proj/x', { windows: true })).reason, 'git-remote');
  assert.equal((await inspectGitSource(async () => { throw new Error('git: not found'); }, 'F:/proj/x')).reason, 'not-git', 'no git on the host');
});

test('the sync plan installs an unreachable local folder from its pushed commit', async () => {
  const bundles = {
    windows: [
      { name: 'guard', availability: 'profile', installed: true, version: '0.1.0', enabled: true, source: 'link:F:\\proj\\guard' },
      { name: 'plain', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'link:F:\\proj\\plain' },
      { name: 'later', availability: 'profile', installed: true, version: '1.0.0', enabled: true, source: 'link:F:\\proj\\later' },
    ],
    'ssh:dev': [],
  };
  const inspected = [];
  const runs = new PluginSyncRuns({
    list: async (host) => bundles[host ?? 'windows'],
    enable: async () => ({}),
    installs: {},
    gitSource: async (host, dir) => {
      inspected.push([host, dir]);
      if (dir.endsWith('guard')) return { ok: true, spec: `github:me/guard#${SHA}`, commit: SHA, remote: 'github:me/guard', dirty: true, unpushed: 0 };
      if (dir.endsWith('later')) return { ok: false, reason: 'git-unpushed' };
      return { ok: false, reason: 'not-git' };
    },
  });
  const plan = await runs.plan(null, 'ssh:dev');
  assert.deepEqual(inspected, [[null, 'F:\\proj\\guard'], [null, 'F:\\proj\\plain'], [null, 'F:\\proj\\later']], 'the folder is inspected on the source host');
  const [guard, plain, later] = plan.rows;
  assert.deepEqual([guard.state, guard.action, guard.spec, guard.git], ['missing', 'install', `github:me/guard#${SHA}`, { remote: 'github:me/guard', commit: SHA, dirty: true }]);
  assert.deepEqual([plain.state, plain.reason], ['unsupported', 'local-path'], 'not a git checkout: unchanged');
  assert.deepEqual([later.state, later.reason], ['unsupported', 'git-unpushed'], 'a git checkout that cannot be used says why');
});
