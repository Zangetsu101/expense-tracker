import {
  createContext,
  useCallback,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { createUpdateController, watchUpdateLifecycle } from '@/lib/app-updates';
import { theme } from '@/theme';

const UpdateContext = createContext<ReturnType<typeof createUpdateController> | null>(null);
export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const native = Updates.useUpdates();
  const [controller] = useState(() =>
    createUpdateController(
      process.env.EXPO_OS !== 'web' &&
        !__DEV__ &&
        Constants.executionEnvironment !== 'storeClient' &&
        Updates.isEnabled,
      {
        check: Updates.checkForUpdateAsync,
        fetch: Updates.fetchUpdateAsync,
        reload: Updates.reloadAsync,
      },
    ),
  );
  useEffect(() => {
    controller.sync(native);
  }, [controller, native]);
  useEffect(
    () =>
      watchUpdateLifecycle(AppState, () => {
        void controller.check();
      }),
    [controller],
  );
  // Startup owns its requests until completion; retry coordination once it settles.
  useEffect(() => {
    if (
      !native.isStartupProcedureRunning &&
      !native.isChecking &&
      !native.isDownloading &&
      AppState.currentState === 'active'
    )
      void controller.check();
  }, [controller, native.isStartupProcedureRunning, native.isChecking, native.isDownloading]);
  return <UpdateContext value={controller}>{children}</UpdateContext>;
}
export function useAppUpdates() {
  const controller = use(UpdateContext);
  if (!controller) throw new Error('AppUpdatesProvider is required');
  return {
    ...useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot),
    check: () => controller.check(true),
    restart: controller.restart,
  };
}
export function UpdatesRow() {
  const { status: updateStatus, progress, error, check, restart } = useAppUpdates();
  const [checkedThisVisit, setCheckedThisVisit] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [longPressed, setLongPressed] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setCheckedThisVisit(false);
      setHovered(false);
      setFocused(false);
      setLongPressed(false);
    }, []),
  );
  const status =
    !checkedThisVisit && (updateStatus === 'current' || updateStatus === 'error')
      ? 'idle'
      : updateStatus;
  const busy = ['checking', 'downloading', 'restarting'].includes(status);
  const description = {
    unsupported: 'Updates are available in an installed release build.',
    idle: 'Check for updates',
    checking: 'Checking for updates',
    downloading:
      progress === undefined
        ? 'Downloading update'
        : `Downloading update, ${Math.round(progress * 100)}%`,
    current: 'Up to date',
    ready: 'Restart to update',
    restarting: 'Restarting',
    error: 'Update failed. Tap to retry',
  }[status];
  useEffect(() => {
    if (checkedThisVisit && error) Alert.alert('Update failed', error);
  }, [checkedThisVisit, error]);
  const icon =
    status === 'ready'
      ? ({ ios: 'arrow.clockwise.circle.fill', android: 'restart_alt' } as const)
      : status === 'current'
        ? ({ ios: 'checkmark.circle', android: 'check_circle' } as const)
        : status === 'error'
          ? ({ ios: 'exclamationmark.circle', android: 'error_outline' } as const)
          : ({ ios: 'arrow.triangle.2.circlepath', android: 'sync' } as const);
  const tint =
    status === 'error'
      ? theme.colors.warning
      : status === 'ready'
        ? theme.colors.accent
        : theme.colors.muted;
  return (
    <View onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <Pressable
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onLongPress={() => setLongPressed(true)}
        onPressOut={() => setLongPressed(false)}
        accessibilityRole="button"
        accessibilityLabel="Updates"
        accessibilityValue={{ text: description }}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        onPress={() => {
          if (status === 'unsupported') Alert.alert('Updates', description);
          else if (status === 'ready')
            Alert.alert(
              'Restart to update?',
              'Unsaved entries will be lost. Restart only after saving your work.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Restart to update',
                  onPress: () => {
                    setCheckedThisVisit(true);
                    void restart();
                  },
                },
              ],
            );
          else {
            setCheckedThisVisit(true);
            void check();
          }
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: theme.controlHeight,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.xs,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={{ flex: 1, color: theme.colors.text, fontSize: theme.type.body }}>
          Updates
        </Text>
        {busy ? (
          <ActivityIndicator color={tint} accessibilityLabel={description} />
        ) : (
          <SymbolView name={icon} size={24} tintColor={tint} />
        )}
      </Pressable>
      {(hovered || focused || longPressed) && (
        <View
          pointerEvents="none"
          style={{
            alignSelf: 'flex-end',
            marginHorizontal: theme.spacing.lg,
            marginBottom: theme.spacing.sm,
            padding: theme.spacing.sm,
            borderRadius: theme.radius.elbow,
            backgroundColor: theme.colors.raised,
          }}
        >
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: theme.colors.text, fontSize: theme.type.caption }}
          >
            {description}
          </Text>
        </View>
      )}
    </View>
  );
}
