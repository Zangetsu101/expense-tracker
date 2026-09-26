import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { combinedMinor, getDisplayRate, saveDisplayRate, validDisplayRate, type DisplayRate } from '@/lib/display-rate';
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
  const [rate, setRate] = useState<DisplayRate | null>(null);
  const [base, setBase] = useState('');
  const [quote, setQuote] = useState('');
  const [rateText, setRateText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    Promise.all([accountBalances(), monthlyReport(month.year, month.number), getDisplayRate()])
      .then(([balances, monthly, storedRate]) => {
        if (active) {
          setReport({ balances, ...monthly });
          setRate(storedRate);
          setBase(storedRate?.base ?? '');
          setQuote(storedRate?.quote ?? '');
          setRateText(storedRate ? String(storedRate.rate) : '');
        }
      })
      .catch((e) => { if (active) setError(String(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month]);
  useFocusEffect(load);
  const shiftMonth = (delta: number) => setMonth(({ year, number }) => {
    const date = new Date(year, number - 1 + delta, 1);
    return { year: date.getFullYear(), number: date.getMonth() + 1 };
  });

  const draft = { base: base.trim().toUpperCase(), quote: quote.trim().toUpperCase(), rate: Number(rateText) };
  const save = async (next: DisplayRate | null) => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveDisplayRate(next);
      setRate(next);
      if (!next) { setBase(''); setQuote(''); setRateText(''); }
    } catch (e) { setSaveError(String(e)); }
    finally { setSaving(false); }
  };
  const currencies = report ? new Set([...report.balances, ...report.summaries].map((row) => row.currencyCode)) : new Set<string>();
  const combinedBalance = report ? combinedMinor(report.balances.map((row) => ({ currencyCode: row.currencyCode, amountMinor: row.balanceMinor })), rate) : null;
  const combinedIncome = report ? combinedMinor(report.summaries.map((row) => ({ currencyCode: row.currencyCode, amountMinor: row.incomeMinor })), rate) : null;
  const combinedExpense = report ? combinedMinor(report.summaries.map((row) => ({ currencyCode: row.currencyCode, amountMinor: row.expenseMinor })), rate) : null;

  return <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 24 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => shiftMonth(-1)} style={{ padding: 12 }}><Text>‹ Previous</Text></Pressable>
      <Text selectable style={{ fontWeight: '600' }}>{new Date(month.year, month.number - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => shiftMonth(1)} style={{ padding: 12 }}><Text>Next ›</Text></Pressable>
    </View>
    {loading ? <ActivityIndicator /> : error ? <View style={{ gap: 12 }}><Text selectable accessibilityRole="alert">{error}</Text><Pressable accessibilityRole="button" onPress={load}><Text>Retry</Text></Pressable></View> : report && <>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Display rate</Text>
        <Text selectable>1 base currency = rate × quote currency. Used for display only.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput accessibilityLabel="Base currency" placeholder="Base (USD)" autoCapitalize="characters" maxLength={3} value={base} onChangeText={setBase} style={{ flex: 1, borderWidth: 1, padding: 10 }} />
          <TextInput accessibilityLabel="Quote currency" placeholder="Quote (BDT)" autoCapitalize="characters" maxLength={3} value={quote} onChangeText={setQuote} style={{ flex: 1, borderWidth: 1, padding: 10 }} />
        </View>
        <TextInput accessibilityLabel="Quote units per base unit" placeholder="Rate" keyboardType="decimal-pad" value={rateText} onChangeText={setRateText} style={{ borderWidth: 1, padding: 10 }} />
        <View style={{ flexDirection: 'row', gap: 20 }}>
          <Pressable accessibilityRole="button" disabled={saving || !validDisplayRate(draft)} onPress={() => save(draft)}><Text style={{ opacity: saving || !validDisplayRate(draft) ? 0.4 : 1 }}>Save rate</Text></Pressable>
          {rate && <Pressable accessibilityRole="button" disabled={saving} onPress={() => save(null)}><Text>Clear rate</Text></Pressable>}
        </View>
        {saveError && <Text selectable accessibilityRole="alert">{saveError}</Text>}
        {currencies.size > 2 && <Text selectable>Combined totals unavailable for more than two currencies.</Text>}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Account balances</Text>
        {currencies.size <= 2 && combinedBalance !== null && (new Set(report.balances.map((row) => row.currencyCode))).size === 2 && rate && <Text selectable>Combined: {money(combinedBalance, rate.base)}</Text>}
        {report.balances.length === 0 && <Text>No accounts yet.</Text>}
        {report.balances.map((row) => <View key={row.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}><Text selectable style={{ flex: 1 }}>{row.name}</Text><Text selectable style={{ fontVariant: ['tabular-nums'] }}>{money(row.balanceMinor, row.currencyCode)}</Text></View>)}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600' }}>Monthly income and expense</Text>
        {currencies.size <= 2 && combinedIncome !== null && combinedExpense !== null && report.summaries.length === 2 && rate && <Text selectable>Combined: income {money(combinedIncome, rate.base)} · expense {money(combinedExpense, rate.base)}</Text>}
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
