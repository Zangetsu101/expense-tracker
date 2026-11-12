import { formatMoney, transactionTitle, type LendingLabel } from '@/lib/transaction-format';
import type { DeckCard } from './deck.ts';
import { homePeriod, shortDay, type PeriodSetting } from './period.ts';

/** A Transaction in the list under the deck. `categoryEmoji` is the emoji of its Category, or of the parent Category. */
export type ListRow = LendingLabel & {
  id: number;
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amountMinor: number;
  date: number;
  accountId: number;
  transferAccountId: number | null;
  accountName: string;
  transferAccountName: string | null;
  currencyCode: string;
  categoryName: string | null;
  parentCategoryName: string | null;
  categoryEmoji: string | null;
  note: string | null;
  excludeFromReport: number;
};

/**
 * The card in view. Its Account (`null` for All accounts) sets which rows show.
 * Its face sets the rule for the totals: Pace counts spending, Trend the change of the balance.
 * It picks from each kind of card, so that a Trend card still has an Account.
 */
export type ListScope = DeckCard extends infer Card
  ? Card extends DeckCard
    ? Pick<Card, 'face' | 'accountId'>
    : never
  : never;
export type Tone = 'normal' | 'income' | 'muted';
export type TotalPart = { text: string; tone: Tone };
export type RowIcon = { kind: 'transfer' } | { kind: 'category'; text: string };
export type RowView = {
  title: string;
  /** `null` when the row has no second line. */
  detail: string | null;
  amount: string;
  tone: Tone;
  icon: RowIcon;
};

/** A span of days in the list. `end` is exclusive. */
export type ListPeriod = { start: number; end: number; label: string };
export type PeriodRows = { period: ListPeriod; rows: ListRow[] };

export type ListItem =
  | { kind: 'row'; row: ListRow }
  | { kind: 'divider'; label: string; totals: TotalPart[] }
  | { kind: 'message'; text: string };
/** A day has a header that sticks while it scrolls. Other sections have no header. */
export type ListSection = {
  key: string;
  date: number | null;
  totals: TotalPart[];
  data: ListItem[];
};

/** On All accounts a Transfer shows its route. On one Account it says where the money went. */
function transferFace(
  row: ListRow,
  accountId: number | null,
): Pick<RowView, 'title' | 'amount' | 'tone'> {
  const amount = formatMoney('TRANSFER', row.amountMinor, row.currencyCode);
  if (accountId === null)
    return { title: `${row.accountName} → ${row.transferAccountName}`, amount, tone: 'muted' };
  if (row.transferAccountId === accountId)
    return { title: `From ${row.accountName}`, amount: `+${amount}`, tone: 'income' };
  return { title: `To ${row.transferAccountName}`, amount: `−${amount}`, tone: 'normal' };
}

/** On a Pace card, a grey amount is not in the day total. Only All accounts names the Account of a row. */
export function rowView(row: ListRow, scope: ListScope): RowView {
  if (row.type === 'TRANSFER')
    return {
      ...transferFace(row, scope.accountId),
      detail: row.note || 'Transfer',
      icon: { kind: 'transfer' },
    };
  const title = transactionTitle(row);
  const detail =
    scope.accountId === null ? [row.accountName, row.note].filter(Boolean).join(' · ') : row.note;
  return {
    title,
    detail: detail || null,
    amount: formatMoney(row.type, row.amountMinor, row.currencyCode),
    tone:
      scope.face === 'pace' && row.excludeFromReport
        ? 'muted'
        : row.type === 'INCOME'
          ? 'income'
          : 'normal',
    icon: {
      kind: 'category',
      text: row.categoryEmoji || [...(row.categoryName ?? title)][0].toLocaleUpperCase(),
    },
  };
}

function add(totals: Map<string, number>, currency: string, minor: number) {
  totals.set(currency, (totals.get(currency) ?? 0) + minor);
}
const byCurrency = (totals: Map<string, number>) =>
  [...totals].sort(([a], [b]) => a.localeCompare(b));

/** The rule of the Pace card: reportable Expenses and Income, without Transfers. */
function paceTotals(rows: readonly ListRow[]): TotalPart[] {
  const spent = new Map<string, number>();
  const earned = new Map<string, number>();
  for (const row of rows) {
    if (row.excludeFromReport || row.type === 'TRANSFER') continue;
    add(row.type === 'EXPENSE' ? spent : earned, row.currencyCode, row.amountMinor);
  }
  const parts: TotalPart[] = [];
  if (spent.size)
    parts.push({
      text: `Spent ${byCurrency(spent)
        .map(([currency, minor]) => formatMoney('TRANSFER', minor, currency))
        .join(' ')}`,
      tone: 'muted',
    });
  if (earned.size)
    parts.push({
      text: byCurrency(earned)
        .map(([currency, minor]) => `+${formatMoney('TRANSFER', minor, currency)}`)
        .join(' '),
      tone: 'income',
    });
  return parts;
}

/** The rule of the Trend card: the change of the balance of one Account. */
function balanceTotals(rows: readonly ListRow[], accountId: number): TotalPart[] {
  const net = new Map<string, number>();
  for (const row of rows) {
    const out =
      row.type === 'EXPENSE' || (row.type === 'TRANSFER' && row.transferAccountId !== accountId);
    add(net, row.currencyCode, out ? -row.amountMinor : row.amountMinor);
  }
  return byCurrency(net).map(([currency, minor]) => ({
    text: `${minor < 0 ? '−' : '+'}${formatMoney('TRANSFER', Math.abs(minor), currency)}`,
    tone: minor < 0 ? 'muted' : 'income',
  }));
}

/** Totals by the rule of the card above the list. */
export function listTotals(rows: readonly ListRow[], scope: ListScope): TotalPart[] {
  return scope.face === 'pace' ? paceTotals(rows) : balanceTotals(rows, scope.accountId);
}

/** One section for each day, newest day first. In a day, the rows keep their order. */
function daySections(rows: readonly ListRow[], totals: (rows: ListRow[]) => TotalPart[]) {
  const days = new Map<number, ListRow[]>();
  for (const row of rows) days.set(row.date, [...(days.get(row.date) ?? []), row]);
  return [...days]
    .sort(([a], [b]) => b - a)
    .map(([date, dayRows]): ListSection => ({
      key: `d${date}`,
      date,
      totals: totals(dayRows),
      data: dayRows.map((row) => ({ kind: 'row', row })),
    }));
}

/** The first period is the range of the cards. Each older period starts with a divider. */
export function listSections(periods: readonly PeriodRows[], scope: ListScope): ListSection[] {
  return periods.flatMap(({ period, rows }, index) => {
    const head: ListSection[] =
      index === 0
        ? []
        : [
            {
              key: `p${period.start}`,
              date: null,
              totals: [],
              data: [
                {
                  kind: 'divider',
                  label: period.label,
                  totals: rows.length
                    ? listTotals(rows, scope)
                    : [{ text: 'No change', tone: 'muted' }],
                },
              ],
            },
          ];
    if (!rows.length)
      head.push({
        key: `e${period.start}`,
        date: null,
        totals: [],
        data: [
          {
            kind: 'message',
            text: `No transactions in ${period.label}${index === 0 ? ' yet' : ''}.`,
          },
        ],
      });
    return [...head, ...daySections(rows, (dayRows) => listTotals(dayRows, scope))];
  });
}

/** Search results have day headers with no totals. */
export function searchSections(rows: readonly ListRow[]): ListSection[] {
  return daySections(rows, () => []);
}

const searchFields = (row: ListRow) => [
  row.note,
  row.categoryName,
  row.parentCategoryName,
  row.accountName,
  row.transferAccountName,
  row.personName,
];

export function matchesSearch(row: ListRow, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return searchFields(row).some((field) => field?.toLocaleLowerCase().includes(needle));
}

/** Splits `text` into the parts that match `query` and the parts that do not. */
export function markMatches(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];
  const lower = text.toLocaleLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts;
}

export function searchPlaceholder(setting: PeriodSetting, label: string): string {
  const range =
    setting.range === 'week' ? 'this week' : setting.range === '90d' ? 'the last 90 days' : label;
  return `Search transactions from ${range}`;
}

const yearOf = (day: number) => new Date(day * 86400000).getUTCFullYear();

/** The period `steps` before the range of the cards. Step 0 is the range of the cards. */
export function periodBack(setting: PeriodSetting, today: number, steps: number): ListPeriod {
  const current = homePeriod(setting, today);
  let period: ListPeriod = { start: current.start, end: current.end, label: current.label };
  for (let step = 0; step < steps; step++) {
    const older = homePeriod(setting, period.start - 1);
    const end = period.start;
    let label = older.label;
    if (older.rolling) label = `${shortDay(older.start)} – ${shortDay(end - 1)}`;
    else if (
      setting.range === 'month' &&
      setting.monthStart === 1 &&
      yearOf(older.start) !== yearOf(today)
    )
      label = `${label} ${yearOf(older.start)}`;
    period = { start: older.start, end, label };
  }
  return period;
}

/** The index in the section of the row of the Transaction `id`, or -1. */
export function rowIndex(section: ListSection, id: number): number {
  return section.data.findIndex((item) => item.kind === 'row' && item.row.id === id);
}
