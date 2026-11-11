import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import {
  FINGERPRINT_FILE,
  checkNativeFingerprint,
  formatFingerprintFile,
  parseFingerprintFile,
  readReleasedFingerprint,
} from './native-fingerprint.mjs';

const require = createRequire(import.meta.url);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

const check = (input) => checkNativeFingerprint({ version: '0.2.0', ...input });

test('the same fingerprint and no release tag passes', () => {
  const result = check({ current: A, committed: A, release: null });
  assert.deepEqual(result.errors, []);
});

test('a native change with a stale file fails and tells how to update the file', () => {
  const result = check({ current: B, committed: A, release: null });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /pnpm native:fingerprint --write/);
  assert.match(result.errors[0], new RegExp(`${A}[\\s\\S]*${B}`));
});

test('a missing file fails and tells how to make it', () => {
  const result = check({ current: A, committed: null, release: null });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /pnpm native:fingerprint --write/);
});

test('a released version with a changed fingerprint fails and tells how to bump the version', () => {
  const result = check({ current: B, committed: B, release: { tag: 'v0.2.0', recorded: A } });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /v0\.2\.0/);
  assert.match(result.errors[0], /pnpm release:bump <major\|minor\|patch>/);
  assert.match(result.errors[0], /new APK/);
});

test('a released version with a changed fingerprint and a stale file reports both problems', () => {
  const result = check({ current: B, committed: A, release: { tag: 'v0.2.0', recorded: A } });
  assert.equal(result.errors.length, 2);
});

test('a released version with the same fingerprint passes', () => {
  const result = check({ current: A, committed: A, release: { tag: 'v0.2.0', recorded: A } });
  assert.deepEqual(result.errors, []);
});

test('a release tag with no file passes and says that it cannot compare', () => {
  const result = check({ current: A, committed: A, release: { tag: 'v0.2.0', recorded: null } });
  assert.deepEqual(result.errors, []);
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /v0\.2\.0/);
});

test('the file holds one fingerprint on one line', () => {
  assert.equal(formatFingerprintFile(A), `${A}\n`);
  assert.equal(parseFingerprintFile(`${A}\n`), A);
  assert.equal(parseFingerprintFile(A), A);
  assert.throws(() => parseFingerprintFile('not a hash\n'), new RegExp(FINGERPRINT_FILE));
  assert.throws(() => parseFingerprintFile(`${A}\n${B}\n`), new RegExp(FINGERPRINT_FILE));
});

test('readReleasedFingerprint reads the file at a local tag', (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'native-fingerprint-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd: repo,
      stdio: 'pipe',
    });
  git('init', '-q');
  writeFileSync(join(repo, 'README.md'), 'old release\n');
  git('add', '.');
  git('commit', '-q', '-m', 'release with no file');
  git('tag', '-a', 'v0.1.0', '-m', 'old');
  writeFileSync(join(repo, FINGERPRINT_FILE), formatFingerprintFile(A));
  git('add', '.');
  git('commit', '-q', '-m', 'release with a file');
  git('tag', 'v0.2.0');
  writeFileSync(join(repo, FINGERPRINT_FILE), formatFingerprintFile(B));
  git('commit', '-q', '-am', 'native change');

  assert.deepEqual(readReleasedFingerprint({ cwd: repo, version: '0.2.0' }), {
    tag: 'v0.2.0',
    recorded: A,
  });
  assert.deepEqual(readReleasedFingerprint({ cwd: repo, version: '0.1.0' }), {
    tag: 'v0.1.0',
    recorded: null,
  });
  assert.equal(readReleasedFingerprint({ cwd: repo, version: '0.3.0' }), null);
});

test('the fingerprint config leaves out the version fields, so a version bump keeps the file valid', () => {
  const config = require('../fingerprint.config.cjs');
  assert.ok(config.sourceSkips.includes('ExpoConfigVersions'));
});
