import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { QueryClientProvider, notifyManager } from '@tanstack/react-query';
notifyManager.setScheduler(queueMicrotask);

const state = {};
globalThis.__entryTest = state;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  '@/lib/category-prediction-history': `export const listCategoryEvidence=async()=>globalThis.__entryTest.evidence??[];`,
  '@/components/loading': `export const Skeleton='Skeleton',Shimmer='Shimmer';`,
  'expo-symbols': `export const SymbolView='SymbolView';`,
  'expo-haptics': `export const AndroidHaptics={Keyboard_Tap:'keyboard'},ImpactFeedbackStyle={Light:'light'}; export const performAndroidHapticsAsync=async()=>{},impactAsync=async()=>{};`,
  'react-native-reanimated': `import {useRef} from 'react'; export default {View:'AnimatedView'}; export const Easing={out:x=>x,cubic:x=>x},ReduceMotion={System:'system'}; export const useSharedValue=value=>useRef({value}).current,useAnimatedStyle=fn=>fn(),withTiming=value=>value;`,
  'react-native': `export const BackHandler={addEventListener:(_,callback)=>{globalThis.__entryTest.backHandler=callback;return {remove(){globalThis.__entryTest.backHandler=undefined}}}}; export const Keyboard={dismiss() {globalThis.__entryTest.keyboardDismissed=true}}; export const KeyboardAvoidingView='KeyboardAvoidingView',View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator',FlatList='FlatList'; export const useWindowDimensions=()=>({width:390,height:844}); export const Alert={alert:(...args)=>globalThis.__entryTest.alert=args};`,
  'expo-router': `import {useEffect} from 'react'; export const useFocusEffect=fn=>useEffect(fn,[fn]); export const useLocalSearchParams=()=>globalThis.__entryTest.params ?? {accountId:'1'}; export const router={back:()=>globalThis.__entryTest.back=true}; export const Stack={Screen:()=>null};`,
  'expo-router/react-navigation': `export const useHeaderHeight=()=>88; export const useNavigation=()=>({dispatch:action=>globalThis.__entryTest.dispatched=action}); export const usePreventRemove=(enabled,callback)=>{globalThis.__entryTest.removal={enabled,callback}};`,
  'react-native-safe-area-context': `export const useSafeAreaInsets=()=>({bottom:0});`,
  '@expo/ui': `export const Host='Host',BottomSheet='BottomSheet',Column='Column',Text='NativeText',Button='NativeButton';`,
  '@/components/form-controls': `export const FormButton='FormButton',FormInput='FormInput',JoinedChoice='JoinedChoice';`,
  '@/components/app-sheet': `import React from 'react'; export function AppSheet(props){return React.createElement('Sheet',props,props.children);}`,
  '@/components/quick-add-date': `export const QuickAddDate='Date';`,
  '@/components/quick-select-category': `export const QuickSelectCategory='Category',CategorySearchInput='CategorySearchInput';`,
  '@/lib/lending': `export const listPeople=async()=>globalThis.__entryTest.readPeople?.()??[{id:1,name:'Rafi'}]; export const listLendingTotals=async()=>globalThis.__entryTest.readTotals?.()??[]; export const createPerson=async name=>globalThis.__entryTest.createPerson?.(name)??({id:2,name:name.trim()}); export const saveLendingEntry=x=>globalThis.__entryTest.save(x);`,
  '@/lib/accounts': `export const listManagedAccounts=()=>globalThis.__entryTest.list(); export const createAccount=x=>globalThis.__entryTest.save(x); export const setFavoriteAccount=async()=>{};`,
  '@/lib/reports': `export const accountBalances=async()=>globalThis.__entryTest.balances ?? [{id:1,balanceMinor:100}];`,
  '@/lib/database': `export const epochDay=d=>Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000); export const listAccounts=async()=>{if(globalThis.__entryTest.readAccounts)return globalThis.__entryTest.readAccounts();if(globalThis.__entryTest.loadError)throw Error('Load failed');return [{id:1,name:'Cash',currencyCode:'USD',isFavorite:1},{id:2,name:'Bank',currencyCode:'USD'},{id:4,name:'Foreign',currencyCode:'BDT'}]}; export const listCategories=async type=>globalThis.__entryTest.readCategories?.(type)??[{id:3,name:'Food'}]; export const setFavoriteAccount=async()=>{};`,
  '@/lib/categories': `export const listManagedCategories=async()=>[]; export const listCategoriesByRecentUse=async type=>globalThis.__entryTest.readManaged?.(type)??[{id:3,name:'Food',type:'EXPENSE',parentId:null,parentName:null,needsReview:0}];`,
  '@/lib/quick-add-tags': `export const addQuickTransaction=(...args)=>globalThis.__entryTest.save(...args);`,
  '@/lib/transfers': `export const addTransfer=x=>globalThis.__entryTest.save(x);`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `entry-mock:${specifier}`, shortCircuit: true };
    if (specifier === '@/components/amount-calculator')
      return {
        url: new URL('src/components/amount-calculator.tsx', root).href,
        shortCircuit: true,
      };
    if (specifier === '@/components/entry-choices')
      return { url: new URL('src/components/entry-choices.tsx', root).href, shortCircuit: true };
    if (specifier === '@/components/transfer-form')
      return { url: new URL('src/components/transfer-form.tsx', root).href, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const stem = specifier.replace('@/', 'src/');
      const path = existsSync(new URL(`${stem}/index.ts`, root))
        ? `${stem}/index.ts`
        : existsSync(new URL(`${stem}.ts`, root))
          ? `${stem}.ts`
          : `${stem}.tsx`;
      return { url: new URL(path, root).href, shortCircuit: true };
    }
    return next(
      specifier,
      context.parentURL?.startsWith('entry-mock:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('entry-mock:'))
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
const { default: Accounts } = await import('../app/(tabs)/accounts/index.tsx');
const { default: QuickAdd } = await import('../app/quick-add.tsx');
const { default: Transfer } = await import('../app/transfer.tsx');
const { createQueryClient } = await import('./query-client.ts');
let queryClient;
function EntryScreen({ Screen }) {
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(Screen),
  );
}
let renderer;
const nodes = (type) => renderer.root.findAllByType(type);
const button = (label) => nodes('FormButton').find((n) => n.props.label === label);
async function press(label) {
  await act(async () => button(label).props.onPress());
}
async function change(label, value, finalize = true) {
  if (label === 'Amount') {
    await act(async () =>
      nodes('Pressable')
        .find((n) => n.props.accessibilityLabel === 'Amount')
        .props.onPress(),
    );
    await act(async () =>
      renderer.root.find((n) => n.type?.name === 'AmountCalculator').props.onChange(value),
    );
    if (finalize)
      await act(async () =>
        renderer.root.find((n) => n.type?.name === 'AmountCalculator').props.onDone(),
      );
    return;
  }
  await act(async () =>
    [...nodes('FormInput'), ...nodes('TextInput')]
      .find((n) => n.props.accessibilityLabel === label)
      .props.onChangeText(value),
  );
}
async function chooseCategory(id) {
  await act(async () => nodes('Category')[0].props.onSelect(id));
}
async function mount(Screen) {
  Object.assign(state, {
    list: async () => [],
    save: async () => ({ status: 'saved', id: 1 }),
    back: false,
    alert: undefined,
    loadError: false,
    keyboardDismissed: false,
  });
  await act(async () => {
    queryClient = createQueryClient();
    queryClient.setDefaultOptions({
      queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity },
    });
    renderer = create(React.createElement(EntryScreen, { Screen }));
  });
}
const text = () =>
  nodes('Text')
    .map((n) => n.children.join(''))
    .join('\n');
test('Account entry screens', async (t) => {
  t.afterEach(async () => {
    if (renderer) await act(async () => renderer.unmount());
    renderer = undefined;
    queryClient?.clear();
    delete state.balances;
    delete state.params;
    for (const key of [
      'readAccounts',
      'readCategories',
      'readManaged',
      'readPeople',
      'readTotals',
      'createPerson',
    ])
      delete state[key];
  });
  t.after(() => {
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
    hooks.deregister();
    delete globalThis.__entryTest;
    if (previousActEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });
  await t.test('Accounts group headings use singular and plural counts', async () => {
    Object.assign(state, { save: async () => {}, back: false });
    state.list = async () => [
      { id: 1, name: 'Cash', currencyCode: 'BDT', openingBalanceMinor: 0, isFavorite: 1 },
      { id: 2, name: 'Bank', currencyCode: 'BDT', openingBalanceMinor: 0, isFavorite: 0 },
      { id: 3, name: 'Card', currencyCode: 'USD', openingBalanceMinor: 0, isFavorite: 0 },
    ];
    state.balances = [1, 2, 3].map((id) => ({ id, balanceMinor: 0 }));
    await act(async () => {
      renderer = create(React.createElement(Accounts));
    });
    assert.match(text(), /BDT · 2 accounts/);
    assert.match(text(), /USD · 1 account$/m);
  });
  await t.test(
    'Accounts Cancel closes without writing; negative opening balance stays editable',
    async () => {
      await mount(Accounts);
      await press('Add account');
      await change('Opening balance', '-20');
      assert.deepEqual(nodes('Sheet')[0].findByType('ScrollView').props.style, {
        width: 390,
        maxHeight: 844 * 0.82,
      });
      assert.equal(
        nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Opening balance').props
          .keyboardType,
        'numbers-and-punctuation',
      );
      state.save = () => assert.fail('Cancel must not write');
      await press('Cancel');
      assert.equal(nodes('Sheet').length, 0);
    },
  );
  await t.test(
    'Accounts pending blocks cancel and hardware dismissal; create error retains draft and permits retry',
    async () => {
      await mount(Accounts);
      await press('Add account');
      await change('Account name', 'Draft');
      let reject;
      state.save = () =>
        new Promise((_, no) => {
          reject = no;
        });
      await press('Create account');
      assert.equal(button('Cancel').props.disabled, true);
      await act(async () => nodes('Sheet')[0].props.onDismiss());
      assert.equal(nodes('Sheet').length, 1);
      await act(async () => reject(Error('Create failed')));
      assert.match(text(), /Create failed/);
      assert.equal(nodes('FormInput')[0].props.value, 'Draft');
      assert.equal(button('Cancel').props.disabled, false);
      state.save = async () => {};
      await press('Create account');
      assert.equal(nodes('Sheet').length, 0);
    },
  );
  await t.test(
    'Accounts committed create plus refetch failure retries loading, not creation',
    async () => {
      await mount(Accounts);
      await press('Add account');
      let saves = 0;
      state.save = async () => {
        saves++;
      };
      state.list = async () => {
        throw Error('Refetch failed');
      };
      await press('Create account');
      assert.equal(nodes('Sheet').length, 0);
      assert.match(text(), /Refetch failed/);
      state.list = async () => [];
      await press('Retry accounts');
      assert.equal(saves, 1);
      assert.doesNotMatch(text(), /Refetch failed/);
    },
  );
  await t.test('Quick add ranks after Done without selecting a Category', async () => {
    await mount(QuickAdd);
    state.readManaged = async () => [
      { id: 3, name: 'Food' },
      { id: 4, name: 'Travel' },
    ];
    state.evidence = [{ categoryId: 4, accountId: 1, amountMinor: 1200, day: 1 }];
    await act(async () => queryClient.invalidateQueries({ queryKey: ['quick-add', 'categories'] }));
    await change('Amount', '12', false);
    assert.equal(nodes('Category')[0].props.orderedIds, undefined);
    assert.deepEqual(
      nodes('Category')[0].props.categories.map((c) => c.id),
      [3, 4],
    );
    await act(async () =>
      nodes('Pressable')
        .find((n) => n.props.accessibilityLabel === 'Done')
        .props.onPress(),
    );
    assert.deepEqual(nodes('Category')[0].props.orderedIds, [4, 3]);
    assert.equal(nodes('Category')[0].props.selectedId, undefined);
    await chooseCategory(3);
    assert.equal(nodes('Category')[0].props.selectedId, 3);
    delete state.evidence;
  });
  await t.test(
    'Amount input commits a parsed value only when dismissed and clears invalid input',
    async () => {
      await mount(QuickAdd);
      await chooseCategory(3);
      await change('Amount', '10+2', false);
      assert.equal(button('Save').props.disabled, true);
      await act(async () =>
        renderer.root.find((n) => n.type?.name === 'AmountCalculator').props.onDone(),
      );
      assert.equal(button('Save').props.disabled, false);
      await change('Amount', '1/0');
      assert.equal(button('Save').props.disabled, true);
      assert.ok(
        nodes('Text').some((n) =>
          n.children.includes('Enter a positive amount with at most two decimal places.'),
        ),
      );
    },
  );
  await t.test(
    'Save cannot submit a previously committed amount while editing a new expression',
    async () => {
      await mount(QuickAdd);
      await chooseCategory(3);
      await change('Amount', '12');
      let saved;
      state.save = async (draft) => {
        saved = draft;
      };
      await change('Amount', '20', false);
      assert.equal(button('Save').props.disabled, true);
      await press('Save');
      assert.equal(saved, undefined);
      await act(async () =>
        renderer.root.find((n) => n.type?.name === 'AmountCalculator').props.onDone(),
      );
      await press('Save');
      assert.equal(saved.amountMinor, 2000);
    },
  );
  await t.test(
    'Quick add requires an explicit Category and saves the Home Account and draft values',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '12');
      assert.equal(nodes('Category')[0].props.selectedId, undefined);
      assert.equal(button('Save').props.disabled, true);
      await chooseCategory(3);
      assert.equal(button('Save').props.disabled, false);
      await change('Note', 'Lunch');
      await change('Tags, separated by commas', 'food');
      let saved;
      state.save = async (...args) => {
        saved = args;
      };
      await press('Save');
      assert.equal(saved[0].amountMinor, 1200);
      assert.equal(saved[0].accountId, 1);
      assert.equal(saved[0].categoryId, 3);
      assert.equal(saved[0].type, 'EXPENSE');
      assert.equal(saved[0].note, 'Lunch');
      assert.equal(saved[1], 'food');
      assert.equal(state.back, true);
      assert.equal(state.alert, undefined);
    },
  );
  await t.test(
    'Amount button uses only the docked keypad and Done resolves the calculation',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '12');
      const amountField = () =>
        nodes('Pressable').find((n) => n.props.accessibilityLabel === 'Amount');
      const key = async (label) => {
        await act(async () =>
          nodes('Pressable')
            .find((n) => n.props.accessibilityLabel === label)
            .props.onPress(),
        );
      };
      await act(async () => amountField().props.onPress());
      assert.equal(nodes('TextInput').length, 0);
      assert.equal(amountField().props.accessibilityRole, 'button');
      assert.equal(state.keyboardDismissed, true);
      await key('Add');
      assert.equal(
        nodes('Text').some((n) =>
          n.children.includes('Enter a positive amount with at most two decimal places.'),
        ),
        false,
      );
      await key('3');
      await key('Equals');
      await key('7');
      assert.equal(amountField().props.accessibilityValue.text, '7');
      await key('Done');
      assert.equal(amountField().props.accessibilityValue.text, '7.00');
      assert.equal(nodes('AnimatedView')[0].props.accessibilityElementsHidden, true);
      assert.equal(nodes('AnimatedView')[0].props.pointerEvents, 'none');
      await act(async () => amountField().props.onPress());
      await key('Clear calculation');
      await key('2');
      await key('Divide');
      await key('0');
      await key('Equals');
      assert.ok(nodes('Text').some((n) => n.children.includes('Cannot divide by zero.')));
      await key('Backspace');
      await key('2');
      await key('Done');
      assert.equal(amountField().props.accessibilityValue.text, '1.00');
      await act(async () => amountField().props.onPress());
      await key('Add');
      await key('2');
      await act(async () => nodes('ScrollView')[0].props.onScrollBeginDrag());
      assert.equal(amountField().props.accessibilityValue.text, '3.00');
      await act(async () => amountField().props.onPress());
      await key('Add');
      await key('4');
      await act(async () => assert.equal(state.backHandler(), true));
      assert.equal(amountField().props.accessibilityValue.text, '7.00');
      assert.equal(nodes('AnimatedView')[0].props.accessibilityElementsHidden, true);
      assert.equal(nodes('AnimatedView')[0].props.pointerEvents, 'none');
      assert.equal(state.backHandler, undefined);
    },
  );
  await t.test(
    'Home account context overrides favorite and remains editable in Quick Add',
    async () => {
      state.params = { accountId: '2' };
      await mount(QuickAdd);
      await change('Amount', '12');
      await chooseCategory(3);
      let selector = renderer.root.findAll((n) => n.type?.name === 'AccountChoices')[0];
      assert.equal(selector.props.selectedId, 2);
      await act(async () => selector.props.onSelect(4));
      let saved;
      state.save = async (draft) => {
        saved = draft;
      };
      await press('Save');
      assert.equal(saved.accountId, 4);
    },
  );
  await t.test(
    'A missing Home Account requires a valid Account choice instead of a favorite fallback',
    async () => {
      state.params = { accountId: '99' };
      await mount(QuickAdd);
      const choices = renderer.root.findAll((n) => n.type?.name === 'AccountChoices')[0];
      assert.equal(choices.props.selectedId, 99);
      await change('Amount', '12');
      await chooseCategory(3);
      assert.equal(button('Save').props.disabled, true);
      await act(async () => choices.props.onSelect(2));
      assert.equal(button('Save').props.disabled, false);
    },
  );
  await t.test(
    'Quick Add from All accounts starts with no Account or Category selected',
    async () => {
      state.params = {};
      await mount(QuickAdd);
      const choices = renderer.root.findAll((n) => n.type?.name === 'AccountChoices')[0];
      assert.equal(choices.props.selectedId, undefined);
      assert.equal(nodes('Category')[0].props.selectedId, undefined);
      await change('Amount', '12');
      await chooseCategory(3);
      assert.equal(button('Save').props.disabled, true);
      await act(async () => choices.props.onSelect(1));
      assert.equal(button('Save').props.disabled, false);
    },
  );
  await t.test(
    'Transfer destination selection enables shared save and preserves account direction',
    async () => {
      await mount(Transfer);
      await change('Transfer amount', '7');
      assert.equal(button('Save transfer').props.disabled, true);
      await act(async () =>
        nodes('Pressable')
          .find((n) => n.props.accessibilityLabel?.startsWith('To account:'))
          .props.onPress(),
      );
      await act(async () =>
        nodes('NativeButton')
          .find((n) => n.props.label.startsWith('Bank'))
          .props.onPress(),
      );
      assert.equal(button('Save transfer').props.disabled, false);
      let saved;
      state.save = async (x) => {
        saved = x;
      };
      await press('Save transfer');
      assert.deepEqual(saved, { amountMinor: 700, fromAccountId: 1, toAccountId: 2, note: '' });
      assert.equal(state.back, true);
    },
  );
  await t.test(
    'Quick add transfer selects accounts inline, restricts currency, and saves date and tags',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '8.25');
      await act(async () => nodes('JoinedChoice')[0].props.onChange('TRANSFER'));
      let selectors = renderer.root.findAll((n) => n.type?.name === 'AccountChoices');
      assert.deepEqual(
        selectors[1].props.accounts.map((a) => a.id),
        [2],
      );
      await act(async () => selectors[1].props.onSelect(2));
      await change('Tags, separated by commas', 'move');
      const date = new Date(2020, 0, 1);
      await act(async () => nodes('Date')[0].props.onChange(date));
      let saved;
      state.save = async (x) => {
        saved = x;
      };
      await press('Save transfer');
      assert.equal(saved.amountMinor, 825);
      assert.equal(saved.fromAccountId, 1);
      assert.equal(saved.toAccountId, 2);
      assert.equal(saved.tagText, 'move');
      assert.equal(saved.date, date);
      assert.equal(state.back, true);
      assert.equal(state.alert, undefined);
      selectors = renderer.root.findAll((n) => n.type?.name === 'AccountChoices');
      await act(async () => selectors[0].props.onSelect(4));
      selectors = renderer.root.findAll((n) => n.type?.name === 'AccountChoices');
      assert.deepEqual(selectors[1].props.accounts, []);
      assert.equal(button('Save transfer').props.disabled, true);
    },
  );
  await t.test(
    'Quick add save failure retains draft and prevents duplicate pending submissions',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '12');
      await chooseCategory(3);
      await change('Note', 'Draft');
      let reject;
      let saves = 0;
      state.save = () => {
        saves++;
        return new Promise((_, no) => {
          reject = no;
        });
      };
      await press('Save');
      await press('Save');
      assert.equal(saves, 1);
      assert.equal(button('Save').props.loading, true);
      assert.equal(state.removal.enabled, true);
      state.dispatched = undefined;
      state.removal.callback({ data: { action: { type: 'GO_BACK' } } });
      assert.equal(state.dispatched, undefined);
      await act(async () => reject(Error('Save failed')));
      assert.match(text(), /Save failed/);
      assert.equal(state.back, false);
      assert.equal(
        nodes('Pressable').find((n) => n.props.accessibilityLabel === 'Amount').props
          .accessibilityValue.text,
        '12.00',
      );
      assert.equal(
        nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Note').props.value,
        'Draft',
      );
      state.save = async () => {};
      await press('Save');
      assert.equal(state.back, true);
      assert.equal(state.alert, undefined);
    },
  );
  await t.test(
    'Quick add repayment cancel retains draft and confirm resubmits the same entry',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '10');
      await act(async () => nodes('JoinedChoice')[0].props.onChange('PERSON'));
      await act(async () =>
        nodes('Pressable')
          .find((n) => n.props.accessibilityLabel === 'Rafi')
          .props.onPress(),
      );
      await act(async () => nodes('JoinedChoice')[2].props.onChange('RECEIVE_REPAYMENT'));
      const drafts = [];
      state.save = async (draft) => {
        drafts.push(draft);
        return draft.confirmOverpayment
          ? { status: 'saved', id: 1 }
          : {
              status: 'confirmation_required',
              warnings: [{ currencyCode: 'USD', direction: 'LENT', overpaidMinor: 1000 }],
            };
      };
      await press('Save repayment received');
      assert.equal(state.alert[0], 'Overpayment warning');
      assert.equal(state.back, false);
      await act(async () => state.alert[2][0].onPress());
      assert.equal(drafts.length, 1);
      assert.equal(button('Save repayment received').props.loading, false);
      await press('Save repayment received');
      await act(async () => state.alert[2][1].onPress());
      assert.deepEqual(drafts[2], { ...drafts[0], confirmOverpayment: true });
      assert.equal(state.back, true);
    },
  );
  await t.test('Quick add draft stays editable while independent choices load', async () => {
    let resolveAccounts, resolveManaged;
    let peopleReads = 0;
    state.readAccounts = () =>
      new Promise((resolve) => {
        resolveAccounts = resolve;
      });
    state.readManaged = () =>
      new Promise((resolve) => {
        resolveManaged = resolve;
      });
    state.readPeople = () => {
      peopleReads++;
      return [];
    };
    await mount(QuickAdd);
    assert.equal(typeof resolveAccounts, 'function');
    assert.equal(typeof resolveManaged, 'function');
    assert.equal(peopleReads, 0);
    await change('Amount', '12');
    await change('Note', 'Draft during load');
    assert.equal(button('Save').props.disabled, true);
    const noteInput = nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Note');
    await act(async () => {
      resolveManaged([{ id: 3, name: 'Food', type: 'EXPENSE' }]);
    });
    assert.equal(nodes('Category').length, 1);
    assert.equal(button('Save').props.disabled, true);
    await act(async () =>
      resolveAccounts([{ id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 }]),
    );
    assert.equal(nodes('Category')[0].props.selectedId, undefined);
    assert.equal(button('Save').props.disabled, true);
    await chooseCategory(3);
    assert.equal(button('Save').props.disabled, false);
    assert.equal(
      nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Note'),
      noteInput,
    );
    assert.equal(noteInput.props.value, 'Draft during load');
    let saved;
    state.save = async (draft) => {
      saved = draft;
    };
    await press('Save');
    assert.equal(saved.amountMinor, 1200);
    assert.equal(saved.note, 'Draft during load');
  });
  await t.test('A pending mode cannot supply save prerequisites to a different mode', async () => {
    let resolveExpense;
    state.readManaged = (type) =>
      type === 'EXPENSE'
        ? new Promise((resolve) => {
            resolveExpense = resolve;
          })
        : [{ id: 5, name: 'Salary' }];
    await mount(QuickAdd);
    await change('Amount', '9');
    await act(async () => nodes('JoinedChoice')[0].props.onChange('INCOME'));
    assert.equal(nodes('Category')[0].props.selectedId, undefined);
    assert.equal(button('Save').props.disabled, true);
    await chooseCategory(5);
    assert.equal(button('Save').props.disabled, false);
    await act(async () => resolveExpense([{ id: 3, name: 'Food' }]));
    assert.equal(nodes('Category')[0].props.selectedId, 5);
    let saved;
    state.save = async (draft) => {
      saved = draft;
    };
    await press('Save');
    assert.equal(saved.type, 'INCOME');
    assert.equal(saved.categoryId, 5);
    await act(async () => nodes('JoinedChoice')[0].props.onChange('EXPENSE'));
    assert.equal(nodes('Category')[0].props.selectedId, undefined);
    assert.equal(button('Save').props.disabled, true);
    await chooseCategory(3);
    await act(async () => nodes('Category')[0].props.onSelect(99));
    await act(async () => nodes('JoinedChoice')[0].props.onChange('INCOME'));
    await act(async () => nodes('JoinedChoice')[0].props.onChange('EXPENSE'));
    assert.equal(nodes('Category')[0].props.selectedId, 99);
    assert.equal(button('Save').props.disabled, true);
  });
  await t.test(
    'Mode failures recover locally on retry, including returning to a failed mode',
    async () => {
      let fail = true;
      let accountReads = 0;
      state.readAccounts = async () => {
        accountReads++;
        return [{ id: 1, name: 'Cash', currencyCode: 'USD', isFavorite: 1 }];
      };
      state.readPeople = async () => {
        if (fail) throw Error('People unavailable');
        return [{ id: 1, name: 'Rafi' }];
      };
      await mount(QuickAdd);
      await change('Amount', '10');
      await chooseCategory(3);
      await change('Note', 'Keep me');
      await act(async () => nodes('JoinedChoice')[0].props.onChange('PERSON'));
      assert.ok(button('Retry people'));
      assert.equal(button('Save lending').props.disabled, true);
      await change('Search people', 'Ra');
      await act(async () => nodes('JoinedChoice')[0].props.onChange('EXPENSE'));
      assert.equal(button('Save').props.disabled, false);
      fail = false;
      await act(async () => nodes('JoinedChoice')[0].props.onChange('PERSON'));
      await press('Retry people');
      assert.equal(button('Retry people'), undefined);
      await act(async () =>
        nodes('Pressable')
          .find((n) => n.props.accessibilityLabel === 'Rafi')
          .props.onPress(),
      );
      assert.equal(button('Save lending').props.disabled, false);
      assert.equal(
        nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Note').props.value,
        'Keep me',
      );
      assert.equal(
        nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Search people').props.value,
        'Ra',
      );
      assert.equal(accountReads, 1);
    },
  );
  await t.test(
    'Failed cached refresh preserves draft and selections; deleted targets disable Save',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '12');
      await chooseCategory(3);
      await change('Note', 'Keep cached');
      const choices = renderer.root.findAll((n) => n.type?.name === 'AccountChoices')[0];
      state.readAccounts = async () => {
        throw Error('Refresh failed');
      };
      const { invalidateQuickAdd } = await import('../features/quick-add/index.ts');
      await act(async () => {
        await invalidateQuickAdd(queryClient);
      });
      assert.ok(button('Retry accounts'));
      assert.equal(button('Save').props.disabled, false);
      assert.equal(renderer.root.findAll((n) => n.type?.name === 'AccountChoices')[0], choices);
      assert.equal(choices.props.selectedId, 1);
      assert.equal(
        nodes('FormInput').find((n) => n.props.accessibilityLabel === 'Note').props.value,
        'Keep cached',
      );
      state.readAccounts = async () => [
        { id: 2, name: 'Bank', currencyCode: 'USD', isFavorite: 1 },
      ];
      await press('Retry accounts');
      assert.equal(button('Retry accounts'), undefined);
      assert.equal(choices.props.selectedId, 1);
      assert.equal(button('Save').props.disabled, true);
      await act(async () => choices.props.onSelect(2));
      assert.equal(button('Save').props.disabled, false);
    },
  );
  await t.test(
    'Creating a person updates query choices and selects them without losing the draft',
    async () => {
      await mount(QuickAdd);
      await change('Amount', '8');
      await change('Note', 'Person draft');
      await act(async () => nodes('JoinedChoice')[0].props.onChange('PERSON'));
      await change('Search people', 'New person');
      let finish,
        creates = 0;
      state.createPerson = () => {
        creates++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      await press('Add “New person”');
      await press('Add “New person”');
      assert.equal(creates, 1);
      assert.equal(state.removal.enabled, true);
      await act(async () => finish({ id: 2, name: 'New person' }));
      assert.ok(
        nodes('Pressable').find((n) => n.props.accessibilityLabel === 'New person').props
          .accessibilityState.selected,
      );
      assert.equal(button('Save lending').props.disabled, false);
      let saved;
      state.save = async (draft) => {
        saved = draft;
        return { status: 'saved' };
      };
      await press('Save lending');
      assert.equal(saved.personId, 2);
      assert.equal(saved.note, 'Person draft');
    },
  );
  await t.test(
    'Quick add loading failure can be retried without showing sample accounts',
    async () => {
      state.loadError = true;
      await act(async () => {
        queryClient = createQueryClient();
        renderer = create(React.createElement(EntryScreen, { Screen: QuickAdd }));
      });
      assert.match(text(), /Could not load accounts/);
      assert.equal(button('Save').props.disabled, true);
      state.loadError = false;
      await press('Retry accounts');
      assert.ok(button('Save'));
    },
  );
});
