import { useCallback, useRef, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { listAccounts, type Account } from '@/lib/database';
import { PAGE_SIZE, searchTransactions, type SearchFilters, type SearchRow } from '@/lib/transaction-search';

const types: SearchFilters['type'][] = ['ALL', 'EXPENSE', 'INCOME', 'TRANSFER'];
function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

export default function TransactionsScreen() {
  const [filters, setFilters] = useState<SearchFilters>({ query: '', type: 'ALL', accountId: null, month: '' });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const change = (patch: Partial<SearchFilters>) => setFilters((previous) => ({ ...previous, ...patch }));
  useFocusEffect(useCallback(() => {
    let active = true;
    listAccounts().then((items) => { if (active) setAccounts(items); }).catch((e) => { if (active) setError(String(e)); });
    setRevision((value) => value + 1);
    return () => { active = false; };
  }, []));
  useFocusEffect(useCallback(() => {
    let active = true;
    const generation = ++request.current;
    setLoading(true);
    setError(undefined);
    setRows([]);
    setMore(false);
    searchTransactions(filters).then((items) => {
      if (active && request.current === generation) { setRows(items); setMore(items.length === PAGE_SIZE); }
    }).catch((e) => { if (active && request.current === generation) setError(String(e)); }).finally(() => { if (active && request.current === generation) setLoading(false); });
    return () => { active = false; };
  }, [filters, revision]));
  const loadMore = async () => {
    if (loading || !more) return;
    const generation = request.current;
    setLoading(true);
    try {
      const items = await searchTransactions(filters, rows.length);
      if (generation !== request.current) return;
      setRows((previous) => [...previous, ...items]);
      setMore(items.length === PAGE_SIZE);
    } catch (e) { if (generation === request.current) setError(String(e)); } finally { if (generation === request.current) setLoading(false); }
  };
  return <FlatList contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    style={{ backgroundColor: '#f6f6f8' }} contentContainerStyle={{ padding: 16, gap: 10 }}
    data={rows} keyExtractor={(item) => String(item.id)}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      <TextInput accessibilityLabel="Search note, category or account" placeholder="Search note, category or account" value={filters.query} onChangeText={(query) => change({ query })} style={{ backgroundColor: 'white', padding: 12, borderRadius: 10 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{types.map((type) => <Pressable key={type} accessibilityRole="button" accessibilityState={{ selected: filters.type === type }} onPress={() => change({ type })} style={{ padding: 10, borderRadius: 10, backgroundColor: filters.type === type ? '#315fcb' : '#e8eaf0' }}><Text style={{ color: filters.type === type ? 'white' : '#222' }}>{type === 'ALL' ? 'All types' : type.toLowerCase()}</Text></Pressable>)}</View>
      <Text style={{ fontWeight: '600' }}>Account</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[{ id: null, name: 'All accounts' }, ...accounts].map((account) => <Pressable key={account.id ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: filters.accountId === account.id }} onPress={() => change({ accountId: account.id })} style={{ padding: 10, borderRadius: 10, backgroundColor: filters.accountId === account.id ? '#315fcb' : '#e8eaf0' }}><Text style={{ color: filters.accountId === account.id ? 'white' : '#222' }}>{account.name}</Text></Pressable>)}</View>
      <Text style={{ fontWeight: '600' }}>Month</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{['', currentMonth()].map((month) => <Pressable key={month} accessibilityRole="button" accessibilityState={{ selected: filters.month === month }} onPress={() => change({ month })} style={{ padding: 10, borderRadius: 10, backgroundColor: filters.month === month ? '#315fcb' : '#e8eaf0' }}><Text style={{ color: filters.month === month ? 'white' : '#222' }}>{month || 'Any month'}</Text></Pressable>)}</View>
      <TextInput accessibilityLabel="Month (YYYY-MM)" placeholder="YYYY-MM (optional)" value={filters.month} onChangeText={(month) => change({ month })} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={{ backgroundColor: 'white', padding: 12, borderRadius: 10 }} />
      {error && <Text accessibilityRole="alert" selectable>{error}</Text>}
      {!loading && !error && rows.length === 0 && <Text>No matching transactions.</Text>}
    </View>}
    renderItem={({ item }) => {
      const details = <>
        <Text style={{ fontWeight: '600' }}>{item.categoryName ?? item.type} · {item.accountName}{item.transferAccountName ? ` → ${item.transferAccountName}` : ''}</Text>
        <Text>{item.type === 'EXPENSE' ? '−' : item.type === 'INCOME' ? '+' : ''}{new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currencyCode }).format(item.amountMinor / 100)} · {new Date(item.date * 86400000).toISOString().slice(0, 10)}</Text>
        {!!item.note && <Text selectable>{item.note}</Text>}
      </>;
      const style = { padding: 14, borderRadius: 10, backgroundColor: 'white', gap: 4 } as const;
      if (item.type === 'TRANSFER') return <View style={style}>{details}</View>;
      return <Link href={{ pathname: '/transaction/[id]', params: { id: String(item.id) } }} asChild>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.type.toLowerCase()} transaction, ${item.categoryName ?? item.accountName}`} style={style}>{details}</Pressable>
      </Link>;
    }}
    ListFooterComponent={loading ? <ActivityIndicator /> : more ? <Pressable accessibilityRole="button" onPress={() => void loadMore()} style={{ padding: 16 }}><Text>Load more</Text></Pressable> : null}
  />;
}
