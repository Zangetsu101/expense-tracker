import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { theme as t } from '@/theme';

const c = t.colors;
type FormButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function FormButton({
  label, onPress, variant = 'primary', disabled = false,
  loading = false, accessibilityLabel, style,
}: FormButtonProps) {
  const blocked = disabled || loading;
  const color = variant === 'primary' ? c.background : variant === 'danger' ? c.warning : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: t.controlHeight,
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.sm,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: variant === 'primary' ? c.accent : c.line,
          borderRadius: t.radius.control,
          borderCurve: 'continuous',
          backgroundColor: variant === 'primary' ? c.accent : 'transparent',
          opacity: blocked ? 0.45 : pressed ? 0.65 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : (
        <Text style={{ color, fontSize: t.type.body, fontWeight: '600' }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function FormInput({ style, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={c.muted}
      selectionColor={c.accent}
      {...props}
      style={[
        {
          color: c.text,
          fontSize: t.type.body,
          minHeight: t.controlHeight,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: t.radius.control,
          borderCurve: 'continuous',
          padding: t.spacing.md,
        },
        style,
      ]}
    />
  );
}

type JoinedChoiceProps<T extends string> = {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function JoinedChoice<T extends string>({ value, options, onChange, disabled = false, style }: JoinedChoiceProps<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      style={[{
        flexDirection: 'row', borderWidth: 1, borderColor: c.line,
        borderRadius: t.radius.control, borderCurve: 'continuous', overflow: 'hidden',
      }, style]}
    >
      {options.map((option, index) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{ checked: value === option.value, disabled }}
          disabled={disabled}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: t.controlHeight,
            alignItems: 'center',
            justifyContent: 'center',
            borderRightWidth: index < options.length - 1 ? 1 : 0,
            borderColor: c.line,
            backgroundColor: value === option.value ? c.accent : c.surface,
            opacity: disabled ? 0.45 : pressed ? 0.65 : 1,
          })}
        >
          <Text style={{ color: value === option.value ? c.background : c.muted, fontSize: t.type.body, fontWeight: '600' }}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
