import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const state = { alerts: [], calls: [], native: { isChecking: false, isDownloading: false, isStartupProcedureRunning: true, isUpdatePending: false, isRestarting: false } };
globalThis.__updatesTest = state;
globalThis.__DEV__ = false;
const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `export const Text='Text',View='View',ScrollView='ScrollView',Pressable='Pressable',ActivityIndicator='ActivityIndicator'; const s=globalThis.__updatesTest; export const Alert={alert:(...a)=>s.alerts.push(a)}; export const AppState={currentState:'active',addEventListener:(e,fn)=>{s.foreground=fn;return {remove:()=>{s.removed=true}}}};`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'expo-router': `export const Link='Link';`,
  'expo-constants': `export default {executionEnvironment:'standalone'};`,
  'expo-updates': `const s=globalThis.__updatesTest; export const isEnabled=true; export const useUpdates=()=>({...s.native}); export const checkForUpdateAsync=async()=>{s.calls.push('check');if(s.fail)throw Error('offline');return {isAvailable:false}}; export const fetchUpdateAsync=async()=>{s.calls.push('fetch');return {isNew:true}}; export const reloadAsync=async()=>{s.calls.push('reload')};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `updates-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const extension = specifier.startsWith('@/components/') ? '.tsx' : '.ts';
      return { url: new URL(`${specifier.replace('@/', 'src/')}${extension}`, root).href, shortCircuit: true };
    }
    return next(specifier, context.parentURL?.startsWith('updates-mock:') ? { ...context, parentURL: import.meta.url } : context);
  },
  load(url, context, next) {
    if (url.startsWith('updates-mock:')) return { format: 'module', source: mocks[url.slice(13)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url)) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText };
    return next(url, context);
  },
});
const { AppUpdatesProvider } = await import('../components/app-updates.tsx');
const { UpdatesRow: Screen } = await import('../components/app-updates.tsx');
let renderer;
const tree = () => React.createElement(AppUpdatesProvider, null, React.createElement(Screen));
const button = () => renderer.root.findByType('Pressable');
test('update row coordinates native startup, progress, readiness and confirmed restart', async t => {
  t.after(async () => {
    await act(async () => renderer?.unmount());
    hooks.deregister(); delete globalThis.__updatesTest; delete globalThis.__DEV__;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });
  await act(async () => { renderer = create(tree()); });
  assert.equal(button().props.disabled, true); assert.deepEqual(state.calls, []);
  state.native = { ...state.native, isStartupProcedureRunning: false, isDownloading: true, isUpdatePending: true, downloadProgress: 0.37 };
  await act(async () => renderer.update(tree()));
  assert.equal(button().props.accessibilityValue.text, 'Downloading update, 37%'); assert.equal(button().props.disabled, true);
  state.native = { ...state.native, isDownloading: false, isUpdatePending: true };
  await act(async () => renderer.update(tree()));
  assert.equal(button().props.accessibilityValue.text, 'Restart to update');
  assert.equal(renderer.root.findByType('SymbolView').props.name.android, 'restart_alt');
  assert.deepEqual(state.calls, []);
  await act(async () => button().props.onPress());
  assert.deepEqual(state.calls, []); assert.match(state.alerts[0][1], /Unsaved/);
  assert.equal(state.alerts[0][2][0].style, 'cancel');
  await act(async () => state.alerts[0][2][1].onPress());
  assert.deepEqual(state.calls, ['reload']);
  await act(async () => renderer.unmount()); assert.equal(state.removed, true);
  state.native = { ...state.native, isUpdatePending: false, isDownloading: false, isStartupProcedureRunning: false };
  state.calls = []; state.fail = true;
  await act(async () => { renderer = create(tree()); });
  assert.equal(button().props.accessibilityValue.text, 'Check for updates');
  assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'alert' }).length, 0);
  await act(async () => button().props.onPress());
  assert.equal(renderer.root.findByType('SymbolView').props.name.android, 'error_outline');
  assert.match(state.alerts.at(-1)[1], /connection/);
  state.fail = false;
  await act(async () => button().props.onPress());
  assert.equal(renderer.root.findByType('SymbolView').props.name.android, 'check_circle');
  await act(async () => renderer.unmount());
  globalThis.__DEV__ = true; state.calls = [];
  await act(async () => { renderer = create(tree()); });
  await act(async () => button().props.onPress());
  assert.match(state.alerts.at(-1)[1], /release build/);
  assert.deepEqual(state.calls, []);
});
