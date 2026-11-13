import { ScheduledBackupLifecycle } from '@/components/scheduled-backup-lifecycle';
import { AnimationClockProvider } from '@/components/animation-clock';
import { AppQueriesProvider } from '@/components/app-queries';
import { AppUpdatesProvider } from '@/components/app-updates';
import { Stack, ThemeProvider, DarkTheme } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export const unstable_settings = { anchor: '(tabs)' };

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AnimationClockProvider>
        <AppQueriesProvider>
          <ThemeProvider value={DarkTheme}>
            <AppUpdatesProvider>
              <ScheduledBackupLifecycle />
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="quick-add"
                  options={{ title: 'Quick add', presentation: 'modal' }}
                />
                <Stack.Screen
                  name="transfer"
                  options={{ title: 'Transfer', presentation: 'modal' }}
                />
                <Stack.Screen name="transactions" options={{ title: 'Search transactions' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="review-queue" options={{ title: 'Review Queue' }} />
              </Stack>
            </AppUpdatesProvider>
          </ThemeProvider>
        </AppQueriesProvider>
      </AnimationClockProvider>
    </GestureHandlerRootView>
  );
}
