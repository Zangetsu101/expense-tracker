import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const state = {};
globalThis.__editTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator'; export const Alert={alert:(...args)=>globalThis.__editTest.alert=args}; export const BackHandler={addEventListener:(_,fn)=>{globalThis.__editTest.back=fn;return {remove(){}}}};`,
  'expo-router': `export const useLocalSearchParams=()=>({id:'1'}); export const Stack={Screen:(props)=>{globalThis.__editTest.header=props.options;return null}};`,
  'expo-router/react-navigation': `export const useNavigation=()=>({dispatch:action=>globalThis.__editTest.dispatched=action}); export const usePreventRemove=(enabled,callback)=>{Object.assign(globalThis.__editTest,{prevent:enabled,navigate:callback})};`,
  '@expo/ui': `export const Host='Host',Switch='Switch';`,
  '@/components/transaction-receipt': `export const TransactionReceipt='Receipt';`,
  '@/lib/transaction-edit': `export const loadEditableTransaction=(...args)=>globalThis.__editTest.load(...args); export const saveTransactionEdit=(...args)=>globalThis.__editTest.save(...args);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/components/form-controls') return { url: new URL('src/components/form-controls.tsx', root).href, shortCircuit: true };
    if (specifier in mocks) return { url: `edit-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) return { url: new URL(`${specifier.replace('@/', 'src/')}.ts`, root).href, shortCircuit: true };
    return next(specifier, context.parentURL?.startsWith('edit-mock:') ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith('edit-mock:')) return { format: 'module', source: mocks[url.slice(10)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { default: Screen } = await import('../app/transaction/[id].tsx');
const transaction = { id: 1, type: 'expense', amountMinor: 1000, currencyCode: 'USD', date: 20000, accountName: 'Cash', categoryName: 'Food', note: '', tags: [], lineItems: [], excludeFromReport: 0 };
let renderer;
const nodes = type => renderer.root.findAllByType(type);
const texts = () => nodes('Text').map(n => n.children.join(''));
async function press(label) {
  const button = nodes('Pressable').find(n => n.props.accessibilityLabel === label || n.findAllByType('Text').some(t => t.children.join('') === label));
  assert.ok(button, label); assert.notEqual(button.props.disabled, true);
  await act(async () => { button.props.onPress(); });
}
async function change(label, value) { await act(async () => nodes('TextInput').find(n => n.props.accessibilityLabel === label).props.onChangeText(value)); }
async function mount() {
  Object.assign(state, { alert: undefined, dispatched: undefined, load: async () => transaction, save: async () => {} });
  await act(async () => { renderer = create(React.createElement(Screen)); });
  await act(async () => state.header.headerRight().props.onPress());
}
async function back() { await act(async () => state.back()); }
async function alertChoice(label) { await act(async () => state.alert[2].find(b => b.text === label).onPress()); }

test('Transaction edit screen', async t => {
  t.afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = undefined; });
  t.after(() => { hooks.deregister(); delete globalThis.__editTest; if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });
  await t.test('hardware back sees current dirty draft and Keep editing allows another confirmation', async () => {
    await mount(); await change('Note', 'draft'); await back();
    assert.equal(state.alert[0], 'Discard changes?');
    await alertChoice('Keep editing'); state.alert = undefined; await back();
    assert.equal(state.alert[0], 'Discard changes?'); await alertChoice('Discard');
    assert.equal(nodes('Receipt').length, 1);
  });
  await t.test('navigation discard resumes original action, clean cancel needs no confirmation', async () => {
    await mount(); await change('Tags', 'food');
    await act(async () => state.navigate({ data: { action: 'BACK' } }));
    await alertChoice('Discard'); assert.equal(state.dispatched, 'BACK');
  });
  await t.test('clean Cancel returns to receipt without confirmation', async () => {
    await mount(); await press('Cancel'); assert.equal(state.alert, undefined); assert.equal(nodes('Receipt').length, 1);
  });
  await t.test('receipt reload failure preserves the draft and permits retry', async () => {
    await mount(); await change('Note', 'draft');
    let saves = 0; state.save = async () => { saves++; };
    state.load = async () => { throw new Error('Reload failed'); };
    await press('Save changes');
    assert.ok(texts().includes('Error: Reload failed'));
    assert.equal(nodes('TextInput')[0].props.value, 'draft');
    assert.equal(state.prevent, false);
    assert.ok(nodes('TextInput').every(n => n.props.editable === false));
    state.load = async () => ({ ...transaction, note: 'draft' });
    await press('Retry receipt');
    assert.equal(saves, 1);
    assert.equal(nodes('Receipt')[0].props.transaction.note, 'draft');
  });
  for (const exit of ['header', 'back', 'bottom']) {
    await t.test(`committed edit exits via ${exit} refetch receipt instead of showing stale data`, async () => {
      await mount(); await change('Note', 'saved note');
      let saves = 0; state.save = async () => { saves++; };
      state.load = async () => { throw new Error('Reload failed'); };
      await press('Save changes');
      assert.equal(state.prevent, false);
      let resolve;
      state.load = () => new Promise(yes => { resolve = yes; });
      if (exit === 'header') await act(async () => state.header.headerLeft().props.onPress());
      else if (exit === 'back') await back();
      else await press('Cancel');
      assert.equal(state.alert, undefined);
      assert.equal(nodes('Receipt').length, 0);
      assert.equal(state.header.headerRight, undefined);
      assert.equal(nodes('ActivityIndicator').length, 1);
      await act(async () => resolve({ ...transaction, note: 'saved note' }));
      assert.equal(nodes('Receipt')[0].props.transaction.note, 'saved note');
      await act(async () => state.header.headerRight().props.onPress());
      assert.equal(nodes('TextInput')[0].props.value, 'saved note');
      assert.equal(saves, 1);
    });
  }
  await t.test('failed refetch after committed Cancel shows Retry, never stale receipt', async () => {
    await mount(); await change('Note', 'saved note');
    let saves = 0; state.save = async () => { saves++; };
    state.load = async () => { throw new Error('Reload failed'); };
    await press('Save changes'); await press('Cancel');
    assert.equal(nodes('Receipt').length, 0);
    assert.equal(state.header.headerRight, undefined);
    assert.ok(texts().includes('Error: Reload failed'));
    state.load = async () => ({ ...transaction, note: 'saved note' });
    await press('Retry');
    assert.equal(nodes('Receipt')[0].props.transaction.note, 'saved note');
    assert.equal(saves, 1);
  });
  await t.test('pending save blocks back and navigation until receipt reload, failed save retains retryable draft', async () => {
    await mount(); await change('Note', 'draft');
    let reject; state.save = () => new Promise((_, no) => { reject = no; });
    await press('Save changes'); assert.equal(state.prevent, true);
    await back(); await act(async () => state.navigate({ data: { action: 'BACK' } }));
    assert.equal(state.alert, undefined); assert.equal(state.dispatched, undefined);
    assert.ok(nodes('TextInput').every(n => n.props.editable === false));
    await act(async () => reject(new Error('Save failed')));
    assert.ok(texts().includes('Error: Save failed'));
    assert.equal(nodes('TextInput')[0].props.value, 'draft');
    let reload; state.save = async () => {}; state.load = () => new Promise(yes => { reload = yes; });
    await press('Save changes'); await back(); assert.equal(state.alert, undefined);
    await act(async () => reload({ ...transaction, note: 'draft' }));
    assert.equal(nodes('Receipt')[0].props.transaction.note, 'draft');
  });
  await t.test('invalid amount stays editable, signed and zero items with quantities reach save', async () => {
    await mount(); await press('Add line item'); await change('Line item 1 name', 'Discount'); await change('Line item 1 amount', 'bad');
    let saved; state.save = async (...args) => { saved = args; };
    await press('Save changes'); assert.equal(saved, undefined); assert.equal(nodes('Receipt').length, 0);
    await change('Line item 1 amount', '-1.25'); await change('Line item 1 quantity', '2');
    await press('Add line item'); await change('Line item 2 name', 'Free'); await change('Line item 2 amount', '0');
    await change('Tags', 'food, weekly');
    await act(async () => nodes('Switch')[0].props.onValueChange(true));
    await press('Save changes');
    assert.equal(saved[0].amountMinor, 1000); assert.equal(saved[2], true); assert.equal(saved[3], 'food, weekly');
    assert.deepEqual(saved[4].map(i => [i.amountMinor, i.quantity]), [[-125, 2], [0, null]]);
  });
});
