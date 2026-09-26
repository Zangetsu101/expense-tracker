import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { accountBalances, monthlyReport, type AccountBalance, type CategorySpending, type MonthlySummary } from '@/lib/reports';

type Report = { balances: AccountBalance[]; spending: CategorySpending[]; summaries: MonthlySummary[] };

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function ReportsScreen() {
  const [month, setMonth] = useState(() => { const now = new Date(); return { year: now.getFullYear(), number: now.getMonth() + 1 }; });
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    Promise.all([accountBalances(), monthlyReport(month.year, month.number)])
      .then(([balances, monthly]) => { if (active) setReport({ balances, ...monthly }); })
      .catch((e) => { if (active) setError(String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);
  useFocusEffect(load);
  const shiftMonth = (delta: number) => setMonth(({ year, number }) => {
    const date = new Date(year, number - 1 + delta, 1);
    return { year: date.getFullYear(), number: date.getMonth() + 1 };
  });

  return <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 24 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shiftMonth(-1)} style={{ padding: 12 }}><Text>‹ Previous</Text></Pressable>
      <Text selectable style={{ fontWeight: '600' }}>{new Date(month.year, month.number - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shiftMonth(1)} style={{ padding: 12 }}><Text>Next ›</Text></Pressable>
    </View>
    {loading ? <ActivityIndicator /> : error ? <View style={{ gap: 12 }}><Text selectable accessibilityRole="alert">{error}</Text><Pressable accessibilityRole="button" onPress={load}><Text>Retry</Text></Pressable></View> : report && <>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Account balances</Text>
        {report.balances.length === 0 && <Text>No accounts yet.</Text>}
        {report.balances.map((row) => <View key={row.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text selectable style={{ flex: 1 }}>{row.name}</Text><Text selectable style={{ fontVariant: ['tabular-nums'] }}>{money(row.balanceMinor, row.currencyCode)}</Text></View>)}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Monthly income and expense</Text>
        {report.summaries.length === 0 && <Text>No reportable transactions this month.</Text>}
        {report.summaries.map((row) => <View key={row.currencyCode} style={{ gap: 4 }}><Text style={{ fontWeight: '600' }}>{row.currencyCode}</Text><Text selectable>Income {money(row.incomeMinor, row.currencyCode)}</Text><Text selectable>Expense {money(row.expenseMinor, row.currencyCode)}</Text></View>)}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Spending by category</Text>
        {report.spending.length === 0 && <Text>No reportable expenses this month.</Text>}
        {report.spending.map((row) => <View key={`${row.currencyCode}:${row.categoryId ?? 'none'}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text selectable style={{ flex: 1 }}>{row.categoryName ?? 'Uncategorized'}</Text><Text selectable style={{ fontVariant: ['tabular-nums'] }}>{money(row.amountMinor, row.currencyCode)}</Text></View>)}
      </View>
    </>}
  </ScrollView>;
}
