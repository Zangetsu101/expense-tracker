# Expo proof-of-concept findings

The native app was never used for real data. Historical data comes from the MoneyLover export; the native app served as a design and implementation reference.

## Exercised on Android in Expo Go

### Device test pass, 2026-10-24

Android emulator (API 36), Expo Go, bundle from Metro. The interrupted session's log records the checks below on user 0, not an isolated user. It exported the starting database, made temporary changes and imported a copy of the real CSV, then restored the starting backup. Its final export and starting export have identical SHA-256 hashes.

After resuming, Home and history showed the four starting Transactions. Before new writes, a fresh export also matched both surviving backups byte-for-byte. The user then explicitly authorized writes on user 0. The resumed pass repeated Accounts, Category add/rename, Quick add Expense and Income, Expense edits, Transfer create/edit, Reports, JSON backup/restore, CSV export, and synthetic CSV import. The USD Income check below is supported by the earlier session log; the resumed Income used BDT. Secondary-user testing was abandoned because the 2 GB emulator became unstable; no financial data was saved in that user. At the end of the resumed pass, the starting backup was restored again. Its fresh export matched the pre-test export byte-for-byte (SHA-256 `81b4c917450643e03fc51084fb9c6c1fd53752f9bbd2aba50d728a99ee7f3595`). The emulator was left on user 0, with the unused secondary user removed.

- Accounts: created a BDT Account with an opening balance; balances updated after Quick add, edits, and Transfers. After `eb86ccf`, group labels showed "1 account" and "2 accounts"; transaction search showed "1 result" and "0 results".
- Categories: added a root Expense Category and renamed it.
- Quick add: saved an Expense with a Category, note, tags, and yesterday's date, then an Income on a USD Account through "Add another".
- Expense edit: saved a note, tags (an existing tag is reused case-insensitively), a Line Item with quantity, and `excludeFromReport` on and off. The Receipt refreshed after each save.
- Transfers: created a same-currency Transfer. The destination sheet listed only same-currency Accounts. Opened Transfers from Home and search; the Receipt showed amount, From → To, date, and note. Edit saved a new amount, swapped Accounts, yesterday's date, and a note, then returned to the refreshed Receipt. Dirty Back asked to discard; clean Cancel did not.
- Reports: monthly Income, Expense, and Net, and spending by Category, matched the saved data. Transfers and excluded Transactions were left out. Account scope filtered to a single Account.
- JSON backup and restore: export wrote to a picked Documents folder. Restoring a synthetic imported backup, then importing the same CSV again, added 0 Transactions, so import identities survive backup (ADR 0002). Restore also kept Line Items and tags. A full real-import backup (9,715 imported Transactions plus 4 starting Transactions, 10,001 import identities) was exported, restored, and exported again; both 4.34 MB files were byte-identical.
- CSV export: wrote all Transactions with signed amounts, Transfer destinations, quoted commas, and exclusion flags.
- MoneyLover import, synthetic CSV: imported Expenses and Income, merged a corroborated Transfer pair, queued an uncertain pair, and asked before splitting a Mixed Category. Confirming the queued pair created one Transfer. Reimport added 0.
- MoneyLover import, real export (10,001 rows, a copy): imported 9,715 Transactions, including 286 merged Transfers, and queued 470 Review Queue candidates. Reimport added 0. June 2026 BDT totals in Reports (Income 1,088.00, Expense 117,003.00) matched totals computed from the raw CSV. Before the fix in `5b03beb`, the importer rejected this file: `624.05 * 100` is not an integer in floating point.

### Defects fixed during the pass

- D1, `5b03beb`: parse MoneyLover decimal text into exact minor units rather than multiplying a floating-point amount. The real CSV imported successfully after this fix.
- D2, `eb86ccf`: singular Account and result-count labels. Singular, plural, and zero labels were rechecked on-device.
- D3, `8b72cab`: full-import JSON export remained in encoding/validation for over five minutes before opening the picker. Snapshot instrumentation localized the delay to encoding. A synthetic Hermes probe took 160/753/3,228 ms for 250/500/1,000 rows. Replacing repeated JSON suffix copies with indexed numeric-token matching reduced those times to 36/73/161 ms. With probes removed and the app reloaded, the full-import export opened the picker within seconds and completed. Full-import JSON restore and re-export then retained identical contents.

D2 passed typecheck and all 122 tests before and after deslop. D3 passed typecheck and all 124 tests. Each fix received independent standards and spec reviews; final reviews had no findings.

### Earlier checks

- A synthetic backup modeled on the native serializer's unit-test sample restored Accounts, nested Categories, Transfers, Line Items, tags, transfer candidates, and display rate. Exporting after restore retained their row counts and rate.
- TypeScript, expo-doctor, and the backup-format fixture check passed during the spike.

## Not yet device-verified

- Display Rate editing, favorite Account changes, Category type confirmation for flagged Categories, Line Item removal, and the search filters other than text.
- Review Queue rejection, canceled pickers, write failures, cloud-backed document providers, and iOS (including the CSV share sheet).

## Observed limits

- SQLite columns mirror the native Room entities, but this is not an on-disk Room database migration.
- Backup export uses the native backup v1 shape. Folder permission is not retained, so every export prompts for a folder. Weekly unattended export and export-on-app-use are absent.
- Native `Long` values above JavaScript's safe integer limit cannot round-trip through the current implementation.
- The real export queues 470 Review Queue candidates. 144 of them have "Send to X" / "Received from Y" notes but "Other Expense" / "Gifts" categories, so ADR 0001 does not auto-merge them.
- Some restored synthetic data contains a cross-currency Transfer (BDT → USD). Restore accepts it, and balances count it 1:1. Manual Transfers and Transfer edits reject cross-currency Accounts, so such a Transfer cannot be saved from the edit screen without choosing same-currency Accounts.
