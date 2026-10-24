import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve as resolvePath, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
let csv = '';
let sql;
const adapter = {
  async execAsync(query) { sql.exec(query); },
  async runAsync(query, args = []) {
    const result = sql.prepare(query).run(...args);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
  async getAllAsync(query, args = []) { return sql.prepare(query).all(...args); },
  async getFirstAsync(query, args = []) { return sql.prepare(query).get(...args) ?? null; },
  async withExclusiveTransactionAsync(callback) {
    sql.exec('SAVEPOINT import_test');
    try {
      const result = await callback(adapter);
      sql.exec('RELEASE import_test');
      return result;
    } catch (error) {
      sql.exec('ROLLBACK TO import_test; RELEASE import_test');
      throw error;
    }
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    if (specifier === 'expo-document-picker') return { url: 'test:picker', shortCircuit: true };
    if (specifier === 'expo-file-system') return { url: 'test:file', shortCircuit: true };
    const path = specifier.startsWith('@/lib/') ? resolvePath(root, specifier.slice(6)) :
      specifier.startsWith('.') && context.parentURL?.endsWith('.ts') ? resolvePath(dirname(fileURLToPath(context.parentURL)), specifier) : null;
    if (path) return nextResolve(pathToFileURL(path.endsWith('.ts') ? path : `${path}.ts`).href, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:sqlite') return { format: 'module', source: 'export const openDatabaseAsync = async () => globalThis.__testSqlite;', shortCircuit: true };
    if (url === 'test:picker') return { format: 'module', source: 'export const getDocumentAsync = async () => ({ canceled: false, assets: [{ uri: "test:csv" }] });', shortCircuit: true };
    if (url === 'test:file') return { format: 'module', source: 'export class File { async text() { return globalThis.__testCsv(); } }', shortCircuit: true };
    if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    return nextLoad(url, context);
  },
});
globalThis.__testSqlite = adapter;
globalThis.__testCsv = () => csv;
const { database, listAccounts, listCategories, setFavoriteAccount } = await import('./database.ts');
const { importMoneyLoverFile } = await import('./import-csv.ts');
const { listReviewCandidates, confirmCandidate, rejectCandidate } = await import('./review-queue.ts');

function rows(...entries) {
  csv = ['Id,Note,Amount,Category,Account,Currency,Date,Event,Exclude Report', ...entries.map(([id, note, amount, category, account, exclude = false]) =>
    `${id},${note},${amount},${category},${account},BDT,01/02/2025,,${exclude}`)].join('\n');
}
function all(table) { return sql.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(); }
async function reset() {
  if (!sql) {
    sql = new DatabaseSync(':memory:');
    await database();
  } else {
    sql.exec('DELETE FROM transfer_candidates; DELETE FROM moneylover_import_rows; DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts;');
    await adapter.runAsync("INSERT INTO accounts (name, currencyCode, isFavorite) VALUES ('Cash', 'BDT', 1)");
    await adapter.runAsync("INSERT INTO categories (name, type) VALUES ('Other', 'EXPENSE')");
    sql.exec('DROP TRIGGER IF EXISTS fail_second');
  }
}

test('favorite Account persists and Category choices put recent use first', async () => {
  await reset();
  const bank = await adapter.runAsync("INSERT INTO accounts (name, currencyCode) VALUES ('Bank', 'BDT')");
  await adapter.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backupSettings', ?)",
    [JSON.stringify({ favoriteAccountId: 1, displayRate: { base: 'USD', quote: 'BDT', rate: 100 } })]);
  await setFavoriteAccount(bank.lastInsertRowId);
  assert.equal(JSON.parse((await adapter.getFirstAsync("SELECT value FROM app_settings WHERE key = 'backupSettings'")).value).favoriteAccountId, bank.lastInsertRowId);
  assert.equal((await listAccounts())[0].name, 'Bank');
  assert.equal((await listAccounts()).filter((account) => account.isFavorite).length, 1);
  await assert.rejects(setFavoriteAccount(-1), /Account not found/);
  assert.equal((await listAccounts())[0].name, 'Bank');
  const food = await adapter.runAsync("INSERT INTO categories (name, type) VALUES ('Food', 'EXPENSE')");
  const fuel = await adapter.runAsync("INSERT INTO categories (name, type) VALUES ('Fuel', 'EXPENSE')");
  await adapter.runAsync("INSERT INTO transactions (type, amountMinor, date, accountId, categoryId) VALUES ('EXPENSE', 100, 100, ?, ?)", [bank.lastInsertRowId, food.lastInsertRowId]);
  await adapter.runAsync("INSERT INTO transactions (type, amountMinor, date, accountId, categoryId) VALUES ('EXPENSE', 100, 101, ?, ?)", [bank.lastInsertRowId, fuel.lastInsertRowId]);
  assert.deepEqual((await listCategories('EXPENSE')).slice(0, 2).map((category) => category.name), ['Fuel', 'Food']);
});

test('Category recency uses the ID from the latest date, not an older maximum ID', async () => {
  await reset();
  const food = await adapter.runAsync("INSERT INTO categories (name, type) VALUES ('Food', 'EXPENSE')");
  const fuel = await adapter.runAsync("INSERT INTO categories (name, type) VALUES ('Fuel', 'EXPENSE')");
  for (const [id, date, categoryId] of [[100, 100, food.lastInsertRowId], [1, 101, food.lastInsertRowId], [50, 101, fuel.lastInsertRowId]]) {
    await adapter.runAsync("INSERT INTO transactions (id, type, amountMinor, date, accountId, categoryId) VALUES (?, 'EXPENSE', 100, ?, 1, ?)", [id, date, categoryId]);
  }
  assert.deepEqual((await listCategories('EXPENSE')).slice(0, 2).map((category) => category.name), ['Fuel', 'Food']);
});

test('decimal amounts import as exact minor units, including binary-inexact values', async () => {
  await reset();
  rows(['1', 'Pay', '624.05', 'Salary', 'Cash'], ['2', 'Snack', '-0.29', 'Food', 'Cash'], ['3', 'Send to Bank', '-1.15', 'Withdrawal', 'Cash'], ['4', 'From Cash', '1.15', 'Deposit', 'Bank']);
  assert.equal(await importMoneyLoverFile(), 3);
  assert.deepEqual(all('transactions').filter((row) => row.source === 'IMPORT').map((row) => [row.type, row.amountMinor]).sort(),
    [['EXPENSE', 29], ['INCOME', 62405], ['TRANSFER', 115]]);
  assert.equal(await importMoneyLoverFile(), 0);
});

test('amount text accepts plain decimals with up to two significant decimals and rejects the rest', async () => {
  await reset();
  rows(['1', 'Half', '.5', 'Salary', 'Cash'], ['2', 'Five', '+5.', 'Gift', 'Cash'], ['3', 'Padded', '-1.500', 'Food', 'Cash'], ['4', 'Tenth', '-0.1', 'Food', 'Cash']);
  assert.equal(await importMoneyLoverFile(), 4);
  assert.deepEqual(all('transactions').filter((row) => row.source === 'IMPORT').map((row) => row.amountMinor).sort((a, b) => a - b), [10, 50, 150, 500]);
  for (const amount of ['1.234', '1e2']) {
    await reset();
    rows(['1', 'Bad', amount, 'Food', 'Cash']);
    await assert.rejects(() => importMoneyLoverFile(), { message: `CSV contains an unsupported amount: ${amount}.` });
    assert.equal(all('transactions').length, 0);
  }
});

test('high-confidence reimport retains one Transfer and both row keys', async () => {
  await reset();
  rows(['1', 'Send to Bank', -10, 'Withdrawal', 'Cash'], ['2', 'From Cash', 10, 'Deposit', 'Bank']);
  assert.equal(await importMoneyLoverFile(), 1);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.equal(all('transactions').filter((row) => row.source === 'IMPORT').length, 1);
  assert.equal(all('moneylover_import_rows').length, 2);
});

test('a newly matched high-confidence leg does not discard an existing keyed single leg', async () => {
  await reset();
  rows(['1', 'Send to Bank', -10, 'Withdrawal', 'Cash']);
  assert.equal(await importMoneyLoverFile(), 1);
  const originalId = all('moneylover_import_rows')[0].transactionId;
  rows(['1', 'Send to Bank', -10, 'Withdrawal', 'Cash'], ['2', 'From Cash', 10, 'Deposit', 'Bank']);
  assert.equal(await importMoneyLoverFile(), 1);
  assert.equal(all('moneylover_import_rows').find((row) => row.transactionId === originalId)?.transactionId, originalId);
  assert.equal(all('transactions').filter((row) => row.source === 'IMPORT').length, 2);
  assert.equal((await listReviewCandidates()).length, 1);
  assert.equal(await importMoneyLoverFile(), 0);
});

test('uncertain confirmation preserves keys and exclusion; reimport does not duplicate', async () => {
  await reset();
  rows(['1', 'Lunch', -10, 'Food', 'Cash'], ['2', 'Repayment', 10, 'Gift', 'Bank', true]);
  assert.equal(await importMoneyLoverFile(), 2);
  const [candidate] = await listReviewCandidates();
  assert.ok(candidate);
  await confirmCandidate(candidate.id);
  const imported = all('transactions').filter((row) => row.source === 'IMPORT');
  assert.equal(imported.length, 1);
  assert.equal(imported[0].type, 'TRANSFER');
  assert.equal(imported[0].excludeFromReport, 1);
  assert.equal(imported[0].note, 'Lunch\nRepayment');
  assert.deepEqual(all('moneylover_import_rows').map((row) => Number(row.transactionId)), [imported[0].id, imported[0].id]);
  assert.equal(await importMoneyLoverFile(), 0);
});

test('reimport recreates missing uncertain candidates for already keyed rows', async () => {
  await reset();
  rows(['1', '', -10, 'Food', 'Cash'], ['2', '', 10, 'Gift', 'Bank']);
  await importMoneyLoverFile();
  sql.exec('DELETE FROM transfer_candidates');
  assert.equal(await importMoneyLoverFile(), 0);
  assert.equal((await listReviewCandidates()).length, 1);
});

test('failed import rolls back accounts, categories, Transactions and keys', async () => {
  await reset();
  rows(['1', '', -10, 'Food', 'New account'], ['2', '', -20, 'Fuel', 'Cash']);
  sql.exec("CREATE TRIGGER fail_second BEFORE INSERT ON moneylover_import_rows WHEN (SELECT COUNT(*) FROM moneylover_import_rows) = 1 BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
  const before = ['accounts', 'categories', 'transactions', 'moneylover_import_rows'].map(all);
  await assert.rejects(importMoneyLoverFile(), /forced failure/);
  assert.deepEqual(['accounts', 'categories', 'transactions', 'moneylover_import_rows'].map(all), before);
});

test('rejected candidate remains two keyed single-sided Transactions on reimport', async () => {
  await reset();
  rows(['1', '', -10, 'Food', 'Cash'], ['2', '', 10, 'Gift', 'Bank']);
  await importMoneyLoverFile();
  const [candidate] = await listReviewCandidates();
  await rejectCandidate(candidate.id);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.equal(all('transactions').filter((row) => row.source === 'IMPORT').length, 2);
  assert.equal(all('transfer_candidates').length, 1);
});
