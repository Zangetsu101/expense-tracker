import { useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ListScope } from './list.ts';
import type { PeriodSetting } from './period.ts';
import { homeListQuery } from './queries.ts';

/** A list that is ready in this time replaces the previous list without muting. */
export const GRACE_MS = 50;
/** A muted list stays muted for at least this time. */
export const HOLD_MS = 500;

/**
 * One mute episode. `from` is the key of the snapshot that was on screen when muting
 * began. `gate` resolves when the minimum hold ends, and is then `null`.
 */
type Hold = { from: string; gate: Promise<void> | null };

/**
 * Defers `value` and times the muting of the snapshot on screen while a new one loads.
 * A new snapshot renders with `gate`. The render that shows it calls `use(gate)` after
 * its suspending reads, so that it does not replace a muted list before the hold ends.
 */
export function useDeferredSnapshot<T>(value: T, key: string) {
  const [requested, setRequested] = useState({ key, value });
  const [hold, setHold] = useState<Hold | null>(null);
  const deferred = useDeferredValue(requested);
  // An equivalent value from a re-render keeps the same object, so it is not a new request.
  if (requested.key !== key) {
    setRequested({ key, value });
    // A request back to the list on screen ends the episode. A hold for an earlier list
    // ended when that list was replaced, for example by an error.
    if (key === deferred.key || hold?.from !== deferred.key) setHold(null);
  }
  const stale = deferred.key !== requested.key;
  const grace = stale && hold === null;

  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  useEffect(() => {
    if (!grace) return;
    const from = deferred.key;
    const timer = setTimeout(() => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      setHold({ from, gate });
      holdTimer.current = setTimeout(() => {
        release();
        setHold((current) => (current?.gate === gate ? { from, gate: null } : current));
      }, HOLD_MS);
    }, GRACE_MS);
    return () => clearTimeout(timer);
  }, [grace, deferred.key, requested.key]);

  return {
    deferred: deferred.value,
    stale,
    muted: stale && hold !== null,
    // Only the render of a new snapshot waits. The snapshot on screen must not suspend.
    gate: hold !== null && hold.from !== deferred.key ? hold.gate : null,
  };
}

export type ListInputs = {
  scope: ListScope;
  setting: PeriodSetting;
  now: Date;
  search: { text: string; allDates: boolean };
};

/** Defers the inputs of the Home list together, and times the muting of the list on screen. */
export function useDeferredTransactionList(inputs: ListInputs) {
  const { scope, setting, now, search } = inputs;
  const key = JSON.stringify([
    homeListQuery(scope, setting, now).queryKey,
    search.text,
    search.allDates,
  ]);
  return useDeferredSnapshot(inputs, key);
}
