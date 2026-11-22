import { use, useDeferredValue, useState, type ReactNode } from 'react';
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, useWindowDimensions, View } from 'react-native';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { parseRouteId } from '@/lib/account-selection';
import { defaultCurrencyCode } from '@/lib/currency';
import { epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { formatBalance } from '@/lib/transaction-format';
import { theme } from '@/theme';
import { LineChart } from './charts.tsx';
import { parseKind, transactionsHref, type TrendParams } from '@/lib/report-links';
import { netWorth, type NetWorthSeries, type NetWorthSpan } from './net-worth.ts';
import { managedAccountsQuery, netWorthQuery, reportSettingsQuery, trendQuery } from './queries.ts';
import { dayParts, monthNames } from '@/lib/periods';
import { rangeTitle } from './range.ts';
import { aboveText, signed } from './trends.tsx';
import {
  moverRows,
  needsText,
  paceResult,
  usualPeriods,
  type MoverRow,
  type PeriodKind,
} from '@/lib/usual-spending';
import {
  c,
  Card,
  CategoryTree,
  Chip,
  Heading,
  LoadError,
  Note,
  ReportPage,
  scopeLabel,
  SegmentedSwitch,
} from './view.tsx';

const shortDay = (day: number) => {
  const { date, month } = dayParts(day);
  return `${date} ${monthNames[month].slice(0, 3)}`;
};
const thousands = (minor: number) => `${Math.round(minor / 100000)}k`;

function useToday() {
  return epochDay(useDeferredValue(use(QueryTimeContext)));
}

/** The Account, the Currency and the kind of period from the route. */
function useTrendScope() {
  const params = useLocalSearchParams<TrendParams>();
  const accountId = parseRouteId(params.accountId);
  const [{ data: accounts }, { data: settings }] = useSuspenseQueries({
    queries: [managedAccountsQuery(), reportSettingsQuery()],
  });
  const account = accounts.find((item) => item.id === accountId);
  const currency = account?.currencyCode ?? params.currency ?? defaultCurrencyCode;
  return {
    accountId: account?.id,
    currency,
    kind: parseKind(params.kind),
    monthStart: settings.monthStart,
    label: `${scopeLabel(account)}${account ? '' : ` · ${currency}`}`,
  };
}

function Headline({
  label,
  head,
  color,
  note,
}: {
  label: string;
  head: string;
  color: string;
  note?: string;
}) {
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text style={{ color: c.muted, fontSize: theme.type.detail }}>{label}</Text>
      <Text style={{ color, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {head}
      </Text>
      {note && <Note>{note}</Note>}
    </View>
  );
}

function NotEnough({ what, kind, needed }: { what: string; kind: PeriodKind; needed: number }) {
  return (
    <Card>
      <Heading>Not enough history</Heading>
      <Note>
        {what} compares with your usual amount. It needs 3 full {kind}s with Expenses in this
        Currency. {needsText(kind, needed)}.
      </Note>
    </Card>
  );
}

function Line({
  label,
  value,
  strong = false,
  color = c.text,
}: {
  label: string;
  value: string;
  strong?: boolean;
  color?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}>
      <Text style={{ color: c.text, flex: 1, fontWeight: strong ? '700' : '400' }}>{label}</Text>
      <Text style={{ color, fontVariant: ['tabular-nums'], fontWeight: strong ? '700' : '400' }}>
        {value}
      </Text>
    </View>
  );
}

function PageSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{ gap: theme.spacing.md }}
    >
      <Skeleton width="45%" height={14} />
      <Skeleton width="70%" height={28} />
      <Skeleton width="100%" height={160} />
    </View>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ReportPage title={title}>
      <QueryBoundary
        pending={<PageSkeleton />}
        error={(retry) => <LoadError message={`Could not load ${title}.`} retry={retry} />}
      >
        {children}
      </QueryBoundary>
    </ReportPage>
  );
}

function PaceContent() {
  const today = useToday();
  const scope = useTrendScope();
  const { width } = useWindowDimensions();
  const { data } = useSuspenseQuery(
    trendQuery(scope.accountId ?? null, scope.kind, scope.monthStart, today),
  );
  const pace = paceResult(data.rows, data.periods, today, scope.currency);
  const period = data.periods[0];
  const label = `${scope.label} · ${scope.kind === 'week' ? 'this week' : rangeTitle(period, today, { monthStart: scope.monthStart, fiscalStart: 0 }).name} so far`;
  const money = (minor: number) => formatBalance(minor, scope.currency);
  if (pace.status === 'notEnough')
    return (
      <>
        <Headline label={label} head={`${money(pace.spentMinor)} so far`} color={c.text} />
        <NotEnough what="Pace" kind={scope.kind} needed={pace.needed} />
      </>
    );
  const above = pace.spentMinor > pace.usualMinor;
  const color = above ? c.warning : c.accent;
  const lastDay = shortDay(period.end - 1);
  const projection = Array.from({ length: pace.length }, (_, index) =>
    index < pace.dayOfPeriod - 1
      ? pace.spent[index]
      : pace.spentMinor +
        ((index - pace.dayOfPeriod + 1) * (pace.projectedMinor - pace.spentMinor)) /
          Math.max(1, pace.length - pace.dayOfPeriod),
  );
  return (
    <>
      <Headline
        label={label}
        head={aboveText(pace.spentMinor, pace.usualMinor, scope.currency)}
        color={color}
        note={`${money(pace.spentMinor)} by day ${pace.dayOfPeriod} · usually ${money(pace.usualMinor)}`}
      />
      <Card>
        <LineChart
          width={width - 2 * theme.spacing.xl - 2 * theme.spacing.lg}
          height={180}
          slots={pace.length}
          zeroBased
          axis={thousands}
          band={{ low: pace.low, high: pace.high }}
          labels={[shortDay(period.start), lastDay]}
          lines={[
            { values: pace.usual, color: c.muted, dashed: true, thin: true },
            { values: projection, color, dashed: true, thin: true },
            { values: pace.spent, color },
          ]}
          accessibilityLabel={`Spending by day. ${money(pace.spentMinor)} so far, usually ${money(pace.usualMinor)} by day ${pace.dayOfPeriod}.`}
        />
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <Text style={{ color, fontSize: theme.type.caption }}>━ This {scope.kind}</Text>
          <Text style={{ color: c.muted, fontSize: theme.type.caption }}>
            ┄ Usual, with its range
          </Text>
        </View>
      </Card>
      <Card>
        <Line
          label={`At this pace by ${lastDay}`}
          value={`about ${money(pace.projectedMinor)}`}
          strong
          color={color}
        />
        <Line label={`Usual for a ${scope.kind}`} value={money(pace.usualFullMinor)} />
        <View style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: theme.spacing.md }}>
          {pace.leftPerDayMinor > 0 ? (
            <Line label="Left per day to end at usual" value={money(pace.leftPerDayMinor)} strong />
          ) : (
            <Note>
              {pace.length === pace.dayOfPeriod
                ? `Today is the last day of the ${scope.kind}.`
                : `You already spent more than the usual ${scope.kind}.`}
            </Note>
          )}
        </View>
      </Card>
      <Note>
        Usual is the median of the last {usualPeriods} {scope.kind}s at the same day. It uses{' '}
        {pace.periods} {pace.periods === 1 ? scope.kind : `${scope.kind}s`} now.
      </Note>
    </>
  );
}

export function PaceScreen() {
  return (
    <Page title="Pace">
      <PaceContent />
    </Page>
  );
}

function MoverValue({
  row,
  currency,
  largest,
  day,
  toggle,
  small,
}: {
  row: Omit<MoverRow, 'children'>;
  currency: string;
  largest: number;
  day: number | null;
  toggle?: { open: boolean };
  small: boolean;
}) {
  const change = row.nowMinor - row.usualMinor;
  let color: string = c.text;
  if (change > 0) color = c.warning;
  else if (change < 0) color = c.accent;
  const size = `${(Math.abs(change) / Math.max(1, largest)) * 50}%` as const;
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.sm }}
      >
        <Text style={{ color: c.text, flex: 1, fontSize: small ? theme.type.detail : undefined }}>
          {row.name ?? 'Uncategorized'}
          {toggle && <Text style={{ color: c.accent }}>{toggle.open ? ' ▾' : ' ▸'}</Text>}
        </Text>
        <Text
          style={{
            color,
            fontVariant: ['tabular-nums'],
            fontSize: small ? theme.type.detail : undefined,
          }}
        >
          {signed(change, currency)}
          {!toggle && row.id !== null && <Text style={{ color: c.accent }}> ›</Text>}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 6, backgroundColor: c.raised }}>
        <View
          style={{
            position: 'absolute',
            left: '50%',
            top: -3,
            bottom: -3,
            width: 1,
            backgroundColor: c.muted,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            borderRadius: 6,
            width: size,
            backgroundColor: color,
            ...(change >= 0 ? { left: '50%' } : { right: '50%' }),
          }}
        />
      </View>
      <Note>
        {formatBalance(row.nowMinor, currency)} {day === null ? 'spent' : 'so far'} · usually{' '}
        {formatBalance(row.usualMinor, currency)}
        {day === null ? '' : ` by day ${day}`}
      </Note>
    </View>
  );
}

function MoversContent() {
  const today = useToday();
  const scope = useTrendScope();
  const [mode, setMode] = useState<'current' | 'last'>('current');
  const { data } = useSuspenseQuery(
    trendQuery(scope.accountId ?? null, scope.kind, scope.monthStart, today),
  );
  const settings = { monthStart: scope.monthStart, fiscalStart: 0 };
  const names =
    scope.kind === 'week'
      ? ['This week so far', 'Last week']
      : [
          `${rangeTitle(data.periods[0], today, settings).name} so far`,
          rangeTitle(data.periods[1], today, settings).name,
        ];
  const movers = moverRows(data.rows, data.periods, today, scope.currency, mode);
  const target =
    mode === 'current' ? { start: data.periods[0].start, end: today + 1 } : data.periods[1];
  const switcher = (
    <SegmentedSwitch
      options={[
        { value: 'current' as const, text: names[0], label: names[0] },
        { value: 'last' as const, text: names[1], label: names[1] },
      ]}
      selected={mode}
      onSelect={setMode}
      fontSize={theme.type.detail}
    />
  );
  if (movers.status === 'notEnough')
    return (
      <>
        <Note>{scope.label}</Note>
        {switcher}
        <NotEnough what="Movers" kind={scope.kind} needed={movers.needed} />
      </>
    );
  const largest = Math.max(
    1,
    ...movers.rows
      .flatMap((row) => [row, ...row.children])
      .map((row) => Math.abs(row.nowMinor - row.usualMinor)),
  );
  const changed = movers.rows.filter((row) => row.nowMinor !== row.usualMinor);
  const same = movers.rows.length - changed.length;
  const total = movers.totalNowMinor - movers.totalUsualMinor;
  return (
    <>
      <Note>{scope.label}</Note>
      {switcher}
      <Headline
        label={`Against your usual${movers.dayOfPeriod === null ? ` for a full ${scope.kind}` : ` by day ${movers.dayOfPeriod}`}`}
        head={aboveText(movers.totalNowMinor, movers.totalUsualMinor, scope.currency)}
        color={total > 0 ? c.warning : c.accent}
      />
      {changed.length === 0 ? (
        <Note>No Category changed against usual.</Note>
      ) : (
        <CategoryTree<Omit<MoverRow, 'children'> & { amountMinor: number }>
          rows={changed.map((row) => ({
            ...row,
            amountMinor: row.nowMinor,
            children: row.children.map((child) => ({ ...child, amountMinor: child.nowMinor })),
          }))}
          currency={scope.currency}
          renderRow={(row, options) => (
            <MoverValue
              row={row}
              currency={scope.currency}
              largest={largest}
              day={movers.dayOfPeriod}
              {...options}
            />
          )}
          onOpenTransactions={(categoryId) =>
            router.push(transactionsHref(categoryId, target, scope.accountId))
          }
        />
      )}
      {same > 0 && (
        <Note>
          {same} {same === 1 ? 'Category' : 'Categories'} with no change
        </Note>
      )}
    </>
  );
}

export function MoversScreen() {
  return (
    <Page title="Movers">
      <MoversContent />
    </Page>
  );
}

const spans: { label: string; value: NetWorthSpan }[] = [
  { label: '6M', value: 6 },
  { label: '1Y', value: 12 },
  { label: 'All', value: 'all' },
];

function LendingCard({ series }: { series: NetWorthSeries }) {
  return (
    <Card>
      <Line
        label="People owe you"
        value={signed(series.lending.oweYouMinor, series.currencyCode)}
        color={c.accent}
      />
      <Line
        label="You owe people"
        value={signed(-series.lending.youOweMinor, series.currencyCode)}
        color={c.warning}
      />
      <View style={{ borderTopWidth: 1, borderColor: c.line, paddingTop: theme.spacing.md }}>
        <Line
          label="With lending"
          value={formatBalance(series.withLending.at(-1)!, series.currencyCode)}
          strong
          color={c.accent}
        />
      </View>
      <Note>Lending totals can be incomplete. Some old Transactions have no person.</Note>
    </Card>
  );
}

function NetWorthContent() {
  const today = useToday();
  const scope = useTrendScope();
  const { width } = useWindowDimensions();
  const [span, setSpan] = useState<NetWorthSpan>(12);
  const { data } = useSuspenseQuery(netWorthQuery(scope.accountId ?? null, today));
  const result = netWorth(data, span);
  const singleAccount = scope.accountId !== undefined;
  const combined = result.series.length === 1;
  const chartWidth = width - 2 * theme.spacing.xl - 2 * theme.spacing.lg;
  const first = result.points[0].day;
  const labels: [string, string] = [
    `${monthNames[dayParts(first).month].slice(0, 3)} ${dayParts(first).year}`,
    'Today',
  ];
  const headlineLabel = (currencyCode: string) => {
    if (singleAccount) return scope.label;
    if (combined && result.accounts.some((a) => a.currencyCode !== currencyCode))
      return `All Accounts, in ${currencyCode} at your Display Rate`;
    return `All Accounts in ${currencyCode}`;
  };
  return (
    <>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {spans.map((item) => (
          <Chip
            key={item.label}
            label={item.label}
            selected={span === item.value}
            onPress={() => setSpan(item.value)}
          />
        ))}
      </View>
      {result.series.map((series) => (
        <View key={series.currencyCode} style={{ gap: theme.spacing.lg }}>
          <Headline
            label={headlineLabel(series.currencyCode)}
            head={formatBalance(series.totalMinor, series.currencyCode)}
            color={c.accent}
            note={`${signed(series.totalMinor - series.accounts[0], series.currencyCode)} since ${labels[0]}`}
          />
          <Card>
            <LineChart
              width={chartWidth}
              height={170}
              slots={result.points.length}
              axis={thousands}
              labels={labels}
              lines={[
                ...(singleAccount
                  ? []
                  : [{ values: series.withLending, color: c.muted, dashed: true, thin: true }]),
                { values: series.accounts, color: c.accent },
              ]}
              accessibilityLabel={`Total at each month end, ${formatBalance(series.totalMinor, series.currencyCode)} today`}
            />
            {!singleAccount && (
              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                <Text style={{ color: c.accent, fontSize: theme.type.caption }}>━ Accounts</Text>
                <Text style={{ color: c.muted, fontSize: theme.type.caption }}>┄ With lending</Text>
              </View>
            )}
            <Note>One point for each month end, at the Display Rate of today.</Note>
          </Card>
        </View>
      ))}
      {!combined && <Note>Set a Display Rate in Settings to see one total.</Note>}
      <Card>
        {result.accounts.map((account) => (
          <Line
            key={account.id}
            label={
              account.mainMinor !== null && account.currencyCode !== result.series[0].currencyCode
                ? `${account.name} · ${formatBalance(account.balanceMinor, account.currencyCode)}`
                : account.name
            }
            value={
              account.mainMinor === null
                ? formatBalance(account.balanceMinor, account.currencyCode)
                : formatBalance(account.mainMinor, result.series[0].currencyCode)
            }
            color={account.balanceMinor < 0 ? c.warning : c.text}
          />
        ))}
      </Card>
      {singleAccount ? (
        <Note>
          Lending does not show for one Account. A lending entry has no link to an Account.
        </Note>
      ) : (
        result.series.map((series) => <LendingCard key={series.currencyCode} series={series} />)
      )}
    </>
  );
}

export function NetWorthScreen() {
  const { accountId } = useLocalSearchParams<TrendParams>();
  return (
    <Page title={accountId ? 'Balance' : 'Net worth'}>
      <NetWorthContent />
    </Page>
  );
}
