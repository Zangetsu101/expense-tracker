#!/usr/bin/env bash
# Prints the path of the emulator APK for the version in app.json.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "JSON.parse(require('node:fs').readFileSync('app.json', 'utf8')).expo.version")
printf 'dist/expense-tracker-%s-x86_64-emulator.apk\n' "$version"
