import { isDeepStrictEqual } from 'node:util';

// Android rejects a versionCode above this value.
const MAX_VERSION_CODE = 2100000000;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PARTS = ['major', 'minor', 'patch'];

function parse(name, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
}

/**
 * Reads the release version from the text of app.json and package.json.
 * Throws when the versions are different or a value has a wrong form.
 */
export function readRelease({ appJson, packageJson }) {
  const app = parse('app.json', appJson);
  const pkg = parse('package.json', packageJson);
  const version = app?.expo?.version;
  const versionCode = app?.expo?.android?.versionCode;
  if (typeof version !== 'string' || !VERSION.test(version) || pkg?.version !== version) {
    throw new Error('app.json and package.json must have the same x.y.z version.');
  }
  if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_VERSION_CODE) {
    throw new Error(
      `The Android versionCode must be a positive integer that is not more than ${MAX_VERSION_CODE}.`,
    );
  }
  return { version, versionCode };
}

function nextVersion(version, part) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// Replaces the one place where the text has the value. The rest of the text stays the same.
function replaceOnce(name, key, text, pattern, replacement) {
  const matches = text.match(new RegExp(pattern.source, 'g')) ?? [];
  if (matches.length !== 1) {
    throw new Error(`${name} must contain the "${key}" line exactly one time.`);
  }
  return text.replace(pattern, replacement);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Returns the new text of app.json and package.json for the next release.
 * It changes only expo.version, expo.android.versionCode and the package version.
 */
export function bumpRelease({ appJson, packageJson, part }) {
  if (!PARTS.includes(part)) {
    throw new Error('Give the release type: major, minor or patch.');
  }
  const from = readRelease({ appJson, packageJson });
  const to = { version: nextVersion(from.version, part), versionCode: from.versionCode + 1 };
  if (to.versionCode > MAX_VERSION_CODE) {
    throw new Error(`The Android versionCode cannot be more than ${MAX_VERSION_CODE}.`);
  }

  const versionPattern = new RegExp(`"version": "${escape(from.version)}"`);
  const versionText = `"version": "${to.version}"`;
  const bumped = {
    appJson: replaceOnce(
      'app.json',
      'versionCode',
      replaceOnce('app.json', 'version', appJson, versionPattern, versionText),
      new RegExp(`"versionCode": ${from.versionCode}(?!\\d)`),
      `"versionCode": ${to.versionCode}`,
    ),
    packageJson: replaceOnce('package.json', 'version', packageJson, versionPattern, versionText),
  };

  // Make sure that the text changes did not change a different key.
  const expectedApp = parse('app.json', appJson);
  expectedApp.expo.version = to.version;
  expectedApp.expo.android.versionCode = to.versionCode;
  const expectedPackage = { ...parse('package.json', packageJson), version: to.version };
  if (
    !isDeepStrictEqual(JSON.parse(bumped.appJson), expectedApp) ||
    !isDeepStrictEqual(JSON.parse(bumped.packageJson), expectedPackage)
  ) {
    throw new Error('The version is in an unexpected place in app.json or package.json.');
  }
  return { ...bumped, from, to };
}
