// Usage: node scripts/release-notes.mjs <apk>
// Writes the notes of a draft release for the checked-out commit to standard output.
// Run it from the repository root, in a checkout with the full history and the tags.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PULL_REQUEST_MERGE = /^Merge pull request #(\d+) from /;
const FINGERPRINT = /^[0-9a-f]{40}$/;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// The newest vX.Y.Z tag that the commit contains. Tags on other branches do not count.
// A tag on the commit itself is the tag of this release, for example in a local build.
function lastReleaseTag(commit) {
  const own = new Set(git('tag', '--points-at', commit).split('\n'));
  const tags = git('tag', '--merged', commit, '--list', 'v*')
    .split('\n')
    .map((tag) => ({ tag, match: RELEASE_TAG.exec(tag) }))
    .filter(({ tag, match }) => match && !own.has(tag))
    .map(({ tag, match }) => ({ tag, parts: match.slice(1).map(Number) }));
  tags.sort(
    (a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2],
  );
  return tags[0]?.tag;
}

// One line for each commit on the first-parent history of main.
// A PR merge shows the PR title, because the merge commit of GitHub has the title as its body.
function changes(range) {
  const log = git('log', '--first-parent', '--format=%H%x1f%P%x1f%s%x1f%b%x1e', range);
  return log
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, parents, subject, body] = entry.split('\x1f');
      const pullRequest = PULL_REQUEST_MERGE.exec(subject);
      const title = body?.split('\n').find((line) => line.trim());
      if (parents.includes(' ') && pullRequest && title) {
        return `- ${title.trim()} (#${pullRequest[1]})`;
      }
      return `- ${subject} (${sha.slice(0, 7)})`;
    });
}

// With the fingerprint policy, the APK has the runtime version in assets/fingerprint.
// With the appVersion policy, the file can be missing and the app version is the runtime version.
function runtimeVersion(apk) {
  if (!existsSync(apk)) throw new Error(`The APK ${apk} does not exist.`);
  const result = spawnSync('unzip', ['-p', apk, 'assets/fingerprint'], { encoding: 'utf8' });
  // unzip returns 11 when the archive does not contain the file.
  if (result.status === 11) {
    const { expo } = JSON.parse(readFileSync('app.json', 'utf8'));
    return `${expo.version} (app version)`;
  }
  if (result.status !== 0) {
    throw new Error(`unzip cannot read ${apk}: ${result.stderr.trim()}`);
  }
  const fingerprint = result.stdout.trim();
  if (!FINGERPRINT.test(fingerprint)) {
    throw new Error('assets/fingerprint in the APK does not contain a 40-character hash.');
  }
  return `${fingerprint} (fingerprint)`;
}

function releaseNotes(apk) {
  if (!apk) throw new Error('Give the path of the APK.');
  if (git('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('The checkout is shallow. Check out the full history with fetch-depth: 0.');
  }
  const commit = git('rev-parse', 'HEAD');
  const tag = lastReleaseTag(commit);
  const repository = process.env.GITHUB_REPOSITORY;
  return [
    `Signed ARM64 Android APK built from commit ${commit}.`,
    '',
    `Runtime version: ${runtimeVersion(apk)}. An OTA update reaches this APK only when it has the same runtime version.`,
    '',
    tag ? `## Changes since ${tag}` : '## Changes\n\nNo earlier release tag exists.',
    '',
    ...changes(tag ? `${tag}..${commit}` : commit),
    '',
    ...(tag && repository
      ? [`All commits: https://github.com/${repository}/compare/${tag}...${commit}`, '']
      : []),
    'Back up app data, install the APK over the existing app, and test before publishing this draft.',
    'Supports ARM64 Android devices only. The .sha256 file contains the APK checksum.',
    '',
  ].join('\n');
}

try {
  process.stdout.write(releaseNotes(process.argv[2]));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
