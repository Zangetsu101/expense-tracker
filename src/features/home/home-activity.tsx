import { useDeferredValue, useRef, useState, type ReactElement, type ReactNode } from 'react';
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
import { periodKey, type PeriodSetting } from './period.ts';
import { homeListQuery, homeSearchQuery } from './queries.ts';
import { ActivityError, ActivitySkeleton, RefreshNotice } from './view.tsx';
import { ActivitySearch } from './activity-search.tsx';
import { TransactionList } from './transaction-list.tsx';

const gutter = 20;

type ListInputs = {
  scope: ListScope;
  setting: PeriodSetting;
  now: Date;
  search: { text: string; allDates: boolean };
};

function listKey({ scope, setting, now }: Omit<ListInputs, 'search'>) {
  return JSON.stringify(homeListQuery(scope, setting, now).queryKey);
}

/** Defers the inputs of the Home list together so the old list keeps its filter while a new one loads. */
function useDeferredListInputs(inputs: ListInputs) {
  const key = JSON.stringify([listKey(inputs), inputs.search.text, inputs.search.allDates]);
  const [requested, setRequested] = useState({ key, value: inputs });
  if (requested.key !== key) setRequested({ key, value: inputs });
  const deferred = useDeferredValue(requested);
  return { deferred: deferred.value, stale: deferred.key !== requested.key };
}

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
  const searchField = useScopedSearch(`${props.scope.accountId}:${periodKey(props.setting)}`);
  const { deferred, stale } = useDeferredListInputs({
    scope: props.scope,
    setting: props.setting,
    now: props.now,
    search: { text: searchField.text, allDates: searchField.allDates },
  });
  const savedState = useSavedRowState({
    accountId: props.scope.accountId,
    accounts: props.accounts,
    onShowAccount: props.onShowAccount,
    onShow: () => searchField.change(''),
  });
  const header = (
    <>
      {props.header}
      <ActivitySearch
        accountId={props.scope.accountId}
        setting={props.setting}
        now={props.now}
        value={searchField.text}
        onChange={searchField.change}
      />
    </>
  );
  return (
    <>
      <QueryBoundary
        reset={reset}
        resetKey={listKey(deferred)}
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
          header={props.header}
          scopeName={props.scopeName}
          onAdd={props.onAdd}
          inputs={deferred}
          stale={stale}
          searchField={searchField}
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
  scopeName,
  onAdd,
  inputs,
  stale,
  searchField,
  savedState,
  searchHeader,
}: Pick<HomeActivityProps, 'header' | 'scopeName' | 'onAdd'> & {
  inputs: ListInputs;
  stale: boolean;
  searchField: ReturnType<typeof useScopedSearch>;
  savedState: ReturnType<typeof useSavedRowState>;
  searchHeader: ReactElement;
}) {
  const { scope, setting, now } = inputs;
  const today = epochDay(now);
  const { accountId } = scope;
  const listRef = useRef<SectionList<ListItem, ListSection>>(null);
  const list = useSuspenseInfiniteQuery(homeListQuery(scope, setting, now));
  const periods = list.data.pages.flatMap((page) => page.periods);
  const firstDay = list.data.pages[0].firstDay;
  const shownScope = list.data.pages[0].scope;
  const loadedFrom = periods.at(-1)?.period.start ?? today + 1;

  const { text: query, allDates } = inputs.search;
  const searching = query.trim() !== '';
  const allDatesSearch = useQuery({
    ...homeSearchQuery(accountId, query, now),
    enabled: searching && allDates,
  });
  const allDatesRows = searching && allDates ? allDatesSearch.data : undefined;
  const rangeRows = periods[0]?.rows.filter((row) => matchesSearch(row, query)) ?? [];
  const hasAny = firstDay !== null;
  let sections: ListSection[] = [];
  if (hasAny)
    sections = searching
      ? searchSections(allDatesRows ?? rangeRows)
      : listSections(periods, shownScope);
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
          onAction={() => (allDates ? void allDatesSearch.refetch() : searchField.widen())}
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
