// Tests each trigger of the legs schema. Every case runs twice: with foreign keys on, and
// with foreign keys off. Expo's connection for exclusive writes can have them off, so the
// triggers must give the same result both times.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { LEGS_SCHEMA_VERSION, legsSchema, openLedger } from './legs-schema.ts';

function fixture(foreignKeys: boolean, schema = legsSchema) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  sql.exec(schema);
  sql.exec(`
    INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'Cash', 'BDT'), (2, 'Wise', 'USD');
    INSERT INTO credit_cards (accountId, parentAccountId) VALUES (2, 1);
    INSERT INTO categories (id, name, type, parentId) VALUES (1, 'Food', 'EXPENSE', NULL),
      (2, 'Groceries', 'EXPENSE', 1);
    INSERT INTO people (id, name) VALUES (1, 'Ali'), (2, 'Bina');
    INSERT INTO tags (id, name) VALUES (1, 'trip');
    -- 1: split expense, 2: reimbursement from Ali, 3: plain expense, 4: lending,
    -- 5: write-off, 6: Transfer between Currencies
    INSERT INTO transactions (id, kind, direction, date, categoryId) VALUES
      (1, 'EXPENSE', NULL, 100, 2), (2, 'REIMBURSEMENT', NULL, 101, NULL),
      (3, 'EXPENSE', NULL, 102, 1), (4, 'LENDING', 'LENT', 103, NULL),
      (5, 'WRITE_OFF', 'LENT', 104, NULL), (6, 'TRANSFER', NULL, 105, NULL);
    INSERT INTO legs (transactionId, accountId, personId, currencyCode, amountMinor) VALUES
      (1, 1, NULL, 'BDT', -1000), (2, 1, NULL, 'BDT', 400), (3, 1, NULL, 'BDT', -50),
      (4, 1, NULL, 'BDT', -300), (4, NULL, 1, 'BDT', 300), (5, NULL, 1, 'BDT', -100),
      (6, 1, NULL, 'BDT', -12000), (6, 2, NULL, 'USD', 100);
    INSERT INTO split_shares (expenseId, personId, amountMinor) VALUES (1, 1, 500), (1, 2, 0);
    INSERT INTO reimbursements (transactionId, expenseId, personId) VALUES (2, 1, 1);
    INSERT INTO line_items (transactionId, name, amountMinor) VALUES (3, 'milk', 50);
    INSERT INTO transaction_tags (transactionId, tagId) VALUES (3, 1);`);
  return sql;
}
const count = (sql: DatabaseSync, query: string) => Object.values(sql.prepare(query).get()!)[0];
const rejects = (sql: DatabaseSync, statement: string, message: RegExp) =>
  assert.throws(() => sql.exec(statement), message);

for (const foreignKeys of [true, false]) {
  const mode = `foreign keys ${foreignKeys ? 'on' : 'off'}`;

  test(`${mode}: an expense with reimbursements cannot be deleted`, () => {
    const sql = fixture(foreignKeys);
    rejects(sql, 'DELETE FROM transactions WHERE id = 1', /linked reimbursements/);
  });

  test(`${mode}: a split share with reimbursements cannot be deleted`, () => {
    const sql = fixture(foreignKeys);
    rejects(
      sql,
      'DELETE FROM split_shares WHERE expenseId = 1 AND personId = 1',
      /linked reimbursements/,
    );
    sql.exec('DELETE FROM split_shares WHERE expenseId = 1 AND personId = 2');
  });

  test(`${mode}: the legs of a split expense are updated, not replaced`, () => {
    const sql = fixture(foreignKeys);
    rejects(sql, 'DELETE FROM legs WHERE transactionId = 1', /Do not replace them/);
    sql.exec('UPDATE legs SET amountMinor = -1200 WHERE transactionId = 1');
  });

  test(`${mode}: a split expense keeps its Currency and kind`, () => {
    const sql = fixture(foreignKeys);
    rejects(
      sql,
      "UPDATE legs SET accountId = 2, currencyCode = 'USD' WHERE transactionId = 1",
      /Cannot change the type or currency/,
    );
    rejects(sql, "UPDATE transactions SET kind = 'INCOME' WHERE id = 1", /Cannot change the type/);
  });

  test(`${mode}: an Account keeps its Currency while legs use it`, () => {
    const sql = fixture(foreignKeys);
    rejects(sql, "UPDATE accounts SET currencyCode = 'EUR' WHERE id = 1", /cannot be changed/);
    sql.exec("INSERT INTO accounts (id, name, currencyCode) VALUES (3, 'Unused', 'BDT')");
    sql.exec("UPDATE accounts SET currencyCode = 'EUR' WHERE id = 3");
  });

  test(`${mode}: deleting a reimbursement, then its expense, removes every child row`, () => {
    const sql = fixture(foreignKeys);
    sql.exec('DELETE FROM transactions WHERE id = 2; DELETE FROM transactions WHERE id = 1');
    assert.equal(count(sql, 'SELECT COUNT(*) FROM reimbursements'), 0);
    assert.equal(count(sql, 'SELECT COUNT(*) FROM split_shares'), 0);
    assert.equal(count(sql, 'SELECT COUNT(*) FROM legs WHERE transactionId IN (1, 2)'), 0);
    sql.exec('DELETE FROM transactions WHERE id = 3');
    assert.equal(count(sql, 'SELECT COUNT(*) FROM line_items'), 0);
    assert.equal(count(sql, 'SELECT COUNT(*) FROM transaction_tags'), 0);
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  });

  test(`${mode}: a leg must fit its Transaction and Account`, () => {
    const sql = fixture(foreignKeys);
    const bad = /does not fit/;
    const leg = (values: string) =>
      `INSERT INTO legs (transactionId, accountId, personId, currencyCode, amountMinor) VALUES (${values})`;
    rejects(sql, leg("3, 1, NULL, 'BDT', 10"), bad);
    rejects(sql, leg("3, 1, NULL, 'USD', -10"), bad);
    rejects(sql, leg("6, NULL, 1, 'BDT', 10"), bad);
    rejects(sql, leg("5, NULL, 1, 'BDT', 10"), bad);
    rejects(sql, leg("5, 1, NULL, 'BDT', -10"), bad);
    rejects(sql, leg("2, 1, NULL, 'BDT', -10"), bad);
    rejects(sql, leg("99, 1, NULL, 'BDT', -10"), bad);
    rejects(sql, leg("4, NULL, 99, 'BDT', 10"), bad);
    rejects(sql, 'UPDATE legs SET amountMinor = 50 WHERE transactionId = 3', bad);
    assert.throws(() => sql.exec(leg("3, 1, 1, 'BDT', -10")), /CHECK constraint/);
    assert.throws(() => sql.exec(leg("6, 1, NULL, 'BDT', 0")), /CHECK constraint/);
  });

  test(`${mode}: a Transaction row must fit its kind`, () => {
    const sql = fixture(foreignKeys);
    const row = (values: string) =>
      `INSERT INTO transactions (kind, direction, date, categoryId, excludeFromReport) VALUES (${values})`;
    for (const values of [
      "'LENDING', NULL, 1, NULL, 0",
      "'EXPENSE', 'LENT', 1, NULL, 0",
      "'TRANSFER', NULL, 1, 1, 0",
      "'TRANSFER', NULL, 1, NULL, 1",
      "'REFUND', NULL, 1, NULL, 0",
    ])
      assert.throws(() => sql.exec(row(values)), /CHECK constraint/, values);
  });

  test(`${mode}: a reimbursement must fit its expense`, () => {
    const sql = fixture(foreignKeys);
    sql.exec(
      "INSERT INTO transactions (id, kind, date) VALUES (7, 'INCOME', 101), (8, 'REIMBURSEMENT', 90)",
    );
    rejects(sql, 'INSERT INTO reimbursements VALUES (7, 1, NULL)', /does not fit/);
    rejects(sql, 'INSERT INTO reimbursements VALUES (8, 1, NULL)', /does not fit/);
    rejects(sql, 'INSERT INTO reimbursements VALUES (8, 4, NULL)', /does not fit/);
    sql.exec("INSERT INTO transactions (id, kind, date) VALUES (9, 'REIMBURSEMENT', 101)");
    rejects(sql, 'INSERT INTO reimbursements VALUES (9, 3, 1)', /does not fit/);
  });

  test(`${mode}: deleting a category clears its children and Transactions`, () => {
    const sql = fixture(foreignKeys);
    sql.exec('DELETE FROM categories WHERE id = 1');
    assert.equal(count(sql, 'SELECT parentId FROM categories WHERE id = 2'), null);
    assert.equal(count(sql, 'SELECT categoryId FROM transactions WHERE id = 3'), null);
  });

  test(`${mode}: deleting a tag removes its links`, () => {
    const sql = fixture(foreignKeys);
    sql.exec('DELETE FROM tags WHERE id = 1');
    assert.equal(count(sql, 'SELECT COUNT(*) FROM transaction_tags'), 0);
  });

  test(`${mode}: used accounts and people cannot be deleted`, () => {
    const sql = fixture(foreignKeys);
    rejects(sql, 'DELETE FROM accounts WHERE id = 1', /still used/);
    rejects(sql, 'DELETE FROM people WHERE id = 1', /still used/);
    rejects(sql, 'DELETE FROM people WHERE id = 2', /still used/);
  });

  test(`${mode}: a full restore can clear every table in order`, () => {
    const sql = fixture(foreignKeys);
    sql.exec(`DELETE FROM reimbursements; DELETE FROM transactions; DELETE FROM credit_cards;
      DELETE FROM accounts; DELETE FROM people; DELETE FROM tags; DELETE FROM categories;`);
    for (const table of [
      'transactions',
      'legs',
      'split_shares',
      'line_items',
      'transaction_tags',
      'accounts',
      'people',
    ])
      assert.equal(count(sql, `SELECT COUNT(*) FROM ${table}`), 0, table);
  });
}

test('a new install gets the legs schema, and a later start keeps the data', async () => {
  const sql = new DatabaseSync(':memory:');
  const db = {
    execAsync: async (query: string) => sql.exec(query),
    getFirstAsync: async (query: string) => ({ ...sql.prepare(query).get() }),
    isInTransactionSync: () => sql.isTransaction,
  } as never;
  const value = (query: string) => Object.values(sql.prepare(query).get()!)[0];
  await openLedger(db);
  assert.equal(value('PRAGMA user_version'), LEGS_SCHEMA_VERSION);
  assert.equal(value('PRAGMA foreign_keys'), 1);
  assert.equal(value("SELECT COUNT(*) FROM sqlite_master WHERE name = 'legs'"), 1);
  sql.exec("INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'Cash', 'BDT')");
  await openLedger(db);
  assert.equal(value('SELECT COUNT(*) FROM accounts'), 1);
});

test('the Investment migration keeps Transactions and their children', async () => {
  const sql = fixture(true, legsSchema.replace(", 'VALUATION'", ''));
  sql.exec('PRAGMA user_version = 1');
  const db = {
    execAsync: async (query: string) => sql.exec(query),
    getAllAsync: async (query: string) => sql.prepare(query).all(),
    getFirstAsync: async (query: string) => sql.prepare(query).get(),
    isInTransactionSync: () => sql.isTransaction,
  } as never;
  const tables = [
    'transactions',
    'legs',
    'split_shares',
    'reimbursements',
    'line_items',
    'transaction_tags',
  ];
  const snapshot = () => tables.map((table) => sql.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot();
  const valuation = "INSERT INTO transactions (kind, date) VALUES ('VALUATION', 100)";

  assert.throws(() => sql.exec(valuation));
  await openLedger(db);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(sql.prepare('PRAGMA user_version').get()!.user_version, LEGS_SCHEMA_VERSION);
  sql.exec(valuation);
});
