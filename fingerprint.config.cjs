// Settings for the native fingerprint that `pnpm native:fingerprint` checks (ADR 0008).
// The runtime version stays `appVersion`, so these settings do not change the APK.
// The skipped sources do not change the native code of the APK:
// - ExpoConfigVersions: a version bump must not change the fingerprint. Then
//   `pnpm release:bump` does not make native-fingerprint.txt stale.
// - PackageJsonScriptsAll: the Gradle build does not run package.json scripts.
// - GitIgnore: .gitignore changes nothing in the APK.
/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips: ['ExpoConfigVersions', 'PackageJsonScriptsAll', 'GitIgnore'],
};
