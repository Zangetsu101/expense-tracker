import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { QueryClientProvider, notifyManager } from '@tanstack/react-query';

notifyManager.setScheduler(queueMicrotask);
const state = { read: undefined, pushed: [] };
globalThis.__homeScreenTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../../', import.meta.url);
const mocks = {
  '@/features/quick-add': `export const invalidateQuickAdd=async()=>{};`,
  'react-native': `import React from 'react';
    export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator';
    export const FlatList=p=>React.createElement('FlatList',p,p.data.map((item,index)=>React.createElement(React.Fragment,{key:p.keyExtractor(item)},p.renderItem({item,index}))));
    export const AppState={currentState:'active',addEventListener:(_,fn)=>{globalThis.__homeScreenTest.lifecycle=fn;return {remove(){}}}};
    export const Platform={OS:'android'}; export const useWindowDimensions=()=>({width:400,height:800});`,
  'react-native-reanimated': `export default {View:'AnimatedView'}; export const FadeInDown={},FadeOutUp={},LinearTransition={};`,
  './trend-chart.tsx': `export const TrendChart='TrendChart';`,
  'expo-router': `export const Stack={Screen:({options})=>options.headerTitle?options.headerTitle():null}; export const router={push(to){globalThis.__homeScreenTest.pushed.push(to)}};`,
  'expo-status-bar': `export const StatusBar=()=>null;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  '@/components/loading': `export const Skeleton='Skeleton'; export const Shimmer='Shimmer';`,
  '@/components/app-sheet': `export const AppSheet='AppSheet';`,
  '@/lib/database': `export const database=async()=>{},defaultCurrencyCode='BDT'; export const epochDay=d=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);`,
  './read-home.ts': `const r=(...a)=>globalThis.__homeScreenTest.read(...a);
    export const homeDeckData=today=>r('deck',today); export const homeTrend=(id,start,today)=>r('trend',id,start,today);
    export const homePace=(id)=>r('pace',id); export const homeData=id=>r('list',id);
    export const savePeriodSetting=setting=>r('save',setting);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `home-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const stem = specifier.replace('@/', 'src/');
      const path = existsSync(new URL(`${stem}/index.ts`, root))
        ? `${stem}/index.ts`
        : existsSync(new URL(`${stem}.ts`, root))
          ? `${stem}.ts`
          : `${stem}.tsx`;
      return { url: new URL(path, root).href, shortCircuit: true };
    }
    return next(
      specifier,
      context.parentURL?.startsWith('home-mock:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('home-mock:'))
      return { format: 'module', source: mocks[url.slice(10)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    return next(url, context);
  },
});

const account = (id, name, isFavorite = 0, balanceMinor = 100000) => ({
  id,
  name,
  currencyCode: 'BDT',
  isFavorite,
  balanceMinor,
  lastUsedDay: null,
});
const threeAccounts = [account(1, 'Cash', 1), account(2, 'Bank'), account(3, 'Savings')];
const deck = (accounts = threeAccounts, period = { range: 'month', monthStart: 1 }) => ({
  accounts,
  displayRate: null,
  period,
});
const row = (id, name) => ({
  id,
  type: 'EXPENSE',
  date: 20000,
  amountMinor: 500,
  currencyCode: 'BDT',
  accountId: 1,
  transferAccountId: null,
  accountName: name,
  transferAccountName: null,
  categoryName: `Lunch ${id}`,
});
const list = (id) => ({ rows: [row(id ?? 0, 'Cash')], dailySummaries: [] });
const pace = [{ currencyCode: 'BDT', spentMinor: 6000, sameMinor: 5000, previousMinor: 9000 }];
const ready = {
  deck: () => deck(),
  trend: () => [1000, 1200, 1100],
  pace: () => pace,
  list: (id) => list(id),
  save: () => undefined,
};
/** Reads resolve at once from `ready` unless a test gives its own function for a key. */
function reads(overrides = {}) {
  const log = [];
  state.read = async (key, ...args) => {
    log.push([key, ...args]);
    return (overrides[key] ?? ready[key])(...args);
  };
  return log;
}
/** Reads for `key` wait until the test settles them. */
function pending(key, rest = {}) {
  const calls = [];
  const log = reads({
    ...rest,
    [key]: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })),
  });
  return { calls, log };
}

const { HomeScreen } = await import('./index.ts');
const { createQueryClient } = await import('../../lib/query-client.ts');
const { AppQueryLifecycle } = await import('../../components/app-queries.tsx');
const { notifyDataChanged } = await import('../../lib/data-changes.ts');

let queryClient;
let renderer;
async function mount() {
  queryClient?.clear();
  queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity },
  });
  await act(async () => {
    renderer = create(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(AppQueryLifecycle, null, React.createElement(HomeScreen)),
      ),
    );
  });
}
const textOf = (node) =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
const texts = () => renderer.root.findAllByType('Text').map(textOf);
const has = (text) => texts().includes(text);
const button = (label) =>
  renderer.root.findAllByType('Pressable').find((n) => n.props.accessibilityLabel === label);
const retries = () =>
  renderer.root
    .findAllByType('Pressable')
    .filter((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
const title = () =>
  renderer.root
    .findAllByType('Pressable')
    .find((n) => n.props.accessibilityLabel?.endsWith(', choose account'));
const deckList = () => renderer.root.findAllByType('FlatList').find((n) => n.props.horizontal);
const interval = 400 - 64 + 12;
const swipeTo = (index) =>
  act(async () =>
    deckList().props.onMomentumScrollEnd({
      nativeEvent: { contentOffset: { x: index * interval } },
    }),
  );
const pickAccount = async (name) => {
  await act(async () => title().props.onPress());
  await act(async () => button(name).props.onPress());
};
const card = (name) =>
  renderer.root.findAllByType('View').find((n) => n.props.accessibilityLabel === name);
const cardTexts = (name) => card(name).findAllByType('Text').map(textOf);

test('Home boundaries', async (t) => {
  t.afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    queryClient?.clear();
    state.pushed = [];
  });
  t.after(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    hooks.deregister();
    delete globalThis.__homeScreenTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  await t.test(
    'first load shows skeletons, starts the list with the deck, and opens on All accounts',
    async () => {
      const { calls, log } = pending('deck');
      await mount();
      assert.ok(renderer.root.findAllByType('Skeleton').length > 0);
      assert.equal(title(), undefined, 'no title button before the deck loads');
      assert.equal(button('Add transaction').props.disabled, true);
      assert.deepEqual(
        log.map(([key, id]) => [key, id]),
        [
          ['list', null],
          ['deck', log[1][1]],
        ],
        'the list read starts at the same time as the deck read',
      );
      await act(async () => calls[0].resolve(deck()));
      assert.equal(title().props.accessibilityLabel, 'All accounts, choose account');
      assert.ok(has('Lunch 0'));
      assert.ok(cardTexts('All accounts').includes('Spent ৳60.00'));
      assert.ok(cardTexts('Cash').some((text) => text.startsWith('+৳1.00 since ')));
      assert.equal(
        log.filter(([key]) => key === 'list').length,
        1,
        'the prefetched list is reused',
      );
      assert.equal(button('Card 1 of 4'), undefined);
      assert.ok(
        renderer.root
          .findAllByType('View')
          .some((n) => n.props.accessibilityLabel === 'Card 1 of 4'),
      );
    },
  );

  await t.test('a failed card keeps its balance and retries on its own', async () => {
    let fail = true;
    const log = reads({
      pace: () => {
        if (fail) throw Error('pace unavailable');
        return pace;
      },
    });
    await mount();
    assert.ok(cardTexts('All accounts').includes('Couldn’t load this card'));
    assert.ok(cardTexts('All accounts').includes('৳3,000.00'), 'the balance stays');
    assert.ok(has('Lunch 0'), 'the list is not affected');
    assert.ok(!cardTexts('Cash').includes('Couldn’t load this card'));
    fail = false;
    const listReads = log.filter(([key]) => key === 'list').length;
    await act(async () =>
      card('All accounts')
        .findAllByType('Pressable')
        .find((n) => n.findAllByType('Text').some((x) => x.children.join('') === 'Retry'))
        .props.onPress(),
    );
    assert.ok(cardTexts('All accounts').includes('Spent ৳60.00'));
    assert.equal(
      log.filter(([key]) => key === 'list').length,
      listReads,
      'Retry reads the card only',
    );
  });

  await t.test(
    'a scope change dims the old list at once and a late result cannot replace the new scope',
    async () => {
      reads();
      await mount();
      const { calls } = pending('list');
      await swipeTo(2);
      assert.equal(
        title().props.accessibilityLabel,
        'Bank, choose account',
        'the title changes at once',
      );
      assert.ok(button('Search Bank'));
      assert.ok(has('Lunch 0'), 'the old rows stay');
      assert.equal(button('Lunch 0, Cash').props.disabled, true, 'old rows cannot be opened');
      await pickAccount('Savings');
      assert.equal(title().props.accessibilityLabel, 'Savings, choose account');
      assert.deepEqual(
        calls.map((call) => call.args[0]),
        [2, 3],
      );
      await act(async () => calls[1].resolve(list(3)));
      await act(async () => calls[0].resolve(list(2)));
      assert.ok(has('Lunch 3'));
      assert.ok(!has('Lunch 2'), 'the late result for Bank does not show');
      assert.equal(button('Lunch 3, Cash').props.disabled, false);
    },
  );

  await t.test('a failed list tries again when the deck returns to its account', async () => {
    let bankFails = true;
    const log = reads({
      list: (id) => {
        if (id === 2 && bankFails) throw Error('Bank unavailable');
        return list(id);
      },
    });
    await mount();
    await swipeTo(2);
    assert.ok(has('Couldn’t load account activity'));
    assert.ok(cardTexts('Bank').includes('৳1,000.00'), 'the deck stays');
    await swipeTo(3);
    assert.ok(has('Lunch 3'));
    bankFails = false;
    await swipeTo(2);
    assert.ok(has('Lunch 2'));
    assert.equal(
      log.filter(([key, id]) => key === 'list' && id === 2).length,
      2,
      'the return fetches Bank again',
    );
  });

  await t.test('list Retry recovers the list without reading the deck again', async () => {
    let fail = true;
    const log = reads({
      list: (id) => {
        if (fail) throw Error('unavailable');
        return list(id);
      },
    });
    await mount();
    assert.ok(has('Couldn’t load account activity'));
    assert.equal(renderer.root.findAllByType('Skeleton').length, 0);
    fail = false;
    const deckReads = log.filter(([key]) => key === 'deck').length;
    await act(async () => retries()[0].props.onPress());
    assert.ok(has('Lunch 0'));
    assert.equal(log.filter(([key]) => key === 'deck').length, deckReads);
  });

  await t.test(
    'a range change keeps the old cards dimmed, saves the range, and shows the new label at once',
    async () => {
      reads();
      await mount();
      const { calls, log } = pending('pace');
      await act(async () => button('Period, November').props.onPress());
      await act(async () => button('This week').props.onPress());
      const pill = renderer.root
        .findAllByType('Pressable')
        .find((n) => n.props.accessibilityLabel?.startsWith('Period, Week of'));
      assert.ok(pill, 'the pill shows the new range at once');
      assert.equal(pill.props.accessibilityState.busy, true);
      assert.ok(pill.findAllByType('ActivityIndicator').length > 0);
      assert.ok(cardTexts('All accounts').includes('Spent ৳60.00'), 'old Pace stays');
      assert.ok(
        log.some(([key, setting]) => key === 'save' && setting.range === 'week'),
        'the range is saved',
      );
      await act(async () =>
        calls[0].resolve([
          { currencyCode: 'BDT', spentMinor: 1000, sameMinor: 2000, previousMinor: 3000 },
        ]),
      );
      assert.ok(cardTexts('All accounts').includes('Spent ৳10.00'));
      assert.equal(
        renderer.root
          .findAllByType('Pressable')
          .find((n) => n.props.accessibilityLabel?.startsWith('Period, Week of')).props
          .accessibilityState.busy,
        false,
      );
      assert.equal(
        queryClient.getQueriesData({ queryKey: ['home', 'deck'] })[0][1].period.range,
        'week',
        'the cached deck holds the saved range',
      );
    },
  );

  await t.test('a range change clears a card error', async () => {
    reads({
      pace: () => {
        throw Error('unavailable');
      },
    });
    await mount();
    assert.ok(cardTexts('All accounts').includes('Couldn’t load this card'));
    reads();
    await act(async () => button('Period, November').props.onPress());
    await act(async () => button('This year').props.onPress());
    assert.ok(cardTexts('All accounts').includes('Spent ৳60.00'));
    await act(async () => button('This month').props.onPress());
    assert.ok(
      cardTexts('All accounts').includes('Spent ৳60.00'),
      'the return to the failed range fetches it again',
    );
  });

  await t.test(
    'a failed refresh keeps the cached deck and shows the notice until Retry succeeds',
    async () => {
      reads();
      await mount();
      reads({
        deck: () => {
          throw Error('unavailable');
        },
      });
      await act(async () => notifyDataChanged());
      assert.ok(has('Couldn’t refresh accounts'));
      assert.ok(cardTexts('Cash').includes('৳1,000.00'), 'the cached balances stay');
      assert.ok(has('Lunch 0'));
      assert.equal(
        renderer.root.findAllByType('ActivityIndicator').length,
        0,
        'no refresh spinner',
      );
      reads({
        deck: () =>
          deck([account(1, 'Cash', 1, 250000), account(2, 'Bank'), account(3, 'Savings')]),
      });
      await act(async () => button('Retry refresh').props.onPress());
      assert.ok(!has('Couldn’t refresh accounts'));
      assert.ok(cardTexts('Cash').includes('৳2,500.00'));
    },
  );

  await t.test('the notice stays while Retry runs and goes after a refresh succeeds', async () => {
    reads();
    await mount();
    reads({
      deck: () => {
        throw Error('unavailable');
      },
    });
    await act(async () => notifyDataChanged());
    const { calls } = pending('deck');
    await act(async () => button('Retry refresh').props.onPress());
    assert.ok(has('Couldn’t refresh accounts'), 'the notice stays while Retry runs');
    await act(async () => calls[0].reject(Error('still unavailable')));
    assert.ok(has('Couldn’t refresh accounts'));
    reads();
    await act(async () => button('Retry refresh').props.onPress());
    assert.ok(!has('Couldn’t refresh accounts'));
  });

  await t.test(
    'the deck stays on the account in view when the order of the cards changes',
    async () => {
      reads();
      await mount();
      await swipeTo(2);
      const before = deckList();
      assert.equal(before.props.data[2].card.account.name, 'Bank');
      const savingsUsed = { ...account(3, 'Savings'), lastUsedDay: 20000 };
      reads({ deck: () => deck([account(1, 'Cash', 1), account(2, 'Bank'), savingsUsed]) });
      await act(async () => notifyDataChanged());
      assert.equal(title().props.accessibilityLabel, 'Bank, choose account');
      assert.notEqual(deckList(), before, 'a new order mounts a new deck');
      assert.equal(deckList().props.data[3].card.account.name, 'Bank');
      assert.equal(deckList().props.initialScrollIndex, 3, 'the new deck opens on Bank');
      reads({ deck: () => deck([account(1, 'Cash', 1), savingsUsed]) });
      await act(async () => notifyDataChanged());
      assert.equal(
        title().props.accessibilityLabel,
        'All accounts, choose account',
        'a deleted account falls back to the first card',
      );
      assert.equal(deckList().props.initialScrollIndex, 0);
    },
  );

  await t.test('a cold deck failure offers Retry for the whole screen', async () => {
    let fail = true;
    reads({
      deck: () => {
        if (fail) throw Error('unavailable');
        return deck();
      },
    });
    await mount();
    assert.ok(has('Couldn’t load Home'));
    assert.equal(button('Add transaction').props.disabled, true);
    fail = false;
    await act(async () => retries()[0].props.onPress());
    assert.equal(title().props.accessibilityLabel, 'All accounts, choose account');
  });

  await t.test('one account gets one Pace card, no dots, and an Add an account card', async () => {
    reads({ deck: () => deck([account(7, 'Cash', 1)]) });
    await mount();
    assert.equal(title().props.accessibilityLabel, 'Cash, choose account');
    assert.ok(cardTexts('Cash').includes('Spent ৳60.00'));
    assert.equal(card('All accounts'), undefined);
    assert.ok(
      !renderer.root
        .findAllByType('View')
        .some((n) => n.props.accessibilityLabel?.startsWith('Card ')),
    );
    const add = renderer.root
      .findAllByType('Pressable')
      .find((n) => n.findAllByType('Text').some((x) => x.children.join('') === '+ Add an account'));
    await act(async () => add.props.onPress());
    assert.deepEqual(state.pushed, ['/accounts']);
  });

  await t.test('Quick add uses the account in view, or the favorite on All accounts', async () => {
    reads();
    await mount();
    await act(async () => button('Add transaction').props.onPress());
    await swipeTo(2);
    await act(async () => button('Add transaction').props.onPress());
    assert.deepEqual(
      state.pushed.map((to) => to.params),
      [{ accountId: '1' }, { accountId: '2' }],
    );
  });

  await t.test('a refresh keeps loaded content without skeletons or spinners', async () => {
    reads();
    await mount();
    const before = texts();
    const { calls } = pending('list');
    await act(async () => notifyDataChanged());
    assert.ok(calls.length > 0, 'committed writes refresh Home');
    assert.deepEqual(texts(), before);
    assert.equal(renderer.root.findAllByType('Skeleton').length, 0);
    assert.equal(button('Lunch 0, Cash').props.disabled, false);
    await act(async () => calls.forEach((call) => call.resolve({ rows: [], dailySummaries: [] })));
    assert.ok(has('No transactions yet. Add one to get started.'));
  });
});
