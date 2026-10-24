# Category presentation

Categories uses a recursive React Native taxonomy browser rather than a native grouped settings list. A root and its descendants share one rounded background; guides and rounded elbows retain the hierarchy. Tap changes disclosure, long press selects, and accessibility actions expose selection and disclosure separately.

Creation and rename use content-sized bottom sheets with scrollable forms capped at 82% of the window height. The approved compact presentation is not a full-height snap point. React Native form content is embedded with `RNHostView` on native platforms.

Expo UI 57's universal sheet does not expose Android swipe prevention, and its Android-only dismissal properties do not protect iOS. Small platform adapters therefore disable Android sheet gestures, back and outside dismissal while saving, and use iOS `interactiveDismissDisabled`. The web fallback uses a bottom-aligned React Native Modal. This keeps a failed write's draft and retry controls accessible. Successful writes close the draft; refreshing the list is a separate operation, so a refresh failure cannot retry the write.

Rename updates only the Category name, retaining its ID, type, parent and review status. Same-type names remain case-insensitively unique, matching creation. Mixed Category details are informational; this screen does not resolve their classification.
