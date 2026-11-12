import { use, useDeferredValue, useRef, useState, type ReactNode } from 'react';
import { FlatList, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import {
  QueryErrorResetBoundary,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { accountParams } from '@/lib/account-selection';
import { defaultCurrencyCode } from '@/lib/currency';
import { epochDay } from '@/lib/database';
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
import { TransactionList } from './transaction-list.tsx';
import { ActivitySkeleton, HomeLayout, RefreshNotice } from './view.tsx';
import { theme } from '@/theme';

const pageGutter = 20;
const cardPeek = 44;

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
  const deckOrderKey = cards.map((card) => card.accountId).join();
  const scope = cards[index].accountId;
  const shownSetting = useDeferredValue(setting);
  const favorite = deck.accounts.find((account) => account.isFavorite) ?? deck.accounts[0];
  const today = epochDay(now);
  const period = homePeriod(setting, today);
  const name = cards[index].account?.name ?? 'All accounts';

  const selectScope = (accountId: number | null) => {
    if (accountId === scope) return;
    // A failed read for this scope must fetch again when the deck returns to it.
    reset();
    void client.prefetchInfiniteQuery(
      homeListQuery(cards[cardIndex(cards, accountId)], setting, now),
    );
    setSelected(accountId);
  };
  const changePeriod = (next: PeriodSetting) => {
    reset();
    void client.prefetchInfiniteQuery(homeListQuery(cards[index], next, now));
    setSetting(next);
    savePeriod.mutate(next);
  };
  const showAccount = (accountId: number | null) => {
    selectScope(accountId);
    deckRef.current?.scrollToIndex({ index: cardIndex(cards, accountId), animated: true });
  };
  const quickAddAccountId = scope ?? favorite?.id ?? null;
  const addTransaction = () =>
    router.push({
      pathname: '/quick-add',
      params: accountParams(quickAddAccountId),
    });
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
      notice={<RefreshNotice failed={!!error} onRetry={() => void refetch()} />}
      quickAddAccountId={quickAddAccountId}
      accountsReady
    >
      <TransactionList
        scope={cards[index]}
        scopeName={name}
        setting={setting}
        now={now}
        accounts={deck.accounts}
        onShowAccount={showAccount}
        onAdd={addTransaction}
        header={
          <View style={{ gap: 8 }}>
            <Deck
              key={deckOrderKey}
              initialIndex={index}
              cards={cards}
              context={context}
              listRef={deckRef}
              onScopeChange={selectScope}
              onAddAccount={() => router.push('/accounts')}
            />
            <PageDots count={cards.length} index={index} />
          </View>
        }
      />
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
            showAccount(accountId);
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
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <QueryBoundary
          reset={reset}
          pending={<HomeScreenFallback />}
          error={(retry) => <HomeScreenError retry={retry} />}
        >
          <Home reset={reset} />
        </QueryBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
