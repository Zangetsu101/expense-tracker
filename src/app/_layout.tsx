import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function Layout() {
  const scheme = useColorScheme();
  return <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Transactions' }} />
      <Stack.Screen name="quick-add" options={{ title: 'Quick add', presentation: 'modal' }} />
      <Stack.Screen name="transfer" options={{ title: 'Transfer', presentation: 'modal' }} />
      <Stack.Screen name="transactions" options={{ title: 'Search transactions' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
      <Stack.Screen name="accounts" options={{ title: 'Accounts' }} />
      <Stack.Screen name="review-queue" options={{ title: 'Review Queue' }} />
    </Stack>
  </ThemeProvider>;
}
