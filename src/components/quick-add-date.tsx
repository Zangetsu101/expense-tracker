import { useState } from 'react';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { Pressable, Text, View } from 'react-native';

const ink = '#f2f4f0';
const muted = '#aab9b7';
const panel = '#1d2a30';
const accent = '#b8e2bd';

function day(days = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}
function sameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress} style={{ minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: selected ? accent : panel, borderRadius: 14 }}><Text style={{ color: selected ? '#10231c' : ink }}>{title}</Text></Pressable>;
}

export function QuickAddDate({ value: selected, onChange }: { value: Date; onChange: (date: Date) => void }) {
  const [open, setOpen] = useState(false);
  const today = day();
  const select = (date: Date) => {
    const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    if (local.getTime() > day().getTime()) return;
    onChange(local);
    setOpen(false);
  };
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Choice title="Today" selected={sameDate(selected, today)} onPress={() => select(today)} />
      <Choice title="Yesterday" selected={sameDate(selected, day(-1))} onPress={() => select(day(-1))} />
      <Choice title="Choose date…" selected={open} onPress={() => { setOpen(true); }} />
    </View>
    {open && <View style={{ backgroundColor: panel, borderRadius: 18, padding: 12 }}>
      <Text style={{ color: muted, paddingBottom: 8 }}>Pick a past date</Text>
      <DateTimePicker value={selected} mode="date" maximumDate={today} display={process.env.EXPO_OS === 'ios' ? 'inline' : 'default'} presentation={process.env.EXPO_OS === 'android' ? 'dialog' : 'inline'} accentColor={accent} {...(process.env.EXPO_OS === 'ios' ? { themeVariant: 'dark' as const } : {})} onValueChange={(_, date) => select(date)} onDismiss={() => setOpen(false)} />
      {process.env.EXPO_OS !== 'android' && <Choice title="Close date picker" selected={false} onPress={() => setOpen(false)} />}
    </View>}
    <Text selectable accessibilityLiveRegion="polite" style={{ color: muted }}>Date: {selected.toLocaleDateString(undefined, { dateStyle: 'full' })}</Text>
  </View>;
}
