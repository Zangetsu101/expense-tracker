import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const script = new URL('./release-notes.mjs', import.meta.url).pathname;
const fingerprint = '0123456789abcdef0123456789abcdef01234567';

function repository(t) {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'tag.gpgSign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8' },
    ).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'app.json'), '{ "expo": { "version": "0.3.0" } }\n');
  const commit = (message) => {
    writeFileSync(join(dir, 'change'), message);
    git('add', '.');
    git('commit', '-qm', message, '--no-gpg-sign');
    return git('rev-parse', 'HEAD');
  };
  // A merge of a PR as GitHub writes it: the PR title is the body of the merge commit.
  const mergePullRequest = (number, branch, title, commits) => {
    git('checkout', '-qb', branch);
    for (const message of commits) commit(message);
    git('checkout', '-q', 'main');
    git(
      'merge',
      '-q',
      '--no-ff',
      '--no-gpg-sign',
      '-m',
      `Merge pull request #${number} from owner/${branch}`,
      '-m',
      title,
      branch,
    );
    return git('rev-parse', 'HEAD');
  };
  const apk = (content) => {
    const path = join(dir, 'app.apk');
    rmSync(path, { force: true });
    writeFileSync(join(dir, 'classes.dex'), 'dex');
    execFileSync('zip', ['-q', path, 'classes.dex'], { cwd: dir });
    if (content !== undefined) {
      execFileSync('mkdir', ['-p', join(dir, 'assets')]);
      writeFileSync(join(dir, 'assets/fingerprint'), content);
      execFileSync('zip', ['-q', path, 'assets/fingerprint'], { cwd: dir });
    }
    return path;
  };
  const notes = (apkPath, env = {}) =>
    spawnSync(process.execPath, [script, apkPath], {
      cwd: dir,
      env: { ...process.env, GITHUB_REPOSITORY: '', ...env },
      encoding: 'utf8',
    });
  return { dir, git, commit, mergePullRequest, apk, notes };
}

test('the notes list the PR titles and commits on main since the last release tag', (t) => {
  const { git, commit, mergePullRequest, apk, notes } = repository(t);
  commit('first commit');
  git('tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  commit('fix: a change that v0.1.0 does not have');
  git('tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
  // A tag on a branch that the release does not contain is not the last release.
  git('checkout', '-qb', 'other');
  commit('other work');
  git('tag', '-a', 'v9.0.0', '-m', 'v9.0.0');
  git('checkout', '-q', 'main');
  mergePullRequest(4, 'feature', 'feat: add a feature', ['wip 1', 'wip 2']);
  const direct = commit('docs: a direct commit');
  git('tag', 'not-a-release');
  const head = mergePullRequest(5, 'fix', 'fix: repair a bug', ['wip 3']);

  const result = notes(apk(undefined), { GITHUB_REPOSITORY: 'owner/repo' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    `Signed ARM64 Android APK built from commit ${head}.

Runtime version: 0.3.0 (app version). An OTA update reaches this APK only when it has the same runtime version.

## Changes since v0.2.0

- fix: repair a bug (#5)
- docs: a direct commit (${direct.slice(0, 7)})
- feat: add a feature (#4)

All commits: https://github.com/owner/repo/compare/v0.2.0...${head}

Back up app data, install the APK over the existing app, and test before publishing this draft.
Supports ARM64 Android devices only. The .sha256 file contains the APK checksum.
`,
  );
});

test('the notes show the fingerprint from the APK as the runtime version', (t) => {
  const { commit, apk, notes } = repository(t);
  commit('first commit');
  const result = notes(apk(`${fingerprint}\n`));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Runtime version: ${fingerprint} \\(fingerprint\\)\\.`));
});

test('a first release lists all changes on main and has no compare link', (t) => {
  const { commit, apk, notes } = repository(t);
  commit('first commit');
  commit('second commit');
  const result = notes(apk(undefined), { GITHUB_REPOSITORY: 'owner/repo' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /## Changes\n\nNo earlier release tag exists\.\n\n- second commit .*\n- first commit /,
  );
  assert.doesNotMatch(result.stdout, /compare/);
});

test('a tag on the release commit itself is not the last release', (t) => {
  const { git, commit, apk, notes } = repository(t);
  commit('first commit');
  git('tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  commit('fix: the change of the release');
  git('tag', '-a', 'v0.2.0', '-m', 'v0.2.0');
  const result = notes(apk(undefined));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## Changes since v0\.1\.0\n\n- fix: the change of the release /);
});

test('the notes fail for a shallow checkout, a bad fingerprint or a missing APK', (t) => {
  const { dir, git, commit, apk, notes } = repository(t);
  commit('first commit');
  commit('second commit');
  assert.match(notes(apk('not a hash')).stderr, /fingerprint/);
  assert.notEqual(notes(apk('not a hash')).status, 0);
  const missing = notes(join(dir, 'missing.apk'));
  assert.notEqual(missing.status, 0);
  assert.notEqual(notes().status, 0);

  const shallow = join(dir, 'shallow');
  git('clone', '-q', '--depth', '1', `file://${dir}`, shallow);
  const result = spawnSync(process.execPath, [script, apk(undefined)], {
    cwd: shallow,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /shallow/);
});
