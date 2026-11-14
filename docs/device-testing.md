# Device testing

## Android emulator keyboard

Device automation can leave a hidden test keyboard selected. Successful automated
text entry alone leaves keyboard layout and dismissal unverified.

Before checking keyboard behavior, use the device tools to select a visible Android
keyboard (such as Gboard) and enable the on-screen keyboard alongside the emulator's
hardware keyboard if needed. Confirm in a screenshot that focusing an input opens
the keyboard. With it visible, verify that the focused field stays visible, the
form's save action is reachable by scrolling, and keyboard dismissal works.

## Maestro flows

The flows in [`e2e/`](../e2e) run the release build of the app on an Android emulator with
[Maestro](https://docs.maestro.dev). Maestro finds controls by their visible text and their
accessibility label, so a flow needs no test code in the app. `pnpm check` does not run the flows.

1. Install the Maestro CLI and make sure that `maestro` is on the `PATH`. Maestro needs Java 17 or newer.
2. Run `pnpm android:apk:emulator`. Run it again after each change to the app, because the APK
   contains the JavaScript bundle. The app ID ends in `.emulator`, so the build does not replace
   the production app.
3. Start one Android emulator with an x86_64 image.
4. Run `pnpm test:e2e`. To run one flow, add its path: `pnpm test:e2e e2e/add-expense.yaml`.

The script installs the APK and then runs the flows. When a flow fails, Maestro writes a
screenshot and the view hierarchy to `dist/e2e/`. Run `maestro hierarchy` to print the labels on
the current screen.

Start each flow with `launchApp` and `clearState: true`. The app then has one account and one
expense category, and the flow does not depend on a flow that ran before it. Use `${APP_ID}` as
the `appId`; the script reads the value from the Expo config. Keep Google Drive actions out of
the flows, because they need a real Google account.

A flow uses the hidden test keyboard, so it does not verify the keyboard layout. Use the
walkthrough above for that.
