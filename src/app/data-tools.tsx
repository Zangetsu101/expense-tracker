import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { backupDocuments, backupStore } from '@/lib/backup-adapter';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { importMoneyLoverFile } from '@/lib/import-csv';
import { theme } from '@/theme';

const { colors, spacing, radius } = theme;
type Operation = 'backup' | 'restore' | 'export' | 'import';
type Status = { operation: Operation; kind: 'pending' | 'success' | 'cancelled' | 'error'; message: string };
const labels: Record<Operation, string> = { backup: 'Create JSON backup', restore: 'Restore JSON backup', export: 'Export transactions CSV', import: 'Import MoneyLover CSV' };

export default function DataToolsScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>();
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const busy = status?.kind === 'pending';
  usePreventRemove(busy, () => Alert.alert('Operation in progress', 'Finish the current operation before leaving this screen.'));

  function update(next: Status) { if (active.current) setStatus(next); }
  async function run(operation: Operation) {
    if (locked.current || !active.current) return;
    locked.current = true;
    update({ operation, kind: 'pending', message: operation === 'restore' ? 'Waiting for restore confirmation…' : `${labels[operation]} in progress…` });
    let cancelled = false;
    const confirm = (title: string, message: string, confirmLabel: string, destructive = false) => new Promise<boolean>((resolve) => {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(active.current) },
      ], { cancelable: false });
    });
    try {
      let message: string;
      if (operation === 'restore') {
        if (!(await confirm('Replace all data?', 'Restoring a JSON backup deletes the current database. Create a backup first if you want to keep it.', 'Choose backup', true))) cancelled = true;
        if (!cancelled) {
          update({ operation, kind: 'pending', message: 'Choose a JSON backup. Restoring replaces all current data…' });
          cancelled = !(await restoreBackup(backupStore, backupDocuments));
        }
        message = 'Backup restored. Current data has been replaced.';
      } else if (operation === 'import') {
        const count = await importMoneyLoverFile(async (names) => {
          const accepted = await confirm('Mixed categories', `These categories contain both expenses and income: ${names.join(', ')}. Create separate expense and income categories?`, 'Create separate categories');
          cancelled = !accepted;
          return accepted;
        });
        cancelled = cancelled || count === null;
        message = `${count ?? 0} transaction${count === 1 ? '' : 's'} imported.`;
      } else {
        const uri = operation === 'backup' ? await exportBackup(backupStore, backupDocuments) : await exportTransactionsCsv();
        cancelled = uri === null;
        message = operation === 'backup' ? 'JSON backup created.' : 'Transactions CSV exported.';
      }
      update({ operation, kind: cancelled ? 'cancelled' : 'success', message: cancelled ? `${labels[operation]} cancelled.` : message });
    } catch (error) {
      update({ operation, kind: cancelled ? 'cancelled' : 'error', message: cancelled ? `${labels[operation]} cancelled.` : `${labels[operation]} failed. ${error instanceof Error ? error.message : String(error)}` });
    } finally { locked.current = false; }
  }
  function button(operation: Operation, primary = false) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy: busy && status.operation === operation }} disabled={busy} onPress={() => void run(operation)} style={({ pressed }) => ({ minHeight: theme.controlHeight, justifyContent: 'center', alignItems: 'center', padding: spacing.md, borderRadius: radius.control, borderCurve: 'continuous', borderWidth: 1, borderColor: primary ? colors.accent : colors.line, backgroundColor: primary ? colors.accent : colors.background, opacity: busy ? 0.45 : pressed ? 0.7 : 1 })}><Text style={{ color: primary ? colors.background : operation === 'restore' ? colors.warning : colors.text, fontSize: theme.type.body, fontWeight: '600' }}>{labels[operation]}</Text></Pressable>;
  }
  function section(title: string, description: string, children: React.ReactNode) {
    return <View style={{ gap: spacing.md, paddingVertical: spacing.lg, borderTopWidth: 1, borderColor: colors.line }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: theme.type.heading, fontWeight: '600' }}>{title}</Text><Text style={{ color: colors.muted, fontSize: theme.type.body, lineHeight: 23 }}>{description}</Text>{children}</View>;
  }
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing.xl + insets.bottom, gap: spacing.md }}>
    <Stack.Screen options={{ title: 'Data tools', gestureEnabled: !busy, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }} />
    <Text style={{ color: colors.muted, fontSize: theme.type.body, lineHeight: 23 }}>Keep a full backup, take your transactions elsewhere, or bring in your MoneyLover history.</Text>
    {status && <View accessibilityLiveRegion="polite" accessibilityState={{ busy }} style={{ padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.group, borderCurve: 'continuous', gap: spacing.md }}>
      {busy && <ActivityIndicator color={colors.accent} />}
      <Text selectable accessibilityRole={status.kind === 'error' ? 'alert' : undefined} style={{ color: status.kind === 'error' ? colors.warning : colors.text, fontSize: theme.type.body }}>{status.message}</Text>
      {status.kind === 'error' && <Pressable accessibilityRole="button" onPress={() => void run(status.operation)} style={({ pressed }) => ({ minHeight: theme.controlHeight, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, borderCurve: 'continuous', opacity: pressed ? 0.7 : 1 })}><Text style={{ color: colors.text }}>Retry</Text></Pressable>}
      {busy && <Text style={{ color: colors.muted }}>Keep this screen open. You can cancel in the file picker or confirmation.</Text>}
    </View>}
    {section('JSON backup', 'Full-fidelity backup of transactions, accounts, categories, line items, tags, transfers and settings. Restore replaces all current data.', <View style={{ gap: spacing.sm }}>{button('backup', true)}{button('restore')}</View>)}
    {section('CSV export', 'For portability and spreadsheets, not a full backup. Use JSON to restore your data.', button('export'))}
    {section('MoneyLover import', 'Import history from a MoneyLover CSV. Mixed categories need confirmation. Uncertain transfer pairs go to the existing Review Queue.', button('import'))}
  </ScrollView>;
}
