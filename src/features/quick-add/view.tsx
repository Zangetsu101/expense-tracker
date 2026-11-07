import { Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  QueryErrorResetBoundary,
  useSuspenseQuery,
  type UseSuspenseQueryOptions,
  type QueryKey,
} from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { ErrorBoundary } from '@/components/query-error-boundary';
import { Skeleton, Shimmer } from '@/components/loading';
import { FormButton } from '@/components/form-controls';
import { theme } from '@/theme';

type ChoicesLayout = 'accounts' | 'categories' | 'people';

function SectionLayout({
  layout,
  children,
  label,
}: {
  layout: ChoicesLayout;
  children: ReactNode;
  label?: string;
}) {
  return (
    <View
      accessibilityLabel={label}
      style={{ gap: 10, minHeight: layout === 'categories' ? 210 : 90 }}
    >
      {children}
    </View>
  );
}

function ChoicesSkeleton({ label, layout }: { label: string; layout: ChoicesLayout }) {
  return (
    <SectionLayout layout={layout} label={`Loading ${label}`}>
      <Skeleton width="35%" height={16} />
      {layout === 'categories' && <Skeleton width="100%" height={48} />}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Skeleton width="30%" height={48} />
        <Skeleton width="30%" height={48} />
      </View>
      {layout === 'categories' && <Skeleton width="65%" height={48} />}
    </SectionLayout>
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
  layout,
  children,
}: {
  options: UseSuspenseQueryOptions<T, Error, T, K>;
  label: string;
  layout: ChoicesLayout;
  children: (data: T) => ReactNode;
}) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(options);
  return (
    <SectionLayout layout={layout}>
      {children(data)}
      {isFetching && (
        <View
          accessibilityLabel={`Refreshing ${label}`}
          style={{ position: 'absolute', inset: 0 }}
          pointerEvents="none"
        >
          <Shimmer />
        </View>
      )}
      {!!error && !isFetching && <ChoicesError label={label} retry={() => void refetch()} />}
    </SectionLayout>
  );
}

export function ChoicesSection<T, K extends QueryKey>({
  options,
  label,
  layout,
  children,
}: {
  options: UseSuspenseQueryOptions<T, Error, T, K>;
  label: string;
  layout: ChoicesLayout;
  children: (data: T) => ReactNode;
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallback={(retry) => (
            <SectionLayout layout={layout}>
              <ChoicesError label={label} retry={retry} />
            </SectionLayout>
          )}
        >
          <Suspense fallback={<ChoicesSkeleton label={label} layout={layout} />}>
            <ReadyChoices options={options} label={label} layout={layout}>
              {children}
            </ReadyChoices>
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

export function InitialSelection({
  value,
  onInitialize,
}: {
  value: number | undefined;
  onInitialize: (value: number | undefined) => void;
}) {
  const [initialValue] = useState(() => value);
  useEffect(() => onInitialize(initialValue), [initialValue, onInitialize]);
  return null;
}
