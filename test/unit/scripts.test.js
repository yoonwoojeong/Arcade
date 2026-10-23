import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkRelease } from '../../scripts/check-release.js';
import { missingSignoff, readCommits } from '../../scripts/check-dco.js';

const pluginJson = { version: '0.1.0' };
const changelog = '# Changelog\n\n## [0.1.0] - 2026-10-23\n\n- First release\n';

test('checkRelease passes when tag, version and changelog agree', () => {
  assert.deepEqual(checkRelease({ pluginJson, changelog, tag: 'v0.1.0' }), []);
});

test('checkRelease reports a tag that does not match the version', () => {
  const errors = checkRelease({ pluginJson, changelog, tag: 'v0.2.0' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /v0\.1\.0/);
});

test('checkRelease uses the first versioned heading, skipping Unreleased', () => {
  const text = '# Changelog\n\n## [Unreleased]\n\n- wip\n\n## [0.1.0] - 2026-10-23\n\n- x\n';
  assert.deepEqual(checkRelease({ pluginJson, changelog: text, tag: 'v0.1.0' }), []);
});

test('checkRelease reports a changelog whose top version differs', () => {
  const text = '## [Unreleased]\n\n## [0.0.9] - 2026-01-01\n';
  const errors = checkRelease({ pluginJson, changelog: text, tag: 'v0.1.0' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /0\.0\.9/);
});

test('checkRelease reports a changelog with no versioned heading', () => {
  const errors = checkRelease({ pluginJson, changelog: '# Changelog\n', tag: 'v0.1.0' });
  assert.equal(errors.length, 1);
});

const commit = (sha, message, authorEmail = 'noreply@anthropic.com') => ({
  sha,
  message,
  authorEmail,
});

test('missingSignoff returns SHAs lacking a sign-off', () => {
  const commits = [commit('a1', 'feat: x\n\nbody')];
  assert.deepEqual(missingSignoff(commits), ['a1']);
});

test('missingSignoff accepts a sign-off matching the author email, any name, any case', () => {
  const commits = [
    commit('a1', 'feat: x\n\nSigned-off-by: Claude <noreply@anthropic.com>\n'),
    commit('a2', 'feat: y\n\nSigned-off-by: Someone Else <NoReply@Anthropic.com>'),
  ];
  assert.deepEqual(missingSignoff(commits), []);
});

test('missingSignoff rejects a sign-off with a different email', () => {
  const commits = [commit('a1', 'feat: x\n\nSigned-off-by: Claude <other@example.com>\n')];
  assert.deepEqual(missingSignoff(commits), ['a1']);
});

test('readCommits ignores merge commits and reports unsigned regular commits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-dco-'));
  try {
    const git = (...args) => {
      const r = spawnSync(
        'git',
        [
          '-c',
          'user.name=T',
          '-c',
          'user.email=t@example.com',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: dir, encoding: 'utf8' },
      );
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const write = (name) => fs.writeFileSync(path.join(dir, name), name);
    git('init', '-q', '-b', 'main');
    write('a');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
    write('b');
    git('add', '.');
    git('commit', '-q', '-s', '-m', 'signed');
    git('checkout', '-q', 'main');
    write('c');
    git('add', '.');
    git('commit', '-q', '-m', 'main moves on');
    git('checkout', '-q', 'feature');
    git('merge', '-q', '--no-ff', '-m', 'Merge main into feature', 'main');
    write('d');
    git('add', '.');
    git('commit', '-q', '-m', 'unsigned');
    const unsignedSha = git('rev-parse', 'HEAD');

    const commits = readCommits('main', 'HEAD', dir);
    assert.equal(commits.length, 2);
    assert.ok(commits.every((c) => c.authorEmail === 't@example.com'));
    assert.deepEqual(missingSignoff(commits), [unsignedSha]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
