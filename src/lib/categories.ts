import { normalizeCategoryEmojiPath, suggestCategoryEmoji } from './category-emoji-suggestions.ts';
import { categoryPath } from './category-taxonomy.ts';
import { notifyDataChanged } from './data-changes.ts';
import { database } from './database';

export type CategoryType = 'EXPENSE' | 'INCOME';
export type CreateCategoryInput = {
  name: string;
  type: CategoryType;
  parentId?: number | null;
  /** An emoji for the list on Home. */
  emoji?: string | null;
};
export type ManagedCategory = {
  id: number;
  name: string;
  type: CategoryType;
  parentId: number | null;
  parentName: string | null;
  emoji: string | null;
};

/** The longest emoji in UTF-16 units. A family emoji uses 11. */
export const maxCategoryEmojiLength = 16;

/** Trims the emoji. An empty emoji is no emoji. */
function normalizeEmoji(value: string | null | undefined): string | null {
  const emoji = value?.trim() || null;
  if (emoji && emoji.length > maxCategoryEmojiLength)
    throw new Error(`Use ${maxCategoryEmojiLength} characters or fewer for the emoji.`);
  return emoji;
}

export async function listCategoriesByRecentUse(type: CategoryType): Promise<ManagedCategory[]> {
  return (await database()).getAllAsync<ManagedCategory>(
    `SELECT c.id, c.name, c.type, c.parentId, p.name AS parentName, c.iconKey AS emoji
       FROM categories c LEFT JOIN categories p ON p.id = c.parentId
       LEFT JOIN transactions t ON t.id = (
         SELECT id FROM transactions WHERE categoryId = c.id AND kind = c.type
         ORDER BY date DESC, id DESC LIMIT 1
       ) WHERE c.type = ?
       ORDER BY t.date DESC, t.id DESC, c.name COLLATE NOCASE, c.id`,
    [type],
  );
}

const managedCategoriesSql = `SELECT c.id, c.name, c.type, c.parentId, p.name AS parentName, c.iconKey AS emoji
  FROM categories c LEFT JOIN categories p ON p.id = c.parentId
  ORDER BY c.type, c.name COLLATE NOCASE, c.id`;

export async function listManagedCategories(): Promise<ManagedCategory[]> {
  return (await database()).getAllAsync<ManagedCategory>(managedCategoriesSql);
}

type SettingsReader = Pick<Awaited<ReturnType<typeof database>>, 'getFirstAsync'>;
const emojiDismissalsKey = 'categoryEmojiDismissals';

async function readEmojiDismissals(db: SettingsReader): Promise<string[]> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [emojiDismissalsKey],
  );
  return row ? JSON.parse(row.value) : [];
}

export async function listCategoryEmojiDismissals(): Promise<string[]> {
  return readEmojiDismissals(await database());
}

export type CategoryEmojiSuggestion = {
  id: number;
  type: CategoryType;
  name: string;
  path: string;
  emoji: string;
};

/** Home uses the immediate parent's explicit icon as its fallback. */
export function categoryDisplayEmoji(
  item: ManagedCategory,
  parent?: ManagedCategory,
): string | null {
  return item.emoji || parent?.emoji || null;
}

export function categoryEmojiSuggestions(
  items: ManagedCategory[],
  dismissals: readonly string[],
): CategoryEmojiSuggestion[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const skipped = new Set(dismissals);
  return items.flatMap((item) => {
    const parent = item.parentId === null ? undefined : byId.get(item.parentId);
    if (categoryDisplayEmoji(item, parent)) return [];
    const path = categoryPath(items, item);
    const [emoji] = suggestCategoryEmoji(item.type, path, item.name);
    if (!emoji || skipped.has(emojiDismissalKey(item.id, item.type, emoji))) return [];
    return [{ id: item.id, type: item.type, name: item.name, path, emoji }];
  });
}

function emojiDismissalKey(id: number, type: CategoryType, emoji: string): string {
  return JSON.stringify([id, type, emoji]);
}

export async function applyCategoryEmojiSuggestions(
  reviewed: readonly CategoryEmojiSuggestion[],
  selectedIds: readonly number[],
): Promise<number> {
  if (!selectedIds.length) return 0;
  const selected = new Set(selectedIds);
  const db = await database();
  let applied = 0;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const items = await tx.getAllAsync<ManagedCategory>(managedCategoriesSql);
    const dismissals = new Set(await readEmojiDismissals(tx));
    const current = new Map(
      categoryEmojiSuggestions(items, [...dismissals]).map((suggestion) => [
        suggestion.id,
        suggestion,
      ]),
    );
    for (const suggestion of reviewed) {
      const match = current.get(suggestion.id);
      if (
        !match ||
        match.type !== suggestion.type ||
        match.emoji !== suggestion.emoji ||
        normalizeCategoryEmojiPath(match.path) !== normalizeCategoryEmojiPath(suggestion.path)
      )
        continue;
      current.delete(match.id);
      if (selected.has(match.id)) {
        await tx.runAsync('UPDATE categories SET iconKey = ? WHERE id = ?', [
          match.emoji,
          match.id,
        ]);
        applied++;
      } else {
        dismissals.add(emojiDismissalKey(match.id, match.type, match.emoji));
      }
    }
    await tx.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
      emojiDismissalsKey,
      JSON.stringify([...dismissals]),
    ]);
  });
  notifyDataChanged();
  return applied;
}

export async function createCategory(input: CreateCategoryInput): Promise<void> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error('Enter a category name (up to 100 characters).');
  if (input.type !== 'EXPENSE' && input.type !== 'INCOME')
    throw new Error('Choose Expense or Income.');
  const parentId = input.parentId ?? null;
  if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0))
    throw new Error('Invalid parent Category.');
  const emoji = normalizeEmoji(input.emoji);
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
    await tx.runAsync(
      'INSERT INTO categories (name, type, parentId, iconKey) VALUES (?, ?, ?, ?)',
      [name, input.type, parentId, emoji],
    );
  });
  notifyDataChanged();
}

/** Changes the name, and the emoji when `inputEmoji` is given. */
export async function updateCategory(
  id: number,
  inputName: string,
  inputEmoji?: string | null,
): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid Category.');
  const name = inputName.trim();
  if (!name || name.length > 100) throw new Error('Enter a category name (up to 100 characters).');
  const emoji = inputEmoji === undefined ? undefined : normalizeEmoji(inputEmoji);
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
    if (emoji === undefined)
      await tx.runAsync('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    else
      await tx.runAsync('UPDATE categories SET name = ?, iconKey = ? WHERE id = ?', [
        name,
        emoji,
        id,
      ]);
  });
  notifyDataChanged();
}
