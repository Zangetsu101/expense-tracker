import { use, useDeferredValue, useState, type ReactNode } from 'react';
import {
  QueryErrorResetBoundary,
  useQuery,
  useQueryClient,
  useSuspenseQueries,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { router } from 'expo-router';
import { AccountSheet, AccountTitle } from '@/components/account-sheet';
import { QueryBoundary } from '@/components/query-error-boundary';
import { defaultCurrencyCode } from '@/lib/currency';
import { epochDay } from '@/lib/database';
import { QueryTimeContext } from '@/lib/query-time';
import { changeMark, currencyTotals, scopeCurrencies } from '@/lib/report-presentation';
import { transactionsHref } from '@/lib/report-links';
import {
  managedAccountsQuery,
  rangeReportQuery,
  reportSettingsQuery,
  trendQuery,
} from './queries.ts';
import {
  canStepForward,
  matchingShortcut,
  rangeTitle,
  shortcutRange,
  stepRange,
  type RangeSettings,
  type ReportRange,
} from './range.ts';
import { saveFiscalStart } from './read-reports.ts';
import { TrendCards } from './trends.tsx';
import { moverRows } from '@/lib/usual-spending';
import {
  LoadError,
  Note,
  RangeHeader,
  RangeHeaderSkeleton,
  RangeSheet,
  RefreshAlert,
  ReportPage,
  SegmentedSwitch,
  TotalsSkeleton,
  TotalsView,
  type Marks,
} from './view.tsx';

type TotalsRequest = { range: ReportRange; accountId: number | undefined; currency: string };
const requestKey = ({ range, accountId, currency }: TotalsRequest) =>
  `${range.start}-${range.end}-${accountId ?? 'all'}-${currency}`;

/** ▲ and ▼ for each Category, when the range is the current month. Totals do not wait for them. */
function useMarks(request: TotalsRequest, settings: RangeSettings, today: number): Marks | null {
  const current = matchingShortcut(request.range, today, settings) === 'month';
  const { data } = useQuery({
    ...trendQuery(request.accountId ?? null, 'month', settings.monthStart, today),
    enabled: current,
  });
  if (!current || !data) return null;
  const movers = moverRows(data.rows, data.periods, today, request.currency, 'current');
  if (movers.status !== 'ready') return null;
  const level = (rows: { id: number | null; nowMinor: number; usualMinor: number }[]) =>
    new Map(rows.map((row) => [row.id, changeMark(row.nowMinor, row.usualMinor)]));
  const marks: Marks = {
    parents: level(movers.rows),
    children: level(movers.rows.flatMap((parent) => parent.children)),
  };
  return marks;
}

function Totals({
  request,
  settings,
  today,
  muted,
}: {
  request: TotalsRequest;
  settings: RangeSettings;
  today: number;
  muted: boolean;
}) {
  const { data, error, isFetching, refetch } = useSuspenseQuery(
    rangeReportQuery(request.range, request.accountId),
  );
  const marks = useMarks(request, settings, today);
  return (
    <>
      {!!error && !isFetching && (
        <RefreshAlert message="Could not refresh the report." retry={() => void refetch()} />
      )}
      <TotalsView
        totals={currencyTotals(data, request.currency)}
        marks={marks}
        muted={muted}
        emptyText="No reportable Expenses in this range."
        onOpenTransactions={(categoryId) =>
          router.push(transactionsHref(categoryId, request.range, request.accountId))
        }
      />
    </>
  );
}

function ReportsBody({ reset, today }: { reset: () => void; today: number }) {
  const client = useQueryClient();
  const [{ data: accounts, error, isFetching, refetch }, { data: settings }] = useSuspenseQueries({
    queries: [managedAccountsQuery(), reportSettingsQuery()],
  });
  const [range, setRange] = useState(() => shortcutRange('month', today, settings));
  const [selected, setSelected] = useState<number>();
  const [chosenCurrency, setChosenCurrency] = useState<string>();
  const [sheet, setSheet] = useState<'range' | 'scope' | null>(null);
  const account = accounts.find((item) => item.id === selected);
  const accountId = account?.id;
  const favorite = accounts.find((item) => item.isFavorite) ?? accounts[0];
  const currencies = scopeCurrencies(
    accounts,
    accountId,
    favorite?.currencyCode ?? defaultCurrencyCode,
  );
  const currency =
    chosenCurrency && currencies.includes(chosenCurrency)
      ? chosenCurrency
      : (currencies[0] ?? defaultCurrencyCode);
  const request = { range, accountId, currency };
  // Each part keeps its identity, so the deferred render ends when the new totals are ready.
  const deferred = {
    range: useDeferredValue(range),
    accountId: useDeferredValue(accountId),
    currency: useDeferredValue(currency),
  };
  const key = requestKey(deferred);
  const title = rangeTitle(range, today, settings);
  const change = (next: ReportRange) => {
    reset();
    setRange(next);
  };
  const selectAccount = (id: number | undefined) => {
    reset();
    setSelected(id);
    setSheet(null);
  };
  const changeFiscalStart = (month: number) => {
    const next = { ...settings, fiscalStart: month };
    client.setQueryData(reportSettingsQuery().queryKey, next);
    void saveFiscalStart(month).catch(() => void client.invalidateQueries(reportSettingsQuery()));
  };
  let sheetContent: ReactNode = null;
  if (sheet === 'range')
    sheetContent = (
      <RangeSheet
        range={range}
        today={today}
        settings={settings}
        onChange={change}
        onFiscalStart={changeFiscalStart}
        onClose={() => setSheet(null)}
      />
    );
  else if (sheet === 'scope')
    sheetContent = (
      <AccountSheet
        onAddAccount={() => {
          setSheet(null);
          router.push('/accounts');
        }}
        onDismiss={() => setSheet(null)}
      >
        <AccountSheet.Option
          name="All accounts"
          selected={accountId === undefined}
          onPress={() => selectAccount(undefined)}
        />
        {accounts.map((item) => (
          <AccountSheet.Option
            key={item.id}
            name={item.name}
            detail={item.currencyCode}
            favorite={!!item.isFavorite}
            selected={accountId === item.id}
            onPress={() => selectAccount(item.id)}
          />
        ))}
      </AccountSheet>
    );
  return (
    <ReportPage
      title="Reports"
      headerTitle={
        <AccountTitle name={account?.name ?? 'All accounts'} onPress={() => setSheet('scope')} />
      }
      sheet={sheetContent}
    >
      <RangeHeader
        name={title.name}
        dates={title.dates}
        nextDisabled={!canStepForward(range, today)}
        onPrevious={() => change(stepRange(range, -1, settings))}
        onNext={() => change(stepRange(range, 1, settings))}
        onOpen={() => setSheet('range')}
      />
      {!!error && !isFetching && (
        <RefreshAlert message="Could not refresh accounts." retry={() => void refetch()} />
      )}
      {!account && currencies.length > 1 && (
        <SegmentedSwitch
          options={currencies.map((code) => ({ value: code, text: code, label: `Show ${code}` }))}
          selected={currency}
          onSelect={(code) => {
            reset();
            setChosenCurrency(code);
          }}
        />
      )}
      {accounts.length === 0 ? (
        <Note>Add an account and transactions to see reports.</Note>
      ) : (
        <>
          <QueryBoundary
            reset={reset}
            resetKey={key}
            pending={<TotalsSkeleton />}
            error={(retry) => <LoadError message="Could not load the report." retry={retry} />}
          >
            <Totals
              key={key}
              request={deferred}
              settings={settings}
              today={today}
              muted={key !== requestKey(request)}
            />
          </QueryBoundary>
          <TrendCards
            accountId={deferred.accountId}
            currency={deferred.currency}
            monthStart={settings.monthStart}
            today={today}
            muted={deferred.accountId !== accountId || deferred.currency !== currency}
          />
        </>
      )}
      <Note>
        Transfers and Transactions marked Exclude report are left out of Income, Expense and
        spending.
      </Note>
    </ReportPage>
  );
}

function ReportsSkeleton() {
  return (
    <ReportPage title="Reports">
      <RangeHeaderSkeleton />
      <TotalsSkeleton />
    </ReportPage>
  );
}

function ReportsLoadError({ retry }: { retry: () => void }) {
  return (
    <ReportPage title="Reports">
      <LoadError message="Could not load accounts." retry={retry} />
    </ReportPage>
  );
}

export default function ReportsScreen() {
  const today = epochDay(useDeferredValue(use(QueryTimeContext)));
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <QueryBoundary
          reset={reset}
          pending={<ReportsSkeleton />}
          error={(retry) => <ReportsLoadError retry={retry} />}
        >
          <ReportsBody reset={reset} today={today} />
        </QueryBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
