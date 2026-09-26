import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const sql = new DatabaseSync(':memory:');
let csv;
const adapter = {
  async execAsync(query) { sql.exec(query); },
  async runAsync(query, args = []) {
    const result = sql.prepare(query).run(...args);
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  },
  async getAllAsync(query, args = []) { return sql.prepare(query).all(...args); },
  async getFirstAsync(query, args = []) { return sql.prepare(query).get(...args) ?? null; },
  async withExclusiveTransactionAsync(callback) {
    sql.exec('SAVEPOINT stress');
    try {
      const result = await callback(adapter);
      sql.exec('RELEASE stress');
      return result;
    } catch (error) {
      sql.exec('ROLLBACK TO stress; RELEASE stress');
      throw error;
    }
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    if (specifier === 'expo-document-picker') return { url: 'test:picker', shortCircuit: true };
    if (specifier === 'expo-file-system') return { url: 'test:file', shortCircuit: true };
    const path = specifier.startsWith('@/lib/') ? resolve(root, specifier.slice(6)) :
      specifier.startsWith('.') && context.parentURL?.endsWith('.ts') ? resolve(dirname(fileURLToPath(context.parentURL)), specifier) : null;
    if (path) return nextResolve(pathToFileURL(path.endsWith('.ts') ? path : `${path}.ts`).href, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:sqlite') return { format: 'module', source: 'export const openDatabaseAsync = async () => globalThis.__stressSqlite;', shortCircuit: true };
    if (url === 'test:picker') return { format: 'module', source: 'export const getDocumentAsync = async () => ({ canceled: false, assets: [{ uri: "test:csv" }] });', shortCircuit: true };
    if (url === 'test:file') return { format: 'module', source: 'export class File { async text() { return globalThis.__stressCsv(); } }', shortCircuit: true };
    if (url.endsWith('.ts')) return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')), shortCircuit: true };
    return nextLoad(url, context);
  },
});
globalThis.__stressSqlite = adapter;
globalThis.__stressCsv = () => csv;
const { database } = await import('./database.ts');
const { importMoneyLoverFile } = await import('./import-csv.ts');

function count(table) {
  return Number(sql.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
}

function makeCsv() {
  const lines = ['Id,Note,Amount,Category,Account,Currency,Date,Event,Exclude Report'];
  for (let id = 1; id <= 9994; id++) {
    lines.push(`${id},,-${id}.00,Food,Cash,BDT,01/02/2025,,false`);
  }
  lines.push(
    '9995,Send to Bank,-20000.00,Withdrawal,Cash,BDT,01/02/2025,,false',
    '9996,From Cash,20000.00,Deposit,Bank,BDT,01/02/2025,,false',
    '9997,Send to Bank,-30000.00,Withdrawal,Cash,BDT,01/02/2025,,false',
    '9998,,30000.00,Gift,Bank,BDT,01/02/2025,,false',
    '9999,,30000.00,Gift,Savings,BDT,01/02/2025,,false',
    '10000,,-40000.00,Food,Cash,BDT,01/02/2025,,true',
  );
  return lines.join('\n');
}

test('synthetic 10k-row SQLite import keeps ambiguous legs separate, reimports idempotently and rolls back late failures', async (t) => {
  await database();
  csv = makeCsv();
  const start = performance.now();
  assert.equal(await importMoneyLoverFile(), 9999);
  t.diagnostic(`first synthetic import: ${Math.round(performance.now() - start)} ms (observation only)`);
  assert.equal(count('moneylover_import_rows'), 10000);
  assert.equal(count('transactions'), 9999);
  assert.equal(count('transfer_candidates'), 2);
  const keyed = sql.prepare('SELECT rowKey, transactionId FROM moneylover_import_rows ORDER BY rowKey').all();
  const importedLegs = keyed.filter((row) => Math.abs(JSON.parse(JSON.parse(row.rowKey)[0])[4]) === 30000);
  assert.equal(importedLegs.length, 3);
  assert.equal(new Set(importedLegs.map((row) => row.transactionId)).size, 3);
  assert.equal(Number(sql.prepare("SELECT COUNT(*) AS count FROM transactions WHERE type = 'TRANSFER'").get().count), 1);
  assert.equal(Number(sql.prepare('SELECT COUNT(*) AS count FROM transactions WHERE excludeFromReport = 1').get().count), 1);
  const before = ['accounts', 'categories', 'transactions', 'moneylover_import_rows', 'transfer_candidates'].map(count);
  const repeat = performance.now();
  assert.equal(await importMoneyLoverFile(), 0);
  t.diagnostic(`repeat synthetic import: ${Math.round(performance.now() - repeat)} ms (observation only)`);
  assert.deepEqual(['accounts', 'categories', 'transactions', 'moneylover_import_rows', 'transfer_candidates'].map(count), before);

  csv += '\n10001,,-501.00,Food,New account,BDT,01/02/2025,,false\n10002,,-502.00,New category,Cash,BDT,01/02/2025,,false';
  sql.exec("CREATE TRIGGER fail_late BEFORE INSERT ON moneylover_import_rows WHEN (SELECT COUNT(*) FROM moneylover_import_rows) = 10001 BEGIN SELECT RAISE(ABORT, 'forced late failure'); END");
  await assert.rejects(importMoneyLoverFile(), /forced late failure/);
  assert.deepEqual(['accounts', 'categories', 'transactions', 'moneylover_import_rows', 'transfer_candidates'].map(count), before);
  assert.deepEqual(sql.prepare('SELECT rowKey, transactionId FROM moneylover_import_rows ORDER BY rowKey').all(), keyed);
  assert.equal(Number(sql.prepare("SELECT COUNT(*) AS count FROM accounts WHERE name = 'New account'").get().count), 0);
});
