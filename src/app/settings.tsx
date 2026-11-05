import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { theme } from '@/theme';

const { background, surface, line, text, muted } = theme.colors;

function Row({ label, href, quiet }: { label: string; href: Href; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push(href)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: theme.controlHeight, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.xs, opacity: pressed ? 0.6 : 1 })}>
    <Text style={{ flex: 1, color: quiet ? muted : text, fontSize: quiet ? 14 : theme.type.body }}>{label}</Text>
    <Text style={{ color: muted }}>›</Text>
  </Pressable>;
}

export default function SettingsScreen() {
  return <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: background }} contentContainerStyle={{ padding: theme.spacing.xl, gap: theme.spacing.indent }}>
    <View style={{ gap: theme.spacing.sm }}>
      <Text style={{ color: muted, fontWeight: '700' }}>Data</Text>
      <View style={{ backgroundColor: surface, borderRadius: theme.radius.group, borderWidth: 1, borderColor: line, overflow: 'hidden' }}>
        <Row label="Import, export and backup" href="/data-tools" />
      </View>
    </View>
    <Row label="App updates" href="/app-updates" />
    <Row label="Lending & borrowing" href="/lending" />
    <Row quiet label="Review transfer candidates" href="/review-queue" />
  </ScrollView>;
}
