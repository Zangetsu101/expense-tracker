# 0013 — Transactions store their money in legs

## Status

Accepted. This changes how ADRs 0003 and 0010 store data. It does not change what they decide.

## Context

The old schema stored one Account and one amount on each Transaction. Other money movements needed extra columns and tables. A Transfer between Currencies used `transferAccountId` and `receivedAmountMinor`. Lending used `lending_entries`, and a write-off had no Transaction. So each query about balances had to know several shapes, and the database could not check that the shapes agreed.

## Decision

A Transaction has one or more legs. Each leg moves a signed amount on exactly one Account or one Person, in the Currency of that leg. A positive Account leg adds money to the Account. A positive Person leg means that the person owes the user more, or that the user owes the person less. The kind of the Transaction sets the shape of its legs:

| Kind          | Legs                                                                  |
| ------------- | --------------------------------------------------------------------- |
| EXPENSE       | One Account leg, negative                                             |
| INCOME        | One Account leg, positive                                             |
| TRANSFER      | Two Account legs: the source is negative, the destination is positive |
| LENDING       | One Account leg and one Person leg, with opposite signs               |
| WRITE_OFF     | One Person leg: negative for LENT, positive for BORROWED              |
| REIMBURSEMENT | One Account leg, positive, and a row in `reimbursements`              |

LENDING and WRITE_OFF Transactions store a Direction, LENT or BORROWED. So the two separate obligations of ADR 0003 stay. The Direction and the sign of the Account leg give the old lending kinds. For example, LENT with a negative Account leg is a loan, and LENT with a positive Account leg is a repayment. A Write-off is now a Transaction, so it has a date and a note like other Transactions. The `lending_entries` table goes away.

A Transfer between Currencies is two legs, and each leg has its own amount. `receivedAmountMinor` and `transferAccountId` go away. The two amounts stay authoritative, as ADR 0010 decides.

`reimbursements` and `split_shares` stay as tables, and ADR 0011 does not change.

Only EXPENSE and INCOME Transactions have a Category. A reimbursement still takes the Category of its Expense in reports. Lending Transactions have no Category. The migration deletes a Category when only lending Transactions use it and none of its children stay. Transfers, lending and Write-offs cannot be excluded from reports.

Settings become one `app_settings` row for each key. The portable keys are `favoriteAccountId` and `displayRate`. Device-local rows stay as they are.

The database enforces its rules with CHECK constraints and triggers. Expo opens a separate connection for exclusive writes, and foreign keys can be off on that connection. So triggers do the work of the foreign key actions, and they check the rules that span tables. Examples are the sign and target of each leg, the Currency of an Account leg, and the guards on deletes from ADR 0011.

The JSON backup format stays v1 for export and for restore. Export derives the v1 rows from the legs. Restore loads the v1 rows into the old table shapes in TEMP tables. Then it runs the same SQL as the migration to fill the new tables. So the migration and restore share one mapping.

The migration runs on the phone inside `database()`. It runs after the setup of the old schema, so every old table and column exists, and before anything else reads the database. A background task can start the app, so the migration does not wait for a screen. The app first makes a backup to Google Drive (ADR 0007). Then, on the connection that does the migration, it runs `PRAGMA foreign_keys = OFF` and then `BEGIN EXCLUSIVE`. It does not use `withExclusiveTransactionAsync`, because that function runs BEGIN first, and the PRAGMA has no effect inside a transaction. The old tables are copied only to TEMP tables, so the phone keeps no second copy of the data, and a failed migration can run again. `PRAGMA user_version = 1` marks the new schema.

## Verification

A script compared the facts from the old schema with the facts from the migrated schema, on real backups and on synthetic backups that use every feature. Known bugs were put into the migration and the schema on purpose, and the comparison found each one. Separate tests ran each trigger with foreign keys on and off.

## Consequences

Balances for Accounts and People come from one table, so a query does not need to know each kind of Transaction. The number of legs for each kind cannot be checked by a trigger, because a trigger sees only one row. The app code that writes Transactions must keep this rule.

Old backups restore without change, and new backups keep the v1 format. The cost is that export and restore must convert between v1 and the legs.

The migration does not copy MoneyLover data, such as import rows and transfer candidates. ADR 0012, "Remove the MoneyLover import", removes that feature.
