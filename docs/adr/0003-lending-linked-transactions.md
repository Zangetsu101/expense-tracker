# Lending metadata links to Transactions

Lending and borrowing use a shared saved people list and lending entries. Each principal movement links one existing or newly created Transaction; write-offs have no Transaction. This keeps Account balances authoritative in Transactions and avoids duplicating imported movements when assigning historical people. Entry history reads linked amounts, dates, notes and currencies from Transactions, including when exporting backups.

Totals group by person, Currency and obligation direction. Repayments and write-offs reduce aggregate principal rather than individual loans. Negative balances appear as overpaid credit, never as an opposite obligation. Writes that increase overpaid credit require confirmation, including edits and deletions.

All four direction-specific imported principal Categories are excluded from reports: Loan Expenses, Debt Collection Income, Debt Income and Repayment Expenses. Original CSV fields still determine import identities. Principal stays excluded when edited through the generic Transaction editor. Principal CSV rows bypass transfer matching; historical assignment resolves conflicting legacy transfer candidates, and the Review Queue hides and rejects principal legs so confirmation cannot erase lending history.

Backups retain schema version 1 with optional `people` and `lendingEntries` arrays, alongside import identities. Older backups restore with empty lending metadata. Validate links before replacement and restore metadata atomically with financial records.

The dedicated view is reachable from Settings. Historical assignment is explicit and links existing Transactions; it does not infer people or apply private mappings. Person balances carry an incompleteness notice rather than claiming reconciliation.
