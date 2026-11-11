// Settings for the Expo fingerprint, which is the Android runtime version (ADR 0008).
// The skipped sources do not change the native build:
// - The Gradle build does not run package.json scripts.
// - .gitignore changes nothing in the APK. scripts/runtime-version.mjs fails when
//   android/ is not ignored, because that changes how the fingerprint is made.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ['PackageJsonScriptsAll', 'GitIgnore'],
};
