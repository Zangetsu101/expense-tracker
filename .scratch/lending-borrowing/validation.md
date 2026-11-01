# Lending implementation validation

Status: implementation and reviews complete; no commit authorized or created. Historical attribution application remains separate and unapplied.

## Automated checks

- Final `pnpm exec tsc --noEmit`: passed.
- Final `node --test $(rg --files src -g '*.test.mjs')`: 147 tests passed, 0 failed. Includes component tests and SQLite integration tests. Output retained for this session at `/tmp/lending-final-full.tap`.
- `git diff --check`: passed.
- Focused tests ran throughout. Observed red before fixing borrowing/repayment import exclusion, linked/unassigned report inclusion through the generic editor, stale linked notes in backups, principal auto-transfer merging and conflicting historical transfer candidates.
- Integration coverage includes all four principal directions, person/direction/Currency totals, partial and excess repayments, confirmation effects on edits/deletions, write-offs, original import identities, keyed reimport, linked note editing, full-fidelity restore, older backup restore and atomic restore rollback.
- Mutation testing skipped: no mutation runner, package command or configuration exists in this repository. No mutation score claimed.

## Android functional checks

Used SDK 57 Expo Go on `emulator-5554`, with synthetic data only. No MoneyLover mutation or private attribution application. No screenshots attached.

- Reached Lending & borrowing through Settings, exercised empty people/history states, saved SyntheticAlice and opened the dedicated Add flow.
- Saved Lend 100 BDT, Borrow 60 BDT, Receive repayment 120 BDT and Repay 15 BDT. Confirmed the overpayment warning before saving; displayed lending credit 20 BDT separately from borrowing outstanding 45 BDT.
- Created and edited a borrowed write-off, cancelled deletion, then confirmed deletion. Totals recalculated. Edited repayment to zero, observed validation error with draft retained, corrected to 20 and saved; borrowing became 40 BDT.
- Created a USD Account, used Account/action pickers and Yesterday date choice to lend 10 USD. Separate USD lending and borrowing totals remained visible.
- Imported four synthetic historical movements, observed all four correct labels in Unassigned history, explicitly confirmed their assignments to the existing person, and confirmed assignment overpayment warnings. No extra Account movements were created; the unassigned view became empty.
- After historical assignment, totals were BDT 20 lent / 40 borrowed and USD 25 borrowed. A retained 1 BDT lending write-off reduced BDT lent to 19 without an Account movement. USD lent remained 10.
- Accounts showed BDT 20 and USD 15, matching the financial movements. November reports showed zero income, expense and spending in both currencies before any ordinary reportable fixture was introduced.
- Created JSON through Android SAF in a synthetic Downloads subfolder. First export contained 1 person, 8 lending entries, 8 Transactions and 4 original import keys. Restored it, reimported the same CSV and observed `0 transactions imported`; person assignments and totals survived.
- Opened a linked principal through the generic Transaction editor, observed the locked report-exclusion explanation, edited its note, saved and returned to the receipt with exclusion retained.
- Exported again after the generic note edit and retained write-off. JSON contained 10 lending entries, 9 Transactions, 4 import keys, the edited note and a write-off with null Transaction link. Restored this final backup and observed the same balances and write-off history.
- At system font scale 1.5, scrolled the Add form and verified Save/Cancel and date controls remained reachable. Restored scale 1.0 and cancelled the unsaved draft.
- Expo Go initially failed to accept injected text despite focused fields; restarting Expo Go resolved it. No application change was made for that transient runtime issue. Subsequent forms accepted input and persisted successfully.

## Reviews

Reviews used an isolated feature-only index at `/tmp/lending-review.index`; the real index and its prior staged importer policy and `.gitignore` changes were preserved. No nested or overlapping reviewers.

### Standards

Independent Standards review found no hard violations. Removed the optional unused alias. Broader CSV/SQL policy deduplication remains an optional refactor, not a correctness blocker.

### Spec

Independent Spec review found two P1 defects: automatic transfer reconstruction could consume principal rows, and legacy Review Queue confirmation could corrupt linked history. Reproduced both with synthetic integration tests, then fixed them:

- Principal rows bypass transfer matching but remain in Category planning and retain original import keys.
- Historical assignment resolves conflicting candidates atomically. Review Queue listing hides principal legs, and confirmation rejects them even if a stale candidate is reactivated.

The same independent Spec reviewer checked the refreshed isolated snapshot and reported no residual actionable correctness findings in the fix delta. Final full tests ran after those fixes.

## Limits and pending work

- iOS and web runtime behavior were not exercised. Android keyboard obstruction with a visible software IME and very large saved-people/Account lists were not stress-tested; the form and native picker contents are scrollable.
- Private historical attributions remain unapplied. User confirmation of spelling aliases is pending outside this feature.
- No commits made. Feature changes remain in the working tree; the parent may handle final staging. `/tmp/lending-review.index` is an inspection snapshot, not the repository index.
