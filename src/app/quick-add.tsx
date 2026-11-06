import { useCallback, useEffect, useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { epochDay, listAccounts, listCategories, type Account, type Category } from '@/lib/database';
import { listManagedCategories, type ManagedCategory } from '@/lib/categories';
import { addQuickTransaction } from '@/lib/quick-add-tags';
import { addTransfer, transferAmountMinor } from '@/lib/transfers';
import { createPerson, listLendingTotals, listPeople, saveLendingEntry, type LendingKind, type LendingTotal, type Person } from '@/lib/lending';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calculateAmount } from '@/lib/amount-calculator';
import { AmountCalculator } from '@/components/amount-calculator';
import { QuickAddDate } from '@/components/quick-add-date';
import { QuickAddCategory } from '@/components/quick-add-category';
import { AccountChoices, personBalanceSummary } from '@/components/entry-choices';
import { FormButton, FormInput, JoinedChoice } from '@/components/form-controls';
import { parseAccountId, resolveHomeAccount } from '@/lib/account-selection';
import { theme } from '@/theme';

const c = theme.colors;
type Mode = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'PERSON';
type PersonAction = Extract<LendingKind, 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY'>;
const modes = [{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }, { value: 'TRANSFER', label: 'Transfer' }, { value: 'PERSON', label: 'Person' }] as const;
const principalActions = [{ value: 'LEND', label: 'Lend' }, { value: 'BORROW', label: 'Borrow' }] as const;
const repaymentActions = [{ value: 'RECEIVE_REPAYMENT', label: 'They paid back' }, { value: 'REPAY', label: 'I paid back' }] as const;
type EntryData = { accounts: Account[]; expense: Category[]; income: Category[]; categories: ManagedCategory[]; people: Person[]; totals: LendingTotal[] };

function Label({ children }: { children: string }) {
  return <Text style={{ color: c.muted, fontSize: 12 }}>{children}</Text>;
}

function CancelAction({ disabled = false }: { disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Cancel" accessibilityState={{ disabled }} disabled={disabled} onPress={() => router.back()} style={{ minHeight: 48, paddingHorizontal: 8, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}><Text style={{ color: c.accent, fontSize: 16 }}>Cancel</Text></Pressable>;
}

function confirmOverpayment(warnings: LendingTotal[]): Promise<boolean> {
  return new Promise((resolve) => Alert.alert('Overpayment warning', warnings.map((warning) =>
    `${warning.currencyCode} · ${warning.direction === 'LENT' ? 'They owe you' : 'You owe them'}: overpaid credit ${(warning.overpaidMinor / 100).toFixed(2)}`,
  ).join('\n') + '\nSave anyway? Excess remains visible as credit, not an opposite obligation.', [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: 'Confirm', onPress: () => resolve(true) },
  ], { cancelable: false }));
}

export default function QuickAdd() {
  const [data, setData] = useState<EntryData>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([listAccounts(), listCategories('EXPENSE'), listCategories('INCOME'), listManagedCategories(), listPeople(), listLendingTotals()])
      .then(([accounts, expense, income, categories, people, totals]) => {
        if (active) { setError(''); setData({ accounts, expense, income, categories, people, totals }); }
      })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [retry]);
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <Stack.Screen options={{ title: 'Add', headerTitleAlign: 'center', headerStyle: { backgroundColor: c.background }, headerTintColor: c.text,
      headerLeft: () => <CancelAction /> }} />
    {data ? <QuickAddForm data={data} /> : error ? <View style={{ padding: 22, gap: 16 }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>{error}</Text>
      <FormButton label="Reload data" onPress={() => { setError(''); setRetry((value) => value + 1); }} />
    </View> : <ActivityIndicator accessibilityLabel="Loading entry data" color={c.accent} style={{ padding: 22 }} />}
  </View>;
}

function QuickAddForm({ data }: { data: EntryData }) {
  const params = useLocalSearchParams<{ accountId?: string }>();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const amountInput = useRef<TextInput>(null);
  const [mode, setMode] = useState<Mode>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const dismissCalculator = useCallback(() => {
    try { if (amount) setAmount(calculateAmount(amount)); } catch {}
    setCalculatorOpen(false);
    amountInput.current?.blur();
  }, [amount]);
  useEffect(() => {
    if (!calculatorOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissCalculator();
      return true;
    });
    return () => subscription.remove();
  }, [calculatorOpen, dismissCalculator]);
  const [accountId, setAccountId] = useState(resolveHomeAccount(data.accounts, parseAccountId(params.accountId)) ?? data.accounts[0]?.id);
  const [toId, setToId] = useState<number>();
  const [categoryIds, setCategoryIds] = useState({ EXPENSE: data.expense[0]?.id, INCOME: data.income[0]?.id });
  const [people, setPeople] = useState(data.people);
  const [personId, setPersonId] = useState<number>();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<PersonAction>('LEND');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const navigation = useNavigation();
  usePreventRemove(pending, ({ data: removal }) => {
    if (!busy.current) navigation.dispatch(removal.action);
  });
  const account = data.accounts.find((item) => item.id === accountId);
  const person = people.find((item) => item.id === personId);
  const categoryMode = mode === 'EXPENSE' || mode === 'INCOME' ? mode : undefined;
  const categories = categoryMode === 'INCOME' ? data.income : data.expense;
  const destinations = data.accounts.filter((item) => item.id !== accountId && item.currencyCode === account?.currencyCode);
  const incoming = mode === 'INCOME' || (mode === 'PERSON' && (action === 'BORROW' || action === 'RECEIVE_REPAYMENT'));
  const search = query.trim().toLocaleLowerCase();
  const matches = people.filter((item) => item.name.toLocaleLowerCase().includes(search));
  const canCreatePerson = !!search && !people.some((item) => item.name.toLocaleLowerCase() === search);
  let validAmount = false;
  try { transferAmountMinor(calculateAmount(amount)); validAmount = true; } catch {}
  const canSave = validAmount && !!account && (mode === 'TRANSFER' ? destinations.some((item) => item.id === toId)
    : mode === 'PERSON' ? !!person : !!categoryMode && categories.some((item) => item.id === categoryIds[categoryMode]));
  const saveLabel = mode === 'PERSON' ? ({ LEND: 'Save lending', BORROW: 'Save borrowing', RECEIVE_REPAYMENT: 'Save repayment received', REPAY: 'Save repayment made' }[action]) : mode === 'TRANSFER' ? 'Save transfer' : 'Save';

  async function addPerson() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try {
      const created = await createPerson(query);
      setPeople((items) => [...items, created].sort((a, b) => a.name.localeCompare(b.name)));
      setPersonId(created.id); setQuery('');
    } catch (cause) { setError(String(cause)); }
    finally { busy.current = false; setPending(false); }
  }

  async function save() {
    if (busy.current || !canSave || !account) return;
    busy.current = true; setPending(true); setError('');
    try {
      const amountMinor = transferAmountMinor(calculateAmount(amount));
      if (!Number.isFinite(date.getTime()) || epochDay(date) > epochDay(new Date())) throw new Error('Choose today or a past date.');
      if (mode === 'TRANSFER') {
        await addTransfer({ amountMinor, fromAccountId: account.id, toAccountId: toId!, note, date, tagText: tags });
      } else if (mode === 'PERSON') {
        const draft = { personId: person!.id, kind: action, amountMinor, accountId: account.id, date: epochDay(date), note, tagText: tags };
        const result = await saveLendingEntry(draft);
        if (result.status === 'confirmation_required') {
          if (!(await confirmOverpayment(result.warnings))) return;
          await saveLendingEntry({ ...draft, confirmOverpayment: true });
        }
      } else {
        await addQuickTransaction({ type: mode, amountMinor, accountId: account.id, categoryId: categoryIds[mode]!, date, note: note.trim() || null }, tags);
      }
      busy.current = false;
      router.back();
    } catch (cause) { setError(String(cause)); }
    finally { busy.current = false; setPending(false); }
  }

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
    <Stack.Screen options={{ headerLeft: () => <CancelAction disabled={pending} />, gestureEnabled: !pending }} />
    <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => { if (calculatorOpen) dismissCalculator(); }} contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 48 }}>
      <View style={{ gap: 6 }}><Label>{`Amount · ${account?.currencyCode ?? 'Select account'}`}</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }}>
          <Text style={{ color: c.text, fontSize: 48, fontWeight: '300' }}>{account?.currencyCode === 'BDT' ? '৳' : account?.currencyCode === 'USD' ? '$' : ''}</Text>
          <TextInput ref={amountInput} accessibilityLabel="Amount" autoFocus editable={!pending} showSoftInputOnFocus={false} caretHidden onBlur={() => { if (calculatorOpen) dismissCalculator(); }} onFocus={() => setCalculatorOpen(true)} onPressIn={() => { if (!pending) setCalculatorOpen(true); }} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.muted} value={amount} onChangeText={setAmount} style={{ flex: 1, color: c.text, fontSize: 48, fontWeight: '300', fontVariant: ['tabular-nums'] }} />
        </View>
        {!!amount && !validAmount && <Text accessibilityRole="alert" style={{ color: c.warning }}>Enter a positive amount with at most two decimal places.</Text>}
      </View>
      <View style={{ gap: 18 }} onTouchStart={() => { if (calculatorOpen) dismissCalculator(); }}>
      <JoinedChoice value={mode} options={modes} disabled={pending} onChange={(value) => { setMode(value); setError(''); }} />
      <View style={{ gap: 10 }}>
        <Label>{`${incoming ? 'Into' : 'From'} ${account?.name ?? 'an account'}`}</Label>
        <AccountChoices accounts={data.accounts} selectedId={accountId} disabled={pending} onSelect={(id) => { setAccountId(id); setToId(undefined); setError(''); }} />
        {!data.accounts.length && <Text style={{ color: c.muted }}>Create an account in the Accounts tab before adding a transaction.</Text>}
      </View>
      {mode === 'TRANSFER' && <View style={{ gap: 10 }}>
        <Label>{`To ${destinations.find((item) => item.id === toId)?.name ?? 'another account'}`}</Label>
        <AccountChoices accounts={destinations} selectedId={toId} disabled={pending} onSelect={setToId} />
        {!destinations.length && <Text style={{ color: c.muted }}>No other {account?.currencyCode ?? 'same-currency'} account. Create one in Accounts or choose a different source.</Text>}
      </View>}
      {mode === 'PERSON' && <>
        <View style={{ gap: 10 }}>
          <Label>{`With ${person?.name ?? 'a person'}`}</Label>
          <FormInput accessibilityLabel="Search people" placeholder="Find or add a person" value={query} onChangeText={setQuery} editable={!pending} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {matches.map((item) => {
              const selected = item.id === personId;
              return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.name} accessibilityState={{ selected, disabled: pending }} disabled={pending} onPress={() => setPersonId(item.id)} style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 8, minHeight: 48, maxWidth: '100%', borderRadius: 14, backgroundColor: selected ? c.selected : c.surface, opacity: pending ? 0.45 : pressed ? 0.7 : 1, gap: 4 })}>
                <Text style={{ color: c.text, fontSize: 15, fontWeight: selected ? '700' : '500' }}>{item.name}</Text>
                <Text style={{ color: selected ? c.onSelected : c.muted, fontSize: 12 }}>{personBalanceSummary(data.totals, item.id, account?.currencyCode ?? '')}</Text>
              </Pressable>;
            })}
          </View>
          {!matches.length && <Text style={{ color: c.muted }}>{search ? 'No matching people.' : 'No saved people. Enter a name to add one.'}</Text>}
          {canCreatePerson && <FormButton label={`Add “${query.trim()}”`} variant="secondary" disabled={pending} onPress={() => void addPerson()} />}
        </View>
        <View style={{ gap: 10 }}><Label>What happened</Label>
          <JoinedChoice<PersonAction> value={action} options={principalActions} disabled={pending} onChange={setAction} />
          <JoinedChoice<PersonAction> value={action} options={repaymentActions} disabled={pending} onChange={setAction} />
        </View>
        <Text style={{ color: c.muted }}>{incoming ? 'Money into' : 'Money out of'} {account?.name ?? 'the selected account'}. Excluded from spending reports. Recorded person balances may be incomplete.</Text>
      </>}
      {categoryMode && <QuickAddCategory key={categoryMode} categories={data.categories.filter((item) => item.type === categoryMode)} orderedIds={categories.map((item) => item.id)} selectedId={categoryIds[categoryMode]} disabled={pending} onSelect={(id) => setCategoryIds((ids) => ({ ...ids, [categoryMode]: id }))} />}
      {categoryMode && !categories.length && <Text style={{ color: c.muted }}>Create an {categoryMode === 'EXPENSE' ? 'expense' : 'income'} category in Settings before saving.</Text>}
      <View style={{ gap: 12 }}><Label>Note · optional</Label><FormInput accessibilityLabel="Note" placeholder="Add a note" value={note} onChangeText={setNote} editable={!pending} />
        <Label>Tags · optional</Label><FormInput accessibilityLabel="Tags, separated by commas" placeholder="Comma-separated tags" value={tags} onChangeText={setTags} editable={!pending} />
        <QuickAddDate value={date} onChange={setDate} disabled={pending} />
      </View>
      {!!error && <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>{error}</Text>}
      <FormButton label={saveLabel} loading={pending} disabled={!canSave} onPress={() => void save()} />
      </View>
    </ScrollView>
    {calculatorOpen && <View style={{ backgroundColor: c.surface, paddingBottom: insets.bottom }}>
      <AmountCalculator value={amount} onChange={setAmount} onDone={dismissCalculator} />
    </View>}
  </KeyboardAvoidingView>;
}
