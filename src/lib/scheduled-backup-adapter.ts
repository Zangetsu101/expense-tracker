import * as FileSystem from 'expo-file-system/legacy';
import { encodeBackup } from '@/lib/backup';
import { backupStore } from '@/lib/backup-adapter';
import { database } from '@/lib/database';
import {
  createScheduledBackups,
  emptyBackupSchedule,
  type ScheduledBackupState,
} from '@/lib/scheduled-backups';

const settingsKey = 'scheduledBackups';

export const scheduledBackups = createScheduledBackups({
  async load() {
    const row = await (
      await database()
    ).getFirstAsync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      settingsKey,
    ]);
    return row ? (JSON.parse(row.value) as ScheduledBackupState) : { ...emptyBackupSchedule };
  },
  async save(state) {
    await (
      await database()
    ).runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
      settingsKey,
      JSON.stringify(state),
    ]);
  },
  snapshotJson: async () => encodeBackup(await backupStore.snapshot()),
  create: (directory, name) =>
    FileSystem.StorageAccessFramework.createFileAsync(directory, name, 'application/json'),
  write: (uri, text) => FileSystem.writeAsStringAsync(uri, text),
  read: (uri) => FileSystem.readAsStringAsync(uri),
  async remove(uri) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    if ((await FileSystem.getInfoAsync(uri)).exists)
      throw new Error('The storage provider did not remove the old backup.');
  },
  now: Date.now,
});

export async function chooseScheduledBackupFolder(): Promise<string | null> {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  return permission.granted ? permission.directoryUri : null;
}
