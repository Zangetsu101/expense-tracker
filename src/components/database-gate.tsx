import { Suspense, use, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ErrorBoundary } from '@/components/query-error-boundary';
import { database, resetDatabase } from '@/lib/database';
import { theme } from '@/theme';

const c = theme.colors;

/**
 * Shows the app only after database() is ready. The first start after an update can
 * migrate the data (ADR 0013). If that fails, the migration rolls back and the screens stay
 * closed, so no screen and no scheduled backup tries again on its own.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  return (
    // database() keeps a failed promise until resetDatabase(), so only Try again opens the
    // database again.
    <ErrorBoundary
      onReset={resetDatabase}
      fallback={(retry, error) => (
        <DatabaseError
          message={error instanceof Error ? error.message : String(error)}
          onRetry={retry}
        />
      )}
    >
      <Suspense fallback={<DatabaseOpening />}>
        <OpenDatabase>{children}</OpenDatabase>
      </Suspense>
    </ErrorBoundary>
  );
}

function OpenDatabase({ children }: { children: ReactNode }) {
  use(database());
  return children;
}

function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }}
    >
      {children}
    </ScrollView>
  );
}

function DatabaseOpening() {
  return (
    <Page>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <ActivityIndicator color={c.accent} />
        <Text style={{ color: c.muted, fontSize: theme.type.body }}>Opening your data…</Text>
      </View>
    </Page>
  );
}

function DatabaseError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Page>
      <Text
        accessibilityRole="header"
        style={{ color: c.text, fontSize: theme.type.heading, fontWeight: '700' }}
      >
        The app could not open your data
      </Text>
      <Text selectable style={{ color: c.warning, fontSize: theme.type.detail }}>
        {message}
      </Text>
      <Text style={{ color: c.muted, fontSize: theme.type.body, lineHeight: 22 }}>
        If the app was updating your data, it stopped the update and kept the data as it was. A
        later version of the app can update it. Send the error text above to the developer.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
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
    </Page>
  );
}
