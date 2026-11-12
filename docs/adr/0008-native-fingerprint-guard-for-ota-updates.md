# 0008 — Native fingerprint guard for OTA updates

## Status

Accepted.

## Context

An installed app downloads an OTA update only when the runtime version of the update is the same as the runtime version of the APK. `app.json` uses `runtimeVersion: { policy: "appVersion" }`, so the runtime version is `expo.version`. CI publishes an OTA update to the `production` channel on each push to `main`. If a change adds or updates native code and nobody bumps the version, the update goes to installed APKs that do not have that native code. Those apps can crash.

The `fingerprint` policy prevents this, because the runtime version is then a hash of the native inputs. We tried it in a closed PR and rejected it for now. With that policy, each change of a package that has native code needs a new APK before OTA updates arrive again. Many such changes are planned, so the cost in APK builds is too high at this stage.

## Decision

The `appVersion` policy stays. A CI check, `pnpm native:fingerprint`, enforces this rule: an APK that is released with version X has the same native fingerprint as each later commit on `main` that still has version X. Before version X is released, native changes under version X are allowed.

- The fingerprint is the value of `expo-updates fingerprint:generate --platform android`. It is a hash of the native packages, the config plugins, the images in `app.json` and the evaluated Expo config. Git ignores `android/`, so Expo uses the managed workflow, and the hash does not change after prebuild.
- `fingerprint.config.cjs` removes `expo.version`, `expo.android.versionCode`, the `package.json` scripts and `.gitignore` from the hash. So `pnpm release:bump` does not change the fingerprint, and the bump needs no other step. The runtime version policy does not use this file, so the file does not change the APK.
- `native-fingerprint.txt` contains the fingerprint of the tree. The check fails when the file is different from the calculated value. So each native change shows in the diff of its PR, and `pnpm native:fingerprint --write` updates the file. Two PRs that both change native code change the same line, so Git stops the second merge.
- The release tag `v<version>` marks a released version. The check reads `native-fingerprint.txt` at that tag and fails when the value is different from the current value. The message tells the developer to run `pnpm release:bump`, build a new APK, and expect that the update reaches only APKs with the new version. The `check` job fetches only this tag. A tag that has no file passes with a note.
- `pnpm check` runs the guard, so the `check` job runs it on each PR, on each push to `main` and on each manual run of CI. The `publish` job needs the `check` job, so a failed guard also stops the OTA publish. A direct push to `main` runs the same `check` job before `publish`.
- The release workflow requires a successful `check` job for the commit. So the file at a release tag is the fingerprint of the APK of that release.

We did not compare with the PR base. That misses a native change that is merged in parts over more than one PR, and it does not know which versions are released.

## Consequences

Each native change needs a commit of `native-fingerprint.txt`. A change of the fingerprint config or an update of `@expo/fingerprint` can change the hash with no native change. Then the developer updates the file, and on a released version also bumps it.

These cases are not covered:

- The release workflow creates a draft release, and GitHub creates the tag only when the owner publishes it. While the release is a draft, the guard does not know about it. An OTA update with a native change can reach the APK of the draft. Do not merge native changes to `main` while a draft release is open. After the publication, the next `check` job on `main` fails if such a change was merged.
- A signed test APK (`signed_test`) uses the version in `app.json` and gets no tag. Updates for that version reach it, also when they have native changes.
- The guard sees only the inputs of the fingerprint. A native change outside them, for example a config that reads an environment variable that only the release build sets, is not detected.
- A local `pnpm check` uses the local tags. CI fetches the tag, so CI gives the result that counts.

The `fingerprint` policy removes these limits and the manual bump. Consider it again when the app is stable and native changes are rare.
