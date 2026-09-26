# Expo proof-of-concept findings

The native app was never used for real data. Historical data comes from the MoneyLover export; the native app served as a design and implementation reference.

## Exercised on Android in Expo Go

- The transaction list reads SQLite. Quick-add saves Expense and Income amounts in minor units, with today's local date and a selected Account and Category.
- A synthetic MoneyLover nine-column CSV selected from Documents imported an Expense. The initial spike wrote signed rows individually and duplicated rows on reimport.
- JSON export created a document in a user-selected local Documents folder. Restore read a selected document via its `content://` URI and replaced SQLite rows after confirmation. An Android restore check confirmed that restoring a backup retained an earlier 12.34 Transaction and removed a 98.76 Transaction added after export.
- A synthetic backup modeled on the native serializer's unit-test sample restored Accounts, nested Categories, Transfers, Line Items, tags, transfer candidates, and display rate. Exporting after restore retained their row counts and rate. This was not a test with real user data.
- TypeScript, expo-doctor, and the backup-format fixture check passed during the spike.

## Implemented after the Android spike, not yet device-verified

- New MoneyLover imports record row identities. A matching CSV row without an identity stops with an ambiguity error. Expo JSON backups carry identities; native v1 backups do not. The importer merges uniquely corroborated Transfer pairs, queues uncertain pairs, plans curated parent Categories, and asks before splitting Mixed Categories. These paths have automated tests but have not been checked against representative MoneyLover data on Android.
- Quick-add selects a persisted favorite Account, orders Categories by recent use, and saves optional tags atomically. Accounts have fixed currencies and opening balances. Categories can have same-type parents. A flagged Category can be confirmed as its existing type, but not reclassified.
- Transaction search filters by text, type, Account, and month. Expense and Income edits support note, tags, Line Items, and `excludeFromReport`; the Transaction amount remains authoritative. Manual Transfers require same-currency Accounts.
- Reports show per-currency balances and monthly totals. An editable Display Rate combines two currencies for display only. CSV portability export uses an Android folder picker or the iOS share sheet; iOS has not been device-verified.
- Synthetic 10,000-row import tests cover deduplication, matching, and rollback, but not representative history. A later Expo Go check displayed Home and quick-add choices, saved a disposable 1.23 Expense with an older cached bundle, and found it through search after reloading the current bundle. Accounts, Categories, Reports, and the edit screen opened. The edit screen's Exclude switch label wrapped vertically; its layout was adjusted afterward but not rechecked on-device. Import, tag and Line Item saves, Display Rate edits, Transfers, CSV export, and backup/restore were not exercised in that check.

## Observed limits

- SQLite columns mirror the native Room entities, but this is not an on-disk Room database migration.
- Backup export uses the native backup v1 shape. Folder permission is not retained, so export prompts for a folder each time. Weekly unattended export and export-on-app-use are absent. The Display Rate is editable on the Reports screen, but that UI has not been device-verified.
- Native `Long` values above JavaScript's safe integer limit cannot round-trip through the current implementation.
- Cloud-backed document providers, canceled pickers, write failures, and backup/restore with representative MoneyLover-imported data were not tested. A synthetic CSV import was backed up and restored in an in-memory SQLite test. No cloud upload was attempted.
