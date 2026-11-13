import type { SharedValue } from 'react-native-reanimated';
import { updateListDimming } from './list-dimming.ts';

type Animation = { target: number; delay: number; callback?: (finished: boolean) => void };
const mockAnimations = new Map<number, Animation>();
const mockTimers = new Map<SharedValue<number>, ReturnType<typeof setTimeout>>();
let mockAnimationId = -1;

jest.mock('react-native-reanimated', () => ({
  ReduceMotion: { Never: 'never' },
  withTiming: (target: number, _config: unknown, callback?: Animation['callback']) => {
    const id = mockAnimationId--;
    mockAnimations.set(id, { target, callback, delay: 0 });
    return id;
  },
  withDelay: (delay: number, id: number) => {
    mockAnimations.get(id)!.delay = delay;
    return id;
  },
  cancelAnimation: (value: SharedValue<number>) => {
    clearTimeout(mockTimers.get(value));
    mockTimers.delete(value);
  },
}));

// Run animation completions on a controllable clock; native frame scheduling needs device coverage.
function shared(initial: number): SharedValue<number> {
  let current = initial;
  const value: SharedValue<number> = {
    get value() {
      return current;
    },
    set value(next) {
      current = next;
    },
    get: () => current,
    set: (next) => {
      const target = typeof next === 'function' ? next(current) : next;
      const animation = mockAnimations.get(target);
      if (!animation) {
        current = target;
        return;
      }
      mockTimers.set(
        value,
        setTimeout(() => {
          current = animation.target;
          animation.callback?.(true);
          mockTimers.delete(value);
        }, animation.delay),
      );
    },
    addListener: () => {},
    removeListener: () => {},
    modify: () => {},
  };
  return value;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAnimations.clear();
  mockTimers.clear();
});
afterEach(() => jest.useRealTimers());

test('a quick completion cancels the 100 ms dim animation', () => {
  const opacity = shared(1),
    dimmedAt = shared(0);
  updateListDimming(true, opacity, dimmedAt);
  jest.advanceTimersByTime(99);
  expect(opacity.get()).toBe(1);
  updateListDimming(false, opacity, dimmedAt);
  jest.advanceTimersByTime(1000);
  expect(opacity.get()).toBe(1);
});

test('the minimum hold starts when dimming actually becomes visible', () => {
  const opacity = shared(1),
    dimmedAt = shared(0);
  updateListDimming(true, opacity, dimmedAt);
  jest.advanceTimersByTime(100);
  expect(opacity.get()).toBe(0.4);
  jest.advanceTimersByTime(80);
  updateListDimming(false, opacity, dimmedAt);
  jest.advanceTimersByTime(319);
  expect(opacity.get()).toBe(0.4);
  jest.advanceTimersByTime(1);
  expect(opacity.get()).toBe(1);
});

test('a slow completion restores full opacity without another hold', () => {
  const opacity = shared(1),
    dimmedAt = shared(0);
  updateListDimming(true, opacity, dimmedAt);
  jest.advanceTimersByTime(650);
  expect(opacity.get()).toBe(0.4);
  updateListDimming(false, opacity, dimmedAt);
  jest.advanceTimersByTime(0);
  expect(opacity.get()).toBe(1);
});

test('a new update cancels undimming and preserves the original visible hold', () => {
  const opacity = shared(1),
    dimmedAt = shared(0);
  updateListDimming(true, opacity, dimmedAt);
  jest.advanceTimersByTime(100);
  updateListDimming(false, opacity, dimmedAt);
  jest.advanceTimersByTime(100);
  updateListDimming(true, opacity, dimmedAt);
  jest.advanceTimersByTime(400);
  expect(opacity.get()).toBe(0.4);
  updateListDimming(false, opacity, dimmedAt);
  jest.advanceTimersByTime(0);
  expect(opacity.get()).toBe(1);
  updateListDimming(true, opacity, dimmedAt);
  jest.advanceTimersByTime(99);
  expect(opacity.get()).toBe(1);
  jest.advanceTimersByTime(1);
  expect(opacity.get()).toBe(0.4);
});
