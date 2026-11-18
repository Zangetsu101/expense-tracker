import type { ReactNode } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { formatBalance } from '@/lib/transaction-format';
import { theme } from '@/theme';
import { ChangeBars, LineChart, ProgressMarks } from './charts.tsx';
import { trendHref } from '@/lib/report-links';
import { netWorth } from './net-worth.ts';
import { netWorthQuery, trendQuery } from './queries.ts';
import { minimumPeriods, moverRows, needsText, paceResult } from '@/lib/usual-spending';
import { c, LoadError, Note } from './view.tsx';

const art = { width: 96, height: 44 };

export function signed(minor: number, currency: string) {
  return `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${formatBalance(Math.abs(minor), currency)}`;
}
export function aboveText(nowMinor: number, usualMinor: number, currency: string) {
  const difference = nowMinor - usualMinor;
  return difference === 0
    ? 'Same as usual'
    : `${formatBalance(Math.abs(difference), currency)} ${difference > 0 ? 'above' : 'below'} usual`;
}

function TrendCard({
  title,
  head,
  headColor = c.text,
  note,
  picture,
  quiet = false,
  onPress,
}: {
  title: string;
  head: string;
  headColor?: string;
  note: string;
  picture: ReactNode;
  quiet?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${head}, ${note}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 64,
        backgroundColor: c.surface,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.group,
        borderCurve: 'continuous',
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: quiet ? c.muted : c.text, fontWeight: '700' }}>{title}</Text>
        <Text
          style={{
            color: quiet ? c.muted : headColor,
            fontSize: theme.type.heading,
            fontWeight: '700',
            fontVariant: ['tabular-nums'],
          }}
        >
          {head}
        </Text>
        <Note>{note}</Note>
      </View>
      {picture}
    </Pressable>
  );
}

function CardSkeleton({ title }: { title: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Loading ${title}`}
      style={{
        gap: theme.spacing.xs,
        minHeight: 64,
        backgroundColor: c.surface,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.group,
      }}
    >
      <Text style={{ color: c.text, fontWeight: '700' }}>{title}</Text>
      <Skeleton width="50%" height={20} />
      <Skeleton width="60%" height={12} />
    </View>
  );
}

type Scope = {
  accountId: number | undefined;
  currency: string;
  monthStart: number;
  today: number;
};

function PaceCard({ accountId, currency, monthStart, today }: Scope) {
  const { data } = useSuspenseQuery(trendQuery(accountId ?? null, 'month', monthStart, today));
  const pace = paceResult(data.rows, data.periods, today, currency);
  const open = () => router.push(trendHref('pace', accountId, currency));
  if (pace.status === 'notEnough')
    return (
      <TrendCard
        title="Pace"
        head={`${formatBalance(pace.spentMinor, currency)} so far`}
        note={needsText('month', pace.needed)}
        picture={<ProgressMarks done={minimumPeriods - pace.needed} total={minimumPeriods} />}
        quiet
        onPress={open}
      />
    );
  const above = pace.spentMinor > pace.usualMinor;
  return (
    <TrendCard
      title="Pace"
      head={aboveText(pace.spentMinor, pace.usualMinor, currency)}
      headColor={above ? c.warning : c.accent}
      note={`${formatBalance(pace.spentMinor, currency)} by day ${pace.dayOfPeriod}`}
      picture={
        <LineChart
          {...art}
          slots={pace.length}
          zeroBased
          band={{ low: pace.low, high: pace.high }}
          lines={[{ values: pace.spent, color: above ? c.warning : c.accent }]}
          accessibilityLabel="Spending so far against the usual range"
        />
      }
      onPress={open}
    />
  );
}

function MoversCard({ accountId, currency, monthStart, today }: Scope) {
  const { data } = useSuspenseQuery(trendQuery(accountId ?? null, 'month', monthStart, today));
  const movers = moverRows(data.rows, data.periods, today, currency, 'current');
  const open = () => router.push(trendHref('movers', accountId, currency));
  if (movers.status === 'notEnough')
    return (
      <TrendCard
        title="Movers"
        head="Not enough history"
        note={needsText('month', movers.needed)}
        picture={<ProgressMarks done={minimumPeriods - movers.needed} total={minimumPeriods} />}
        quiet
        onPress={open}
      />
    );
  const changed = movers.rows.filter((row) => row.nowMinor !== row.usualMinor);
  const label = (row: (typeof changed)[number]) =>
    `${row.name ?? 'Uncategorized'} ${signed(row.nowMinor - row.usualMinor, currency)}`;
  return (
    <TrendCard
      title="Movers"
      head={changed.length ? label(changed[0]) : 'No change against usual'}
      headColor={changed[0] && changed[0].nowMinor < changed[0].usualMinor ? c.accent : c.warning}
      note={changed.slice(1, 3).map(label).join(' · ') || `By day ${movers.dayOfPeriod}`}
      picture={
        <ChangeBars
          {...art}
          changes={changed.slice(0, 3).map((row) => row.nowMinor - row.usualMinor)}
        />
      }
      onPress={open}
    />
  );
}

/** One total, or one total and one line for each Currency when no Display Rate combines them. */
function NetWorthCard({ accountId, currency, today }: Omit<Scope, 'monthStart'>) {
  const { data } = useSuspenseQuery(netWorthQuery(accountId ?? null, today));
  const { series } = netWorth(data, 12);
  const [first] = series;
  const manyCurrencies = series.length > 1;
  return (
    <TrendCard
      title={accountId === undefined ? 'Net worth' : 'Balance'}
      head={series.map((item) => formatBalance(item.totalMinor, item.currencyCode)).join(' · ')}
      headColor={c.accent}
      note={
        manyCurrencies
          ? 'One total for each Currency'
          : `${signed(first.totalMinor - first.accounts[0], first.currencyCode)} in 12 months`
      }
      picture={
        <View style={{ gap: 4 }}>
          {series.map((item) => (
            <LineChart
              key={item.currencyCode}
              width={art.width}
              height={manyCurrencies ? (art.height - 4) / 2 : art.height}
              slots={item.accounts.length}
              lines={[{ values: item.accounts, color: c.accent }]}
              accessibilityLabel={`Total at each month end in ${item.currencyCode}`}
            />
          ))}
        </View>
      }
      onPress={() => router.push(trendHref('net-worth', accountId, currency))}
    />
  );
}

/**
 * Pace, Movers and Net worth. They follow the Account, but not the range. While the cards
 * of a new Account or Currency load, the old cards stay `muted`.
 */
export function TrendCards({ muted, ...scope }: Scope & { muted: boolean }) {
  const cards = [
    ['Pace', <PaceCard key="pace" {...scope} />],
    ['Movers', <MoversCard key="movers" {...scope} />],
    ['Net worth', <NetWorthCard key="net" {...scope} />],
  ] as const;
  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text
          style={{
            color: c.muted,
            fontSize: theme.type.caption,
            letterSpacing: 0.7,
            textTransform: 'uppercase',
          }}
        >
          Trends
        </Text>
        <Note>The range does not change these.</Note>
      </View>
      <View
        accessibilityElementsHidden={muted}
        importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
        style={{ gap: theme.spacing.md, opacity: muted ? 0.4 : 1 }}
      >
        {cards.map(([title, card]) => (
          <QueryBoundary
            key={title}
            pending={<CardSkeleton title={title} />}
            error={(retry) => <LoadError message={`Could not load ${title}.`} retry={retry} />}
          >
            {card}
          </QueryBoundary>
        ))}
      </View>
    </View>
  );
}
