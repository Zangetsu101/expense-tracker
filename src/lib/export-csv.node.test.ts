import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-file-system/legacy') return { url: 'test:files', shortCircuit: true };
    if (specifier === 'react-native') return { url: 'test:platform', shortCircuit: true };
    if (specifier === 'expo-sharing') return { url: 'test:sharing', shortCircuit: true };
    if (specifier === '@/lib/database') return { url: 'test:database', shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:sharing')
      return {
        format: 'module',
        source:
          'export const isAvailableAsync = async () => true; export const shareAsync = async (...args) => globalThis.__share(...args);',
        shortCircuit: true,
      };
    if (url === 'test:files')
      return {
        format: 'module',
        source: `export const cacheDirectory = 'file:///cache/'; export const StorageAccessFramework = {
      requestDirectoryPermissionsAsync: async () => globalThis.__permission(),
      createFileAsync: async (...args) => globalThis.__create(...args)
    };
    export const writeAsStringAsync = async (...args) => globalThis.__write(...args);`,
        shortCircuit: true,
      };
    if (url === 'test:platform')
      return {
        format: 'module',
        source: 'export const Platform = globalThis.__platform;',
        shortCircuit: true,
      };
    if (url === 'test:database')
      return {
        format: 'module',
        source: 'export const database = async () => ({ getAllAsync: globalThis.__rows });',
        shortCircuit: true,
      };
    if (url.endsWith('/export-csv.ts'))
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')),
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
globalThis.__platform = { OS: 'android' };
const { formatTransactionsCsv, exportTransactionsCsv } = await import(
  pathToFileURL(resolve(root, 'export-csv.ts')).href
);

const base = {
  amountMinor: 1234,
  date: 20000,
  accountName: 'Cash, "Main"',
  currencyCode: 'BDT',
  destinationName: null,
  categoryName: 'Food',
  note: 'one\r\ntwo',
  excludeFromReport: 1,
};

test('exports signed Expenses and Income and single-row Transfers with destination, currency and quoted text', () => {
  const csv = formatTransactionsCsv([
    { ...base, type: 'EXPENSE' },
    { ...base, type: 'INCOME', amountMinor: 50, excludeFromReport: 0 },
    { ...base, type: 'TRANSFER', destinationName: 'Savings', categoryName: null },
  ]);
  assert.equal(
    csv,
    'Type,Amount,Currency,Account,Transfer Destination,Category,Date,Note,Exclude Report\r\n' +
      '"EXPENSE","-12.34","BDT","Cash, ""Main""","","Food","2024-10-04","one\r\ntwo","true"\r\n' +
      '"INCOME","+0.50","BDT","Cash, ""Main""","","Food","2024-10-04","one\r\ntwo","false"\r\n' +
      '"TRANSFER","12.34","BDT","Cash, ""Main""","Savings","","2024-10-04","one\r\ntwo","true"\r\n',
  );
});

test('formats safe integer minor units exactly and neutralizes spreadsheet formulas in user text', () => {
  const csv = formatTransactionsCsv([
    {
      ...base,
      type: 'EXPENSE',
      amountMinor: Number.MAX_SAFE_INTEGER,
      accountName: '=1+1',
      categoryName: '@SUM(1)',
      destinationName: '+cmd',
      note: '  -2+2',
    },
  ]);
  assert.match(csv, /"-90071992547409\.91"/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"'@SUM\(1\)"/);
  assert.match(csv, /"'  -2\+2"/);
});

test('iOS shares a cached CSV via the system share sheet', async () => {
  globalThis.__platform.OS = 'ios';
  globalThis.__rows = async () => [];
  globalThis.__write = async (uri, text) => {
    assert.match(uri, /^file:\/\/\/cache\/expense-transactions-/);
    assert.match(text, /^Type,Amount/);
  };
  globalThis.__share = async (uri, options) => {
    assert.match(uri, /\.csv$/);
    assert.equal(options.mimeType, 'text/csv');
  };
  try {
    assert.match(await exportTransactionsCsv(), /\.csv$/);
  } finally {
    globalThis.__platform.OS = 'android';
  }
});

test('directory cancel does not write; write failures surface', async () => {
  globalThis.__rows = async (query) => {
    assert.match(query, /ORDER BY t.date, t.id/);
    return [];
  };
  globalThis.__permission = async () => ({ granted: false });
  globalThis.__create = () => {
    throw Error('unexpected create');
  };
  assert.equal(await exportTransactionsCsv(), null);
  globalThis.__permission = async () => ({ granted: true, directoryUri: 'folder' });
  globalThis.__create = async (...args) => {
    assert.deepEqual(args, ['folder', 'expense-transactions.csv', 'text/csv']);
    return 'document';
  };
  globalThis.__write = async (uri, text) => {
    assert.equal(uri, 'document');
    assert.match(text, /^Type,Amount/);
    throw Error('disk full');
  };
  await assert.rejects(exportTransactionsCsv(), /disk full/);
});
