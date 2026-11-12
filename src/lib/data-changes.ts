/** A Transaction that a write added, so that a screen can point to it. */
export type SavedTransaction = { id: number; date: number; accountIds: number[] };
type Listener = (saved?: SavedTransaction) => void;

const listeners = new Set<Listener>();

export function notifyDataChanged(saved?: SavedTransaction) {
  for (const listener of listeners) listener(saved);
}

export function subscribeDataChanges(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
