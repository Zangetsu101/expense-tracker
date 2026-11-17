import { Suspense, memo, use, useLayoutEffect } from 'react';
import { Text } from 'react-native';
import { act, cleanup, render, screen } from '@testing-library/react-native';
import { ErrorBoundary } from '@/components/query-error-boundary';
import { GRACE_MS, HOLD_MS, useDeferredSnapshot } from './deferred-list.ts';

type Read = { promise: Promise<string>; resolve: () => void; reject: () => void };
let reads: Map<string, Read>;

/** A read for each key. It stays pending until the test resolves it. */
function read(key: string) {
  let entry = reads.get(key);
  if (!entry) {
    let resolve = () => {};
    let reject = () => {};
    const promise = new Promise<string>((done, fail) => {
      resolve = () => done(key);
      reject = () => fail(new Error(key));
    });
    entry = { promise, resolve, reject };
    reads.set(key, entry);
  }
  return entry;
}
const ready = (key: string) => act(async () => read(key).resolve());
const wait = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

let shownRenders: number;
const Shown = memo(function Shown({
  value,
  gate,
}: {
  value: { name: string };
  gate: Promise<void> | null;
}) {
  use(read(value.name).promise);
  if (gate) use(gate);
  useLayoutEffect(() => {
    shownRenders += 1;
  });
  return <Text>Shown {value.name}</Text>;
});

/** The list on screen and its muting, as each commit shows them. */
let commits: { shown: string; muted: boolean }[];
function Harness({ value }: { value: string }) {
  // A new object on each render, as a parent gives its inputs.
  const { deferred, stale, muted, gate } = useDeferredSnapshot({ name: value }, value);
  useLayoutEffect(() => {
    commits.push({ shown: deferred.name, muted });
  });
  return (
    <>
      <Text>{muted ? 'Muted' : 'Clear'}</Text>
      <Text>{stale ? 'Stale' : 'Current'}</Text>
      <ErrorBoundary
        resetKey={deferred.name}
        onReset={() => {}}
        fallback={() => <Text>Failed</Text>}
      >
        <Suspense fallback={<Text>Loading</Text>}>
          <Shown value={deferred} gate={gate} />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

let view: Awaited<ReturnType<typeof render>>;
let current: string;
async function start(initial = 'a') {
  read(initial).resolve();
  current = initial;
  view = await render(<Harness value={initial} />);
  await screen.findByText(`Shown ${initial}`);
}
const ask = (value: string) => {
  current = value;
  return view.rerender(<Harness value={value} />);
};
/** The parent renders again with equivalent inputs. */
const rerender = () => view.rerender(<Harness value={current} />);
const shows = (value: string) => expect(screen.getByText(`Shown ${value}`)).toBeOnTheScreen();
const isMuted = (muted: boolean) =>
  expect(screen.getByText(muted ? 'Muted' : 'Clear')).toBeOnTheScreen();

beforeEach(() => {
  reads = new Map();
  commits = [];
  shownRenders = 0;
  jest.useFakeTimers();
});
afterEach(async () => {
  await cleanup();
  jest.useRealTimers();
});

test('the first display has no muted hold, and a settled list starts no timer', async () => {
  await start();
  isMuted(false);
  expect(screen.getByText('Current')).toBeOnTheScreen();
  await wait(GRACE_MS * 2);
  await ask('b');
  isMuted(false);
});

test('results ready within grace replace the list without muting', async () => {
  await start();
  await ask('b');
  expect(screen.getByText('Stale')).toBeOnTheScreen();
  await wait(GRACE_MS - 1);
  isMuted(false);
  await ready('b');
  shows('b');
  isMuted(false);
  await wait(HOLD_MS);
  isMuted(false);
});

test('results ready during the hold stay gated until the hold ends', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS);
  isMuted(true);
  await ready('b');
  shows('a');
  await wait(HOLD_MS - 1);
  shows('a');
  isMuted(true);
  await wait(1);
  shows('b');
  isMuted(false);
  expect(screen.getByText('Current')).toBeOnTheScreen();
  // The new list and the end of muting come in the same commit.
  expect(commits).toContainEqual({ shown: 'a', muted: true });
  expect(commits).not.toContainEqual({ shown: 'b', muted: true });
});

test('results ready after the hold show at once', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS + HOLD_MS + 100);
  shows('a');
  isMuted(true);
  await ready('b');
  shows('b');
  isMuted(false);
});

test('new inputs during grace restart grace and replace the request', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS - 10);
  await ask('c');
  await wait(GRACE_MS - 10);
  isMuted(false);
  await ready('b');
  shows('a');
  await wait(10);
  isMuted(true);
  await ready('c');
  await wait(HOLD_MS);
  shows('c');
  isMuted(false);
});

test.each([
  ['waiting', false],
  ['ready', true],
] as const)(
  'new inputs during the hold (%s) keep its deadline and wait for the new results',
  async (_name, firstReady) => {
    await start();
    await ask('b');
    await wait(GRACE_MS);
    if (firstReady) await ready('b');
    await wait(HOLD_MS / 2);
    await ask('c');
    await wait(GRACE_MS);
    isMuted(true);
    await wait(HOLD_MS / 2 - GRACE_MS);
    shows('a');
    isMuted(true);
    await ready('c');
    shows('c');
    isMuted(false);
  },
);

test('new inputs after the hold keep the list muted and start no new hold', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS + HOLD_MS);
  await ask('c');
  isMuted(true);
  await ready('c');
  shows('c');
  isMuted(false);
});

test('a replaced request that becomes ready cannot release the current one', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS);
  await ask('c');
  await wait(HOLD_MS);
  await ready('b');
  shows('a');
  isMuted(true);
  await ready('c');
  shows('c');
});

test('equivalent inputs on a re-render do not restart the grace period', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS - 10);
  await ask('b');
  await rerender();
  await wait(10);
  isMuted(true);
});

test('equivalent inputs on a re-render keep the same snapshot', async () => {
  await start();
  const renders = shownRenders;
  await rerender();
  expect(shownRenders).toBe(renders);
});

test('a request back to the list on screen settles it, and the next request has grace', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS);
  isMuted(true);
  await ask('a');
  isMuted(false);
  expect(screen.getByText('Current')).toBeOnTheScreen();
  shows('a');
  await ask('c');
  isMuted(false);
  await wait(GRACE_MS - 1);
  isMuted(false);
  await wait(1);
  isMuted(true);
});

test('an obsolete hold timer does not release a later episode', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS);
  await ask('a');
  await ask('c');
  await wait(GRACE_MS);
  await ready('c');
  // The first hold ends here. The second hold started GRACE_MS later.
  await wait(HOLD_MS - GRACE_MS);
  shows('a');
  isMuted(true);
  await wait(GRACE_MS);
  shows('c');
  isMuted(false);
});

test('a failed request does not leave the list muted', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS + HOLD_MS);
  isMuted(true);
  await act(async () => read('b').reject());
  expect(screen.getByText('Failed')).toBeOnTheScreen();
  isMuted(false);
});

test('a request after a failure during the hold has its own grace period', async () => {
  await start();
  await ask('b');
  await wait(GRACE_MS);
  await act(async () => read('b').reject());
  expect(screen.getByText('Failed')).toBeOnTheScreen();
  await ask('c');
  await ready('c');
  shows('c');
  isMuted(false);
});
