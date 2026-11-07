import { FormButton } from '@/components/form-controls';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { backupDocuments, backupStore } from '@/lib/backup-adapter';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { importMoneyLoverFile } from '@/lib/import-csv';
import { theme } from '@/theme';

const { colors, spacing, radius } = theme;
type Operation = 'backup' | 'restore' | 'export' | 'import';
type Status = {
  operation: Operation;
  kind: 'pending' | 'success' | 'cancelled' | 'error';
  message: string;
};
const labels: Record<Operation, string> = {
  backup: 'Create backup',
  restore: 'Restore from file',
  export: 'Export transactions CSV',
  import: 'Import from MoneyLover',
};

export function SettingsDataActions({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [status, setStatus] = useState<Status>();
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const busy = status?.kind === 'pending';
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  usePreventRemove(busy, () =>
    Alert.alert(
      'Operation in progress',
      'Finish the current operation before leaving this screen.',
    ),
  );

  function update(next: Status) {
    if (active.current) setStatus(next);
  }
  async function run(operation: Operation) {
    if (locked.current || !active.current) return;
    locked.current = true;
    update({ operation, kind: 'pending', message: `${labels[operation]} in progress…` });
    let cancelled = false;
    const confirm = (title: string, message: string, confirmLabel: string, destructive = false) =>
      new Promise<boolean>((resolve) => {
        Alert.alert(
          title,
          message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            {
              text: confirmLabel,
              style: destructive ? 'destructive' : 'default',
              onPress: () => resolve(active.current),
            },
          ],
          { cancelable: false },
        );
      });
    try {
      let message: string;
      if (operation === 'restore') {
        update({ operation, kind: 'pending', message: 'Choose a backup file…' });
        cancelled = !(await restoreBackup(backupStore, backupDocuments, async (name) => {
          update({ operation, kind: 'pending', message: 'Waiting for restore confirmation…' });
          const accepted = await confirm(
            'Replace all current data?',
            `Selected: ${name}\n\nYour current accounts, transactions and other data will be replaced by this backup. This cannot be undone. Create a backup first if you want to keep your current data.`,
            'Replace data',
            true,
          );
          if (accepted) update({ operation, kind: 'pending', message: 'Restoring backup…' });
          return accepted;
        }));
        message = 'Backup restored. Current data has been replaced.';
      } else if (operation === 'import') {
        const count = await importMoneyLoverFile(async (names) => {
          const accepted = await confirm(
            'Mixed categories',
            `These categories contain both expenses and income: ${names.join(', ')}. Create separate expense and income categories?`,
            'Create separate categories',
          );
          cancelled = !accepted;
          return accepted;
        });
        cancelled = cancelled || count === null;
        message = `${count ?? 0} transaction${count === 1 ? '' : 's'} imported.`;
      } else {
        const uri =
          operation === 'backup'
            ? await exportBackup(backupStore, backupDocuments)
            : await exportTransactionsCsv();
        cancelled = uri === null;
        message = operation === 'backup' ? 'Backup saved.' : 'Transactions CSV exported.';
      }
      update({
        operation,
        kind: cancelled ? 'cancelled' : 'success',
        message: cancelled ? `${labels[operation]} cancelled.` : message,
      });
    } catch (error) {
      update({
        operation,
        kind: cancelled ? 'cancelled' : 'error',
        message: cancelled
          ? `${labels[operation]} cancelled.`
          : `${labels[operation]} failed. ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      locked.current = false;
    }
  }
  function action(operation: Operation, description: string, first = false) {
    const current = status?.operation === operation ? status : undefined;
    return (
      <View style={{ borderTopWidth: first ? 0 : 1, borderColor: colors.line }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={labels[operation]}
          accessibilityState={{ disabled: busy, busy: current?.kind === 'pending' }}
          disabled={busy}
          onPress={() => void run(operation)}
          style={({ pressed }) => ({
            minHeight: theme.controlHeight,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            gap: spacing.xs,
            opacity: busy ? 0.45 : pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.text, fontSize: theme.type.body }}>{labels[operation]}</Text>
          <Text style={{ color: colors.muted, fontSize: theme.type.caption, lineHeight: 18 }}>
            {description}
          </Text>
        </Pressable>
        {current && (
          <View
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy }}
            style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}
          >
            {busy && <ActivityIndicator color={colors.accent} />}
            <Text
              selectable
              accessibilityRole={current.kind === 'error' ? 'alert' : undefined}
              style={{
                color: current.kind === 'error' ? colors.warning : colors.text,
                fontSize: theme.type.caption,
              }}
            >
              {current.message}
            </Text>
            {current.kind === 'error' && (
              <FormButton label="Retry" variant="secondary" onPress={() => void run(operation)} />
            )}
            {busy && (
              <Text style={{ color: colors.muted, fontSize: theme.type.caption }}>
                Keep Settings open. You can cancel in the file picker or confirmation.
              </Text>
            )}
          </View>
        )}
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <SettingsGroup title="Backup & restore">
        {action('backup', 'Save a complete copy of your data', true)}
        {action('restore', 'Replace current data with a backup')}
      </SettingsGroup>
      <SettingsGroup title="Import & export">
        {action('export', 'For spreadsheets; not a full backup', true)}
        {action('import', 'Bring in your transaction history')}
      </SettingsGroup>
    </>
  );
}

export function SettingsGroup({
  title,
  children,
  clipContent = true,
}: {
  title: string;
  children: ReactNode;
  clipContent?: boolean;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.muted, fontSize: theme.type.body, fontWeight: '700' }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.group,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          overflow: clipContent ? 'hidden' : 'visible',
        }}
      >
        {children}
      </View>
    </View>
  );
}
