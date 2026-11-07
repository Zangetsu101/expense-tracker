import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { QueryClientProvider, notifyManager, onlineManager } from '@tanstack/react-query';

notifyManager.setScheduler(queueMicrotask);
const state = { read: undefined };
globalThis.__homeScreenTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../../', import.meta.url);
const mocks = {
  'react-native': `import React from 'react'; export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator',KeyboardAvoidingView='KeyboardAvoidingView'; export const FlatList=p=>React.createElement('FlatList',p,p.ListHeaderComponent,p.data.map((item,index)=>React.createElement(React.Fragment,{key:item.id},p.renderItem({item,index})))); export const AppState={currentState:'active',addEventListener:(_,fn)=>{globalThis.__homeScreenTest.lifecycle=fn;return {remove(){}}}}; export const Platform={OS:'android'}; export const useWindowDimensions=()=>({width:400,height:800});`,
  'expo-router': `export const Stack={Screen:()=>null}; export const Link=({children})=>children; export const router={push(){}};`,
  'expo-status-bar': `export const StatusBar=()=>null;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  './loading.tsx': `export const Skeleton='Skeleton'; export const Shimmer='Shimmer';`,
  './account-picker.tsx': `export const HomeAccountPicker='HomeAccountPicker';`,
  '@/lib/database': `export const epochDay=d=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000); export const listAccounts=async()=>{if(globalThis.__homeScreenTest.accountsRead)return globalThis.__homeScreenTest.accountsRead();if(globalThis.__homeScreenTest.accountsError)throw Error('accounts unavailable');return globalThis.__homeScreenTest.accountItems??[{id:1,name:'Cash',currencyCode:'USD',isFavorite:1},{id:2,name:'Bank',currencyCode:'USD',isFavorite:0},{id:3,name:'Savings',currencyCode:'USD',isFavorite:0},{id:4,name:'Card',currencyCode:'USD',isFavorite:0}];};`,
  '@/lib/reports': `export const monthlyReport=()=>globalThis.__homeScreenTest.read('reports'); export const accountBalances=today=>globalThis.__homeScreenTest.read('balances',today);`,
  './read-home.ts': `export const homeData=(_,id)=>globalThis.__homeScreenTest.read('home',id);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `tab-mock:${specifier}`, shortCircuit: true };
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
      context.parentURL?.startsWith('tab-mock:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('tab-mock:'))
      return { format: 'module', source: mocks[url.slice(9)], shortCircuit: true };
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

const fixtures = {
  home: {
    dailySummaries: [{ date: 20000, currencyCode: 'USD', expenseMinor: 500, incomeMinor: 0 }],
    rows: [
      {
        id: 1,
        type: 'EXPENSE',
        date: 20000,
        amountMinor: 500,
        currencyCode: 'USD',
        accountName: 'Cash',
        categoryName: 'Lunch',
      },
    ],
    summaries: [{ currencyCode: 'USD', expenseMinor: 500, incomeMinor: 1000 }],
  },
  balances: [{ id: 1, name: 'Cash', currencyCode: 'USD', balanceMinor: 1500 }],
};
const { HomeScreen } = await import('./index.ts');
const { createQueryClient } = await import('../../lib/query-client.ts');
const { AppQueryLifecycle } = await import('../../components/app-queries.tsx');
const { notifyDataChanged } = await import('../../lib/data-changes.ts');
const { QueryTimeContext } = await import('../../lib/query-time.ts');
let queryClient;
function QueryScreen({ Screen }) {
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(AppQueryLifecycle, null, React.createElement(Screen)),
  );
}
function resetQueryClient() {
  queryClient?.clear();
  queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity },
  });
}
let renderer;
const texts = () => renderer.root.findAllByType('Text').map((n) => n.children.join(''));
const financialRetry = () =>
  renderer.root
    .findAllByType('Pressable')
    .find((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
test('Home loading, retained content and cache behavior', async (t) => {
  t.afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    queryClient?.clear();
    delete state.accountsError;
    delete state.accountsRead;
    delete state.accountItems;
  });
  t.after(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    hooks.deregister();
    delete globalThis.__homeScreenTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await t.test('Accounts suspend before selection and financial reads initialize', async () => {
    let finishAccounts;
    state.accountsRead = () =>
      new Promise((resolve) => {
        finishAccounts = resolve;
      });
    const scopes = [];
    state.read = async (key, id) => {
      if (key === 'home') scopes.push(id);
      return fixtures[key];
    };
    await act(async () => {
      resetQueryClient();
      renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
    });
    const picker = () => renderer.root.findByType('HomeAccountPicker');
    assert.equal(picker().props.unavailable, true);
    assert.equal(picker().props.loading, true);
    assert.ok(renderer.root.findAllByType('Skeleton').length > 0);
    assert.deepEqual(scopes, [], 'financial reads wait for the default Account');
    await act(async () =>
      finishAccounts([
        { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 0 },
        { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 1 },
      ]),
    );
    assert.equal(picker().props.selectedId, 2);
    assert.equal(picker().props.unavailable, false);
    assert.deepEqual(scopes, [2]);
  });
  await t.test(
    'Home Account transitions retain the correct receipt meaning and recover without stale writes',
    async () => {
      const Screen = HomeScreen;
      const transfer = {
        id: 9,
        type: 'TRANSFER',
        date: 20000,
        amountMinor: 500,
        currencyCode: 'USD',
        accountId: 1,
        transferAccountId: 2,
        accountName: 'Cash',
        transferAccountName: 'Bank',
      };
      state.read = async (key) =>
        key === 'home' ? { ...fixtures.home, rows: [transfer] } : fixtures[key];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      const entry = () =>
        renderer.root
          .findAllByType('Pressable')
          .find((n) => n.props.accessibilityLabel === 'Transfer, Cash');
      assert.ok(texts().some((s) => s === 'Sent to Bank'));
      assert.equal(entry().props.disabled, false);
      const requests = [];
      state.read = (key, id) =>
        key === 'home'
          ? new Promise((resolve, reject) => requests.push({ id, resolve, reject }))
          : Promise.resolve(fixtures[key]);
      await act(async () => picker().props.onSelect(2));
      assert.equal(picker().props.selectedId, 2, 'selection changes before data');
      assert.equal(picker().props.loading, false);
      assert.equal(entry().props.disabled, true, 'old Transactions cannot be opened');
      assert.ok(
        texts().some((s) => s === 'Sent to Bank'),
        'old Transfer keeps its original direction',
      );
      assert.ok(!texts().some((s) => s === 'Received from Cash'));
      assert.equal(
        renderer.root
          .findAllByType('Pressable')
          .find((n) => n.props.accessibilityLabel === 'Add transaction').props.disabled,
        false,
      );
      await act(async () => requests[0].reject(new Error('read failed')));
      assert.equal(picker().props.error, false);
      assert.equal(picker().props.loading, false);
      assert.equal(picker().props.selectedId, 2);
      assert.equal(entry(), undefined);
      assert.ok(texts().includes('Couldn’t load account activity'));
      await act(async () => financialRetry().props.onPress());
      assert.equal(picker().props.error, false);
      await act(async () => requests[1].resolve({ ...fixtures.home, rows: [transfer] }));
      assert.equal(entry().props.disabled, false);
      assert.ok(texts().some((s) => s === 'Received from Cash'));
      await act(async () => picker().props.onSelect(3));
      await act(async () => picker().props.onSelect(4));
      await act(async () => requests[3].resolve({ ...fixtures.home, rows: [] }));
      await act(async () => requests[2].resolve({ ...fixtures.home, rows: [transfer] }));
      assert.equal(picker().props.selectedId, 4);
      assert.equal(
        renderer.root.findByType('FlatList').props.data.length,
        0,
        'late result cannot replace the latest selection',
      );
    },
  );
  await t.test(
    'Home keeps an explicit selection after backgrounding and resets on remount',
    async () => {
      state.read = async (key) => fixtures[key];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      await act(async () => picker().props.onSelect(2));
      await act(async () => {
        state.lifecycle('background');
        state.lifecycle('active');
      });
      assert.equal(picker().props.selectedId, 2);
      await act(async () => renderer.unmount());
      await act(async () => {
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      assert.equal(picker().props.selectedId, 1, 'a new mount starts at the favorite');
    },
  );
  await t.test(
    'the same selector stays mounted through financial loading, success, error and retry',
    async () => {
      const reads = [];
      state.read = (key) =>
        key === 'home'
          ? new Promise((resolve, reject) => reads.push({ resolve, reject }))
          : Promise.resolve(fixtures[key]);
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      const selector = renderer.root.findByType('HomeAccountPicker');
      const assertSameSelector = () =>
        assert.equal(renderer.root.findByType('HomeAccountPicker'), selector);
      assert.equal(selector.props.unavailable, false);
      assert.ok(renderer.root.findAllByType('Skeleton').length > 0);
      await act(async () => reads[0].resolve(fixtures.home));
      assertSameSelector();
      await act(async () => selector.props.onSelect(2));
      assertSameSelector();
      await act(async () => reads[1].reject(Error('unavailable')));
      assert.ok(texts().includes('Couldn’t load account activity'));
      assertSameSelector();
      assert.equal(selector.props.selectedId, 2);
      await act(async () => financialRetry().props.onPress());
      assertSameSelector();
      await act(async () => reads[2].resolve(fixtures.home));
      assertSameSelector();
      assert.ok(texts().includes('Lunch'));
    },
  );
  await t.test('Home cold failure offers retry instead of empty state or skeletons', async () => {
    const Screen = HomeScreen;
    state.read = async () => {
      throw new Error('unavailable');
    };
    await act(async () => {
      resetQueryClient();
      renderer = create(React.createElement(QueryScreen, { Screen }));
    });
    assert.ok(texts().includes('Couldn’t load account activity'));
    assert.equal(renderer.root.findAllByType('Skeleton').length, 0);
    assert.ok(!texts().some((s) => s.includes('No transactions')));
    state.read = async (key) => fixtures[key];
    const retry = renderer.root
      .findAllByType('Pressable')
      .find((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
    await act(async () => retry.props.onPress());
    assert.ok(texts().includes('Lunch'));
  });
  await t.test(
    'Home retains an empty result while switching, then replaces it on error',
    async () => {
      const Screen = HomeScreen;
      state.read = async (key) => (key === 'home' ? { ...fixtures.home, rows: [] } : fixtures[key]);
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      const empty = 'No transactions in this account. Add one or choose another account.';
      assert.ok(texts().includes(empty));
      let reject;
      state.read = (key) =>
        key === 'home'
          ? new Promise((_, fail) => {
              reject = fail;
            })
          : Promise.resolve(fixtures[key]);
      await act(async () => renderer.root.findByType('HomeAccountPicker').props.onSelect(null));
      assert.ok(
        texts().includes(empty),
        'retained Account empty state must not become All accounts',
      );
      await act(async () => reject(Error('unavailable')));
      assert.ok(!texts().includes(empty), 'error replaces previous content');
      assert.ok(texts().includes('Couldn’t load account activity'));
    },
  );
  await t.test(
    'Home Account lookup failure stops loading and recovers through cold retry',
    async () => {
      state.accountsError = true;
      const Screen = HomeScreen;
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      assert.equal(picker().props.unavailable, true);
      assert.equal(picker().props.loading, false);
      assert.ok(texts().includes('Couldn’t load Home'));
      state.read = async (key) => fixtures[key];
      const retry = renderer.root
        .findAllByType('Pressable')
        .find((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
      await act(async () => retry.props.onPress());
      assert.ok(texts().includes('Couldn’t load Home'), 'a failed retry stays recoverable');
      assert.equal(picker().props.loading, false);
      assert.equal(renderer.root.findAllByType('Skeleton').length, 0);
      delete state.accountsError;
      const retryAgain = renderer.root
        .findAllByType('Pressable')
        .find((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
      await act(async () => retryAgain.props.onPress());
      assert.equal(picker().props.unavailable, false);
      assert.ok(texts().includes('Lunch'));
    },
  );
  await t.test('Accounts and financial errors have independent retries', async () => {
    state.read = async (key) => fixtures[key];
    await act(async () => {
      resetQueryClient();
      renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
    });
    const picker = () => renderer.root.findByType('HomeAccountPicker');
    let financialReads = 0;
    state.read = async (key, id) => {
      if (key === 'home' && id === 2) {
        financialReads++;
        throw Error('Bank unavailable');
      }
      return fixtures[key];
    };
    await act(async () => picker().props.onSelect(2));
    assert.equal(picker().props.error, false);
    assert.ok(texts().includes('Couldn’t load account activity'));
    assert.ok(!texts().includes('Lunch'));
    state.accountsError = true;
    await act(async () => notifyDataChanged());
    assert.equal(picker().props.error, true);
    const readsBeforeAccountsRetry = financialReads;
    delete state.accountsError;
    await act(async () => picker().props.onRetry());
    assert.equal(
      financialReads,
      readsBeforeAccountsRetry,
      'Accounts retry does not retry financial data',
    );
    assert.equal(picker().props.error, false);
    assert.ok(texts().includes('Couldn’t load account activity'));
    state.accountsError = true;
    state.read = async (key) => (key === 'home' ? { ...fixtures.home, rows: [] } : fixtures[key]);
    await act(async () => financialRetry().props.onPress());
    assert.equal(picker().props.selectedId, 2);
    assert.ok(!texts().includes('Couldn’t load account activity'));
    assert.equal(renderer.root.findByType('FlatList').props.data.length, 0);
  });
  await t.test('a financial error can be escaped by choosing another Account', async () => {
    let failedReads = 0;
    state.read = async (key, id) => {
      if (key === 'home' && id === 1) {
        failedReads++;
        throw Error('unavailable');
      }
      return fixtures[key];
    };
    await act(async () => {
      resetQueryClient();
      renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
    });
    assert.ok(texts().includes('Couldn’t load account activity'));
    await act(async () => renderer.root.findByType('HomeAccountPicker').props.onSelect(2));
    assert.ok(texts().includes('Lunch'));
    assert.equal(renderer.root.findByType('HomeAccountPicker').props.selectedId, 2);
    assert.equal(failedReads, 1, 'switching does not remount the failed scope');
  });
  await t.test(
    'a failed background financial refresh shows its own error and retries cached data',
    async () => {
      state.read = async (key) => fixtures[key];
      await act(async () => {
        resetQueryClient();
        queryClient.setDefaultOptions({
          queries: { ...queryClient.getDefaultOptions().queries, staleTime: Infinity },
        });
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      state.read = async () => {
        throw Error('unavailable');
      };
      await act(async () => queryClient.refetchQueries({ queryKey: ['home', 'snapshot'] }));
      assert.ok(texts().includes('Couldn’t load account activity'));
      assert.ok(!texts().includes('Lunch'));
      assert.equal(renderer.root.findByType('HomeAccountPicker').props.error, false);
      const pending = [];
      state.read = (key) => new Promise((resolve) => pending.push(() => resolve(fixtures[key])));
      await act(async () => financialRetry().props.onPress());
      assert.ok(!texts().includes('Lunch'), 'retry does not flash the failed cached snapshot');
      assert.ok(renderer.root.findAllByType('Skeleton').length > 0);
      await act(async () => pending.forEach((resolve) => resolve()));
      assert.ok(texts().includes('Lunch'));
    },
  );
  await t.test(
    'a new local date clears a financial error without rereading the failed date',
    async () => {
      let now = new Date(2026, 10, 6, 23, 59);
      const Screen = () =>
        React.createElement(QueryTimeContext, { value: now }, React.createElement(HomeScreen));
      const balanceDates = [];
      state.read = async (key, day) => {
        if (key === 'balances') balanceDates.push(day);
        if (key === 'home') throw Error('unavailable');
        return fixtures[key];
      };
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      assert.ok(texts().includes('Couldn’t load account activity'));
      now = new Date(2026, 10, 7, 0, 1);
      state.read = async (key, day) => {
        if (key === 'balances') balanceDates.push(day);
        return fixtures[key];
      };
      await act(async () => renderer.update(React.createElement(QueryScreen, { Screen })));
      assert.ok(texts().includes('Lunch'));
      assert.equal(balanceDates.length, 2);
      assert.equal(balanceDates[1], balanceDates[0] + 1);
    },
  );
  await t.test(
    'Accounts retry shows its loading fallback while the new read is pending',
    async () => {
      state.accountsError = true;
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      let finishAccounts;
      state.accountsRead = () =>
        new Promise((resolve) => {
          finishAccounts = resolve;
        });
      state.read = async (key) => fixtures[key];
      const retry = renderer.root
        .findAllByType('Pressable')
        .find((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
      await act(async () => retry.props.onPress());
      assert.equal(renderer.root.findByType('HomeAccountPicker').props.loading, true);
      assert.ok(renderer.root.findAllByType('Skeleton').length > 0);
      assert.ok(!texts().includes('Couldn’t load Home'));
      await act(async () => finishAccounts([]));
      assert.equal(renderer.root.findByType('HomeAccountPicker').props.selectedId, null);
    },
  );
  await t.test('Home reads SQLite offline and waits for the whole financial snapshot', async () => {
    const wasOnline = onlineManager.isOnline();
    onlineManager.setOnline(false);
    try {
      let finishBalances;
      state.read = (key) =>
        key === 'balances'
          ? new Promise((resolve) => {
              finishBalances = resolve;
            })
          : Promise.resolve(fixtures[key]);
      const Screen = HomeScreen;
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      assert.ok(finishBalances, 'local reads must run even when offline');
      assert.ok(renderer.root.findAllByType('Skeleton').length > 0);
      assert.ok(!texts().includes('Lunch'), 'activity must wait for balances');
      await act(async () => finishBalances(fixtures.balances));
      assert.ok(texts().includes('Lunch'));
    } finally {
      onlineManager.setOnline(wasOnline);
    }
  });
  await t.test(
    'Home retains its initial Account when favorite changes on another screen',
    async () => {
      state.accountItems = [
        { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 },
        { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 0 },
      ];
      state.read = async (key) => fixtures[key];
      const Screen = HomeScreen;
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      state.accountItems = state.accountItems.map((a) => ({
        ...a,
        isFavorite: a.id === 2 ? 1 : 0,
      }));
      await act(async () => notifyDataChanged());
      assert.equal(renderer.root.findByType('HomeAccountPicker').props.selectedId, 1);
      assert.equal(
        renderer.root.findByType('HomeAccountPicker').props.accounts.find((a) => a.id === 2)
          .isFavorite,
        1,
        'Accounts refreshed without changing the scope',
      );
    },
  );
  await t.test(
    'Home cache isolates Accounts and local dates and reuses the same fresh snapshot',
    async () => {
      resetQueryClient();
      const { homeSnapshotQuery } = await import('./queries.ts');
      const calls = [];
      state.read = async (key, scope) => {
        calls.push([key, scope]);
        return fixtures[key];
      };
      const firstDay = new Date(2026, 10, 6, 23, 59);
      const sameDay = new Date(2026, 10, 6, 9);
      const nextDay = new Date(2026, 10, 7, 0, 1);
      await queryClient.fetchQuery({ ...homeSnapshotQuery(1, firstDay), staleTime: Infinity });
      await queryClient.fetchQuery({ ...homeSnapshotQuery(1, sameDay), staleTime: Infinity });
      assert.equal(calls.filter(([key]) => key === 'home').length, 1);
      await queryClient.fetchQuery({ ...homeSnapshotQuery(2, firstDay), staleTime: Infinity });
      await queryClient.fetchQuery({ ...homeSnapshotQuery(2, nextDay), staleTime: Infinity });
      assert.deepEqual(
        calls.filter(([key]) => key === 'home').map(([, id]) => id),
        [1, 2, 2],
      );
      const cutoffs = calls.filter(([key]) => key === 'balances').map(([, day]) => day);
      assert.equal(cutoffs[2], cutoffs[0] + 1, 'next local date changes the balance cutoff');
      assert.equal(
        queryClient.getQueryCache().getAll().length,
        3,
        'three independent snapshots are cached',
      );
    },
  );
  await t.test(
    'Home keeps its initial Account after backgrounding despite a changed favorite',
    async () => {
      state.accountItems = [
        { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 1 },
        { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 0 },
      ];
      state.read = async (key) => fixtures[key];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      assert.equal(picker().props.selectedId, 1);
      state.accountItems = state.accountItems.map((a) => ({
        ...a,
        isFavorite: a.id === 2 ? 1 : 0,
      }));
      await act(async () => {
        state.lifecycle('background');
        state.lifecycle('active');
      });
      assert.equal(picker().props.selectedId, 1);
    },
  );
  await t.test(
    'Home keeps its Account when foreground Accounts refresh fails and is retried',
    async () => {
      state.accountItems = [
        { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 1 },
        { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 0 },
      ];
      state.read = async (key) => fixtures[key];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      state.accountItems = state.accountItems.map((a) => ({
        ...a,
        isFavorite: a.id === 2 ? 1 : 0,
      }));
      state.accountsError = true;
      await queryClient.invalidateQueries({ queryKey: ['home'], refetchType: 'none' });
      await act(async () => {
        state.lifecycle('background');
        state.lifecycle('active');
      });
      assert.equal(picker().props.error, true);
      delete state.accountsError;
      await act(async () => picker().props.onRetry());
      assert.equal(picker().props.selectedId, 1);
    },
  );
  await t.test(
    'Home allows explicit selection while a foreground Accounts refresh fails',
    async () => {
      state.accountItems = [
        { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 1 },
        { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 0 },
      ];
      state.read = async (key) => fixtures[key];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen: HomeScreen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      state.accountItems = state.accountItems.map((a) => ({
        ...a,
        isFavorite: a.id === 2 ? 1 : 0,
      }));
      state.accountsError = true;
      await queryClient.invalidateQueries({ queryKey: ['home'], refetchType: 'none' });
      await act(async () => {
        state.lifecycle('background');
        state.lifecycle('active');
      });
      await act(async () => picker().props.onSelect(null));
      delete state.accountsError;
      await act(async () => picker().props.onRetry());
      assert.equal(picker().props.selectedId, null);
    },
  );
  await t.test('committed writes refresh retained Home content without navigation', async () => {
    const Screen = HomeScreen;
    const initial = [];
    state.read = (key) => new Promise((resolve) => initial.push(() => resolve(fixtures[key])));
    await act(async () => {
      resetQueryClient();
      renderer = create(React.createElement(QueryScreen, { Screen }));
    });
    assert.ok(renderer.root.findAllByType('Skeleton').length > 0, 'Home uses first-load skeletons');
    await act(async () => initial.forEach((resolve) => resolve()));
    const before = texts();
    const pending = [];
    const updated = {
      ...fixtures,
      home: { ...fixtures.home, rows: [] },
      balances: [],
    };
    state.read = (key) => new Promise((resolve) => pending.push(() => resolve(updated[key])));
    await act(async () => notifyDataChanged());
    assert.ok(pending.length > 0, 'committed writes refresh Home');
    assert.deepEqual(texts(), before, 'loaded content must not disappear during a refresh');
    assert.equal(renderer.root.findByType('HomeAccountPicker').props.loading, false);
    assert.ok(
      renderer.root
        .findAllByType('Pressable')
        .filter((n) => n.props.accessibilityLabel?.startsWith('Lunch'))
        .every((n) => n.props.disabled === false),
      'same-Account Transactions remain active',
    );
    assert.equal(
      renderer.root.findAllByType('ActivityIndicator').length,
      0,
      'refresh must not insert a spinner that shifts content',
    );
    await act(async () => pending.forEach((resolve) => resolve()));
    assert.notDeepEqual(
      texts(),
      before,
      'fresh results, including empty results, replace the previous content',
    );
    const empty = texts();
    pending.length = 0;
    await act(async () => notifyDataChanged());
    assert.deepEqual(texts(), empty, 'an already empty screen stays stable during refresh too');
    assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 0);
    await act(async () => pending.forEach((resolve) => resolve()));
  });
});
