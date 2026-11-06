import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const state = { focus: 0, accounts: [], calls: [], query: undefined };
globalThis.__reportsScreenTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  'react-native': `export const View='View', Text='Text', Pressable='Pressable', ScrollView='ScrollView', TextInput='TextInput', ActivityIndicator='ActivityIndicator', KeyboardAvoidingView='KeyboardAvoidingView'; export const Platform={OS:'android'}; export const useWindowDimensions=()=>({width:400,height:800});`,
  'expo-router': `import React from 'react'; export const Stack={Screen:()=>null}; export function useFocusEffect(callback){React.useEffect(callback,[callback,globalThis.__reportsScreenTest.focus]);}`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0,top:0,left:0,right:0});`,
  '@/components/app-sheet': `export const AppSheet=({children})=>children;`,
  '@/lib/accounts': `export const listManagedAccounts=async()=>globalThis.__reportsScreenTest.accounts;`,
  '@/lib/reports': `export function monthlyReport(...args){const s=globalThis.__reportsScreenTest;s.calls.push(args);return s.query(...args);}`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/components/form-controls')
      return { url: new URL('src/components/form-controls.tsx', root).href, shortCircuit: true };
    if (specifier in mocks) return { url: `reports-mock:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const path =
        specifier === '@/theme' ? 'src/theme.ts' : `${specifier.replace('@/', 'src/')}.ts`;
      return { url: new URL(path, root).href, shortCircuit: true };
    }
    return next(
      specifier,
      context.parentURL?.startsWith('reports-mock:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('reports-mock:'))
      return { format: 'module', source: mocks[url.slice(13)], shortCircuit: true };
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
const { default: ReportsScreen } = await import('../app/(tabs)/reports/index.tsx');
const accounts = [
  { id: 7, name: 'Wallet', currencyCode: 'USD' },
  { id: 8, name: 'Bank', currencyCode: 'EUR' },
];
const report = (income = 12000, expense = 3500) => ({
  summaries: [
    { currencyCode: 'USD', incomeMinor: income, expenseMinor: expense },
    { currencyCode: 'EUR', incomeMinor: 900, expenseMinor: 200 },
  ],
  spending: [{ currencyCode: 'USD', categoryId: 1, categoryName: 'Food', amountMinor: expense }],
});
let renderer;
const nodes = (type) => renderer.root.findAllByType(type);
const labelled = (label) =>
  renderer.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === label);
const text = () =>
  nodes('Text').map((n) => n.children.filter((c) => typeof c === 'string').join(''));
async function press(label) {
  const button = nodes('Pressable').find(
    (n) =>
      n.props.accessibilityLabel === label ||
      n.findAllByType('Text').some((t) => t.children.join('') === label),
  );
  assert.ok(button, `button ${label} is visible`);
  assert.notEqual(button.props.disabled, true);
  await act(async () => button.props.onPress());
}
async function mount(query = async () => report()) {
  state.focus = 0;
  state.calls = [];
  state.accounts = [...accounts];
  state.query = query;
  await act(async () => {
    renderer = create(React.createElement(ReportsScreen));
  });
}
async function chooseWallet() {
  await press('Choose account scope, All accounts');
  await press('Wallet · USD');
}
async function draft(value) {
  await act(async () => labelled('Report year')[0].props.onChangeText(value));
}
function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test('Reports screen behavior', async (t) => {
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    hooks.deregister();
    delete globalThis.__reportsScreenTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  t.afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = undefined;
  });

  await t.test('account scope drives the query and visible currency totals', async () => {
    await mount(async (_year, _month, scope) => (scope === 7 ? report(5000, 1250) : report()));
    assert.equal(labelled('Income, EUR 9.00').length, 1);
    await chooseWallet();
    assert.equal(state.calls.at(-1)[2], 7);
    assert.equal(labelled('Choose account scope, Wallet · USD').length, 1);
    assert.equal(labelled('Income, USD 50.00').length, 1);
    assert.equal(labelled('Expense, USD -12.50').length, 1);
    assert.equal(labelled('Net, USD 37.50').length, 1);
    assert.ok(!text().includes('EUR report'));
    assert.ok(text().includes('100.0% of spending'));
  });

  await t.test(
    'year navigation and corrected year input keep month and account scope',
    async () => {
      await mount();
      const initialYear = state.calls[0][0];
      await press(`September ${initialYear}`);
      await chooseWallet();
      await press('Next year');
      assert.deepEqual(state.calls.at(-1), [initialYear + 1, 9, 7]);
      await press('Previous year');
      assert.deepEqual(state.calls.at(-1), [initialYear, 9, 7]);
      await press(`Choose report year, ${initialYear}`);
      const count = state.calls.length;
      await draft('0');
      await press('Go to year');
      assert.equal(labelled('Report year').length, 1);
      assert.ok(text().includes('Enter a year from 1 to 9999.'));
      assert.equal(state.calls.length, count);
      await draft('2025');
      await press('Go to year');
      assert.deepEqual(state.calls.at(-1), [2025, 9, 7]);
      assert.equal(labelled('Report year').length, 0);
      assert.ok(text().includes('September 2025'));
    },
  );

  await t.test('failed load displays an error and Retry recovers', async () => {
    let attempts = 0;
    await mount(async () => {
      if (++attempts === 1) throw new Error('Database unavailable');
      return report();
    });
    assert.ok(text().includes('Database unavailable'));
    assert.equal(labelled('Income, USD 120.00').length, 0);
    await press('Retry');
    assert.equal(attempts, 2);
    assert.deepEqual(state.calls[1], state.calls[0]);
    assert.ok(!text().includes('Database unavailable'));
    assert.equal(labelled('Income, USD 120.00').length, 1);
  });

  await t.test(
    'changing month hides the previous totals until the new report arrives',
    async () => {
      await mount();
      const pending = deferred();
      state.query = () => pending.promise;
      const [year, month] = state.calls[0];
      await press(`${month === 1 ? 'February' : 'January'} ${year}`);
      assert.equal(labelled('Loading reports').length, 1);
      assert.equal(labelled('Income, USD 120.00').length, 0);
      await act(async () => pending.resolve(report(22000, 1000)));
      assert.equal(labelled('Income, USD 220.00').length, 1);
    },
  );

  await t.test('late old request cannot replace the selected month report', async () => {
    const old = deferred();
    let requests = 0;
    await mount(() => (++requests === 1 ? old.promise : Promise.resolve(report(22000, 1000))));
    const year = state.calls[0][0];
    const nextMonth = state.calls[0][1] === 1 ? 'February' : 'January';
    await press(`${nextMonth} ${year}`);
    assert.equal(labelled('Income, USD 220.00').length, 1);
    await act(async () => old.resolve(report(99900, 0)));
    assert.equal(labelled('Income, USD 220.00').length, 1);
    assert.equal(labelled('Income, USD 999.00').length, 0);
    assert.ok(text().includes(`${nextMonth} ${year}`));
  });

  await t.test('refocusing after selected account removal resets to All accounts', async () => {
    await mount();
    await chooseWallet();
    state.accounts = [accounts[1]];
    const before = state.calls.length;
    await act(async () => {
      state.focus++;
      renderer.update(React.createElement(ReportsScreen));
    });
    assert.equal(state.calls[before][2], 7);
    assert.equal(state.calls.at(-1)[2], undefined);
    assert.equal(labelled('Choose account scope, All accounts').length, 1);
    assert.ok(text().includes('EUR report'));
    assert.ok(!text().includes('USD report'));
    assert.equal(labelled('Loading reports').length, 0);
  });
});
