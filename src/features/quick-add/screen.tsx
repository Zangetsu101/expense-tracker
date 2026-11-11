import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { categoriesQuery, peopleQuery, includeCreatedPerson } from './queries.ts';
import { accountsQuery } from '@/lib/account-queries';
import { ChoicesSection } from './view.tsx';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { epochDay } from '@/lib/database';
import { addQuickTransaction } from '@/lib/quick-add-tags';
import { addTransfer } from '@/lib/transfers';
import {
  createPerson,
  saveLendingEntry,
  type LendingKind,
  type LendingResult,
  type LendingTotal,
} from '@/lib/lending';
import { AmountInput } from '@/components/amount-input';
import { useRankedCategories } from './use-ranked-categories.ts';
import { QuickAddDate } from '@/components/quick-add-date';
import { QuickSelectCategory } from '@/components/quick-select-category';
import { AccountChoices, personBalanceSummary } from '@/components/entry-choices';
import { FormButton, FormInput, JoinedChoice } from '@/components/form-controls';
import { parseAccountId } from '@/lib/account-selection';
import { theme } from '@/theme';

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

function askOverpayment(warnings: LendingTotal[], onConfirm: () => void) {
  Alert.alert(
    'Overpayment warning',
    warnings
      .map(
        (warning) =>
          `${warning.currencyCode} · ${warning.direction === 'LENT' ? 'They owe you' : 'You owe them'}: overpaid credit ${(warning.overpaidMinor / 100).toFixed(2)}`,
      )
      .join('\n') + '\nSave anyway? Excess remains visible as credit, not an opposite obligation.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: onConfirm },
    ],
    { cancelable: false },
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
  const [mode, setMode] = useState<Mode>('EXPENSE');
  const categoryMode = mode === 'EXPENSE' || mode === 'INCOME' ? mode : undefined;
  const categoryRead = useQuery({ ...categoriesQuery(categoryMode ?? 'EXPENSE'), enabled: false });
  const peopleRead = useQuery({ ...peopleQuery(), enabled: false });
  const accounts = accountsRead.data ?? [];
  const categories = categoryRead.data ?? [];
  const people = peopleRead.data?.people ?? [];
  const params = useLocalSearchParams<{ accountId?: string }>();
  const headerHeight = useHeaderHeight();
  const [amountMinor, setAmountMinor] = useState<number>();
  const [accountId, setAccountId] = useState(() => parseAccountId(params.accountId));
  const [toId, setToId] = useState<number>();
  const [categoryIds, setCategoryIds] = useState<{
    EXPENSE?: number;
    INCOME?: number;
  }>({});
  const [personId, setPersonId] = useState<number>();
  const [query, setQuery] = useState('');
  const [action, setAction] = useState<PersonAction>('LEND');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [date, setDate] = useState(() => new Date());
  // A synchronous lock. It stops a second tap before the pending state arrives, and it
  // lets the screen close after a save while the mutation is still pending.
  const busy = useRef(false);
  const account = accounts.find((item) => item.id === accountId);
  const person = people.find((item) => item.id === personId);
  const orderedCategoryIds = useRankedCategories(
    categoryRead.data,
    categoryMode,
    account,
    amountMinor,
    epochDay(date),
  );
  const destinations = accounts.filter(
    (item) => item.id !== accountId && item.currencyCode === account?.currencyCode,
  );
  const incoming =
    mode === 'INCOME' ||
    (mode === 'PERSON' && (action === 'BORROW' || action === 'RECEIVE_REPAYMENT'));
  const search = query.trim().toLocaleLowerCase();
  const matches = people.filter((item) => item.name.toLocaleLowerCase().includes(search));
  const canCreatePerson =
    !!search && !people.some((item) => item.name.toLocaleLowerCase() === search);
  const validAmount = amountMinor !== undefined;
  const canSave =
    !!accountsRead.data &&
    (mode === 'TRANSFER' || (mode === 'PERSON' ? !!peopleRead.data : !!categoryRead.data)) &&
    validAmount &&
    !!account &&
    (mode === 'TRANSFER'
      ? destinations.some((item) => item.id === toId)
      : mode === 'PERSON'
        ? !!person
        : !!categoryMode && categories.some((item) => item.id === categoryIds[categoryMode]));
  const saveLabel =
    mode === 'PERSON'
      ? {
          LEND: 'Save lending',
          BORROW: 'Save borrowing',
          RECEIVE_REPAYMENT: 'Save repayment received',
          REPAY: 'Save repayment made',
        }[action]
      : mode === 'TRANSFER'
        ? 'Save transfer'
        : 'Save';

  const addPerson = useMutation({
    mutationFn: (name: string) => createPerson(name),
    onSuccess: (created) => {
      includeCreatedPerson(client, created);
      setPersonId(created.id);
      setQuery('');
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const save = useMutation({
    mutationFn: async (confirmOverpayment: boolean): Promise<LendingResult | void> => {
      if (!account || amountMinor === undefined) throw new Error('Enter an amount.');
      if (!Number.isFinite(date.getTime()) || epochDay(date) > epochDay(new Date()))
        throw new Error('Choose today or a past date.');
      if (mode === 'TRANSFER')
        return addTransfer({
          amountMinor,
          fromAccountId: account.id,
          toAccountId: toId!,
          note,
          date,
          tagText: tags,
        });
      if (mode === 'PERSON')
        return saveLendingEntry({
          personId: person!.id,
          kind: action,
          amountMinor,
          accountId: account.id,
          date: epochDay(date),
          note,
          tagText: tags,
          ...(confirmOverpayment && { confirmOverpayment }),
        });
      await addQuickTransaction(
        {
          type: mode,
          amountMinor,
          accountId: account.id,
          categoryId: categoryIds[mode]!,
          date,
          note: note.trim() || null,
        },
        tags,
      );
    },
    onSuccess: (result) => {
      busy.current = false;
      if (result?.status === 'confirmation_required')
        askOverpayment(result.warnings, () => start(() => save.mutate(true)));
      else router.back();
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const pending = save.isPending || addPerson.isPending;
  const error = save.error ?? addPerson.error;
  function clearError() {
    save.reset();
    addPerson.reset();
  }
  function start(write: () => void) {
    if (busy.current) return;
    busy.current = true;
    clearError();
    write();
  }
  const navigation = useNavigation();
  usePreventRemove(pending, ({ data: removal }) => {
    if (!busy.current) navigation.dispatch(removal.action);
  });
  return (
    <AmountInput currency={account?.currencyCode} disabled={pending} onChange={setAmountMinor}>
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
                value={mode}
                options={modes}
                disabled={pending}
                onChange={(value) => {
                  setMode(value);
                  clearError();
                }}
              />
              <ChoicesSection
                options={accountsQuery()}
                label="accounts"
                layout="accounts"
                pendingLabel={incoming ? 'Into' : 'From'}
              >
                {(readyAccounts) => (
                  <>
                    <View style={{ gap: 10 }}>
                      <Label>{`${incoming ? 'Into' : 'From'} ${account?.name ?? 'an account'}`}</Label>
                      <AccountChoices
                        accounts={readyAccounts}
                        selectedId={accountId}
                        disabled={pending}
                        onSelect={(id) => {
                          setAccountId(id);
                          setToId(undefined);
                          clearError();
                        }}
                      />
                      {!readyAccounts.length && (
                        <Text style={{ color: c.muted }}>
                          Create an account in the Accounts tab before adding a transaction.
                        </Text>
                      )}
                    </View>
                    {mode === 'TRANSFER' && (
                      <View style={{ gap: 10 }}>
                        <Label>{`To ${destinations.find((item) => item.id === toId)?.name ?? 'another account'}`}</Label>
                        <AccountChoices
                          accounts={destinations}
                          selectedId={toId}
                          disabled={pending}
                          onSelect={setToId}
                        />
                        {!destinations.length && (
                          <Text style={{ color: c.muted }}>
                            No other {account?.currencyCode ?? 'same-currency'} account. Create one
                            in Accounts or choose a different source.
                          </Text>
                        )}
                      </View>
                    )}
                  </>
                )}
              </ChoicesSection>
              {mode === 'PERSON' && (
                <>
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
                    {(readyPeople) => (
                      <>
                        <View style={{ gap: 10 }}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {matches.map((item) => {
                              const selected = item.id === personId;
                              return (
                                <Pressable
                                  key={item.id}
                                  accessibilityRole="button"
                                  accessibilityLabel={item.name}
                                  accessibilityState={{ selected, disabled: pending }}
                                  disabled={pending}
                                  onPress={() => setPersonId(item.id)}
                                  style={({ pressed }) => ({
                                    paddingHorizontal: 14,
                                    paddingVertical: 8,
                                    minHeight: 48,
                                    maxWidth: '100%',
                                    borderRadius: 14,
                                    backgroundColor: selected ? c.selected : c.surface,
                                    opacity: pending ? 0.45 : pressed ? 0.7 : 1,
                                    gap: 4,
                                  })}
                                >
                                  <Text
                                    style={{
                                      color: c.text,
                                      fontSize: 15,
                                      fontWeight: selected ? '700' : '500',
                                    }}
                                  >
                                    {item.name}
                                  </Text>
                                  <Text
                                    style={{
                                      color: selected ? c.onSelected : c.muted,
                                      fontSize: 12,
                                    }}
                                  >
                                    {personBalanceSummary(
                                      readyPeople.totals,
                                      item.id,
                                      account?.currencyCode ?? '',
                                    )}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                          {!matches.length && (
                            <Text style={{ color: c.muted }}>
                              {search
                                ? 'No matching people.'
                                : 'No saved people. Enter a name to add one.'}
                            </Text>
                          )}
                          {canCreatePerson && (
                            <FormButton
                              label={`Add “${query.trim()}”`}
                              variant="secondary"
                              disabled={pending}
                              onPress={() => start(() => addPerson.mutate(query))}
                            />
                          )}
                        </View>
                      </>
                    )}
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
                </>
              )}
              {categoryMode && (
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
              <View style={{ gap: 12 }}>
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
              </View>
              {!!error && (
                <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
                  {String(error)}
                </Text>
              )}
              <FormButton
                label={saveLabel}
                loading={pending}
                disabled={!canSave || editing}
                onPress={() => {
                  if (!editing && canSave) start(() => save.mutate(false));
                }}
              />
            </View>
          </ScrollView>
          {keypad}
        </KeyboardAvoidingView>
      )}
    </AmountInput>
  );
}
