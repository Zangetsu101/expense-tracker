# Local Android releases

App ID: `com.zangetsu101.expensetracker`. Initial version: `0.1.0`, Android version code `1`.

Run commands from the repository root in Bash. The setup uses Node.js 22.19+, pnpm 10.33.2, JDK 21, and the Android SDK at `$ANDROID_HOME`.

## 1. Prepare

```sh
pnpm install --frozen-lockfile
```

The signing key is `release.keystore` at the repository root, with alias `expense-tracker`. It is Git-ignored. Its password is stored in `pass` at `misc/keystore/expense-tracker`.

Update `expo.version` and increment `expo.android.versionCode` in `app.json`. Keep the version in `package.json` aligned.

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

## 4. Publish on GitHub

Tag the exact commit:

```sh
git tag -a v0.1.0 -m 'Expense Tracker 0.1.0'
git push origin v0.1.0
```

Create a GitHub prerelease for `v0.1.0` and attach the APK and checksum file. Include known limitations, Android support, backup precautions, and the fact that iOS is unverified in the release notes.
