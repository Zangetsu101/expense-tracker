import { Suspense, use, useDeferredValue, useRef, useState, type ReactNode } from 'react';
import { FlatList, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import Animated, { LinearTransition } from 'react-native-reanimated';
import {
  QueryErrorResetBoundary,
  useMutation,
  usePrefetchQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/query-error-boundary';
import { defaultCurrencyCode, epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { AccountSheet, HomeTitle } from './account-sheet.tsx';
import {
  Deck,
  DeckSkeleton,
  PageDots,
  RetryButton,
  type CardContext,
  type DeckItem,
} from './cards.tsx';
import { cardIndex, deckCards } from './deck.ts';
import { PeriodSheet } from './period-sheet.tsx';
import { homePeriod, periodKey, type PeriodSetting } from './period.ts';
import { cachePeriodSetting, homeDeckQuery, homeListQuery } from './queries.ts';
import { savePeriodSetting } from './read-home.ts';
import {
  ActivityError,
  ActivityList,
  ActivitySkeleton,
  HomeLayout,
  RefreshNotice,
  SearchField,
} from './view.tsx';
import { theme } from '@/theme';

const pageGutter = 20;
const cardPeek = 44;

function ActivityContent({
  accountId,
  now,
  muted,
}: {
  accountId: number | null;
  now: Date;
  muted: boolean;
}) {
  const { data } = useSuspenseQuery(homeListQuery(accountId, now));
  return <ActivityList list={data} muted={muted} />;
}

function Home({ reset }: { reset: () => void }) {
  const now = useDeferredValue(use(QueryTimeContext));
  const client = useQueryClient();
  const { width } = useWindowDimensions();
  const { data: deck, error, refetch } = useSuspenseQuery(homeDeckQuery(now));
  const cards = deckCards(deck.accounts);
  const [selected, setSelected] = useState(() => cards[0].accountId);
  const [setting, setSetting] = useState(() => deck.period);
  const [sheet, setSheet] = useState<'period' | 'accounts' | null>(null);
  const deckRef = useRef<FlatList<DeckItem>>(null);
  const savePeriod = useMutation({
    mutationFn: savePeriodSetting,
    onSuccess: (_, saved) => cachePeriodSetting(client, now, saved),
  });

  const index = cardIndex(cards, selected);
  const scope = cards[index].accountId;
  const shownScope = useDeferredValue(scope);
  const shownSetting = useDeferredValue(setting);
  const favorite = deck.accounts.find((account) => account.isFavorite) ?? deck.accounts[0];
  const today = epochDay(now);
  const period = homePeriod(setting, today);
  const name = cards[index].account?.name ?? 'All accounts';

  const selectScope = (accountId: number | null) => {
    if (accountId === scope) return;
    // A failed read for this scope must fetch again when the deck returns to it.
    reset();
    setSelected(accountId);
  };
  const changePeriod = (next: PeriodSetting) => {
    reset();
    setSetting(next);
    savePeriod.mutate(next);
  };
  const context: CardContext = {
    accounts: deck.accounts,
    displayRate: deck.displayRate,
    mainCurrency: favorite?.currencyCode ?? defaultCurrencyCode,
    now,
    period,
    shownSetting,
    stale: periodKey(setting) !== periodKey(shownSetting),
    width: width - pageGutter - cardPeek,
    reset,
    onOpenPeriod: () => setSheet('period'),
  };
  return (
    <HomeLayout
      title={<HomeTitle name={name} onPress={() => setSheet('accounts')} />}
      quickAddAccountId={scope ?? favorite?.id ?? null}
      accountsReady
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <RefreshNotice failed={!!error} onRetry={() => void refetch()} />
        <Animated.View layout={LinearTransition} style={{ gap: 8 }}>
          {/* A new order mounts a new deck that opens on the same Account. */}
          <Deck
            key={cards.map((card) => card.accountId).join()}
            index={index}
            cards={cards}
            context={context}
            listRef={deckRef}
            onScopeChange={selectScope}
            onAddAccount={() => router.push('/accounts')}
          />
          <PageDots count={cards.length} index={index} />
          <View style={{ paddingHorizontal: pageGutter, paddingTop: 6 }}>
            <SearchField accountId={scope} name={scope === null ? 'all transactions' : name} />
            <ErrorBoundary
              resetKey={`${shownScope}:${today}`}
              onReset={reset}
              fallback={(retry) => <ActivityError retry={retry} />}
            >
              <Suspense fallback={<ActivitySkeleton />}>
                {/* A new reader for each scope: TanStack Query does not fetch again when a
                    mounted reader switches to a failed query, even after reset(). */}
                <ActivityContent
                  key={String(shownScope)}
                  accountId={shownScope}
                  now={now}
                  muted={scope !== shownScope}
                />
              </Suspense>
            </ErrorBoundary>
          </View>
        </Animated.View>
      </ScrollView>
      {sheet === 'period' && (
        <PeriodSheet
          setting={setting}
          label={period.label}
          onChange={changePeriod}
          onDismiss={() => setSheet(null)}
        />
      )}
      {sheet === 'accounts' && (
        <AccountSheet
          cards={cards}
          selectedId={scope}
          onSelect={(accountId) => {
            setSheet(null);
            selectScope(accountId);
            deckRef.current?.scrollToIndex({
              index: cardIndex(cards, accountId),
              animated: true,
            });
          }}
          onAddAccount={() => {
            setSheet(null);
            router.push('/accounts');
          }}
          onDismiss={() => setSheet(null)}
        />
      )}
    </HomeLayout>
  );
}

function HomeScreenFallback({ children }: { children?: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <HomeLayout quickAddAccountId={null} accountsReady={false}>
      <View style={{ gap: 8 }}>
        <DeckSkeleton width={width - pageGutter - cardPeek}>{children}</DeckSkeleton>
        <View style={{ paddingHorizontal: pageGutter, paddingTop: 20 }}>
          <View style={{ height: 48, borderRadius: 24, backgroundColor: theme.colors.surface }} />
          {!children && <ActivitySkeleton />}
        </View>
      </View>
    </HomeLayout>
  );
}

export function HomeScreenError({ retry }: { retry: () => void }) {
  return (
    <HomeScreenFallback>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Text accessibilityRole="alert" style={{ color: theme.colors.muted }}>
          Couldn’t load Home
        </Text>
        <RetryButton onPress={retry} />
      </View>
    </HomeScreenFallback>
  );
}

export default function HomeScreen() {
  // Home always opens on All accounts, so its list can load while the deck loads.
  usePrefetchQuery(homeListQuery(null, use(QueryTimeContext)));
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallback={(retry) => <HomeScreenError retry={retry} />}>
          <Suspense fallback={<HomeScreenFallback />}>
            <Home reset={reset} />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
