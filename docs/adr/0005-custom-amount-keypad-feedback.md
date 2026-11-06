# Custom amount keypad feedback

The amount-first Quick Add form retains its custom calculator keypad and arithmetic controls. It does not inherit system keyboard preferences or behavior.

A footer below the keys provides a down-chevron button to dismiss the keypad without changing the amount. Its 48-point touch target sits in a footer at least 52 points tall, including the bottom safe area rather than adding that inset again. This keeps the keys separate from the gesture bar with spacing similar to the on-screen keyboard.

Key presses request Android's native keyboard-tap haptic or a light iOS impact through Expo Haptics. Haptic failures must not interrupt entry. Pressed keys change background immediately. On all platforms, the keypad slides up when opened and down when dismissed, like a keyboard. Its full-height content is anchored to the top of an animated height container, so the keypad moves with the container's top edge while the form resizes. The container clips content below the screen edge. The animation takes 220 ms and follows the system reduced-motion preference. Safe-area padding is preserved. The closed panel is excluded from touch and accessibility navigation.
