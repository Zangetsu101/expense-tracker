import { useCallback, useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import type { SectionList, ViewToken } from 'react-native';
import { subscribeDataChanges, type SavedTransaction } from '@/lib/data-changes';
import type { DeckAccount } from './deck.ts';
import { rowIndex, type ListItem, type ListSection } from './list.ts';
import { shortDay } from './period.ts';

const snackbarTime = 6000;
/**
 * About the time of an animated scroll, so that the row slides in after the list stops.
 * React Native gives no reliable event when `scrollToLocation` ends.
 */
const scrollTime = 300;

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
 * periods until the row is in the list, scrolls to the row, and slides it in.
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
  // A new `key` mounts the row again, so that its slide plays again.
  const [animate, setAnimate] = useState<{ id: number; key: number } | null>(null);
  const [snack, setSnack] = useState<{ text: string; target: Target } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const scrolled = useRef<Target | null>(null);
  const visible = useRef({ newest: -Infinity, oldest: Infinity, keys: new Set<string>() });
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const shown = viewableItems.map((token) => token.section as ListSection);
      const dates = shown.flatMap((section) => (section.date === null ? [] : [section.date]));
      visible.current = {
        newest: Math.max(...dates),
        oldest: Math.min(...dates),
        keys: new Set(shown.map((section) => section.key)),
      };
    },
    [],
  );
  const slide = useCallback(
    (id: number) => setAnimate((old) => ({ id, key: (old?.key ?? 0) + 1 })),
    [],
  );

  const onSaved = useEffectEvent((saved: SavedTransaction) => {
    const inScope = accountId === null || saved.accountIds.includes(accountId);
    const { newest, oldest, keys } = visible.current;
    // An empty list has its top in view: the first row goes there.
    const top = sections.length === 0 || keys.has(sections[0].key);
    const noDayInView = oldest === Infinity;
    const onScreen = (top || saved.date <= newest) && (noDayInView || saved.date >= oldest);
    if (inScope && !searching && saved.date >= loadedFrom && onScreen) {
      slide(saved.id);
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
  };

  const inTargetScope =
    target !== null && (target.accountId === null || target.accountId === accountId);
  const sectionIndex = target
    ? sections.findIndex((section) => rowIndex(section, target.id) !== -1)
    : -1;
  const slideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(slideTimer.current), []);
  const { ready, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = paging;
  useEffect(() => {
    if (!target || target === scrolled.current || !ready || !inTargetScope || searching) return;
    if (target.date < loadedFrom) {
      if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
      return;
    }
    if (sectionIndex === -1) return;
    scrolled.current = target;
    const itemIndex = rowIndex(sections[sectionIndex], target.id);
    listRef.current?.scrollToLocation({ sectionIndex, itemIndex, viewPosition: 0.4 });
    slideTimer.current = setTimeout(() => slide(target.id), scrollTime);
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
    slide,
  ]);

  return { animate, snack: snack?.text ?? null, show, onViewableItemsChanged };
}
