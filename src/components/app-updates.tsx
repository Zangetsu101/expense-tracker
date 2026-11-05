import { createContext, use, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Link } from 'expo-router';
import { createUpdateController, watchUpdateLifecycle } from '@/lib/app-updates';
import { theme } from '@/theme';

const UpdateContext = createContext<ReturnType<typeof createUpdateController> | null>(null);
export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  const native = Updates.useUpdates();
  const [controller] = useState(() => createUpdateController(
    process.env.EXPO_OS !== 'web' && !__DEV__ && Constants.executionEnvironment !== 'storeClient' && Updates.isEnabled,
    { check: Updates.checkForUpdateAsync, fetch: Updates.fetchUpdateAsync, reload: Updates.reloadAsync },
  ));
  useEffect(() => { controller.sync(native); }, [controller, native]);
  useEffect(() => watchUpdateLifecycle(AppState, () => { void controller.check(); }), [controller]);
  // Startup owns its requests until completion; retry coordination once it settles.
  useEffect(() => {
    if (!native.isStartupProcedureRunning && !native.isChecking && !native.isDownloading && AppState.currentState === 'active') void controller.check();
  }, [controller, native.isStartupProcedureRunning, native.isChecking, native.isDownloading]);
  return <UpdateContext value={controller}>{children}<UpdateNotice /></UpdateContext>;
}
export function useAppUpdates() {
  const controller = use(UpdateContext);
  if (!controller) throw new Error('AppUpdatesProvider is required');
  return { ...useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot), check: () => controller.check(true), restart: controller.restart };
}
function UpdateNotice() {
  const { status } = useAppUpdates();
  if (status !== 'ready') return null;
  return <View style={{ backgroundColor: theme.colors.surface, padding: theme.spacing.md }}>
    <Link href="/app-updates" accessibilityLabel="Update ready. Open App updates" style={{ color: theme.colors.accent }}>Update ready · Open App updates</Link>
    <Text style={{ color: theme.colors.muted }}>Restart when you’ve finished and saved your work.</Text>
  </View>;
}
