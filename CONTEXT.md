# Expense Tracker

## Language

**Transaction**:
A record of a movement of money, or of a Write-off that reduces what is owed. Its kind is Expense, Income, Transfer, lending, Write-off or reimbursement. A Transaction has one or more Legs.

**Leg**:
A part of a Transaction that moves a signed amount on exactly one Account or one Person, in the Leg's Currency. A positive Account Leg adds money to the Account. A positive Person Leg means that the person owes the user more, or that the user owes the person less.

**Expense**:
A Transaction that moves money out of an Account. It has one negative Account Leg.

**Income**:
A Transaction that moves money into an Account. It has one positive Account Leg.

**Transfer**:
A Transaction that moves money between two of the user's Accounts. It has two Account Legs. The source Leg is negative, and the destination Leg is positive. Each Leg has its own amount in its own Account's Currency.

**Direction**:
The obligation that a lending Transaction or a Write-off belongs to: LENT (a person owes the user) or BORROWED (the user owes a person). The two Directions are separate obligations.

**Write-off**:
A Transaction that reduces what is owed in one Direction without moving money. It has one Person Leg and no Account Leg.

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
The denomination of an Account's money. Each Account Leg uses its Account's Currency.

**Display Rate**:
A user-selected conversion rate used to compare totals across Currencies, not to change stored amounts.

**Category**:
An expense or income classification for an Expense or an Income. A Category may have a parent Category. Transfers, lending Transactions and Write-offs have none. In reports, a reimbursement uses the Category of its Expense.

**Line Item**:
An optional named component of a Transaction with an amount and optional quantity. The Transaction amount remains authoritative.
