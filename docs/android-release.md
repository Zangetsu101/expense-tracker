# Android releases

Use this runbook to ship either a JavaScript/asset OTA update or a signed APK. GitHub Actions builds APKs for GitHub Releases and publishes OTA updates to [the Expo project](https://expo.dev/accounts/zangetsu101/projects/expense-tracker-expo).

## Choose the release type

- **JavaScript/assets only:** publish an OTA update; keep the app version unchanged.
- **Native dependencies, SDK, or native configuration:** build a new APK. Bump `expo.version` and `expo.android.versionCode` in `app.json`, and align `package.json`'s version. The app version is the OTA compatibility boundary.

Back up app data and test on a device before releasing. Installed apps need an APK with EAS Update configured to receive OTA updates.

## Publish an OTA update

One-time CI requirement: an Expo access token with project access, stored as the repository secret [`EXPO_TOKEN`](https://github.com/Zangetsu101/expense-tracker/settings/secrets/actions). The workflows must be on `main`.

1. Merge the tested changes into `main`. Every push to `main` runs checks and publishes an Android OTA update to the `production` channel and environment, recording the commit SHA.
2. Confirm **GitHub Actions → Publish Android OTA** succeeds. You can also use **Run workflow** on `main` with a description to publish manually.
3. Verify on the installed release app: open **Settings → Updates** to check for and download the update. When it is ready, tap **Updates** again and confirm **Restart to update** to apply it. Finish any unsaved entries before restarting. Tap the version/release line in Settings to confirm the running commit matches the published commit.

See [Expo's debugging guide](https://docs.expo.dev/eas-update/debug/) if an update does not arrive.

## Build an APK in GitHub Actions

One-time setup: add these repository secrets in [Actions secrets](https://github.com/Zangetsu101/expense-tracker/settings/secrets/actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 encoding of the existing release keystore file (for example, `base64 -w 0 release.keystore` on Linux). |
| `ANDROID_STORE_PASSWORD` | Keystore password. |
| `ANDROID_KEY_ALIAS` | Existing key alias: `expense-tracker`. |
| `ANDROID_KEY_PASSWORD` | Key password; the current local setup uses the same value as the store password. |

Reuse the existing signing key so installed apps can upgrade without uninstalling. Do not commit signing credentials. No Expo token is required for the APK build.

1. Merge the workflow into `main`. For each new APK release, bump `expo.version` and `expo.android.versionCode` in `app.json`, align `package.json`'s version, and merge those changes to `main`. The version code must exceed the installed release's code.
2. Open **GitHub Actions → Build Android APK → Run workflow** and select `main`. Other branches are skipped.
3. The workflow runs checks, stamps the commit into the embedded bundle, prebuilds, builds a signed ARM64 APK, verifies its signature, and creates a **draft prerelease** with the APK and SHA-256 checksum. Existing versions/tags are rejected rather than overwritten.
4. Open the draft under **GitHub Releases** while signed in with repository write access. A draft is unpublished; download its APK, back up app data, install over the existing app, and verify behavior and the signing certificate.
5. Edit the draft's notes to include known limitations, then click **Publish release** when testing passes. The release remains marked as a prerelease.

A failed build creates no release. If publication fails after creating a draft, inspect/delete that draft before retrying; the workflow refuses to overwrite it.

## Decision: GitHub APK releases (2026-11-06)

Build APKs directly on GitHub-hosted Ubuntu using the existing prebuild/Gradle signing path, Node 22, JDK 21, and ARM64 only. Releases are manually dispatched from `main`, use committed versions, and produce unpublished draft prereleases for device testing. Signing material lives in repository secrets and a temporary runner file removed after the build. OTA publication continues automatically on pushes to `main`; native changes require a new app version/runtime and APK before installed users can use them.

### CI memory failure handling

The first native CI build exhausted Gradle's 512 MiB Metaspace limit during Android lint. Gradle printed `BUILD FAILED` but the command did not exit before cancellation, so GitHub kept the step running. CI now gives Gradle a 3 GiB heap and 1 GiB Metaspace, limits workers to two, disables persistent daemons, and enables `ExitOnOutOfMemoryError` so JVM memory exhaustion terminates the build process. A single-use daemon may still be started to honor the JVM settings. These settings live in the runner's Gradle user home, outside generated native sources.

## Build an APK locally

Run from the repository root in Bash with Node.js 22.19+, pnpm 10.33.2, JDK 21, and the Android SDK at `$ANDROID_HOME`.

Use the existing `release.keystore` (Git-ignored), alias `expense-tracker`. Its password is in `pass` at `misc/keystore/expense-tracker`; keep the same key so existing installations can be upgraded.

```sh
pnpm install --frozen-lockfile
(
  set -euo pipefail
  export EXPENSE_TRACKER_KEYSTORE="$PWD/release.keystore"
  export EXPENSE_TRACKER_KEY_ALIAS=expense-tracker
  secret=$(pass show misc/keystore/expense-tracker)
  export EXPENSE_TRACKER_STORE_PASSWORD="${secret%%$'\n'*}"
  unset secret
  export EXPENSE_TRACKER_KEY_PASSWORD="$EXPENSE_TRACKER_STORE_PASSWORD"
  pnpm android:apk
)
```

The command runs checks, prebuild, and the signed ARM64 release build. It produces `dist/expense-tracker-<version>-arm64.apk` and its `.sha256` file. Native sources are generated: edit `app.json`, the signing plugin, or the signing Gradle script instead of `android/`.

Verify the release certificate and install without clearing app data:

```sh
version=$(node -p "require('./app.json').expo.version")
apk="dist/expense-tracker-${version}-arm64.apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$apk"
# Confirm the certificate is your release certificate, not Android Debug.
adb install -r "$apk"
```

After device testing, tag the exact build commit and push the tag:

```sh
git tag -a "v$version" -m "Expense Tracker $version"
git push origin "v$version"
```

Create a GitHub prerelease for that tag and attach the APK and checksum. Include known limitations and note that the APK supports ARM64 Android devices only.
