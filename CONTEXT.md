# Expense Tracker

## Language

**Transaction**:
A record of one movement of money, typed as an Expense, Income, or Transfer.

**Expense**:
A Transaction that moves money out of an Account.

**Income**:
A Transaction that moves money into an Account.

**Transfer**:
A Transaction that moves money between two of the user's Accounts. The amount paid belongs to the source Currency; when the Currencies differ, the amount received belongs to the destination Currency.

**Account**:
A place money sits, such as cash, a bank account, or a credit card. MoneyLover calls this a “wallet.” An Account has one Currency.
_Avoid_: Wallet

**Credit Card**:
An Account that tracks money owed to a card issuer. It may name another non-card Account as the default source for settlement.

**Bill**:
The amount owed at the most recent statement date, reduced by subsequent payments and refunds. Without a statement day, the Bill is all currently owed. Purchases after the statement are not billed yet.

**Settlement**:
A Transfer into a Credit Card that reduces what is owed, without adding spending.

**Currency**:
The denomination of an Account's money. Expenses and Income use their Account's Currency; each side of a Transfer uses its own Account's Currency.

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
