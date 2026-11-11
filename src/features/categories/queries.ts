import { queryOptions } from '@tanstack/react-query';
import { listManagedCategories } from '@/lib/categories';

export function managedCategoriesQuery() {
  return queryOptions({ queryKey: ['categories', 'managed'], queryFn: listManagedCategories });
}
