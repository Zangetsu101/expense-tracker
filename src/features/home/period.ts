export const homeRanges = [
  { range: 'week', label: 'This week' },
  { range: 'month', label: 'This month' },
  { range: '90d', label: 'Last 90 days' },
  { range: 'year', label: 'This year' },
] as const;

export type HomeRange = (typeof homeRanges)[number]['range'];
export type PeriodSetting = { range: HomeRange; monthStart: number };

/** Days are local dates as epoch days. `end` and `previousSameEnd` are exclusive. */
export type HomePeriod = {
  start: number;
  end: number;
  previousStart: number;
  previousSameEnd: number;
  label: string;
  previousLabel: string;
  rolling: boolean;
};

export const defaultPeriodSetting: PeriodSetting = { range: 'month', monthStart: 1 };
export const maxMonthStart = 28;

const months = [
  ['Jan', 'January'],
  ['Feb', 'February'],
  ['Mar', 'March'],
  ['Apr', 'April'],
  ['May', 'May'],
  ['Jun', 'June'],
  ['Jul', 'July'],
  ['Aug', 'August'],
  ['Sep', 'September'],
  ['Oct', 'October'],
  ['Nov', 'November'],
  ['Dec', 'December'],
] as const;

const dayMs = 86400000;
const toDay = (year: number, month: number, date: number) =>
  Math.floor(Date.UTC(year, month, date) / dayMs);
const parts = (day: number) => {
  const date = new Date(day * dayMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    date: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
};

export function shortDay(day: number): string {
  const { date, month } = parts(day);
  return `${date} ${months[month][0]}`;
}

export function homePeriod(setting: PeriodSetting, today: number): HomePeriod {
  const { year, month, date, weekday } = parts(today);
  const span = (
    start: number,
    previousStart: number,
    labels: [string, string],
    rolling = false,
  ) => ({
    start,
    end: today + 1,
    previousStart,
    previousSameEnd: Math.min(previousStart + (today - start + 1), start),
    label: labels[0],
    previousLabel: labels[1],
    rolling,
  });
  switch (setting.range) {
    case 'week': {
      const start = today - ((weekday + 1) % 7);
      return span(start, start - 7, [`Week of ${shortDay(start)}`, 'last week']);
    }
    case '90d': {
      const start = today - 89;
      return span(start, start - 90, ['Last 90 days', 'the 90 days before'], true);
    }
    case 'year':
      return span(toDay(year, 0, 1), toDay(year - 1, 0, 1), [String(year), String(year - 1)]);
    case 'month': {
      const first = setting.monthStart;
      const startMonth = date >= first ? month : month - 1;
      const start = toDay(year, startMonth, first);
      const labels: [string, string] =
        first === 1
          ? [months[(startMonth + 12) % 12][1], months[(startMonth + 11) % 12][1]]
          : [
              `${shortDay(start)} – ${shortDay(toDay(year, startMonth + 1, first) - 1)}`,
              'last cycle',
            ];
      return span(start, toDay(year, startMonth - 1, first), labels);
    }
  }
}

export function periodKey(setting: PeriodSetting): string {
  return `${setting.range}:${setting.monthStart}`;
}

export function parsePeriodSetting(value: string | null | undefined): PeriodSetting {
  try {
    const parsed = JSON.parse(value ?? '') as Partial<PeriodSetting>;
    const range = homeRanges.find((item) => item.range === parsed.range)?.range;
    if (!range) return defaultPeriodSetting;
    const monthStart =
      Number.isInteger(parsed.monthStart) &&
      parsed.monthStart! >= 1 &&
      parsed.monthStart! <= maxMonthStart
        ? parsed.monthStart!
        : 1;
    return { range, monthStart };
  } catch {
    return defaultPeriodSetting;
  }
}
