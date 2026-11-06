import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Stack, router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, AppState, FlatList, Pressable, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { homeData, type HomeTransaction } from '@/lib/home-data';
import type { MonthlySummary } from '@/lib/reports';
import { formatEpochDay, formatTransactionAmount, transactionTitle } from '@/lib/transaction-format';
import { HomeAccountPicker } from '@/components/home-account-picker';
import { listAccounts, type Account } from '@/lib/database';
import { resolveHomeAccount, watchHomeReopen } from '@/lib/account-selection';
import { theme } from '@/theme';

function amount(type: 'EXPENSE' | 'INCOME' | 'TRANSFER', minor: number, currency: string) {
  if (currency !== 'BDT') return formatTransactionAmount(type, minor, currency);
  const sign = type === 'EXPENSE' ? '−' : type === 'INCOME' ? '+' : '';
  return `${sign}৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

const colors = { ...theme.colors, panel: theme.colors.surface };

export default function HomeScreen() {
  const selection = useRef<number | null | undefined>(undefined);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => watchHomeReopen(AppState, () => {
    selection.current = undefined;
    setRevision((value) => value + 1);
  }), []);
  const [rows, setRows] = useState<HomeTransaction[]>([]);
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    listAccounts().then(async (items) => {
      const id = resolveHomeAccount(items, selection.current);
      if (!active) return;
      const result = await homeData(new Date(), id);
      if (active) {
        selection.current = id;
        setAccountId(id); setAccounts(items);
        setRows(result.rows); setSummaries(result.summaries); setLoaded(true);
      }
    }).catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // Revision reloads the focused view after selection, reopening, or retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  useFocusEffect(load);
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><SymbolView name={{ ios: 'gearshape', android: 'settings' }} size={26} tintColor={colors.text} /></Pressable> }} />
    <StatusBar style="light" />
    <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
      data={rows} keyExtractor={(row) => String(row.id)}
      ListHeaderComponent={<View style={{ gap: 20, paddingBottom: 12 }}>
        <HomeAccountPicker accounts={accounts} selectedId={accountId} onSelect={(id) => { selection.current = id; setRevision((value) => value + 1); }} />
        <View style={{ backgroundColor: colors.panel, borderRadius: 16, borderCurve: 'continuous', padding: 18, gap: 12 }}>
          <Text style={{ color: colors.muted }}>This month · excluding unreported transactions</Text>
          {loading && !loaded ? <ActivityIndicator accessibilityLabel="Loading Home" color={colors.accent} /> : error && !loaded ? null : summaries.length === 0 ? <Text style={{ color: colors.text }}>No reportable activity this month</Text> : summaries.map((summary) => <View key={summary.currencyCode} style={{ gap: 6 }}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>{summary.currencyCode}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <View><Text style={{ color: colors.muted }}>Expenses</Text><Text selectable style={{ color: colors.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{amount('TRANSFER', summary.expenseMinor, summary.currencyCode)}</Text></View>
              <View><Text style={{ color: colors.muted }}>Income</Text><Text selectable style={{ color: colors.accent, fontSize: 18, fontVariant: ['tabular-nums'] }}>{amount('TRANSFER', summary.incomeMinor, summary.currencyCode)}</Text></View>
            </View>
          </View>)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>Recent activity</Text>
          <Link href={{ pathname: '/transactions', params: accountId === null ? {} : { accountId: String(accountId) } }} asChild><Pressable disabled={loading} accessibilityState={{ disabled: loading }} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}><Text style={{ color: colors.accent }}>{accountId === null ? 'Search all' : 'Search account'}</Text></Pressable></Link>
        </View>
        {error && <View style={{ gap: 8 }}><Text selectable accessibilityRole="alert" style={{ color: colors.warning }}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.accent }}>Retry</Text></Pressable></View>}
        {loaded && !error && rows.length === 0 && <Text style={{ color: colors.muted }}>{accountId === null ? 'No transactions yet. Add one to get started.' : 'No transactions in this account. Add one or choose another account.'}</Text>}
      </View>}
      renderItem={({ item, index }) => {
        const title = transactionTitle(item);
        const scopedTransfer = item.type === 'TRANSFER' && accountId !== null;
        const incoming = scopedTransfer && item.transferAccountId === accountId;
        const detail = scopedTransfer ? incoming ? `Received from ${item.accountName}` : `Sent to ${item.transferAccountName}` : `${item.accountName}${item.transferAccountName ? ` → ${item.transferAccountName}` : ''}`;
        const displayAmount = scopedTransfer ? `${incoming ? '+' : '−'}${amount('TRANSFER', item.amountMinor, item.currencyCode)}` : amount(item.type, item.amountMinor, item.currencyCode);
        return <View>
        {(index === 0 || rows[index - 1].date !== item.date) && <Text style={{ color: colors.muted, fontWeight: '700', paddingTop: 16, paddingBottom: 4 }}>{formatEpochDay(item.date)}</Text>}
        <Pressable onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(item.id) } })} accessibilityRole="button" accessibilityLabel={`${title}, ${item.accountName}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ flex: 1, gap: 4 }}><Text selectable style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text><Text selectable style={{ color: colors.muted }}>{detail}{item.note ? ` · ${item.note}` : ''}</Text></View>
          <Text selectable style={{ color: item.type === 'INCOME' || incoming ? colors.accent : colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{displayAmount}</Text>
        </Pressable>
      </View>; }}
    />
    <Pressable onPress={() => router.push({ pathname: '/quick-add', params: accountId === null ? {} : { accountId: String(accountId) } })} disabled={loading} accessibilityState={{ disabled: loading }} accessibilityRole="button" accessibilityLabel="Add transaction" style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: 16, width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' })}><SymbolView name={{ ios: 'plus', android: 'add' }} size={30} tintColor={colors.background} /></Pressable>
  </View>;
}
