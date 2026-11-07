import { SettingsDataActions, SettingsGroup } from '@/components/settings-data-actions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { RunningRelease } from '@/components/running-release';
import { UpdatesRow } from '@/components/app-updates';
import { Stack, router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { theme } from '@/theme';

const { background, line, text, muted } = theme.colors;

function Row({
  label,
  href,
  first = false,
  disabled = false,
}: {
  label: string;
  href: Href;
  first?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => router.push(href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: theme.controlHeight,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.md,
        borderTopWidth: first ? 0 : 1,
        borderColor: line,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ flex: 1, color: text, fontSize: theme.type.body }}>{label}</Text>
      <Text style={{ color: muted }}>›</Text>
    </Pressable>
  );
}

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
        <SettingsGroup title="Manage">
          <Row disabled={busy} first label="Lending & borrowing" href="/lending" />
          <Row disabled={busy} label="Review transfer candidates" href="/review-queue" />
        </SettingsGroup>
        <SettingsGroup title="App" clipContent={false}>
          <UpdatesRow />
        </SettingsGroup>
        <RunningRelease />
      </View>
    </ScrollView>
  );
}
