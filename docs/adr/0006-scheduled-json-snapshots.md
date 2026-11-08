# 0006 — Scheduled JSON snapshots in Expo

## Status

Accepted

## Decision

Keep the portable v1 JSON backup format. On Android, select a Storage Access Framework directory once and store its URI locally. Offer daily/weekly schedules using expo-background-task, with overdue checks on launch and resume. Execution times are approximate and subject to OS restrictions. iOS and web scheduling remain unavailable until a durable external destination adapter is implemented.

Serialize manual JSON backup/restore and scheduled operations in one runtime queue. Read a snapshot in one exclusive SQLite transaction. Export unique documents and verify their text before recording success. Retain the newest seven verified documents tracked for the selected folder, deleting old documents only after a new success has been persisted. Never enumerate a folder to delete by filename. Folder changes leave previous files intact. Device-local destination and scheduling metadata are excluded from portable backups and survive financial restores.

## Consequences

New native dependencies require a new binary/runtime. Foreground catch-up remains useful when background execution is restricted. A revoked directory permission requires the user to reconnect the folder. Failed writes are removed when possible; process termination can leave an untracked incomplete document. Files are plain JSON and inherit the chosen destination's privacy and storage behavior. Off-device protection depends on choosing an appropriate destination.
