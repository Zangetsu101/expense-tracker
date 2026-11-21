import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Pressable, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChoiceChip } from '@/components/entry-choices';
import { Disclosure, FormButton, FormInput } from '@/components/form-controls';
import { formatBalance, formatEpochDay, formatMoney } from '@/lib/transaction-format';
import {
  categoryPath,
  expenseDetail,
  matchesSearch,
  searchSections,
  type ListRow,
} from '@/features/home/list';
import { DayHeader, TransactionRow } from '@/features/home/list-view';
import { shortDay } from '@/features/home/period';
import { expenseReimbursements, expensesForReimbursement } from '@/features/home/read-home';
import { theme } from '@/theme';

const c = theme.colors;
const scope = { face: 'pace', accountId: null } as const;
export type LinkableExpense = {
  row: ListRow;
  shares: Awaited<ReturnType<typeof expenseReimbursements>>['shares'];
};

function ExpensePicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (expense: LinkableExpense) => void;
}) {
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const read = useQuery({
    queryKey: ['reimbursement-expenses'],
    queryFn: expensesForReimbursement,
  });
  const needle = query.trim().toLowerCase();
  const matches = (read.data ?? []).filter(
    (row) =>
      !needle ||
      matchesSearch(row, needle) ||
      categoryPath(row).toLowerCase().includes(needle) ||
      [
        shortDay(row.date),
        formatEpochDay(row.date),
        formatMoney('TRANSFER', row.amountMinor, row.currencyCode),
      ].some((value) => value.toLowerCase().replace(/,/g, '').includes(needle.replace(/,/g, ''))),
  );
  const owed = matches.filter((row) => (row.owedMinor ?? 0) > 0);
  const other = searchSections(matches.filter((row) => !row.owedMinor));
  const sections = [
    ...(owed.length ? [{ key: 'owed', label: 'Still owed', date: null, data: owed }] : []),
    { key: 'all', label: 'All expenses', date: null, data: [] as ListRow[] },
    ...other.map((section) => ({
      key: section.key,
      date: section.date,
      label: null,
      data: section.data.flatMap((item) => (item.kind === 'row' ? [item.row] : [])),
    })),
  ];
  async function select(row: ListRow) {
    setSelecting(true);
    setSelectionError('');
    try {
      const { shares } = await expenseReimbursements(row.id);
      onSelect({ row, shares });
    } catch {
      setSelectionError('Could not open the selected expense. Try again.');
      setSelecting(false);
    }
  }
  return (
    <Modal
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (!selecting) onClose();
      }}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: c.background, paddingHorizontal: 20 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <FormButton label="Cancel" variant="secondary" disabled={selecting} onPress={onClose} />
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: 18, fontWeight: '700' }}
          >
            Link to expense
          </Text>
          <View style={{ width: 72 }} />
        </View>
        <FormInput
          accessibilityLabel="Search expenses"
          placeholder="Search by name, date or amount"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        {read.isPending ? (
          <Text style={{ color: c.muted, paddingVertical: 12 }}>Loading expenses…</Text>
        ) : read.isError ? (
          <FormButton
            label="Retry loading expenses"
            variant="secondary"
            onPress={() => void read.refetch()}
          />
        ) : (
          <SectionList
            keyboardShouldPersistTaps="handled"
            sections={sections}
            stickySectionHeadersEnabled={false}
            keyExtractor={(row) => String(row.id)}
            renderSectionHeader={({ section }) =>
              section.label ? (
                <Text accessibilityRole="header" style={{ color: c.muted, marginTop: 18 }}>
                  {section.label}
                </Text>
              ) : (
                section.date !== null && (
                  <DayHeader date={section.date} totals={[]} now={new Date()} />
                )
              )
            }
            renderItem={({ item, section }) => (
              <TransactionRow
                row={item}
                scope={scope}
                query={query}
                title={categoryPath(item)}
                detail={[item.note, item.accountName, section.key === 'owed' && shortDay(item.date)]
                  .filter(Boolean)
                  .join(' · ')}
                disabled={selecting}
                onPress={() => void select(item)}
              />
            )}
            ListFooterComponent={
              !other.length ? (
                <Text style={{ color: c.muted, paddingVertical: 12 }}>
                  {owed.length ? 'No other matching expenses.' : 'No matching expenses.'}
                </Text>
              ) : undefined
            }
          />
        )}
        {!!selectionError && (
          <Text accessibilityRole="alert" style={{ color: c.warning }}>
            {selectionError}
          </Text>
        )}
      </SafeAreaView>
    </Modal>
  );
}

export function ExpenseLink({
  expense,
  payer,
  amountMinor,
  disabled,
  onSelectExpense,
  onSelectPayer,
  onRemove,
}: {
  expense: LinkableExpense | null;
  payer: number | null | undefined;
  amountMinor: number;
  disabled: boolean;
  onSelectExpense: (expense: LinkableExpense) => void;
  onSelectPayer: (personId: number | null, left?: number) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const row = expense?.row;
  const selected = expense?.shares.find((share) => share.personId === payer);
  const money = (minor: number) => formatBalance(minor, row?.currencyCode ?? '');
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>
        {row ? 'Reimbursement for' : 'Reimbursement · optional'}
      </Text>
      {row ? (
        <>
          <View
            style={{
              backgroundColor: c.selected,
              borderRadius: 12,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: c.onSelected, fontWeight: '600' }}>{categoryPath(row)}</Text>
              <Text style={{ color: c.onSelected, fontSize: 12 }}>
                {expenseDetail(row)} · {formatMoney('EXPENSE', row.amountMinor, row.currencyCode)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => setPicking(true)}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: c.onSelected, textDecorationLine: 'underline' }}>Change</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onRemove}
            style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: c.accent }}>Remove link</Text>
          </Pressable>
          {expense.shares.length ? (
            <>
              <Text
                style={{ color: c.muted, fontSize: 12 }}
              >{`From ${selected?.name ?? (payer === null ? 'no person' : '…')}`}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {expense.shares.map((share) => (
                  <ChoiceChip
                    key={share.personId}
                    label={share.name}
                    detail={`${money(share.leftMinor)} left`}
                    selected={payer === share.personId}
                    disabled={disabled}
                    onPress={() => onSelectPayer(share.personId, share.leftMinor)}
                  />
                ))}
                <ChoiceChip
                  label="No person (refund)"
                  selected={payer === null}
                  disabled={disabled}
                  onPress={() => onSelectPayer(null)}
                />
              </View>
              {selected && amountMinor > selected.leftMinor && (
                <Text accessibilityRole="alert" style={{ color: c.warning }}>
                  {selected.name} owes {money(selected.leftMinor)} on this expense. This is{' '}
                  {money(amountMinor - selected.leftMinor)} more.
                </Text>
              )}
            </>
          ) : (
            <Text style={{ color: c.muted }}>Not split · this is a refund</Text>
          )}
          <Text style={{ color: c.muted, fontSize: 12 }}>
            Uses the expense’s Category in reports.
          </Text>
        </>
      ) : (
        <Disclosure label="Link to expense" disabled={disabled} onPress={() => setPicking(true)} />
      )}
      {picking && (
        <ExpensePicker
          onClose={() => setPicking(false)}
          onSelect={(expense) => {
            setPicking(false);
            onSelectExpense(expense);
          }}
        />
      )}
    </View>
  );
}
