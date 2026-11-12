import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { FormButton } from '@/components/form-controls';
import { Skeleton } from '@/components/loading';
import { theme } from '@/theme';

const c = theme.colors;

/** An alert with a Retry button, for a failed read or a failed refresh. */
export function LendingAlert({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={{ gap: 12 }}>
      <Text selectable accessibilityRole="alert" style={{ color: c.warning }}>
        {message}
      </Text>
      <FormButton label="Retry" variant="secondary" onPress={retry} />
    </View>
  );
}

export function LoadingGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: 16 }}>
      {children}
    </View>
  );
}

export function ButtonSkeleton() {
  return <Skeleton width="100%" height={theme.controlHeight} borderRadius={theme.radius.control} />;
}

export function EntryCardSkeleton({ button = true }: { button?: boolean }) {
  return (
    <View style={{ backgroundColor: c.surface, padding: 16, borderRadius: 16, gap: 10 }}>
      <Skeleton width="55%" height={18} />
      <Skeleton width="70%" />
      {button && <ButtonSkeleton />}
    </View>
  );
}

export function FallbackScroll({
  paddingTop = 20,
  children,
}: {
  paddingTop?: number;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, paddingTop, gap: 16, paddingBottom: 48 }}
    >
      {children}
    </ScrollView>
  );
}
