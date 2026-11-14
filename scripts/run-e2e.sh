#!/usr/bin/env bash
# Usage: scripts/run-e2e.sh [flow file or folder]
set -euo pipefail
cd "$(dirname "$0")/.."

boot_completed() {
  [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]
}

if ! command -v maestro > /dev/null; then
  echo 'Maestro is not installed. See docs/device-testing.md.' >&2
  exit 1
fi
if ! adb get-state > /dev/null 2>&1; then
  echo 'Start one Android emulator first. adb found no device, or more than one.' >&2
  exit 1
fi
# adb sees the emulator before Android can install an app.
for _ in $(seq 60); do
  boot_completed && break
  sleep 2
done
if ! boot_completed; then
  echo 'The emulator did not finish its start in 2 minutes.' >&2
  exit 1
fi
if [ "$(adb shell getprop ro.product.cpu.abi | tr -d '\r')" != x86_64 ]; then
  echo 'The APK is for x86_64 only. Use an emulator with an x86_64 image.' >&2
  exit 1
fi

apk=$(bash scripts/emulator-apk-path.sh)
if [ ! -f "$apk" ]; then
  echo "No APK at $apk. Run pnpm android:apk:emulator first." >&2
  exit 1
fi
adb install -r "$apk"

app_id=$(EXPENSE_TRACKER_BUILD_TARGET=emulator node -p \
  "require('./app.config.cjs')({ config: require('./app.json').expo }).android.package")

# Maestro sends usage data unless this variable is set.
export MAESTRO_CLI_NO_ANALYTICS=1
maestro test --debug-output dist/e2e -e APP_ID="$app_id" "${1:-e2e}"
