# 0005 — Account balances as of local today

## Status

Accepted

## Context

Account balances previously included every recorded Transaction, including future dates. Future-dated Transactions can exist through import, restore or editing even though Quick Add rejects them. Accounts and Home need the same meaning for a current balance.

## Decision

An Account balance is its opening balance plus Expenses, Income and both sides of Transfers dated on or before today. Transactions marked `excludeFromReport` still affect balances. Future-dated Transactions start affecting balances when their date arrives.

Today means the device’s local calendar date, calculated with `epochDay(new Date())`, matching Quick Add. `accountBalances(today = epochDay(new Date()))` binds this cutoff to its SQL query; its optional epoch-day argument supports deterministic tests. Apply the cutoff in the LEFT JOIN so Accounts with no qualifying Transactions retain their opening balances.

Accounts and Home must both use this one function. Do not add a separate projected balance.

## Consequences

Balances depend on the device’s local date and timezone when queried. Imported and restored future Transactions remain stored but do not affect current balances. This decision does not change monthly reports, date-entry validation or opening balances, which have no effective date.
