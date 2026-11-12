import { Children, isValidElement, type ReactNode, type Ref } from 'react';
import { SectionList, View, type CellRendererProps, type SectionListProps } from 'react-native';
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

function MovingCell({ onLayout, style, children }: CellRendererProps<ListItem>) {
  return (
    <Animated.View layout={rowMove} onLayout={onLayout} style={style}>
      {children}
    </Animated.View>
  );
}

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

type TransactionListProps = Pick<
  SectionListProps<ListItem, ListSection>,
  | 'sections'
  | 'renderItem'
  | 'renderSectionHeader'
  | 'onViewableItemsChanged'
  | 'onScrollToIndexFailed'
> & {
  ref?: Ref<SectionList<ListItem, ListSection>>;
  children: ReactNode;
};

export function TransactionList({ children, ref, ...props }: TransactionListProps) {
  const slots = Children.toArray(children).filter(isValidElement);
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
      ListHeaderComponent={slots.find((slot) => slot.type === TransactionList.Header)}
      ListFooterComponent={slots.find((slot) => slot.type === TransactionList.Footer)}
    />
  );
}

TransactionList.Header = function TransactionListHeader({ children }: { children: ReactNode }) {
  return <View style={{ gap: 8 }}>{children}</View>;
};

TransactionList.Footer = function TransactionListFooter({
  muted,
  children,
}: {
  muted: boolean;
  children: ReactNode;
}) {
  return <Dimmed muted={muted}>{children}</Dimmed>;
};

TransactionList.DayHeader = function TransactionListDayHeader({
  section,
  now,
  muted,
  slidingId,
}: {
  section: ListSection;
  now: Date;
  muted: boolean;
  slidingId: number | null;
}) {
  const reduceMotion = useReducedMotion();
  if (section.date === null) return null;
  return (
    <Dimmed muted={muted}>
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
    </Dimmed>
  );
};

TransactionList.Item = function TransactionListItem({
  item,
  scope,
  query,
  muted,
  slide,
  onOpen,
}: {
  item: ListItem;
  scope: ListScope;
  query: string;
  muted: boolean;
  slide?: SlidePhase;
  onOpen: (id: number) => void;
}) {
  return (
    <Dimmed muted={muted}>
      {item.kind === 'row' ? (
        <TransactionRow
          row={item.row}
          scope={scope}
          query={query}
          disabled={muted}
          slide={slide}
          onPress={() => onOpen(item.row.id)}
        />
      ) : item.kind === 'divider' ? (
        <PeriodDivider label={item.label} totals={item.totals} />
      ) : (
        <ListMessage text={item.text} />
      )}
    </Dimmed>
  );
};
