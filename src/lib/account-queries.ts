import { queryOptions } from '@tanstack/react-query';
import { listAccounts } from '@/lib/database';

/** The account list. All screens that choose an account share this cache entry. */
export function accountsQuery() {
  return queryOptions({ queryKey: ['accounts', 'list'], queryFn: listAccounts });
}
