import { monthCycle, weekStart, type DayRange } from './periods.ts';
import type { SpendRow } from './reports';

export type PeriodKind = 'week' | 'month';

/** Usual is the median of this number of periods. */
export const usualPeriods = 6;
/** Usual needs this number of full periods with Expenses. */
export const minimumPeriods = 3;

/** The period that has `today`, then `back` periods before it, newest first. Weeks start on Saturday, as on Home. */
export function periodsBack(
  kind: PeriodKind,
  today: number,
  monthStart: number,
  back: number,
): DayRange[] {
  if (kind === 'month')
    return Array.from({ length: back + 1 }, (_, k) => monthCycle(today, monthStart, k));
  const start = weekStart(today);
  return Array.from({ length: back + 1 }, (_, k) => ({
    start: start - 7 * k,
    end: start - 7 * k + 7,
  }));
}

/** The text that says how many full periods usual still needs. */
export function needsText(kind: PeriodKind, needed: number) {
  return `Needs ${minimumPeriods} full ${kind}s · ${needed} more`;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function quantile(values: number[], position: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * position;
  return sorted[position < 0.5 ? Math.floor(index) : Math.ceil(index)] ?? 0;
}

/** The running total of the rows for each day from the start of the period. */
function dailyTotals(rows: SpendRow[], period: DayRange, length: number): number[] {
  const days = Array<number>(length).fill(0);
  for (const row of rows) {
    const index = row.date - period.start;
    if (index >= 0 && index < length && row.date < period.end) days[index] += row.amountMinor;
  }
  for (let index = 1; index < length; index++) days[index] += days[index - 1];
  return days;
}

const sumIn = (rows: SpendRow[], start: number, end: number) =>
  rows.reduce((sum, row) => (row.date >= start && row.date < end ? sum + row.amountMinor : sum), 0);

/**
 * The past periods that usual uses: at most 6, newest first, from the newest past
 * period to the oldest period that has an Expense. Null when fewer than 3 remain.
 */
function baseline(rows: SpendRow[], past: DayRange[]) {
  const used = past.slice(0, usualPeriods);
  let count = 0;
  used.forEach((period, index) => {
    if (sumIn(rows, period.start, period.end) > 0) count = index + 1;
  });
  return { periods: used.slice(0, count), needed: Math.max(0, minimumPeriods - count) };
}

export type PaceResult =
  | { status: 'notEnough'; spentMinor: number; needed: number }
  | {
      status: 'ready';
      spentMinor: number;
      /** The median of the past periods up to the same day. */
      usualMinor: number;
      /** The median of the full past periods. */
      usualFullMinor: number;
      periods: number;
      /** The day of the period that today is, from 1. */
      dayOfPeriod: number;
      length: number;
      projectedMinor: number;
      /** The amount for each day that is left to end the period at usual. Negative when spending is already above it. */
      leftPerDayMinor: number;
      /** Spending so far, one total for each day up to today. */
      spent: number[];
      /** Usual spending up to each day of the period, with the lower and the upper quartile. */
      usual: number[];
      low: number[];
      high: number[];
    };

/** `periods` is the output of periodsBack: the current period first. */
export function paceResult(
  allRows: SpendRow[],
  periods: DayRange[],
  today: number,
  currencyCode: string,
): PaceResult {
  const rows = allRows.filter((row) => row.currencyCode === currencyCode);
  const [current, ...past] = periods;
  const elapsed = today - current.start + 1;
  const spentMinor = sumIn(rows, current.start, today + 1);
  const { periods: used, needed } = baseline(rows, past);
  if (needed > 0) return { status: 'notEnough', spentMinor, needed };
  const length = current.end - current.start;
  const curves = used.map((period) => dailyTotals(rows, period, length));
  const at = (index: number) => curves.map((curve) => curve[index]);
  const usual = Array.from({ length }, (_, index) => median(at(index)));
  const usualFullMinor = median(used.map((period) => sumIn(rows, period.start, period.end)));
  const daysLeft = length - elapsed;
  return {
    status: 'ready',
    spentMinor,
    usualMinor: median(used.map((period) => sumIn(rows, period.start, period.start + elapsed))),
    usualFullMinor,
    periods: used.length,
    dayOfPeriod: elapsed,
    length,
    projectedMinor: Math.round((spentMinor / elapsed) * length),
    leftPerDayMinor: daysLeft > 0 ? Math.round((usualFullMinor - spentMinor) / daysLeft) : 0,
    spent: dailyTotals(rows, current, elapsed),
    usual,
    low: Array.from({ length }, (_, index) => quantile(at(index), 0.25)),
    high: Array.from({ length }, (_, index) => quantile(at(index), 0.75)),
  };
}

export type MoverRow = {
  id: number | null;
  name: string | null;
  nowMinor: number;
  usualMinor: number;
  children: Omit<MoverRow, 'children'>[];
};
export type MoversResult =
  | { status: 'notEnough'; needed: number }
  | {
      status: 'ready';
      rows: MoverRow[];
      totalNowMinor: number;
      totalUsualMinor: number;
      /** The day of the period that the comparison stops at, or null for a full period. */
      dayOfPeriod: number | null;
    };

type Compared = { nowMinor: number; usualMinor: number; name: string | null };
/** The largest increase first. */
const byChange = (a: Compared, b: Compared) =>
  b.nowMinor - b.usualMinor - (a.nowMinor - a.usualMinor) ||
  (a.name ?? '').localeCompare(b.name ?? '');

function compare(
  rows: SpendRow[],
  key: (row: SpendRow) => string,
  target: DayRange,
  used: DayRange[],
  span: number,
) {
  const keys = new Map<string, SpendRow>();
  for (const row of rows) if (!keys.has(key(row))) keys.set(key(row), row);
  return [...keys].map(([name, sample]) => {
    const own = rows.filter((row) => key(row) === name);
    return {
      sample,
      nowMinor: sumIn(own, target.start, target.start + span),
      usualMinor: median(used.map((period) => sumIn(own, period.start, period.start + span))),
    };
  });
}

/**
 * Each parent Category with its spending against usual. `current` compares the period so
 * far with the same days of the 6 periods before it. `last` compares the last full period
 * with the 6 full periods before it, so `periods` needs 8 entries.
 */
export function moverRows(
  allRows: SpendRow[],
  periods: DayRange[],
  today: number,
  currencyCode: string,
  mode: 'current' | 'last',
): MoversResult {
  const rows = allRows.filter((row) => row.currencyCode === currencyCode);
  const [target, ...past] = mode === 'current' ? periods : periods.slice(1);
  const { periods: used, needed } = baseline(rows, past);
  if (needed > 0) return { status: 'notEnough', needed };
  const span = mode === 'current' ? today - target.start + 1 : target.end - target.start;
  const tops = compare(rows, (row) => String(row.topId ?? row.categoryId), target, used, span);
  const result = tops
    .map(({ sample, nowMinor, usualMinor }) => {
      const id = sample.topId ?? sample.categoryId;
      const own = rows.filter((row) => (row.topId ?? row.categoryId) === id);
      const children = compare(own, (row) => String(row.categoryId), target, used, span)
        .map((child) => ({
          id: child.sample.categoryId,
          name: child.sample.categoryName,
          nowMinor: child.nowMinor,
          usualMinor: child.usualMinor,
        }))
        .filter((child) => child.nowMinor !== 0 || child.usualMinor !== 0);
      return {
        id,
        name: sample.topName ?? sample.categoryName,
        nowMinor,
        usualMinor,
        children: children.sort(byChange),
      };
    })
    .filter((row) => row.nowMinor !== 0 || row.usualMinor !== 0)
    .sort(byChange);
  return {
    status: 'ready',
    rows: result,
    totalNowMinor: sumIn(rows, target.start, target.start + span),
    totalUsualMinor: median(used.map((period) => sumIn(rows, period.start, period.start + span))),
    dayOfPeriod: mode === 'current' ? span : null,
  };
}
