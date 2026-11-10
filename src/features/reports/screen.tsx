import { useDeferredValue, useMemo, useState } from 'react';
import { QueryErrorResetBoundary, useSuspenseQuery } from '@tanstack/react-query';
import { QueryBoundary } from '@/components/query-error-boundary';
import type { ManagedAccount } from '@/lib/accounts';
import {
  changeReportYear,
  currencyReports,
  currentReportPeriod,
  parseReportYear,
  type ReportPeriod,
} from '@/lib/report-presentation';
import { managedAccountsQuery, monthlyReportQuery } from './queries.ts';
import {
  months,
  PeriodControls,
  RefreshAlert,
  ReportError,
  ReportsError,
  ReportsLayout,
  ReportSkeleton,
  ReportView,
  ScopeAndReportSkeleton,
  ScopePicker,
  scopeLabel,
  ScopeSheet,
  YearSheet,
} from './view.tsx';

type ReportRequest = ReportPeriod & { accountId: number | undefined };
const requestKey = (request: ReportRequest) =>
  `${request.year}-${request.month}-${request.accountId ?? 'all'}`;

function ReportContent({
  request,
  accounts,
  muted,
}: {
  request: ReportRequest;
  accounts: ManagedAccount[];
  muted: boolean;
}) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(
    monthlyReportQuery(request.year, request.month, request.accountId),
  );
  const account = accounts.find((item) => item.id === request.accountId);
  return (
    <>
      {!!error && !isFetching && (
        <RefreshAlert message="Could not refresh the report." retry={() => void refetch()} />
      )}
      <ReportView
        reports={currencyReports(data, accounts, request.accountId)}
        hasAccounts={accounts.length > 0}
        periodLabel={`${months[request.month].label} ${request.year}`}
        scope={scopeLabel(account)}
        muted={muted}
      />
    </>
  );
}

function ReportsScope({ period, reset }: { period: ReportPeriod; reset: () => void }) {
  const { data: accounts, error, isFetching, refetch } = useSuspenseQuery(managedAccountsQuery());
  const [selected, setSelected] = useState<number>();
  const [choosing, setChoosing] = useState(false);
  const account = accounts.find((item) => item.id === selected);
  const accountId = account?.id;
  const request = useMemo(
    () => ({ year: period.year, month: period.month, accountId }),
    [period.year, period.month, accountId],
  );
  const deferred = useDeferredValue(request);
  const key = requestKey(deferred);
  return (
    <>
      <ScopePicker account={account} onOpen={() => setChoosing(true)} />
      {!!error && !isFetching && (
        <RefreshAlert message="Could not refresh accounts." retry={() => void refetch()} />
      )}
      <QueryBoundary
        reset={reset}
        resetKey={key}
        pending={<ReportSkeleton />}
        error={(retry) => <ReportError retry={retry} />}
      >
        <ReportContent
          key={key}
          request={deferred}
          accounts={accounts}
          muted={key !== requestKey(request)}
        />
      </QueryBoundary>
      {choosing && (
        <ScopeSheet
          accounts={accounts}
          selected={accountId}
          onSelect={(value) => {
            reset();
            setSelected(value);
            setChoosing(false);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </>
  );
}

export default function ReportsScreen() {
  const [period, setPeriod] = useState(currentReportPeriod);
  const [choosingYear, setChoosingYear] = useState(false);
  const [yearDraft, setYearDraft] = useState('');
  const [yearError, setYearError] = useState('');
  const applyYear = (reset: () => void) => {
    const value = parseReportYear(yearDraft);
    if (value === undefined) {
      setYearError('Enter a year from 1 to 9999.');
      return;
    }
    reset();
    setPeriod((current) => ({ ...current, year: value }));
    setChoosingYear(false);
  };
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ReportsLayout
          period={
            <PeriodControls
              year={period.year}
              month={period.month}
              onChangeYear={(delta) => {
                reset();
                setPeriod((current) => changeReportYear(current, delta));
              }}
              onChooseYear={() => {
                setYearDraft(String(period.year));
                setYearError('');
                setChoosingYear(true);
              }}
              onChooseMonth={(month) => {
                reset();
                setPeriod((current) => ({ ...current, month }));
              }}
            />
          }
          sheet={
            choosingYear && (
              <YearSheet
                month={period.month}
                draft={yearDraft}
                error={yearError}
                onChangeDraft={(value) => {
                  setYearDraft(value);
                  setYearError('');
                }}
                onApply={() => applyYear(reset)}
                onClose={() => setChoosingYear(false)}
              />
            )
          }
        >
          <QueryBoundary
            reset={reset}
            pending={<ScopeAndReportSkeleton />}
            error={(retry) => <ReportsError retry={retry} />}
          >
            <ReportsScope period={period} reset={reset} />
          </QueryBoundary>
        </ReportsLayout>
      )}
    </QueryErrorResetBoundary>
  );
}
