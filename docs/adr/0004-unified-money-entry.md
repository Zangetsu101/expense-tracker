# Unified manual money entry

Quick Add remains amount-first and defaults to Expense, the favorite Account and today. Expense, Income, Transfer and Person are explicit modes in the same form. Selecting Accounts, transfer destinations and people stays inline; Categories use recent-first search with their parent paths. This makes lending and borrowing available alongside everyday entry without inferring a money movement from a person's balance.

Person mode offers Lend, Borrow, They paid back and I paid back. It uses the existing lending links and overpayment confirmation from ADR 0003. Currency and obligation direction remain separate, and balances describe recorded history rather than reconciliation. Settings retains the dedicated history, historical assignment, editing and write-off tools.

All modes accept a date, optional note and comma-separated tags. Transfers remain between distinct same-currency Accounts. Tags and the money movement commit atomically. Successful saves close the form directly, without a Saved/Add another dialog; failures retain the draft. Overpayment confirmation remains required before a repayment creates more credit.

The accepted cross-platform design uses compact Account buttons with baseline-aligned currency labels, a centered page title, and the category selection's muted green fill and white text across selected controls. Prototype comparisons are preserved on branch `prototype/money-entry-accepted` at `f03537888ff92524cb9f39784464051cf9ee335b`.
