# Lending and borrowing

Status: feature implemented and verified; historical attribution remains unapplied and separate. See validation.md.

## Goal

Review money lent and borrowed by person, record new principal movements and repayments, and retain full history without counting principal as ordinary spending or earned income. This is a high-level behavior spec; implementation details may follow existing app conventions.

## User-approved behavior

- Dedicated lending/borrowing view with a shared saved people list. Each person has a combined balance and full dated individual-entry history.
- Show amounts they owe the user and amounts the user owes them separately, never netted. Maintain separate totals per currency; no currency conversion or cross-currency repayment.
- Dedicated Add flow: Lend, Borrow, Receive repayment, Repay. Each money movement has person (Borrower for lending, Lender for borrowing), amount, Account, date, optional note.
- Repayments reduce that person's aggregate outstanding amount in the matching direction and currency; they are not assigned to individual loans. Partial repayments supported.
- Overpayments warn but can be saved. Preserve the excess visibly; do not silently create an opposite-direction obligation or clamp away history.
- Write-offs have date and optional note, reduce the selected obligation, stay in history, and affect neither Account balances nor reports.
- Entries are editable and deletable, with confirmation before deletion. Recalculate totals after edits/deletions. Confirm overpayment effects if an edit creates them.
- All principal movements affect Account balances in their natural direction but are excluded from spending/income reports.
- No due dates or reminders in first version.

## Historical data

MoneyLover Loan means principal lent out; Debt Collection means repayments received. Preserve these Categories and their transaction amounts/dates/Accounts. Existing importer excludes these direction-specific imported entries from reports on insert and keyed reimport; import identities remain derived from original CSV fields.

CSV has no Borrower/Lender field. Read-only extraction of MoneyLover Account -> Debts is complete: Loan corresponds to lending, Debt Collection to receipts, Debt to borrowing and Repayment to repayments made. All four principal movement kinds belong outside ordinary reports; preserve their natural Account balance effects.

Historical person attribution is being reviewed separately by the parent and user. Private extracted artifacts live in Git-ignored `.private/moneylover-debts/`. Link people to existing Transactions rather than creating duplicate account movements. Match using available source identities, date, amount, currency, Account and direction; surface ambiguity instead of guessing. Unassigned historical entries remain visible and retain amounts. Do not bulk-apply private mappings until approved. Keep source labels distinct unless the user confirms they identify the same person.

## Implementation acceptance

- Automated integration coverage for every money direction, separate person/currency totals, partial/overpayments, write-offs, edits/deletions and report exclusion.
- JSON backup/restore preserves people, entry links, write-offs and original import identities; backward-compatible restore of prior backups.
- Reimport never duplicates linked financial entries or erases person assignments.
- Preserve existing app data; use synthetic fixtures for tests and temporary local artifacts for personal extraction. MoneyLover inspection is read-only.
- Run typecheck and full tests, standards/spec review, and Android verification before reporting complete. Work sequentially with one implementation agent; ask the parent to arrange independent review after implementation instead of spawning reviewers.
- Existing partial implementation must be inspected and completed or corrected, not assumed valid. Preserve the separately reviewed staged import-policy changes and unrelated work. No commits without authorization.

## Implementation choices to document

Choose the schema and navigation consistent with the existing app. Clearly show overpaid credit separately from positive outstanding obligations. Do not infer missing historical people or present incomplete historical balances as reconciled.
