import type { Account } from './database';

export function parseAccountId(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

// Undefined starts a session at the favorite; null explicitly selects All accounts.
export function resolveHomeAccount(accounts: Account[], selectedId: number | null | undefined): number | null {
  if (selectedId === null) return null;
  if (selectedId !== undefined && accounts.some((account) => account.id === selectedId)) return selectedId;
  return accounts.find((account) => account.isFavorite)?.id ?? null;
}

type AppLifecycle = {
  currentState: string;
  addEventListener: (event: 'change', listener: (state: string) => void) => { remove: () => void };
};

export function watchHomeReopen(lifecycle: AppLifecycle, reset: () => void): () => void {
  let previous = lifecycle.currentState;
  const subscription = lifecycle.addEventListener('change', (next) => {
    if (next === 'active' && previous === 'background') reset();
    // iOS passes through inactive when returning from the background.
    if (next !== 'inactive') previous = next;
  });
  return () => subscription.remove();
}
