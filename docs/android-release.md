# Local Android releases

App ID: `com.zangetsu101.expensetracker`. Initial version: `0.1.0`, Android version code `1`.

Run commands from the repository root in Bash. The setup uses Node.js 22.19+, pnpm 10.33.2, JDK 21, and the Android SDK at `$ANDROID_HOME`.

## 1. Prepare

```sh
pnpm install --frozen-lockfile
```

The signing key is `release.keystore` at the repository root, with alias `expense-tracker`. It is Git-ignored. Its password is stored in `pass` at `misc/keystore/expense-tracker`.

Update `expo.version` and increment `expo.android.versionCode` in `app.json` for each new APK release. Keep the version in `package.json` aligned. EAS Update uses the app version as its native compatibility boundary, so every native dependency, SDK, or native configuration change requires a new app version and APK. JavaScript-only OTA releases keep that version unchanged.

## 2. Build

```sh
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

This runs all checks, Expo prebuild, and Gradle's release build for `arm64-v8a`, targeting the Pixel 8 and other ARM64 phones. The APK does not support 32-bit phones or x86 emulators. Credentials stay in the subshell environment. Missing signing credentials fail the build; there is no debug-key fallback.

Outputs:

- `dist/expense-tracker-0.1.0-arm64.apk`
- `dist/expense-tracker-0.1.0-arm64.apk.sha256`

Android sources are generated and ignored. Change native configuration through `app.json`, the signing plugin, or the signing Gradle script, not generated files.

## 3. Verify and test

```sh
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs \
  dist/expense-tracker-0.1.0-arm64.apk
adb install -r dist/expense-tracker-0.1.0-arm64.apk
```

Verify that the certificate is the release certificate, not `Android Debug`.

## 4. OTA updates

EAS Update hosts JavaScript and bundled asset updates; APKs are still built locally and distributed directly. The Expo project is [@zangetsu101/expense-tracker-expo](https://expo.dev/accounts/zangetsu101/projects/expense-tracker-expo). Local release APKs request the `production` channel through `updates.requestHeaders` in `app.json`; Expo prebuild writes this into the generated native project. No EAS Build configuration is needed.

Install a newly built, signed APK once to enable OTA updates. APKs built before this configuration cannot receive them. Keep the existing signing key and use `adb install -r` to preserve app data. Back up financial data before testing releases.

After checks and device testing, publish an approved Android JavaScript/asset update from the exact intended commit:

```sh
pnpm check
npx eas-cli@latest update --channel production --platform android \
  --environment production --message "Describe the change"
```

This command uploads the bundle and assets to Expo and can affect installed apps on the matching runtime. Review the target and diff before publishing. SDK 57 requires the explicit EAS environment even when no remote environment variables are configured. Never embed secrets or personal financial data in the bundle.

Default update behavior checks and downloads in the background at launch, then applies on a later restart. Test with up to two cold launches: fully terminate and reopen, allow the download, then fully terminate and reopen again. Offline launches use the embedded or cached update. Native changes, permissions, launcher icons, and splash configuration still need a new APK.

EAS Update has Free-plan usage allowances for delivery and storage; see [Expo pricing](https://expo.dev/pricing). See the [setup guide](https://docs.expo.dev/eas-update/getting-started/) and [debugging guide](https://docs.expo.dev/eas-update/debug/) for compatibility and delivery failures.

## 5. Publish on GitHub

Tag the exact commit:

```sh
git tag -a v0.1.0 -m 'Expense Tracker 0.1.0'
git push origin v0.1.0
```

Create a GitHub prerelease for `v0.1.0` and attach the APK and checksum file. Include known limitations, Android support, backup precautions, and the fact that iOS is unverified in the release notes.
