import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function committedCheckout(t) {
  const dir = mkdtempSync(join(tmpdir(), 'release-stamp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  mkdirSync(join(dir, 'src/generated'), { recursive: true });
  copyFileSync(
    new URL('./stamp-release.mjs', import.meta.url),
    join(dir, 'scripts/stamp-release.mjs'),
  );
  writeFileSync(join(dir, 'src/generated/release.ts'), 'export const releaseCommit = null;\n');
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  const run = (env) =>
    spawnSync(process.execPath, ['scripts/stamp-release.mjs'], {
      cwd: dir,
      env: { ...process.env, GITHUB_ACTIONS: 'true', RELEASE_COMMIT: '', ...env },
      encoding: 'utf8',
    });
  const stamped = () => readFileSync(join(dir, 'src/generated/release.ts'), 'utf8');
  return { dir, sha, run, stamped };
}

test('CI stamps exactly a clean committed checkout and rejects dirty or mismatched sources', (t) => {
  const { dir, sha, run, stamped } = committedCheckout(t);
  assert.notEqual(run({ GITHUB_SHA: sha, GITHUB_ACTIONS: 'false' }).status, 0);
  assert.notEqual(run({ GITHUB_SHA: 'a'.repeat(40) }).status, 0);
  writeFileSync(join(dir, 'untracked'), 'local');
  assert.notEqual(run({ GITHUB_SHA: sha }).status, 0);
  rmSync(join(dir, 'untracked'));
  assert.equal(run({ GITHUB_SHA: sha }).status, 0);
  assert.match(stamped(), new RegExp(sha));
  assert.notEqual(run({ GITHUB_SHA: sha }).status, 0);
});

test('RELEASE_COMMIT replaces GITHUB_SHA as the commit that the checkout must match', (t) => {
  const { sha, run, stamped } = committedCheckout(t);
  const mergeCommit = 'a'.repeat(40);
  assert.notEqual(run({ GITHUB_SHA: sha, RELEASE_COMMIT: mergeCommit }).status, 0);
  const result = run({ GITHUB_SHA: mergeCommit, RELEASE_COMMIT: sha });
  assert.equal(result.status, 0, result.stderr);
  assert.match(stamped(), new RegExp(sha));
});
