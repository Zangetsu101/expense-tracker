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
  'react-native': `export const BackHandler={addEventListener:(_,callback)=>{globalThis.__entryTest.backHandler=callback;return {remove(){globalThis.__entryTest.backHandler=undefined}}}}; export const Keyboard={dismiss() {}}; export const KeyboardAvoidingView='KeyboardAvoidingView',View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator',FlatList='FlatList'; export const useWindowDimensions=()=>({width:390,height:844}); export const Alert={alert:(...args)=>globalThis.__entryTest.alert=args};`,
  'expo-router': `import {useEffect} from 'react'; export const useFocusEffect=fn=>useEffect(fn,[fn]); export const useLocalSearchParams=()=>globalThis.__entryTest.params ?? {}; export const router={back:()=>globalThis.__entryTest.back=true}; export const Stack={Screen:()=>null};`,
  'expo-router/react-navigation': `export const useHeaderHeight=()=>88; export const useNavigation=()=>({dispatch:action=>globalThis.__entryTest.dispatched=action}); export const usePreventRemove=(enabled,callback)=>{globalThis.__entryTest.removal={enabled,callback}};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@expo/ui': `export const Host='Host',BottomSheet='BottomSheet',Column='Column',Text='NativeText',Button='NativeButton';`,
  '@/components/form-controls': `export const FormButton='FormButton',FormInput='FormInput',JoinedChoice='JoinedChoice';`,
  '@/components/app-sheet': `import React from 'react'; export function AppSheet(props){return React.createElement('Sheet',props,props.children);}`,
  '@/components/quick-add-date': `export const QuickAddDate='Date';`,
  '@/components/quick-add-category': `export const QuickAddCategory='Category';`,
  '@/lib/lending': `export const listPeople=async()=>[{id:1,name:'Rafi'}]; export const listLendingTotals=async()=>[]; export const createPerson=async name=>({id:2,name:name.trim()}); export const saveLendingEntry=x=>globalThis.__entryTest.save(x);`,
  '@/lib/accounts': `export const listManagedAccounts=()=>globalThis.__entryTest.list(); export const createAccount=x=>globalThis.__entryTest.save(x); export const setFavoriteAccount=async()=>{};`,
  '@/lib/reports': `export const accountBalances=async()=>globalThis.__entryTest.balances ?? [{id:1,balanceMinor:100}];`,
  '@/lib/database': `export const epochDay=d=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000); export const listAccounts=async()=>{if(globalThis.__entryTest.loadError)throw Error('Load failed');return [{id:1,name:'Cash',currencyCode:'USD',isFavorite:1},{id:2,name:'Bank',currencyCode:'USD'},{id:4,name:'Foreign',currencyCode:'BDT'}]}; export const listCategories=async()=>[{id:3,name:'Food'}]; export const setFavoriteAccount=async()=>{};`,
  '@/lib/categories': `export const listManagedCategories=async()=>[{id:3,name:'Food',type:'EXPENSE',parentId:null,parentName:null,needsReview:0}];`,
  '@/lib/quick-add-tags': `export const addQuickTransaction=(...args)=>globalThis.__entryTest.save(...args);`,
  '@/lib/transfers': `export const transferAmountMinor=x=>{const n=Number(x)*100;if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid amount');return n}; export const addTransfer=x=>globalThis.__entryTest.save(x);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `entry-mock:${specifier}`, shortCircuit: true };
    if (specifier === '@/components/amount-calculator') return { url: new URL('src/components/amount-calculator.tsx', root).href, shortCircuit: true };
    if (specifier === '@/components/entry-choices') return { url: new URL('src/components/entry-choices.tsx', root).href, shortCircuit: true };
    if (specifier === '@/components/transfer-form') return { url: new URL('src/components/transfer-form.tsx', root).href, shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`${specifier.replace('@/', 'src/')}.ts`, root).href, shortCircuit: true };
    return next(specifier, context.parentURL?.startsWith('entry-mock:') ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith('entry-mock:')) return { format: 'module', source: mocks[url.slice(11)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { default: Accounts } = await import('../app/(tabs)/accounts/index.tsx');
const { default: QuickAdd } = await import('../app/quick-add.tsx');
const { default: Transfer } = await import('../app/transfer.tsx');
let renderer;
const nodes = type => renderer.root.findAllByType(type);
const button = label => nodes('FormButton').find(n => n.props.label === label);
async function press(label) { await act(async () => button(label).props.onPress()); }
async function change(label, value) { await act(async () => [...nodes('FormInput'), ...nodes('TextInput')].find(n => n.props.accessibilityLabel === label).props.onChangeText(value)); }
async function mount(Screen) {
  Object.assign(state, { list: async () => [], save: async () => ({ status: 'saved', id: 1 }), back: false, alert: undefined, loadError: false });
  await act(async () => { renderer = create(React.createElement(Screen)); });
}
const text = () => nodes('Text').map(n => n.children.join('')).join('\n');
test('Account entry screens', async t => {
  t.afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; delete state.balances; delete state.params; });
  t.after(() => { hooks.deregister(); delete globalThis.__entryTest; if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });
  await t.test('Accounts group headings use singular and plural counts', async () => {
    Object.assign(state, { save: async () => {}, back: false });
    state.list = async () => [{ id: 1, name: 'Cash', currencyCode: 'BDT', openingBalanceMinor: 0, isFavorite: 1 }, { id: 2, name: 'Bank', currencyCode: 'BDT', openingBalanceMinor: 0, isFavorite: 0 }, { id: 3, name: 'Card', currencyCode: 'USD', openingBalanceMinor: 0, isFavorite: 0 }];
    state.balances = [1, 2, 3].map(id => ({ id, balanceMinor: 0 }));
    await act(async () => { renderer = create(React.createElement(Accounts)); });
    assert.match(text(), /BDT · 2 accounts/); assert.match(text(), /USD · 1 account$/m);
  });
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
    assert.equal(saved[0].amountMinor, 1200); assert.equal(saved[0].accountId, 1); assert.equal(saved[0].categoryId, 3); assert.equal(saved[0].type, 'EXPENSE'); assert.equal(saved[0].note, 'Lunch'); assert.equal(saved[1], 'food'); assert.equal(state.back, true); assert.equal(state.alert, undefined);
  });
  await t.test('Amount focus opens a docked keypad and Done resolves the calculation', async () => {
    await mount(QuickAdd); await change('Amount', '12');
    const amountField = () => nodes('TextInput').find(n => n.props.accessibilityLabel === 'Amount');
    const key = async label => { await act(async () => nodes('Pressable').find(n => n.props.accessibilityLabel === label).props.onPress()); };
    await act(async () => amountField().props.onFocus());
    assert.equal(amountField().props.showSoftInputOnFocus, false);
    await key('Add');
    assert.equal(nodes('Text').some(n => n.children.includes('Enter a positive amount with at most two decimal places.')), false);
    await key('3'); await key('Equals'); await key('7');
    assert.equal(amountField().props.value, '7');
    await key('Done');
    assert.equal(amountField().props.value, '7.00');
    assert.equal(nodes('Pressable').some(n => n.props.accessibilityLabel === 'Done'), false);
    await act(async () => amountField().props.onFocus());
    await key('Clear calculation'); await key('2'); await key('Divide'); await key('0'); await key('Equals');
    assert.ok(nodes('Text').some(n => n.children.includes('Cannot divide by zero.')));
    await key('Backspace'); await key('2'); await key('Done');
    assert.equal(amountField().props.value, '1.00');
    await act(async () => amountField().props.onFocus());
    await key('Add'); await key('2');
    await act(async () => amountField().props.onBlur());
    assert.equal(amountField().props.value, '3.00');
    await act(async () => amountField().props.onFocus());
    await key('Add'); await key('4');
    await act(async () => assert.equal(state.backHandler(), true));
    assert.equal(amountField().props.value, '7.00');
    assert.equal(nodes('Pressable').some(n => n.props.accessibilityLabel === 'Done'), false);
    assert.equal(state.backHandler, undefined);
  });
  await t.test('Home account context overrides favorite and remains editable in Quick Add', async () => {
    state.params = { accountId: '2' };
    await mount(QuickAdd); await change('Amount', '12');
    let selector = renderer.root.findAll(n => n.type?.name === 'AccountChoices')[0];
    assert.equal(selector.props.selectedId, 2);
    await act(async () => selector.props.onSelect(4));
    let saved; state.save = async draft => { saved = draft; };
    await press('Save'); assert.equal(saved.accountId, 4);
  });
  await t.test('A missing Home account falls back to favorite in Quick Add', async () => {
    state.params = { accountId: '99' };
    await mount(QuickAdd);
    assert.equal(renderer.root.findAll(n => n.type?.name === 'AccountChoices')[0].props.selectedId, 1);
  });
  await t.test('Transfer destination selection enables shared save and preserves account direction', async () => {
    await mount(Transfer); await change('Transfer amount', '7'); assert.equal(button('Save transfer').props.disabled, true);
    await act(async () => nodes('Pressable').find(n => n.props.accessibilityLabel?.startsWith('To account:')).props.onPress());
    await act(async () => nodes('NativeButton').find(n => n.props.label.startsWith('Bank')).props.onPress());
    assert.equal(button('Save transfer').props.disabled, false);
    let saved; state.save = async x => { saved = x; }; await press('Save transfer');
    assert.deepEqual(saved, { amountMinor: 700, fromAccountId: 1, toAccountId: 2, note: '' }); assert.equal(state.back, true);
  });
  await t.test('Quick add transfer selects accounts inline, restricts currency, and saves date and tags', async () => {
    await mount(QuickAdd); await change('Amount', '8.25');
    await act(async () => nodes('JoinedChoice')[0].props.onChange('TRANSFER'));
    let selectors = renderer.root.findAll(n => n.type?.name === 'AccountChoices');
    assert.deepEqual(selectors[1].props.accounts.map(a => a.id), [2]);
    await act(async () => selectors[1].props.onSelect(2));
    await change('Tags, separated by commas', 'move');
    const date = new Date(2020, 0, 1);
    await act(async () => nodes('Date')[0].props.onChange(date));
    let saved; state.save = async x => { saved = x; };
    await press('Save transfer');
    assert.equal(saved.amountMinor, 825); assert.equal(saved.fromAccountId, 1); assert.equal(saved.toAccountId, 2);
    assert.equal(saved.tagText, 'move'); assert.equal(saved.date, date); assert.equal(state.back, true); assert.equal(state.alert, undefined);
    selectors = renderer.root.findAll(n => n.type?.name === 'AccountChoices');
    await act(async () => selectors[0].props.onSelect(4));
    selectors = renderer.root.findAll(n => n.type?.name === 'AccountChoices');
    assert.deepEqual(selectors[1].props.accounts, []); assert.equal(button('Save transfer').props.disabled, true);
  });
  await t.test('Quick add save failure retains draft and prevents duplicate pending submissions', async () => {
    await mount(QuickAdd); await change('Amount', '12'); await change('Note', 'Draft');
    let reject; let saves = 0;
    state.save = () => { saves++; return new Promise((_, no) => { reject = no; }); };
    await press('Save'); await press('Save'); assert.equal(saves, 1);
    assert.equal(button('Save').props.loading, true);
    assert.equal(state.removal.enabled, true);
    state.dispatched = undefined; state.removal.callback({ data: { action: { type: 'GO_BACK' } } }); assert.equal(state.dispatched, undefined);
    await act(async () => reject(Error('Save failed')));
    assert.match(text(), /Save failed/); assert.equal(state.back, false);
    assert.equal(nodes('TextInput').find(n => n.props.accessibilityLabel === 'Amount').props.value, '12');
    assert.equal(nodes('FormInput').find(n => n.props.accessibilityLabel === 'Note').props.value, 'Draft');
    state.save = async () => {}; await press('Save'); assert.equal(state.back, true); assert.equal(state.alert, undefined);
  });
  await t.test('Quick add repayment cancel retains draft and confirm resubmits the same entry', async () => {
    await mount(QuickAdd); await change('Amount', '10');
    await act(async () => nodes('JoinedChoice')[0].props.onChange('PERSON'));
    await act(async () => nodes('Pressable').find(n => n.props.accessibilityLabel === 'Rafi').props.onPress());
    await act(async () => nodes('JoinedChoice')[2].props.onChange('RECEIVE_REPAYMENT'));
    const drafts = [];
    state.save = async draft => { drafts.push(draft); return draft.confirmOverpayment ? { status: 'saved', id: 1 } : { status: 'confirmation_required', warnings: [{ currencyCode: 'USD', direction: 'LENT', overpaidMinor: 1000 }] }; };
    await press('Save repayment received');
    assert.equal(state.alert[0], 'Overpayment warning'); assert.equal(state.back, false);
    await act(async () => state.alert[2][0].onPress()); assert.equal(drafts.length, 1);
    assert.equal(button('Save repayment received').props.loading, false);
    await press('Save repayment received');
    await act(async () => state.alert[2][1].onPress());
    assert.deepEqual(drafts[2], { ...drafts[0], confirmOverpayment: true }); assert.equal(state.back, true);
  });
  await t.test('Quick add loading failure can be retried without showing sample accounts', async () => {
    state.loadError = true;
    await act(async () => { renderer = create(React.createElement(QuickAdd)); });
    assert.match(text(), /Load failed/); assert.equal(button('Save'), undefined);
    state.loadError = false; await press('Reload data'); assert.ok(button('Save'));
  });

});
