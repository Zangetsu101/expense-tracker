import { BottomSheet, Button, Column, Host, Text as NativeText } from '@expo/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Image, Platform, Text, View, useWindowDimensions } from 'react-native';
import { FormButton } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import { SettingsGroup, SettingsRow } from '@/components/settings-controls';
import { restoreBackup, shareBackup } from '@/lib/backup';
import { backupDocuments, backupStore } from '@/lib/backup-adapter';
import {
  withBackupChangeNotice,
  reconcileBackupTask,
  runScheduledBackup,
  subscribeBackupSchedule,
} from '@/lib/backup-background-task';
import { actionLabels, backupStatus, backupTime } from '@/lib/backup-presentation';
import { driveBackups } from '@/lib/drive-backup-adapter';
import type {
  BackupInterval,
  DriveBackupListing,
  DriveBackupState,
  GoogleAccount,
} from '@/lib/drive-backups';
import { theme } from '@/theme';

type Operation =
  'connect' | 'backup' | 'share' | 'restore' | 'list' | 'keep' | 'schedule' | 'disconnect';
type Sheet = 'schedule' | 'account' | 'restore' | 'found';
const sheetTitles: Record<Sheet, string> = {
  schedule: 'Backup schedule',
  account: 'Google Drive',
  found: 'Backups found in Google Drive',
  restore: 'Restore a backup',
};
const restoredMessage = 'Backup restored. Current data has been replaced.';
const progressMessages: Record<Operation, string> = {
  connect: 'Connecting to Google Drive…',
  backup: 'Backing up to Google Drive…',
  share: 'Preparing backup file…',
  restore: 'Restore in progress…',
  list: 'Loading backups…',
  keep: 'Backing up to Google Drive…',
  schedule: 'Updating backup settings…',
  disconnect: 'Disconnecting…',
};
const intervals: { value: BackupInterval; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];
const caption = { color: theme.colors.muted, fontSize: theme.type.caption, lineHeight: 18 };
const avatarSize = 40;

function AccountAvatar({ email, photoUrl }: GoogleAccount) {
  const circle = { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 };
  if (photoUrl)
    return (
      <Image
        accessible
        accessibilityRole="image"
        accessibilityLabel="Profile photo"
        source={{ uri: photoUrl }}
        style={circle}
      />
    );
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={{
        ...circle,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.accent,
      }}
    >
      <Text style={{ color: theme.colors.text, fontSize: theme.type.body, fontWeight: '600' }}>
        {email.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function BackupChoice({
  label,
  description,
  selected,
  width,
  onPress,
}: {
  label: string;
  description?: string;
  selected?: boolean;
  width: number;
  onPress: () => void;
}) {
  return (
    <Button label={label} variant="text" style={{ width }} onPress={onPress}>
      <Column
        style={{ width: width - theme.spacing.lg * 2, paddingVertical: theme.spacing.xs }}
        spacing={theme.spacing.xs}
      >
        <NativeText textStyle={{ color: theme.colors.text, fontSize: theme.type.body }}>
          {selected ? `${label}  ✓` : label}
        </NativeText>
        {description && (
          <NativeText textStyle={{ color: theme.colors.muted, fontSize: theme.type.caption }}>
            {description}
          </NativeText>
        )}
      </Column>
    </Button>
  );
}

function backupDetails(backup: DriveBackupListing) {
  const size =
    backup.size >= 1024 * 1024
      ? `${(backup.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(backup.size / 1024))} KB`;
  if (backup.transactions === null) return size;
  return `${size} · ${backup.transactions.toLocaleString()} transaction${backup.transactions === 1 ? '' : 's'}`;
}

function confirmReplace(name: string, active: { current: boolean }) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Replace all current data?',
      `Selected: ${name}\n\nYour current accounts, transactions and other data will be replaced by this backup. This cannot be undone. Create a backup first if you want to keep your current data.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Replace data', style: 'destructive', onPress: () => resolve(active.current) },
      ],
      { cancelable: false },
    );
  });
}

export function BackupSettings({
  disabled,
  onBusyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const [state, setState] = useState<DriveBackupState>();
  const [loadError, setLoadError] = useState(false);
  const [foregroundOnly, setForegroundOnly] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [backups, setBackups] = useState<DriveBackupListing[]>([]);
  const [operation, setOperation] = useState<Operation>();
  const [failure, setFailure] = useState<{ operation: Operation; message: string }>();
  const [feedback, setFeedback] = useState<string>();
  const locked = useRef(false);
  const active = useRef(true);
  const supported = Platform.OS === 'android';

  function refresh() {
    return driveBackups
      .status()
      .then(async (next) => {
        const scheduling = await reconcileBackupTask();
        if (active.current) {
          setState(next);
          setLoadError(false);
          setForegroundOnly(scheduling !== null);
        }
      })
      .catch(() => {
        if (active.current) setLoadError(true);
      });
  }
  const refreshFromEffect = useEffectEvent(() => {
    void refresh();
  });
  useEffect(() => {
    active.current = true;
    if (supported) refreshFromEffect();
    const unsubscribe = supported ? subscribeBackupSchedule(() => refreshFromEffect()) : () => {};
    return () => {
      active.current = false;
      unsubscribe();
    };
  }, [supported]);

  async function run(next: Operation, action: () => Promise<void>) {
    if (locked.current || disabled || !active.current) return;
    locked.current = true;
    setSheet(null);
    setOperation(next);
    setFeedback(undefined);
    setFailure(undefined);
    onBusyChange(true);
    try {
      await action();
    } catch (error) {
      if (active.current)
        setFailure({
          operation: next,
          message: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (supported) await refresh();
      locked.current = false;
      if (active.current) {
        setOperation(undefined);
        onBusyChange(false);
      }
    }
  }
  const show = (next: Sheet) => {
    if (active.current) setSheet(next);
  };

  function connect() {
    void run('connect', async () => {
      const result = await withBackupChangeNotice(() => driveBackups.connect());
      if (result.kind === 'backupsFound') {
        setBackups([...result.backups].sort((a, b) => b.createdAt - a.createdAt));
        show('found');
      }
    });
  }
  function backUp() {
    void run('backup', async () => {
      await runScheduledBackup(true);
    });
  }
  function share() {
    void run('share', () => shareBackup(backupStore, backupDocuments));
  }
  function restoreFile() {
    void run('restore', async () => {
      const restored = await restoreBackup(backupStore, backupDocuments, (name) =>
        confirmReplace(name, active),
      );
      if (!restored) return;
      if (signedIn) await withBackupChangeNotice(() => driveBackups.adoptAfterFileRestore());
      if (active.current) setFeedback(restoredMessage);
    });
  }
  function openDriveBackups(next: Sheet) {
    void run('list', async () => {
      setBackups(await driveBackups.listBackups());
      show(next);
    });
  }
  function restoreDrive(backup: DriveBackupListing) {
    void run('restore', async () => {
      const restored = await withBackupChangeNotice(() =>
        driveBackups.restore(backup, () =>
          confirmReplace(`Google Drive backup from ${backupTime(backup.createdAt)}`, active),
        ),
      );
      if (restored && active.current) setFeedback(restoredMessage);
    });
  }
  function keepLocalData() {
    void run('keep', async () => {
      await withBackupChangeNotice(() => driveBackups.keepLocalData());
    });
  }
  function changeInterval(interval: BackupInterval) {
    void run('schedule', async () => {
      await withBackupChangeNotice(() => driveBackups.setInterval(interval));
    });
  }
  function disconnect() {
    void run('disconnect', async () => {
      await withBackupChangeNotice(() => driveBackups.disconnect());
    });
  }

  const busy = disabled || operation !== undefined;
  const signedIn = state !== undefined && state.status !== 'disconnected';
  const connected = state?.status === 'connected';
  const account = signedIn ? state.account : undefined;
  const loading = supported && !state && !loadError;
  const status = signedIn ? backupStatus(state) : undefined;
  const restoreFailed = failure?.operation === 'restore';
  const cardAction = status
    ? {
        backup: backUp,
        retry: backUp,
        reconnect: connect,
        review: () => openDriveBackups('found'),
      }[status.action]
    : connect;

  let footer = feedback;
  if (operation) footer = progressMessages[operation];
  else if (restoreFailed) footer = `Restore failed. Current data was kept. ${failure.message}`;
  else if (failure) footer = failure.message;

  let scheduleNote: string | undefined;
  if (connected && !status?.warning) {
    if (state.interval === 'off')
      scheduleNote = 'Automatic backups off. Turn on a schedule to back up without tapping.';
    else if (foregroundOnly) scheduleNote = 'Automatic backups run when you open the app.';
    else scheduleNote = `Backs up ${state.interval}. Keeps the latest 7 backups.`;
  }

  return (
    <View>
      <SettingsGroup
        title="Backup & restore"
        footer={
          <View
            accessibilityLiveRegion="polite"
            style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.xs, minHeight: 40 }}
          >
            {footer && (
              <Text
                accessibilityRole={failure ? 'alert' : undefined}
                style={{ ...caption, color: failure ? theme.colors.warning : theme.colors.muted }}
              >
                {footer}
              </Text>
            )}
            {!operation && scheduleNote && <Text style={caption}>{scheduleNote}</Text>}
            {loadError && <Text style={caption}>Backup settings couldn’t be loaded.</Text>}
            {!supported && <Text style={caption}>Automatic backups are available on Android.</Text>}
          </View>
        }
      >
        {supported && (
          <View
            style={{
              padding: theme.spacing.lg,
              gap: theme.spacing.md,
              borderBottomWidth: 1,
              borderColor: theme.colors.line,
            }}
          >
            {loading ? (
              <Skeleton width={200} height={14} animated={false} />
            ) : loadError ? (
              <FormButton label="Retry" variant="secondary" onPress={() => void refresh()} />
            ) : account ? (
              <>
                <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                  <AccountAvatar {...account} />
                  <View style={{ flex: 1, gap: theme.spacing.xs }}>
                    <Text style={{ color: theme.colors.text, fontSize: theme.type.body }}>
                      {account.email}
                    </Text>
                    <Text
                      accessibilityRole={status?.warning ? 'alert' : undefined}
                      style={{
                        ...caption,
                        color: status?.warning ? theme.colors.warning : theme.colors.muted,
                      }}
                    >
                      {status?.text}
                    </Text>
                  </View>
                </View>
                <FormButton
                  label={status ? actionLabels[status.action] : 'Back up now'}
                  loading={operation === 'backup' || operation === 'connect'}
                  disabled={busy}
                  onPress={cardAction}
                />
              </>
            ) : (
              <>
                <View style={{ gap: theme.spacing.xs }}>
                  <Text
                    style={{
                      color: theme.colors.text,
                      fontSize: theme.type.body,
                      fontWeight: '600',
                    }}
                  >
                    Back up to Google Drive
                  </Text>
                  <Text style={caption}>
                    Keep automatic copies of your data in your Drive. The app can only see files
                    that it creates.
                  </Text>
                </View>
                <FormButton
                  label="Connect Google Drive"
                  loading={operation === 'connect'}
                  disabled={busy}
                  onPress={connect}
                />
              </>
            )}
          </View>
        )}
        {connected && (
          <SettingsRow
            first
            label="Schedule"
            value={intervals.find((item) => item.value === state.interval)?.label}
            disabled={busy}
            onPress={() => setSheet('schedule')}
          />
        )}
        <SettingsRow
          first={!connected}
          label="Share a backup file"
          description="Send a copy to any app, such as Drive or email"
          loading={operation === 'share'}
          disabled={busy}
          onPress={share}
        />
        <SettingsRow
          label="Restore"
          description={
            restoreFailed ? 'Couldn’t restore this backup' : 'Replace current data with a backup'
          }
          value={restoreFailed ? 'Retry' : undefined}
          warning={restoreFailed}
          loading={operation === 'list'}
          disabled={busy}
          onPress={() => (signedIn ? openDriveBackups('restore') : restoreFile())}
        />
        {signedIn && (
          <SettingsRow
            label="Google account"
            value={account?.email}
            disabled={busy}
            onPress={() => setSheet('account')}
          />
        )}
      </SettingsGroup>
      <Host matchContents colorScheme="dark" seedColor={theme.colors.accent}>
        <BottomSheet
          isPresented={sheet !== null}
          onDismiss={() => setSheet(null)}
          containerColor={theme.colors.surface}
          contentPadding={0}
        >
          <Column style={{ width, paddingBottom: theme.spacing.xl }}>
            <NativeText
              textStyle={{
                color: theme.colors.text,
                fontSize: theme.type.heading,
                fontWeight: '600',
              }}
              style={{ padding: theme.spacing.lg }}
            >
              {sheet ? sheetTitles[sheet] : undefined}
            </NativeText>
            {sheet === 'schedule' &&
              intervals.map((item) => (
                <BackupChoice
                  key={item.value}
                  width={width}
                  label={item.label}
                  selected={connected && state.interval === item.value}
                  onPress={() => changeInterval(item.value)}
                />
              ))}
            {sheet === 'account' && (
              <Column>
                <BackupChoice width={width} label="Switch account" onPress={connect} />
                <BackupChoice
                  width={width}
                  label="Disconnect"
                  description="Stops automatic backups. Files in Drive stay."
                  onPress={disconnect}
                />
              </Column>
            )}
            {sheet === 'found' && backups[0] && (
              <Column>
                <BackupChoice
                  width={width}
                  label="Restore the newest backup"
                  description={`${backupTime(backups[0].createdAt)} · ${backupDetails(backups[0])}`}
                  onPress={() => restoreDrive(backups[0])}
                />
                <BackupChoice
                  width={width}
                  label="Choose another backup…"
                  onPress={() => setSheet('restore')}
                />
                <BackupChoice
                  width={width}
                  label="Keep this phone’s data"
                  description="Back up this phone now. The oldest Drive backup is removed when there are more than 7."
                  onPress={keepLocalData}
                />
              </Column>
            )}
            {sheet === 'restore' && (
              <Column>
                {backups.map((backup) => (
                  <BackupChoice
                    key={backup.id}
                    width={width}
                    label={backupTime(backup.createdAt)}
                    description={backupDetails(backup)}
                    onPress={() => restoreDrive(backup)}
                  />
                ))}
                <BackupChoice
                  width={width}
                  label="Choose a file…"
                  description="Use a backup from another place"
                  onPress={restoreFile}
                />
              </Column>
            )}
            <BackupChoice width={width} label="Cancel" onPress={() => setSheet(null)} />
          </Column>
        </BottomSheet>
      </Host>
    </View>
  );
}
