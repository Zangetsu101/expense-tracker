# Device testing

## Android emulator keyboard

Device automation can leave a hidden test keyboard selected. Successful automated
text entry alone leaves keyboard layout and dismissal unverified.

Before checking keyboard behavior, use the device tools to select a visible Android
keyboard (such as Gboard) and enable the on-screen keyboard alongside the emulator's
hardware keyboard if needed. Confirm in a screenshot that focusing an input opens
the keyboard. With it visible, verify that the focused field stays visible, the
form's save action is reachable by scrolling, and keyboard dismissal works.
