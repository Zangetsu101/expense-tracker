# 0002 — Preserve MoneyLover import identity in Expo backups

## Status

Accepted

## Context

The Expo importer stores a row key and Transaction ID for each imported MoneyLover row. Without these keys, restoring a JSON backup and importing the same CSV again creates duplicate Transactions. Native backup v1 predates this table.

## Decision

Keep schema version 1 and add an optional top-level `moneyLoverImportRows` array of `{ rowKey, transactionId }` pairs. Native v1 readers ignore unknown JSON fields; Expo accepts backups without the array and restores them with no import keys. Export includes the array when the import table exists. Restore replaces the import keys in the same SQLite transaction as the financial records. Reject duplicate keys and references to missing Transactions before replacing anything.

## Consequences

A native v1 backup restores without import identities. The Expo importer refuses a CSV with matching unkeyed imported Transactions, so the user must resolve the ambiguity before reimporting. Expo backups made after an import retain the identities across restore. The JSON extension does not change the native v1 financial fields or their meaning.
