import { backupStatus, backupTime } from './backup-presentation';
import { disconnectedState, type DriveBackupState } from './drive-backups';

const now = new Date(2026, 10, 8, 10, 0);
const day = 24 * 60 * 60 * 1000;
const connected: DriveBackupState = {
  ...disconnectedState,
  account: 'you@example.com',
  folderId: 'folder',
  interval: 'daily',
  connectedAt: now.getTime() - 10 * day,
  lastSuccess: new Date(2026, 10, 8, 9, 12).getTime(),
};

test('backup times identify today, yesterday, and no previous backup', () => {
  expect(backupTime(null, now)).toBe('Never');
  expect(backupTime(new Date(2026, 10, 8, 9, 12).getTime(), now)).toMatch(/^Today at /);
  expect(backupTime(new Date(2026, 10, 7, 9, 12).getTime(), now)).toMatch(/^Yesterday at /);
});

test('a healthy account shows the last backup, or that none exists yet', () => {
  expect(backupStatus(connected, now)).toEqual({
    text: expect.stringMatching(/^Last backup: Today at /),
    warning: false,
    action: 'backup',
  });
  expect(
    backupStatus({ ...connected, lastSuccess: null, connectedAt: now.getTime() }, now),
  ).toEqual({ text: 'No backups yet', warning: false, action: 'backup' });
});

test('one network failure is quiet; a missed interval is a warning', () => {
  const offline = { ...connected, lastError: { kind: 'network' as const, message: 'offline' } };
  expect(backupStatus(offline, now)).toMatchObject({
    text: expect.stringMatching(/· waiting for internet$/),
    warning: false,
  });
  expect(backupStatus({ ...offline, lastSuccess: now.getTime() - 3 * day }, now)).toMatchObject({
    text: expect.stringMatching(/^No backup since .*\. The app couldn’t reach Google Drive\.$/),
    warning: true,
    action: 'retry',
  });
});

test.each([
  [
    { kind: 'auth', message: 'Invalid Credentials' },
    'Google Drive access was removed. Reconnect to keep backing up.',
    'reconnect',
  ],
  [
    { kind: 'quota', message: 'quota' },
    'Your Google Drive is full. Free up space, then retry.',
    'retry',
  ],
  [
    { kind: 'other', message: 'Backup verification failed.' },
    'Backup couldn’t be saved. Backup verification failed.',
    'retry',
  ],
] as const)('%j shows a warning', (lastError, text, action) => {
  expect(backupStatus({ ...connected, lastError }, now)).toEqual({ text, warning: true, action });
});

test('a backup that could not remove older backups is a warning', () => {
  expect(
    backupStatus({ ...connected, removalError: { kind: 'network', message: 'offline' } }, now),
  ).toEqual({
    text: 'Backup saved. Older backups couldn’t be removed.',
    warning: true,
    action: 'backup',
  });
});

test('backups found at connect ask the user to review them', () => {
  expect(backupStatus({ ...connected, awaitingChoice: true }, now)).toMatchObject({
    warning: false,
    action: 'review',
  });
});
