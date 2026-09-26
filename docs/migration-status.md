# Expo proof-of-concept findings

The native app was never used for real data. Historical data comes from the MoneyLover export; the native app served as a design and implementation reference.

## Exercised on Android in Expo Go

- The transaction list reads SQLite. Quick-add saves Expense and Income amounts in minor units, with today's local date and a selected Account and Category.
- A synthetic MoneyLover nine-column CSV selected from Documents imported an Expense. The initial spike duplicated rows on reimport. New imports record row identities, so reimporting the same file skips those rows; Transactions without import identities, including those imported before that change, may overlap a CSV; a matching CSV now stops with an ambiguity error instead of silently duplicating them. Expo JSON backups carry import identities, while native v1 backups do not. The initial spike wrote signed rows individually. The current importer merges uniquely corroborated Transfer pairs, queues uncertain pairs, plans curated parent Categories, and asks before splitting Mixed Categories into Expense and Income Categories. These newer paths have automated tests but have not been checked against representative MoneyLover data on Android.
- JSON export created a document in a user-selected local Documents folder. Restore read a selected document via its `content://` URI and replaced SQLite rows after confirmation. An Android restore check confirmed that restoring a backup retained an earlier 12.34 Transaction and removed a 98.76 Transaction added after export.
- A synthetic backup modeled on the native serializer's unit-test sample restored Accounts, nested Categories, Transfers, Line Items, tags, transfer candidates, and display rate. Exporting after restore retained their row counts and rate. This was not a test with real user data.
- TypeScript, expo-doctor, and the backup-format fixture check passed during the spike.

## Observed limits

- SQLite columns mirror the native Room entities, but this is not an on-disk Room database migration.
- Backup export uses the native backup v1 shape. Folder permission is not retained, so export prompts for a folder each time. Weekly unattended export and export-on-app-use are absent. Display rate can be preserved from a backup but has no settings UI.
- Native `Long` values above JavaScript's safe integer limit cannot round-trip through the current implementation.
- Cloud-backed document providers, canceled pickers, write failures, and backup/restore with representative MoneyLover-imported data were not tested. No cloud upload was attempted.
