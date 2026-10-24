import type { CategoryType, ManagedCategory } from './categories';

export type TaxonomyCategory = Pick<ManagedCategory, 'id' | 'name' | 'type' | 'parentId'>;
export type VisibleCategory<T extends TaxonomyCategory = ManagedCategory> = { item: T; children: VisibleCategory<T>[]; reveal: boolean };

/** Full ancestor path, stopping safely at missing parents or cycles. */
export function categoryPath(items: readonly TaxonomyCategory[], category: TaxonomyCategory): string {
  const byId = new Map(items.map(item => [item.id, item]));
  const names: string[] = [];
  const seen = new Set<number>();
  let current: TaxonomyCategory | undefined = category;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    const parent: TaxonomyCategory | undefined = current.parentId === null ? undefined : byId.get(current.parentId);
    current = parent?.type === category.type ? parent : undefined;
  }
  return names.join(' / ');
}

/** A name match exposes its subtree; descendant matches expose their ancestor path. */
export function visibleTaxonomy<T extends TaxonomyCategory>(items: readonly T[], type: CategoryType, query: string): VisibleCategory<T>[] {
  const term = query.trim().toLocaleLowerCase();
  const group = items.filter(item => item.type === type);
  const byId = new Map(group.map(item => [item.id, item]));
  const children = new Map<number, T[]>();
  for (const item of group) {
    if (item.parentId !== null && byId.has(item.parentId)) {
      children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
    }
  }
  const visited = new Set<number>();
  const build = (item: T, inherited: boolean): VisibleCategory<T> | null => {
    if (visited.has(item.id)) return null;
    visited.add(item.id);
    const matches = inherited || (!!term && item.name.toLocaleLowerCase().includes(term));
    const descendants = (children.get(item.id) ?? []).map(child => build(child, matches)).filter((child): child is VisibleCategory<T> => child !== null);
    if (term && !matches && !descendants.length) return null;
    return { item, children: descendants, reveal: !!term };
  };
  const roots = group.filter(item => item.parentId === null || !byId.has(item.parentId));
  const result = roots.map(item => build(item, false)).filter((node): node is VisibleCategory<T> => node !== null);
  // Malformed cyclic imports remain browsable rather than disappearing.
  for (const item of group) if (!visited.has(item.id)) { const node = build(item, false); if (node) result.push(node); }
  return result;
}
