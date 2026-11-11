import { queryOptions } from '@tanstack/react-query';
import { listAccounts } from '@/lib/database';

export function accountsQuery() {
  return queryOptions({ queryKey: ['accounts', 'list'], queryFn: listAccounts });
}
