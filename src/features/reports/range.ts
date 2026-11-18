import { dayParts, monthCycle, monthNames, toDay, type DayRange } from '@/lib/periods';

export type ReportRange = DayRange;
/** `monthStart` is the day of the month that Home sets (see `maxMonthStart`). `fiscalStart` is a zero-based month. */
export type RangeSettings = { monthStart: number; fiscalStart: number };

export const shortcuts = [
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'fiscalYear', label: 'This fiscal year' },
  { key: 'lastFiscalYear', label: 'Last fiscal year' },
  { key: 'year', label: 'This calendar year' },
  { key: 'lastYear', label: 'Last calendar year' },
] as const;
type ShortcutKey = (typeof shortcuts)[number]['key'];
const short = (month: number) => monthNames[month].slice(0, 3);

function yearFrom(today: number, firstMonth: number, back: number): ReportRange {
  const { year, month } = dayParts(today);
  const first = (month >= firstMonth ? year : year - 1) - back;
  return { start: toDay(first, firstMonth, 1), end: toDay(first + 1, firstMonth, 1) };
}

export function shortcutRange(
  key: ShortcutKey,
  today: number,
  settings: RangeSettings,
): ReportRange {
  switch (key) {
    case 'month':
      return monthCycle(today, settings.monthStart);
    case 'lastMonth':
      return monthCycle(today, settings.monthStart, 1);
    case 'fiscalYear':
      return yearFrom(today, settings.fiscalStart, 0);
    case 'lastFiscalYear':
      return yearFrom(today, settings.fiscalStart, 1);
    case 'year':
      return yearFrom(today, 0, 0);
    case 'lastYear':
      return yearFrom(today, 0, 1);
  }
}

export function matchingShortcut(
  range: ReportRange,
  today: number,
  settings: RangeSettings,
): ShortcutKey | null {
  return (
    shortcuts.find(({ key }) => {
      const other = shortcutRange(key, today, settings);
      return other.start === range.start && other.end === range.end;
    })?.key ?? null
  );
}

/** The number of full months in the range when both ends fall on `startDay`, or 0. */
function monthsOn(range: ReportRange, startDay: number): number {
  const a = dayParts(range.start);
  const b = dayParts(range.end);
  if (a.date !== startDay || b.date !== startDay) return 0;
  return Math.max(0, (b.year - a.year) * 12 + b.month - a.month);
}

function fullMonths(range: ReportRange, settings: RangeSettings) {
  for (const startDay of new Set([settings.monthStart, 1])) {
    const months = monthsOn(range, startDay);
    if (months > 0) return { months, startDay };
  }
  return null;
}

/** Moves a range of full months by its number of months, and any other range by its number of days. */
export function stepRange(range: ReportRange, delta: -1 | 1, settings: RangeSettings): ReportRange {
  const full = fullMonths(range, settings);
  if (!full) {
    const days = range.end - range.start;
    return { start: range.start + delta * days, end: range.end + delta * days };
  }
  const { year, month } = dayParts(range.start);
  const first = month + delta * full.months;
  return {
    start: toDay(year, first, full.startDay),
    end: toDay(year, first + full.months, full.startDay),
  };
}

/** False when the range has today or a later day. */
export function canStepForward(range: ReportRange, today: number): boolean {
  return range.end <= today;
}

function dateSpan(start: number, last: number): string {
  const a = dayParts(start);
  const b = dayParts(last);
  const left = `${a.date} ${short(a.month)}${a.year === b.year ? '' : ` ${a.year}`}`;
  return `${left} – ${b.date} ${short(b.month)} ${b.year}`;
}

/** The name of the range for the header, and a small line with its dates. */
export function rangeTitle(
  range: ReportRange,
  today: number,
  settings: RangeSettings,
): { name: string; dates: string } {
  const days = range.end - range.start;
  const progress = range.start <= today && today < range.end ? ' · in progress' : '';
  const span = dateSpan(range.start, range.end - 1);
  const first = dayParts(range.start);
  const full = fullMonths(range, settings);
  const count = `${days} ${days === 1 ? 'day' : 'days'}${progress}`;
  if (!full || full.startDay !== 1) return { name: span, dates: count };
  const dates = `${span}${progress}`;
  if (full.months === 1) return { name: `${monthNames[first.month]} ${first.year}`, dates };
  if (full.months === 12 && first.month === 0) return { name: String(first.year), dates };
  if (full.months === 12 && first.month === settings.fiscalStart)
    return { name: `FY ${first.year}–${String(first.year + 1).slice(-2)}`, dates };
  const last = dayParts(range.end - 1);
  const name =
    first.year === last.year
      ? `${short(first.month)} – ${short(last.month)} ${last.year}`
      : `${short(first.month)} ${first.year} – ${short(last.month)} ${last.year}`;
  return { name, dates };
}

export function parseFiscalStart(value: string | null | undefined): number {
  const month = Number(value);
  return /^\d{1,2}$/.test(value ?? '') && month >= 0 && month <= 11 ? month : 0;
}
