# 0012 Remove the MoneyLover CSV import

## Status

Accepted. This decision supersedes ADRs 0001 and 0002 and the historical assignment in ADR 0003.

## Context

The owner completed the move from MoneyLover. The CSV import, the Review Queue for Transfers, and the assignment of imported lending Transactions served that move. Removing them before the change to the legs model reduces the code that the next change must update.

## Decision

Remove the import, the Review Queue, the Mixed Category notice, and historical lending assignment. Remove the rules that identify lending by import source and Category name. The link from a lending entry to a Transaction continues to enforce report exclusion when the user edits that Transaction.

## Consequences

Existing Transactions and lending entries stay in the database. Existing report exclusion flags stay as saved. The SQLite schema stays in place for the next change.

JSON v1 backups still export and restore import identities and transfer candidates. This preserves the data when a user restores and exports an older backup. CSV export remains available.
