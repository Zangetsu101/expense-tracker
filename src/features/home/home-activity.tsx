import { use, useRef, type ReactElement, type ReactNode } from 'react';
import { ScrollView, Text, View, type SectionList } from 'react-native';
import { router } from 'expo-router';
import {
  useQueryErrorResetBoundary,
  useSuspenseInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { epochDay } from '@/lib/database';
import { theme } from '@/theme';
import type { DeckAccount } from './deck.ts';
import {
  listSections,
  matchesSearch,
  periodBack,
  searchSections,
  type ListItem,
  type ListScope,
  type ListSection,
} from './list.ts';
import { EmptyList, ListEnd, ListMessage, Snackbar } from './list-view.tsx';
import { useSavedRow, useSavedRowState, useScopedSearch } from './list-hooks.ts';
import { useDeferredTransactionList, type ListInputs } from './deferred-list.ts';
import { periodKey, type PeriodSetting } from './period.ts';
import { homeListQuery, homeSearchQuery } from './queries.ts';
import { ActivityError, ActivitySkeleton, RefreshNotice } from './view.tsx';
import { ActivitySearch } from './activity-search.tsx';
import { TransactionList } from './transaction-list.tsx';

const gutter = 20;

type HomeActivityProps = {
  header: ReactElement;
  scope: ListScope;
  scopeName: string;
  setting: PeriodSetting;
  now: Date;
  accounts: DeckAccount[];
  onShowAccount: (accountId: number) => void;
  onAdd: () => void;
};

export function HomeActivity(props: HomeActivityProps) {
  const { reset } = useQueryErrorResetBoundary();
  const search = useScopedSearch(`${props.scope.accountId}:${periodKey(props.setting)}`);
  const { deferred, stale, muted, gate } = useDeferredTransactionList({
    scope: props.scope,
    setting: props.setting,
    now: props.now,
    search: { text: search.text, allDates: search.allDates },
  });
  const savedState = useSavedRowState({
    accountId: props.scope.accountId,
    accounts: props.accounts,
    onShowAccount: props.onShowAccount,
    onShow: () => search.change(''),
  });
  const header = (
    <>
      {props.header}
      <ActivitySearch
        accountId={props.scope.accountId}
        setting={props.setting}
        now={props.now}
        value={search.text}
        onChange={search.change}
      />
    </>
  );
  return (
    <>
      <QueryBoundary
        reset={reset}
        resetKey={JSON.stringify(
          homeListQuery(deferred.scope, deferred.setting, deferred.now).queryKey,
        )}
        pending={
          <ActivityFallback header={header}>
            <ActivitySkeleton />
          </ActivityFallback>
        }
        error={(retry) => (
          <ActivityFallback header={header}>
            <ActivityError retry={retry} />
          </ActivityFallback>
        )}
      >
        <ActivityResults
          {...props}
          scope={deferred.scope}
          setting={deferred.setting}
          now={deferred.now}
          shownSearch={deferred.search}
          stale={stale}
          muted={muted}
          gate={gate}
          search={search}
          savedState={savedState}
          searchHeader={header}
        />
      </QueryBoundary>
      {savedState.snack && <Snackbar text={savedState.snack.text} onShow={savedState.show} />}
    </>
  );
}

function ActivityFallback({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      <View style={{ gap: 8 }}>{header}</View>
      <View style={{ paddingHorizontal: gutter }}>{children}</View>
    </ScrollView>
  );
}

function ActivityResults({
  header,
  scope,
  scopeName,
  setting,
  now,
  onAdd,
  shownSearch,
  stale,
  muted,
  gate,
  search,
  savedState,
  searchHeader,
}: HomeActivityProps & {
  /** The search of the snapshot on screen. `search` is the field, which can be ahead of it. */
  shownSearch: ListInputs['search'];
  stale: boolean;
  muted: boolean;
  gate: Promise<void> | null;
  search: ReturnType<typeof useScopedSearch>;
  savedState: ReturnType<typeof useSavedRowState>;
  searchHeader: ReactElement;
}) {
  const today = epochDay(now);
  const { accountId } = scope;
  const listRef = useRef<SectionList<ListItem, ListSection>>(null);
  const list = useSuspenseInfiniteQuery(homeListQuery(scope, setting, now));
  if (gate) use(gate);
  const periods = list.data.pages.flatMap((page) => page.periods);
  const firstDay = list.data.pages[0].firstDay;
  const shownScope = list.data.pages[0].scope;
  const loadedFrom = periods.at(-1)?.period.start ?? today + 1;

  const { text: query, allDates } = shownSearch;
  const searching = query.trim() !== '';
  const allDatesSearch = useQuery({
    ...homeSearchQuery(accountId, query, now),
    enabled: searching && allDates,
  });
  const allDatesRows = searching && allDates ? allDatesSearch.data : undefined;
  const rangeRows = periods[0]?.rows.filter((row) => matchesSearch(row, query)) ?? [];
  const hasAny = firstDay !== null;
  const sections = !hasAny
    ? []
    : !searching
      ? listSections(periods, shownScope)
      : searchSections(allDatesRows ?? rangeRows);
  const saved = useSavedRow({
    state: savedState,
    accountId,
    sections,
    loadedFrom,
    searching,
    paging: { ...list, ready: !stale },
    listRef,
  });

  const nextStep = list.data.pages.at(-1)?.next ?? null;

  let footer: ReactNode = null;
  if (!hasAny)
    footer = (
      <EmptyList
        title={
          scope.face === 'pace' ? 'No transactions yet' : `No transactions in ${scopeName} yet`
        }
        body={
          scope.face === 'pace'
            ? 'Your spending and income show here, by day. Tap + to add the first one.'
            : null
        }
        onAdd={onAdd}
      />
    );
  else if (searching) {
    const empty = sections.length === 0;
    footer = allDatesRows ? (
      empty && <ListMessage text={`No transactions match “${query.trim()}”.`} />
    ) : (
      <>
        {empty && <ListMessage text={`No matches in ${periods[0].period.label}.`} />}
        <ListEnd
          text={`Showing matches in ${periods[0].period.label}.`}
          action="Search all dates"
          loading={allDates && allDatesSearch.isFetching}
          failed={allDates && allDatesSearch.isError ? 'Couldn’t search all dates' : null}
          onAction={() => (allDates ? void allDatesSearch.refetch() : search.widen())}
        />
      </>
    );
  } else {
    const next = nextStep === null ? null : periodBack(setting, today, nextStep).label;
    footer = (
      <ListEnd
        text={`Start of ${periods.at(-1)!.period.label}.${next === null ? ' This is the first Transaction.' : ''}`}
        action={next && `Show ${next}`}
        loading={list.isFetchingNextPage}
        failed={list.isFetchNextPageError ? `Couldn’t load ${next}` : null}
        onAction={() => void list.fetchNextPage()}
      />
    );
  }

  const resultCount = sections.reduce((count, section) => count + section.data.length, 0);
  return (
    <TransactionList
      ref={listRef}
      sections={sections}
      onViewableItemsChanged={saved.onViewableItemsChanged}
      onScrollToIndexFailed={saved.onScrollToIndexFailed}
      scope={shownScope}
      now={now}
      query={searching ? query : ''}
      stale={stale}
      muted={muted}
      slidingId={saved.slidingId}
      phase={saved.phase}
      onOpen={(id) => router.push({ pathname: '/transaction/[id]', params: { id: String(id) } })}
      header={
        <>
          {hasAny ? searchHeader : header}
          <RefreshNotice
            failed={!!list.error && !list.isFetching && !list.isFetchNextPageError}
            onRetry={() => void list.refetch()}
            message="Couldn’t refresh account activity"
          />
          {hasAny && (
            <View style={{ paddingHorizontal: gutter }}>
              {searching && resultCount > 0 && (
                <Text style={{ color: theme.colors.muted, fontSize: 13, paddingTop: 12 }}>
                  {resultCount} {resultCount === 1 ? 'result' : 'results'}
                </Text>
              )}
            </View>
          )}
        </>
      }
      footer={footer}
    />
  );
}
