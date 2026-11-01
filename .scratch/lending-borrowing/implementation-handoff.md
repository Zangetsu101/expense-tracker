# Implementation handoff

Status: implementation, Android checks and sequential independent reviews complete. No commits. See [validation.md](validation.md) for exact checks, results and limits.

## Delivered

- Shared saved people, dedicated lending/borrowing routes reachable from Settings, all four money actions, aggregate repayments, separate person/direction/Currency totals and visible overpaid credit.
- Dated write-offs without Account/report effects, editable/deletable history, deletion confirmation and overpayment confirmation for saves/edits/deletions.
- Explicit assignment of all four imported principal kinds to existing Transactions, without duplicate movements. Unassigned histories and incompleteness notices remain visible.
- Four-direction report exclusion on import/keyed reimport and in the generic Transaction editor. Principal rows bypass transfer matching; legacy Review Queue candidates cannot consume principal or destroy linked history.
- Optional people/lending metadata in schema-v1 JSON backups, original import keys, atomic restore and backward compatibility. Backup snapshots read linked Transaction values, including notes edited through the generic editor.
- Decision recorded separately in `docs/adr/0003-lending-linked-transactions.md`.

## Final verification

- Typecheck passed.
- All 147 tests passed with `node --test $(rg --files src -g '*.test.mjs')`.
- Diff whitespace check passed. No mutation runner configured.
- Actual Android Expo Go checks covered manual and historical flows, separate currencies/directions, credit warnings, write-off edit/delete, validation recovery, reports/Account balances, generic editor, JSON export/restore and keyed reimport returning zero new Transactions.
- Standards reviewer: no hard violations; unused alias removed.
- Spec reviewer: two P1 transfer-path issues found, reproduced and fixed; refreshed snapshot rechecked with no residual actionable correctness findings in the delta.

## State preserved

The real index retains the prior staged `.gitignore`, product/importer policy and importer tests. Feature edits are unstaged or untracked; no broad staging or commit occurred. An isolated feature review snapshot lives at `/tmp/lending-review.index` and can be inspected with `GIT_INDEX_FILE=/tmp/lending-review.index git diff --cached HEAD`. Final staging belongs to the parent.

Private MoneyLover mappings were not opened, edited or applied. Parent/user attribution review remains separate, including pending spelling-alias confirmation. No MoneyLover data changes.

## Runtime and limitations

Metro remains in tmux session `lending-metro` on port 8081; Expo Go SDK 57 is installed on `emulator-5554`. Only our disposable app contains synthetic fixtures. Synthetic CSV/backups are in `/sdcard/Download/lending-synthetic.csv` and `/sdcard/Download/lending-check/`; local copies and test outputs are under `/tmp/lending-*`. No screenshots attached.

Android font scale restored to 1.0. iOS/web runtime and visible software-keyboard/very-large-picker stress checks remain unverified. See validation report rather than treating these as passed.
