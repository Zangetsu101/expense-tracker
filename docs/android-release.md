# Local Android releases

The app ID is `com.zangetsu101.expensetracker`. The initial release is `0.1.0`, Android version code `1`.

## Prerequisites

- Node.js 22.19 or newer and pnpm 10.33.2.
- JDK 21 and an Android SDK installation, with `ANDROID_HOME` pointing to it.
- Accepted Android SDK licenses. The first native build needs network access for Gradle, Maven dependencies, and any missing SDK/NDK packages.

Run `pnpm install --frozen-lockfile` first. Android sources are generated with Expo prebuild and ignored by Git. Make native configuration changes through `app.json`, the signing plugin, or the signing Gradle script, not by editing generated files.

## Create a signing key once

Use a separate key for this app. The following command prompts for passwords rather than recording them in shell history:

```sh
mkdir -p "$HOME/.local/share/expense-tracker"
chmod 700 "$HOME/.local/share/expense-tracker"
keytool -genkeypair -v \
  -keystore "$HOME/.local/share/expense-tracker/release.keystore" \
  -alias expense-tracker \
  -keyalg RSA -keysize 4096 -validity 10000
chmod 600 "$HOME/.local/share/expense-tracker/release.keystore"
```

Back up the keystore, alias, and passwords securely outside this repository. Future APK updates must use the same package ID and signing key. Losing the key prevents updates to existing installations.

## Build a signed APK

In a Bash terminal, set signing values for this session. Use the same key password as the store password if that is how the keystore was created:

```sh
export EXPENSE_TRACKER_KEYSTORE="$HOME/.local/share/expense-tracker/release.keystore"
export EXPENSE_TRACKER_KEY_ALIAS=expense-tracker
read -rsp 'Keystore password: ' EXPENSE_TRACKER_STORE_PASSWORD; echo
export EXPENSE_TRACKER_STORE_PASSWORD
read -rsp 'Key password: ' EXPENSE_TRACKER_KEY_PASSWORD; echo
export EXPENSE_TRACKER_KEY_PASSWORD
pnpm android:apk
unset EXPENSE_TRACKER_STORE_PASSWORD EXPENSE_TRACKER_KEY_PASSWORD
```

Never paste signing passwords into chat, commit them, or put them in command-line arguments. The build reads credentials from the environment; it does not write them into the generated project.

`pnpm android:apk` checks credentials, runs `pnpm check`, regenerates Android configuration, and runs `:app:assembleRelease`. It writes:

- `dist/expense-tracker-0.1.0.apk`
- `dist/expense-tracker-0.1.0.apk.sha256`

Release signing has no debug-key fallback. `pnpm android:prebuild` alone does not require signing credentials; debug development remains available. A signed build has not been verified until the APK has been inspected and tested on a device.

## Verify before publishing

Use `apksigner` from your Android SDK build-tools directory:

```sh
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs \
  dist/expense-tracker-0.1.0.apk
adb install -r dist/expense-tracker-0.1.0.apk
```

Check that the certificate is your release certificate, not `Android Debug`. Test launch without Metro, quick entry, account balances, lending, search, reports, import, backup/restore, and canceled document pickers using synthetic data. Do not uninstall an existing installation or overwrite real financial data to run tests. Expo Go data does not automatically migrate to this standalone app; use a backup and verify restore separately.

The APK embeds JavaScript and assets and does not need Metro. Build and test the exact commit you plan to tag. For future releases, update `expo.version` and increment `expo.android.versionCode` in `app.json`, and keep `package.json`'s version aligned.

## Publish on GitHub

After testing, create a tag for the tested commit and a GitHub release. For the initial release:

```sh
git tag -a v0.1.0 -m 'Expense Tracker 0.1.0'
git push origin v0.1.0
```

Attach the APK and checksum file to a GitHub release for that tag. Mark the initial release as a prerelease and describe known limitations, supported Android versions, backup precautions, and the fact that iOS is unverified. Do not upload keystores, passwords, financial exports, or generated source maps. Creating a GitHub release does not publish the app to Google Play.
