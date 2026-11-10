import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { listManagedCategories } from '@/lib/categories';
import { listAccounts } from '@/lib/database';
import { PAGE_SIZE, searchTransactions, type SearchFilters } from '@/lib/transaction-search';

const searchKey = ['transaction-search'] as const;

async function readFilterOptions() {
  const [accounts, categories] = await Promise.all([listAccounts(), listManagedCategories()]);
  return { accounts, categories };
}

export type FilterOptions = Awaited<ReturnType<typeof readFilterOptions>>;

export function searchFilterOptionsQuery() {
  return queryOptions({ queryKey: [...searchKey, 'filter-options'], queryFn: readFilterOptions });
}

export function searchResultsQuery(filters: SearchFilters) {
  return infiniteQueryOptions({
    queryKey: [...searchKey, 'results', filters],
    queryFn: ({ pageParam }) => searchTransactions(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.reduce((count, page) => count + page.length, 0) : undefined,
  });
}
