import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { FormButton } from '@/components/form-controls';
import { subscribeBackupSchedule } from '@/lib/backup-background-task';
import { backupStatus } from '@/lib/backup-presentation';
import { driveBackups } from '@/lib/drive-backup-adapter';
import { needsAttention } from '@/lib/drive-backups';
import { theme } from '@/theme';

/** Shows a Drive backup problem on Home until a backup succeeds. */
export function BackupAttentionBanner() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let active = true;
    function check() {
      driveBackups
        .status()
        .then((state) => {
          if (active)
            setMessage(
              state.status === 'connected' && needsAttention(state, Date.now())
                ? backupStatus(state).text
                : null,
            );
        })
        .catch(() => {});
    }
    check();
    const unsubscribe = subscribeBackupSchedule(check);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => {
      active = false;
      unsubscribe();
      subscription.remove();
    };
  }, []);

  if (!message) return null;
  return (
    <View
      style={{
        margin: theme.spacing.lg,
        marginBottom: 0,
        padding: theme.spacing.lg,
        gap: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.warning,
        borderWidth: 1,
        borderRadius: theme.radius.group,
        borderCurve: 'continuous',
      }}
    >
      <Text
        accessibilityRole="alert"
        style={{ color: theme.colors.warning, fontSize: theme.type.detail, lineHeight: 20 }}
      >
        {message}
      </Text>
      <FormButton
        label="Open backup settings"
        variant="secondary"
        onPress={() => router.push('/settings')}
      />
    </View>
  );
}
