import Stack from 'expo-router/stack';
import { appTabs } from '@/lib/app-navigation';
import { theme } from '@/theme';

export function TabStack({ tab }: { tab: (typeof appTabs)[number]['name'] }) {
  const title = appTabs.find((item) => item.name === tab)?.label;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
