const dimDelayMs = 50;
const minimumDimTimeMs = 500;

export type ListDimming = {
  pendingSince: number | null;
  dimmedSince: number | null;
};

export function updateListDimming(state: ListDimming, pending: boolean, now: number): ListDimming {
  'worklet';
  if (pending) {
    const pendingSince = state.pendingSince ?? now;
    if (state.dimmedSince === null && now - pendingSince >= dimDelayMs) {
      return { pendingSince, dimmedSince: now };
    }
    return state.pendingSince === pendingSince ? state : { ...state, pendingSince };
  }
  const dimmedSince =
    state.dimmedSince !== null && now - state.dimmedSince >= minimumDimTimeMs
      ? null
      : state.dimmedSince;
  return state.pendingSince === null && state.dimmedSince === dimmedSince
    ? state
    : { pendingSince: null, dimmedSince };
}
