import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { backupDocuments, backupStore } from '@/lib/backup-adapter';
import { importMoneyLoverFile } from '@/lib/import-csv';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { recentTransactions, type TransactionRow } from '@/lib/database';

export default function HomeScreen() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    recentTransactions().then(setRows).catch((e) => setError(String(e))).finally(() => setLoading(false));
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
  return <FlatList contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 20, gap: 12 }}
    data={rows} keyExtractor={(row) => String(row.id)}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      <Link href="/quick-add" asChild><Pressable accessibilityRole="button" style={{ padding: 16, backgroundColor: '#315fcb', borderRadius: 12 }}><Text style={{ color: 'white', fontWeight: 'bold' }}>Add transaction</Text></Pressable></Link>
      <Link href="./transfer" asChild><Pressable accessibilityRole="button" style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12 }}><Text style={{ fontWeight: '600' }}>Transfer between accounts</Text></Pressable></Link>
      <Link href="./transactions" asChild><Pressable accessibilityRole="button" style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12 }}><Text style={{ fontWeight: '600' }}>Search transactions</Text></Pressable></Link>
      <Link href="/accounts" asChild><Pressable accessibilityRole="button" style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12 }}><Text style={{ fontWeight: '600' }}>Manage accounts</Text></Pressable></Link>
      <Link href="/reports" asChild><Pressable accessibilityRole="button" style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12 }}><Text style={{ fontWeight: '600' }}>Balances and reports</Text></Pressable></Link>
      <Link href="./review-queue" asChild><Pressable accessibilityRole="button" style={{ padding: 16, backgroundColor: '#e8eaf0', borderRadius: 12 }}><Text style={{ fontWeight: '600' }}>Review transfer candidates</Text></Pressable></Link>
      <Pressable accessibilityRole="button" onPress={() => void run(() => exportBackup(backupStore, backupDocuments))}><Text>Export JSON to chosen folder</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void run(exportTransactionsCsv)}><Text>Export Transactions CSV (portability, not backup)</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={confirmRestore}><Text>Restore JSON backup</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void run(() => importMoneyLoverFile(confirmMixedCategories))}><Text>Import MoneyLover CSV</Text></Pressable>
      {loading && <ActivityIndicator />}
      {error && <Text selectable accessibilityRole="alert">{error}</Text>}
      {!loading && !error && rows.length === 0 && <Text>No transactions yet.</Text>}
    </View>}
    renderItem={({ item }) => <View style={{ padding: 16, borderRadius: 12, backgroundColor: '#e8eaf0', gap: 4 }}>
      <Text selectable style={{ fontWeight: '600' }}>{item.categoryName ?? item.type} · {item.accountName}</Text>
      <Text selectable>{item.type === 'EXPENSE' ? '-' : item.type === 'INCOME' ? '+' : ''}{(item.amountMinor / 100).toFixed(2)} · {new Date(item.date * 86400000).toISOString().slice(0, 10)}</Text>
      {item.note && <Text selectable>{item.note}</Text>}
    </View>} />;
}
