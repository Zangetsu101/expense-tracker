import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return next('./database.ts', context);
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:sqlite') return { format: 'module', source: 'export const openDatabaseAsync = async () => { throw Error("not used"); };', shortCircuit: true };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return { ...loaded, format: 'module', source: stripTypeScriptTypes(loaded.source.toString()) };
    }
    return next(url, context);
  },
});
const { searchStatement } = await import('./transaction-search.ts');

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, currencyCode TEXT);
CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT, amountMinor INTEGER, date INTEGER, note TEXT, accountId INTEGER, transferAccountId INTEGER, categoryId INTEGER);
INSERT INTO accounts VALUES (1,'Cash','BDT'),(2,'Bank','BDT');
INSERT INTO categories VALUES (1,'Food');
INSERT INTO transactions VALUES (1,'EXPENSE',1200,20000,'coffee',1,NULL,1),(2,'TRANSFER',500,20001,'move',1,2,NULL),(3,'INCOME',800,20002,'bonus',2,NULL,NULL),(4,'EXPENSE',100,20000,'100%_literal',2,NULL,NULL);`);
const search = (patch = {}, offset = 0) => {
  const { sql, params } = searchStatement({ query: '', type: 'ALL', accountId: null, month: '', ...patch }, offset);
  return db.prepare(sql).all(...params).map((row) => row.id);
};

test('searches notes, category and either account literally', () => {
  assert.deepEqual(search({ query: 'food' }), [1]);
  assert.deepEqual(search({ query: 'bank' }), [3, 2, 4]);
  assert.deepEqual(search({ query: '%_' }), [4]);
  assert.deepEqual(search({ query: "' OR 1=1 --" }), []);
});
test('combines type, account and month filters without dropping transfers', () => {
  assert.deepEqual(search({ type: 'TRANSFER', accountId: 2 }), [2]);
  assert.deepEqual(search({ type: 'EXPENSE', accountId: 1 }), [1]);
  assert.deepEqual(search({ month: '2020-10' }), []);
  assert.throws(() => search({ month: '2024-13' }), /Invalid month/);
});
test('orders deterministically for pagination', () => {
  assert.deepEqual(search(), [3, 2, 4, 1]);
  assert.deepEqual(search({}, 2), [4, 1]);
});
