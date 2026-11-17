import type { ComponentProps, ReactNode, Ref } from 'react';
import { SectionList, View, type SectionListProps } from 'react-native';
import Animated, {
  FadeIn,
  LinearTransition,
  ReduceMotion,
  SlideInRight,
  useReducedMotion,
} from 'react-native-reanimated';
import { rowIndex, type ListItem, type ListScope, type ListSection } from './list.ts';
import { DayHeader, ListMessage, PeriodDivider, TransactionRow } from './list-view.tsx';
import type { SlidePhase } from './list-hooks.ts';

const gutter = 20;
/** A row counts as in view when half of it shows, so that a slide does not start at its edge. */
const viewabilityConfig = { itemVisiblePercentThreshold: 50 };
const rowMove = LinearTransition.duration(200).reduceMotion(ReduceMotion.System);
const headerSlideIn = SlideInRight.duration(250);
const headerFadeIn = FadeIn.duration(250);

function MovingCell({
  onLayout,
  style,
  children,
}: ComponentProps<NonNullable<SectionListProps<ListItem>['CellRendererComponent']>>) {
  return (
    <Animated.View layout={rowMove} onLayout={onLayout} style={style}>
      {children}
    </Animated.View>
  );
}

function StaleContent({
  stale,
  muted,
  children,
}: {
  stale: boolean;
  muted: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={{ paddingHorizontal: gutter, opacity: muted ? 0.4 : 1 }}
      pointerEvents={stale ? 'none' : 'auto'}
      accessibilityElementsHidden={stale}
      importantForAccessibility={stale ? 'no-hide-descendants' : 'auto'}
    >
      {children}
    </View>
  );
}

type TransactionListProps = Pick<
  SectionListProps<ListItem, ListSection>,
  'sections' | 'onViewableItemsChanged' | 'onScrollToIndexFailed'
> & {
  ref?: Ref<SectionList<ListItem, ListSection>>;
  header: ReactNode;
  footer: ReactNode;
  scope: ListScope;
  now: Date;
  query: string;
  /** The list on screen is not the requested list. */
  stale: boolean;
  /** The list on screen shows as dim while the requested list loads. */
  muted: boolean;
  slidingId: number | null;
  phase: (id: number) => SlidePhase | undefined;
  onOpen: (id: number) => void;
};

export function TransactionList({
  ref,
  header,
  footer,
  scope,
  now,
  query,
  stale,
  muted,
  slidingId,
  phase,
  onOpen,
  ...props
}: TransactionListProps) {
  const reduceMotion = useReducedMotion();
  return (
    <SectionList
      {...props}
      ref={ref}
      keyExtractor={(item, index) =>
        item.kind === 'row' ? String(item.row.id) : `${item.kind}${index}`
      }
      stickySectionHeadersEnabled
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 100 }}
      CellRendererComponent={MovingCell}
      viewabilityConfig={viewabilityConfig}
      ListHeaderComponent={<View style={{ gap: 8 }}>{header}</View>}
      ListFooterComponent={
        <StaleContent stale={stale} muted={muted}>
          {footer}
        </StaleContent>
      }
      renderSectionHeader={({ section }) =>
        section.date === null ? null : (
          <StaleContent stale={stale} muted={muted}>
            <DayHeader
              date={section.date}
              totals={section.totals}
              now={now}
              entering={
                slidingId !== null && rowIndex(section, slidingId) !== -1
                  ? reduceMotion
                    ? headerFadeIn
                    : headerSlideIn
                  : undefined
              }
            />
          </StaleContent>
        )
      }
      renderItem={({ item }) => (
        <StaleContent stale={stale} muted={muted}>
          {item.kind === 'row' ? (
            <TransactionRow
              row={item.row}
              scope={scope}
              query={query}
              disabled={stale}
              slide={phase(item.row.id)}
              onPress={() => onOpen(item.row.id)}
            />
          ) : item.kind === 'divider' ? (
            <PeriodDivider label={item.label} totals={item.totals} />
          ) : (
            <ListMessage text={item.text} />
          )}
        </StaleContent>
      )}
    />
  );
}
