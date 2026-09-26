import type * as SQLite from 'expo-sqlite';

export async function findOrCreateTag(tx: Pick<SQLite.SQLiteDatabase, 'getFirstAsync' | 'runAsync'>, name: string): Promise<number> {
  const existing = await tx.getFirstAsync<{ id: number }>('SELECT id FROM tags WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1', [name]);
  return existing?.id ?? (await tx.runAsync('INSERT INTO tags (name) VALUES (?)', [name])).lastInsertRowId;
}
