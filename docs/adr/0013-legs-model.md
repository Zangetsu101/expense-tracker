# 0013 — Store Transaction amounts in Legs

## Status

Accepted. This changes how ADRs 0003 and 0010 store data. It does not change what they decide.

ADR 0014 replaces the paragraph about the JSON backup format.

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

LENDING and WRITE_OFF Transactions store a Direction, LENT or BORROWED. So the two separate obligations of ADR 0003 stay. The Direction and the sign of the Account leg give the six old lending kinds:

| Direction | Negative Account leg | Positive Account leg | No Account leg     |
| --------- | -------------------- | -------------------- | ------------------ |
| LENT      | LEND                 | RECEIVE_REPAYMENT    | WRITE_OFF_LENT     |
| BORROWED  | REPAY                | BORROW               | WRITE_OFF_BORROWED |

A Write-off is now a Transaction, so it has a date and a note like other Transactions. The `lending_entries` table goes away.

A Transfer between Currencies is two legs, and each leg has its own amount. `receivedAmountMinor` and `transferAccountId` go away. The two amounts stay authoritative, as ADR 0010 decides.

`reimbursements` and `split_shares` stay as tables, and ADR 0011 does not change.

Only EXPENSE and INCOME Transactions have a Category. A reimbursement still takes the Category of its Expense in reports. Lending Transactions have no Category. The migration deletes a Category when only lending Transactions use it and none of its children stay. Only EXPENSE, INCOME and REIMBURSEMENT keep `excludeFromReport`. The migration sets it to 0 for every other kind.

Settings become one `app_settings` row for each key. The portable keys are `favoriteAccountId` and `displayRate`. For `favoriteAccountId`, use the Account that is marked as favorite. If no Account is marked, use the favorite Account from the old settings JSON. Remove the obsolete `scheduledBackups` key (ADR 0007). Keep all other device-local rows.

The old app wrote on a connection where foreign keys were off. So an old database can have orphan rows: child rows whose parent row was deleted. The migration and the restore delete these rows, as `ON DELETE CASCADE` would have done. They find orphans before they give new ids to Write-offs, so an orphan cannot attach to a new Transaction. A Write-off gets the next id after the highest old Transaction id, in the order of the old lending entries. If an id is not a safe JavaScript integer, the migration or the restore stops. The app cannot delete an Account or a person, so a missing one is damaged data. If a Leg or a split share needs a missing Account or person, the migration or the restore stops with a clear error that names the row. A missing card parent Account does not stop it: the migration clears that link, as `ON DELETE SET NULL` would. Tags become unique without regard to letter case. If two old tags differ only in case, the migration and the restore keep the tag with the lowest id and move the links of the other tag to it.

The database enforces its rules with CHECK constraints and triggers. Expo opens a separate connection for exclusive writes, and foreign keys can be off on that connection. So triggers do the work of the foreign key actions, and they check the rules that span tables. Examples are the sign and target of each leg, the Currency of an Account leg, and the guards on deletes from ADR 0011.

The JSON backup format stays v1 for export and for restore. Export derives the v1 rows from the legs. Restore loads the v1 rows into the old table shapes in TEMP tables. Then it runs the same SQL as the migration to fill the new tables. So the migration and restore share one mapping.

The migration runs on the phone inside `database()`. It runs after the setup of the old schema, so every old table and column exists, and before anything else reads the database. A background task can start the app, so the migration does not wait for a screen. An app update can start offline, from a background task, or with Drive not connected, so the migration does not wait for the network. Before the migration, the app writes a v1 JSON backup to a file on the device. The file holds the cleaned data: it leaves out orphan rows and merges tags that differ only in case. The app keeps that file until the next successful Drive backup (ADR 0007). If it cannot write the file, it does not migrate.

Then, on the connection that does the migration, the app runs `PRAGMA foreign_keys = OFF` and then `BEGIN EXCLUSIVE`. It does not use `withExclusiveTransactionAsync`. That function starts the transaction before it runs its callback. SQLite ignores `PRAGMA foreign_keys` inside a transaction. The old tables are copied only to TEMP tables, so the database keeps no second copy of the data, and a failed migration can run again. Before the commit, run `PRAGMA foreign_key_check`. If it finds a violation, roll back. Set `PRAGMA user_version = 1` in the same transaction. This version marks the new schema. Turn foreign keys on again when the migration ends.

## Consequences

Balances for Accounts and People come from one table, so a query does not need to know each kind of Transaction. The triggers check each Leg when the app writes it. They cannot check the number of Legs, because the app writes the Legs one at a time. The app must write the complete set of Legs for each Transaction. The migration checks the complete sets.

Old backups restore without change, and new backups keep the v1 format. The cost is that export and restore must convert between v1 and the legs.

The migration does not copy MoneyLover data, such as import rows and transfer candidates. ADR 0012, "Remove the MoneyLover import", removes that feature.
