import { useDeferredValue, useState } from 'react';
import {
  QueryErrorResetBoundary,
  useQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { QueryBoundary } from '@/components/query-error-boundary';
import { parseAccountId } from '@/lib/account-selection';
import type { SearchFilters } from '@/lib/transaction-search';
import { searchFilterOptionsQuery, searchResultsQuery } from './queries.ts';
import {
  AccountChoices,
  ActiveFilterChips,
  CategoryChoices,
  FilterModal,
  initialFilters,
  OptionsError,
  OptionsSkeleton,
  RefreshAlert,
  ResultsError,
  ResultsFooter,
  ResultsList,
  ResultsSkeleton,
  SearchHeader,
  SearchLayout,
} from './view.tsx';

type ClearFilter = (clear: Partial<SearchFilters>) => void;

function Results({ filters, muted }: { filters: SearchFilters; muted: boolean }) {
  const {
    data,
    error,
    isFetching,
    isFetchNextPageError,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useSuspenseInfiniteQuery(searchResultsQuery(filters));
  const rows = data.pages.flat();
  const more = () => void fetchNextPage({ cancelRefetch: false });
  return (
    <ResultsList
      rows={rows}
      hasMore={hasNextPage}
      muted={muted}
      alert={
        !!error &&
        !isFetching &&
        !isFetchNextPageError && <RefreshAlert retry={() => void refetch()} />
      }
      footer={
        <ResultsFooter
          fetchingNext={isFetchingNextPage}
          failed={isFetchNextPageError && !isFetching}
          hasMore={hasNextPage}
          onMore={more}
        />
      }
      onEndReached={() => {
        if (hasNextPage && !error) more();
      }}
    />
  );
}

function FilterOptionsSection(props: {
  draft: SearchFilters;
  changeDraft: (patch: Partial<SearchFilters>) => void;
  categoryQuery: string;
  onCategoryQuery: (query: string) => void;
}) {
  const { data } = useSuspenseQuery(searchFilterOptionsQuery());
  return (
    <>
      <CategoryChoices
        categories={data.categories}
        draft={props.draft}
        changeDraft={props.changeDraft}
        query={props.categoryQuery}
        onQuery={props.onCategoryQuery}
      />
      <AccountChoices
        accounts={data.accounts}
        draft={props.draft}
        changeDraft={props.changeDraft}
      />
    </>
  );
}

function TransactionSearch({ reset }: { reset: () => void }) {
  const params = useLocalSearchParams<{ accountId?: string }>();
  const [filters, setFilters] = useState<SearchFilters>(() => ({
    ...initialFilters,
    accountId: parseAccountId(params.accountId) ?? null,
  }));
  const [draft, setDraft] = useState(filters);
  const [open, setOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');
  // The chips show "Selected" until the options are ready. They need no fallback.
  const { data: options } = useQuery(searchFilterOptionsQuery());
  const deferred = useDeferredValue(filters);
  const filterKey = JSON.stringify(filters);
  const deferredKey = JSON.stringify(deferred);
  const updateFilters = (change: (current: SearchFilters) => SearchFilters) => {
    reset();
    setFilters(change);
  };
  const changeDraft = (patch: Partial<SearchFilters>) => setDraft((old) => ({ ...old, ...patch }));
  const clearFilter: ClearFilter = (clear) => updateFilters((old) => ({ ...old, ...clear }));
  return (
    <SearchLayout>
      <SearchHeader
        query={filters.query}
        onQuery={(query) => updateFilters((old) => ({ ...old, query }))}
        onEditFilters={() => {
          setDraft({ ...filters });
          setCategoryQuery('');
          setOpen(true);
        }}
        chips={<ActiveFilterChips filters={filters} options={options} onClear={clearFilter} />}
      />
      <QueryBoundary
        reset={reset}
        resetKey={deferredKey}
        pending={<ResultsSkeleton />}
        error={(retry) => <ResultsError retry={retry} />}
      >
        <Results key={deferredKey} filters={deferred} muted={deferredKey !== filterKey} />
      </QueryBoundary>
      <FilterModal
        open={open}
        draft={draft}
        changeDraft={changeDraft}
        options={
          <QueryBoundary
            pending={<OptionsSkeleton />}
            error={(retry) => <OptionsError retry={retry} />}
          >
            <FilterOptionsSection
              draft={draft}
              changeDraft={changeDraft}
              categoryQuery={categoryQuery}
              onCategoryQuery={setCategoryQuery}
            />
          </QueryBoundary>
        }
        onApply={() => {
          updateFilters((current) => ({
            ...draft,
            query: current.query,
            startDate: draft.datePreset === 'CUSTOM' ? draft.startDate : '',
            endDate: draft.datePreset === 'CUSTOM' ? draft.endDate : '',
            amount: draft.amountMode === 'ANY' ? '' : draft.amount,
            maximum: draft.amountMode === 'BETWEEN' ? draft.maximum : '',
          }));
          setOpen(false);
        }}
        onClearAll={() => {
          setDraft({ ...initialFilters, query: filters.query });
          setCategoryQuery('');
        }}
        onClose={() => setOpen(false)}
      />
    </SearchLayout>
  );
}

export default function TransactionSearchScreen() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => <TransactionSearch reset={reset} />}
    </QueryErrorResetBoundary>
  );
}
