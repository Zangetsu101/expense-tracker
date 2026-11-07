import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const root = new URL('../../../', import.meta.url);
const mocks = {
  'react-native': `export const View='View',Text='Text',Pressable='Pressable',TextInput='TextInput',FlatList='FlatList'; export const useWindowDimensions=()=>({width:400,height:800});`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  '@/components/loading': `export const Skeleton='Skeleton',Shimmer='Shimmer';`,
  '@/components/app-sheet': `export const AppSheet='AppSheet';`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `picker-mock:${specifier}`, shortCircuit: true };
    if (specifier === '@/theme')
      return { url: new URL('src/theme.ts', root).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('picker-mock:'))
      return { format: 'module', source: mocks[url.slice(12)], shortCircuit: true };
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
const { HomeAccountPicker, HomeAccountPickerSkeleton } = await import('./account-picker.tsx');
after(() => hooks.deregister());

test('failed Account selection keeps choosing and retrying as separate actions', async (t) => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer,
    retries = 0;
  t.after(async () => {
    await act(async () => renderer?.unmount());
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  const props = {
    accounts: [{ id: 2, name: 'Bank', currencyCode: 'BDT' }],
    selectedId: 2,
    onSelect() {},
    error: true,
    onRetry() {
      retries++;
    },
  };
  await act(async () => {
    renderer = create(React.createElement(HomeAccountPicker, props));
  });
  const buttons = () => renderer.root.findAllByType('Pressable');
  assert.equal(buttons().length, 2);
  await act(async () => buttons()[1].props.onPress());
  assert.equal(retries, 1);
  assert.equal(renderer.root.findAllByType('AppSheet').length, 0, 'retry must not open selection');
  await act(async () => buttons()[0].props.onPress());
  assert.equal(retries, 1, 'choosing must not retry');
  assert.equal(renderer.root.findAllByType('AppSheet').length, 1);
  await act(async () => renderer.root.findByType('AppSheet').props.onDismiss());
  await act(async () =>
    renderer.update(
      React.createElement(HomeAccountPicker, { ...props, error: false, loading: true }),
    ),
  );
  assert.equal(renderer.root.findAllByType('Shimmer').length, 1);
  await act(async () => buttons()[1].props.onPress());
  assert.equal(renderer.root.findAllByType('AppSheet').length, 1, 'normal chevron opens selection');
  assert.equal(retries, 1);
});

test('Account picker placeholder has no actions and animates only while loading', async (t) => {
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  t.after(async () => {
    await act(async () => renderer?.unmount());
    if (previous === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  await act(async () => {
    renderer = create(React.createElement(HomeAccountPickerSkeleton, { animated: true }));
  });
  assert.equal(renderer.root.findAllByType('Pressable').length, 0);
  assert.equal(renderer.root.findAllByType('AppSheet').length, 0);
  assert.equal(renderer.root.findByType('Skeleton').props.animated, true);
  await act(async () =>
    renderer.update(React.createElement(HomeAccountPickerSkeleton, { animated: false })),
  );
  assert.equal(renderer.root.findByType('Skeleton').props.animated, false);
});
