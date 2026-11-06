# 0006 — Home uses TanStack Query for local reads

## Status

Accepted for the Home migration.

## Context

Home's loading UI distinguishes first loads, same-Account refreshes and changes of Account. A failed Account switch must retain the last displayed financial content with its original scope. Other screens still read and mutate SQLite directly.

## Decision

Use one app-scoped, in-memory TanStack Query client. Local reads use `networkMode: 'always'`, no automatic retries, and no network reconnect or window-focus refetch. SQLite remains the source of truth; the query cache is not persisted.

Home has an Accounts query and a grouped financial snapshot query under the `home` key prefix. The snapshot key includes Account identity and the local epoch day. The query reads balances, monthly summaries, daily summaries and recent Transactions together, with a single local date shared by the balance cutoff and report period.

Use `useQuery` for Home's current UI. Its explicit pending/error state supports the approved inline failure/retry behavior. Do not introduce Suspense boundaries or defer the selected Account in this iteration. Query options can also be consumed by a future Suspense implementation.

The presentation hook retains only the last successful displayed snapshot to preserve the prior scope after a failed switch. Query owns fetched data, caching, request deduplication, fetching state and errors. Changing keys isolates late results from the currently requested Account.

Invalidate the Home query family on screen focus and reopening. Queries are enabled while Home is focused. This refreshes data after edits, imports and restores made by screens that have not migrated. Inactive Account snapshots are also marked stale and refresh when selected. Ordinary focus preserves the selected Account; reopening resolves the favorite from refreshed Accounts. Reopening and focus also update the local date used in snapshot keys.

## Consequences

Cached results for an Account can appear immediately while refreshing. First visits without usable financial data retain shimmer skeletons. Related financial data is revealed together; same-Account refresh remains interactive. Failed reads expose explicit Retry immediately, including offline.

Future screen migrations should define their own query families and invalidate affected families after successful mutations. Once all relevant writes participate, Home's broad focus invalidation can be revisited. This change does not migrate other screens or add cache persistence, remote sync or optimistic mutations.
