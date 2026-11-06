import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { QueryClientProvider, notifyManager, onlineManager } from '@tanstack/react-query';

notifyManager.setScheduler(queueMicrotask);
const state = { focus: 0, read: undefined };
globalThis.__tabRefreshTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `import React from 'react'; export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator',KeyboardAvoidingView='KeyboardAvoidingView'; export const FlatList=p=>React.createElement('FlatList',p,p.ListHeaderComponent,p.data.map((item,index)=>React.createElement(React.Fragment,{key:item.id},p.renderItem({item,index})))); export const AppState={currentState:'active',addEventListener:(_,fn)=>{globalThis.__tabRefreshTest.lifecycle=fn;return {remove(){}}}}; export const Platform={OS:'android'}; export const useWindowDimensions=()=>({width:400,height:800});`,
  'expo-router': `import React from 'react'; export const Stack={Screen:()=>null}; export const Link=({children})=>children; export const router={push(){}}; export function useFocusEffect(callback){React.useEffect(()=>{if(globalThis.__tabRefreshTest.focus%2===0)return callback()},[callback,globalThis.__tabRefreshTest.focus]);}`,
  'expo-status-bar': `export const StatusBar=()=>null;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@/components/loading': `export const Skeleton='Skeleton'; export const Shimmer='Shimmer';`,
  '@/components/home-account-picker': `export const HomeAccountPicker='HomeAccountPicker';`,
  '@/lib/database': `export const epochDay=d=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000); export const listAccounts=async()=>{if(globalThis.__tabRefreshTest.accountsError)throw Error('accounts unavailable');return globalThis.__tabRefreshTest.accountItems??[{id:1,name:'Cash',currencyCode:'USD',isFavorite:1},{id:2,name:'Bank',currencyCode:'USD',isFavorite:0},{id:3,name:'Savings',currencyCode:'USD',isFavorite:0},{id:4,name:'Card',currencyCode:'USD',isFavorite:0}];};`,
  '@/components/app-sheet': `export const AppSheet=({children})=>children;`,
  '@/components/category-browser': `import React from 'react'; export const CategoryBrowser=p=>React.createElement('CategoryBrowser',p);`,
  '@/lib/accounts': `export const listManagedAccounts=()=>globalThis.__tabRefreshTest.read('accounts'); export const createAccount=async()=>{}; export const setFavoriteAccount=async()=>{};`,
  '@/lib/reports': `export const monthlyReport=()=>globalThis.__tabRefreshTest.read('reports'); export const accountBalances=today=>globalThis.__tabRefreshTest.read('balances',today);`,
  '@/lib/home-data': `export const homeData=(_,id)=>globalThis.__tabRefreshTest.read('home',id);`,
  '@/lib/categories': `export const listManagedCategories=()=>globalThis.__tabRefreshTest.read('categories'); export const createCategory=async()=>{}; export const renameCategory=async()=>{};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/components/form-controls')
      return { url: new URL('src/components/form-controls.tsx', root).href, shortCircuit: true };
    if (specifier in mocks) return { url: `tab-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const stem = specifier.replace('@/', 'src/');
      const path = existsSync(new URL(`${stem}.ts`, root)) ? `${stem}.ts` : `${stem}.tsx`;
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
  accounts: [{ id: 1, name: 'Cash', currencyCode: 'USD', openingBalanceMinor: 0, isFavorite: 1 }],
  balances: [{ id: 1, name: 'Cash', currencyCode: 'USD', balanceMinor: 1500 }],
  reports: {
    summaries: [{ currencyCode: 'USD', incomeMinor: 1000, expenseMinor: 500 }],
    spending: [],
  },
  categories: [{ id: 1, name: 'Lunch', type: 'EXPENSE', parentId: null }],
};
const screens = await Promise.all(
  ['(home)', 'accounts', 'reports', 'categories'].map(async (name) => [
    name,
    (await import(`../app/(tabs)/${name}/index.tsx`)).default,
  ]),
);
const { createQueryClient } = await import('./query-client.ts');
const { AppQueryLifecycle } = await import('../components/app-queries.tsx');
const { notifyDataChanged } = await import('./data-changes.ts');
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
const snapshot = (name) =>
  name === 'categories' ? renderer.root.findByType('CategoryBrowser').props.items : texts();
const toggleFocus = async (Screen) => {
  await act(async () => {
    state.focus++;
    renderer.update(React.createElement(QueryScreen, { Screen }));
  });
};
test('tab refresh keeps loaded content stable', async (t) => {
  t.afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    queryClient?.clear();
    delete state.accountsError;
    delete state.accountItems;
  });
  t.after(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    hooks.deregister();
    delete globalThis.__tabRefreshTest;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await t.test(
    'Home Account transitions retain the correct receipt meaning and recover without stale writes',
    async () => {
      state.focus = 0;
      const Screen = screens[0][1];
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
      assert.equal(picker().props.loading, true);
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
      assert.equal(picker().props.error, true);
      assert.equal(picker().props.loading, false);
      assert.equal(picker().props.selectedId, 2);
      assert.equal(entry().props.disabled, true);
      await act(async () => picker().props.onRetry());
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
  await t.test('Home cold failure offers retry instead of empty state or skeletons', async () => {
    state.focus = 0;
    const Screen = screens[0][1];
    state.read = async () => {
      throw new Error('unavailable');
    };
    await act(async () => {
      resetQueryClient();
      renderer = create(React.createElement(QueryScreen, { Screen }));
    });
    assert.ok(texts().includes('Couldn’t load Home'));
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
    'Home preserves an empty result under its displayed scope even when switching fails',
    async () => {
      state.focus = 0;
      const Screen = screens[0][1];
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
      assert.ok(texts().includes(empty), 'failed replacement keeps the previous empty result');
    },
  );
  await t.test(
    'Home Account lookup failure stops loading and recovers through cold retry',
    async () => {
      state.focus = 0;
      state.accountsError = true;
      const Screen = screens[0][1];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      assert.equal(picker().props.unavailable, true);
      assert.equal(picker().props.loading, false);
      assert.ok(texts().includes('Couldn’t load Home'));
      delete state.accountsError;
      state.read = async (key) => fixtures[key];
      const retry = renderer.root
        .findAllByType('Pressable')
        .find((n) => n.findAllByType('Text').some((t) => t.children.join('') === 'Retry'));
      await act(async () => retry.props.onPress());
      assert.equal(picker().props.unavailable, false);
      assert.ok(texts().includes('Lunch'));
    },
  );
  await t.test('Home reads SQLite offline and waits for the whole financial snapshot', async () => {
    state.focus = 0;
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
      const Screen = screens[0][1];
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
      state.focus = 0;
      state.accountItems = [
        { id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 },
        { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 0 },
      ];
      state.read = async (key) => fixtures[key];
      const Screen = screens[0][1];
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      await toggleFocus(Screen);
      state.accountItems = state.accountItems.map((a) => ({
        ...a,
        isFavorite: a.id === 2 ? 1 : 0,
      }));
      await act(async () => notifyDataChanged());
      await toggleFocus(Screen);
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
      const { homeSnapshotQuery } = await import('./home-queries.ts');
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
  for (const [name, Screen] of screens)
    await t.test(name, async () => {
      state.focus = 0;
      const initial = [];
      state.read = (key) => new Promise((resolve) => initial.push(() => resolve(fixtures[key])));
      await act(async () => {
        resetQueryClient();
        renderer = create(React.createElement(QueryScreen, { Screen }));
      });
      if (name === '(home)')
        assert.ok(
          renderer.root.findAllByType('Skeleton').length > 0,
          'Home uses first-load skeletons',
        );
      else
        assert.equal(
          renderer.root.findAllByType('ActivityIndicator').length,
          1,
          'first load still shows progress',
        );
      await act(async () => initial.forEach((resolve) => resolve()));
      const before = snapshot(name);
      await toggleFocus(Screen);
      const pending = [];
      const updated = {
        ...fixtures,
        home: { ...fixtures.home, rows: [] },
        accounts: [],
        balances: [],
        reports: { summaries: [], spending: [] },
        categories: [],
      };
      state.read = (key) => new Promise((resolve) => pending.push(() => resolve(updated[key])));
      await toggleFocus(Screen);
      if (name === '(home)') await act(async () => notifyDataChanged());
      assert.ok(
        pending.length > 0,
        'successful writes refresh Home; tab focus refreshes unmigrated screens',
      );
      assert.deepEqual(
        snapshot(name),
        before,
        'loaded content must not disappear during a focus refresh',
      );
      if (name === '(home)') {
        assert.equal(renderer.root.findByType('HomeAccountPicker').props.loading, true);
        assert.ok(
          renderer.root
            .findAllByType('Pressable')
            .filter((n) => n.props.accessibilityLabel?.startsWith('Lunch'))
            .every((n) => n.props.disabled === false),
          'same-Account Transactions remain active',
        );
      }
      assert.equal(
        renderer.root.findAllByType('ActivityIndicator').length,
        0,
        'refresh must not insert a spinner that shifts content',
      );
      await act(async () => pending.forEach((resolve) => resolve()));
      assert.notDeepEqual(
        snapshot(name),
        before,
        'fresh results, including empty results, replace the previous content',
      );
      const empty = snapshot(name);
      await toggleFocus(Screen);
      pending.length = 0;
      await toggleFocus(Screen);
      if (name === '(home)') await act(async () => notifyDataChanged());
      assert.deepEqual(
        snapshot(name),
        empty,
        'an already empty screen stays stable during refresh too',
      );
      assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 0);
      await act(async () => pending.forEach((resolve) => resolve()));
    });
});
