import type * as SQLite from 'expo-sqlite';

export async function findOrCreateTag(
  tx: Pick<SQLite.SQLiteDatabase, 'getFirstAsync' | 'runAsync'>,
  name: string,
): Promise<number> {
  const existing = await tx.getFirstAsync<{ id: number }>(
    'SELECT id FROM tags WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1',
    [name],
  );
  return (
    existing?.id ??
    (await tx.runAsync('INSERT INTO tags (name) VALUES (?)', [name])).lastInsertRowId
  );
}

export const MAX_QUICK_ADD_TAGS = 20;

export function parseQuickAddTags(text: string): string[] {
  const parts = text.split(',');
  if (parts.length > MAX_QUICK_ADD_TAGS) throw new Error(`Use at most ${MAX_QUICK_ADD_TAGS} tags.`);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.trim();
    if (!name) throw new Error('Remove empty tags.');
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      names.push(name);
      seen.add(key);
    }
  }
  return names;
}

export async function addTransactionTags(
  tx: Pick<SQLite.SQLiteDatabase, 'getFirstAsync' | 'runAsync'>,
  transactionId: number,
  names: string[],
) {
  for (const name of names) {
    const tagId = await findOrCreateTag(tx, name);
    await tx.runAsync('INSERT INTO transaction_tags (transactionId, tagId) VALUES (?, ?)', [
      transactionId,
      tagId,
    ]);
  }
}
