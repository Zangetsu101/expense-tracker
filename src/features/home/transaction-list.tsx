import { useDeferredValue, useRef, type ReactElement, type ReactNode } from 'react';
import { SectionList, Text, View, type CellRendererProps } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  FadeIn,
  LinearTransition,
  ReduceMotion,
  SlideInRight,
  useReducedMotion,
} from 'react-native-reanimated';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
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
import { useSavedRow, useScopedSearch } from './list-hooks.ts';
import { periodKey, type PeriodSetting } from './period.ts';
import { homeListQuery, homeSearchQuery } from './queries.ts';
import { ActivityError, ActivitySkeleton } from './view.tsx';

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

/**
 * The Transactions of the Account in view in the range of the cards, newest
 * first, grouped by day. `header` scrolls above the list.
 */
export function TransactionList({
  header,
  scope,
  scopeName,
  setting,
  now,
  accounts,
  onShowAccount,
  onAdd,
}: {
  header: ReactElement;
  scope: ListScope;
  scopeName: string;
  setting: PeriodSetting;
  now: Date;
  accounts: DeckAccount[];
  onShowAccount: (accountId: number) => void;
  onAdd: () => void;
}) {
  const today = epochDay(now);
  const { accountId } = scope;
  const listRef = useRef<SectionList<ListItem, ListSection>>(null);
  const reduceMotion = useReducedMotion();
  const list = useInfiniteQuery({
    ...homeListQuery(scope, setting, now),
    placeholderData: keepPreviousData,
  });
  const periods = list.data?.pages.flatMap((page) => page.periods) ?? [];
  const firstDay = list.data?.pages[0].firstDay;
  const shownScope = list.data ? list.data.pages[0].scope : scope;
  const loadedFrom = periods.at(-1)?.period.start ?? today + 1;

  const search = useScopedSearch(`${accountId}:${periodKey(setting)}`);
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
  const muted = list.isPlaceholderData || search.text !== query;
  const saved = useSavedRow({
    accountId,
    sections,
    loadedFrom,
    searching,
    accounts,
    paging: { ...list, ready: !!list.data && !list.isPlaceholderData },
    listRef,
    onShowAccount,
    onShow: () => search.change(''),
  });

  const headerEntering = reduceMotion ? headerFadeIn : headerSlideIn;
  const nextStep = list.data?.pages.at(-1)?.next ?? null;

  let footer: ReactNode = null;
  if (!list.data)
    footer = list.isError ? (
      <ActivityError retry={() => void list.refetch()} />
    ) : (
      <ActivitySkeleton />
    );
  else if (!hasAny)
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
    <>
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
            {header}
            {(hasAny || !list.data) && (
              <View style={{ paddingHorizontal: gutter, paddingTop: 6 }}>
                <SearchField
                  value={search.text}
                  placeholder={searchPlaceholder(setting, periods[0]?.period.label ?? '')}
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
        ListFooterComponent={<View style={{ paddingHorizontal: gutter }}>{footer}</View>}
      />
      {saved.snack && <Snackbar text={saved.snack} onShow={saved.show} />}
    </>
  );
}
