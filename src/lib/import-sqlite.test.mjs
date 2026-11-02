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

test('all principal kinds remain individual and assignable despite corroborated transfer counterparts', async () => {
  const { listUnassignedLendingTransactions } = await import('./lending.ts');
  const { importRowKeys } = await import('./import-dedupe.ts');
  const { parseMoneyLoverCsv } = await import('./csv.ts');
  for (const [category, amount, kind] of [['Loan', -100, 'LEND'], ['Repayment', -100, 'REPAY'], ['Debt', 100, 'BORROW'], ['Debt Collection', 100, 'RECEIVE_REPAYMENT']]) {
    await reset();
    rows([801, amount < 0 ? '' : 'From Bank', amount, category, 'Cash'],
      [802, amount < 0 ? 'From Cash' : '', -amount, amount < 0 ? 'Deposit' : 'Withdrawal', 'Bank']);
    const originalKeys = importRowKeys(parseMoneyLoverCsv(csv)).sort();
    assert.equal(await importMoneyLoverFile(), 2, category);
    assert.deepEqual(all('transactions').map(t => t.type).sort(), ['EXPENSE', 'INCOME']);
    assert.equal(all('transfer_candidates').length, 0);
    assert.deepEqual(all('moneylover_import_rows').map(r => r.rowKey).sort(), originalKeys);
    assert.deepEqual((await listUnassignedLendingTransactions()).map(t => [t.categoryName, t.kind, t.amountMinor, t.accountName]), [[category, kind, 10000, 'Cash']]);
    assert.equal(await importMoneyLoverFile(), 0);
  }
});

test('borrowing and repayments exclude principal on import and keyed reimport without changing movements', async () => {
  await reset();
  rows([701, 'borrowed principal', 20, 'Debt', 'Cash'], [702, 'paid principal', -5, 'Repayment', 'Cash']);
  assert.equal(await importMoneyLoverFile(), 2);
  const original = all('transactions');
  assert.deepEqual(original.map(row => row.excludeFromReport), [1, 1]);
  sql.exec('UPDATE transactions SET excludeFromReport = 0');
  assert.equal(await importMoneyLoverFile(), 0);
  assert.deepEqual(all('transactions'), original);
});

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

test('lending principal policy excludes new imports without changing CSV identities or money', async () => {
  await reset();
  rows(['1', 'Lent', -100, 'Loan', 'Cash'], ['2', 'Repaid', 40, 'Debt Collection', 'Cash'],
    ['3', 'Lunch', -5, 'Food', 'Cash'], ['4', 'Hidden', 10, 'Salary', 'Cash', true],
    ['5', 'Reverse loan', 3, 'Loan', 'Cash'], ['6', 'Reverse collection', -2, 'Debt Collection', 'Cash']);
  const originalCsv = csv;
  const originalKeys = [
    '["[\\"2025-02-01\\",\\"cash\\",\\"BDT\\",\\"loan\\",-100,\\"Lent\\",false]",0]',
    '["[\\"2025-02-01\\",\\"cash\\",\\"BDT\\",\\"debt collection\\",40,\\"Repaid\\",false]",0]',
    '["[\\"2025-02-01\\",\\"cash\\",\\"BDT\\",\\"food\\",-5,\\"Lunch\\",false]",0]',
    '["[\\"2025-02-01\\",\\"cash\\",\\"BDT\\",\\"salary\\",10,\\"Hidden\\",true]",0]',
    '["[\\"2025-02-01\\",\\"cash\\",\\"BDT\\",\\"loan\\",3,\\"Reverse loan\\",false]",0]',
    '["[\\"2025-02-01\\",\\"cash\\",\\"BDT\\",\\"debt collection\\",-2,\\"Reverse collection\\",false]",0]',
  ];
  assert.equal(await importMoneyLoverFile(async () => true), 6);
  assert.equal(csv, originalCsv);
  assert.deepEqual(all('moneylover_import_rows').map((row) => row.rowKey).sort(), originalKeys.sort());
  assert.deepEqual(all('transactions').map((row) => row.excludeFromReport), [1, 1, 0, 1, 0, 0]);
  assert.deepEqual(all('transactions').map((row) => row.amountMinor), [10000, 4000, 500, 1000, 300, 200]);
  const before = ['accounts', 'categories', 'transactions', 'moneylover_import_rows'].map(all);
  const balance = () => sql.prepare("SELECT SUM(CASE WHEN type = 'EXPENSE' THEN -amountMinor ELSE amountMinor END) AS balance FROM transactions").get().balance;
  assert.equal(balance(), -5400);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.equal(balance(), -5400);
  assert.deepEqual(['accounts', 'categories', 'transactions', 'moneylover_import_rows'].map(all), before);
});

test('reimport corrects only keyed imported principal flags, preserving manual entries and balances', async () => {
  await reset();
  rows(['1', 'Lent', -100, 'Loan', 'Cash'], ['2', 'Repaid', 40, 'Debt Collection', 'Cash'],
    ['3', 'Lunch', -5, 'Food', 'Cash'], ['4', 'Hidden', 10, 'Salary', 'Cash', true]);
  await importMoneyLoverFile();
  // Simulate rows inserted by the old importer with the original false CSV flags.
  sql.exec("UPDATE transactions SET excludeFromReport = 0 WHERE note IN ('Lent', 'Repaid')");
  for (const category of ['Loan', 'Debt Collection']) {
    const type = category === 'Loan' ? 'EXPENSE' : 'INCOME';
    await adapter.runAsync(`INSERT INTO transactions (type, amountMinor, date, accountId, categoryId, note, source)
      SELECT ?, 700, 20000, a.id, c.id, 'Manual', 'MANUAL' FROM accounts a, categories c WHERE a.name = 'Cash' AND c.name = ?`, [type, category]);
  }
  const before = ['accounts', 'categories', 'transactions', 'moneylover_import_rows'].map(all);
  const balances = () => sql.prepare(`SELECT accountId, SUM(CASE WHEN type = 'EXPENSE' THEN -amountMinor ELSE amountMinor END) AS balance
    FROM transactions GROUP BY accountId ORDER BY accountId`).all();
  const oldBalances = balances();
  assert.equal(await importMoneyLoverFile(), 0);
  const expected = before[2];
  for (const row of expected) {
    if (['Lent', 'Repaid'].includes(row.note)) row.excludeFromReport = 1;
  }
  assert.deepEqual(all('transactions'), expected);
  assert.deepEqual(all('accounts'), before[0]);
  assert.deepEqual(all('categories'), before[1]);
  assert.deepEqual(all('moneylover_import_rows'), before[3]);
  assert.deepEqual(balances(), oldBalances);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.deepEqual(all('transactions'), expected);
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

test('reimport does not recreate competing candidates involving a confirmed Transfer', async () => {
  await reset();
  rows(['1', 'Send to Bank', -10, 'Withdrawal', 'Cash'],
    ['2', 'From Cash', 10, 'Deposit', 'Bank'], ['3', '', -10, 'Rent', 'Cash']);
  assert.equal(await importMoneyLoverFile(), 3);
  const candidate = (await listReviewCandidates()).find((pair) => pair.outgoingNote === 'Send to Bank');
  assert.ok(candidate);
  await confirmCandidate(candidate.id);
  const tables = ['transactions', 'moneylover_import_rows', 'transfer_candidates'];
  const before = tables.map(all);
  assert.equal((await listReviewCandidates()).length, 0);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.deepEqual(tables.map(all), before);
  assert.equal((await listReviewCandidates()).length, 0);
});

test('reimport does not pair a confirmed Transfer with a competing Income', async () => {
  await reset();
  rows(['1', 'Send to Bank', -10, 'Withdrawal', 'Cash'],
    ['2', 'From Cash', 10, 'Deposit', 'Bank'], ['3', '', 10, 'Gift', 'Bank']);
  assert.equal(await importMoneyLoverFile(), 3);
  const candidate = (await listReviewCandidates()).find((pair) => pair.incomingNote === 'From Cash');
  assert.ok(candidate);
  await confirmCandidate(candidate.id);
  // A restored backup may omit candidate metadata while retaining all row identities.
  sql.exec('DELETE FROM transfer_candidates');
  const tables = ['transactions', 'moneylover_import_rows', 'transfer_candidates'];
  const before = tables.map(all);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.deepEqual(tables.map(all), before);
  assert.equal((await listReviewCandidates()).length, 0);
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
