import { useCallback, useState } from 'react';
import { Link, Stack, router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { backupDocuments, backupStore } from '@/lib/backup-adapter';
import { importMoneyLoverFile } from '@/lib/import-csv';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { homeData, type HomeTransaction } from '@/lib/home-data';
import type { MonthlySummary } from '@/lib/reports';
import { formatEpochDay, formatTransactionAmount } from '@/lib/transaction-format';

function amount(type: 'EXPENSE' | 'INCOME' | 'TRANSFER', minor: number, currency: string) {
  if (currency !== 'BDT') return formatTransactionAmount(type, minor, currency);
  const sign = type === 'EXPENSE' ? '−' : type === 'INCOME' ? '+' : '';
  return `${sign}৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`;
}

const colors = { background: '#101820', panel: '#1d2a34', line: '#35434d', text: '#f1f5f4', muted: '#b1c0c7', accent: '#8be0be' };

export default function HomeScreen() {
  const [rows, setRows] = useState<HomeTransaction[]>([]);
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setRows([]);
    setSummaries([]);
    homeData().then((result) => {
      if (active) { setRows(result.rows); setSummaries(result.summaries); }
    }).catch((e) => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useFocusEffect(load);
  const run = async (operation: () => Promise<unknown>) => {
    try { await operation(); load(); } catch (e) { Alert.alert('Operation failed', String(e)); }
  };
  const confirmMixedCategories = (names: string[]) => new Promise<boolean>((resolve) => Alert.alert(
    'Mixed Categories',
    `These categories contain both Expenses and Income: ${names.join(', ')}. Create separate Expense and Income categories?`,
    [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: 'Create separate categories', onPress: () => resolve(true) }],
    { cancelable: false },
  ));
  const confirmRestore = () => Alert.alert('Replace all data?', 'Restoring a backup deletes the current database.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Choose backup', style: 'destructive', onPress: () => void run(() => restoreBackup(backupStore, backupDocuments)) },
  ]);
  return <View style={{ flex: 1, backgroundColor: colors.background }}>
    <Stack.Screen options={{ title: 'Home', headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
    <StatusBar style="light" />
    <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, paddingBottom: 100 + insets.bottom }}
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
      renderItem={({ item, index }) => <View>
        {(index === 0 || rows[index - 1].date !== item.date) && <Text style={{ color: colors.muted, fontWeight: '700', paddingTop: 16, paddingBottom: 4 }}>{formatEpochDay(item.date)}</Text>}
        <Pressable onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(item.id) } })} accessibilityRole="button" accessibilityState={{ disabled: item.type === 'TRANSFER' }} accessibilityLabel={`${item.categoryName ?? item.type}, ${item.accountName}`} disabled={item.type === 'TRANSFER'} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ flex: 1, gap: 4 }}><Text selectable style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{item.categoryName ?? item.type}</Text><Text selectable style={{ color: colors.muted }}>{item.accountName}{item.transferAccountName ? ` → ${item.transferAccountName}` : ''}{item.note ? ` · ${item.note}` : ''}</Text></View>
          <Text selectable style={{ color: item.type === 'INCOME' ? colors.accent : colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{amount(item.type, item.amountMinor, item.currencyCode)}</Text>
        </Pressable>
      </View>}
      ListFooterComponent={<View style={{ gap: 16, paddingTop: 32 }}>
        <Text style={{ color: colors.muted, fontWeight: '700' }}>More</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {([['Transfer between accounts', '/transfer'], ['Manage categories', '/categories'], ['Manage accounts', '/accounts'], ['Reports', '/reports'], ['Review transfer candidates', '/review-queue']] as const).map(([label, href]) => <Pressable key={href} onPress={() => router.push(href)} accessibilityRole="button" style={({ pressed }) => ({ backgroundColor: colors.panel, padding: 12, borderRadius: 10, opacity: pressed ? 0.6 : 1 })}><Text style={{ color: colors.text }}>{label}</Text></Pressable>)}
        </View>
        {([['Export JSON to chosen folder', () => run(() => exportBackup(backupStore, backupDocuments))], ['Export Transactions CSV (portability, not backup)', () => run(exportTransactionsCsv)], ['Restore JSON backup', confirmRestore], ['Import MoneyLover CSV', () => run(() => importMoneyLoverFile(confirmMixedCategories))]] as const).map(([label, action]) => <Pressable key={label} accessibilityRole="button" onPress={() => void action()} style={({ pressed }) => ({ paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}><Text style={{ color: colors.accent }}>{label}</Text></Pressable>)}
      </View>}
    />
    <Pressable onPress={() => router.push('/quick-add')} accessibilityRole="button" accessibilityLabel="Add transaction" style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: Math.max(insets.bottom, 16) + 16, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' })}><Text style={{ color: colors.background, fontSize: 30 }}>+</Text></Pressable>
  </View>;
}
