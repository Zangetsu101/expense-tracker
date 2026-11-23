# 0012 Remove the MoneyLover CSV import

## Status

Accepted. This decision supersedes ADRs 0001 and 0002 and the historical assignment in ADR 0003.

## Context

The owner completed the move from MoneyLover. The CSV import, the Review Queue for Transfers, and the assignment of imported lending Transactions served that move. Removing them before the schema change in ADR 0013 reduces the code that the next change must update.

## Decision

Remove the import, the Review Queue, the Mixed Category notice, and historical lending assignment. Remove the rules that identify lending by import source and Category name. The link from a lending entry to a Transaction continues to enforce report exclusion when the user edits that Transaction.

## Consequences

Existing Transactions and lending entries stay in the database. Existing report exclusion flags stay as saved. The SQLite schema stays in place for the next change.

- Only a link to a lending entry locks the “Exclude from reports” setting. The user can change this setting for an imported loan Transaction without a lending link. The app no longer lets the user assign that Transaction to a person.
- Category prediction now uses eligible Transactions in Categories marked for review and eligible imported loan Transactions without a lending link. It still skips Transactions with a lending link.
- Quick Add and Net Worth no longer warn that lending balances may be incomplete. The Lending overview includes only totals for saved people.

JSON v1 backups still export and restore import identities and transfer candidates. This preserves the data when a user restores and exports an older backup. CSV export remains available.
