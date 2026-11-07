import type { Account } from './database';

export function parseAccountId(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

// Undefined starts a session at the favorite; null explicitly selects All accounts.
export function resolveHomeAccount(
  accounts: Account[],
  selectedId: number | null | undefined,
): number | null {
  if (selectedId === null) return null;
  if (selectedId !== undefined && accounts.some((account) => account.id === selectedId))
    return selectedId;
  return accounts.find((account) => account.isFavorite)?.id ?? null;
}
