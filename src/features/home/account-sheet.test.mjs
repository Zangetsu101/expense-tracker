import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const root = new URL('../../../', import.meta.url);
const mocks = {
  'react-native': `export const View='View',Text='Text',Pressable='Pressable',TextInput='TextInput',ScrollView='ScrollView'; export const useWindowDimensions=()=>({width:400,height:800});`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  '@/components/app-sheet': `export const AppSheet='AppSheet';`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `sheet-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/'))
      return { url: new URL(`src/${specifier.slice(2)}.ts`, root).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('sheet-mock:'))
      return { format: 'module', source: mocks[url.slice(11)], shortCircuit: true };
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
const { AccountSheet, HomeTitle } = await import('./account-sheet.tsx');
after(() => hooks.deregister());

const account = (id, name, isFavorite = 0) => ({
  id,
  name,
  currencyCode: 'BDT',
  isFavorite,
  balanceMinor: 1000,
  lastUsedDay: null,
});
const cards = [
  { accountId: null, account: null, face: 'pace' },
  { accountId: 2, account: account(2, 'Bank', 1), face: 'trend' },
  { accountId: 3, account: account(3, 'bKash'), face: 'trend' },
];

async function render(element) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}
const labels = (renderer) =>
  renderer.root
    .findAllByType('Pressable')
    .map((node) => node.props.accessibilityLabel)
    .filter(Boolean);

test('the account list follows the deck order and ends with Add account', async () => {
  const picked = [];
  let added = 0;
  const renderer = await render(
    React.createElement(AccountSheet, {
      cards,
      selectedId: 2,
      onSelect: (id) => picked.push(id),
      onAddAccount: () => added++,
      onDismiss() {},
    }),
  );
  assert.deepEqual(labels(renderer), ['Done', 'All accounts', 'Bank', 'bKash', 'Add account']);
  const press = (label) =>
    renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === label)
      .props.onPress();
  assert.equal(
    renderer.root
      .findAllByType('Pressable')
      .find((node) => node.props.accessibilityLabel === 'Bank').props.accessibilityState.selected,
    true,
  );
  await act(async () => press('All accounts'));
  await act(async () => press('bKash'));
  assert.deepEqual(picked, [null, 3]);
  await act(async () => press('Add account'));
  assert.equal(added, 1);
});

test('with one Account the list has no All accounts row', async () => {
  const renderer = await render(
    React.createElement(AccountSheet, {
      cards: [{ accountId: 7, account: account(7, 'Cash', 1), face: 'pace' }],
      selectedId: 7,
      onSelect() {},
      onAddAccount() {},
      onDismiss() {},
    }),
  );
  assert.deepEqual(labels(renderer), ['Done', 'Cash', 'Add account']);
});

test('the title names the Account in view and opens the list', async () => {
  let opened = 0;
  const renderer = await render(
    React.createElement(HomeTitle, { name: 'Bank', onPress: () => opened++ }),
  );
  const button = renderer.root.findByType('Pressable');
  assert.equal(button.props.accessibilityLabel, 'Bank, choose account');
  await act(async () => button.props.onPress());
  assert.equal(opened, 1);
});
