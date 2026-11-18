import { dayParts, monthCycle, toDay, weekStart } from '@/lib/periods';

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

export function shortDay(day: number): string {
  const { date, month } = dayParts(day);
  return `${date} ${months[month][0]}`;
}

export function homePeriod(setting: PeriodSetting, today: number): HomePeriod {
  const { year } = dayParts(today);
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
      const start = weekStart(today);
      return span(start, start - 7, [`Week of ${shortDay(start)}`, 'last week']);
    }
    case '90d': {
      const start = today - 89;
      return span(start, start - 90, ['Last 90 days', 'the 90 days before'], true);
    }
    case 'year':
      return span(toDay(year, 0, 1), toDay(year - 1, 0, 1), [String(year), String(year - 1)]);
    case 'month': {
      const cycle = monthCycle(today, setting.monthStart);
      const startMonth = dayParts(cycle.start).month;
      const labels: [string, string] =
        setting.monthStart === 1
          ? [months[startMonth][1], months[(startMonth + 11) % 12][1]]
          : [`${shortDay(cycle.start)} – ${shortDay(cycle.end - 1)}`, 'last cycle'];
      return span(cycle.start, monthCycle(today, setting.monthStart, 1).start, labels);
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
