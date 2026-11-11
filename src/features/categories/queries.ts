import { queryOptions } from '@tanstack/react-query';
import { listManagedCategories } from '@/lib/categories';

/** All categories with their parents. The Categories tab and Search share this cache entry. */
export function managedCategoriesQuery() {
  return queryOptions({ queryKey: ['categories', 'managed'], queryFn: listManagedCategories });
}
