import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { addTransaction } from '../test/ledger-rows.ts';
import { legsSchema } from './legs-schema.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return next('./database.ts', context);
    if (specifier === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync = async () => { throw Error("not used"); };',
        shortCircuit: true,
      };
    if (url.endsWith('.ts')) {
      const loaded = next(url, { ...context, format: 'module' });
      return {
        ...loaded,
        format: 'module',
        source: stripTypeScriptTypes(loaded.source.toString()),
      };
    }
    return next(url, context);
  },
});
const { searchStatement, validDate, parseAmountMinor } = await import('./transaction-search.ts');
const { transactionTitle } = await import('./transaction-format.ts');

const db = new DatabaseSync(':memory:');
db.exec(legsSchema);
db.exec(`INSERT INTO accounts (id, name, currencyCode) VALUES (1,'Cash','BDT'),(2,'Bank','BDT'),(3,'Dollar','USD');
INSERT INTO categories (id, name, type, parentId) VALUES (1,'Food','EXPENSE',NULL),(2,'Lunch','EXPENSE',1),(3,'Snacks','EXPENSE',2),(4,'Travel','EXPENSE',NULL),(5,'Food','INCOME',NULL),(6,'Refund','INCOME',5);`);
const add = (id, type, amountMinor, date, note, accountId, transferAccountId, categoryId) =>
  addTransaction(db, {
    id,
    type,
    amountMinor,
    date,
    note,
    accountId,
    transferAccountId,
    categoryId,
  });
add(1, 'EXPENSE', 1200, 20000, 'coffee', 1, null, 1);
add(2, 'TRANSFER', 500, 20001, 'move', 1, 2, null);
add(3, 'INCOME', 800, 20002, 'bonus', 2, null, null);
add(4, 'EXPENSE', 100, 20000, '100%_literal', 2, null, null);
add(5, 'EXPENSE', 1200, 20003, 'hosting', 3, null, null);
const search = (patch = {}, offset = 0) => {
  const { sql, params } = searchStatement(
    { query: '', type: 'ALL', accountId: null, month: '', ...patch },
    offset,
  );
  return db
    .prepare(sql)
    .all(...params)
    .map((row) => row.id);
};

test('Search returns lending labels ahead of notes and categories while keeping ordinary rows', () => {
  db.exec("INSERT INTO people VALUES (1, 'Sam')");
  addTransaction(db, {
    id: 50,
    type: 'EXPENSE',
    amountMinor: 700,
    date: 20000,
    accountId: 1,
    lending: { personId: 1, kind: 'LEND' },
  });
  try {
    const { sql, params } = searchStatement({ query: '', type: 'ALL', accountId: null });
    const rows = db.prepare(sql).all(...params);
    assert.equal(rows.length, 6);
    assert.equal(transactionTitle(rows.find((row) => row.id === 50)), 'Lent to Sam');
    assert.equal(transactionTitle(rows.find((row) => row.id === 1)), 'Food');
    assert.equal(transactionTitle(rows.find((row) => row.id === 3)), 'Income');
  } finally {
    db.exec('DELETE FROM transactions WHERE id = 50; DELETE FROM people');
  }
});

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
  assert.deepEqual(search(), [5, 3, 2, 4, 1]);
  assert.deepEqual(search({}, 2), [2, 4, 1]);
});

test('category, date presets and inclusive custom range combine with independent account', () => {
  assert.deepEqual(search({ categoryId: 1 }), [1]);
  assert.deepEqual(search({ categoryId: 1, accountId: 2 }), []);
  const now = new Date(20002 * 86400000);
  const run = (patch) => {
    const { sql, params } = searchStatement(
      { query: '', type: 'ALL', accountId: null, ...patch },
      0,
      now,
    );
    return db
      .prepare(sql)
      .all(...params)
      .map((row) => row.id);
  };
  assert.deepEqual(run({ datePreset: 'TODAY' }), [3]);
  assert.deepEqual(run({ datePreset: 'LAST_7_DAYS' }), [3, 2, 4, 1]);
  assert.deepEqual(run({ datePreset: 'THIS_MONTH' }), [5, 3, 2, 4, 1]);
  const startDate = new Date(20000 * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(run({ datePreset: 'CUSTOM', startDate, endDate: startDate }), [4, 1]);
  assert.throws(
    () => run({ datePreset: 'CUSTOM', startDate: '2024-02-30', endDate: startDate }),
    /valid dates/,
  );
  assert.throws(
    () => run({ datePreset: 'CUSTOM', startDate: '2025-01-02', endDate: '2025-01-01' }),
    /valid dates/,
  );
  assert.equal(validDate('2024-02-29'), true);
  assert.equal(validDate('2025-02-29'), false);
});

test('amount modes compare stored minor units across currencies without conversion', () => {
  assert.deepEqual(search({ amountMode: 'EQUAL', amount: '12.00' }), [5, 1]);
  assert.deepEqual(search({ amountMode: 'GREATER', amount: '8' }), [5, 1]);
  assert.deepEqual(search({ amountMode: 'LESS', amount: '5' }), [4]);
  assert.deepEqual(search({ amountMode: 'BETWEEN', amount: '5', maximum: '8' }), [3, 2]);
  assert.deepEqual(search({ amountMode: 'ANY', amount: 'not valid' }), [5, 3, 2, 4, 1]);
  assert.equal(parseAmountMinor('1,234.50'), 123450);
  assert.equal(parseAmountMinor('1.234'), null);
  assert.throws(() => search({ amountMode: 'BETWEEN', amount: '8', maximum: '5' }), /maximum/);
});

test('nested category filters include only same-type descendants; text finds ancestor names and paths', () => {
  add(6, 'EXPENSE', 200, 20004, '', 1, null, 2);
  add(7, 'EXPENSE', 300, 20005, '', 1, null, 3);
  add(8, 'EXPENSE', 400, 20006, '', 1, null, 4);
  add(9, 'INCOME', 500, 20007, '', 1, null, 6);
  assert.deepEqual(search({ categoryId: 1 }), [7, 6, 1]);
  assert.deepEqual(search({ categoryId: 2 }), [7, 6]);
  assert.deepEqual(search({ categoryId: 5 }), [9]);
  assert.deepEqual(search({ categoryId: 1, type: 'TRANSFER' }), []);
  assert.deepEqual(search({ query: 'food' }), [9, 7, 6, 1]);
  assert.deepEqual(search({ query: 'lunch' }), [7, 6]);
  assert.deepEqual(search({ query: 'travel' }), [8]);
  const { sql, params } = searchStatement({
    query: '',
    type: 'ALL',
    accountId: null,
    categoryId: 2,
  });
  assert.deepEqual(
    db
      .prepare(sql)
      .all(...params)
      .map(({ categoryPath }) => categoryPath),
    ['Food › Lunch › Snacks', 'Food › Lunch'],
  );
  db.exec('DELETE FROM transactions WHERE id >= 6');
});

test('amount search respects currency prefix and literal text search', () => {
  assert.deepEqual(search({ query: '$12.00' }), [5]);
  assert.deepEqual(search({ query: '৳12' }), [1]);
  assert.deepEqual(search({ query: '12.00' }), [5, 1]);
});

test('signed numeric amounts match only their transaction direction', () => {
  assert.deepEqual(search({ query: '-12' }), [5, 1]);
  assert.deepEqual(search({ query: '−12.00' }), [5, 1]);
  assert.deepEqual(search({ query: '+8' }), [3]);
  assert.deepEqual(search({ query: '-8' }), []);
  assert.deepEqual(search({ query: '+5' }), []); // Transfers have no signed direction.
  assert.deepEqual(search({ query: '৳-12' }), [1]);
  assert.deepEqual(search({ query: '$-12' }), [5]);
  assert.deepEqual(search({ query: 'USD+8' }), []);
  assert.deepEqual(search({ query: 'BDT+8' }), [3]);
  assert.deepEqual(search({ query: '5' }), [2]);
});
