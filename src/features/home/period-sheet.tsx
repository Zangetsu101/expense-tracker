import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { AppSheet } from '@/components/app-sheet';
import { theme } from '@/theme';
import { homeRanges, maxMonthStart, type PeriodSetting } from './period.ts';

const c = theme.colors;

/** One range for all cards, with a month that can start on payday. */
export function PeriodSheet({
  setting,
  label,
  onChange,
  onDismiss,
}: {
  setting: PeriodSetting;
  label: string;
  onChange: (setting: PeriodSetting) => void;
  onDismiss: () => void;
}) {
  const { width } = useWindowDimensions();
  const month = setting.range === 'month';
  const step = (by: number) =>
    onChange({
      ...setting,
      monthStart: Math.min(maxMonthStart, Math.max(1, setting.monthStart + by)),
    });
  return (
    <AppSheet pending={false} onDismiss={onDismiss}>
      <View
        style={{
          backgroundColor: c.surface,
          width,
          padding: 20,
          paddingBottom: 32,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{ color: c.text, fontSize: 18, fontWeight: '700', marginBottom: 6 }}
        >
          Period
        </Text>
        {homeRanges.map((item) => {
          const selected = item.range === setting.range;
          return (
            <Pressable
              key={item.range}
              accessibilityRole="radio"
              accessibilityLabel={item.label}
              accessibilityState={{ checked: selected }}
              onPress={() => {
                onChange({ ...setting, range: item.range });
                onDismiss();
              }}
              style={{
                minHeight: 54,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottomWidth: 1,
                borderBottomColor: c.line,
              }}
            >
              <Text
                style={{
                  color: selected ? c.accent : c.text,
                  fontSize: 16,
                  fontWeight: selected ? '700' : '400',
                }}
              >
                {item.label}
              </Text>
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: selected ? c.accent : c.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && (
                  <View
                    style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }}
                  />
                )}
              </View>
            </Pressable>
          );
        })}
        <View
          accessibilityState={{ disabled: !month }}
          style={{
            minHeight: 64,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            opacity: month ? 1 : 0.4,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontSize: 16 }}>Month starts on day</Text>
            <Text style={{ color: c.muted, fontSize: 12.5 }}>Set it to your payday</Text>
          </View>
          <StepButton
            label="Earlier day"
            text="−"
            disabled={!month || setting.monthStart === 1}
            onPress={() => step(-1)}
          />
          <Text
            style={{
              color: c.text,
              fontSize: 17,
              fontWeight: '700',
              minWidth: 32,
              textAlign: 'center',
              fontVariant: ['tabular-nums'],
            }}
          >
            {setting.monthStart}
          </Text>
          <StepButton
            label="Later day"
            text="+"
            disabled={!month || setting.monthStart === maxMonthStart}
            onPress={() => step(1)}
          />
        </View>
        <Text style={{ color: c.muted, fontSize: 13 }}>Showing {label}</Text>
      </View>
    </AppSheet>
  );
}

function StepButton({
  label,
  text,
  disabled,
  onPress,
}: {
  label: string;
  text: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: c.raised,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: c.text, fontSize: 20 }}>{text}</Text>
    </Pressable>
  );
}
