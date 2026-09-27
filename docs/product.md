# Product scope (from the native app)

Expense-focused, single-user, local-first personal finance app importing MoneyLover history. The MoneyLover export is the source of truth for historical data; the unused native app is not a data source. The intended first release covers manual quick-add, balances, transaction search/filter, spending-by-category and monthly summaries, MoneyLover CSV import, and backup/export. Trends are deferred; budgets and recurring transactions are not planned. AI/LLM entry is out of scope for the Expo migration.

## Behavior to preserve

- Accounts have currencies; an Account's currency does not change once it has Transactions. Transfers are same-currency only. A separate editable display rate is used for combined cross-currency reporting.
- MoneyLover import maps signed amounts to Expenses/Income, preserves `Exclude Report`, and seeds a category taxonomy. Mixed categories need user confirmation; high-confidence transfer pairs merge, while uncertain pairs enter the Review Queue (see `docs/adr/0001-moneylover-transfer-reconstruction.md`). Import must be safe against duplicates.
- Spending-by-category excludes Transfers, Income, and Transactions marked `excludeFromReport`; month summaries show income and expense separately.
- Backup/restore preserves Transactions, Line Items, tags, transfers, Accounts, currencies, and Categories. CSV export is a portability format, not a full-fidelity backup.
- Quick-add is amount-first, defaults to Expense and a configurable favorite Account, and defaults the date to today. Category choices are recent-first. Note and tags are optional; `excludeFromReport` is set on edit, not quick-add.

This is intended behavior, not a claim that it works in Expo today. Native-platform plans such as SAF weekly exports and Android Auto Backup require a new Expo-specific design before implementation.
