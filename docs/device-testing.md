# Device testing

## Temporary Maestro flows in Expo Go (Android)

Use temporary Maestro flows in `.scratch/` to verify functionality in Expo Go.
Read `AGENTS.local.md` to choose a device and find the local tools.
If a feature is unavailable in Expo Go, notify the user that it was not tested.

Start with a connected Android phone or a running emulator, compatible Expo Go, and Metro running from
this checkout (`pnpm start --go --lan`). Keep Metro running until testing finishes;
the first bundle can take a minute.

1. Select the device's serial from `adb devices` and forward Metro so Expo Go
   can reach it at the loopback URL below. Maestro uses the adb connection directly.

   ```bash
   adb -s <serial> reverse tcp:8081 tcp:8081
   ```

2. Write `.scratch/verify.yaml` using this starting point. The link opens this
   checkout in Expo Go; the wait confirms Home is ready before your scenario runs.

   ```yaml
   appId: host.exp.exponent
   ---
   - openLink: exp://127.0.0.1:8081
   - extendedWaitUntil:
       visible: Add transaction
       timeout: 120000
   # Add task-specific interactions and assertions here.
   ```

3. Run the flow against the same serial:

   ```bash
   MAESTRO_CLI_NO_ANALYTICS=1 maestro --device <serial> test \
     --debug-output .scratch/maestro .scratch/verify.yaml
   ```

If Expo Go shows first-run prompts or its developer menu, dismiss them with the
provided device tools, then close your `agent-device` session before running
Maestro. An active inspector can make Maestro fail with
`UiAutomationService … already registered!` or a driver startup timeout.

Read selectors from the source and assert visible outcomes.

On failure, inspect `.scratch/maestro` before retrying.

## Android emulator keyboard

Device automation can leave a hidden test keyboard selected. Successful automated
text entry alone leaves keyboard layout and dismissal unverified.

Before checking keyboard behavior, use the device tools to select a visible Android
keyboard (such as Gboard) and enable the on-screen keyboard alongside the emulator's
hardware keyboard if needed. Confirm in a screenshot that focusing an input opens
the keyboard. With it visible, verify that the focused field stays visible, the
form's save action is reachable by scrolling, and keyboard dismissal works.
