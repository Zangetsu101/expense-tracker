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
import { epochDay } from '@/lib/database';
import { theme } from '@/theme';
import type { DeckAccount } from './deck.ts';
import {
  listSections,
  matchesSearch,
  periodBack,
  searchPlaceholder,
  searchSections,
  type ListItem,
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
const rowMove = LinearTransition.duration(200).reduceMotion(ReduceMotion.System);
const slideIn = SlideInRight.duration(250).delay(300);
const fadeIn = FadeIn.duration(200).delay(300);

/** Moves each cell to its new place when the list adds a row above it. */
function MovingCell({ onLayout, style, children }: CellRendererProps<ListItem>) {
  return (
    <Animated.View layout={rowMove} onLayout={onLayout} style={style}>
      {children}
    </Animated.View>
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
  scope: number | null;
  scopeName: string;
  setting: PeriodSetting;
  now: Date;
  accounts: DeckAccount[];
  onShowAccount: (accountId: number) => void;
  onAdd: () => void;
}) {
  const today = epochDay(now);
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

  const search = useScopedSearch(`${scope}:${periodKey(setting)}`);
  const query = useDeferredValue(search.text);
  const searching = query.trim() !== '';
  const wide = useQuery({
    ...homeSearchQuery(scope, query, now),
    enabled: searching && search.allDates,
  });
  const wideRows = searching && search.allDates ? wide.data : undefined;
  const rangeRows = periods[0]?.rows.filter((row) => matchesSearch(row, query)) ?? [];
  const sections = !searching
    ? listSections(periods, shownScope)
    : searchSections(wideRows ?? rangeRows);
  const muted = list.isPlaceholderData || search.text !== query;
  const saved = useSavedRow({
    scope,
    sections,
    loadedFrom,
    searching,
    accounts,
    paging: { ...list, ready: !!list.data && !list.isPlaceholderData },
    listRef,
    onShowAccount,
    onShow: () => search.change(''),
  });

  const entering = reduceMotion ? fadeIn : slideIn;
  const hasAny = firstDay !== null;
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
        title={scope === null ? 'No transactions yet' : `No transactions in ${scopeName} yet`}
        body={
          scope === null
            ? 'Your spending and income show here, by day. Tap + to add the first one.'
            : null
        }
        onAdd={onAdd}
      />
    );
  else if (searching) {
    const empty = sections.length === 0;
    footer = wideRows ? (
      empty && <ListMessage text={`No transactions match “${query.trim()}”.`} />
    ) : (
      <>
        {empty && <ListMessage text={`No matches in ${periods[0].period.label}.`} />}
        <ListEnd
          text={`Showing matches in ${periods[0].period.label}.`}
          action="Search all dates"
          loading={search.allDates && wide.isFetching}
          failed={search.allDates && wide.isError ? 'Couldn’t search all dates' : null}
          onAction={() => (search.allDates ? void wide.refetch() : search.widen())}
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
          item.kind !== 'row'
            ? `${item.kind}${index}`
            : item.row.id === saved.animate?.id
              ? `${item.row.id}:${saved.animate.key}`
              : String(item.row.id)
        }
        stickySectionHeadersEnabled
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 100 }}
        CellRendererComponent={MovingCell}
        onViewableItemsChanged={saved.onViewableItemsChanged}
        onScrollToIndexFailed={(info) =>
          listRef.current
            ?.getScrollResponder()
            ?.scrollTo({ y: info.averageItemLength * info.index, animated: true })
        }
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
                        ...(scope === null ? {} : { accountId: String(scope) }),
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
            <View
              style={{ paddingHorizontal: gutter, opacity: muted ? 0.4 : 1 }}
              accessibilityElementsHidden={muted}
              importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
            >
              <DayHeader
                date={section.date}
                totals={section.totals}
                now={now}
                entering={
                  section.data.some(
                    (item) => item.kind === 'row' && item.row.id === saved.animate?.id,
                  )
                    ? entering
                    : undefined
                }
              />
            </View>
          )
        }
        renderItem={({ item }) => (
          <View
            style={{ paddingHorizontal: gutter, opacity: muted ? 0.4 : 1 }}
            pointerEvents={muted ? 'none' : 'auto'}
            accessibilityElementsHidden={muted}
            importantForAccessibility={muted ? 'no-hide-descendants' : 'auto'}
          >
            {item.kind === 'row' ? (
              <TransactionRow
                row={item.row}
                scope={shownScope}
                query={searching ? query : ''}
                disabled={muted}
                entering={item.row.id === saved.animate?.id ? entering : undefined}
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
          </View>
        )}
        ListFooterComponent={<View style={{ paddingHorizontal: gutter }}>{footer}</View>}
      />
      {saved.snack && <Snackbar text={saved.snack} onShow={saved.show} />}
    </>
  );
}
