import { database } from './database';

export type SearchFilters = { query: string; type: 'ALL' | 'EXPENSE' | 'INCOME' | 'TRANSFER'; accountId: number | null; month: string };
export type SearchRow = { id: number; type: 'EXPENSE' | 'INCOME' | 'TRANSFER'; amountMinor: number; date: number; note: string | null; accountName: string; transferAccountName: string | null; categoryName: string | null; currencyCode: string };
export const PAGE_SIZE = 50;

export function searchStatement(filters: SearchFilters, offset = 0) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const query = filters.query.trim();
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    clauses.push("(t.note LIKE ? ESCAPE '\\' COLLATE NOCASE OR c.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR a.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR dest.name LIKE ? ESCAPE '\\' COLLATE NOCASE)");
    params.push(pattern, pattern, pattern, pattern);
  }
  if (filters.type !== 'ALL') { clauses.push('t.type = ?'); params.push(filters.type); }
  if (filters.accountId !== null) {
    clauses.push('(t.accountId = ? OR t.transferAccountId = ?)');
    params.push(filters.accountId, filters.accountId);
  }
  if (filters.month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month)) throw new Error('Invalid month');
    const [year, month] = filters.month.split('-').map(Number);
    const start = Date.UTC(year, month - 1, 1) / 86400000;
    const end = Date.UTC(year, month, 1) / 86400000;
    clauses.push('t.date >= ? AND t.date < ?');
    params.push(start, end);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid offset');
  return {
    sql: `SELECT t.id, t.type, t.amountMinor, t.date, t.note, a.name AS accountName, a.currencyCode, dest.name AS transferAccountName, c.name AS categoryName
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN accounts dest ON dest.id = t.transferAccountId
      LEFT JOIN categories c ON c.id = t.categoryId
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    params: [...params, PAGE_SIZE, offset],
  };
}

export async function searchTransactions(filters: SearchFilters, offset = 0) {
  const { sql, params } = searchStatement(filters, offset);
  return (await database()).getAllAsync<SearchRow>(sql, params);
}
