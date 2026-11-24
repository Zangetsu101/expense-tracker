import { SettingsDataActions } from '@/components/settings-data-actions';
import { SettingsGroup } from '@/components/settings-controls';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { RunningRelease } from '@/components/running-release';
import { UpdatesRow } from '@/components/app-updates';
import { Stack } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { theme } from '@/theme';

const { background, text } = theme.colors;

export default function SettingsScreen() {
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: background }}
      contentContainerStyle={{
        padding: theme.spacing.xl,
        paddingBottom: theme.spacing.xl + insets.bottom,
        gap: theme.spacing.indent,
      }}
    >
      <Stack.Screen
        options={{ headerStyle: { backgroundColor: background }, headerTintColor: text }}
      />
      <SettingsDataActions onBusyChange={setBusy} />
      <View
        pointerEvents={busy ? 'none' : 'auto'}
        accessibilityElementsHidden={busy}
        importantForAccessibility={busy ? 'no-hide-descendants' : 'auto'}
        style={{ gap: theme.spacing.indent, opacity: busy ? 0.45 : 1 }}
      >
        <SettingsGroup title="App">
          <UpdatesRow />
        </SettingsGroup>
        <RunningRelease />
      </View>
    </ScrollView>
  );
}
