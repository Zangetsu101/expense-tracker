import { use, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { ListScope } from './list.ts';
import type { PeriodSetting } from './period.ts';
import { homeListQuery } from './queries.ts';

/** A list that is ready in this time replaces the previous list without muting. */
export const GRACE_MS = 50;
/** A muted list stays muted for at least this time. */
export const HOLD_MS = 500;

/**
 * A promise that holds the reveal of a new snapshot. `status` follows the protocol that
 * `use` reads, so that a released gate does not suspend a render that reads it first.
 */
type Gate = Promise<void> & { status?: 'fulfilled'; value?: undefined };

/** One mute episode. `from` is the key of the snapshot that was on screen when muting began. */
type Hold = { from: string; gate: Gate; release: () => void };

function startHold(from: string): Hold {
  let resolve = () => {};
  const gate: Gate = new Promise<void>((done) => (resolve = done));
  const release = () => {
    gate.status = 'fulfilled';
    resolve();
  };
  return { from, gate, release };
}

/**
 * Defers `value` and times the muting of the snapshot on screen while a new one loads.
 * Give `gate` to a `HoldReveal` in the Suspense boundary that shows the snapshot.
 */
export function useDeferredSnapshot<T>(value: T, key: string) {
  const [requested, setRequested] = useState({ key, value });
  const [hold, setHold] = useState<Hold | null>(null);
  const deferred = useDeferredValue(requested);
  // An equivalent value from a re-render keeps the same object, so it is not a new request.
  const holdOfEarlierList = hold !== null && hold.from !== deferred.key;
  if (requested.key !== key) {
    setRequested({ key, value });
    const backToShown = key === deferred.key;
    if (backToShown || holdOfEarlierList) setHold(null);
  }
  const stale = deferred.key !== requested.key;
  const grace = stale && hold === null;

  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  useEffect(() => {
    if (!grace) return;
    const from = deferred.key;
    const timer = setTimeout(() => {
      const next = startHold(from);
      setHold(next);
      holdTimer.current = setTimeout(next.release, HOLD_MS);
    }, GRACE_MS);
    return () => clearTimeout(timer);
  }, [grace, deferred.key, requested.key]);

  // For example, an error is on screen. A retry of it must not wait.
  useEffect(() => {
    if (holdOfEarlierList) hold.release();
  }, [hold, holdOfEarlierList]);

  return {
    deferred: deferred.value,
    stale,
    muted: stale && hold !== null,
    // Only the render of a new snapshot waits. The snapshot on screen must not suspend.
    gate: holdOfEarlierList ? hold.gate : null,
  };
}

/** Keeps the Suspense boundary that it is in from showing a new snapshot before the hold ends. */
export function HoldReveal({ gate }: { gate: Promise<void> | null }) {
  if (gate) use(gate);
  return null;
}

export type ListInputs = {
  scope: ListScope;
  setting: PeriodSetting;
  now: Date;
  search: { text: string; allDates: boolean };
};

export function listKey({ scope, setting, now }: Omit<ListInputs, 'search'>) {
  return JSON.stringify(homeListQuery(scope, setting, now).queryKey);
}

/** Defers the inputs of the Home list together, and times the muting of the list on screen. */
export function useDeferredListInputs(inputs: ListInputs) {
  const key = JSON.stringify([listKey(inputs), inputs.search.text, inputs.search.allDates]);
  return useDeferredSnapshot(inputs, key);
}
