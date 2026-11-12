import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

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
  '@/components/app-sheet': `export const AppSheet=({children})=>children;`,
  '@/components/category-browser': `import React from 'react'; export const CategoryBrowser=p=>React.createElement('CategoryBrowser',p);`,
  '@/lib/accounts': `export const listManagedAccounts=()=>globalThis.__tabRefreshTest.read('accounts'); export const createAccount=async()=>{}; export const setFavoriteAccount=async()=>{};`,
  '@/lib/reports': `export const monthlyReport=()=>globalThis.__tabRefreshTest.read('reports'); export const accountBalances=today=>globalThis.__tabRefreshTest.read('balances',today);`,
  '@/lib/categories': `export const listManagedCategories=()=>globalThis.__tabRefreshTest.read('categories'); export const createCategory=async()=>{}; export const updateCategory=async()=>{};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/components/form-controls')
      return { url: new URL('src/components/form-controls.tsx', root).href, shortCircuit: true };
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
  accounts: [{ id: 1, name: 'Cash', currencyCode: 'USD', openingBalanceMinor: 0, isFavorite: 1 }],
  balances: [{ id: 1, name: 'Cash', currencyCode: 'USD', balanceMinor: 1500 }],
  reports: {
    summaries: [{ currencyCode: 'USD', incomeMinor: 1000, expenseMinor: 500 }],
    spending: [],
  },
  categories: [{ id: 1, name: 'Lunch', type: 'EXPENSE', parentId: null }],
};
const screens = await Promise.all(
  ['accounts', 'reports', 'categories'].map(async (name) => [
    name,
    (await import(`../app/(tabs)/${name}/index.tsx`)).default,
  ]),
);
let renderer;
const texts = () => renderer.root.findAllByType('Text').map((n) => n.children.join(''));
const snapshot = (name) =>
  name === 'categories' ? renderer.root.findByType('CategoryBrowser').props.items : texts();
const toggleFocus = async (Screen) => {
  await act(async () => {
    state.focus++;
    renderer.update(React.createElement(Screen));
  });
};
test('tab refresh keeps loaded content stable', async (t) => {
  t.afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
  });
  t.after(() => {
    hooks.deregister();
    delete globalThis.__tabRefreshTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  for (const [name, Screen] of screens)
    await t.test(name, async () => {
      state.focus = 0;
      const initial = [];
      state.read = (key) => new Promise((resolve) => initial.push(() => resolve(fixtures[key])));
      await act(async () => {
        renderer = create(React.createElement(Screen));
      });
      assert.equal(
        renderer.root.findAllByType('ActivityIndicator').length,
        1,
        'first load shows progress',
      );
      await act(async () => initial.forEach((resolve) => resolve()));
      const before = snapshot(name);
      await toggleFocus(Screen);
      const pending = [];
      const updated = {
        ...fixtures,
        accounts: [],
        balances: [],
        reports: { summaries: [], spending: [] },
        categories: [],
      };
      state.read = (key) => new Promise((resolve) => pending.push(() => resolve(updated[key])));
      await toggleFocus(Screen);
      assert.ok(pending.length > 0, 'returning to the tab refreshes its data');
      assert.deepEqual(
        snapshot(name),
        before,
        'loaded content must not disappear during a focus refresh',
      );
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
      assert.deepEqual(
        snapshot(name),
        empty,
        'an already empty screen stays stable during refresh too',
      );
      assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 0);
      await act(async () => pending.forEach((resolve) => resolve()));
    });
});
