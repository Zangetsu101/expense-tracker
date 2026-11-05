import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const state = { calls: [] };
globalThis.__navTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  '@/components/app-updates': `export const UpdatesRow='UpdatesRow';`,
  'react-native': `import React from 'react'; export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator'; export const FlatList=p=>React.createElement('FlatList',null,p.ListHeaderComponent,p.ListFooterComponent); export const Alert={alert(){}};`,
  'expo-router': `import {useEffect} from 'react'; const s=globalThis.__navTest; export const useFocusEffect=fn=>useEffect(fn,[fn]); export const router={push:h=>s.calls.push(['push',h]),replace:h=>s.calls.push(['replace',h]),back:()=>s.calls.push(['back'])}; export const Link=({children})=>children; export const Stack={Screen:p=>{s.header=p.options;return null}};`,
  'expo-status-bar': `export const StatusBar=()=>null;`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@/components/form-controls': `export const FormButton='FormButton',FormInput='FormInput',JoinedChoice='JoinedChoice';`,
  '@/components/quick-add-date': `export const QuickAddDate='Date';`,
  '@/components/quick-add-category': `export const QuickAddCategory='Category';`,
  '@/lib/home-data': `export const homeData=async()=>({rows:[],summaries:[]});`,
  '@/lib/database': `export const listAccounts=async()=>[]; export const listCategories=async()=>[]; export const setFavoriteAccount=async()=>{};`,
  '@/lib/categories': `export const listManagedCategories=async()=>[];`,
  '@/lib/quick-add-tags': `export const addQuickTransaction=async()=>{};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `nav-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`${specifier.replace('@/', 'src/')}.ts`, root).href, shortCircuit: true };
    return next(specifier, context.parentURL?.startsWith('nav-mock:') ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith('nav-mock:')) return { format: 'module', source: mocks[url.slice(9)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { appTabs } = await import('./app-navigation.ts');
const { default: Home } = await import('../app/(tabs)/(home)/index.tsx');
const { default: Settings } = await import('../app/settings.tsx');
const { default: QuickAdd } = await import('../app/quick-add.tsx');
let renderer;
const mount = async (Screen) => { state.calls = []; state.header = undefined; await act(async () => { renderer = create(React.createElement(Screen)); }); };
const texts = (node = renderer.root) => node.findAllByType('Text').map(n => n.children.join(''));
const pressable = (label, node = renderer.root) => node.findAllByType('Pressable').find(n => n.props.accessibilityLabel === label || texts(n).includes(label));
const press = (label, node) => act(async () => { pressable(label, node).props.onPress(); });
const headerPart = async (key) => { let part; await act(async () => { part = create(state.header[key]()); }); return part.root; };

test('app navigation', async t => {
  t.afterEach(async () => { await act(async () => renderer?.unmount()); });
  t.after(() => {
    hooks.deregister();
    delete globalThis.__navTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await t.test('tabs are Home, Reports, Accounts and Categories with distinct icons', () => {
    assert.deepEqual(appTabs.map(tab => tab.label), ['Home', 'Reports', 'Accounts', 'Categories']);
    assert.equal(new Set(appTabs.map(tab => tab.md)).size, 4);
    assert.equal(new Set(appTabs.map(tab => tab.sf)).size, 4);
  });
  await t.test('Home header opens Settings and the add button opens Quick add', async () => {
    await mount(Home);
    const settings = pressable('Settings', await headerPart('headerRight'));
    assert.equal(settings.props.accessibilityRole, 'button');
    assert.ok(settings.props.style.minWidth >= 48 && settings.props.style.minHeight >= 48);
    await act(async () => settings.props.onPress());
    await press('Add transaction');
    assert.deepEqual(state.calls, [['push', '/settings'], ['push', '/quick-add']]);
  });
  await t.test('Home keeps Search all and drops the More list', async () => {
    await mount(Home);
    const shown = texts();
    assert.ok(shown.includes('Search all'));
    for (const old of ['More', 'Transfer between accounts', 'Manage categories', 'Manage accounts', 'Reports', 'Review transfer candidates', 'Import, export and backup']) assert.ok(!shown.includes(old), old);
  });
  await t.test('Settings opens data tools and the Review Queue', async () => {
    await mount(Settings);
    await press('Import, export and backup');
    await press('Review transfer candidates');
    assert.deepEqual(state.calls, [['push', '/data-tools'], ['push', '/review-queue']]);
  });
  await t.test('Quick add header offers Cancel and Transfer', async () => {
    await mount(QuickAdd);
    await press('Cancel', await headerPart('headerLeft'));
    await press('Transfer', await headerPart('headerRight'));
    assert.deepEqual(state.calls, [['back'], ['replace', '/transfer']]);
  });
});
