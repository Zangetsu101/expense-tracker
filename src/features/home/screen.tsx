import { Suspense, use, useDeferredValue, useMemo, useState } from 'react';
import { QueryErrorResetBoundary, useSuspenseQuery } from '@tanstack/react-query';
import {
  FinancialView,
  HomeLayout,
  AccountSelection,
  FinancialSkeleton,
  FinancialError,
  HomeScreenSkeleton,
  HomeScreenError,
} from './view.tsx';
import { ErrorBoundary } from '@/components/query-error-boundary';
import { resolveHomeAccount } from '@/lib/account-selection';
import { epochDay } from '@/lib/database';
import { homeAccountsQuery, homeSnapshotQuery } from './queries.ts';
import { QueryTimeContext } from '@/lib/query-time';

type FinancialRequest = { accountId: number | null; now: Date };

function FinancialContent({ request, muted }: { request: FinancialRequest; muted: boolean }) {
  const { data } = useSuspenseQuery(homeSnapshotQuery(request.accountId, request.now));
  return <FinancialView snapshot={data} muted={muted} />;
}

function FinancialSection({
  now,
  accountId,
  reset,
}: {
  now: Date;
  accountId: number | null;
  reset: () => void;
}) {
  const request = useMemo(() => ({ accountId, now }), [accountId, now]);
  const deferred = useDeferredValue(request);
  const stale =
    accountId !== deferred.accountId || epochDay(request.now) !== epochDay(deferred.now);
  return (
    <ErrorBoundary
      resetKey={`${deferred.accountId}:${epochDay(deferred.now)}`}
      onReset={reset}
      fallback={(retry) => <FinancialError accountId={accountId} retry={retry} />}
    >
      <Suspense fallback={<FinancialSkeleton accountId={accountId} />}>
        <FinancialContent
          key={`${deferred.accountId}:${epochDay(deferred.now)}`}
          request={deferred}
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
  const accountId = resolveHomeAccount(accounts, selectedAccountId);
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <HomeLayout accountId={accountId} accountsReady>
          <AccountSelection
            accounts={accounts}
            selectedId={accountId}
            loading={isFetching}
            error={!!error && !isFetching}
            onRetry={() => {
              void refetch();
            }}
            onSelect={(id) => {
              reset();
              setSelectedAccountId(id);
            }}
          />
          <FinancialSection accountId={accountId} now={now} reset={reset} />
        </HomeLayout>
      )}
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
