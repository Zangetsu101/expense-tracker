import { type ReactNode } from 'react';
import {
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { FormButton } from '@/components/form-controls';
import { theme } from '@/theme';

export const layoutTransition = LinearTransition.springify()
  .dampingRatio(2)
  .duration(300)
  .reduceMotion(ReduceMotion.System);

export function PeopleChoicesSkeleton() {
  return (
    <View style={{ gap: 8 }}>
      {[0, 1].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 8 }}>
          {Array.from({ length: 2 }, (_, column) => (
            <View key={column} style={{ flex: 1 }}>
              <Skeleton width="100%" height={48} borderRadius={14} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function ChoicesError({ label, retry }: { label: string; retry: () => void }) {
  return (
    <>
      <Text accessibilityRole="alert" style={{ color: theme.colors.warning }}>
        Could not load {label}.
      </Text>
      <FormButton label={`Retry ${label}`} variant="secondary" onPress={retry} />
    </>
  );
}

function ReadyChoices<T, K extends QueryKey>({
  options,
  label,
  children,
}: {
  options: UseSuspenseQueryOptions<T, Error, T, K>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(options);
  return (
    <View style={{ gap: 10 }}>
      {children(data)}
      {!!error && !isFetching && <ChoicesError label={label} retry={() => void refetch()} />}
    </View>
  );
}

export function ChoicesSection<T, K extends QueryKey>({
  options,
  label,
  pending,
  children,
}: {
  options: UseSuspenseQueryOptions<T, Error, T, K>;
  label: string;
  pending: ReactNode;
  children: (data: T) => ReactNode;
}) {
  return (
    <QueryBoundary
      pending={
        <View accessibilityLabel={`Loading ${label}`} style={{ gap: 10 }}>
          {pending}
        </View>
      }
      error={(retry) => (
        <View style={{ gap: 10 }}>
          <ChoicesError label={label} retry={retry} />
        </View>
      )}
    >
      <ReadyChoices options={options} label={label}>
        {children}
      </ReadyChoices>
    </QueryBoundary>
  );
}
