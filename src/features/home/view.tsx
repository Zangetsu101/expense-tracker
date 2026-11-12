import { BackupAttentionBanner } from '@/components/backup-attention-banner';
import { accountParams } from '@/lib/account-selection';
import { type ReactNode } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { SymbolView } from 'expo-symbols';
import { Skeleton } from '@/components/loading';
import { RetryButton } from './cards.tsx';
import { theme } from '@/theme';

const colors = theme.colors;

export function HomeLayout({
  title,
  notice,
  quickAddAccountId,
  accountsReady,
  children,
}: {
  title?: ReactNode;
  /** Stays under the title while the page scrolls. */
  notice?: ReactNode;
  quickAddAccountId: number | null;
  accountsReady: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          ...(title ? { headerTitle: () => title } : {}),
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={{
                minWidth: 48,
                minHeight: 48,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SymbolView
                name={{ ios: 'gearshape', android: 'settings' }}
                size={26}
                tintColor={colors.text}
              />
            </Pressable>
          ),
        }}
      />
      <StatusBar style="light" />
      {notice}
      <BackupAttentionBanner />
      <Animated.View layout={LinearTransition} style={{ flex: 1 }}>
        {children}
      </Animated.View>
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/quick-add',
            params: accountParams(quickAddAccountId),
          })
        }
        disabled={!accountsReady}
        accessibilityState={{ disabled: !accountsReady }}
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        style={({ pressed }) => ({
          position: 'absolute',
          right: 20,
          bottom: 16,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.75 : 1,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        })}
      >
        <SymbolView
          name={{ ios: 'plus', android: 'add' }}
          size={30}
          tintColor={colors.background}
        />
      </Pressable>
    </View>
  );
}

export function RefreshNotice({
  failed,
  onRetry,
  message = 'Couldn’t refresh accounts',
}: {
  failed: boolean;
  onRetry: () => void;
  message?: string;
}) {
  if (!failed) return null;
  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      style={{
        marginHorizontal: 20,
        marginVertical: 8,
        paddingLeft: 14,
        paddingRight: 6,
        borderRadius: 12,
        backgroundColor: 'rgba(244,201,152,0.12)',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <Text accessibilityRole="alert" style={{ color: colors.warning, flex: 1 }}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry refresh"
        onPress={onRetry}
        style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.accent, fontWeight: '700' }}>Retry</Text>
      </Pressable>
    </Animated.View>
  );
}

export function ActivitySkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading activity"
      style={{ paddingTop: 12 }}
    >
      {[0, 1, 2, 3].map((key) => (
        <View
          key={key}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 20,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.line,
          }}
        >
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="65%" height={18} />
            <Skeleton width="45%" />
          </View>
          <Skeleton width={68} height={18} />
        </View>
      ))}
    </View>
  );
}

export function ActivityError({ retry }: { retry: () => void }) {
  return (
    <View style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Text accessibilityRole="alert" style={{ color: colors.muted }}>
        Couldn’t load account activity
      </Text>
      <RetryButton onPress={retry} />
    </View>
  );
}
