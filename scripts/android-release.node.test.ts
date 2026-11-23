import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const withReleaseSigning = require('../plugins/with-android-release-signing.cjs');

const template = `android {
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! Generate your own keystore.
            // See the Android signing docs.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}`;

async function applyPlugin(contents, language = 'groovy') {
  const config = withReleaseSigning({ name: 'test', slug: 'test' });
  const result = await config.mods.android.appBuildGradle({
    ...config,
    modResults: { contents, language },
    modRequest: {},
  });
  return result.modResults.contents;
}

test('prebuild plugin removes debug signing only from release and is repeatable', async () => {
  const result = await applyPlugin(template);
  assert.match(result, /debug \{\s+signingConfig signingConfigs.debug/);
  assert.doesNotMatch(result, /release \{[\s\S]*signingConfig signingConfigs.debug/);
  assert.match(result, /apply from: rootProject.file\("..\/scripts\/android-release.gradle"\)/);
  assert.match(result, /minifyEnabled false/);
  assert.equal(await applyPlugin(result), result);
});

test('prebuild plugin fails closed if the signing template or language changes', async () => {
  await assert.rejects(applyPlugin('android { buildTypes { release {} } }'), /template changed/);
  await assert.rejects(applyPlugin(template, 'kotlin'), /requires a Groovy/);
});

function runBuild(signing = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith('EXPENSE_TRACKER_')) delete env[name];
  }
  return spawnSync('bash', ['scripts/build-android-apk.sh'], {
    env: { ...env, ...signing },
    encoding: 'utf8',
  });
}

test('APK command rejects each missing credential before prebuild or Gradle', () => {
  const credentials = {
    EXPENSE_TRACKER_KEYSTORE: '/not-used/release.keystore',
    EXPENSE_TRACKER_STORE_PASSWORD: 'test-only',
    EXPENSE_TRACKER_KEY_ALIAS: 'test-only',
    EXPENSE_TRACKER_KEY_PASSWORD: 'test-only',
  };
  for (const name of Object.keys(credentials)) {
    const signing = { ...credentials };
    delete signing[name];
    const result = runBuild(signing);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`Missing ${name}`));
    assert.equal(result.stdout, '');
  }
});

test('APK command rejects relative paths, missing keystores, and directories', () => {
  const directory = mkdtempSync(join(tmpdir(), 'expense-signing-'));
  try {
    for (const path of ['release.keystore', join(directory, 'missing.keystore'), directory]) {
      const result = runBuild({
        EXPENSE_TRACKER_KEYSTORE: path,
        EXPENSE_TRACKER_STORE_PASSWORD: 'test-only',
        EXPENSE_TRACKER_KEY_ALIAS: 'test-only',
        EXPENSE_TRACKER_KEY_PASSWORD: 'test-only',
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /absolute path to an existing keystore/);
      assert.equal(result.stdout, '');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('production APK command rejects the emulator target before building or signing', () => {
  const result = runBuild({ EXPENSE_TRACKER_BUILD_TARGET: 'emulator' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /android:apk:emulator/);
  assert.equal(result.stdout, '');
});
