import {
  DIM_DELAY_MS,
  MINIMUM_DIM_TIME_MS,
  updateListDimming,
  type ListDimming,
} from './list-dimming.ts';

const idle = (): ListDimming => ({ pendingSince: null, dimmedSince: null });

test('completion before the delay never dims and a new defer starts a fresh delay', () => {
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, DIM_DELAY_MS - 1);
  expect(state.dimmedSince).toBeNull();
  state = updateListDimming(state, false, DIM_DELAY_MS - 1);
  const nextStart = DIM_DELAY_MS * 2;
  const nextDim = nextStart + DIM_DELAY_MS;
  state = updateListDimming(state, true, nextStart);
  expect(updateListDimming(state, true, nextDim - 1).dimmedSince).toBeNull();
  expect(updateListDimming(state, true, nextDim).dimmedSince).toBe(nextDim);
});

test('the visible dimmed period lasts for the minimum hold after the delay', () => {
  const dimAt = DIM_DELAY_MS;
  const holdEndsAt = dimAt + MINIMUM_DIM_TIME_MS;
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, dimAt);
  expect(state.dimmedSince).toBe(dimAt);
  state = updateListDimming(state, false, dimAt + 1);
  expect(state.dimmedSince).toBe(dimAt);
  state = updateListDimming(state, false, holdEndsAt - 1);
  expect(state.dimmedSince).toBe(dimAt);
  expect(updateListDimming(state, false, holdEndsAt).dimmedSince).toBeNull();
});

test('a slow completion undims on the first synced frame', () => {
  const dimAt = DIM_DELAY_MS;
  const syncedAt = dimAt + MINIMUM_DIM_TIME_MS + 1;
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, dimAt);
  state = updateListDimming(state, true, syncedAt);
  expect(state.dimmedSince).toBe(dimAt);
  expect(updateListDimming(state, false, syncedAt).dimmedSince).toBeNull();
});

test('consecutive defers preserve the visible hold and undim when the second defer syncs', () => {
  const dimAt = DIM_DELAY_MS;
  const holdEndsAt = dimAt + MINIMUM_DIM_TIME_MS;
  const firstSyncedAt = dimAt + MINIMUM_DIM_TIME_MS / 4;
  const secondStart = dimAt + (MINIMUM_DIM_TIME_MS * 3) / 4;
  const secondSyncedAt = holdEndsAt + DIM_DELAY_MS;
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, dimAt);
  state = updateListDimming(state, false, firstSyncedAt);
  state = updateListDimming(state, true, secondStart);
  expect(state.dimmedSince).toBe(dimAt);
  state = updateListDimming(state, true, holdEndsAt);
  expect(state.dimmedSince).toBe(dimAt);
  state = updateListDimming(state, false, secondSyncedAt);
  expect(state).toEqual(idle());
  const nextStart = secondSyncedAt + 1;
  const nextDim = nextStart + DIM_DELAY_MS;
  state = updateListDimming(state, true, nextStart);
  expect(updateListDimming(state, true, nextDim - 1).dimmedSince).toBeNull();
  expect(updateListDimming(state, true, nextDim).dimmedSince).toBe(nextDim);
});

test('minimum hold is measured from the actual first dimmed frame', () => {
  const dimAt = DIM_DELAY_MS + 16;
  const holdEndsAt = dimAt + MINIMUM_DIM_TIME_MS;
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, dimAt);
  expect(state.dimmedSince).toBe(dimAt);
  state = updateListDimming(state, false, dimAt + 1);
  expect(updateListDimming(state, false, holdEndsAt - 1).dimmedSince).toBe(dimAt);
  expect(updateListDimming(state, false, holdEndsAt).dimmedSince).toBeNull();
});
