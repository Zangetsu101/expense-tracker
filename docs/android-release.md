# Android releases

Use this runbook to ship either a JavaScript/asset OTA update or a signed APK. APKs are built locally; OTA updates are published through GitHub Actions to [the Expo project](https://expo.dev/accounts/zangetsu101/projects/expense-tracker-expo).

## Choose the release type

- **JavaScript/assets only:** publish an OTA update; keep the app version unchanged.
- **Native dependencies, SDK, or native configuration:** build a new APK. Bump `expo.version` and `expo.android.versionCode` in `app.json`, and align `package.json`'s version. The app version is the OTA compatibility boundary.

Back up app data and test on a device before releasing. Installed apps need an APK with EAS Update configured to receive OTA updates.

## Publish an OTA update

One-time CI requirement: an Expo access token with project access, stored as the repository secret [`EXPO_TOKEN`](https://github.com/Zangetsu101/expense-tracker/settings/secrets/actions). The workflows must be on `main`.

1. Merge the tested changes into `main`.
2. Open **GitHub Actions → Publish Android OTA → Run workflow**, select `main`, and describe the changes.
3. Confirm the run succeeds. It runs `pnpm check`, then publishes Android to the `production` channel and environment, recording the commit SHA in the update message.
4. Verify on the installed app: fully close and reopen, allow the update to download, then close and reopen again to apply it.

Publishing is manual; pushes and merges only run checks. See [Expo's debugging guide](https://docs.expo.dev/eas-update/debug/) if an update does not arrive.

## Build and distribute an APK

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
