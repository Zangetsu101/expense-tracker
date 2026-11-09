import { BackupSettings } from '@/components/backup-settings';
import { SettingsGroup, SettingsRow } from '@/components/settings-controls';
import { FormButton } from '@/components/form-controls';
import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { importMoneyLoverFile } from '@/lib/import-csv';
import { theme } from '@/theme';

const { colors, spacing } = theme;
type Operation = 'export' | 'import';
type Status = {
  operation: Operation;
  kind: 'pending' | 'success' | 'cancelled' | 'error';
  message: string;
};
const labels: Record<Operation, string> = {
  export: 'Export transactions CSV',
  import: 'Import from MoneyLover',
};

export function SettingsDataActions({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [backupBusy, setBackupBusy] = useState(false);
  const [status, setStatus] = useState<Status>();
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const busy = status?.kind === 'pending' || backupBusy;
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
    if (locked.current || backupBusy || !active.current) return;
    locked.current = true;
    update({ operation, kind: 'pending', message: `${labels[operation]} in progress…` });
    let cancelled = false;
    const confirm = (title: string, message: string, confirmLabel: string) =>
      new Promise<boolean>((resolve) => {
        Alert.alert(
          title,
          message,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            {
              text: confirmLabel,
              style: 'default',
              onPress: () => resolve(active.current),
            },
          ],
          { cancelable: false },
        );
      });
    try {
      let message: string;
      if (operation === 'import') {
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
        const uri = await exportTransactionsCsv();
        cancelled = uri === null;
        message = 'Transactions CSV exported.';
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
        <SettingsRow
          first
          label={labels[operation]}
          description={description}
          disabled={busy}
          loading={current?.kind === 'pending'}
          onPress={() => void run(operation)}
        />
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
              <FormButton
                label="Retry"
                variant="secondary"
                disabled={busy}
                onPress={() => void run(operation)}
              />
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
      <BackupSettings disabled={busy} onBusyChange={setBackupBusy} />
      <SettingsGroup title="Import & export">
        {action('export', 'For spreadsheets; not a full backup', true)}
        {action('import', 'Bring in your transaction history')}
      </SettingsGroup>
    </>
  );
}
