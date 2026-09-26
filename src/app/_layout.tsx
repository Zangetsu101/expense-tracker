import { Stack, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function Layout() {
  const scheme = useColorScheme();
  return <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Transactions' }} />
      <Stack.Screen name="quick-add" options={{ title: 'Quick add', presentation: 'modal' }} />
    </Stack>
  </ThemeProvider>;
}
