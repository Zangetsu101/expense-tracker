# 0010 — Transfers between Currencies

A Transfer may join Accounts in different Currencies, including a Credit Card and its non-card parent. Store the amount paid in `amountMinor` and, only for different Currencies, the amount received in nullable `receivedAmountMinor`. Each Account balance and destination Bill uses its own side. Existing rows and old JSON v1 backups retain the paid amount on both sides when the optional received amount is absent.

The two amounts are authoritative. Derive the rate rather than storing a third value that could disagree after rounding or editing. Entry and edit share the same amounts block: typed amounts retain ownership, with the rate following when both are typed. Settlement presets count as typed received amounts. The first rate uses the Display Rate, then the last Transfer between the Currencies, then no rate. The Display Rate remains solely responsible for approximate Home totals; historical Transfer rates never change those totals and no gain or loss is recorded.

This supersedes the same-Currency Transfer and parent restrictions in ADRs 0004 and 0009. Expenses, Income, Person mode and MoneyLover Review Queue matching retain their existing Currency rules.
