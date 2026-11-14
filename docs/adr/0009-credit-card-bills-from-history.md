# 0009 — Credit-card bills from recorded history

## Status

Accepted

## Decision

A Credit Card remains an Account with ordinary signed balances and Transactions. Its optional settings identify a same-Currency, non-card parent Account, statement day, and due day. The parent defaults the source of a Settlement; any distinct same-Currency Account can pay instead. Settlement uses Quick Add's existing Transfer mode.

Derive Bills from history rather than storing statement snapshots. Include the statement day, clamp days to the end of short months, and exclude Transactions after local today. Payments and refunds after the statement reduce the Bill before newer purchases. Limit the Bill to the amount still owed; excess credit stays visible separately. With no statement day, all owed is the Bill. A due day falls after its statement, and a Bill becomes overdue the day after its due date. Old Transaction edits therefore recalculate the Bill.

Show money in non-card Accounts separately from Bills. Card purchases retain their ordinary report date; Settlements add no spending. Card credit is excluded from money in non-card Accounts.

Store card settings as optional `creditCards` metadata in JSON v1 backups. Old backups restore without cards; new backups retain parent links. Restoring replaces settings atomically with Accounts and Transactions.

## Consequences

Bills describe recorded history, including imported history, rather than immutable issuer statements. This permits correction without statement reconciliation or a second payment ledger. Parent links cannot form card chains. Cross-Currency Transfers and parents remain a separate change to the Transfer model; the accepted follow-up design is saved in main's scratch folder.
