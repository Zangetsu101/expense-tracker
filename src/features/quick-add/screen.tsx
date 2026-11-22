import { useCallback, useOptimistic, useRef, useState, useTransition } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categoriesQuery, peopleQuery, includeCreatedPerson } from './queries.ts';
import { accountsQuery } from '@/lib/account-queries';
import { ChoicesSection, layoutTransition } from './view.tsx';
import { ExpenseLink, type LinkableExpense } from './expense-link';
import { SplitExpense, type SplitDraft } from './split-expense';
import { splitShares } from '@/lib/reimbursements';
import { TransferBillChoices } from './transfer-bill-choices.tsx';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import {
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { epochDay } from '@/lib/database';
import { addQuickTransaction } from '@/lib/quick-add-tags';
import { addTransfer } from '@/lib/transfers';
import { createPerson, saveLendingEntry, type LendingKind, type Person } from '@/lib/lending';
import type { LendingTotal } from '@/lib/lending-totals';
import { TransferAmountInput } from '@/components/transfer-amount-input';
import { ControlledAmountInput, useAmountInputDraft } from '@/components/amount-input';
import { useRankedCategories } from './use-ranked-categories.ts';
import { QuickAddDate } from '@/components/quick-add-date';
import { QuickSelectCategory } from '@/components/quick-select-category';
import { AccountChoices, ChoiceChip, personBalanceSummary } from '@/components/entry-choices';
import { FormButton, FormInput, JoinedChoice } from '@/components/form-controls';
import { parseRouteId } from '@/lib/account-selection';
import { useClippedChips } from '@/components/use-clipped-chips';
import { theme } from '@/theme';

const AnimatedFormButton = Animated.createAnimatedComponent(FormButton);
const c = theme.colors;
type Mode = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'PERSON';
type PersonAction = Extract<LendingKind, 'LEND' | 'BORROW' | 'RECEIVE_REPAYMENT' | 'REPAY'>;
const modes = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'PERSON', label: 'Person' },
] as const;
const principalActions = [
  { value: 'LEND', label: 'Lend' },
  { value: 'BORROW', label: 'Borrow' },
] as const;
const repaymentActions = [
  { value: 'RECEIVE_REPAYMENT', label: 'They paid back' },
  { value: 'REPAY', label: 'I paid back' },
] as const;

function Label({ children }: { children: string }) {
  return <Text style={{ color: c.muted, fontSize: 12 }}>{children}</Text>;
}

function CancelAction({ disabled = false }: { disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Cancel"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => router.back()}
      style={{
        minHeight: 48,
        paddingHorizontal: 8,
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ color: c.accent, fontSize: 16 }}>Cancel</Text>
    </Pressable>
  );
}

function confirmOverpayment(warnings: LendingTotal[]): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      'Overpayment warning',
      warnings
        .map(
          (warning) =>
            `${warning.currencyCode} · ${warning.direction === 'LENT' ? 'They owe you' : 'You owe them'}: overpaid credit ${(warning.overpaidMinor / 100).toFixed(2)}`,
        )
        .join('\n') +
        '\nSave anyway? Excess remains visible as credit, not an opposite obligation.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    ),
  );
}

export default function QuickAdd() {
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen
        options={{
          title: 'Add',
          headerTitleAlign: 'center',
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.text,
          headerLeft: () => <CancelAction />,
        }}
      />
      <QuickAddForm />
    </View>
  );
}

function QuickAddForm() {
  const client = useQueryClient();
  const accountsRead = useQuery({ ...accountsQuery(), enabled: false });
  const params = useLocalSearchParams<{
    accountId?: string;
    mode?: string;
    personId?: string;
    action?: string;
    currency?: string;
    toId?: string;
    amountMinor?: string;
  }>();
  const initialAction = [...principalActions, ...repaymentActions].find(
    (option) => option.value === params.action,
  )?.value;
  const [mode, setMode] = useState<Mode>(() =>
    params.mode === 'PERSON' ? 'PERSON' : params.mode === 'TRANSFER' ? 'TRANSFER' : 'EXPENSE',
  );
  const [preset, setPreset] = useState(() => {
    const amount = Number(params.amountMinor);
    return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
  });
  const amountDraft = useAmountInputDraft(
    preset === undefined ? '' : (preset / 100).toFixed(2),
    preset === undefined,
  );
  const [transferPresetRevision, setTransferPresetRevision] = useState(0);
  const categoryMode = mode === 'EXPENSE' || mode === 'INCOME' ? mode : undefined;
  const categoryRead = useQuery({ ...categoriesQuery(categoryMode ?? 'EXPENSE'), enabled: false });
  const peopleRead = useQuery({ ...peopleQuery(), enabled: false });
  const accounts = accountsRead.data ?? [];
  const categories = categoryRead.data ?? [];
  const people = peopleRead.data?.people ?? [];
  const headerHeight = useHeaderHeight();
  const [amountMinor, setAmountMinor] = useState<number | undefined>(preset);
  const [receivedAmountMinor, setReceivedAmountMinor] = useState<number>();
  const onTransferAmounts = useCallback((paid: number | undefined, received?: number) => {
    setAmountMinor(paid);
    setReceivedAmountMinor(received);
  }, []);
  const [accountId, setAccountId] = useState(() => parseRouteId(params.accountId));
  const [toId, setToId] = useState<number | undefined>(
    () => parseRouteId(params.toId) ?? undefined,
  );
  const [categoryIds, setCategoryIds] = useState<{
    EXPENSE?: number;
    INCOME?: number;
  }>({});
  const routePersonId = parseRouteId(params.personId);
  const [personId, setPersonId] = useState(routePersonId);
  const [query, setQuery] = useState('');
  const { fontScale } = useWindowDimensions();
  const personChipHeight = 20 + 36 * fontScale;
  const peopleMaxHeight = personChipHeight * 2 + 8;
  const peopleClipping = useClippedChips(peopleMaxHeight);
  const [action, setAction] = useState<PersonAction>(() => initialAction ?? 'LEND');
  const [split, setSplit] = useState<SplitDraft>({ people: [], fixed: {} });
  const [linked, setLinked] = useState<LinkableExpense | null>(null);
  const [payer, setPayer] = useState<number | null>();
  const reimbursement = mode === 'INCOME' ? linked : null;
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [creatingPerson, startCreatingPerson] = useTransition();
  const [optimisticPersonName, setOptimisticPersonName] = useOptimistic<string | null>(null);
  const pending = saving || creatingPerson;
  const [error, setError] = useState('');
  // A second press can arrive before React renders the pending state.
  const writeInFlight = useRef(false);
  const navigation = useNavigation();
  usePreventRemove(pending, ({ data: removal }) => {
    if (!writeInFlight.current) navigation.dispatch(removal.action);
  });
  const currency =
    mode === 'PERSON' && action === initialAction && personId === routePersonId
      ? params.currency
      : undefined;
  const accountCurrency = reimbursement?.row.currencyCode ?? currency;
  const account = accounts.find(
    (item) => item.id === accountId && (!accountCurrency || item.currencyCode === accountCurrency),
  );
  const person = people.find((item) => item.id === personId);
  const orderedCategoryIds = useRankedCategories(
    categoryRead.data,
    categoryMode,
    account,
    amountMinor,
    epochDay(date),
  );
  const destinations = accounts.filter((item) => item.id !== accountId);
  const incoming =
    mode === 'INCOME' ||
    (mode === 'PERSON' && (action === 'BORROW' || action === 'RECEIVE_REPAYMENT'));
  const search = query.trim().toLocaleLowerCase();
  const matches = people.filter((item) => item.name.toLocaleLowerCase().includes(search));
  const canCreatePerson =
    !!search && !people.some((item) => item.name.toLocaleLowerCase() === search);
  const destination = destinations.find((item) => item.id === toId);
  const cross =
    mode === 'TRANSFER' && destination && destination.currencyCode !== account?.currencyCode;
  const validAmount =
    amountMinor !== undefined && amountMinor > 0 && (!cross || receivedAmountMinor !== undefined);
  let selectionReady = false;
  let saveLabel: string;
  switch (mode) {
    case 'TRANSFER':
      selectionReady = !!destination;
      saveLabel = 'Save transfer';
      break;
    case 'PERSON':
      selectionReady = !!person;
      saveLabel = {
        LEND: 'Save lending',
        BORROW: 'Save borrowing',
        RECEIVE_REPAYMENT: 'Save repayment received',
        REPAY: 'Save repayment made',
      }[action];
      break;
    case 'INCOME':
    case 'EXPENSE':
      selectionReady = reimbursement
        ? payer !== undefined
        : categories.some((item) => item.id === categoryIds[mode]);
      saveLabel = mode === 'EXPENSE' ? 'Save expense' : 'Save income';
      if (reimbursement) saveLabel = 'Save reimbursement';
      break;
  }
  const canSave = validAmount && !!account && selectionReady;

  function addPerson(name: string, onCreated: (person: Person) => void) {
    if (writeInFlight.current) return;
    writeInFlight.current = true;
    setError('');
    startCreatingPerson(async () => {
      setOptimisticPersonName(name.trim());
      try {
        const created = await createPerson(name);
        includeCreatedPerson(client, created);
        onCreated(created);
      } catch (cause) {
        setError(String(cause));
      } finally {
        writeInFlight.current = false;
      }
    });
  }

  function selectPayer(id: number | null | undefined, left?: number) {
    setPayer(id);
    if (left === undefined) return;
    amountDraft.reset((left / 100).toFixed(2), false);
    setAmountMinor(left || undefined);
  }

  function selectExpense(expense: LinkableExpense) {
    setLinked(expense);
    if (account && account.currencyCode !== expense.row.currencyCode) setAccountId(undefined);
    const owing = expense.shares.filter((share) => share.leftMinor > 0);
    if (owing.length === 1) selectPayer(owing[0].personId, owing[0].leftMinor);
    else selectPayer(expense.shares.length ? undefined : null);
    setError('');
  }

  async function save() {
    if (writeInFlight.current || !canSave || !account || amountMinor === undefined) return;
    writeInFlight.current = true;
    setSaving(true);
    setError('');
    try {
      if (!Number.isFinite(date.getTime()) || epochDay(date) > epochDay(new Date()))
        throw new Error('Choose today or a past date.');
      if (mode === 'TRANSFER') {
        await addTransfer({
          amountMinor,
          receivedAmountMinor,
          fromAccountId: account.id,
          toAccountId: toId!,
          note,
          date,
          tagText: tags,
        });
      } else if (mode === 'PERSON') {
        const draft = {
          personId: person!.id,
          kind: action,
          amountMinor,
          accountId: account.id,
          date: epochDay(date),
          note,
          tagText: tags,
        };
        const result = await saveLendingEntry(draft);
        if (result.status === 'confirmation_required') {
          if (!(await confirmOverpayment(result.warnings))) return;
          await saveLendingEntry({ ...draft, confirmOverpayment: true });
        }
      } else {
        await addQuickTransaction(
          {
            type: mode,
            amountMinor,
            accountId: account.id,
            categoryId: reimbursement ? null : categoryIds[mode]!,
            ...(reimbursement && {
              reimbursement: { expenseId: reimbursement.row.id, personId: payer ?? null },
            }),
            ...(mode === 'EXPENSE' &&
              split.people.length > 0 && {
                shares: splitShares(
                  amountMinor,
                  split.people.map((item) => item.id),
                  split.fixed,
                ).shares,
              }),
            date,
            note: note.trim() || null,
          },
          tags,
        );
      }
      writeInFlight.current = false;
      router.back();
    } catch (cause) {
      setError(String(cause));
    } finally {
      writeInFlight.current = false;
      setSaving(false);
    }
  }

  const AmountEntry = mode === 'TRANSFER' ? TransferAmountInput : ControlledAmountInput;
  return (
    <AmountEntry
      source={account}
      destination={destination}
      receivedPreset={preset}
      presetRevision={transferPresetRevision}
      initialPaid={preset && cross ? undefined : amountMinor}
      draft={amountDraft}
      currency={account?.currencyCode}
      disabled={pending}
      onChange={mode === 'TRANSFER' ? onTransferAmounts : setAmountMinor}
    >
      {({ input, keypad, dismiss: dismissCalculator, editing }) => (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={headerHeight}
        >
          <Stack.Screen
            options={{
              headerLeft: () => <CancelAction disabled={pending} />,
              gestureEnabled: !pending,
            }}
          />
          <ScrollView
            testID="quick-add-form"
            style={{ flex: 1 }}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={() => {
              dismissCalculator();
            }}
            contentContainerStyle={{ padding: 22, gap: 18, paddingBottom: 48 }}
          >
            {input}
            <View
              style={{ gap: 18 }}
              onTouchStart={() => {
                dismissCalculator();
              }}
            >
              <JoinedChoice
                key="mode"
                value={mode}
                options={modes}
                disabled={pending}
                onChange={(value) => {
                  if (mode === 'TRANSFER' && value !== 'TRANSFER') {
                    amountDraft.reset(
                      amountMinor === undefined ? '' : (amountMinor / 100).toFixed(2),
                      amountMinor === undefined,
                    );
                    setPreset(undefined);
                  }
                  setMode(value);
                  setError('');
                }}
              />
              <ChoicesSection
                key="accounts"
                options={accountsQuery()}
                label="accounts"
                layout="accounts"
                pendingLabel={incoming ? 'Into' : 'From'}
              >
                {(readyAccounts) => (
                  <View style={{ gap: 10 }}>
                    <View
                      accessibilityLabel={incoming ? 'Destination account' : 'Source account'}
                      style={{ gap: 10 }}
                    >
                      <Label>{`${incoming ? 'Into' : 'From'} ${account?.name ?? 'an account'}`}</Label>
                      <AccountChoices
                        accounts={
                          accountCurrency
                            ? readyAccounts.filter((item) => item.currencyCode === accountCurrency)
                            : readyAccounts
                        }
                        selectedId={accountId}
                        disabled={pending}
                        onSelect={(id) => {
                          setAccountId(id);
                          setToId((current) => (current !== id ? current : undefined));
                          setError('');
                        }}
                      />
                      {!readyAccounts.some(
                        (item) => !accountCurrency || item.currencyCode === accountCurrency,
                      ) && (
                        <Text style={{ color: c.muted }}>
                          {accountCurrency
                            ? `Create a ${accountCurrency} account in Accounts to add this entry.`
                            : 'Create an account in the Accounts tab before adding a transaction.'}
                        </Text>
                      )}
                    </View>
                    {mode === 'TRANSFER' && (
                      <View accessibilityLabel="Transfer destination" style={{ gap: 10 }}>
                        <Label>{`To ${destinations.find((item) => item.id === toId)?.name ?? 'another account'}`}</Label>
                        <AccountChoices
                          accounts={destinations}
                          selectedId={toId}
                          disabled={pending}
                          onSelect={setToId}
                        />
                        <TransferBillChoices
                          destination={destination}
                          disabled={pending}
                          onPreset={(amount) => {
                            setPreset(amount);
                            setTransferPresetRevision((key) => key + 1);
                          }}
                        />
                        {!destinations.length && (
                          <Text style={{ color: c.muted }}>
                            No other account. Create one in Accounts or choose a different source.
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </ChoicesSection>
              {mode === 'PERSON' && (
                <View key="person" style={{ gap: 18 }}>
                  <View style={{ gap: 10 }}>
                    <Label>{`With ${person?.name ?? 'a person'}`}</Label>
                    <FormInput
                      accessibilityLabel="Search people"
                      placeholder="Find or add a person"
                      value={query}
                      onChangeText={setQuery}
                      editable={!pending}
                    />
                  </View>
                  <ChoicesSection options={peopleQuery()} label="people" layout="people">
                    {(readyPeople) => {
                      const personChip = (item: (typeof people)[number]) => {
                        const selected = item.id === personId;
                        return (
                          <Animated.View
                            key={item.id}
                            layout={layoutTransition}
                            style={{ maxWidth: '100%' }}
                            onLayout={peopleClipping.onLayout(item.id)}
                          >
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={item.name}
                              accessibilityState={{ selected, disabled: pending }}
                              {...peopleClipping.accessibilityProps(item.id, pending)}
                              onPress={() => setPersonId(item.id)}
                              style={({ pressed }) => ({
                                paddingHorizontal: 14,
                                paddingVertical: 8,
                                height: personChipHeight,
                                maxWidth: '100%',
                                borderRadius: 14,
                                backgroundColor: selected ? c.selected : c.surface,
                                opacity: pending ? 0.45 : pressed ? 0.7 : 1,
                                gap: 4,
                              })}
                            >
                              <Text
                                numberOfLines={1}
                                style={{
                                  color: c.text,
                                  fontSize: 15,
                                  lineHeight: 20,
                                  fontWeight: selected ? '700' : '500',
                                }}
                              >
                                {item.name}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={{
                                  color: selected ? c.onSelected : c.muted,
                                  fontSize: 12,
                                  lineHeight: 16,
                                }}
                              >
                                {personBalanceSummary(
                                  readyPeople.totals,
                                  item.id,
                                  account?.currencyCode ?? '',
                                )}
                              </Text>
                            </Pressable>
                          </Animated.View>
                        );
                      };
                      return (
                        <View style={{ gap: 10 }}>
                          <Animated.View
                            layout={layoutTransition}
                            style={{
                              maxHeight: peopleMaxHeight,
                              overflow: 'hidden',
                              flexDirection: 'row',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}
                          >
                            {matches.map(personChip)}
                            {optimisticPersonName &&
                              !people.some((item) => item.name === optimisticPersonName) && (
                                <ChoiceChip label={optimisticPersonName} selected disabled />
                              )}
                          </Animated.View>
                          {!matches.length && !optimisticPersonName && (
                            <Text style={{ color: c.muted }}>
                              {search
                                ? 'No matching people.'
                                : 'No saved people. Enter a name to add one.'}
                            </Text>
                          )}
                          {canCreatePerson && (
                            <AnimatedFormButton
                              layout={layoutTransition}
                              label={`Add “${query.trim()}”`}
                              variant="secondary"
                              disabled={pending}
                              onPress={() =>
                                addPerson(query, (created) => {
                                  setPersonId(created.id);
                                  setQuery('');
                                })
                              }
                            />
                          )}
                        </View>
                      );
                    }}
                  </ChoicesSection>
                  <View style={{ gap: 10 }}>
                    <Label>What happened</Label>
                    <JoinedChoice<PersonAction>
                      value={action}
                      options={principalActions}
                      disabled={pending}
                      onChange={setAction}
                    />
                    <JoinedChoice<PersonAction>
                      value={action}
                      options={repaymentActions}
                      disabled={pending}
                      onChange={setAction}
                    />
                  </View>
                  <Text style={{ color: c.muted }}>
                    {incoming ? 'Money into' : 'Money out of'}{' '}
                    {account?.name ?? 'the selected account'}. Excluded from spending reports.
                    Recorded person balances may be incomplete.
                  </Text>
                </View>
              )}
              {mode === 'INCOME' && (
                <ExpenseLink
                  key="expense-link"
                  expense={reimbursement}
                  payer={payer}
                  amountMinor={amountMinor ?? 0}
                  disabled={pending}
                  onSelectExpense={selectExpense}
                  onSelectPayer={selectPayer}
                  onRemove={() => {
                    setLinked(null);
                    setPayer(undefined);
                    setError('');
                  }}
                />
              )}
              {categoryMode && !reimbursement && (
                <ChoicesSection
                  key={categoryMode}
                  layout="categories"
                  options={categoriesQuery(categoryMode)}
                  label={`${categoryMode === 'EXPENSE' ? 'expense' : 'income'} categories`}
                >
                  {(readyCategories) => (
                    <>
                      <QuickSelectCategory
                        categories={readyCategories}
                        orderedIds={orderedCategoryIds}
                        selectedId={categoryIds[categoryMode]}
                        disabled={pending}
                        onSelect={(id) => setCategoryIds((ids) => ({ ...ids, [categoryMode]: id }))}
                      />
                      {!readyCategories.length && (
                        <Text style={{ color: c.muted }}>
                          Create an {categoryMode === 'EXPENSE' ? 'expense' : 'income'} category in
                          Settings before saving.
                        </Text>
                      )}
                    </>
                  )}
                </ChoicesSection>
              )}
              {mode === 'EXPENSE' && (
                <SplitExpense
                  key="split"
                  draft={split}
                  amount={amountMinor ?? 0}
                  currency={account?.currencyCode}
                  disabled={pending}
                  onChange={setSplit}
                  onAddPerson={addPerson}
                  optimisticPersonName={optimisticPersonName}
                />
              )}
              <Animated.View key="details" style={{ gap: 12 }}>
                <Label>Note · optional</Label>
                <FormInput
                  accessibilityLabel="Note"
                  placeholder="Add a note"
                  value={note}
                  onChangeText={setNote}
                  editable={!pending}
                />
                <Label>Tags · optional</Label>
                <FormInput
                  accessibilityLabel="Tags, separated by commas"
                  placeholder="Comma-separated tags"
                  value={tags}
                  onChangeText={setTags}
                  editable={!pending}
                />
                <QuickAddDate value={date} onChange={setDate} disabled={pending} />
              </Animated.View>
              {!!error && (
                <Text key="error" selectable accessibilityRole="alert" style={{ color: c.warning }}>
                  {error}
                </Text>
              )}
              <FormButton
                key="save"
                label={saveLabel}
                loading={saving}
                disabled={pending || !canSave || editing}
                onPress={() => {
                  if (!editing) void save();
                }}
              />
            </View>
          </ScrollView>
          {keypad}
        </KeyboardAvoidingView>
      )}
    </AmountEntry>
  );
}
