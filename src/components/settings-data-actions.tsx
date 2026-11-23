import { BackupSettings } from '@/components/backup-settings';
import { SettingsGroup, SettingsRow } from '@/components/settings-controls';
import { FormButton } from '@/components/form-controls';
import { useEffect, useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { exportTransactionsCsv } from '@/lib/export-csv';
import { theme } from '@/theme';

const { colors, spacing } = theme;
const exportLabel = 'Export transactions CSV';

type Status = {
  kind: 'pending' | 'success' | 'cancelled' | 'error';
  message: string;
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
  async function runExport() {
    if (locked.current || backupBusy || !active.current) return;
    locked.current = true;
    update({ kind: 'pending', message: `${exportLabel} in progress…` });
    try {
      const uri = await exportTransactionsCsv();
      update(
        uri === null
          ? { kind: 'cancelled', message: `${exportLabel} cancelled.` }
          : { kind: 'success', message: 'Transactions CSV exported.' },
      );
    } catch (error) {
      update({
        kind: 'error',
        message: `${exportLabel} failed. ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      locked.current = false;
    }
  }

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !busy }} />
      <BackupSettings disabled={busy} onBusyChange={setBackupBusy} />
      <SettingsGroup title="Export">
        <SettingsRow
          first
          label={exportLabel}
          description="For spreadsheets; not a full backup"
          disabled={busy}
          loading={status?.kind === 'pending'}
          onPress={() => void runExport()}
        />
        {status && (
          <View
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy }}
            style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}
          >
            {busy && <ActivityIndicator color={colors.accent} />}
            <Text
              selectable
              accessibilityRole={status.kind === 'error' ? 'alert' : undefined}
              style={{
                color: status.kind === 'error' ? colors.warning : colors.text,
                fontSize: theme.type.caption,
              }}
            >
              {status.message}
            </Text>
            {status.kind === 'error' && (
              <FormButton
                label="Retry"
                variant="secondary"
                disabled={busy}
                onPress={() => void runExport()}
              />
            )}
            {busy && (
              <Text style={{ color: colors.muted, fontSize: theme.type.caption }}>
                Keep Settings open. You can cancel in the file picker.
              </Text>
            )}
          </View>
        )}
      </SettingsGroup>
    </>
  );
}
