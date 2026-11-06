# Loading and retained content

The loading UI is being introduced one screen at a time, with review between screens. Home is the first implementation and now uses TanStack Query for its local reads. Other screens migrate separately.

## Agreed behavior

- First visits show layout skeletons with a soft shimmer. Related financial data appears together. Reduced motion uses static placeholders.
- On an Account or filter change, the control shows the requested selection immediately. Previous content stays visible, muted and inactive until the replacement is ready. Render previous data using its original scope, including Transfer direction.
- Loading feedback stays inside existing controls: shimmer, without added status rows or banners. Account pickers keep the chevron right aligned.
- Refreshing the same scope retains fully visible, usable content, with shimmer in the control.
- Failed Account changes stop shimmer, retain the requested selection and previous muted content, and show a warning border. A retry icon replaces the chevron. The name opens the picker; the icon retries. Both actions have separate accessible tap targets.
- Failed first loads replace skeletons with a compact Retry state inside the content area. Do not show an empty state before a successful read.
- Quick Add should expose amount and note immediately, retain the draft when choices arrive, and enable each mode once its own required choices are ready. Unrelated modes must not block it.

## Home

Accounts can become available before financial data. Quick Add uses the requested Account as soon as Accounts are known. Retained Transactions and scoped search wait for the matching financial data. Financial results, balances and displayed Account identity update together; abandoned requests cannot replace a later selection.

Home refreshes after committed writes and native foregrounding, and resets to the favorite Account on a true reopening. Suspense fallbacks and deferred rendering own first loads and scope transitions. Current balances retain the local-today policy in ADR 0005.

## Remaining screens

Apply these conventions to Reports, Accounts, Categories, Search, receipt/edit, entry forms, Review Queue, and lending screens as each is implemented and reviewed. Static Settings and Data tools do not need initial financial-data skeletons. Pagination and operation-specific progress will be resolved during their screen reviews.

Throwaway HTML comparisons are captured on the `prototype/loading-ui` branch; they are design history, not production components. The local implementation tracker is `.scratch/loading-ui/`.
