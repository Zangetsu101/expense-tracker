import { needsAttention, type DriveBackupState } from '@/lib/drive-backups';

export function backupTime(timestamp: number | null, now = new Date()): string {
  if (timestamp === null) return 'Never';
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today at ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString()} at ${time}`;
}

export type BackupAction = 'backup' | 'retry' | 'reconnect' | 'review';
export type BackupStatus = { text: string; warning: boolean; action: BackupAction };

export const actionLabels: Record<BackupAction, string> = {
  backup: 'Back up now',
  retry: 'Retry backup',
  reconnect: 'Reconnect',
  review: 'Review backups',
};

/** What the Drive card and the Home banner say about a connected account. */
export function backupStatus(state: DriveBackupState, now = new Date()): BackupStatus {
  const last = state.lastSuccess === null ? null : backupTime(state.lastSuccess, now);
  const error = state.lastError;
  if (state.awaitingChoice)
    return {
      text: 'Google Drive has backups from Expense Tracker. Choose what to do with them.',
      warning: false,
      action: 'review',
    };
  if (error?.kind === 'auth')
    return {
      text: 'Google Drive access was removed. Reconnect to keep backing up.',
      warning: true,
      action: 'reconnect',
    };
  if (error?.kind === 'quota')
    return {
      text: 'Your Google Drive is full. Free up space, then retry.',
      warning: true,
      action: 'retry',
    };
  if (error?.message.startsWith('Backup saved, but'))
    return {
      text: 'Backup saved. Older backups couldn’t be removed.',
      warning: true,
      action: 'backup',
    };
  if (needsAttention(state, now.getTime())) {
    const detail =
      error?.kind === 'network'
        ? 'The app couldn’t reach Google Drive.'
        : (error?.message ?? 'Open the app to back up.');
    return {
      text: `${last ? `No backup since ${last}.` : 'No backup yet.'} ${detail}`,
      warning: true,
      action: 'retry',
    };
  }
  if (error?.kind === 'network')
    return {
      text: `Last backup: ${last ?? 'Never'} · waiting for internet`,
      warning: false,
      action: 'backup',
    };
  if (error)
    return { text: `Backup couldn’t be saved. ${error.message}`, warning: true, action: 'retry' };
  return {
    text: last ? `Last backup: ${last}` : 'No backups yet',
    warning: false,
    action: 'backup',
  };
}
