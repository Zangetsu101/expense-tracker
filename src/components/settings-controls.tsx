import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { theme } from '@/theme';
import { Skeleton } from '@/components/loading';

const { colors, spacing } = theme;

export function SettingsRow({
  label,
  description,
  value,
  onPress,
  first = false,
  disabled = false,
  loading = false,
  pendingValue = false,
  warning = false,
}: {
  label: string;
  description?: string;
  value?: string;
  onPress: () => void;
  first?: boolean;
  disabled?: boolean;
  loading?: boolean;
  pendingValue?: boolean;
  warning?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityState={{ disabled, busy: loading || pendingValue }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.controlHeight,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        borderTopWidth: first ? 0 : 1,
        borderColor: colors.line,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={{ color: colors.text, fontSize: theme.type.body }}>{label}</Text>
        {description && (
          <Text style={{ color: colors.muted, fontSize: theme.type.caption, lineHeight: 18 }}>
            {description}
          </Text>
        )}
      </View>
      {pendingValue ? (
        <Skeleton width={70} height={14} animated={false} />
      ) : loading ? (
        <ActivityIndicator size="small" color={colors.muted} />
      ) : (
        value && (
          <Text
            numberOfLines={1}
            style={{
              maxWidth: '50%',
              color: warning ? colors.warning : colors.muted,
              fontSize: theme.type.detail,
            }}
          >
            {value}
          </Text>
        )
      )}
      <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

export function SettingsGroup({
  title,
  children,
  footer,
  clipContent = true,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  clipContent?: boolean;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={{ color: colors.muted, fontSize: theme.type.body, fontWeight: '700' }}
      >
        {title}
      </Text>
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: theme.radius.group,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colors.line,
          overflow: clipContent ? 'hidden' : 'visible',
        }}
      >
        {children}
      </View>
      {footer}
    </View>
  );
}
