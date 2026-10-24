import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const state = { alerts: [], calls: [] };
globalThis.__dataTools = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',ActivityIndicator='ActivityIndicator';export const Alert={alert:(...args)=>globalThis.__dataTools.alerts.push(args)};`,
  'expo-router': `export const Stack={Screen:()=>null};`,
  'expo-router/react-navigation': `export function usePreventRemove(busy,callback){globalThis.__dataTools.navigation={busy,callback}}`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@/lib/backup-adapter': `export const backupStore={},backupDocuments={};`,
  '@/lib/backup': `export const exportBackup=(...args)=>{const s=globalThis.__dataTools;s.calls.push(['backup',...args]);return s.backup()};export const restoreBackup=(...args)=>{const s=globalThis.__dataTools;s.calls.push(['restore',...args]);return s.restore()};`,
  '@/lib/export-csv': `export const exportTransactionsCsv=()=>{const s=globalThis.__dataTools;s.calls.push(['export']);return s.export()};`,
  '@/lib/import-csv': `export const importMoneyLoverFile=(confirm)=>{const s=globalThis.__dataTools;s.calls.push(['import']);return s.import(confirm)};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `tools-mock:${specifier}`, shortCircuit: true };
    if (specifier === '@/theme') return { url: new URL('src/theme.ts', root).href, shortCircuit: true };
    return next(specifier, context.parentURL?.startsWith('tools-mock:') ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith('tools-mock:')) return { format: 'module', source: mocks[url.slice(11)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { default: Screen } = await import('../app/data-tools.tsx');
let renderer;
const text = () => renderer.root.findAllByType('Text').map(n => n.children.join('')).join('\n');
const button = label => renderer.root.findAllByType('Pressable').find(n => n.findAllByType('Text').some(t => t.children.join('') === label));
const press = label => act(async () => { button(label).props.onPress(); });
const choose = label => act(async () => { state.alerts.at(-1)[2].find(b => b.text === label).onPress(); });
async function mount() {
  state.alerts = []; state.calls = [];
  state.backup = async () => 'content://backup'; state.export = async () => 'content://csv'; state.restore = async () => true; state.import = async () => 7;
  await act(async () => { renderer = create(React.createElement(Screen)); });
}
test('Data tools screen', async t => {
  t.afterEach(async () => { await act(async () => renderer?.unmount()); });
  t.after(() => {
    hooks.deregister();
    delete globalThis.__dataTools;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await t.test('restore confirms before picker and Cancel does not call restore', async () => {
    await mount(); await press('Restore JSON backup');
    assert.equal(state.calls.length, 0); assert.equal(state.navigation.busy, true);
    await choose('Cancel'); assert.equal(state.calls.length, 0); assert.match(text(), /Restore JSON backup cancelled/);
    await press('Restore JSON backup'); await choose('Choose backup');
    assert.equal(state.calls[0][0], 'restore'); assert.match(text(), /Current data has been replaced/);
  });
  await t.test('decode failure stays visible, retry confirms again, pending blocks duplicates and leaving', async () => {
    await mount(); state.restore = async () => { throw new Error('Invalid backup'); };
    await press('Restore JSON backup'); await choose('Choose backup'); assert.match(text(), /failed\. Invalid backup/);
    let finish; state.restore = () => new Promise(resolve => { finish = resolve; });
    await press('Retry'); assert.equal(state.calls.length, 1); await choose('Choose backup');
    assert.equal(button('Create JSON backup').props.disabled, true);
    await press('Restore JSON backup'); assert.equal(state.calls.length, 2);
    await act(async () => state.navigation.callback()); assert.equal(state.alerts.at(-1)[0], 'Operation in progress');
    await act(async () => finish(true)); assert.equal(state.navigation.busy, false); assert.match(text(), /Backup restored/);
  });
  await t.test('picker cancellation is never success for all four operations', async () => {
    await mount(); state.backup = state.export = state.import = async () => null; state.restore = async () => false;
    for (const label of ['Create JSON backup', 'Export transactions CSV', 'Import MoneyLover CSV', 'Restore JSON backup']) {
      await press(label); if (label.startsWith('Restore')) await choose('Choose backup');
      assert.match(text(), new RegExp(`${label} cancelled`)); assert.doesNotMatch(text(), /created\.|exported\.|imported\.|has been replaced/);
    }
  });
  await t.test('mixed category confirmation forwards both decisions and cancellation handles helper rejection', async () => {
    await mount(); let answer;
    state.import = async confirm => { answer = await confirm(['Other']); if (!answer) throw new Error('Mixed Categories require confirmation'); return 2; };
    await press('Import MoneyLover CSV'); assert.match(state.alerts.at(-1)[1], /Other/); await choose('Cancel');
    assert.equal(answer, false); assert.match(text(), /Import MoneyLover CSV cancelled/);
    await press('Import MoneyLover CSV'); await choose('Create separate categories'); assert.equal(answer, true); assert.match(text(), /2 transactions imported/);
  });
  await t.test('accurate counts including zero, and exports report success only after helper completion', async () => {
    await mount();
    for (const count of [0, 1, 7]) { state.import = async () => count; await press('Import MoneyLover CSV'); assert.ok(text().includes(`${count} transaction${count === 1 ? '' : 's'} imported.`)); }
    await press('Create JSON backup'); assert.match(text(), /JSON backup created/);
    await press('Export transactions CSV'); assert.match(text(), /Transactions CSV exported/);
    state.export = async () => { throw new Error('Write failed'); }; await press('Export transactions CSV'); assert.match(text(), /Write failed/);
    state.export = async () => 'uri'; await press('Retry'); assert.match(text(), /Transactions CSV exported/);
  });
});
