import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { database } from '@/lib/database';
import { theme } from '@/theme';

type State = { status: 'opening' } | { status: 'ready' } | { status: 'failed'; message: string };

/**
 * Shows the app only after database() is ready. The first start after an update can
 * migrate the data (ADR 0013). If that fails, the migration rolls back and the screens stay
 * closed, so no screen and no scheduled backup tries again on its own.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'opening' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    database().then(
      () => {
        if (active) setState({ status: 'ready' });
      },
      (error: unknown) => {
        if (active)
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === 'ready') return children;
  const c = theme.colors;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }}
    >
      {state.status === 'opening' ? (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={c.accent} />
          <Text style={{ color: c.muted, fontSize: theme.type.body }}>Opening your data…</Text>
        </View>
      ) : (
        <>
          <Text
            accessibilityRole="header"
            style={{ color: c.text, fontSize: theme.type.heading, fontWeight: '700' }}
          >
            The app could not open your data
          </Text>
          <Text selectable style={{ color: c.warning, fontSize: theme.type.detail }}>
            {state.message}
          </Text>
          <Text style={{ color: c.muted, fontSize: theme.type.body, lineHeight: 22 }}>
            The data on this phone did not change. A later version of the app can open it. Send the
            error text above to the developer.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setState({ status: 'opening' });
              setAttempt((count) => count + 1);
            }}
            style={{
              minHeight: theme.controlHeight,
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: c.warning,
              borderRadius: theme.radius.control,
            }}
          >
            <Text style={{ color: c.warning, fontSize: theme.type.body }}>Try again</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
