import { BottomSheet, Button, Column, Host, Text as NativeText } from '@expo/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Platform, Text, View, useWindowDimensions } from 'react-native';
import { Skeleton } from '@/components/loading';
import { SettingsGroup, SettingsRow } from '@/components/settings-controls';
import { exportBackup, restoreBackup } from '@/lib/backup';
import { backupDocuments, backupStore } from '@/lib/backup-adapter';
import { backupFailureKind, backupFolderName, backupTime } from '@/lib/backup-presentation';
import {
  configureBackupSchedule,
  reconcileBackupTask,
  runScheduledBackup,
  subscribeBackupSchedule,
} from '@/lib/backup-background-task';
import { chooseScheduledBackupFolder, scheduledBackups } from '@/lib/scheduled-backup-adapter';
import type { BackupInterval, ScheduledBackupState } from '@/lib/scheduled-backups';
import { theme } from '@/theme';

type Operation = 'save' | 'export' | 'restore' | 'schedule' | 'folder';
type Failure = { operation: Operation; message: string };
const progressMessages: Record<Operation, string> = {
  save: 'Saving backup…',
  export: 'Saving backup…',
  restore: 'Restore in progress…',
  schedule: 'Updating backup settings…',
  folder: 'Updating backup settings…',
};
const folderHints = {
  folder: 'Choose a folder to restore access',
  storage: 'Choose a folder with available space',
  retention: 'Check access to remove older backups',
  save: undefined,
};
const intervals: { value: BackupInterval; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

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

export function BackupSettings({
  disabled,
  onBusyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const [state, setState] = useState<ScheduledBackupState>();
  const [loadError, setLoadError] = useState(false);
  const [foregroundOnly, setForegroundOnly] = useState(false);
  const [menu, setMenu] = useState<'destination' | 'schedule' | null>(null);
  const [operation, setOperation] = useState<Operation>();
  const [failure, setFailure] = useState<Failure>();
  const [feedback, setFeedback] = useState<string>();
  const locked = useRef(false);
  const active = useRef(true);
  const lastRead = useRef<{ attempt: number | undefined }>(undefined);
  const supported = Platform.OS === 'android';

  function refresh() {
    return scheduledBackups
      .status()
      .then(async (next) => {
        const scheduling = await reconcileBackupTask();
        if (active.current) {
          if (
            lastRead.current &&
            next.attempt !== undefined &&
            next.attempt !== lastRead.current.attempt
          ) {
            setFailure((current) =>
              next.lastError
                ? { operation: 'save', message: next.lastError }
                : current?.operation === 'restore'
                  ? current
                  : undefined,
            );
          }
          lastRead.current = { attempt: next.attempt };
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

  async function run(next: Operation, action: () => Promise<boolean>) {
    if (locked.current || disabled || !active.current) return;
    locked.current = true;
    setMenu(null);
    setOperation(next);
    setFeedback(undefined);
    onBusyChange(true);
    try {
      const completed = await action();
      if (completed && active.current && (next === 'restore' || failure?.operation !== 'restore'))
        setFailure(undefined);
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

  function acceptBackupResult(next: ScheduledBackupState) {
    if (active.current) {
      setState(next);
      if (next.lastError) setFailure({ operation: 'save', message: next.lastError });
    }
    return next.lastError === null;
  }

  function saveToFolder() {
    void run('save', async () => {
      return acceptBackupResult(await runScheduledBackup(true));
    });
  }
  function saveElsewhere() {
    void run('export', async () => {
      const uri = await exportBackup(backupStore, backupDocuments);
      if (uri && active.current) setFeedback('Extra copy saved elsewhere.');
      return uri !== null;
    });
  }
  function restore() {
    void run('restore', async () => {
      const restored = await restoreBackup(
        backupStore,
        backupDocuments,
        (name) =>
          new Promise<boolean>((resolve) => {
            Alert.alert(
              'Replace all current data?',
              `Selected: ${name}\n\nYour current accounts, transactions and other data will be replaced by this backup. This cannot be undone. Create a backup first if you want to keep your current data.`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                {
                  text: 'Replace data',
                  style: 'destructive',
                  onPress: () => resolve(active.current),
                },
              ],
              { cancelable: false },
            );
          }),
      );
      if (restored && active.current)
        setFeedback('Backup restored. Current data has been replaced.');
      return restored;
    });
  }
  function changeInterval(interval: BackupInterval) {
    void run('schedule', async () => {
      let directory = state?.directoryUri ?? undefined;
      if (interval !== 'off' && !directory) {
        directory = (await chooseScheduledBackupFolder()) ?? undefined;
        if (!directory) return false;
      }
      const next = await configureBackupSchedule(interval, directory);
      return interval !== 'off' && acceptBackupResult(next);
    });
  }
  function changeFolder() {
    void run('folder', async () => {
      const directory = await chooseScheduledBackupFolder();
      if (!directory || !state) return false;
      let next = await configureBackupSchedule(state.interval, directory);
      if (state.interval === 'off' && (state.lastError || failure))
        next = await runScheduledBackup(true);
      return (
        (state.interval !== 'off' || !!state.lastError || !!failure) && acceptBackupResult(next)
      );
    });
  }

  const busy = disabled || operation !== undefined;
  const storedFailure = state?.lastError;
  const failureMessage = failure?.message ?? storedFailure;
  const kind =
    failure?.operation === 'restore' || failure?.operation === 'export'
      ? 'save'
      : failureMessage
        ? backupFailureKind(failureMessage)
        : undefined;
  const folderFailed = kind === 'folder' || kind === 'storage' || kind === 'retention';
  const restoreFailed = failure?.operation === 'restore';
  const saveFailed = !!failureMessage && !folderFailed && !restoreFailed;
  const loading = supported && !state && !loadError;
  const folder = state?.directoryUri ? backupFolderName(state.directoryUri) : 'Choose folder';
  const retry = failure?.operation === 'export' ? saveElsewhere : saveToFolder;
  const caption = { color: theme.colors.muted, fontSize: theme.type.caption, lineHeight: 18 };

  let scheduleNote = 'Keeps the latest 7 backups.';
  if (state?.interval === 'off')
    scheduleNote = state.directoryUri
      ? 'Automatic backups off.'
      : 'Choose a folder to set up automatic backups.';
  else if (foregroundOnly) scheduleNote = 'Automatic backups run when you open the app.';

  let status = feedback;
  if (operation) status = progressMessages[operation];
  else if (kind === 'retention') status = 'Backup saved. Older backups couldn’t be removed.';
  else if (restoreFailed) status = 'Restore failed. Current data was kept.';
  else if (failureMessage) status = 'Backup couldn’t be saved.';

  return (
    <View>
      <SettingsGroup
        title="Backup & restore"
        footer={
          <View
            accessibilityLiveRegion="polite"
            style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.xs, minHeight: 40 }}
          >
            {loading && <Skeleton width={200} height={14} animated={false} />}
            {status && (
              <Text
                accessibilityRole={failureMessage ? 'alert' : undefined}
                style={{
                  ...caption,
                  color: failureMessage ? theme.colors.warning : theme.colors.muted,
                }}
              >
                {status}
              </Text>
            )}
            {supported && state && (
              <>
                <Text style={caption}>Last backup to folder: {backupTime(state.lastSuccess)}</Text>
                {!failureMessage && !operation && <Text style={caption}>{scheduleNote}</Text>}
              </>
            )}
            {loadError && <Text style={caption}>Backup settings couldn’t be loaded.</Text>}
            {!supported && <Text style={caption}>Automatic backups are available on Android.</Text>}
          </View>
        }
      >
        <SettingsRow
          first
          label="Create backup"
          description={
            saveFailed ? 'Last backup attempt failed' : 'Save a complete copy of your data'
          }
          value={saveFailed ? 'Retry' : undefined}
          warning={saveFailed}
          disabled={busy}
          onPress={() => (saveFailed ? retry() : setMenu('destination'))}
        />
        <SettingsRow
          label="Restore from file"
          description={
            restoreFailed ? 'Couldn’t restore this backup' : 'Replace current data with a backup'
          }
          value={restoreFailed ? 'Retry' : undefined}
          warning={restoreFailed}
          disabled={busy}
          onPress={restore}
        />
        {supported && (
          <>
            <SettingsRow
              label="Schedule"
              value={
                loadError
                  ? 'Retry'
                  : intervals.find((item) => item.value === state?.interval)?.label
              }
              pendingValue={loading}
              warning={loadError}
              disabled={busy || loading}
              onPress={() => (loadError ? void refresh() : setMenu('schedule'))}
            />
            <SettingsRow
              label="Folder"
              description={kind ? folderHints[kind] : undefined}
              value={folderFailed ? 'Needs attention' : folder}
              pendingValue={loading}
              warning={folderFailed}
              disabled={busy || !state || loadError}
              onPress={changeFolder}
            />
          </>
        )}
      </SettingsGroup>
      <Host matchContents colorScheme="dark" seedColor={theme.colors.accent}>
        <BottomSheet
          isPresented={menu !== null}
          onDismiss={() => setMenu(null)}
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
              {menu === 'schedule' ? 'Backup schedule' : 'Create backup'}
            </NativeText>
            {menu === 'schedule' ? (
              intervals.map((item) => (
                <BackupChoice
                  key={item.value}
                  width={width}
                  label={item.label}
                  selected={state?.interval === item.value}
                  onPress={() => changeInterval(item.value)}
                />
              ))
            ) : (
              <Column>
                {state?.directoryUri && (
                  <BackupChoice
                    width={width}
                    label={folder}
                    description="Saved backup folder"
                    onPress={saveToFolder}
                  />
                )}
                <BackupChoice
                  width={width}
                  label={state?.directoryUri ? 'Choose another location…' : 'Choose a location…'}
                  description="Save a separate copy"
                  onPress={saveElsewhere}
                />
              </Column>
            )}
            <BackupChoice width={width} label="Cancel" onPress={() => setMenu(null)} />
          </Column>
        </BottomSheet>
      </Host>
    </View>
  );
}
