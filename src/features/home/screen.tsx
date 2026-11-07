import { Suspense, use, useDeferredValue, useMemo, useRef, useState } from 'react';
import { QueryErrorResetBoundary, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import {
  HomeView,
  HomeSkeleton,
  HomeLoadError,
  AccountsSkeleton,
  AccountsLoadError,
  type HomeControls,
} from './view.tsx';
import { ErrorBoundary } from './error-boundary.tsx';
import { RetainedQueryBoundary } from './retained-query.tsx';
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
  const { data } = useSuspenseQuery(homeSnapshotQuery(request.accountId, request.now));
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
  const { accountId } = accountControls;
  const request = useMemo(() => ({ accountId, now }), [accountId, now]);
  const deferred = useDeferredValue(request);
  const stale =
    accountId !== deferred.accountId || epochDay(request.now) !== epochDay(deferred.now);
  const requestedSnapshot = useQuery({ ...homeSnapshotQuery(accountId, now), enabled: false });
  const boundary = useRef<RetainedQueryBoundary<FinancialRequest>>(null);
  const retry = () => {
    if (accountControls.error) accountControls.retry();
    if (requestedSnapshot.error) {
      if (requestedSnapshot.data) void requestedSnapshot.refetch();
      else boundary.current?.retry();
    }
  };
  const controls = {
    ...accountControls,
    loading: accountControls.loading || stale || requestedSnapshot.isFetching,
    error: accountControls.error || (!!requestedSnapshot.error && !requestedSnapshot.isFetching),
    retry,
    selectAccount: (id: number | null) => {
      reset();
      accountControls.selectAccount(id);
    },
  };
  return (
    <Suspense fallback={<HomeSkeleton controls={controls} />}>
      <RetainedQueryBoundary
        ref={boundary}
        request={deferred}
        requestKey={`${deferred.accountId}:${epochDay(deferred.now)}`}
        onReset={reset}
        fallback={(retry) => <HomeLoadError controls={controls} retry={retry} />}
        render={(ready, failedRead) => (
          <FinancialContent
            key={`${ready.accountId}:${epochDay(ready.now)}`}
            request={ready}
            controls={controls}
            muted={stale || failedRead}
          />
        )}
      />
    </Suspense>
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
        <ErrorBoundary onReset={reset} fallback={(retry) => <AccountsLoadError retry={retry} />}>
          <Suspense fallback={<AccountsSkeleton />}>
            <Home />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
