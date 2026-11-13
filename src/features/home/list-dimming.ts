export const DIM_DELAY_MS = 50;
export const MINIMUM_DIM_TIME_MS = 500;

export type ListDimming = {
  pendingSince: number | null;
  dimmedSince: number | null;
};

export function updateListDimming(state: ListDimming, pending: boolean, now: number): ListDimming {
  'worklet';
  if (pending) {
    const pendingSince = state.pendingSince ?? now;
    if (state.dimmedSince === null && now - pendingSince >= DIM_DELAY_MS) {
      return { pendingSince, dimmedSince: now };
    }
    return state.pendingSince === pendingSince ? state : { ...state, pendingSince };
  }
  const dimmedSince =
    state.dimmedSince !== null && now - state.dimmedSince >= MINIMUM_DIM_TIME_MS
      ? null
      : state.dimmedSince;
  return state.pendingSince === null && state.dimmedSince === dimmedSince
    ? state
    : { pendingSince: null, dimmedSince };
}
