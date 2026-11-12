import { useDeferredValue, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { ScrollView, SectionList, Text, View, type CellRendererProps } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  FadeIn,
  LinearTransition,
  ReduceMotion,
  SlideInRight,
  useReducedMotion,
} from 'react-native-reanimated';
import {
  useQueryErrorResetBoundary,
  useSuspenseInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import { accountParams } from '@/lib/account-selection';
import { epochDay } from '@/lib/database';
import { theme } from '@/theme';
import type { DeckAccount } from './deck.ts';
import {
  listSections,
  matchesSearch,
  periodBack,
  searchPlaceholder,
  searchSections,
  rowIndex,
  type ListItem,
  type ListScope,
  type ListSection,
} from './list.ts';
import {
  DayHeader,
  EmptyList,
  ListEnd,
  ListMessage,
  PeriodDivider,
  SearchField,
  Snackbar,
  TransactionRow,
} from './list-view.tsx';
import { useSavedRow, useSavedRowState, useScopedSearch } from './list-hooks.ts';
import { homePeriod, periodKey, type PeriodSetting } from './period.ts';
import { homeListQuery, homeSearchQuery } from './queries.ts';
import { ActivityError, ActivitySkeleton, RefreshNotice } from './view.tsx';

const gutter = 20;
/** A row counts as in view when half of it shows, so that a slide does not start at its edge. */
const viewabilityConfig = { itemVisiblePercentThreshold: 50 };
const rowMove = LinearTransition.duration(200).reduceMotion(ReduceMotion.System);
// The header of a new day comes in with its first row.
const headerSlideIn = SlideInRight.duration(250);
const headerFadeIn = FadeIn.duration(250);

/** Moves each cell to its new place when the list adds a row above it. */
function MovingCell({ onLayout, style, children }: CellRendererProps<ListItem>) {
  return (
    <Animated.View layout={rowMove} onLayout={onLayout} style={style}>
      {children}
    </Animated.View>
  );
}

/** Old rows stay at 40% while the rows for a new card or search load. They cannot be opened. */
function Dimmed({ muted, children }: { muted: boolean; children: ReactNode }) {
  return (
    <View
      style={{ paddingHorizontal: gutter, opacity: muted ? 0.4 : 1 }}
      pointerEvents={muted ? 'none' : 'auto'}
      accessibilityElementsHidden={muted}
      importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
    >
      {children}
    </View>
  );
}

type TransactionListProps = {
  header: ReactElement;
  scope: ListScope;
  scopeName: string;
  setting: PeriodSetting;
  now: Date;
  accounts: DeckAccount[];
  onShowAccount: (accountId: number) => void;
  onAdd: () => void;
};

/** Transactions grouped by day, with the deck in the scrolling header. */
export function TransactionList(props: TransactionListProps) {
  const { reset } = useQueryErrorResetBoundary();
  const requested = useMemo(
    () => ({
      key: JSON.stringify(homeListQuery(props.scope, props.setting, props.now).queryKey),
      scope: props.scope,
      setting: props.setting,
      now: props.now,
    }),
    [props.scope, props.setting, props.now],
  );
  const shown = useDeferredValue(requested);
  const search = useScopedSearch(`${props.scope.accountId}:${periodKey(props.setting)}`);
  const savedState = useSavedRowState({
    accountId: props.scope.accountId,
    accounts: props.accounts,
    onShowAccount: props.onShowAccount,
    onShow: () => search.change(''),
  });
  const header = (
    <ListHeader
      accountId={props.scope.accountId}
      setting={props.setting}
      now={props.now}
      search={search}
    >
      {props.header}
    </ListHeader>
  );
  return (
    <>
      <QueryBoundary
        reset={reset}
        resetKey={shown.key}
        pending={
          <ListFallback>
            {header}
            <ListFallback.Content>
              <ActivitySkeleton />
            </ListFallback.Content>
          </ListFallback>
        }
        error={(retry) => (
          <ListFallback>
            {header}
            <ListFallback.Content>
              <ActivityError retry={retry} />
            </ListFallback.Content>
          </ListFallback>
        )}
      >
        <ReadyList
          {...props}
          scope={shown.scope}
          setting={shown.setting}
          now={shown.now}
          stale={shown.key !== requested.key}
          search={search}
          savedState={savedState}
          searchHeader={header}
        />
      </QueryBoundary>
      {savedState.snack && <Snackbar text={savedState.snack.text} onShow={savedState.show} />}
    </>
  );
}

function ListHeader({
  accountId,
  setting,
  now,
  search,
  children,
}: {
  accountId: number | null;
  setting: PeriodSetting;
  now: Date;
  search: ReturnType<typeof useScopedSearch>;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {children}
      <View style={{ paddingHorizontal: gutter, paddingTop: 6 }}>
        <SearchField
          value={search.text}
          placeholder={searchPlaceholder(setting, homePeriod(setting, epochDay(now)).label)}
          onChange={search.change}
          onOpenFilters={() =>
            router.push({
              pathname: '/transactions',
              params: {
                ...accountParams(accountId),
                ...(search.text.trim() ? { query: search.text.trim() } : {}),
              },
            })
          }
        />
      </View>
    </View>
  );
}

function ListFallback({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      {children}
    </ScrollView>
  );
}

ListFallback.Content = function ListFallbackContent({ children }: { children: ReactNode }) {
  return <View style={{ paddingHorizontal: gutter }}>{children}</View>;
};

function ReadyList({
  header,
  scope,
  scopeName,
  setting,
  now,
  onAdd,
  stale,
  search,
  savedState,
  searchHeader,
}: TransactionListProps & {
  stale: boolean;
  search: ReturnType<typeof useScopedSearch>;
  savedState: ReturnType<typeof useSavedRowState>;
  searchHeader: ReactElement;
}) {
  const today = epochDay(now);
  const { accountId } = scope;
  const listRef = useRef<SectionList<ListItem, ListSection>>(null);
  const reduceMotion = useReducedMotion();
  const list = useSuspenseInfiniteQuery(homeListQuery(scope, setting, now));
  const periods = list.data.pages.flatMap((page) => page.periods);
  const firstDay = list.data.pages[0].firstDay;
  const shownScope = list.data.pages[0].scope;
  const loadedFrom = periods.at(-1)?.period.start ?? today + 1;

  const query = useDeferredValue(search.text);
  const searching = query.trim() !== '';
  const allDatesSearch = useQuery({
    ...homeSearchQuery(accountId, query, now),
    enabled: searching && search.allDates,
  });
  const allDatesRows = searching && search.allDates ? allDatesSearch.data : undefined;
  const rangeRows = periods[0]?.rows.filter((row) => matchesSearch(row, query)) ?? [];
  const hasAny = firstDay !== null;
  const sections = !hasAny
    ? []
    : !searching
      ? listSections(periods, shownScope)
      : searchSections(allDatesRows ?? rangeRows);
  const muted = stale || search.text !== query;
  const saved = useSavedRow({
    state: savedState,
    accountId,
    sections,
    loadedFrom,
    searching,
    paging: { ...list, ready: !stale },
    listRef,
  });

  const headerEntering = reduceMotion ? headerFadeIn : headerSlideIn;
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
          loading={search.allDates && allDatesSearch.isFetching}
          failed={search.allDates && allDatesSearch.isError ? 'Couldn’t search all dates' : null}
          onAction={() => (search.allDates ? void allDatesSearch.refetch() : search.widen())}
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
    <SectionList
      ref={listRef}
      sections={sections}
      keyExtractor={(item, index) =>
        item.kind === 'row' ? String(item.row.id) : `${item.kind}${index}`
      }
      stickySectionHeadersEnabled
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 100 }}
      CellRendererComponent={MovingCell}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={saved.onViewableItemsChanged}
      onScrollToIndexFailed={saved.onScrollToIndexFailed}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
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
        </View>
      }
      renderSectionHeader={({ section }) =>
        section.date === null ? null : (
          <Dimmed muted={muted}>
            <DayHeader
              date={section.date}
              totals={section.totals}
              now={now}
              entering={
                saved.slidingId !== null && rowIndex(section, saved.slidingId) !== -1
                  ? headerEntering
                  : undefined
              }
            />
          </Dimmed>
        )
      }
      renderItem={({ item }) => (
        <Dimmed muted={muted}>
          {item.kind === 'row' ? (
            <TransactionRow
              row={item.row}
              scope={shownScope}
              query={searching ? query : ''}
              disabled={muted}
              slide={saved.phase(item.row.id)}
              onPress={() =>
                router.push({
                  pathname: '/transaction/[id]',
                  params: { id: String(item.row.id) },
                })
              }
            />
          ) : item.kind === 'divider' ? (
            <PeriodDivider label={item.label} totals={item.totals} />
          ) : (
            <ListMessage text={item.text} />
          )}
        </Dimmed>
      )}
      ListFooterComponent={<Dimmed muted={muted}>{footer}</Dimmed>}
    />
  );
}
