# 0007 — Automatic backups to Google Drive

## Status

Accepted. This replaces the Storage Access Framework folder destination in 0006.

## Context

0006 saved automatic backups to a folder that the user chose with the Storage Access Framework. The Google Drive app does not let other apps create or write files through a folder (tree) URI. Users who chose a Drive folder got failed backups, so their data was not stored off the device.

## Decision

Automatic backups go to Google Drive through the Drive REST API. Google sign-in uses the original API of `@react-native-google-signin/google-signin`, because its silent sign-in and token calls work without an Activity, in the background task. The app asks only for the `drive.file` scope. With this scope, the app can see only the files that it created, and Google does not require an app verification.

Backups go in an app-created folder, "Expense Tracker Backups". The folder has an `appProperties` marker, so that a new install finds it again. Each file stores its transaction count in `appProperties`, so that the restore list does not download each file. The v1 JSON format does not change.

A manual copy uses the share sheet, so the user can choose "Save to Drive" or another app. A restore from a file still uses the document picker.

These rules from 0006 stay: one queue for all backup operations, a snapshot in one exclusive SQLite transaction, verification of each upload by downloading it again, 7 kept backups, and deletion only of tracked files and only after the new success is saved.

The first connect to an account never replaces existing backups without a choice. If the folder already has backups, the schedule stays Off until the user restores one or chooses to keep the phone's data. Without this rule, a new phone with no data makes empty backups, and after 7 backups retention removes all the real ones. A sign-in with the same account continues quietly. A different account, or a sign-in after Disconnect, uses the first-connect rule.

A network failure is quiet until the schedule misses more than one interval. Removed access, a full Drive and an overdue schedule show a warning in Settings and a banner on Home. The app sends no notifications.

## Consequences

A Google Cloud project with Android OAuth clients is necessary for each application ID and signing key (see `docs/google-drive-backups.md`). Sign-in fails with `DEVELOPER_ERROR` when the SHA-1 or the package name does not agree. The native module needs a new binary, so the app version changed. Backups need Google Play services.

The state is in the `driveBackups` setting. The old `scheduledBackups` setting and the files in the old folder stay but the app does not use them. A user who used the folder schedule must connect Google Drive.

iOS and web continue to have only the share sheet and the restore from a file.
