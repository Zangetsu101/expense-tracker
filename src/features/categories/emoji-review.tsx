import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppSheet } from '@/components/app-sheet';
import { FormButton } from '@/components/form-controls';
import { type CategoryEmojiSuggestion } from '@/lib/categories';
import { theme as t } from '@/theme';

const c = t.colors;

export function EmojiReview({
  suggestions,
  onApply,
  onClose,
}: {
  suggestions: CategoryEmojiSuggestion[];
  onApply: (suggestions: CategoryEmojiSuggestion[], ids: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [selected, setSelected] = useState(() => new Set(suggestions.map(({ id }) => id)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const saving = useRef(false);

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (saving.current || selected.size === 0) return;
    saving.current = true;
    setPending(true);
    setError(false);
    try {
      await onApply(suggestions, [...selected]);
      onClose();
    } catch {
      setError(true);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  return (
    <AppSheet pending={pending} onDismiss={onClose}>
      <View
        style={{
          width,
          maxHeight: height * 0.82,
          backgroundColor: c.surface,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderCurve: 'continuous',
          padding: t.spacing.xl,
          paddingBottom: t.spacing.xl + insets.bottom,
          gap: t.spacing.md,
        }}
      >
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>
          Review suggested icons
        </Text>
        <Text style={{ color: c.muted }}>Choose which categories get an emoji.</Text>
        <ScrollView
          style={{
            flexGrow: 0,
            backgroundColor: c.root,
            borderRadius: t.radius.group,
            borderCurve: 'continuous',
          }}
        >
          {suggestions.map((suggestion, index) => (
            <EmojiReviewRow
              key={suggestion.id}
              suggestion={suggestion}
              checked={selected.has(suggestion.id)}
              disabled={pending}
              separated={index > 0}
              onToggle={() => toggle(suggestion.id)}
            />
          ))}
        </ScrollView>
        {error && (
          <Text accessibilityRole="alert" style={{ color: c.warning }}>
            Could not apply category icons. Try again.
          </Text>
        )}
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <FormButton
            label="Cancel"
            variant="secondary"
            disabled={pending}
            style={{ flex: 1 }}
            onPress={onClose}
          />
          <FormButton
            label={selected.size ? `Apply ${selected.size}` : 'Apply'}
            loading={pending}
            disabled={!selected.size}
            style={{ flex: 1 }}
            onPress={() => void apply()}
          />
        </View>
      </View>
    </AppSheet>
  );
}

function EmojiReviewRow({
  suggestion: { name, path, emoji, type },
  checked,
  disabled,
  separated,
  onToggle,
}: {
  suggestion: CategoryEmojiSuggestion;
  checked: boolean;
  disabled: boolean;
  separated: boolean;
  onToggle: () => void;
}) {
  const kind = type === 'EXPENSE' ? 'Expense' : 'Income';
  const parentPath = path === name ? '' : path.slice(0, -name.length - 3);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${path}, ${kind}, ${emoji}`}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 60,
        padding: t.spacing.md,
        gap: t.spacing.md,
        borderTopWidth: separated ? 1 : 0,
        borderColor: c.line,
        backgroundColor: pressed ? c.raised : c.root,
      })}
    >
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <View style={{ flex: 1, gap: t.spacing.xs }}>
        <Text style={{ color: c.text, fontSize: t.type.body }}>{name}</Text>
        <Text style={{ color: c.muted, fontSize: t.type.caption }}>
          {parentPath ? `${parentPath} · ${kind}` : kind}
        </Text>
      </View>
      <View
        style={{
          width: 20,
          height: 20,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderRadius: 4,
          borderColor: checked ? c.accent : c.muted,
          backgroundColor: checked ? c.accent : 'transparent',
        }}
      >
        {checked && <Text style={{ color: c.background, fontWeight: '700' }}>✓</Text>}
      </View>
    </Pressable>
  );
}
