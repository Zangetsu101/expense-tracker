import { useCallback, useRef, useState } from 'react';
import { Link, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listAccounts, type Account } from '@/lib/database';
import { listManagedCategories, type ManagedCategory } from '@/lib/categories';
import {
  PAGE_SIZE,
  parseAmountMinor,
  searchTransactions,
  validDate,
  type SearchFilters,
  type SearchRow,
} from '@/lib/transaction-search';
import { parseAccountId } from '@/lib/account-selection';
import {
  countLabel,
  formatEpochDay,
  formatTransactionAmount,
  transactionTitle,
} from '@/lib/transaction-format';

const ink = '#edf1f4';
const muted = '#a2acb5';
const accent = '#88d7bc';
const initialFilters: SearchFilters = {
  query: '',
  type: 'ALL',
  accountId: null,
  categoryId: null,
  datePreset: 'ANY',
  startDate: '',
  endDate: '',
  amountMode: 'ANY',
  amount: '',
  maximum: '',
};
const dates: { value: SearchFilters['datePreset']; label: string }[] = [
  { value: 'ANY', label: 'Any date' },
  { value: 'TODAY', label: 'Today' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'CUSTOM', label: 'Custom range' },
];
const modes: { value: SearchFilters['amountMode']; label: string }[] = [
  { value: 'ANY', label: 'Any' },
  { value: 'EQUAL', label: 'Equal' },
  { value: 'GREATER', label: 'Greater than' },
  { value: 'LESS', label: 'Less than' },
  { value: 'BETWEEN', label: 'Between' },
];
const types: SearchFilters['type'][] = ['ALL', 'EXPENSE', 'INCOME', 'TRANSFER'];

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: selected ? '#52766c' : '#29343a',
      }}
    >
      <Text style={{ color: ink }}>{label}</Text>
    </Pressable>
  );
}

export default function TransactionsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ accountId?: string }>();
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    ...initialFilters,
    accountId: parseAccountId(params.accountId) ?? null,
  }));
  const [draft, setDraft] = useState<SearchFilters>(() => ({
    ...initialFilters,
    accountId: parseAccountId(params.accountId) ?? null,
  }));
  const [open, setOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [categoryWidth, setCategoryWidth] = useState(0);
  const [chipWidths, setChipWidths] = useState<Record<string, number>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const filtersRef = useRef(filters);
  const updateFilters = (change: (current: SearchFilters) => SearchFilters) => {
    const next = change(filtersRef.current);
    filtersRef.current = next;
    request.current++;
    setFilters(next);
  };
  const changeDraft = (patch: Partial<SearchFilters>) => setDraft((old) => ({ ...old, ...patch }));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      Promise.all([listAccounts(), listManagedCategories()])
        .then(([accountItems, categoryItems]) => {
          if (active) {
            setAccounts(accountItems);
            setCategories(categoryItems);
          }
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
      setRevision((value) => value + 1);
      return () => {
        active = false;
      };
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const generation = ++request.current;
      setLoading(true);
      setError(undefined);
      setRows([]);
      setMore(false);
      searchTransactions(filters)
        .then((items) => {
          if (active && request.current === generation) {
            setRows(items);
            setMore(items.length === PAGE_SIZE);
          }
        })
        .catch((e) => {
          if (active && request.current === generation) setError(String(e));
        })
        .finally(() => {
          if (active && request.current === generation) setLoading(false);
        });
      return () => {
        active = false;
        request.current++;
      };
      // Revision intentionally reloads the focused query when the user retries.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters, revision]),
  );

  const loadMore = async () => {
    if (loading || !more) return;
    const generation = request.current;
    const snapshot = filtersRef.current;
    setLoading(true);
    try {
      const items = await searchTransactions(snapshot, rows.length);
      if (generation !== request.current || snapshot !== filtersRef.current) return;
      setRows((old) =>
        generation === request.current && snapshot === filtersRef.current
          ? [...old, ...items]
          : old,
      );
      setMore(items.length === PAGE_SIZE);
    } catch (e) {
      if (generation === request.current && snapshot === filtersRef.current) setError(String(e));
    } finally {
      if (generation === request.current && snapshot === filtersRef.current) setLoading(false);
    }
  };
  const dateValid =
    draft.datePreset !== 'CUSTOM' ||
    (validDate(draft.startDate ?? '') &&
      validDate(draft.endDate ?? '') &&
      draft.startDate! <= draft.endDate!);
  const firstAmount = parseAmountMinor(draft.amount ?? '');
  const maximum = parseAmountMinor(draft.maximum ?? '');
  const amountValid =
    draft.amountMode === 'ANY' ||
    (firstAmount !== null &&
      (draft.amountMode !== 'BETWEEN' || (maximum !== null && firstAmount <= maximum)));
  const apply = () => {
    if (!dateValid || !amountValid) return;
    updateFilters((current) => ({
      ...draft,
      query: current.query,
      startDate: draft.datePreset === 'CUSTOM' ? draft.startDate : '',
      endDate: draft.datePreset === 'CUSTOM' ? draft.endDate : '',
      amount: draft.amountMode === 'ANY' ? '' : draft.amount,
      maximum: draft.amountMode === 'BETWEEN' ? draft.maximum : '',
    }));
    setOpen(false);
  };
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryPath = (category: ManagedCategory) => {
    const names = [category.name];
    const seen = new Set([category.id]);
    let parent = category.parentId == null ? undefined : categoryById.get(category.parentId);
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId == null ? undefined : categoryById.get(parent.parentId);
    }
    return names.join(' › ');
  };
  const active: { label: string; clear: Partial<SearchFilters> }[] = [];
  if (filters.datePreset !== 'ANY')
    active.push({
      label: `Date: ${dates.find((d) => d.value === filters.datePreset)?.label}`,
      clear: { datePreset: 'ANY', startDate: '', endDate: '' },
    });
  if (filters.categoryId !== null)
    active.push({
      label: `Category: ${categoryById.get(filters.categoryId ?? -1) ? categoryPath(categoryById.get(filters.categoryId ?? -1)!) : 'Selected'}`,
      clear: { categoryId: null },
    });
  if (filters.accountId !== null)
    active.push({
      label: `Account: ${accounts.find((a) => a.id === filters.accountId)?.name ?? 'Selected'}`,
      clear: { accountId: null },
    });
  if (filters.type !== 'ALL')
    active.push({ label: `Type: ${filters.type.toLowerCase()}`, clear: { type: 'ALL' } });
  if (filters.amountMode !== 'ANY')
    active.push({
      label: `Amount: ${modes.find((m) => m.value === filters.amountMode)?.label} ${filters.amount}${filters.amountMode === 'BETWEEN' ? `–${filters.maximum}` : ''}`,
      clear: { amountMode: 'ANY', amount: '', maximum: '' },
    });
  const section = (title: string, children: React.ReactNode) => (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <Text style={{ color: muted, fontWeight: '700' }}>{title}</Text>
      {children}
    </View>
  );
  const inputStyle = {
    backgroundColor: '#303c44',
    color: ink,
    padding: 12,
    borderRadius: 12,
  } as const;
  const categoryChoices = [{ id: null, name: 'All categories', type: '' }, ...categories].filter(
    (c) =>
      (c.id === null ? c.name : categoryPath(c))
        .toLowerCase()
        .includes(categoryQuery.trim().toLowerCase()),
  );
  const categoryLabel = (c: (typeof categoryChoices)[number]) =>
    c.id !== null ? `${categoryPath(c)} · ${c.type.toLowerCase()}` : c.name;
  const categoryRows: (typeof categoryChoices)[] = [[], []];
  let used = 0;
  let row = 0;
  for (const category of categoryChoices) {
    const width = chipWidths[String(category.id)];
    if (!categoryWidth || !width) continue;
    if (used && used + 8 + width > categoryWidth) {
      row++;
      used = 0;
    }
    if (row > 1) break;
    categoryRows[row].push(category);
    used += (used ? 8 : 0) + width;
  }
  const categoryOverflow = categoryChoices.length > categoryRows[0].length + categoryRows[1].length;
  const categoryChip = (c: (typeof categoryChoices)[number]) => (
    <Choice
      key={String(c.id)}
      label={categoryLabel(c)}
      selected={draft.categoryId === c.id}
      onPress={() => changeDraft({ categoryId: c.id })}
    />
  );
  return (
    <>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ flex: 1, backgroundColor: '#10181d' }}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: ink, fontSize: 21, fontWeight: '700', flex: 1 }}>
                Find a transaction
              </Text>
              <Choice
                label="Edit filters"
                selected={false}
                onPress={() => {
                  setDraft({ ...filters });
                  setCategoryQuery('');
                  setOpen(true);
                }}
              />
            </View>
            <TextInput
              accessibilityLabel="Search transactions"
              placeholder="Search note, category or account"
              placeholderTextColor={muted}
              value={filters.query}
              onChangeText={(query) => updateFilters((old) => ({ ...old, query }))}
              style={inputStyle}
            />
            {active.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                {active.map(({ label, clear }) => (
                  <Choice
                    key={label}
                    label={`${label} ×`}
                    selected
                    onPress={() => updateFilters((old) => ({ ...old, ...clear }))}
                  />
                ))}
              </View>
            )}
            <Text style={{ color: muted }}>
              {countLabel(rows.length, 'result', 'results', more)}
              {rows.length > 0
                ? ` · ${[...new Set(rows.map((r) => r.currencyCode))].map((currency) => `${rows.filter((r) => r.currencyCode === currency).length} ${currency}`).join(' · ')}${more ? ' loaded' : ''}`
                : ''}
            </Text>
            {error && (
              <Text accessibilityRole="alert" selectable style={{ color: '#ffb5a8' }}>
                {error}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <Text style={{ color: ink, padding: 20 }}>
              No transactions match. Try clearing a filter.
            </Text>
          ) : null
        }
        renderItem={({ item, index }) => {
          const title = item.lendingKind
            ? transactionTitle(item)
            : item.note?.trim() || transactionTitle(item);
          const detail =
            item.type === 'TRANSFER'
              ? `${item.accountName} → ${item.transferAccountName ?? 'Account'} · ${item.currencyCode}`
              : `${transactionTitle(item)} · ${item.accountName}`;
          const content = (
            <View
              style={{
                padding: 16,
                backgroundColor: item.type === 'TRANSFER' ? '#222c38' : '#1c242a',
                borderRadius: 4,
                gap: 6,
                borderLeftWidth: item.type === 'TRANSFER' ? 3 : 0,
                borderLeftColor: '#8da8dc',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{ color: ink, fontSize: 15, fontWeight: '600', flex: 1 }}
                >
                  {item.type === 'TRANSFER' ? '⇄  ' : ''}
                  {title}
                </Text>
                <Text
                  selectable
                  style={{
                    color: item.type === 'INCOME' ? accent : ink,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {formatTransactionAmount(item.type, item.amountMinor, item.currencyCode)}
                </Text>
              </View>
              <Text style={{ color: muted, fontSize: 12 }}>{detail}</Text>
            </View>
          );
          return (
            <View style={{ gap: 8, paddingBottom: 9 }}>
              {(index === 0 || rows[index - 1].date !== item.date) && (
                <Text style={{ color: '#f4d79a', fontWeight: '700', paddingTop: 12 }}>
                  {formatEpochDay(item.date)}
                </Text>
              )}
              <Link
                href={{ pathname: '/transaction/[id]', params: { id: String(item.id) } }}
                asChild
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`View receipt for ${item.type.toLowerCase()} transaction, ${title}`}
                >
                  {content}
                </Pressable>
              </Link>
            </View>
          );
        }}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loading ? (
            <ActivityIndicator color={accent} />
          ) : more ? (
            <Choice label="Load more" selected={false} onPress={() => void loadMore()} />
          ) : null
        }
      />
      <Modal
        visible={open}
        transparent
        animationType="slide"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }}
        >
          <Pressable
            accessibilityLabel="Dismiss filters"
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={{ flex: 1 }}
          />
          <View
            style={{
              backgroundColor: '#202a32',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '85%',
            }}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 16) }}
            >
              <Text style={{ color: ink, fontSize: 20, fontWeight: '700', marginBottom: 16 }}>
                Filter transactions
              </Text>
              {section(
                'Date',
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {dates.map(({ value, label }) => (
                      <Choice
                        key={value}
                        label={label}
                        selected={draft.datePreset === value}
                        onPress={() => changeDraft({ datePreset: value })}
                      />
                    ))}
                  </View>
                  {draft.datePreset === 'CUSTOM' && (
                    <>
                      <Text style={{ color: muted }}>YYYY-MM-DD</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TextInput
                          accessibilityLabel="Start date"
                          placeholder="Start YYYY-MM-DD"
                          placeholderTextColor={muted}
                          value={draft.startDate}
                          onChangeText={(startDate) => changeDraft({ startDate })}
                          style={[inputStyle, { flex: 1, minWidth: 0 }]}
                        />
                        <TextInput
                          accessibilityLabel="End date"
                          placeholder="End YYYY-MM-DD"
                          placeholderTextColor={muted}
                          value={draft.endDate}
                          onChangeText={(endDate) => changeDraft({ endDate })}
                          style={[inputStyle, { flex: 1, minWidth: 0 }]}
                        />
                      </View>
                      {!dateValid && (
                        <Text style={{ color: '#ffb5a8' }}>
                          Enter valid dates with start on or before end.
                        </Text>
                      )}
                    </>
                  )}
                </>,
              )}
              {section(
                'Category',
                <>
                  <TextInput
                    accessibilityLabel="Search categories"
                    placeholder="Search categories"
                    placeholderTextColor={muted}
                    value={categoryQuery}
                    onChangeText={setCategoryQuery}
                    style={inputStyle}
                  />
                  <View onLayout={(event) => setCategoryWidth(event.nativeEvent.layout.width)}>
                    <View
                      pointerEvents="none"
                      style={{ position: 'absolute', opacity: 0, flexDirection: 'row' }}
                    >
                      {[{ id: null, name: 'All categories', type: '' }, ...categories].map((c) => (
                        <View
                          key={String(c.id)}
                          onLayout={(event) => {
                            const width = event.nativeEvent.layout.width;
                            setChipWidths((old) =>
                              old[String(c.id)] === width ? old : { ...old, [String(c.id)]: width },
                            );
                          }}
                        >
                          {categoryChip(c)}
                        </View>
                      ))}
                    </View>
                    <View style={{ gap: 8 }}>
                      {categoryRows.map((items, index) => (
                        <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
                          {items.map(categoryChip)}
                        </View>
                      ))}
                    </View>
                    {categoryChoices.length === 0 && (
                      <Text style={{ color: muted, padding: 12 }}>No matching categories</Text>
                    )}
                    {categoryOverflow && (
                      <Text style={{ color: muted, fontSize: 12, paddingTop: 4 }}>
                        Refine search to see more
                      </Text>
                    )}
                  </View>
                </>,
              )}
              {section(
                'Account',
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Choice
                    label="All accounts"
                    selected={draft.accountId === null}
                    onPress={() => changeDraft({ accountId: null })}
                  />
                  {accounts.map((a) => (
                    <Choice
                      key={a.id}
                      label={a.name}
                      selected={draft.accountId === a.id}
                      onPress={() => changeDraft({ accountId: a.id })}
                    />
                  ))}
                </View>,
              )}
              {section(
                'Type',
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {types.map((type) => (
                    <Choice
                      key={type}
                      label={type === 'ALL' ? 'All types' : type.toLowerCase()}
                      selected={draft.type === type}
                      onPress={() => changeDraft({ type })}
                    />
                  ))}
                </View>,
              )}
              {section(
                'Amount',
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {modes.map(({ value, label }) => (
                      <Choice
                        key={value}
                        label={label}
                        selected={draft.amountMode === value}
                        onPress={() => changeDraft({ amountMode: value })}
                      />
                    ))}
                  </View>
                  <Text style={{ color: muted, fontSize: 12 }}>
                    Compared in each account&apos;s currency
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      accessibilityLabel={draft.amountMode === 'BETWEEN' ? 'Minimum' : 'Amount'}
                      accessibilityState={{ disabled: draft.amountMode === 'ANY' }}
                      editable={draft.amountMode !== 'ANY'}
                      placeholder={draft.amountMode === 'BETWEEN' ? 'Minimum' : 'Amount'}
                      placeholderTextColor={muted}
                      keyboardType="decimal-pad"
                      value={draft.amount}
                      onChangeText={(amount) => changeDraft({ amount })}
                      style={[
                        inputStyle,
                        { flex: 1, minWidth: 0, opacity: draft.amountMode === 'ANY' ? 0.55 : 1 },
                      ]}
                    />
                    {draft.amountMode === 'BETWEEN' ? (
                      <TextInput
                        accessibilityLabel="Maximum"
                        placeholder="Maximum"
                        placeholderTextColor={muted}
                        keyboardType="decimal-pad"
                        value={draft.maximum}
                        onChangeText={(maximum) => changeDraft({ maximum })}
                        style={[inputStyle, { flex: 1, minWidth: 0 }]}
                      />
                    ) : (
                      <View style={{ flex: 1 }} />
                    )}
                  </View>
                  {!amountValid && (
                    <Text style={{ color: '#ffb5a8' }}>
                      {draft.amountMode === 'BETWEEN' && firstAmount !== null && maximum !== null
                        ? 'Minimum must not exceed maximum.'
                        : 'Enter an amount (up to 2 decimals).'}
                    </Text>
                  )}
                </>,
              )}
              <View
                style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#41505a' }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Show results"
                  accessibilityState={{ disabled: !dateValid || !amountValid }}
                  disabled={!dateValid || !amountValid}
                  onPress={apply}
                  style={{
                    alignItems: 'center',
                    padding: 14,
                    borderRadius: 12,
                    backgroundColor: dateValid && amountValid ? accent : '#495259',
                  }}
                >
                  <Text
                    style={{ color: dateValid && amountValid ? '#10241e' : ink, fontWeight: '700' }}
                  >
                    Show results
                  </Text>
                </Pressable>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setOpen(false)}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#75828a',
                    }}
                  >
                    <Text style={{ color: ink }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setDraft({ ...initialFilters, query: filters.query });
                      setCategoryQuery('');
                    }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#a66666',
                    }}
                  >
                    <Text style={{ color: '#ffb5a8' }}>Clear all</Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
