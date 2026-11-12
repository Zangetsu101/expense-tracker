import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { reconcileBackupTask, runScheduledBackup } from '@/lib/backup-background-task';

export function ScheduledBackupLifecycle() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    async function check() {
      await reconcileBackupTask();
      await runScheduledBackup().catch(() => {});
    }
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    const timer = setInterval(
      () => {
        if (AppState.currentState === 'active') void check();
      },
      60 * 60 * 1000,
    );
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);
  return null;
}
