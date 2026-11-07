const listeners = new Set<() => void>();

export function notifyDataChanged() {
  for (const listener of listeners) listener();
}

export function subscribeDataChanges(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
