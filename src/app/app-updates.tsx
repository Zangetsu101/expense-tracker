import { Alert, ScrollView, Text } from 'react-native';
import { Host, Button } from '@expo/ui';
import { useAppUpdates } from '@/components/app-updates';
import { theme } from '@/theme';

export default function AppUpdatesScreen() {
  const { status, progress, error, check, restart } = useAppUpdates();
  const busy = ['checking', 'downloading', 'restarting'].includes(status);
  const message = {
    unsupported: 'App updates are available in an installed release build on iOS or Android.',
    idle: 'Check for a new version of Expense Tracker.',
    checking: 'Checking for updates…',
    downloading: progress === undefined ? 'Downloading update…' : `Downloading update… ${Math.round(progress * 100)}%`,
    current: 'You’re up to date.',
    ready: 'Update downloaded. Save your work before restarting.',
    restarting: 'Restarting…',
    error: 'Update failed.',
  }[status];
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.md }}>
    <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.text, fontSize: theme.type.body }}>{message}</Text>
    {error && <Text selectable accessibilityRole="alert" style={{ color: theme.colors.warning }}>{error}</Text>}
    {status !== 'unsupported' && <Host matchContents><Button disabled={busy} onPress={() => {
      if (status === 'ready') Alert.alert('Restart to update?', 'Unsaved entries will be lost. Restart only after saving your work.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Restart to update', onPress: () => { void restart(); } },
      ]);
      else void check();
    }}>{status === 'ready' ? 'Restart to update' : status === 'error' ? 'Try again' : 'Check for updates'}</Button></Host>}
  </ScrollView>;
}
