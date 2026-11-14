#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export EXPENSE_TRACKER_BUILD_TARGET=emulator
pnpm android:prebuild
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 --console=plain)

artifact=$(bash scripts/emulator-apk-path.sh)
mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk "$artifact"
printf '\nEmulator APK: %s\n' "$artifact"
