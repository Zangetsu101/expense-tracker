// Backup schema v2 (ADR 0014): a copy of the portable tables of the legs model. Each array
// holds the rows of one table, and the field names are the column names. This module
// checks only the structure of a file. The restore lets the database check the meaning.
import { validDisplayRate, type DisplayRate } from './display-rate.ts';

type Check = (value: unknown) => boolean;
const integer: Check = (value) => Number.isSafeInteger(value);
const real: Check = (value) => typeof value === 'number' && Number.isFinite(value);
const text: Check = (value) => typeof value === 'string';
const bool: Check = (value) => typeof value === 'boolean';
const currency: Check = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const oneOf =
  (...values: string[]): Check =>
  (value) =>
    values.includes(value as string);
const orNull =
  (check: Check): Check =>
  (value) =>
    value === null || check(value);

/**
 * The tables of a v2 file, in an order that puts each row after the rows that it needs.
 * `table` is the SQLite table, `key` makes a row unique, and `fields` are its columns.
 */
export const backupV2Tables = {
  accounts: {
    table: 'accounts',
    key: ['id'],
    fields: { id: integer, name: text, currencyCode: currency, openingBalanceMinor: integer },
  },
  creditCards: {
    table: 'credit_cards',
    key: ['accountId'],
    fields: {
      accountId: integer,
      parentAccountId: orNull(integer),
      statementDay: orNull(integer),
      dueDay: orNull(integer),
    },
  },
  categories: {
    table: 'categories',
    key: ['id'],
    fields: {
      id: integer,
      name: text,
      type: oneOf('EXPENSE', 'INCOME'),
      parentId: orNull(integer),
      iconKey: orNull(text),
    },
  },
  people: { table: 'people', key: ['id'], fields: { id: integer, name: text } },
  tags: { table: 'tags', key: ['id'], fields: { id: integer, name: text } },
  transactions: {
    table: 'transactions',
    key: ['id'],
    fields: {
      id: integer,
      kind: oneOf('EXPENSE', 'INCOME', 'TRANSFER', 'LENDING', 'WRITE_OFF', 'REIMBURSEMENT'),
      direction: orNull(oneOf('LENT', 'BORROWED')),
      date: integer,
      categoryId: orNull(integer),
      note: orNull(text),
      excludeFromReport: bool,
    },
  },
  legs: {
    table: 'legs',
    key: [],
    fields: {
      transactionId: integer,
      accountId: orNull(integer),
      personId: orNull(integer),
      currencyCode: currency,
      amountMinor: integer,
    },
  },
  lineItems: {
    table: 'line_items',
    key: ['id'],
    fields: {
      id: integer,
      transactionId: integer,
      name: text,
      amountMinor: integer,
      quantity: orNull(real),
    },
  },
  transactionTags: {
    table: 'transaction_tags',
    key: ['transactionId', 'tagId'],
    fields: { transactionId: integer, tagId: integer },
  },
  splitShares: {
    table: 'split_shares',
    key: ['expenseId', 'personId'],
    fields: { expenseId: integer, personId: integer, amountMinor: integer },
  },
  reimbursements: {
    table: 'reimbursements',
    key: ['transactionId'],
    fields: { transactionId: integer, expenseId: integer, personId: orNull(integer) },
  },
} as const;
type TableName = keyof typeof backupV2Tables;
const tableNames = Object.keys(backupV2Tables) as TableName[];

type Kind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'LENDING' | 'WRITE_OFF' | 'REIMBURSEMENT';
export interface BackupV2 {
  schemaVersion: 2;
  accounts: { id: number; name: string; currencyCode: string; openingBalanceMinor: number }[];
  creditCards: {
    accountId: number;
    parentAccountId: number | null;
    statementDay: number | null;
    dueDay: number | null;
  }[];
  categories: {
    id: number;
    name: string;
    type: 'EXPENSE' | 'INCOME';
    parentId: number | null;
    iconKey: string | null;
  }[];
  people: { id: number; name: string }[];
  tags: { id: number; name: string }[];
  transactions: {
    id: number;
    kind: Kind;
    direction: 'LENT' | 'BORROWED' | null;
    date: number;
    categoryId: number | null;
    note: string | null;
    excludeFromReport: boolean;
  }[];
  legs: {
    transactionId: number;
    accountId: number | null;
    personId: number | null;
    currencyCode: string;
    amountMinor: number;
  }[];
  lineItems: {
    id: number;
    transactionId: number;
    name: string;
    amountMinor: number;
    quantity: number | null;
  }[];
  transactionTags: { transactionId: number; tagId: number }[];
  splitShares: { expenseId: number; personId: number; amountMinor: number }[];
  reimbursements: { transactionId: number; expenseId: number; personId: number | null }[];
  settings: { favoriteAccountId: number | null; displayRate: DisplayRate | null };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Throws unless the rows have exactly the fields of the table, with valid values. */
function checkTable(name: TableName, rows: unknown) {
  if (!Array.isArray(rows)) throw new Error(`Invalid backup ${name}`);
  const { key, fields } = backupV2Tables[name];
  const checks: Record<string, Check> = fields;
  const keys = new Set<string>();
  rows.forEach((row: unknown, index) => {
    const where = `backup ${name} row ${index + 1}`;
    if (!isRecord(row)) throw new Error(`Invalid ${where}`);
    for (const field of Object.keys(row))
      if (!(field in checks)) throw new Error(`Invalid ${where}: ${field}`);
    for (const [field, check] of Object.entries(checks))
      if (!(field in row) || !check(row[field])) throw new Error(`Invalid ${where}: ${field}`);
    if (!key.length) return;
    const id = key.map((field) => row[field]).join(':');
    if (keys.has(id)) throw new Error(`Duplicate ${where}`);
    keys.add(id);
  });
}

function checkSettings(settings: unknown) {
  const valid =
    isRecord(settings) &&
    Object.keys(settings).length === 2 &&
    orNull(integer)(settings.favoriteAccountId) &&
    (settings.displayRate === null ||
      (isRecord(settings.displayRate) &&
        Object.keys(settings.displayRate).length === 3 &&
        validDisplayRate(settings.displayRate as DisplayRate)));
  if (!valid) throw new Error('Invalid backup settings');
}

/** Returns the data as a v2 backup. Throws if its structure is not valid. */
export function readBackupV2(data: Record<string, unknown>): BackupV2 {
  for (const field of Object.keys(data))
    if (field !== 'schemaVersion' && field !== 'settings' && !(field in backupV2Tables))
      throw new Error(`Unknown backup field ${field}`);
  for (const name of tableNames) checkTable(name, data[name]);
  checkSettings(data.settings);
  return data as unknown as BackupV2;
}
