import { Suspense, use, useDeferredValue, useMemo, useState } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  HomeView,
  FinancialSkeleton,
  FinancialError,
  HomeScreenSkeleton,
  HomeScreenError,
  type HomeControls,
} from './view.tsx';
import { ErrorBoundary } from './error-boundary.tsx';
import { resolveHomeAccount } from '@/lib/account-selection';
import { epochDay } from '@/lib/database';
import { homeAccountsQuery, homeSnapshotQuery } from './queries.ts';
import { QueryTimeContext } from '@/lib/query-time';

type FinancialRequest = { accountId: number | null; now: Date };

function FinancialContent({
  request,
  controls,
  muted,
}: {
  request: FinancialRequest;
  controls: HomeControls;
  muted: boolean;
}) {
  const { data, error, isFetching } = useSuspenseQuery(
    homeSnapshotQuery(request.accountId, request.now),
  );
  if (error && !isFetching) throw error;
  return <HomeView {...controls} snapshot={data} muted={muted} />;
}

function FinancialSection({
  now,
  controls: accountControls,
  reset,
}: {
  now: Date;
  controls: HomeControls;
  reset: () => void;
}) {
  const client = useQueryClient();
  const { accountId } = accountControls;
  const request = useMemo(() => ({ accountId, now }), [accountId, now]);
  const deferred = useDeferredValue(request);
  const stale =
    accountId !== deferred.accountId || epochDay(request.now) !== epochDay(deferred.now);
  const controls = {
    ...accountControls,
    selectAccount: (id: number | null) => {
      reset();
      accountControls.selectAccount(id);
    },
  };
  return (
    <ErrorBoundary
      resetKey={`${deferred.accountId}:${epochDay(deferred.now)}`}
      onReset={() => {
        reset();
        void client.resetQueries({
          queryKey: homeSnapshotQuery(deferred.accountId, deferred.now).queryKey,
          exact: true,
        });
      }}
      fallback={(retry) => <FinancialError controls={controls} retry={retry} />}
    >
      <Suspense fallback={<FinancialSkeleton controls={controls} />}>
        <FinancialContent
          key={`${deferred.accountId}:${epochDay(deferred.now)}`}
          request={deferred}
          controls={controls}
          muted={stale}
        />
      </Suspense>
    </ErrorBoundary>
  );
}

function Home() {
  const { data: accounts, isFetching, error, refetch } = useSuspenseQuery(homeAccountsQuery());
  const [selectedAccountId, setSelectedAccountId] = useState(() =>
    resolveHomeAccount(accounts, undefined),
  );
  const now = use(QueryTimeContext);
  const controls: HomeControls = {
    accounts,
    accountsReady: true,
    accountId: resolveHomeAccount(accounts, selectedAccountId),
    loading: isFetching,
    error: !!error && !isFetching,
    retry: () => {
      void refetch();
    },
    selectAccount: setSelectedAccountId,
  };
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <FinancialSection now={now} controls={controls} reset={reset} />}
    </QueryErrorResetBoundary>
  );
}

export default function HomeScreen() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallback={(retry) => <HomeScreenError retry={retry} />}>
          <Suspense fallback={<HomeScreenSkeleton />}>
            <Home />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
