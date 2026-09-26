# Expense Tracker

## Language

**Transaction**:
A record of one movement of money, typed as an Expense, Income, or Transfer.

**Expense**:
A Transaction that moves money out of an Account.

**Income**:
A Transaction that moves money into an Account.

**Transfer**:
A Transaction that moves money between two of the user's Accounts without changing total wealth. Transfers involve Accounts with the same Currency.

**Account**:
A place money sits, such as cash, a bank account, or a credit card. MoneyLover calls this a “wallet.” An Account has one Currency.
_Avoid_: Wallet

**Currency**:
The denomination of an Account's money; Transactions in that Account use the same Currency.

**Display Rate**:
A user-selected conversion rate used to compare totals across Currencies, not to change stored amounts.

**Category**:
An expense or income classification for a Transaction. A Category may have a parent Category; Transfers have none.

**Mixed Category**:
A MoneyLover CSV category associated with both positive and negative amounts, so its expense/income classification is ambiguous.

**Line Item**:
An optional named component of a Transaction with an amount and optional quantity. The Transaction amount remains authoritative.

**Review Queue**:
Uncertain pairs of MoneyLover CSV rows that might represent Transfers and need user confirmation or rejection.
