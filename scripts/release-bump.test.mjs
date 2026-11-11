import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check, resolveConfig } from 'prettier';

import { bumpRelease, readRelease } from './release-version.mjs';

const appJson = readFileSync(new URL('../app.json', import.meta.url), 'utf8');
const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

function files(version, versionCode) {
  return {
    appJson: `{\n  "expo": {\n    "name": "App",\n    "version": "${version}",\n    "android": {\n      "versionCode": ${versionCode}\n    }\n  }\n}\n`,
    packageJson: `{\n  "name": "app",\n  "version": "${version}",\n  "dependencies": {\n    "expo": "~57.0.25"\n  }\n}\n`,
  };
}

test('each release type computes the next version and adds 1 to versionCode', () => {
  const cases = [
    ['major', '1.0.0'],
    ['minor', '0.3.0'],
    ['patch', '0.2.4'],
  ];
  for (const [part, version] of cases) {
    const result = bumpRelease({ ...files('0.2.3', 7), part });
    assert.deepEqual(result.from, { version: '0.2.3', versionCode: 7 });
    assert.deepEqual(result.to, { version, versionCode: 8 });
    assert.equal(result.appJson, files(version, 8).appJson);
    assert.equal(result.packageJson, files(version, 8).packageJson);
  }
});

test('a bump of the real files changes only the three values and keeps their format', async () => {
  const { from, to, ...bumped } = bumpRelease({ appJson, packageJson, part: 'minor' });
  const expectedApp = JSON.parse(appJson);
  expectedApp.expo.version = to.version;
  expectedApp.expo.android.versionCode = to.versionCode;
  const expectedPackage = { ...JSON.parse(packageJson), version: to.version };
  // JSON.stringify with two spaces gives the format that Prettier writes for these files.
  assert.equal(bumped.appJson, `${JSON.stringify(expectedApp, null, 2)}\n`);
  assert.equal(bumped.packageJson, `${JSON.stringify(expectedPackage, null, 2)}\n`);
  assert.equal(appJson, `${JSON.stringify(JSON.parse(appJson), null, 2)}\n`);
  assert.equal(packageJson, `${JSON.stringify(JSON.parse(packageJson), null, 2)}\n`);
  assert.equal(to.versionCode, from.versionCode + 1);
  for (const [filepath, text] of [
    ['app.json', bumped.appJson],
    ['package.json', bumped.packageJson],
  ]) {
    const options = await resolveConfig(new URL(`../${filepath}`, import.meta.url));
    assert.ok(await check(text, { ...options, filepath }), `${filepath} format`);
  }
});

test('a missing or wrong release type fails', () => {
  for (const part of [undefined, '', 'build', 'Minor']) {
    assert.throws(() => bumpRelease({ ...files('0.2.3', 7), part }), /major, minor or patch/);
  }
});

test('different or wrong values fail', () => {
  const mismatch = {
    appJson: files('0.2.3', 7).appJson,
    packageJson: files('0.2.4', 7).packageJson,
  };
  assert.throws(() => readRelease(mismatch), /same x\.y\.z version/);
  for (const version of ['0.2', '0.2.3-rc.1', 'v0.2.3', '01.2.3']) {
    assert.throws(() => readRelease(files(version, 7)), /same x\.y\.z version/);
  }
  for (const versionCode of [0, -1, 1.5, '"7"', 9007199254740992]) {
    assert.throws(() => readRelease(files('0.2.3', versionCode)), /positive integer/);
  }
  assert.doesNotThrow(() => readRelease(files('0.2.3', 2100000000)));
  assert.throws(() => readRelease(files('0.2.3', 2100000001)), /positive integer/);
  assert.throws(
    () => bumpRelease({ ...files('0.2.3', 2100000000), part: 'patch' }),
    /cannot be more than/,
  );
  assert.throws(() => readRelease({ ...files('0.2.3', 7), appJson: '{' }), /app\.json/);
});

test('a version that the file does not contain in its usual form fails', () => {
  const { appJson: app, packageJson: pkg } = files('0.2.3', 7);
  const compactApp = app.replace('"version": "0.2.3"', '"version":"0.2.3"');
  assert.throws(() => bumpRelease({ appJson: compactApp, packageJson: pkg, part: 'patch' }));
  const twoVersions = pkg.replace('"name": "app"', '"name": "app",\n  "x": { "version": "0.2.3" }');
  assert.throws(() => bumpRelease({ appJson: app, packageJson: twoVersions, part: 'patch' }));
});

function checkout(t, version = '0.2.3', versionCode = 7) {
  const dir = mkdtempSync(join(tmpdir(), 'release-bump-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'scripts'));
  for (const name of ['release-bump.mjs', 'release-version.mjs']) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(dir, 'scripts', name));
  }
  const input = files(version, versionCode);
  writeFileSync(join(dir, 'app.json'), input.appJson);
  writeFileSync(join(dir, 'package.json'), input.packageJson);
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/release-bump.mjs', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });
  const read = () => ({
    appJson: readFileSync(join(dir, 'app.json'), 'utf8'),
    packageJson: readFileSync(join(dir, 'package.json'), 'utf8'),
  });
  return { dir, input, run, read };
}

test('the command writes the files and prints the values and the next steps', (t) => {
  const { run, read } = checkout(t);
  const result = run('patch');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(), files('0.2.4', 8));
  assert.match(result.stdout, /0\.2\.3 -> 0\.2\.4/);
  assert.match(result.stdout, /versionCode: 7 -> 8/);
  assert.match(result.stdout, /Commit/);
  assert.match(result.stdout, /main/);
  assert.match(result.stdout, /Build Android APK/);
});

test('the command writes nothing when it fails', (t) => {
  const { dir, input, run, read } = checkout(t);
  for (const args of [[], ['huge'], ['patch', 'minor']]) {
    const result = run(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /major, minor or patch/);
    assert.doesNotMatch(result.stderr, /\bat .*\.mjs/);
  }
  assert.deepEqual(read(), input);

  const mismatch = input.packageJson.replace('0.2.3', '0.2.2');
  writeFileSync(join(dir, 'package.json'), mismatch);
  const result = run('patch');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same x\.y\.z version/);
  assert.deepEqual(read(), { appJson: input.appJson, packageJson: mismatch });
});
