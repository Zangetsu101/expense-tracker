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

/** The older periods of the list, as the infinite query gives them. */
type Paging = {
  ready: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
};

export function useSavedRowState({
  accountId,
  accounts,
  onShowAccount,
  onShow,
}: {
  accountId: number | null;
  accounts: DeckAccount[];
  onShowAccount: (accountId: number) => void;
  onShow: () => void;
}) {
  const [slide, setSlide] = useState<{ id: number; seen: boolean } | null>(null);
  const [snack, setSnack] = useState<{ text: string; target: Target } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const pendingRef = useRef<number | null>(null);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrolledRef = useRef<Target | null>(null);
  // The place of the last scroll, kept for one more try when the row was not rendered yet.
  const retryRef = useRef<{ sectionIndex: number; itemIndex: number } | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const visibleRef = useRef({ newest: -Infinity, oldest: Infinity, keys: new Set<string>() });
  const animateSavedRef = useRef<((saved: SavedTransaction) => boolean) | null>(null);
  const see = useCallback(
    (id: number) => {
      pendingRef.current = null;
      clearTimeout(slideTimerRef.current);
      setSlide((old) => (old?.id === id ? { id, seen: true } : old));
    },
    [pendingRef, setSlide, slideTimerRef],
  );
  const hide = useCallback(
    (id: number) => {
      pendingRef.current = id;
      setSlide({ id, seen: false });
      clearTimeout(slideTimerRef.current);
      slideTimerRef.current = setTimeout(() => see(id), slideWait);
    },
    [pendingRef, see, setSlide, slideTimerRef],
  );
  const onSaved = useEffectEvent((saved: SavedTransaction) => {
    if (animateSavedRef.current?.(saved)) return;
    const other =
      accountId === null || saved.accountIds.includes(accountId) ? null : saved.accountIds[0];
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
  }, [snack, setSnack]);
  const show = () => {
    if (!snack) return;
    setSnack(null);
    onShow();
    if (snack.target.accountId !== null) onShowAccount(snack.target.accountId);
    setTarget(snack.target);
    hide(snack.target.id);
  };

  useEffect(
    () => () => {
      clearTimeout(slideTimerRef.current);
      clearTimeout(retryTimerRef.current);
    },
    [],
  );
  return {
    slide,
    setSlide,
    snack,
    target,
    pendingRef,
    animateSavedRef,
    see,
    hide,
    show,
    scrolledRef,
    retryRef,
    retryTimerRef,
    visibleRef,
  };
}

/** Connects saved-row navigation to the loaded list and its visible cells. */
export function useSavedRow({
  state,
  accountId,
  sections,
  loadedFrom,
  searching,
  paging,
  listRef,
}: {
  state: ReturnType<typeof useSavedRowState>;
  /** The Account in view, or `null` for All accounts. */
  accountId: number | null;
  sections: ListSection[];
  /** The start of the oldest period in the list. */
  loadedFrom: number;
  searching: boolean;
  paging: Paging;
  listRef: RefObject<SectionList<ListItem, ListSection> | null>;
}) {
  const focused = useIsFocused();
  const {
    slide,
    setSlide,
    target,
    pendingRef,
    animateSavedRef,
    see,
    hide,
    scrolledRef,
    retryRef,
    retryTimerRef,
    visibleRef,
  } = state;
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const id = pendingRef.current;
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
      visibleRef.current = {
        newest: Math.max(...dates),
        oldest: Math.min(...dates),
        keys: new Set(shown.map((section) => section.key)),
      };
    },
    [pendingRef, see, visibleRef],
  );
  // A slide that played is done. Without this, the row would hide again when Home loses focus.
  useFocusEffect(useCallback(() => () => setSlide((old) => (old?.seen ? null : old)), [setSlide]));

  const onSaved = useEffectEvent((saved: SavedTransaction) => {
    const inScope = accountId === null || saved.accountIds.includes(accountId);
    const { newest, oldest, keys } = visibleRef.current;
    // An empty list has its top in view: the first row goes there.
    const top = sections.length === 0 || keys.has(sections[0].key);
    const noDayInView = oldest === Infinity;
    const onScreen = (top || saved.date <= newest) && (noDayInView || saved.date >= oldest);
    if (paging.ready && inScope && !searching && saved.date >= loadedFrom && onScreen) {
      hide(saved.id);
      return true;
    }
    return false;
  });
  useEffect(() => {
    animateSavedRef.current = (saved) => onSaved(saved);
    return () => {
      animateSavedRef.current = null;
    };
  }, [animateSavedRef]);

  const inTargetScope =
    target !== null && (target.accountId === null || target.accountId === accountId);
  const sectionIndex = target
    ? sections.findIndex((section) => rowIndex(section, target.id) !== -1)
    : -1;
  const { ready, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = paging;
  useEffect(() => {
    if (!target || target === scrolledRef.current || !ready || !inTargetScope || searching) return;
    if (target.date < loadedFrom) {
      if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
      return;
    }
    if (sectionIndex === -1) return;
    scrolledRef.current = target;
    retryRef.current = { sectionIndex, itemIndex: rowIndex(sections[sectionIndex], target.id) };
    listRef.current?.scrollToLocation({ ...retryRef.current, viewPosition: 0.4 });
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
    retryRef,
    scrolledRef,
  ]);

  // The list cannot scroll to a row that it has not rendered. It scrolls near the
  // row first, so that the row renders, and then tries the exact place once more.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current
        ?.getScrollResponder()
        ?.scrollTo({ y: info.averageItemLength * info.index, animated: false });
      const location = retryRef.current;
      retryRef.current = null;
      if (location)
        retryTimerRef.current = setTimeout(
          () => listRef.current?.scrollToLocation({ ...location, viewPosition: 0.4 }),
          100,
        );
    },
    [listRef, retryRef, retryTimerRef],
  );

  const phase = (id: number): SlidePhase | undefined =>
    slide?.id !== id ? undefined : slide.seen && focused ? 'play' : 'hidden';
  return {
    phase,
    slidingId: slide?.id ?? null,
    onViewableItemsChanged,
    onScrollToIndexFailed,
  };
}
