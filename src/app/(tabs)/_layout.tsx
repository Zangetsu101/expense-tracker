import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { appTabs } from '@/lib/app-navigation';
import { theme } from '@/theme';

const { background, surface, raised, accent, muted, text } = theme.colors;

export default function TabsLayout() {
  return <NativeTabs backgroundColor={surface} indicatorColor={raised} iconColor={{ default: muted, selected: accent }}
    labelStyle={{ default: { color: muted }, selected: { color: text, fontWeight: '700' } }} labelVisibilityMode="labeled">
    {appTabs.map((tab) => <NativeTabs.Trigger key={tab.name} name={tab.name} contentStyle={{ backgroundColor: background }}>
      <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
      <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>)}
  </NativeTabs>;
}
