// Prints the Android runtime version that `eas update` gives to an update from
// this checkout. An APK receives the update only when its embedded fingerprint
// (assets/fingerprint) has the same value. See ADR 0008.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function runtimeVersionFrom({ output, androidIgnored }) {
  if (!androidIgnored) {
    throw new Error(
      'Git must ignore android/. Otherwise the APK build hashes android/ and gets a different runtime version.',
    );
  }
  const { runtimeVersion, workflow } = JSON.parse(output);
  if (workflow !== 'managed') {
    throw new Error(`Expected the managed workflow, got ${JSON.stringify(workflow)}.`);
  }
  if (!/^[0-9a-f]{40}$/.test(runtimeVersion ?? '')) {
    throw new Error(
      `Expected a fingerprint runtime version, got ${JSON.stringify(runtimeVersion)}. Use runtimeVersion.policy "fingerprint" in app.json.`,
    );
  }
  return runtimeVersion;
}

// `updates` is the JSON output of `eas update --json`.
export function checkPublishedUpdates(updates, runtimeVersion) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('eas update did not report a published update.');
  }
  for (const update of updates) {
    if (update.runtimeVersion !== runtimeVersion) {
      throw new Error(
        `Update ${update.id} has runtime version ${update.runtimeVersion}, but this checkout resolves ${runtimeVersion}. No APK built from this commit receives it.`,
      );
    }
  }
}

function resolveRuntimeVersion() {
  const ignored = spawnSync('git', ['check-ignore', '-q', 'android/app/build.gradle']);
  const output = execFileSync(
    'pnpm',
    ['exec', 'expo-updates', 'runtimeversion:resolve', '--platform', 'android'],
    { encoding: 'utf8' },
  );
  return runtimeVersionFrom({ output, androidIgnored: ignored.status === 0 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtimeVersion = resolveRuntimeVersion();
  const publishedFile = process.argv[2] === '--check-published' ? process.argv[3] : null;
  if (publishedFile) {
    checkPublishedUpdates(JSON.parse(readFileSync(publishedFile, 'utf8')), runtimeVersion);
  }
  console.log(`Android runtime version: ${runtimeVersion}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Android runtime version: \`${runtimeVersion}\`\n`,
    );
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `runtime-version=${runtimeVersion}\n`);
  }
}
