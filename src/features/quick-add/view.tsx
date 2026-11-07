import { Suspense, type ReactNode } from 'react';
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
import { CategorySearchInput } from '@/components/quick-select-category';

type ChoicesLayout = 'accounts' | 'categories' | 'people';

function SectionLayout({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View accessibilityLabel={label} style={{ gap: 10 }}>
      {children}
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
    <SectionLayout label={`Loading ${label}`}>
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
  children,
}: {
  options: UseSuspenseQueryOptions<T, Error, T, K>;
  label: string;
  children: (data: T) => ReactNode;
}) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(options);
  return (
    <SectionLayout>
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
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallback={(retry) => (
            <SectionLayout>
              <ChoicesError label={label} retry={retry} />
            </SectionLayout>
          )}
        >
          <Suspense
            fallback={<ChoicesSkeleton label={label} layout={layout} pendingLabel={pendingLabel} />}
          >
            <ReadyChoices options={options} label={label}>
              {children}
            </ReadyChoices>
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
