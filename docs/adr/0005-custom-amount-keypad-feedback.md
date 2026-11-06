# Custom amount keypad feedback

The amount-first Quick Add form retains its custom calculator keypad and arithmetic controls. It does not inherit system keyboard preferences or behavior.

Key presses request Android's native keyboard-tap haptic or a light iOS impact through Expo Haptics. Haptic failures must not interrupt entry. Pressed keys change background immediately. Opening and closing animate the panel height over 220 ms so the form resizes with the keypad; the animation follows the system reduced-motion preference. The closed panel is excluded from touch and accessibility navigation.
