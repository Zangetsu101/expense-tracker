import { queryOptions } from '@tanstack/react-query';
import { listAccounts } from '@/lib/database';

export function transferAccountsQuery() {
  return queryOptions({ queryKey: ['transfer', 'accounts'], queryFn: listAccounts });
}
