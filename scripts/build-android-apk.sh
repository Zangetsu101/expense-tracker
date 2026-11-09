#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${EXPENSE_TRACKER_BUILD_TARGET:-}" == emulator ]]; then
  printf 'Use pnpm android:apk:emulator for emulator builds.\n' >&2
  exit 1
fi

for name in EXPENSE_TRACKER_KEYSTORE EXPENSE_TRACKER_STORE_PASSWORD EXPENSE_TRACKER_KEY_ALIAS EXPENSE_TRACKER_KEY_PASSWORD; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing %s. See docs/android-release.md.\n' "$name" >&2
    exit 1
  fi
done
if [[ "$EXPENSE_TRACKER_KEYSTORE" != /* || ! -f "$EXPENSE_TRACKER_KEYSTORE" ]]; then
  printf 'EXPENSE_TRACKER_KEYSTORE must be an absolute path to an existing keystore.\n' >&2
  exit 1
fi

pnpm check
pnpm android:prebuild
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain)

version=$(node -p "JSON.parse(require('node:fs').readFileSync('app.json', 'utf8')).expo.version")
mkdir -p dist
artifact="dist/expense-tracker-${version}-arm64.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$artifact"
sha256sum "$artifact" > "$artifact.sha256"
printf '\nAPK: %s\nChecksum: %s.sha256\n' "$artifact" "$artifact"
