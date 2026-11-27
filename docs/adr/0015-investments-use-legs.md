# 0015 Investments use signed Legs

## Decision

An Investment uses the same Account and balance rules as a liquid Account. The `investments` table marks the Account kind. A Valuation stores the difference between the new total and the balance on that date as one signed Leg. A Transfer recorded later with an earlier date changes the invested capital. The gain or loss from the Valuation stays the same.

A Dividend uses an Income Transaction on the liquid Account and a link to the Investment. This keeps the amount in the Currency that the liquid Account received. Reports count the Dividend as Income. The receiving Account stays liquid while the Dividend links to it. Only Transfers and Valuations change the Investment balance after creation or conversion. When a user converts a liquid Account, its past Transactions remain in place and its existing balance becomes invested capital.

SQLite schema version 2 rebuilds the constraint on Transaction kinds in one transaction. The migration preserves Transaction IDs and their child rows. This replaces the planned v2 export in ADR 0014. Backups of these ledgers use format v3. It extends the portable tables of v2 with Investments, Dividend links, and the Valuation kind. Restore still reads v1 and v2. Export keeps v1 for ledgers without Investments, preserving the export compatibility of the previous release for those ledgers.
