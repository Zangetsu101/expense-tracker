import { useCallback, useState } from 'react';
import { Link, Stack, router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { homeData, type DailySummary, type HomeTransaction } from '@/lib/home-data';
import type { MonthlySummary } from '@/lib/reports';
import { formatActivityDay, formatTransactionAmount, transactionTitle } from '@/lib/transaction-format';
import { theme } from '@/theme';

function amount(type: 'EXPENSE' | 'INCOME' | 'TRANSFER', minor: number, currency: string) {
  if (currency !== 'BDT') return formatTransactionAmount(type, minor, currency);
  const sign = type === 'EXPENSE' ? '−' : type === 'INCOME' ? '+' : '';
  return `${sign}৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

const colors = { ...theme.colors, panel: theme.colors.surface };

export default function HomeScreen() {
  const [rows, setRows] = useState<HomeTransaction[]>([]);
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setRows([]);
    setSummaries([]);
    setDailySummaries([]);
    homeData().then((result) => {
      if (active) { setRows(result.rows); setSummaries(result.summaries); setDailySummaries(result.dailySummaries); }
    }).catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useFocusEffect(load);
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ headerRight: () => <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" style={{ minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}><SymbolView name={{ ios: 'gearshape', android: 'settings' }} size={26} tintColor={colors.text} /></Pressable> }} />
    <StatusBar style="light" />
    <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
      data={rows} keyExtractor={(row) => String(row.id)}
      ListHeaderComponent={<View style={{ gap: 20, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>Recent activity</Text>
          <Link href="/transactions" asChild><Pressable accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}><Text style={{ color: colors.accent }}>Search all</Text></Pressable></Link>
        </View>
        <View style={{ backgroundColor: colors.panel, borderRadius: 16, borderCurve: 'continuous', padding: 18, gap: 12 }}>
          <Text style={{ color: colors.muted }}>This month · excluding unreported transactions</Text>
          {summaries.length === 0 ? <Text style={{ color: colors.text }}>No reportable activity this month</Text> : summaries.map((summary) => <View key={summary.currencyCode} style={{ gap: 6 }}>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>{summary.currencyCode}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <View><Text style={{ color: colors.muted }}>Expenses</Text><Text selectable style={{ color: colors.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{amount('TRANSFER', summary.expenseMinor, summary.currencyCode)}</Text></View>
              <View><Text style={{ color: colors.muted }}>Income</Text><Text selectable style={{ color: colors.accent, fontSize: 18, fontVariant: ['tabular-nums'] }}>{amount('TRANSFER', summary.incomeMinor, summary.currencyCode)}</Text></View>
            </View>
          </View>)}
        </View>
        {loading && <ActivityIndicator color={colors.accent} />}
        {error && <Text selectable accessibilityRole="alert" style={{ color: colors.text }}>{error}</Text>}
        {!loading && !error && rows.length === 0 && <Text style={{ color: colors.muted }}>No transactions yet. Add one to get started.</Text>}
      </View>}
      renderItem={({ item, index }) => { const title = transactionTitle(item); return <View>
        {(index === 0 || rows[index - 1].date !== item.date) && <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, paddingTop: 16, paddingBottom: 4 }}>
          <Text style={{ color: colors.muted, fontWeight: '700' }}>{formatActivityDay(item.date)}</Text>
          <View style={{ flexShrink: 1, gap: 4 }}>
            {dailySummaries.filter((summary) => summary.date === item.date && (summary.expenseMinor !== 0 || summary.incomeMinor !== 0)).map((summary) => <View key={summary.currencyCode} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 12 }}>
              {summary.expenseMinor !== 0 && <Text selectable style={{ color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>Spent {amount('TRANSFER', summary.expenseMinor, summary.currencyCode)}</Text>}
              {summary.incomeMinor !== 0 && <Text selectable style={{ color: colors.accent, fontSize: 12, fontVariant: ['tabular-nums'] }}>Earned {amount('TRANSFER', summary.incomeMinor, summary.currencyCode)}</Text>}
            </View>)}
          </View>
        </View>}
        <Pressable onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(item.id) } })} accessibilityRole="button" accessibilityLabel={`${title}, ${item.accountName}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ flex: 1, gap: 4 }}><Text selectable style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{title}</Text><Text selectable style={{ color: colors.muted }}>{item.accountName}{item.transferAccountName ? ` → ${item.transferAccountName}` : ''}{item.note ? ` · ${item.note}` : ''}</Text></View>
          <Text selectable style={{ color: item.type === 'INCOME' ? colors.accent : colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{amount(item.type, item.amountMinor, item.currencyCode)}</Text>
        </Pressable>
      </View>; }}
    />
    <Pressable onPress={() => router.push('/quick-add')} accessibilityRole="button" accessibilityLabel="Add transaction" style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: 16, width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' })}><SymbolView name={{ ios: 'plus', android: 'add' }} size={30} tintColor={colors.background} /></Pressable>
  </View>;
}
