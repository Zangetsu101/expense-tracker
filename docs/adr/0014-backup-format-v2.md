# 0014 — Backup format v2 follows the Legs model

## Status

Accepted. This decision replaces the backup paragraph of ADR 0013. The rest of ADR 0013 does not change.

## Context

ADR 0013 kept the JSON backup format at v1. Export derived the v1 rows from the legs, and restore loaded them through the TEMP tables of the migration. That kept a rollback to the app before the legs model possible. But each export had to rebuild old fields such as `lendingEntries`, `transferAccountId` and `receivedAmountMinor`, and it wrote placeholders for fields that no longer exist. `backup.ts` also checked the v1 rows again in JavaScript, so most rules of the legs model had a second copy.

The new schema is now in use on the phone, and a Drive backup from it succeeded.

## Decision

Export writes backup schema version 2. Restore reads v1 and v2.

A v2 file is a copy of the portable tables. It has one array for each table: `accounts`, `creditCards`, `categories`, `people`, `transactions`, `legs`, `lineItems`, `tags`, `transactionTags`, `splitShares` and `reimbursements`. It also has `settings` with `favoriteAccountId` and `displayRate`. The field names are the column names, such as `kind` and `date`. Booleans are JSON booleans. Every array is required.

- The legs are a separate array, not a part of each Transaction. So export and restore use one simple statement for each table.
- A leg has no id in the file, because no row points to a leg. The legs are in order by Transaction, and then in the order that the app reads them in. So an export after a restore gives the same file.
- Each leg keeps its `currencyCode`, as the schema does. A Person leg needs it. For an Account leg, the database checks that it matches the Account.
- v2 has no `lendingEntries`, `transferAccountId`, `receivedAmountMinor`, `type`, `source`, `isFavorite`, `needsReview`, `transferCandidates` or `moneyLoverImportRows`.

A v2 restore is strict. Only the new app writes v2, and its triggers delete the child rows of a deleted row. So a v2 file with orphan rows is damaged, and the restore refuses it. Only a v1 restore repairs orphan rows, as ADR 0013 decides.

JavaScript checks only the structure of a v2 file: the types, the safe integers, the allowed values and the unique ids. The database checks the meaning. The restore deletes the current data and inserts the rows in one exclusive transaction. Then it runs `PRAGMA foreign_key_check` and the ledger checks of the migration. If a check fails, the transaction rolls back and no data changes.

A v1 restore does not change. It still uses the TEMP tables and the fill SQL of the migration. The backup that the app writes before the migration also stays v1, because it reads the old schema.

The change ships in two releases. The first release reads v2 but still writes v1. The second release writes v2. So a rollback from the second release to the first can still read every backup.

## Considered options

- Keep v1. This keeps the rollback to the app before the legs model, but export and restore must convert between v1 and the legs for as long as the app exists.
- Put the legs inside each Transaction. A person can read that file more easily, but restore must convert it back to rows, and the format no longer follows the schema.

## Consequences

The app before the legs model cannot read a v2 file. It cannot open the migrated database either. So after the second release, a return to that app needs a v1 backup from before the second release.

An error in a v2 restore names the rule of the ledger check, such as "a Transfer with the wrong legs: 12", not the field in the JSON file.

In v2, a Write-off is a Transaction. So the count of Transactions in a backup includes Write-offs, and the count in the Drive list changes.
