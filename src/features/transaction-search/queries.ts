import { infiniteQueryOptions } from '@tanstack/react-query';
import { PAGE_SIZE, searchTransactions, type SearchFilters } from '@/lib/transaction-search';

const searchKey = ['transaction-search'] as const;

export function searchResultsQuery(filters: SearchFilters) {
  return infiniteQueryOptions({
    queryKey: [...searchKey, 'results', filters],
    queryFn: ({ pageParam }) => searchTransactions(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.reduce((count, page) => count + page.length, 0) : undefined,
  });
}
