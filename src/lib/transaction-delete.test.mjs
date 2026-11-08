import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sqlite = new DatabaseSync(':memory:');
const adapter = {
  execAsync: async (sql) => sqlite.exec(sql),
  runAsync: async (sql, p = []) => {
    const r = sqlite.prepare(sql).run(...p);
    return { ...r, lastInsertRowId: Number(r.lastInsertRowid) };
  },
  getAllAsync: async (sql, p = []) =>
    sqlite
      .prepare(sql)
      .all(...p)
      .map((r) => ({ ...r })),
  getFirstAsync: async (sql, p = []) => sqlite.prepare(sql).get(...p) ?? null,
  async withExclusiveTransactionAsync(fn) {
    sqlite.exec('BEGIN');
    try {
      const r = await fn(adapter);
      sqlite.exec('COMMIT');
      return r;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },
};
globalThis.__transactionDeleteDb = adapter;
registerHooks({
  resolve(s, c, n) {
    if (s === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    if (s === '@/lib/database') return n('./database.ts', { ...c, parentURL: import.meta.url });
    if (['./database', './lending', './quick-add-tags', './tag-store'].includes(s))
      return n(`${s}.ts`, c);
    return n(s, c);
  },
  load(u, c, n) {
    if (u === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync=async()=>globalThis.__transactionDeleteDb;',
        shortCircuit: true,
      };
    if (u.endsWith('.ts')) {
      const l = n(u, { ...c, format: 'module' });
      return { ...l, format: 'module', source: stripTypeScriptTypes(l.source.toString()) };
    }
    return n(u, c);
  },
});
const { deleteTransaction } = await import('./transaction-delete.ts');
const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');
const lending = await import('./lending.ts');
const { accountBalances } = await import('./reports.ts');
const { database } = await import('./database.ts');
await database();
const count = (sql, ...params) => sqlite.prepare(sql).get(...params).n;

test('deleting an Expense removes its tags, Line Items, import identity and transfer candidates', async () => {
  sqlite.exec(`INSERT INTO transactions (id, type, amountMinor, date, accountId) VALUES
    (1, 'EXPENSE', 1000, 20000, 1), (2, 'INCOME', 1000, 20000, 1);
    INSERT INTO tags (id, name) VALUES (1, 'Shared');
    INSERT INTO transaction_tags VALUES (1, 1), (2, 1);
    INSERT INTO line_items (transactionId, name, amountMinor) VALUES (1, 'Coffee', 300);
    INSERT INTO moneylover_import_rows VALUES ('row-1', 1);
    INSERT INTO transfer_candidates (outgoingTxnId, incomingTxnId, confidenceNote) VALUES (1, 2, 'same day');`);
  const before = (await accountBalances())[0].balanceMinor;
  assert.deepEqual(await deleteTransaction(1), { status: 'deleted' });
  assert.equal(count('SELECT count(*) AS n FROM transactions WHERE id = 1'), 0);
  assert.equal(count('SELECT count(*) AS n FROM line_items'), 0);
  assert.equal(count('SELECT count(*) AS n FROM moneylover_import_rows'), 0);
  assert.equal(count('SELECT count(*) AS n FROM transfer_candidates'), 0);
  assert.equal(count('SELECT count(*) AS n FROM transaction_tags WHERE transactionId = 2'), 1);
  assert.equal(count('SELECT count(*) AS n FROM tags'), 1);
  assert.equal((await accountBalances())[0].balanceMinor, before + 1000);
  await assert.rejects(deleteTransaction(1), /already removed/);
  await assert.rejects(deleteTransaction(0), /Invalid transaction ID/);
  sqlite.exec('DELETE FROM transactions; DELETE FROM tags');
});

test('deleting a Transfer restores both Account balances', async () => {
  sqlite.exec(`INSERT INTO accounts (id, name, currencyCode) VALUES (2, 'Bank', 'BDT');
    INSERT INTO transactions (id, type, amountMinor, date, accountId, transferAccountId)
    VALUES (3, 'TRANSFER', 700, 20000, 1, 2);`);
  await deleteTransaction(3);
  assert.deepEqual(
    (await accountBalances()).map((a) => a.balanceMinor),
    [0, 0],
  );
});

test('deleting a lending Transaction removes its entry and asks before creating overpaid credit', async () => {
  const person = await lending.createPerson('Sam');
  const entry = (kind, amountMinor) => ({
    personId: person.id,
    kind,
    amountMinor,
    date: 20000,
    accountId: 1,
  });
  const lent = await lending.saveLendingEntry(entry('LEND', 1000));
  await lending.saveLendingEntry(entry('RECEIVE_REPAYMENT', 400));
  const transactionId = (await lending.listLendingEntries(person.id)).find(
    (e) => e.id === lent.id,
  ).transactionId;
  assert.equal((await deleteTransaction(transactionId)).status, 'confirmation_required');
  assert.equal(count('SELECT count(*) AS n FROM transactions WHERE id = ?', transactionId), 1);
  assert.deepEqual(await deleteTransaction(transactionId, { confirmOverpayment: true }), {
    status: 'deleted',
  });
  assert.equal(count('SELECT count(*) AS n FROM transactions WHERE id = ?', transactionId), 0);
  assert.equal(count('SELECT count(*) AS n FROM lending_entries WHERE id = ?', lent.id), 0);
});

test('editing changes the amount of an Expense but not of a lending Transaction', async () => {
  sqlite.exec(`INSERT INTO transactions (id, type, amountMinor, date, accountId, note)
    VALUES (10, 'EXPENSE', 1000, 20000, 1, 'typo');`);
  const original = await loadEditableTransaction(10);
  await assert.rejects(saveTransactionEdit(original, 'typo', false, '', [], 0), /positive amount/);
  await saveTransactionEdit(original, 'fixed', false, '', [], 1250);
  const edited = await loadEditableTransaction(10);
  assert.equal(edited.amountMinor, 1250);
  assert.equal(edited.note, 'fixed');
  await assert.rejects(
    saveTransactionEdit(original, 'stale', false, '', [], 900),
    /changed or removed/,
  );

  const person = await lending.createPerson('Kim');
  await lending.saveLendingEntry({
    personId: person.id,
    kind: 'LEND',
    amountMinor: 500,
    date: 20000,
    accountId: 1,
  });
  const transactionId = (await lending.listLendingEntries(person.id))[0].transactionId;
  const linked = await loadEditableTransaction(transactionId);
  await assert.rejects(
    saveTransactionEdit(linked, '', true, '', [], 600),
    /lending entry from Lending/,
  );
  // A link made after the editor loaded must also block the amount change.
  await assert.rejects(
    saveTransactionEdit({ ...linked, lendingKind: null }, '', true, '', [], 600),
    /changed or removed/,
  );
  assert.equal(
    sqlite.prepare('SELECT amountMinor FROM transactions WHERE id = ?').get(transactionId)
      .amountMinor,
    500,
  );
});
