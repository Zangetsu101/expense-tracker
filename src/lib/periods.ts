/** Local dates are epoch days: whole days since 1 January 1970, with no time zone. */

/** Local dates as epoch days. `end` is exclusive. */
export type DayRange = { start: number; end: number };
/** A calendar month as `year * 12 + zero-based month`, so that months count like numbers. */
export type MonthIndex = number;

export const dayMs = 86400000;

export const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** A month that is out of range rolls into the next or the previous year, as in Date.UTC. */
export const toDay = (year: number, month: number, date: number) =>
  Math.floor(Date.UTC(year, month, date) / dayMs);

export function dayParts(day: number) {
  const date = new Date(day * dayMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    date: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

/** The date as YYYY-MM-DD. */
export const isoDay = (day: number) => new Date(day * dayMs).toISOString().slice(0, 10);

/** The month cycle that starts on day `monthStart`, `back` cycles before the one that has `today`. */
export function monthCycle(today: number, monthStart: number, back = 0): DayRange {
  const { year, month, date } = dayParts(today);
  const first = (date >= monthStart ? month : month - 1) - back;
  return { start: toDay(year, first, monthStart), end: toDay(year, first + 1, monthStart) };
}

/** The first day of the week that has `today`. Weeks start on Saturday. */
export function weekStart(today: number): number {
  return today - ((dayParts(today).weekday + 1) % 7);
}

export function monthIndex(day: number): MonthIndex {
  const { year, month } = dayParts(day);
  return year * 12 + month;
}

/** The last day of a calendar month. */
export function monthEndDay(month: MonthIndex): number {
  return toDay(Math.floor(month / 12), (month % 12) + 1, 1) - 1;
}
