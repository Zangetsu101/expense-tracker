import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import type { SectionList, ViewToken } from 'react-native';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { subscribeDataChanges, type SavedTransaction } from '@/lib/data-changes';
import type { DeckAccount } from './deck.ts';
import { rowIndex, type ListItem, type ListSection } from './list.ts';
import { shortDay } from './period.ts';

const snackbarTime = 6000;
/** A row that does not come into view in this time shows anyway, so that it never stays hidden. */
const slideWait = 4000;

/** How a saved row moves: `hidden` until it is in view and Home has focus, then `play`. */
export type SlidePhase = 'hidden' | 'play';

/** The search text and whether it covers all dates. A new `key` (another card or range) starts an empty search. */
export function useScopedSearch(key: string) {
  const empty = { key, text: '', allDates: false };
  const [saved, setSaved] = useState(empty);
  const search = saved.key === key ? saved : empty;
  return {
    text: search.text,
    allDates: search.allDates,
    change: (text: string) => setSaved({ key, text, allDates: false }),
    widen: () => setSaved({ ...search, allDates: true }),
  };
}

/** A saved Transaction that "Show" goes to. `accountId` is the card to swipe to, or `null` to stay. */
type Target = Pick<SavedTransaction, 'id' | 'date'> & { accountId: number | null };

/** The older periods of the list, as `useInfiniteQuery` gives them. */
type Paging = {
  ready: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
};

/**
 * Follows the Transactions that a write adds (Quick add, a Transfer, a lending entry). A new row on screen slides in.
 * Any other row gets a snackbar. Its "Show" swipes to the Account, loads older
 * periods until the row is in the list, and scrolls to the row. The row stays
 * hidden until the list reports it in view and Home has focus, then it slides in.
 */
export function useSavedRow({
  accountId,
  sections,
  loadedFrom,
  searching,
  accounts,
  paging,
  listRef,
  onShowAccount,
  onShow,
}: {
  /** The Account in view, or `null` for All accounts. */
  accountId: number | null;
  sections: ListSection[];
  /** The start of the oldest period in the list. */
  loadedFrom: number;
  searching: boolean;
  accounts: DeckAccount[];
  paging: Paging;
  listRef: RefObject<SectionList<ListItem, ListSection> | null>;
  onShowAccount: (accountId: number) => void;
  onShow: () => void;
}) {
  const focused = useIsFocused();
  const [slide, setSlide] = useState<{ id: number; seen: boolean } | null>(null);
  const pending = useRef<number | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [snack, setSnack] = useState<{ text: string; target: Target } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const scrolled = useRef<Target | null>(null);
  // The place of the last scroll, kept for one more try when the row was not rendered yet.
  const retry = useRef<{ sectionIndex: number; itemIndex: number } | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const visible = useRef({ newest: -Infinity, oldest: Infinity, keys: new Set<string>() });
  const see = useCallback((id: number) => {
    pending.current = null;
    clearTimeout(slideTimer.current);
    setSlide((old) => (old?.id === id ? { id, seen: true } : old));
  }, []);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const id = pending.current;
      if (
        id !== null &&
        viewableItems.some((token) => {
          const item = token.item as ListItem;
          return item.kind === 'row' && item.row.id === id;
        })
      )
        see(id);
      const shown = viewableItems.map((token) => token.section as ListSection);
      const dates = shown.flatMap((section) => (section.date === null ? [] : [section.date]));
      visible.current = {
        newest: Math.max(...dates),
        oldest: Math.min(...dates),
        keys: new Set(shown.map((section) => section.key)),
      };
    },
    [see],
  );
  const hide = useCallback(
    (id: number) => {
      pending.current = id;
      setSlide({ id, seen: false });
      clearTimeout(slideTimer.current);
      slideTimer.current = setTimeout(() => see(id), slideWait);
    },
    [see],
  );
  useEffect(
    () => () => {
      clearTimeout(slideTimer.current);
      clearTimeout(retryTimer.current);
    },
    [],
  );
  // A slide that played is done. Without this, the row would hide again when Home loses focus.
  useFocusEffect(useCallback(() => () => setSlide((old) => (old?.seen ? null : old)), []));

  const onSaved = useEffectEvent((saved: SavedTransaction) => {
    const inScope = accountId === null || saved.accountIds.includes(accountId);
    const { newest, oldest, keys } = visible.current;
    // An empty list has its top in view: the first row goes there.
    const top = sections.length === 0 || keys.has(sections[0].key);
    const noDayInView = oldest === Infinity;
    const onScreen = (top || saved.date <= newest) && (noDayInView || saved.date >= oldest);
    if (inScope && !searching && saved.date >= loadedFrom && onScreen) {
      hide(saved.id);
      return;
    }
    const other = inScope ? null : saved.accountIds[0];
    const where =
      other === null
        ? shortDay(saved.date)
        : (accounts.find((account) => account.id === other)?.name ?? 'another Account');
    setSnack({
      text: `Saved to ${where}`,
      target: { id: saved.id, date: saved.date, accountId: other },
    });
  });
  useEffect(() => subscribeDataChanges((saved) => saved && onSaved(saved)), []);
  useEffect(() => {
    if (!snack) return;
    const timer = setTimeout(() => setSnack(null), snackbarTime);
    return () => clearTimeout(timer);
  }, [snack]);
  const show = () => {
    if (!snack) return;
    setSnack(null);
    onShow();
    if (snack.target.accountId !== null) onShowAccount(snack.target.accountId);
    setTarget(snack.target);
    hide(snack.target.id);
  };

  const inTargetScope =
    target !== null && (target.accountId === null || target.accountId === accountId);
  const sectionIndex = target
    ? sections.findIndex((section) => rowIndex(section, target.id) !== -1)
    : -1;
  const { ready, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = paging;
  useEffect(() => {
    if (!target || target === scrolled.current || !ready || !inTargetScope || searching) return;
    if (target.date < loadedFrom) {
      if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
      return;
    }
    if (sectionIndex === -1) return;
    scrolled.current = target;
    retry.current = { sectionIndex, itemIndex: rowIndex(sections[sectionIndex], target.id) };
    listRef.current?.scrollToLocation({ ...retry.current, viewPosition: 0.4 });
  }, [
    target,
    ready,
    inTargetScope,
    searching,
    loadedFrom,
    sectionIndex,
    sections,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    listRef,
  ]);

  // The list cannot scroll to a row that it has not rendered. It scrolls near the
  // row first, so that the row renders, and then tries the exact place once more.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current
        ?.getScrollResponder()
        ?.scrollTo({ y: info.averageItemLength * info.index, animated: false });
      const location = retry.current;
      retry.current = null;
      if (location)
        retryTimer.current = setTimeout(
          () => listRef.current?.scrollToLocation({ ...location, viewPosition: 0.4 }),
          100,
        );
    },
    [listRef],
  );

  const phase = (id: number): SlidePhase | undefined =>
    slide?.id !== id ? undefined : slide.seen && focused ? 'play' : 'hidden';
  return {
    phase,
    slidingId: slide?.id ?? null,
    snack: snack?.text ?? null,
    show,
    onViewableItemsChanged,
    onScrollToIndexFailed,
  };
}
