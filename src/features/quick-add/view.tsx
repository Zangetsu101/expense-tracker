import { Children, type ReactNode } from 'react';
import {
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { Text, View, type ViewProps } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { QueryBoundary } from '@/components/query-error-boundary';
import { Skeleton } from '@/components/loading';
import { FormButton } from '@/components/form-controls';
import { theme } from '@/theme';
import { CategorySearchInput } from '@/components/quick-select-category';

type ChoicesLayout = 'accounts' | 'categories' | 'people';

export const layoutTransition = LinearTransition.springify()
  .dampingRatio(2)
  .duration(300)
  .reduceMotion(ReduceMotion.System);

export function FormSection({
  children,
  label,
  gap = 10,
}: {
  children: ReactNode;
  label?: string;
  gap?: number;
}) {
  return (
    <Animated.View layout={layoutTransition} accessibilityLabel={label} style={{ gap }}>
      {children}
    </Animated.View>
  );
}

export function AnimatedStack({
  children,
  gap = 18,
  style,
  ...props
}: ViewProps & { gap?: number }) {
  return (
    <View {...props} style={[{ gap }, style]}>
      {Children.map(children, (child) =>
        child == null || typeof child === 'boolean' ? null : (
          <Animated.View layout={layoutTransition}>{child}</Animated.View>
        ),
      )}
    </View>
  );
}

function PillSkeletonRows({
  height,
  borderRadius,
  columns,
}: {
  height: number;
  borderRadius: number;
  columns: 2 | 3 | 4;
}) {
  return (
    <View style={{ gap: 8 }}>
      {[0, 1].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 8 }}>
          {Array.from({ length: columns }, (_, column) => (
            <View key={column} style={{ flex: 1 }}>
              <Skeleton width="100%" height={height} borderRadius={borderRadius} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function ChoicesSkeleton({
  label,
  layout,
  pendingLabel,
}: {
  label: string;
  layout: ChoicesLayout;
  pendingLabel?: string;
}) {
  return (
    <FormSection label={`Loading ${label}`}>
      {layout === 'categories' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: theme.colors.text }}>Selected:</Text>
            <Skeleton width="35%" height={16} />
          </View>
          <CategorySearchInput disabled />
          <PillSkeletonRows height={38} borderRadius={12} columns={4} />
        </>
      ) : layout === 'accounts' ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{pendingLabel}</Text>
            <Skeleton width="35%" height={12} />
          </View>
          <PillSkeletonRows height={48} borderRadius={14} columns={3} />
        </>
      ) : (
        <PillSkeletonRows height={48} borderRadius={14} columns={2} />
      )}
    </FormSection>
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
    <FormSection>
      {children(data)}
      {!!error && !isFetching && <ChoicesError label={label} retry={() => void refetch()} />}
    </FormSection>
  );
}

export function ChoicesSection<T, K extends QueryKey>({
  options,
  label,
  layout,
  pendingLabel,
  children,
}: {
  options: UseSuspenseQueryOptions<T, Error, T, K>;
  label: string;
  layout: ChoicesLayout;
  pendingLabel?: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <QueryBoundary
      pending={<ChoicesSkeleton label={label} layout={layout} pendingLabel={pendingLabel} />}
      error={(retry) => (
        <FormSection>
          <ChoicesError label={label} retry={retry} />
        </FormSection>
      )}
    >
      <ReadyChoices options={options} label={label}>
        {children}
      </ReadyChoices>
    </QueryBoundary>
  );
}
