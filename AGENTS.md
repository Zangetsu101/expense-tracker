# Expense Tracker Expo

Read `docs/migration-status.md` before changing the existing Expo screens, SQLite schema, MoneyLover import, or backup/restore. This repo is a disposable proof of concept, not a production port. In particular, do not use its CSV import or restore with irreplaceable data.

For migration scope and intended behavior, read `docs/product.md`. The MoneyLover export is the source of truth for historical data; the unused native app at `../expense-tracker` is a reference for prior design and experiments, not a source of user data. Record new cross-platform implementation decisions separately rather than rewriting historical ADRs.

Development runs in WSL; the Android emulator runs on Windows and ADB connects over TCP.

## Agent skills

### Issue tracker

Issues and specs live in local markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context repo: read the root glossary and relevant ADRs. See `docs/agents/domain.md`.
