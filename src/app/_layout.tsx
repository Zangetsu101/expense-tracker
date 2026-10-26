import { Stack, ThemeProvider, DarkTheme } from 'expo-router';

export const unstable_settings = { anchor: '(tabs)' };

export default function Layout() {
  return <ThemeProvider value={DarkTheme}>
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="quick-add" options={{ title: 'Quick add', presentation: 'modal' }} />
      <Stack.Screen name="transfer" options={{ title: 'Transfer', presentation: 'modal' }} />
      <Stack.Screen name="transactions" options={{ title: 'Search transactions' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="review-queue" options={{ title: 'Review Queue' }} />
    </Stack>
  </ThemeProvider>;
}
