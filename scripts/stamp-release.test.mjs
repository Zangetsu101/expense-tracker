import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('CI stamps exactly a clean committed checkout and rejects dirty or mismatched sources', (t) => {
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
  const run = (env = {}) =>
    spawnSync(process.execPath, ['scripts/stamp-release.mjs'], {
      cwd: dir,
      env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_SHA: sha, ...env },
      encoding: 'utf8',
    });
  assert.notEqual(run({ GITHUB_ACTIONS: 'false' }).status, 0);
  assert.notEqual(run({ GITHUB_SHA: 'a'.repeat(40) }).status, 0);
  writeFileSync(join(dir, 'untracked'), 'local');
  assert.notEqual(run().status, 0);
  rmSync(join(dir, 'untracked'));
  assert.equal(run().status, 0);
  assert.match(readFileSync(join(dir, 'src/generated/release.ts'), 'utf8'), new RegExp(sha));
  assert.notEqual(run().status, 0);
});
