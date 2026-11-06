import { notifyDataChanged } from './data-changes.ts';
import { database } from './database';

export type CategoryType = 'EXPENSE' | 'INCOME';
export type CreateCategoryInput = { name: string; type: CategoryType; parentId?: number | null };
export type ManagedCategory = {
  id: number;
  name: string;
  type: CategoryType;
  parentId: number | null;
  parentName: string | null;
  needsReview: number;
};

export async function listManagedCategories(): Promise<ManagedCategory[]> {
  return (await database())
    .getAllAsync<ManagedCategory>(`SELECT c.id, c.name, c.type, c.parentId, p.name AS parentName, c.needsReview
    FROM categories c LEFT JOIN categories p ON p.id = c.parentId
    ORDER BY c.type, c.name COLLATE NOCASE, c.id`);
}

export async function createCategory(input: CreateCategoryInput): Promise<void> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error('Enter a category name (up to 100 characters).');
  if (input.type !== 'EXPENSE' && input.type !== 'INCOME')
    throw new Error('Choose Expense or Income.');
  const parentId = input.parentId ?? null;
  if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0))
    throw new Error('Invalid parent Category.');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    if (parentId !== null) {
      const parent = await tx.getFirstAsync<{ type: string }>(
        'SELECT type FROM categories WHERE id = ?',
        [parentId],
      );
      if (!parent || parent.type !== input.type)
        throw new Error('Choose a parent Category of the same type.');
    }
    const existing = await tx.getFirstAsync(
      'SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND type = ?',
      [name, input.type],
    );
    if (existing) throw new Error('A Category with this name and type already exists.');
    await tx.runAsync('INSERT INTO categories (name, type, parentId) VALUES (?, ?, ?)', [
      name,
      input.type,
      parentId,
    ]);
  });
  notifyDataChanged();
}

export async function renameCategory(id: number, inputName: string): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid Category.');
  const name = inputName.trim();
  if (!name || name.length > 100) throw new Error('Enter a category name (up to 100 characters).');
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const category = await tx.getFirstAsync<{ type: CategoryType }>(
      'SELECT type FROM categories WHERE id = ?',
      [id],
    );
    if (!category) throw new Error('Category no longer exists.');
    const duplicate = await tx.getFirstAsync(
      'SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND type = ? AND id <> ?',
      [name, category.type, id],
    );
    if (duplicate) throw new Error('A Category with this name and type already exists.');
    await tx.runAsync('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
  });
  notifyDataChanged();
}

export async function markCategoryReviewed(id: number, confirmedType: CategoryType): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid Category.');
  const db = await database();
  if (confirmedType !== 'EXPENSE' && confirmedType !== 'INCOME')
    throw new Error('Choose Expense or Income.');
  const result = await db.runAsync(
    'UPDATE categories SET needsReview = 0 WHERE id = ? AND type = ? AND needsReview = 1',
    [id, confirmedType],
  );
  if (!result.changes) throw new Error('Category is not awaiting review.');
}
