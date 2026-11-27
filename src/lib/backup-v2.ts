// Backup schema v2 (ADR 0014): a copy of the portable tables of the legs model. Each array
// holds the rows of one table, and the field names are the column names. This module
// checks only the structure of a file. The restore lets the database check the meaning.
import { validDisplayRate, type DisplayRate } from './display-rate.ts';
import type { Direction, TransactionKind } from './ledger.ts';

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

/** The tables of a v2 file, in an order that puts each row after the rows that it needs. */
export const backupV2Tables = {
  accounts: {
    table: 'accounts',
    uniqueKey: ['id'],
    fields: { id: integer, name: text, currencyCode: currency, openingBalanceMinor: integer },
  },
  creditCards: {
    table: 'credit_cards',
    uniqueKey: ['accountId'],
    fields: {
      accountId: integer,
      parentAccountId: orNull(integer),
      statementDay: orNull(integer),
      dueDay: orNull(integer),
    },
  },
  categories: {
    table: 'categories',
    uniqueKey: ['id'],
    fields: {
      id: integer,
      name: text,
      type: oneOf('EXPENSE', 'INCOME'),
      parentId: orNull(integer),
      iconKey: orNull(text),
    },
  },
  people: { table: 'people', uniqueKey: ['id'], fields: { id: integer, name: text } },
  tags: { table: 'tags', uniqueKey: ['id'], fields: { id: integer, name: text } },
  transactions: {
    table: 'transactions',
    uniqueKey: ['id'],
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
    uniqueKey: [],
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
    uniqueKey: ['id'],
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
    uniqueKey: ['transactionId', 'tagId'],
    fields: { transactionId: integer, tagId: integer },
  },
  splitShares: {
    table: 'split_shares',
    uniqueKey: ['expenseId', 'personId'],
    fields: { expenseId: integer, personId: integer, amountMinor: integer },
  },
  reimbursements: {
    table: 'reimbursements',
    uniqueKey: ['transactionId'],
    fields: { transactionId: integer, expenseId: integer, personId: orNull(integer) },
  },
} as const;
const { accounts, transactions, legs, ...otherV2Tables } = backupV2Tables;
export const backupV3Tables = {
  accounts,
  investments: {
    table: 'investments',
    uniqueKey: ['accountId'],
    fields: { accountId: integer },
  },
  creditCards: otherV2Tables.creditCards,
  categories: otherV2Tables.categories,
  people: otherV2Tables.people,
  tags: otherV2Tables.tags,
  transactions: {
    ...transactions,
    fields: {
      ...transactions.fields,
      kind: oneOf(
        'EXPENSE',
        'INCOME',
        'TRANSFER',
        'LENDING',
        'WRITE_OFF',
        'REIMBURSEMENT',
        'VALUATION',
      ),
    },
  },
  legs,
  lineItems: otherV2Tables.lineItems,
  transactionTags: otherV2Tables.transactionTags,
  splitShares: otherV2Tables.splitShares,
  reimbursements: otherV2Tables.reimbursements,
  investmentDividends: {
    table: 'investment_dividends',
    uniqueKey: ['transactionId'],
    fields: { transactionId: integer, investmentAccountId: integer },
  },
} as const;

export type BackupV3 = Omit<BackupV2, 'schemaVersion'> & {
  schemaVersion: 3;
  investments: { accountId: number }[];
  investmentDividends: { transactionId: number; investmentAccountId: number }[];
};

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
    kind: TransactionKind;
    direction: Direction | null;
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
function checkTable(
  name: string,
  rows: unknown,
  table: { uniqueKey: readonly string[]; fields: Record<string, Check> },
) {
  if (!Array.isArray(rows)) throw new Error(`Invalid backup ${name}`);
  const { uniqueKey, fields } = table;
  const checks: Record<string, Check> = fields;
  const keys = new Set<string>();
  rows.forEach((row: unknown, index) => {
    const where = `backup ${name} row ${index + 1}`;
    if (!isRecord(row)) throw new Error(`Invalid ${where}`);
    for (const field of Object.keys(row))
      if (!(field in checks)) throw new Error(`Invalid ${where}: ${field}`);
    for (const [field, check] of Object.entries(checks))
      if (!(field in row) || !check(row[field])) throw new Error(`Invalid ${where}: ${field}`);
    if (!uniqueKey.length) return;
    const id = uniqueKey.map((field) => row[field]).join(':');
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

/** Checks the shape of a backup that stores Legs. */
export function readLegsBackup(data: Record<string, unknown>): BackupV2 | BackupV3 {
  const tables = data.schemaVersion === 3 ? backupV3Tables : backupV2Tables;
  for (const field of Object.keys(data))
    if (field !== 'schemaVersion' && field !== 'settings' && !Object.hasOwn(tables, field))
      throw new Error(`Unknown backup field ${field}`);
  for (const [name, table] of Object.entries(tables)) checkTable(name, data[name], table);
  checkSettings(data.settings);
  return data as unknown as BackupV2 | BackupV3;
}
