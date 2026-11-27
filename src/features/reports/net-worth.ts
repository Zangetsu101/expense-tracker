import type { InvestmentBalance } from '@/lib/investments';
import { byMainCurrency } from '@/lib/currency';
import { convertTo, usableRate, type DisplayRate } from '@/lib/display-rate';
import type { LendingEntry } from '@/lib/lending';
import { lendingTotals } from '@/lib/lending-totals';
import { monthEndDay, monthIndex, type MonthIndex } from '@/lib/periods';

export type NetWorthAccount = {
  id: number;
  name: string;
  currencyCode: string;
  openingBalanceMinor: number;
  kind?: 'liquid' | 'investment' | 'card';
  investment?: InvestmentBalance;
};
/** The change of one Account in one calendar month. */
export type MonthChange = { accountId: number; month: MonthIndex; changeMinor: number };
export type LendingMove = Pick<
  LendingEntry,
  'personId' | 'kind' | 'currencyCode' | 'amountMinor' | 'date'
>;
export type NetWorthInput = {
  accounts: NetWorthAccount[];
  /** Changes on or before today only (ADR 0005). */
  changes: MonthChange[];
  lending: LendingMove[];
  rate: DisplayRate | null;
  mainCurrency: string;
  today: number;
};
export type NetWorthSeries = {
  currencyCode: string;
  /** The total of the Accounts at each point. */
  accounts: number[];
  liquidNet: number[];
  composition: { liquid: number; investment: number; card: number };
  /** The total of the Accounts, plus what people owe you, less what you owe, at each point. */
  withLending: number[];
  totalMinor: number;
  lending: { oweYouMinor: number; youOweMinor: number };
};
export type NetWorth = {
  /** One point for each month end, and today last. */
  points: { day: number }[];
  /** One series in the main Currency when the Display Rate converts all amounts, or else one for each Currency. */
  series: NetWorthSeries[];
  accounts: (NetWorthAccount & { balanceMinor: number; mainMinor: number | null })[];
};
export type NetWorthSpan = 6 | 12 | 'all';

function owed(lending: LendingMove[], day: number) {
  const totals = new Map<string, { oweYouMinor: number; youOweMinor: number }>();
  for (const total of lendingTotals(lending.filter((entry) => entry.date <= day))) {
    const row = totals.get(total.currencyCode) ?? { oweYouMinor: 0, youOweMinor: 0 };
    if (total.direction === 'LENT') row.oweYouMinor += total.outstandingMinor;
    else row.youOweMinor += total.outstandingMinor;
    totals.set(total.currencyCode, row);
  }
  return totals;
}

/** Net worth at each month end for the last `span` months, or from the first month with activity. */
export function netWorth(input: NetWorthInput, span: NetWorthSpan): NetWorth {
  const { accounts, rate, mainCurrency, today } = input;
  const ids = new Set(accounts.map((account) => account.id));
  const changes = input.changes.filter((change) => ids.has(change.accountId));
  const lending = input.lending.filter((entry) => entry.date <= today);
  const current = monthIndex(today);
  const first =
    span === 'all'
      ? Math.min(
          current,
          ...changes.map((change) => change.month),
          ...lending.map((entry) => monthIndex(entry.date)),
        )
      : current - span;
  const points = Array.from({ length: current - first + 1 }, (_, k) => ({
    month: first + k,
    day: first + k === current ? today : monthEndDay(first + k),
  }));
  const balanceAt = (account: NetWorthAccount, month: MonthIndex) =>
    changes.reduce(
      (sum, change) =>
        change.accountId === account.id && change.month <= month ? sum + change.changeMinor : sum,
      account.openingBalanceMinor,
    );
  const currencies = [...new Set([...accounts, ...lending].map((row) => row.currencyCode))].sort(
    byMainCurrency(mainCurrency),
  );
  const perCurrency = points.map(({ month, day }) => {
    const debts = owed(lending, day);
    return currencies.map((currencyCode) => {
      const owedHere = debts.get(currencyCode) ?? { oweYouMinor: 0, youOweMinor: 0 };
      const composition = { liquid: 0, investment: 0, card: 0 };
      for (const account of accounts) {
        if (account.currencyCode === currencyCode)
          composition[account.kind ?? 'liquid'] += balanceAt(account, month);
      }
      return {
        currencyCode,
        balance: composition.liquid + composition.investment + composition.card,
        ...composition,
        ...owedHere,
      };
    });
  });
  const usable = usableRate(rate);
  const inMain = (pick: (row: (typeof perCurrency)[number][number]) => number) =>
    perCurrency.map((rows) =>
      convertTo(
        rows.map((row) => ({ currencyCode: row.currencyCode, amountMinor: pick(row) })),
        usable,
        mainCurrency,
      ),
    );
  const combined = {
    accounts: inMain((row) => row.balance),
    liquid: inMain((row) => row.liquid),
    investment: inMain((row) => row.investment),
    card: inMain((row) => row.card),
    oweYou: inMain((row) => row.oweYouMinor),
    youOwe: inMain((row) => row.youOweMinor),
  };
  const ready = (values: (number | null)[]): values is number[] => values.every((v) => v !== null);
  const makeSeries = (
    currencyCode: string,
    balances: number[],
    liquid: number[],
    investment: number[],
    card: number[],
    oweYou: number[],
    youOwe: number[],
  ): NetWorthSeries => ({
    currencyCode,
    accounts: balances,
    liquidNet: liquid.map((value, k) => value + card[k]),
    composition: { liquid: liquid.at(-1)!, investment: investment.at(-1)!, card: card.at(-1)! },
    withLending: balances.map((value, k) => value + oweYou[k] - youOwe[k]),
    totalMinor: balances.at(-1)!,
    lending: { oweYouMinor: oweYou.at(-1)!, youOweMinor: youOwe.at(-1)! },
  });
  const series =
    ready(combined.accounts) &&
    ready(combined.liquid) &&
    ready(combined.investment) &&
    ready(combined.card) &&
    ready(combined.oweYou) &&
    ready(combined.youOwe)
      ? [
          makeSeries(
            mainCurrency,
            combined.accounts,
            combined.liquid,
            combined.investment,
            combined.card,
            combined.oweYou,
            combined.youOwe,
          ),
        ]
      : currencies.map((currencyCode, index) =>
          makeSeries(
            currencyCode,
            perCurrency.map((rows) => rows[index].balance),
            perCurrency.map((rows) => rows[index].liquid),
            perCurrency.map((rows) => rows[index].investment),
            perCurrency.map((rows) => rows[index].card),
            perCurrency.map((rows) => rows[index].oweYouMinor),
            perCurrency.map((rows) => rows[index].youOweMinor),
          ),
        );
  return {
    points: points.map(({ day }) => ({ day })),
    series,
    accounts: accounts.map((account) => {
      const balanceMinor = balanceAt(account, current);
      return {
        ...account,
        balanceMinor,
        mainMinor: convertTo(
          [{ currencyCode: account.currencyCode, amountMinor: balanceMinor }],
          usable,
          mainCurrency,
        ),
      };
    }),
  };
}
