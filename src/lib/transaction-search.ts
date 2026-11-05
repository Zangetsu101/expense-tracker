import { database } from './database';
import type { LendingLabel } from './transaction-format';

export type AmountMode = 'ANY' | 'EQUAL' | 'GREATER' | 'LESS' | 'BETWEEN';
export type DatePreset = 'ANY' | 'TODAY' | 'LAST_7_DAYS' | 'THIS_MONTH' | 'CUSTOM';
export type SearchFilters = {
  query: string;
  type: 'ALL' | 'EXPENSE' | 'INCOME' | 'TRANSFER';
  accountId: number | null;
  categoryId?: number | null;
  datePreset?: DatePreset;
  startDate?: string;
  endDate?: string;
  amountMode?: AmountMode;
  amount?: string;
  maximum?: string;
  month?: string; // Legacy callers.
};
export type SearchRow = LendingLabel & { id: number; type: 'EXPENSE' | 'INCOME' | 'TRANSFER'; amountMinor: number; date: number; note: string | null; accountName: string; transferAccountName: string | null; categoryName: string | null; categoryPath: string | null; currencyCode: string };
export const PAGE_SIZE = 50;

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value;
}

export function parseAmountMinor(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

function dateBounds(filters: SearchFilters, now: Date): [number, number] | null {
  const preset = filters.datePreset ?? 'ANY';
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
  if (preset === 'TODAY') return [today, today + 1];
  if (preset === 'LAST_7_DAYS') return [today - 6, today + 1];
  if (preset === 'THIS_MONTH') return [Date.UTC(now.getFullYear(), now.getMonth(), 1) / 86400000, Date.UTC(now.getFullYear(), now.getMonth() + 1, 1) / 86400000];
  if (preset === 'CUSTOM') {
    if (!validDate(filters.startDate ?? '') || !validDate(filters.endDate ?? '') || filters.startDate! > filters.endDate!) throw new Error('Enter valid dates with start on or before end.');
    return [Date.parse(`${filters.startDate}T00:00:00Z`) / 86400000, Date.parse(`${filters.endDate}T00:00:00Z`) / 86400000 + 1];
  }
  if (preset !== 'ANY') throw new Error('Invalid date preset');
  if (!filters.month) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month)) throw new Error('Invalid month');
  const [year, month] = filters.month.split('-').map(Number);
  return [Date.UTC(year, month - 1, 1) / 86400000, Date.UTC(year, month, 1) / 86400000];
}

export function searchStatement(filters: SearchFilters, offset = 0, now = new Date()) {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const query = filters.query.trim();
  if (query) {
    const pattern = `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const text = ["t.note LIKE ? ESCAPE '\\' COLLATE NOCASE", "EXISTS (WITH RECURSIVE ancestors(id, parentId, name) AS (SELECT id, parentId, name FROM categories WHERE id = t.categoryId UNION ALL SELECT p.id, p.parentId, p.name FROM categories p JOIN ancestors child ON child.parentId = p.id) SELECT 1 FROM ancestors WHERE name LIKE ? ESCAPE '\\' COLLATE NOCASE)", "a.name LIKE ? ESCAPE '\\' COLLATE NOCASE", "dest.name LIKE ? ESCAPE '\\' COLLATE NOCASE"];
    const compact = query.toLowerCase().replace(/[\s,]/g, '');
    const currency = /^(?:৳|bdt)/.test(compact) ? 'BDT' : /^(?:\$|usd)/.test(compact) ? 'USD' : null;
    const amountText = compact.replace(/^(?:৳|bdt|\$|usd)/, '');
    const sign = /^[+\-−]/.exec(amountText)?.[0];
    const number = sign ? amountText.slice(1) : amountText;
    const numeric = /^\d+(?:\.\d{0,2})?$/.test(number);
    if (numeric) {
      // Compare the decimal rendering of each row's stored minor units, never a converted value.
      const normalized = number.endsWith('.') ? number.slice(0, -1) : number;
      const expression = "(CAST(t.amountMinor / 100 AS TEXT) || '.' || printf('%02d', t.amountMinor % 100))";
      text.push(`(${expression} LIKE ?${currency ? ' AND a.currencyCode = ?' : ''}${sign ? ' AND t.type = ?' : ''})`);
      params.push(pattern, pattern, pattern, pattern, `%${normalized}%`);
      if (currency) params.push(currency);
      if (sign) params.push(sign === '+' ? 'INCOME' : 'EXPENSE');
    } else params.push(pattern, pattern, pattern, pattern);
    clauses.push(`(${text.join(' OR ')})`);
  }
  if (filters.type !== 'ALL') { clauses.push('t.type = ?'); params.push(filters.type); }
  if (filters.accountId !== null) {
    clauses.push('(t.accountId = ? OR t.transferAccountId = ?)');
    params.push(filters.accountId, filters.accountId);
  }
  if (filters.categoryId != null) {
    clauses.push(`t.categoryId IN (WITH RECURSIVE descendants(id, type) AS (
      SELECT id, type FROM categories WHERE id = ?
      UNION ALL SELECT child.id, child.type FROM categories child JOIN descendants parent ON child.parentId = parent.id WHERE child.type = parent.type
    ) SELECT id FROM descendants)`);
    params.push(filters.categoryId);
  }
  const bounds = dateBounds(filters, now);
  if (bounds) { clauses.push('t.date >= ? AND t.date < ?'); params.push(...bounds); }
  const mode = filters.amountMode ?? 'ANY';
  if (mode !== 'ANY') {
    const first = parseAmountMinor(filters.amount ?? '');
    if (first === null) throw new Error('Enter an amount (up to 2 decimals).');
    if (mode === 'BETWEEN') {
      const second = parseAmountMinor(filters.maximum ?? '');
      if (second === null || first > second) throw new Error('Enter a maximum at least as large as the minimum.');
      clauses.push('t.amountMinor BETWEEN ? AND ?'); params.push(first, second);
    } else {
      const operator = { EQUAL: '=', GREATER: '>', LESS: '<' }[mode];
      if (!operator) throw new Error('Invalid amount mode');
      clauses.push(`t.amountMinor ${operator} ?`); params.push(first);
    }
  }
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid offset');
  return {
    sql: `SELECT t.id, t.type, t.amountMinor, t.date, t.note, a.name AS accountName, a.currencyCode, dest.name AS transferAccountName, c.name AS categoryName, (WITH RECURSIVE path(id, parentId, label) AS (
        SELECT id, parentId, name FROM categories WHERE id = t.categoryId
        UNION ALL SELECT p.id, p.parentId, p.name || ' › ' || path.label FROM categories p JOIN path ON path.parentId = p.id
      ) SELECT label FROM path WHERE parentId IS NULL) AS categoryPath, lending.kind AS lendingKind, person.name AS personName
      FROM transactions t JOIN accounts a ON a.id = t.accountId
      LEFT JOIN accounts dest ON dest.id = t.transferAccountId
      LEFT JOIN categories c ON c.id = t.categoryId
      LEFT JOIN lending_entries lending ON lending.transactionId = t.id
      LEFT JOIN people person ON person.id = lending.personId
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    params: [...params, PAGE_SIZE, offset],
  };
}

export async function searchTransactions(filters: SearchFilters, offset = 0) {
  const { sql, params } = searchStatement(filters, offset);
  return (await database()).getAllAsync<SearchRow>(sql, params);
}
