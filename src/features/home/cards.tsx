import { Suspense, useState, type ReactNode, type Ref } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, type TextStyle } from 'react-native';
import { useSuspenseQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { ErrorBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { RollingNumber } from '@/components/motion';
import { currencySymbol } from '@/lib/currency';
import { formatActivityDay, formatBalance } from '@/lib/transaction-format';
import type { DisplayRate } from '@/lib/display-rate';
import { theme } from '@/theme';
import { homeBalances } from './balances.ts';
import { pageDots, type DeckAccount, type DeckCard } from './deck.ts';
import { paceSummary } from './pace.ts';
import { periodKey, shortDay, type HomePeriod, type PeriodSetting } from './period.ts';
import { homePaceQuery, homeTrendQuery } from './queries.ts';
import { TrendChart } from './trend-chart.tsx';

const c = theme.colors;
export const cardHeight = 206;
export const cardGap = 12;
const cardPadding = 18;
const chartHeight = 58;
const hues = [
  '#2f5d50',
  '#2c4a6b',
  '#6b2c4f',
  '#4d5a2a',
  '#6b4a2c',
  '#2c5a6b',
  '#3a2c6b',
  '#6b3a2c',
];

/** A short amount for chart labels: ৳2.4L, $1.2k. */
export function compactMoney(minor: number, currency: string) {
  const value = Math.abs(minor) / 100;
  const symbol = currencySymbol(currency);
  const text =
    currency === 'BDT' && value >= 1e5
      ? `${(value / 1e5).toFixed(1)}L`
      : value >= 1000
        ? `${(value / 1000).toFixed(1)}k`
        : String(Math.round(value));
  return `${minor < 0 ? '−' : ''}${symbol}${text}`;
}

export type CardContext = {
  accounts: DeckAccount[];
  displayRate: DisplayRate | null;
  mainCurrency: string;
  now: Date;
  /** The period that the range pill shows. It changes at once. */
  period: HomePeriod;
  /** The period that the card bodies read. It lags behind `period` while new data loads. */
  shownSetting: PeriodSetting;
  stale: boolean;
  width: number;
  reset: () => void;
  onOpenPeriod: () => void;
};

/** The balance on the day that a touch on the chart selects. */
type Scrub = number | null;

export function HomeCard({
  card,
  index,
  context,
}: {
  card: DeckCard;
  index: number;
  context: CardContext;
}) {
  const [scrub, setScrub] = useState<Scrub>(null);
  const { accounts, displayRate, mainCurrency, period, stale, width } = context;
  const account = card.account;
  const summary = paceSummary({
    balances: homeBalances(accounts, null),
    pace: [],
    rate: displayRate,
    mainCurrency,
  });
  return (
    <View
      accessibilityLabel={account?.name ?? 'All accounts'}
      style={{
        width,
        minHeight: cardHeight,
        borderRadius: 22,
        borderCurve: 'continuous',
        padding: cardPadding,
        gap: 8,
        overflow: 'hidden',
        experimental_backgroundImage: `linear-gradient(135deg, ${account ? hues[index % hues.length] : '#24443b'}, ${c.root} 120%)`,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>
            {account ? `${account.name}${account.isFavorite ? ' ★' : ''}` : 'All accounts'}
          </Text>
          <Text style={{ color: c.text, opacity: 0.75, fontSize: 12 }}>
            {account ? account.currencyCode : `${accounts.length} accounts`}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Period, ${period.label}`}
          accessibilityState={{ busy: stale }}
          onPress={context.onOpenPeriod}
          style={{
            minHeight: 32,
            paddingHorizontal: 10,
            borderRadius: 16,
            backgroundColor: 'rgba(0,0,0,0.28)',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Text style={{ color: c.text, fontSize: 12.5, fontWeight: '600' }}>{period.label}</Text>
          {stale ? (
            <ActivityIndicator size="small" color={c.text} />
          ) : (
            <SymbolView
              name={{ ios: 'chevron.down', android: 'expand_more' }}
              size={16}
              tintColor={c.text}
            />
          )}
        </Pressable>
      </View>
      {card.face === 'trend' && scrub !== null ? (
        <Amount minor={scrub} currency={card.account.currencyCode} still />
      ) : account ? (
        <Amount minor={account.balanceMinor} currency={account.currencyCode} />
      ) : (
        <AllBalance summary={summary} />
      )}
      <CardBody card={card} context={context} onScrub={setScrub} />
    </View>
  );
}

const amountStyle: TextStyle = {
  color: c.text,
  fontSize: 28,
  fontWeight: '700',
  fontVariant: ['tabular-nums'],
};

/**
 * The digits roll to a new balance after a change. A scrubbed value is `still`,
 * because it changes faster than a roll can finish.
 */
function Amount({
  minor,
  currency,
  prefix = '',
  still = false,
}: {
  minor: number;
  currency: string;
  prefix?: string;
  still?: boolean;
}) {
  const value = `${prefix}${formatBalance(minor, currency)}`;
  if (!still) return <RollingNumber value={value} style={amountStyle} />;
  return (
    <Text selectable numberOfLines={1} adjustsFontSizeToFit style={amountStyle}>
      {value}
    </Text>
  );
}

function AllBalance({ summary }: { summary: ReturnType<typeof paceSummary> }) {
  if (summary.total && !summary.rate)
    return <Amount minor={summary.total.amountMinor} currency={summary.total.currencyCode} />;
  if (summary.total && summary.rate)
    return (
      <View>
        <Amount
          minor={summary.total.amountMinor}
          currency={summary.total.currencyCode}
          prefix="≈ "
        />
        <Text
          numberOfLines={1}
          style={{ color: c.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}
        >
          {summary.parts
            .map((part) => formatBalance(part.balanceMinor, part.currencyCode))
            .join(' + ')}{' '}
          · 1 {summary.rate.base} = {summary.rate.rate} {summary.rate.quote}
        </Text>
      </View>
    );
  const [main, ...rest] = summary.parts;
  if (!main) return <Amount minor={0} currency={summary.pace.currencyCode} />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
      <Amount minor={main.balanceMinor} currency={main.currencyCode} />
      <Text
        numberOfLines={1}
        style={{ color: c.muted, fontSize: 16, fontWeight: '700', flexShrink: 1 }}
      >
        {rest.map((part) => formatBalance(part.balanceMinor, part.currencyCode)).join(' · ')}
      </Text>
    </View>
  );
}

/** The chart or the Pace bar loads and fails on its own. The name, balance and pill stay. */
function CardBody({
  card,
  context,
  onScrub,
}: {
  card: DeckCard;
  context: CardContext;
  onScrub: (scrub: Scrub) => void;
}) {
  const { shownSetting, stale, reset } = context;
  return (
    <View
      pointerEvents={stale ? 'none' : 'auto'}
      accessibilityElementsHidden={stale}
      importantForAccessibility={stale ? 'no-hide-descendants' : 'auto'}
      style={{ flexGrow: 1, flexShrink: 0, justifyContent: 'flex-end', opacity: stale ? 0.4 : 1 }}
    >
      <ErrorBoundary
        resetKey={periodKey(shownSetting)}
        onReset={reset}
        fallback={(retry) => <CardBodyError retry={retry} />}
      >
        <Suspense fallback={<CardBodySkeleton face={card.face} />}>
          {card.face === 'trend' ? (
            <TrendBody
              key={periodKey(shownSetting)}
              account={card.account}
              context={context}
              onScrub={onScrub}
            />
          ) : (
            <PaceBody key={periodKey(shownSetting)} accountId={card.accountId} context={context} />
          )}
        </Suspense>
      </ErrorBoundary>
    </View>
  );
}

function TrendBody({
  account,
  context,
  onScrub,
}: {
  account: DeckAccount;
  context: CardContext;
  onScrub: (scrub: Scrub) => void;
}) {
  const { data } = useSuspenseQuery(homeTrendQuery(account.id, context.shownSetting, context.now));
  const [scrubbed, setScrubbed] = useState<number | null>(null);
  const { points, period } = data;
  const change = points[points.length - 1] - points[0];
  const low = Math.min(...points);
  const high = Math.max(...points);
  const currency = account.currencyCode;
  const chartWidth = context.width - cardPadding * 2;
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{
          color: scrubbed === null ? (change >= 0 ? c.accent : c.warning) : c.muted,
          fontSize: 13,
          fontVariant: ['tabular-nums'],
        }}
      >
        {scrubbed === null
          ? `${change >= 0 ? '+' : '−'}${formatBalance(Math.abs(change), currency)} since ${shortDay(period.start)}`
          : `End of ${formatActivityDay(period.start - 1 + scrubbed, context.now)}`}
      </Text>
      <TrendChart
        values={points}
        width={chartWidth}
        height={chartHeight}
        rising={change >= 0}
        label={`Balance since ${shortDay(period.start)}. Low ${formatBalance(low, currency)}, high ${formatBalance(high, currency)}.`}
        onScrub={(index) => {
          setScrubbed(index);
          onScrub(index === null ? null : points[index]);
        }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.muted, fontSize: 11 }}>
          {shortDay(period.start)} · low {compactMoney(low, currency)}
        </Text>
        <Text style={{ color: c.muted, fontSize: 11 }}>high {compactMoney(high, currency)}</Text>
      </View>
    </View>
  );
}

function PaceBody({ accountId, context }: { accountId: number | null; context: CardContext }) {
  const { data } = useSuspenseQuery(homePaceQuery(accountId, context.shownSetting, context.now));
  const { period, rows } = data;
  const scoped =
    accountId === null ? context.accounts : context.accounts.filter((a) => a.id === accountId);
  const { pace, paceOnly } = paceSummary({
    balances: homeBalances(scoped, null),
    pace: rows,
    rate: context.displayRate,
    mainCurrency: scoped.length === 1 ? scoped[0].currencyCode : context.mainCurrency,
  });
  const { spentMinor, sameMinor, previousMinor, currencyCode } = pace;
  const over = spentMinor > sameMinor;
  const max = Math.max(previousMinor, spentMinor, 1);
  const difference = formatBalance(Math.abs(spentMinor - sameMinor), currencyCode);
  const comparison =
    previousMinor === 0
      ? `No spending in ${period.previousLabel} to compare with`
      : `${difference} ${over ? 'more' : 'less'} than ${period.previousLabel}${period.rolling ? '' : ' by this point'}`;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.text, fontSize: 13 }}>
        Spent{' '}
        <Text style={{ fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {formatBalance(spentMinor, currencyCode)}
        </Text>
      </Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={comparison}
        style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.3)' }}
      >
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${(spentMinor / max) * 100}%`,
            borderRadius: 4,
            backgroundColor: over ? c.warning : c.accent,
          }}
        />
        {previousMinor > 0 && (
          <View
            style={{
              position: 'absolute',
              top: -4,
              bottom: -4,
              width: 2,
              left: `${(sameMinor / max) * 100}%`,
              backgroundColor: c.text,
            }}
          />
        )}
      </View>
      <Text
        numberOfLines={1}
        style={{
          color: previousMinor === 0 ? c.muted : over ? c.warning : c.accent,
          fontSize: 12.5,
        }}
      >
        {comparison}
      </Text>
      {paceOnly && new Set(scoped.map((a) => a.currencyCode)).size > 1 && (
        <Text style={{ color: c.muted, fontSize: 11.5 }}>
          Spending counts {paceOnly} accounts only
        </Text>
      )}
    </View>
  );
}

export function CardBodySkeleton({ face }: { face: DeckCard['face'] }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{
        gap: 6,
        height: face === 'trend' ? chartHeight + 40 : 60,
        justifyContent: 'flex-end',
      }}
    >
      <Skeleton width="45%" height={14} />
      <Skeleton width="100%" height={face === 'trend' ? chartHeight : 8} />
      <Skeleton width="70%" height={12} />
    </View>
  );
}

export function CardBodyError({ retry }: { retry: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <Text accessibilityRole="alert" style={{ color: c.warning, flex: 1 }}>
        Couldn’t load this card
      </Text>
      <RetryButton onPress={retry} />
    </View>
  );
}

export function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 40,
        paddingHorizontal: 16,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: c.warning,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: c.warning }}>Retry</Text>
    </Pressable>
  );
}

function AddAccountCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        width: 160,
        height: cardHeight,
        borderRadius: 22,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: c.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: c.muted, fontSize: 14 }}>+ Add an account</Text>
    </Pressable>
  );
}

export type DeckItem = { kind: 'card'; card: DeckCard } | { kind: 'add' };

export function Deck({
  initialIndex,
  cards,
  context,
  listRef,
  onScopeChange,
  onAddAccount,
}: {
  initialIndex: number;
  cards: DeckCard[];
  context: CardContext;
  listRef: Ref<FlatList<DeckItem>>;
  onScopeChange: (accountId: number | null) => void;
  onAddAccount: () => void;
}) {
  const items: DeckItem[] = [
    ...cards.map((card) => ({ kind: 'card' as const, card })),
    ...(context.accounts.length === 1 ? [{ kind: 'add' as const }] : []),
  ];
  const interval = context.width + cardGap;
  return (
    <FlatList
      ref={listRef}
      horizontal
      data={items}
      keyExtractor={(item) => (item.kind === 'add' ? 'add' : String(item.card.accountId))}
      showsHorizontalScrollIndicator={false}
      snapToInterval={interval}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: 20, gap: cardGap }}
      initialScrollIndex={initialIndex}
      getItemLayout={(_, index) => ({ length: interval, offset: interval * index, index })}
      onMomentumScrollEnd={(event) => {
        const settled = Math.min(
          cards.length - 1,
          Math.round(event.nativeEvent.contentOffset.x / interval),
        );
        onScopeChange(cards[settled].accountId);
      }}
      renderItem={({ item, index }) =>
        item.kind === 'add' ? (
          <AddAccountCard onPress={onAddAccount} />
        ) : (
          <HomeCard card={item.card} index={index} context={context} />
        )
      }
    />
  );
}

export function PageDots({ count, index }: { count: number; index: number }) {
  const dots = pageDots(count, index);
  if (!dots.length) return null;
  return (
    <View
      accessibilityLabel={`Card ${index + 1} of ${count}`}
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        height: 14,
      }}
    >
      {dots.map((dot) => {
        const size = dot.size === 'full' ? 6 : dot.size === 'medium' ? 4.5 : 3;
        return (
          <View
            key={dot.index}
            style={{
              width: dot.active ? 18 : size,
              height: dot.active ? 6 : size,
              borderRadius: 3,
              backgroundColor: dot.active ? c.accent : c.line,
            }}
          />
        );
      })}
    </View>
  );
}

export function DeckSkeleton({ width, children }: { width: number; children?: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 20 }}>
      <View
        style={{
          width,
          height: cardHeight,
          borderRadius: 22,
          padding: cardPadding,
          gap: 12,
          backgroundColor: c.surface,
          justifyContent: 'center',
        }}
      >
        {children ?? (
          <>
            <Skeleton width="40%" height={16} />
            <Skeleton width="65%" height={30} />
            <View style={{ flex: 1 }} />
            <Skeleton width="100%" height={8} />
            <Skeleton width="70%" height={12} />
          </>
        )}
      </View>
    </View>
  );
}
