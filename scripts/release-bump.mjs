// Usage: pnpm release:bump <major|minor|patch>
// Run it from the repository root. It changes the version in app.json and package.json.
import { readFileSync, writeFileSync } from 'node:fs';

import { bumpRelease } from './release-version.mjs';

const args = process.argv.slice(2);
try {
  if (args.length !== 1) {
    throw new Error('Give one release type: major, minor or patch.');
  }
  const { appJson, packageJson, from, to } = bumpRelease({
    appJson: readFileSync('app.json', 'utf8'),
    packageJson: readFileSync('package.json', 'utf8'),
    part: args[0],
  });
  writeFileSync('app.json', appJson);
  writeFileSync('package.json', packageJson);
  console.log(`version: ${from.version} -> ${to.version}`);
  console.log(`versionCode: ${from.versionCode} -> ${to.versionCode}`);
  console.log(`
Next steps:
1. Commit app.json and package.json.
2. Merge the change to main.
3. Run GitHub Actions -> Build Android APK on main.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
