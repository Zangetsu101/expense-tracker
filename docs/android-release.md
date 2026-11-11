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

| Secret                    | Value                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64` | Base64 encoding of the existing release keystore file (for example, `base64 -w 0 release.keystore` on Linux). |
| `ANDROID_STORE_PASSWORD`  | Keystore password.                                                                                            |
| `ANDROID_KEY_ALIAS`       | Existing key alias: `expense-tracker`.                                                                        |
| `ANDROID_KEY_PASSWORD`    | Key password; the current local setup uses the same value as the store password.                              |

Reuse the existing signing key so installed apps can upgrade without uninstalling. Do not commit signing credentials. No Expo token is required for the APK build.

1. For each new APK release, bump `expo.version` and `expo.android.versionCode` in `app.json`, align `package.json`'s version, and merge those changes to `main`. The version code must exceed the installed release's code.
2. Open **GitHub Actions → Build Android APK → Run workflow** and select `main`. Leave **emulator** unchecked for a release. Other branches produce an emulator test artifact.
3. The workflow stops if the commit has no successful `check` job. The **Checks** workflow runs this job on each push to `main`, so wait for it to pass first. Then the workflow stamps the commit into the embedded bundle, prebuilds, builds a signed ARM64 APK, verifies its signature, and creates a **draft prerelease** with the APK and SHA-256 checksum. Existing versions/tags are rejected rather than overwritten.
4. Open the draft under **GitHub Releases** while signed in with repository write access. A draft is unpublished; download its APK, back up app data, install over the existing app, and verify behavior and the signing certificate.
5. Edit the draft's notes to include known limitations, then click **Publish release** when testing passes. The release remains marked as a prerelease.

A failed build creates no release. If publication fails after creating a draft, inspect/delete that draft before retrying; the workflow refuses to overwrite it.

## Build a signed test APK without a release

To test a branch on a real phone before a release, run **Build Android APK** with **signed_test** checked. You can select any branch:

```sh
gh workflow run apk-release.yml --ref <branch> -f signed_test=true
```

The job builds the same signed ARM64 APK as a release. It does not check or create a tag or a release. It does not run the repository checks or require a successful `check` job. Download the `expense-tracker-arm64-signed-test-<commit>` artifact from the workflow run. It contains the APK and its `.sha256` file. Artifacts are kept for 14 days.

To check the APK, run this command in the folder that contains the downloaded files:

```sh
sha256sum -c expense-tracker-*-arm64.apk.sha256
```

The APK uses the release signing key, so it installs over the production app and keeps its data. It uses the version in `app.json` and receives OTA updates for that version. A later release with the same version installs over it.

## Build an APK for the Android emulator

Manually run **Build Android APK** on a feature branch to build an x86_64 test APK. On `main`, check **emulator** to select this target. This job uploads a workflow artifact instead of creating a release and does not need release-signing secrets.

For example, build the auto-backup PR before merging it:

```sh
gh workflow run apk-release.yml --ref scheduled-backups-ndjson-wal
```

Download the `expense-tracker-x86_64-emulator-<commit>` artifact from the workflow run. It contains `expense-tracker-<version>-x86_64-emulator.apk`. Artifacts are kept for 14 days.

The APK uses the `.emulator` application ID suffix, an emulator-specific link scheme, and the Android debug signing key. It has an embedded JavaScript bundle and OTA updates are disabled, so it runs the selected commit without Metro. It can coexist with the production app and has its own database and backup settings.

To build the same target locally:

```sh
pnpm install --frozen-lockfile
pnpm android:apk:emulator
```

The build command does not run the repository checks. Run `pnpm check` first if you need them. The command prebuilds the emulator configuration and assembles a release variant for x86_64 with debug signing. Native configuration switches through `EXPENSE_TRACKER_BUILD_TARGET=emulator`; leave this variable unset for production builds. The production APK command rejects emulator mode.

Google Drive backups on the emulator need their own Android OAuth client. See [Google Drive backups](google-drive-backups.md#set-up-google-cloud).

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

The command runs prebuild and the signed ARM64 release build. It does not run the repository checks, so run `pnpm check` first. It produces `dist/expense-tracker-<version>-arm64.apk` and its `.sha256` file. The `.sha256` file contains only the file name, so `sha256sum -c` works in the folder that contains both files. Both APK targets use Huawei Cloud’s Gradle 9.3.1 mirror, pinned to Gradle’s official SHA-256 checksum by `plugins/with-gradle-mirror.cjs`. When upgrading Expo’s generated Gradle version, update the mirror and checksum together. Native sources are generated: edit `app.json`, the signing plugin, or the signing Gradle script instead of `android/`.

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
