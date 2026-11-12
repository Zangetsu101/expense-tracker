// Usage: pnpm native:fingerprint [--write]
// Run it from the repository root. Without --write, it checks the native fingerprint
// of the Android app. With --write, it updates native-fingerprint.txt. See ADR 0008.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readRelease } from './release-version.mjs';

export const FINGERPRINT_FILE = 'native-fingerprint.txt';
const HASH = /^[0-9a-f]{40}$/;

export function formatFingerprintFile(hash) {
  return `${hash}\n`;
}

export function parseFingerprintFile(text) {
  const hash = text.trim();
  if (!HASH.test(hash)) {
    throw new Error(`${FINGERPRINT_FILE} must contain one fingerprint of 40 hex characters.`);
  }
  return hash;
}

/**
 * Compares the fingerprint of the tree with the committed file and with the
 * file at the release tag of the version.
 * `committed` is null when the file does not exist.
 * `release` is null when no tag v<version> exists. `release.recorded` is null
 * when the tag has no file.
 */
export function checkNativeFingerprint({ version, current, committed, release }) {
  const errors = [];
  const notes = [];
  if (committed === null) {
    errors.push(
      `${FINGERPRINT_FILE} does not exist. Run "pnpm native:fingerprint --write" and commit it.`,
    );
  } else if (committed !== current) {
    errors.push(
      [
        `The native fingerprint changed from ${committed} to ${current}.`,
        'A change to native code, a native package, a config plugin or app.json changes it.',
        'If you did not make such a change, run "pnpm install --frozen-lockfile" and try again.',
        `Otherwise, run "pnpm native:fingerprint --write" and commit ${FINGERPRINT_FILE}.`,
      ].join('\n'),
    );
  }
  if (release && release.recorded === null) {
    notes.push(
      `The tag ${release.tag} has no ${FINGERPRINT_FILE}, so the check cannot compare with that release.`,
    );
  } else if (release && release.recorded !== current) {
    errors.push(
      [
        `Version ${version} is released (tag ${release.tag}), and its native fingerprint changed.`,
        `The APK of ${release.tag} has ${release.recorded}. This tree has ${current}.`,
        `An OTA update from this tree goes to the installed APKs of ${version}, which do not have this native code.`,
        'To fix it:',
        '1. Run "pnpm release:bump <major|minor|patch>" and commit app.json and package.json.',
        '2. After the merge to main, build a new APK.',
        'OTA updates from this change go only to APKs with the new version.',
      ].join('\n'),
    );
  }
  return { errors, notes };
}

/**
 * Reads the recorded fingerprint at the local tag v<version>.
 * Returns null when the tag does not exist.
 */
export function readReleasedFingerprint({ cwd, version }) {
  const tag = `v${version}`;
  const git = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (git('rev-parse', '--quiet', '--verify', `refs/tags/${tag}^{commit}`).status !== 0) {
    return null;
  }
  if (git('cat-file', '-e', `${tag}:${FINGERPRINT_FILE}`).status !== 0) {
    return { tag, recorded: null };
  }
  const text = execFileSync('git', ['show', `${tag}:${FINGERPRINT_FILE}`], {
    cwd,
    encoding: 'utf8',
  });
  return { tag, recorded: parseFingerprintFile(text) };
}

// The fingerprint that expo-updates makes for Android. fingerprint.config.cjs
// removes the version fields, so a version bump does not change it.
function generateFingerprint() {
  const output = execFileSync(
    'pnpm',
    ['exec', 'expo-updates', 'fingerprint:generate', '--platform', 'android'],
    { encoding: 'utf8' },
  );
  return JSON.parse(output).hash;
}

function main(args) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--write')) {
    throw new Error('Usage: pnpm native:fingerprint [--write]');
  }
  const current = generateFingerprint();
  if (args[0] === '--write') {
    writeFileSync(FINGERPRINT_FILE, formatFingerprintFile(current));
    console.log(`${FINGERPRINT_FILE}: ${current}`);
    return;
  }
  const { version } = readRelease({
    appJson: readFileSync('app.json', 'utf8'),
    packageJson: readFileSync('package.json', 'utf8'),
  });
  const committed = existsSync(FINGERPRINT_FILE)
    ? parseFingerprintFile(readFileSync(FINGERPRINT_FILE, 'utf8'))
    : null;
  const release = readReleasedFingerprint({ cwd: process.cwd(), version });
  const { errors, notes } = checkNativeFingerprint({ version, current, committed, release });
  for (const note of notes) console.log(note);
  if (errors.length > 0) {
    console.error(errors.join('\n\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Native fingerprint ${current} is up to date.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
