# 0008 — Fingerprint runtime version for OTA updates

## Status

Accepted. This replaces the `appVersion` runtime version policy.

## Context

An installed app downloads an OTA update only when the runtime version of the update is the same as the runtime version in the APK. With the `appVersion` policy, the runtime version was `expo.version`. CI publishes an OTA update to the `production` channel on each push to `main`. If a change added native code and nobody changed `expo.version`, the update went to installed apps that did not have the native code. Those apps can crash.

The APK and the update are made in different places. `apk-release.yml` runs `expo prebuild` and Gradle, so `android/` exists and the signing variables are set. `ci.yml` runs `eas update` in a clean checkout with no `android/`. Both places must calculate the same runtime version, or updates reach no app.

## Decision

`app.json` uses `runtimeVersion: { policy: "fingerprint" }`. The runtime version is a hash of the native inputs of the project. The Gradle build writes the hash into the APK as `assets/fingerprint`. `eas update` calculates the hash again with the `expo-updates runtimeversion:resolve` command of the project.

The two hashes are the same for these reasons:

- Git ignores `android/`. So `expo-updates` uses the managed workflow, and it ignores `android/**` and `ios/**`. The hash does not change after prebuild.
- The config plugins and `app.config.cjs` do not read the signing variables. The hash includes the evaluated Expo config, so a config that reads a variable gives a different hash when that variable changes.
- The hash does not include application JavaScript, so `src/generated/release.ts` does not change it.
- Both jobs use Ubuntu, Node 22 and the same pnpm lockfile, so `node_modules` has the same files and paths.

`fingerprint.config.cjs` removes two sources from the hash: the `package.json` scripts and `.gitignore`. Neither changes the native build. Without this, each edit to a script would need a new APK.

`scripts/runtime-version.mjs` is the guard. The `check` job and the `publish` job print the runtime version. The script fails if Git does not ignore `android/`, or if the runtime version is not a fingerprint. After `eas update`, the `publish` job compares the runtime version of the published update with the value of the checkout and fails when they are different. `eas update` uses the variables of the EAS `production` environment, so a variable there that changes the config gives a different value.

We rejected a CI check that keeps `appVersion` and fails when the fingerprint changes without a change of `expo.version`. That check needs a stored fingerprint to compare with. The PR base does not catch a change that is merged in more than one PR, and the last release tag needs an install of an old commit in CI. The check also depends on a person who bumps the version. With the fingerprint policy, the runtime version always changes with the native inputs, so no person must remember it.

## Consequences

Apps that are installed now have the runtime version `0.1.1` (release v0.1.1) or `0.1.2` (the draft build). No update after this change has those runtime versions, so these apps get no more OTA updates. They continue to run the last update that they downloaded. This costs nothing new: the Google sign-in native module (ADR 0007) already needs a new APK. The owner must build a new APK from `main` and install it over the old app. After that, OTA updates reach it again.

The hash includes all of `node_modules/expo`, the `android/` folder of each Expo module, the full folder of each other native module (for example `react-native-reanimated`), the `react-native` version, the config plugins, the icon and splash images, and the evaluated Expo config. So a change of any of these needs a new APK, also when the change is only JavaScript. Examples are an Expo SDK patch update, or a new version of `react-native-screens`. A change to a dependency that has no native code (for example `@tanstack/react-query`) does not change the hash. Thus the owner needs a new APK more often than before, but an update never reaches an app that cannot run it.

A change of `expo.version` or `expo.android.versionCode` also changes the hash, because both are in the Expo config.

The emulator build (`EXPENSE_TRACKER_BUILD_TARGET=emulator`) has a different package name and disables updates, so its hash is different. This is correct, because it never downloads updates.

The Settings screen shows the runtime version of the running app. To find why an update did not arrive, compare that value with the runtime version that the `publish` job printed.
