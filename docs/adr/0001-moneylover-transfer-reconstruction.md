# 0001 — MoneyLover transfer reconstruction on import

## Status

Accepted

## Context

The app models money movement between own Accounts as a single **Transfer** Transaction. MoneyLover's CSV export does **not** export native transfers as linked records — each transfer appears as two unlinked single-sided rows (a negative on the source account, a positive on the destination account), with no shared id.

The migration is a one-time import of ~10k rows spanning 2019–2025. Getting it wrong pollutes 7 years of history, so fidelity matters.

A pure heuristic (same date + same absolute amount + opposite sign + different account) finds 628 candidate pairs but is too loose: ~150 are coincidental (e.g. `Other Expense`/`Gifts` same-day same-amount), which a naive merge would silently turn into fake transfers. The reliable corroborating signal is the note (e.g. "Send to Cash") combined with a transfer-ish category (Withdrawal / Deposit / Incoming transfer).

## Decision

Two-tier reconstruction:

1. **Auto-merge high-confidence pairs** — amount+date+account match **plus** corroborating note/category signal → merge into one Transfer.
2. **Review Queue for uncertain candidates** — amount+date+account match without strong corroboration → presented to the user in-app to confirm (merge) or reject (keep as two single-sided rows).

Everything with no match imports single-sided (Expense/Income by sign).

## Consequences

- High precision: no fake transfers baked silently into history.
- Costs one extra in-app screen (the Review Queue) and the pairing logic.
- Some real transfers may land in the queue rather than auto-merging — acceptable, the user resolves them once.
- Re-runnable only if import is idempotent; treated as a one-shot for v1.

## Alternatives considered

- **Aggressive auto-pair (all matches)**: ~150 wrong merges, rejected.
- **No reconstruction (all single-sided)**: faithful to rows but loses the Transfer semantics and distorts per-account flow; rejected.
- **Conservative auto-pair, no queue**: misses real transfers with weak signals and offers no recovery; rejected in favour of the queue.
