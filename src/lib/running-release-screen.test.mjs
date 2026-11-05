import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.__DEV__ = false;
const state = { clipboard: null };
globalThis.__releaseTest = state;
const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `export const Text='Text',View='View',ScrollView='ScrollView',Pressable='Pressable'; export const Platform={OS:'android'}; export const TurboModuleRegistry={get:()=>globalThis.__releaseTest.clipboard};`,
  'expo-constants': `export default {executionEnvironment:'standalone',expoConfig:{version:'0.1.0'}};`,
  'expo-updates': `export const isEnabled=true,updateId='running-id',createdAt=new Date('2026-11-05Z'),runtimeVersion='0.1.0',channel='production',isEmbeddedLaunch=false,isEmergencyLaunch=false,emergencyLaunchReason=null; export const useUpdates=()=>{throw Error('Must not read pending updates')};`,
  '@/components/app-sheet': `export const AppSheet='AppSheet';`,
  '@/components/form-controls': `export const FormButton='FormButton';`,
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
const { RunningRelease } = await import('../components/running-release.tsx');
test('release details open, expose selectable running metadata, explain copying and dismiss', async t => {
  let renderer;
  t.after(async () => { await act(async () => renderer.unmount()); hooks.deregister(); delete globalThis.__DEV__; delete globalThis.__releaseTest; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct; });
  await act(async () => { renderer = create(React.createElement(RunningRelease)); });
  assert.equal(renderer.root.findAllByType('AppSheet').length, 0);
  await act(async () => renderer.root.findByType('Pressable').props.onPress());
  const details = renderer.root.findByProps({ selectable: true });
  assert.match(details.props.children, /Update ID: running-id/);
  await act(async () => renderer.root.findByProps({ label: 'Copy details' }).props.onPress());
  assert.match(renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children, /Select all and Copy/);
  state.clipboard = { setString: text => { state.copied = text; } };
  await act(async () => renderer.root.findByProps({ label: 'Copy details' }).props.onPress());
  assert.equal(state.copied, details.props.children);
  assert.equal(renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children, 'Details copied.');
  state.clipboard = { setString: () => { throw Error('unavailable'); } };
  await act(async () => renderer.root.findByProps({ label: 'Copy details' }).props.onPress());
  assert.match(renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children, /Select all and Copy/);
  await act(async () => renderer.root.findByProps({ label: 'Close' }).props.onPress());
  assert.equal(renderer.root.findAllByType('AppSheet').length, 0);
  await act(async () => renderer.root.findByType('Pressable').props.onPress());
  assert.equal(renderer.root.findAllByProps({ accessibilityRole: 'alert' }).length, 0);
  await act(async () => renderer.root.findByType('AppSheet').props.onDismiss());
  assert.equal(renderer.root.findAllByType('AppSheet').length, 0);
});
