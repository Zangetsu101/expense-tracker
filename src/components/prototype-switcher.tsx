// PROTOTYPE — floating variant switcher. Dev builds only.
import { Pressable, Text, View } from 'react-native';

export function PrototypeSwitcher({ variants, current, onChange }: { variants: { key: string; name: string }[]; current: string; onChange: (key: string) => void }) {
  if (!__DEV__) return null;
  const index = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (step: number) => onChange(variants[(index + step + variants.length) % variants.length].key);
  const v = variants[index];
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ff3ea5', borderRadius: 999, paddingHorizontal: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.5)' }}>
      <Pressable accessibilityLabel="Previous variant" onPress={() => go(-1)} style={{ padding: 14 }}><Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>‹</Text></Pressable>
      <Text style={{ color: 'white', fontWeight: '800', minWidth: 170, textAlign: 'center' }}>{v.key} · {v.name}</Text>
      <Pressable accessibilityLabel="Next variant" onPress={() => go(1)} style={{ padding: 14 }}><Text style={{ color: 'white', fontSize: 18, fontWeight: '800' }}>›</Text></Pressable>
    </View>
  </View>;
}
