import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { driveBackups } from '@/lib/drive-backup-adapter';

const taskName = 'expense-tracker-scheduled-backup';
const listeners = new Set<() => void>();

export function subscribeBackupSchedule(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/** Runs a backup operation, then tells the subscribers that the backup state can be different. */
export async function changeBackups<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } finally {
    notify();
  }
}

export function runScheduledBackup(force = false) {
  return changeBackups(() => driveBackups.runDue(force));
}

// TaskManager must see the definition when it starts JS without mounting the UI.
TaskManager.defineTask(taskName, async ({ error }) => {
  if (error || Platform.OS !== 'android') return BackgroundTask.BackgroundTaskResult.Failed;
  try {
    const state = await runScheduledBackup();
    return state.lastError
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

let registration: Promise<unknown> = Promise.resolve();
export function reconcileBackupTask(): Promise<string | null> {
  const next = registration.then(async () => {
    if (Platform.OS !== 'android') return null;
    try {
      const state = await driveBackups.status();
      const registered = await TaskManager.isTaskRegisteredAsync(taskName);
      if (state.interval === 'off' || !state.account) {
        if (registered) await BackgroundTask.unregisterTaskAsync(taskName);
        return null;
      }
      if (
        !(await TaskManager.isAvailableAsync()) ||
        (await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available
      )
        return 'Background backups are unavailable. Overdue backups will run when you open the app.';
      if (!registered) await BackgroundTask.registerTaskAsync(taskName, { minimumInterval: 60 });
      return null;
    } catch (error) {
      return `Background scheduling failed. Overdue backups will run when you open the app. ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  registration = next;
  return next;
}
