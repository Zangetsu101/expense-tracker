import { useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'expo-router';
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
import { Skeleton } from '@/components/loading';
import type { ManagedCategory } from '@/lib/categories';
import type { Account } from '@/lib/database';
import {
  parseAmountMinor,
  validDate,
  type SearchFilters,
  type SearchRow,
} from '@/lib/transaction-search';
import {
  countLabel,
  formatEpochDay,
  formatTransactionAmount,
  transactionTitle,
} from '@/lib/transaction-format';
import type { FilterOptions } from './queries.ts';

const ink = '#edf1f4';
const muted = '#a2acb5';
const accent = '#88d7bc';
const danger = '#ffb5a8';
export const initialFilters: SearchFilters = {
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
const inputStyle = {
  backgroundColor: '#303c44',
  color: ink,
  padding: 12,
  borderRadius: 12,
} as const;

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

function RetryRow({
  message,
  label = 'Retry',
  retry,
}: {
  message: string;
  label?: string;
  retry: () => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="alert" selectable style={{ color: danger }}>
        {message}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        <Choice label={label} selected={false} onPress={retry} />
      </View>
    </View>
  );
}

export function SearchLayout({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1, backgroundColor: '#10181d' }}>{children}</View>;
}

/** The fixed header above the results. It stays mounted while the results load or fail. */
export function SearchHeader({
  query,
  onQuery,
  onEditFilters,
  chips,
}: {
  query: string;
  onQuery: (query: string) => void;
  onEditFilters: () => void;
  chips: ReactNode;
}) {
  return (
    <View style={{ gap: 14, padding: 16, paddingBottom: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: ink, fontSize: 21, fontWeight: '700', flex: 1 }}>
          Find a transaction
        </Text>
        <Choice label="Edit filters" selected={false} onPress={onEditFilters} />
      </View>
      <TextInput
        accessibilityLabel="Search transactions"
        placeholder="Search note, category or account"
        placeholderTextColor={muted}
        value={query}
        onChangeText={onQuery}
        style={inputStyle}
      />
      {chips}
    </View>
  );
}

function pathOf(categories: ManagedCategory[], category: ManagedCategory) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const names = [category.name];
  const seen = new Set([category.id]);
  let parent = category.parentId == null ? undefined : byId.get(category.parentId);
  while (parent && !seen.has(parent.id)) {
    names.unshift(parent.name);
    seen.add(parent.id);
    parent = parent.parentId == null ? undefined : byId.get(parent.parentId);
  }
  return names.join(' › ');
}

/** Without `options`, the category and account chips show "Selected". */
export function ActiveFilterChips({
  filters,
  options,
  onClear,
}: {
  filters: SearchFilters;
  options?: FilterOptions;
  onClear: (clear: Partial<SearchFilters>) => void;
}) {
  const active: { label: string; clear: Partial<SearchFilters> }[] = [];
  if (filters.datePreset !== 'ANY')
    active.push({
      label: `Date: ${dates.find((d) => d.value === filters.datePreset)?.label}`,
      clear: { datePreset: 'ANY', startDate: '', endDate: '' },
    });
  if (filters.categoryId != null) {
    const category = options?.categories.find((item) => item.id === filters.categoryId);
    active.push({
      label: `Category: ${category ? pathOf(options!.categories, category) : 'Selected'}`,
      clear: { categoryId: null },
    });
  }
  if (filters.accountId !== null)
    active.push({
      label: `Account: ${options?.accounts.find((a) => a.id === filters.accountId)?.name ?? 'Selected'}`,
      clear: { accountId: null },
    });
  if (filters.type !== 'ALL')
    active.push({ label: `Type: ${filters.type.toLowerCase()}`, clear: { type: 'ALL' } });
  if (filters.amountMode !== 'ANY')
    active.push({
      label: `Amount: ${modes.find((m) => m.value === filters.amountMode)?.label} ${filters.amount}${filters.amountMode === 'BETWEEN' ? `–${filters.maximum}` : ''}`,
      clear: { amountMode: 'ANY', amount: '', maximum: '' },
    });
  if (active.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {active.map(({ label, clear }) => (
        <Choice key={label} label={`${label} ×`} selected onPress={() => onClear(clear)} />
      ))}
    </View>
  );
}

function CountLine({ rows, hasMore }: { rows: SearchRow[]; hasMore: boolean }) {
  return (
    <Text style={{ color: muted }}>
      {countLabel(rows.length, 'result', 'results', hasMore)}
      {rows.length > 0
        ? ` · ${[...new Set(rows.map((r) => r.currencyCode))].map((currency) => `${rows.filter((r) => r.currencyCode === currency).length} ${currency}`).join(' · ')}${hasMore ? ' loaded' : ''}`
        : ''}
    </Text>
  );
}

function ResultRow({ item, showDate }: { item: SearchRow; showDate: boolean }) {
  const title = item.lendingKind
    ? transactionTitle(item)
    : item.note?.trim() || transactionTitle(item);
  const detail =
    item.type === 'TRANSFER'
      ? `${item.accountName} → ${item.transferAccountName ?? 'Account'} · ${item.currencyCode}`
      : `${transactionTitle(item)} · ${item.accountName}`;
  return (
    <View style={{ gap: 8, paddingBottom: 9 }}>
      {showDate && (
        <Text style={{ color: '#f4d79a', fontWeight: '700', paddingTop: 12 }}>
          {formatEpochDay(item.date)}
        </Text>
      )}
      <Link href={{ pathname: '/transaction/[id]', params: { id: String(item.id) } }} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View receipt for ${item.type.toLowerCase()} transaction, ${title}`}
        >
          <RowCard transfer={item.type === 'TRANSFER'}>
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
          </RowCard>
        </Pressable>
      </Link>
    </View>
  );
}

function RowCard({ transfer = false, children }: { transfer?: boolean; children: ReactNode }) {
  return (
    <View
      style={{
        padding: 16,
        backgroundColor: transfer ? '#222c38' : '#1c242a',
        borderRadius: 4,
        gap: 6,
        borderLeftWidth: transfer ? 3 : 0,
        borderLeftColor: '#8da8dc',
      }}
    >
      {children}
    </View>
  );
}

const listContent = { padding: 16, paddingTop: 14, paddingBottom: 24 };

export function ResultsList({
  rows,
  hasMore,
  muted: stale,
  alert,
  footer,
  onEndReached,
}: {
  rows: SearchRow[];
  hasMore: boolean;
  muted: boolean;
  alert: ReactNode;
  footer: ReactElement;
  onEndReached: () => void;
}) {
  return (
    <View
      pointerEvents={stale ? 'none' : 'auto'}
      accessibilityElementsHidden={stale}
      importantForAccessibility={stale ? 'no-hide-descendants' : 'auto'}
      style={{ flex: 1, opacity: stale ? 0.4 : 1 }}
    >
      <FlatList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ flex: 1 }}
        contentContainerStyle={listContent}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={
          <View style={{ gap: 14, paddingBottom: 18 }}>
            <CountLine rows={rows} hasMore={hasMore} />
            {alert}
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: ink, padding: 20 }}>
            No transactions match. Try clearing a filter.
          </Text>
        }
        renderItem={({ item, index }) => (
          <ResultRow item={item} showDate={index === 0 || rows[index - 1].date !== item.date} />
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={footer}
      />
    </View>
  );
}

export function ResultsFooter({
  fetchingNext,
  failed,
  hasMore,
  onMore,
}: {
  fetchingNext: boolean;
  failed: boolean;
  hasMore: boolean;
  onMore: () => void;
}) {
  if (fetchingNext) return <ActivityIndicator color={accent} />;
  if (failed) return <RetryRow message="Could not load more results." retry={onMore} />;
  if (hasMore) return <Choice label="Load more" selected={false} onPress={onMore} />;
  return null;
}

export function RefreshAlert({ retry }: { retry: () => void }) {
  return <RetryRow message="Could not refresh results." retry={retry} />;
}

export function ResultsSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading results"
      style={[listContent, { gap: 9 }]}
    >
      <View style={{ paddingBottom: 18 }}>
        <Skeleton width="40%" />
      </View>
      <Skeleton width={110} height={16} />
      {[0, 1, 2, 3, 4].map((key) => (
        <RowCard key={key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <Skeleton width="55%" height={18} />
            <Skeleton width={72} height={18} />
          </View>
          <Skeleton width="40%" height={12} />
        </RowCard>
      ))}
    </View>
  );
}

export function ResultsError({ retry }: { retry: () => void }) {
  return (
    <View style={listContent}>
      <RetryRow message="Could not load results." retry={retry} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <Text style={{ color: muted, fontWeight: '700' }}>{title}</Text>
      {children}
    </View>
  );
}

type DraftProps = {
  draft: SearchFilters;
  changeDraft: (patch: Partial<SearchFilters>) => void;
};

export function CategoryChoices({
  categories,
  draft,
  changeDraft,
  query,
  onQuery,
}: DraftProps & {
  categories: ManagedCategory[];
  query: string;
  onQuery: (query: string) => void;
}) {
  const [categoryWidth, setCategoryWidth] = useState(0);
  const [chipWidths, setChipWidths] = useState<Record<string, number>>({});
  const all = [{ id: null, name: 'All categories', type: '' }, ...categories];
  const choices = all.filter((c) =>
    (c.id === null ? c.name : pathOf(categories, c))
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const label = (c: (typeof all)[number]) =>
    c.id !== null ? `${pathOf(categories, c)} · ${c.type.toLowerCase()}` : c.name;
  const rows: (typeof all)[] = [[], []];
  let used = 0;
  let row = 0;
  for (const category of choices) {
    const width = chipWidths[String(category.id)];
    if (!categoryWidth || !width) continue;
    if (used && used + 8 + width > categoryWidth) {
      row++;
      used = 0;
    }
    if (row > 1) break;
    rows[row].push(category);
    used += (used ? 8 : 0) + width;
  }
  const overflow = choices.length > rows[0].length + rows[1].length;
  const chip = (c: (typeof all)[number]) => (
    <Choice
      key={String(c.id)}
      label={label(c)}
      selected={draft.categoryId === c.id}
      onPress={() => changeDraft({ categoryId: c.id })}
    />
  );
  return (
    <Section title="Category">
      <TextInput
        accessibilityLabel="Search categories"
        placeholder="Search categories"
        placeholderTextColor={muted}
        value={query}
        onChangeText={onQuery}
        style={inputStyle}
      />
      <View onLayout={(event) => setCategoryWidth(event.nativeEvent.layout.width)}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', opacity: 0, flexDirection: 'row' }}
        >
          {all.map((c) => (
            <View
              key={String(c.id)}
              onLayout={(event) => {
                const width = event.nativeEvent.layout.width;
                setChipWidths((old) =>
                  old[String(c.id)] === width ? old : { ...old, [String(c.id)]: width },
                );
              }}
            >
              {chip(c)}
            </View>
          ))}
        </View>
        <View style={{ gap: 8 }}>
          {rows.map((items, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: 8 }}>
              {items.map(chip)}
            </View>
          ))}
        </View>
        {choices.length === 0 && (
          <Text style={{ color: muted, padding: 12 }}>No matching categories</Text>
        )}
        {overflow && (
          <Text style={{ color: muted, fontSize: 12, paddingTop: 4 }}>
            Refine search to see more
          </Text>
        )}
      </View>
    </Section>
  );
}

export function AccountChoices({
  accounts,
  draft,
  changeDraft,
}: DraftProps & { accounts: Account[] }) {
  return (
    <Section title="Account">
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
      </View>
    </Section>
  );
}

function ChipSkeletons({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {Array.from({ length: count }, (_, key) => (
        <Skeleton key={key} width={88} height={40} borderRadius={12} />
      ))}
    </View>
  );
}

export function OptionsSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading categories and accounts">
      <Section title="Category">
        <TextInput
          editable={false}
          accessible={false}
          placeholder="Search categories"
          placeholderTextColor={muted}
          style={[inputStyle, { opacity: 0.55 }]}
        />
        <ChipSkeletons count={6} />
      </Section>
      <Section title="Account">
        <ChipSkeletons count={3} />
      </Section>
    </View>
  );
}

export function OptionsError({ retry }: { retry: () => void }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <RetryRow
        message="Could not load categories and accounts."
        label="Retry categories and accounts"
        retry={retry}
      />
    </View>
  );
}

export function FilterModal({
  open,
  draft,
  changeDraft,
  options,
  onApply,
  onClearAll,
  onClose,
}: DraftProps & {
  open: boolean;
  options: ReactNode;
  onApply: () => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
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
  const valid = dateValid && amountValid;
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' }}
      >
        <Pressable
          accessibilityLabel="Dismiss filters"
          accessibilityRole="button"
          onPress={onClose}
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
            <Section title="Date">
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
                    <Text style={{ color: danger }}>
                      Enter valid dates with start on or before end.
                    </Text>
                  )}
                </>
              )}
            </Section>
            {options}
            <Section title="Type">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {types.map((type) => (
                  <Choice
                    key={type}
                    label={type === 'ALL' ? 'All types' : type.toLowerCase()}
                    selected={draft.type === type}
                    onPress={() => changeDraft({ type })}
                  />
                ))}
              </View>
            </Section>
            <Section title="Amount">
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
                    onChangeText={(value) => changeDraft({ maximum: value })}
                    style={[inputStyle, { flex: 1, minWidth: 0 }]}
                  />
                ) : (
                  <View style={{ flex: 1 }} />
                )}
              </View>
              {!amountValid && (
                <Text style={{ color: danger }}>
                  {draft.amountMode === 'BETWEEN' && firstAmount !== null && maximum !== null
                    ? 'Minimum must not exceed maximum.'
                    : 'Enter an amount (up to 2 decimals).'}
                </Text>
              )}
            </Section>
            <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#41505a' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show results"
                accessibilityState={{ disabled: !valid }}
                disabled={!valid}
                onPress={onApply}
                style={{
                  alignItems: 'center',
                  padding: 14,
                  borderRadius: 12,
                  backgroundColor: valid ? accent : '#495259',
                }}
              >
                <Text style={{ color: valid ? '#10241e' : ink, fontWeight: '700' }}>
                  Show results
                </Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onClose}
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
                  onPress={onClearAll}
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#a66666',
                  }}
                >
                  <Text style={{ color: danger }}>Clear all</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
