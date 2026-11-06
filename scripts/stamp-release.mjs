import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sha = process.env.GITHUB_SHA;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  encoding: 'utf8',
}).trim();
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  !/^[a-f0-9]{40}$/.test(sha ?? '') ||
  sha !== head ||
  dirty
) {
  throw new Error('Release stamping requires a clean GitHub Actions checkout matching GITHUB_SHA.');
}
writeFileSync(
  new URL('../src/generated/release.ts', import.meta.url),
  `export const releaseCommit: string | null = ${JSON.stringify(sha)};\n`,
);
