#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export EXPENSE_TRACKER_BUILD_TARGET=emulator
pnpm android:prebuild
(cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 --console=plain)

version=$(node -p "JSON.parse(require('node:fs').readFileSync('app.json', 'utf8')).expo.version")
mkdir -p dist
artifact="dist/expense-tracker-${version}-x86_64-emulator.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$artifact"
printf '\nEmulator APK: %s\n' "$artifact"
