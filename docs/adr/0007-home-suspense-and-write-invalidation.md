# 0007 — Home Suspense boundaries and write-driven invalidation

## Status

Accepted. Supersedes the explicit-loading and focus-invalidation portions of ADR 0006.

## Context

ADR 0006 migrated Home requests but preserved a manual coordinator for loading, focus and the last displayed snapshot. The intended migration should instead use TanStack Query's Suspense support and React's deferred rendering. The approved UI still requires immediate selection, retained muted content during changes, active content during background refresh, and an inline border/retry action after a failed switch.

## Decision

Read Accounts and the grouped financial snapshot with `useSuspenseQuery`. Use separate Suspense fallbacks for Accounts and financial content so the Account control and Add action can become usable before the financial query resolves. Ready financial views receive a required snapshot and have no first-load branches. Skeleton and cold-error views are distinct fallback components.

Keep the requested Account urgent and defer the financial request with `useDeferredValue`. React retains the previous subtree while the next request suspends. Compare requested and deferred scope to mute and disable stale content. Query fetching status drives shimmer for same-scope refresh; status-only query observers do not initiate reads.

Use an error boundary inside each Suspense boundary. It remembers only the last successfully committed request identity, not financial data. After a failed switch it renders that identity from Query's cache with muted, inactive content. Reset and retry inside a transition so the previous view remains visible while retrying. Key data-reader components by request identity so error recovery remounts the failed reader rather than reusing the retained reader's observer.

Keep one app-scoped Query client. Centralize AppState and data-change subscriptions in its provider. Native foreground state feeds Query's focus manager. A true background-to-active reopening advances the Accounts session key, resolving the favorite from fresh Accounts while transient inactivity keeps the selection. Requested selection is scoped to the session; an explicit selection made during recovery overrides the favorite.

Successful database write boundaries publish a data-change event after commit. The provider invalidates the Home query family and updates its local date. Failed writes and rolled-back transactions publish no event. This covers existing direct SQLite writes without migrating those screens to Query mutations. Home no longer enables/disables queries based on screen focus or invalidates data on every navigation.

Keep SQLite reads independent of connectivity with `networkMode: 'always'`, explicit retry, and no reconnect refetch. Cache keys continue to distinguish Account and local day. The cache stays in memory; SQLite remains authoritative.

## Consequences

The special failed-switch presentation has a small request-retaining error boundary; Suspense alone does not define error presentation. Query owns financial data and request state; React owns deferred rendering. The only effect in this integration subscribes to external app/data events.

Domain write modules depend on the data-change event, not on React or Query. TypeScript allows explicit `.ts` imports for that dependency so the existing Node SQLite test runners and Metro resolve the same module without new test-loader conventions.

Future query-backed screens can subscribe additional query families to the same committed-write event or add narrower mutation invalidation. They must preserve the rule that invalidation follows successful commit.
