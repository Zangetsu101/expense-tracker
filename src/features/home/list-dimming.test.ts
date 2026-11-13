import { updateListDimming, type ListDimming } from './list-dimming.ts';

const idle = (): ListDimming => ({ pendingSince: null, dimmedSince: null });

test('completion before 100 ms never dims and a new defer starts a fresh delay', () => {
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, 99);
  expect(state.dimmedSince).toBeNull();
  state = updateListDimming(state, false, 99);
  state = updateListDimming(state, true, 200);
  expect(updateListDimming(state, true, 299).dimmedSince).toBeNull();
  expect(updateListDimming(state, true, 300).dimmedSince).toBe(300);
});

test('the visible dimmed period lasts at least 400 ms after the 100 ms delay', () => {
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, 100);
  expect(state.dimmedSince).toBe(100);
  state = updateListDimming(state, false, 180);
  expect(state.dimmedSince).toBe(100);
  state = updateListDimming(state, false, 499);
  expect(state.dimmedSince).toBe(100);
  expect(updateListDimming(state, false, 500).dimmedSince).toBeNull();
});

test('a slow completion undims on the first synced frame', () => {
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, 100);
  state = updateListDimming(state, true, 650);
  expect(state.dimmedSince).toBe(100);
  expect(updateListDimming(state, false, 650).dimmedSince).toBeNull();
});

test('consecutive defers preserve the visible hold and undim at 550 ms, not 900 ms', () => {
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, 100);
  state = updateListDimming(state, false, 150);
  state = updateListDimming(state, true, 400);
  expect(state.dimmedSince).toBe(100);
  state = updateListDimming(state, true, 500);
  expect(state.dimmedSince).toBe(100);
  state = updateListDimming(state, false, 550);
  expect(state).toEqual(idle());
  state = updateListDimming(state, true, 600);
  expect(updateListDimming(state, true, 699).dimmedSince).toBeNull();
  expect(updateListDimming(state, true, 700).dimmedSince).toBe(700);
});

test('minimum hold is measured from the actual first dimmed frame', () => {
  let state = updateListDimming(idle(), true, 0);
  state = updateListDimming(state, true, 120);
  expect(state.dimmedSince).toBe(120);
  state = updateListDimming(state, false, 150);
  expect(updateListDimming(state, false, 519).dimmedSince).toBe(120);
  expect(updateListDimming(state, false, 520).dimmedSince).toBeNull();
});
