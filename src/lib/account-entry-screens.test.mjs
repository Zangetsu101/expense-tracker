import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const state = {};
globalThis.__entryTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator',FlatList='FlatList'; export const useWindowDimensions=()=>({width:390,height:844}); export const Alert={alert:(...args)=>globalThis.__entryTest.alert=args};`,
  'expo-router': `import {useEffect} from 'react'; export const useFocusEffect=fn=>useEffect(fn,[fn]); export const router={back:()=>globalThis.__entryTest.back=true}; export const Stack={Screen:()=>null};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@expo/ui': `export const Host='Host',BottomSheet='BottomSheet',Column='Column',Text='NativeText',Button='NativeButton';`,
  '@/components/form-controls': `export const FormButton='FormButton',FormInput='FormInput',JoinedChoice='JoinedChoice';`,
  '@/components/app-sheet': `import React from 'react'; export function AppSheet(props){return React.createElement('Sheet',props,props.children);}`,
  '@/components/quick-add-date': `export const QuickAddDate='Date';`,
  '@/components/quick-add-category': `export const QuickAddCategory='Category';`,
  '@/lib/accounts': `export const listManagedAccounts=()=>globalThis.__entryTest.list(); export const createAccount=x=>globalThis.__entryTest.save(x); export const setFavoriteAccount=async()=>{};`,
  '@/lib/reports': `export const accountBalances=async()=>[{id:1,balanceMinor:100}];`,
  '@/lib/database': `export const listAccounts=async()=>[{id:1,name:'Cash',currencyCode:'USD',isFavorite:1},{id:2,name:'Bank',currencyCode:'USD'}]; export const listCategories=async()=>[{id:3,name:'Food'}]; export const setFavoriteAccount=async()=>{};`,
  '@/lib/categories': `export const listManagedCategories=async()=>[{id:3,name:'Food',type:'EXPENSE'}];`,
  '@/lib/quick-add-tags': `export const addQuickTransaction=(...args)=>globalThis.__entryTest.save(...args);`,
  '@/lib/transfers': `export const transferAmountMinor=x=>{const n=Number(x)*100;if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid amount');return n}; export const addTransfer=x=>globalThis.__entryTest.save(x);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `entry-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`${specifier.replace('@/', 'src/')}.ts`, root).href, shortCircuit: true };
    return next(specifier, context.parentURL?.startsWith('entry-mock:') ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith('entry-mock:')) return { format: 'module', source: mocks[url.slice(11)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { default: Accounts } = await import('../app/accounts.tsx');
const { default: QuickAdd } = await import('../app/quick-add.tsx');
const { default: Transfer } = await import('../app/transfer.tsx');
let renderer;
const nodes = type => renderer.root.findAllByType(type);
const button = label => nodes('FormButton').find(n => n.props.label === label);
async function press(label) { await act(async () => button(label).props.onPress()); }
async function change(label, value) { await act(async () => [...nodes('FormInput'), ...nodes('TextInput')].find(n => n.props.accessibilityLabel === label).props.onChangeText(value)); }
async function mount(Screen) {
  Object.assign(state, { list: async () => [], save: async () => {}, back: false });
  await act(async () => { renderer = create(React.createElement(Screen)); });
}
const text = () => nodes('Text').map(n => n.children.join('')).join('\n');
test('Account entry screens', async t => {
  t.afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; });
  t.after(() => { hooks.deregister(); delete globalThis.__entryTest; if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });
  await t.test('Accounts Cancel closes without writing; negative opening balance stays editable', async () => {
    await mount(Accounts); await press('Add account'); await change('Opening balance', '-20');
    assert.deepEqual(nodes('Sheet')[0].findByType('ScrollView').props.style, { width: 390, maxHeight: 844 * 0.82 });
    assert.equal(nodes('FormInput').find(n => n.props.accessibilityLabel === 'Opening balance').props.keyboardType, 'numbers-and-punctuation');
    state.save = () => assert.fail('Cancel must not write'); await press('Cancel'); assert.equal(nodes('Sheet').length, 0);
  });
  await t.test('Accounts pending blocks cancel and hardware dismissal; create error retains draft and permits retry', async () => {
    await mount(Accounts); await press('Add account'); await change('Account name', 'Draft');
    let reject; state.save = () => new Promise((_, no) => { reject = no; });
    await press('Create account'); assert.equal(button('Cancel').props.disabled, true);
    await act(async () => nodes('Sheet')[0].props.onDismiss()); assert.equal(nodes('Sheet').length, 1);
    await act(async () => reject(Error('Create failed'))); assert.match(text(), /Create failed/);
    assert.equal(nodes('FormInput')[0].props.value, 'Draft'); assert.equal(button('Cancel').props.disabled, false);
    state.save = async () => {}; await press('Create account'); assert.equal(nodes('Sheet').length, 0);
  });
  await t.test('Accounts committed create plus refetch failure retries loading, not creation', async () => {
    await mount(Accounts); await press('Add account'); let saves = 0;
    state.save = async () => { saves++; }; state.list = async () => { throw Error('Refetch failed'); };
    await press('Create account'); assert.equal(nodes('Sheet').length, 0); assert.match(text(), /Refetch failed/);
    state.list = async () => []; await press('Retry accounts'); assert.equal(saves, 1); assert.doesNotMatch(text(), /Refetch failed/);
  });
  await t.test('Quick add Save keeps amount, selected defaults and optional outlined draft values', async () => {
    await mount(QuickAdd); await change('Amount', '12'); await change('Note', 'Lunch'); await change('Tags, separated by commas', 'food');
    let saved; state.save = async (...args) => { saved = args; }; await press('Save');
    assert.equal(saved[0].amountMinor, 1200); assert.equal(saved[0].accountId, 1); assert.equal(saved[0].categoryId, 3); assert.equal(saved[0].type, 'EXPENSE'); assert.equal(saved[0].note, 'Lunch'); assert.equal(saved[1], 'food');
  });
  await t.test('Transfer destination selection enables shared save and preserves account direction', async () => {
    await mount(Transfer); await change('Transfer amount', '7'); assert.equal(button('Save transfer').props.disabled, true);
    await act(async () => nodes('Pressable').find(n => n.props.accessibilityLabel?.startsWith('To account:')).props.onPress());
    await act(async () => nodes('NativeButton')[0].props.onPress());
    assert.equal(button('Save transfer').props.disabled, false);
    let saved; state.save = async x => { saved = x; }; await press('Save transfer');
    assert.deepEqual(saved, { amountMinor: 700, fromAccountId: 1, toAccountId: 2, note: '' }); assert.equal(state.back, true);
  });
});
