# 0011 — Linked reimbursements lower spending

An Expense can be split with people. The Expense keeps the full amount that left the Account, so Account balances stay correct. Each share records what one person owes. When someone pays back, or a shop refunds a purchase, the money is a separate Transaction on the date it arrived, linked to one Expense. The link goes both ways: the Expense lists its reimbursements, and each reimbursement opens its Expense.

A linked reimbursement is not Income. It takes the Category of its Expense and lowers that Category's spending in reports. It counts in the month of its own date, not the month of the Expense. A report for a closed month therefore never changes when a payment arrives later, and Income does not include money that friends paid back. An unlinked Income Transaction keeps its own Category and counts as Income, as before.

Split shares are not lending entries. They do not change Person balances from ADR 0003, and Person mode's "They paid back" stays for loans only. A reimbursement can be larger than what the person still owes. The app warns but saves it, because a payment that is rounded up is normal and no balance becomes wrong.

You cannot delete an Expense that has linked reimbursements. Delete the reimbursements first. Without this rule, a reimbursement would lose its link and count as Income with no Category.

The accepted UI is recorded in the prototype for shared reimbursements. This ADR covers Add only. Recording reimbursements and changing splits from Edit come later.
