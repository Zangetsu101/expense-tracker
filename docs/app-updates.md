# In-app updates

The update controller is shared across screens for the JS session. Settings → App updates provides manual checks and an explicit restart action. A passive root notice links to that screen when an update is ready. Opening the screen never restarts the app; confirmation warns about unsaved entries. Automatic checks and downloads never navigate, show alerts, or reload.

Startup and foreground transitions trigger quiet checks, with a 30-minute session cooldown measured from attempts (including failures) and Expo’s native last-check timestamp. Manual checks bypass the cooldown. The controller defers to native startup/check/download activity and observes cached pending updates through `useUpdates()`. When startup finishes, it coordinates another check only if the cooldown permits. Native startup configuration is unchanged.

SDK 57 `downloadProgress` supplies the displayed percentage; without it the UI uses an indeterminate downloading message. A download or reload error can be retried; automatic failures stay quiet. The controller serializes its operations and blocks additional calls while native startup work is active. Web, development and Expo Go do not call update APIs.

This change uses existing native modules only and is suitable for an OTA to a compatible installed release runtime. No runtime, channel, native configuration, or publish operation is part of this implementation. A real release-build check/download/restart still needs validation against an intentionally published compatible update.

Reference: https://docs.expo.dev/versions/v57.0.0/sdk/updates/
