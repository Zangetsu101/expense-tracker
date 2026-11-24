import { ScheduledBackupLifecycle } from '@/components/scheduled-backup-lifecycle';
import { AppQueriesProvider } from '@/components/app-queries';
import { AppUpdatesProvider } from '@/components/app-updates';
import { DatabaseGate } from '@/components/database-gate';
import { Stack, ThemeProvider, DarkTheme } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { theme } from '@/theme';

export const unstable_settings = { anchor: '(tabs)' };

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppQueriesProvider>
        <ThemeProvider value={DarkTheme}>
          <AppUpdatesProvider>
            <DatabaseGate>
              <ScheduledBackupLifecycle />
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="quick-add"
                  options={{ title: 'Quick add', presentation: 'modal' }}
                />
                <Stack.Screen name="transactions" options={{ title: 'Search transactions' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen
                  name="person"
                  options={{
                    headerStyle: { backgroundColor: theme.colors.background },
                    headerTintColor: theme.colors.text,
                  }}
                />
              </Stack>
            </DatabaseGate>
          </AppUpdatesProvider>
        </ThemeProvider>
      </AppQueriesProvider>
    </GestureHandlerRootView>
  );
}
