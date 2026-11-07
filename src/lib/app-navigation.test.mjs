import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { QueryClientProvider, focusManager, notifyManager } from '@tanstack/react-query';

notifyManager.setScheduler(queueMicrotask);
const state = { calls: [] };
globalThis.__navTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'expo-haptics': `export const AndroidHaptics={Keyboard_Tap:'keyboard'},ImpactFeedbackStyle={Light:'light'}; export const performAndroidHapticsAsync=async()=>{},impactAsync=async()=>{};`,
  'react-native-reanimated': `import {useRef} from 'react'; export default {View:'AnimatedView'}; export const Easing={out:x=>x,cubic:x=>x},ReduceMotion={System:'system'}; export const useSharedValue=value=>useRef({value}).current,useAnimatedStyle=fn=>fn(),withTiming=value=>value;`,
  '@/components/loading': `export const Skeleton='Skeleton',Shimmer='Shimmer';`,
  './account-picker.tsx': `export const HomeAccountPicker='HomeAccountPicker',HomeAccountPickerSkeleton='HomeAccountPickerSkeleton';`,
  '@/components/running-release': `export const RunningRelease='RunningRelease';`,
  '@/lib/backup': `export const exportBackup=async()=>globalThis.__navTest.backup?.()??'content://backup'; export const restoreBackup=async()=>false;`,
  '@/lib/backup-adapter': `export const backupStore={},backupDocuments={};`,
  '@/lib/export-csv': `export const exportTransactionsCsv=async()=>null;`,
  '@/lib/import-csv': `export const importMoneyLoverFile=async()=>null;`,
  '@/components/app-updates': `export const UpdatesRow='UpdatesRow';`,
  'react-native': `import React from 'react'; export const BackHandler={addEventListener:()=>({remove(){}})}; export const Keyboard={dismiss() {}}; export const KeyboardAvoidingView='KeyboardAvoidingView',View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator'; export const FlatList=p=>React.createElement('FlatList',null,p.ListHeaderComponent,p.ListFooterComponent); export const Alert={alert(){}}; export const AppState={currentState:'active',addEventListener:(_,fn)=>{globalThis.__navTest.lifecycle=fn;return {remove(){}}}};`,
  'expo-router': `import {useEffect} from 'react'; const s=globalThis.__navTest; export const useFocusEffect=fn=>useEffect(fn,[fn]); export const useLocalSearchParams=()=>({}); export const router={push:h=>s.calls.push(['push',h]),replace:h=>s.calls.push(['replace',h]),back:()=>s.calls.push(['back'])}; export const Link=({children})=>children; export const Stack={Screen:p=>{s.header={...s.header,...p.options};return null}};`,
  'expo-router/react-navigation': `export const useHeaderHeight=()=>88; export const useNavigation=()=>({dispatch(){}}); export const usePreventRemove=()=>{};`,
  'expo-status-bar': `export const StatusBar=()=>null;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@/components/form-controls': `export const FormButton='FormButton',FormInput='FormInput',JoinedChoice='JoinedChoice';`,
  '@/components/quick-add-date': `export const QuickAddDate='Date';`,
  '@/components/quick-add-category': `export const QuickAddCategory='Category',CategorySearchInput='CategorySearchInput';`,
  './read-home.ts': `export const homeData=async(_,id)=>{globalThis.__navTest.accountQueries.push(id);return {rows:[],summaries:[]}};`,
  '@/lib/database': `export const epochDay=d=>Math.floor(d.getTime()/86400000); export const listAccounts=async()=>{if(globalThis.__navTest.accountsError)throw Error('Accounts unavailable');return globalThis.__navTest.accounts??[];}; export const listCategories=async()=>[]; export const setFavoriteAccount=async()=>{};`,
  '@/lib/reports': `export const accountBalances=async()=>[];`,
  '@/lib/categories': `export const listManagedCategories=async()=>[];`,
  '@/lib/transfers': `export const addTransfer=async()=>{}; export const transferAmountMinor=()=>{throw Error('Invalid amount')};`,
  '@/lib/lending': `export const listPeople=async()=>[]; export const listLendingTotals=async()=>[]; export const createPerson=async()=>{}; export const saveLendingEntry=async()=>{};`,
  '@/lib/quick-add-tags': `export const addQuickTransaction=async()=>{};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `nav-mock:${specifier}`, shortCircuit: true };
    if (specifier === '@/components/settings-data-actions')
      return {
        url: new URL('src/components/settings-data-actions.tsx', root).href,
        shortCircuit: true,
      };
    if (specifier === '@/components/amount-calculator')
      return {
        url: new URL('src/components/amount-calculator.tsx', root).href,
        shortCircuit: true,
      };
    if (specifier === '@/components/entry-choices')
      return { url: new URL('src/components/entry-choices.tsx', root).href, shortCircuit: true };
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
      context.parentURL?.startsWith('nav-mock:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('nav-mock:'))
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
const { appTabs } = await import('./app-navigation.ts');
const { default: Home } = await import('../app/(tabs)/(home)/index.tsx');
const { default: Settings } = await import('../app/settings.tsx');
const { default: QuickAdd } = await import('../app/quick-add.tsx');
const { createQueryClient } = await import('./query-client.ts');
const { AppQueryLifecycle } = await import('../components/app-queries.tsx');
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
const mount = async (Screen) => {
  state.calls = [];
  state.accountQueries = [];
  state.header = undefined;
  await act(async () => {
    resetQueryClient();
    renderer = create(React.createElement(QueryScreen, { Screen }));
  });
};
const texts = (node = renderer.root) => node.findAllByType('Text').map((n) => n.children.join(''));
const pressable = (label, node = renderer.root) =>
  node
    .findAllByType('Pressable')
    .find((n) => n.props.accessibilityLabel === label || texts(n).includes(label));
const press = (label, node) =>
  act(async () => {
    pressable(label, node).props.onPress();
  });
const headerPart = async (key) => {
  let part;
  await act(async () => {
    part = create(state.header[key]());
  });
  return part.root;
};

test('app navigation', async (t) => {
  t.afterEach(async () => {
    await act(async () => renderer?.unmount());
    queryClient?.clear();
    delete state.accounts;
    delete state.accountsError;
  });
  t.after(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    hooks.deregister();
    delete globalThis.__navTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await t.test('tabs are Home, Reports, Accounts and Categories with distinct icons', () => {
    assert.deepEqual(
      appTabs.map((tab) => tab.label),
      ['Home', 'Reports', 'Accounts', 'Categories'],
    );
    assert.equal(new Set(appTabs.map((tab) => tab.md)).size, 4);
    assert.equal(new Set(appTabs.map((tab) => tab.sf)).size, 4);
  });
  await t.test('Home header opens Settings and the add button opens Quick add', async () => {
    await mount(Home);
    const settings = pressable('Settings', await headerPart('headerRight'));
    assert.equal(settings.props.accessibilityRole, 'button');
    assert.ok(settings.props.style.minWidth >= 48 && settings.props.style.minHeight >= 48);
    await act(async () => settings.props.onPress());
    await press('Add transaction');
    assert.deepEqual(state.calls, [
      ['push', '/settings'],
      ['push', { pathname: '/quick-add', params: {} }],
    ]);
  });
  await t.test('Home keeps Search all and drops the More list', async () => {
    await mount(Home);
    const shown = texts();
    assert.ok(shown.includes('Search all'));
    for (const old of [
      'More',
      'Transfer between accounts',
      'Manage categories',
      'Manage accounts',
      'Reports',
      'Review transfer candidates',
      'Import, export and backup',
    ])
      assert.ok(!shown.includes(old), old);
  });
  await t.test(
    'Home starts at favorite, scopes Add and keeps All accounts after backgrounding',
    async () => {
      state.accounts = [
        { id: 1, name: 'Cash', currencyCode: 'BDT', isFavorite: 0 },
        { id: 2, name: 'Bank', currencyCode: 'BDT', isFavorite: 1 },
      ];
      await mount(Home);
      const picker = () => renderer.root.findByType('HomeAccountPicker');
      assert.equal(picker().props.selectedId, 2);
      assert.equal(state.accountQueries.at(-1), 2);
      await act(async () => picker().props.onSelect(1));
      await press('Add transaction');
      assert.deepEqual(state.calls.at(-1), [
        'push',
        { pathname: '/quick-add', params: { accountId: '1' } },
      ]);
      assert.ok(texts().includes('Search account'));
      await act(async () => picker().props.onSelect(null));
      assert.equal(picker().props.selectedId, null);
      assert.equal(state.accountQueries.at(-1), null);
      await act(async () => {
        state.lifecycle('inactive');
        state.lifecycle('active');
      });
      assert.equal(picker().props.selectedId, null);
      await act(async () => {
        state.lifecycle('background');
        state.lifecycle('active');
      });
      assert.equal(picker().props.selectedId, null);
    },
  );
  await t.test(
    'disposing the app lifecycle bridge releases its global focus override',
    async () => {
      const initialFocus = focusManager.isFocused();
      await mount(Home);
      await act(async () => state.lifecycle('background'));
      assert.equal(focusManager.isFocused(), false);
      await act(async () => renderer.unmount());
      renderer = undefined;
      assert.equal(focusManager.isFocused(), initialFocus);
    },
  );
  await t.test('Settings offers data actions directly and opens the Review Queue', async () => {
    await mount(Settings);
    assert.equal(renderer.root.findAllByType('RunningRelease').length, 1);
    for (const label of [
      'Create backup',
      'Restore from file',
      'Export transactions CSV',
      'Import from MoneyLover',
    ])
      assert.ok(pressable(label));
    assert.ok(!texts().includes('Import, export and backup'));
    await press('Create backup');
    assert.ok(texts().includes('Backup saved.'));
    await press('Review transfer candidates');
    assert.deepEqual(state.calls, [['push', '/review-queue']]);
  });
  await t.test(
    'Settings blocks other controls during data operations and restores them after completion',
    async () => {
      let finish;
      state.backup = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      try {
        await mount(Settings);
        await press('Create backup');
        assert.equal(pressable('Lending & borrowing').props.disabled, true);
        assert.equal(pressable('Review transfer candidates').props.disabled, true);
        const blocked = renderer.root
          .findAllByType('View')
          .find((n) => n.props.pointerEvents === 'none');
        assert.equal(blocked.props.importantForAccessibility, 'no-hide-descendants');
        await act(async () => finish('content://backup'));
        assert.equal(pressable('Lending & borrowing').props.disabled, false);
      } finally {
        delete state.backup;
      }
    },
  );
  await t.test(
    'Quick add choices refresh after a committed SQLite change without resetting selection',
    async () => {
      state.accounts = [{ id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 }];
      await mount(QuickAdd);
      const choices = () => renderer.root.findAll((n) => n.type?.name === 'AccountChoices')[0];
      await act(async () => choices().props.onSelect(1));
      assert.equal(choices().props.selectedId, 1);
      state.accounts = [
        { id: 1, name: 'Renamed', currencyCode: 'USD' },
        { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 1 },
      ];
      const { notifyDataChanged } = await import('./data-changes.ts');
      await act(async () => notifyDataChanged());
      assert.deepEqual(
        choices().props.accounts.map((account) => account.name),
        ['Renamed', 'Bank'],
      );
      assert.equal(choices().props.selectedId, 1);
    },
  );
  await t.test(
    'Quick add centers its title and offers Cancel with transfer in the mode selector',
    async () => {
      await mount(QuickAdd);
      await press('Cancel', await headerPart('headerLeft'));
      assert.equal(state.header.headerTitleAlign, 'center');
      assert.equal(state.header.headerRight, undefined);
      assert.ok(
        renderer.root
          .findAllByType('JoinedChoice')[0]
          .props.options.some((option) => option.value === 'TRANSFER'),
      );
      assert.deepEqual(state.calls, [['back']]);
    },
  );
});
