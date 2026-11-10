export type DeckAccount = {
  id: number;
  name: string;
  currencyCode: string;
  isFavorite: number;
  balanceMinor: number;
  /** The local date of the newest Transaction in or out of the Account. */
  lastUsedDay: number | null;
};

export type DeckCard = {
  /** The account scope that the card sets for Home. Null is All accounts. */
  accountId: number | null;
  account: DeckAccount | null;
  face: 'pace' | 'trend';
};

/**
 * All accounts first, then the favorite, then the most recently used accounts, then the rest by name.
 * With one account, its card takes the Pace face because no Transfers can distort it.
 */
export function deckCards(accounts: DeckAccount[]): DeckCard[] {
  if (accounts.length === 1)
    return [{ accountId: accounts[0].id, account: accounts[0], face: 'pace' }];
  const ordered = [...accounts].sort(
    (a, b) =>
      b.isFavorite - a.isFavorite ||
      (b.lastUsedDay ?? -Infinity) - (a.lastUsedDay ?? -Infinity) ||
      a.name.localeCompare(b.name) ||
      a.id - b.id,
  );
  return [
    { accountId: null, account: null, face: 'pace' },
    ...ordered.map((account) => ({ accountId: account.id, account, face: 'trend' as const })),
  ];
}

export type PageDot = { index: number; active: boolean; size: 'full' | 'medium' | 'small' };

const maxDots = 7;

/** At most seven dots. Dots at an edge get smaller when more cards are past that edge. */
export function pageDots(count: number, activeIndex: number): PageDot[] {
  if (count < 2) return [];
  const from = Math.max(0, Math.min(activeIndex - 3, count - maxDots));
  const to = Math.min(count, from + maxDots);
  const dots: PageDot[] = [];
  for (let index = from; index < to; index++) {
    const fromEdge = Math.min(
      from > 0 ? index - from : Infinity,
      to < count ? to - 1 - index : Infinity,
    );
    const size = fromEdge === 0 ? 'small' : fromEdge === 1 ? 'medium' : 'full';
    dots.push({ index, active: index === activeIndex, size });
  }
  return dots;
}
