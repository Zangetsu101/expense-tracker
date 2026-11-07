import { Suspense, use, useDeferredValue, useMemo, useRef, useState } from 'react';
import {
  QueryErrorResetBoundary,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { HomeView, HomeSkeleton, HomeLoadError, type HomeControls } from './view.tsx';
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

function AccountContent({
  now,
  selection,
  selectAccount,
  failed,
  accountsError,
  reloadingAccounts,
  retryAccounts,
  reset,
}: {
  now: Date;
  selection: number | null | undefined;
  selectAccount: (id: number | null) => void;
  failed: boolean;
  accountsError: boolean;
  reloadingAccounts: boolean;
  retryAccounts: () => void;
  reset: () => void;
}) {
  const { data: accounts } = useSuspenseQuery(homeAccountsQuery());
  const accountId = resolveHomeAccount(accounts, selection);
  const request = useMemo(() => ({ accountId, now }), [accountId, now]);
  const deferred = useDeferredValue(request);
  const stale =
    accountId !== deferred.accountId || epochDay(request.now) !== epochDay(deferred.now);
  const status = useQuery({ ...homeSnapshotQuery(accountId, now), enabled: false });
  const boundary = useRef<RetainedQueryBoundary<FinancialRequest>>(null);
  const retry =
    failed || accountsError
      ? retryAccounts
      : () => {
          reset();
          if (status.data) void status.refetch();
          else boundary.current?.retry();
        };
  const controls = {
    accounts,
    accountsReady: true,
    accountId,
    loading: reloadingAccounts || stale || status.isFetching,
    error:
      ((failed || accountsError) && !reloadingAccounts) || (!!status.error && !status.isFetching),
    retry,
    selectAccount,
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
            muted={failed || stale || failedRead}
          />
        )}
      />
    </Suspense>
  );
}

function Home({ reset }: { reset: () => void }) {
  const client = useQueryClient();
  const now = use(QueryTimeContext);
  const deferred = useDeferredValue(now);
  const [selection, setSelection] = useState<number | null>();
  const status = useQuery({ ...homeAccountsQuery(), enabled: false });
  if (status.data) {
    const resolved = resolveHomeAccount(status.data, selection);
    if (selection !== resolved) setSelection(resolved);
  }
  const boundary = useRef<RetainedQueryBoundary<Date>>(null);
  const selectAccount = (accountId: number | null) => {
    reset();
    setSelection(accountId);
  };
  const coldControls = {
    accounts: [],
    accountsReady: false,
    accountId: null,
    loading: true,
    error: false,
    retry: () => boundary.current?.retry(),
    selectAccount,
  };
  return (
    <Suspense fallback={<HomeSkeleton controls={coldControls} />}>
      <RetainedQueryBoundary
        ref={boundary}
        request={deferred}
        requestKey="accounts"
        onReset={() => {
          reset();
          void client.resetQueries({
            queryKey: homeAccountsQuery().queryKey,
            exact: true,
          });
        }}
        fallback={(retry) => <HomeLoadError controls={coldControls} retry={retry} />}
        render={(ready, failed) => (
          <AccountContent
            now={ready}
            selection={selection}
            selectAccount={selectAccount}
            failed={failed}
            accountsError={!!status.error}
            reloadingAccounts={status.isFetching}
            retryAccounts={() => {
              reset();
              if (status.data) void status.refetch();
              else boundary.current?.retry();
            }}
            reset={reset}
          />
        )}
      />
    </Suspense>
  );
}

export default function HomeScreen() {
  return <QueryErrorResetBoundary>{({ reset }) => <Home reset={reset} />}</QueryErrorResetBoundary>;
}
