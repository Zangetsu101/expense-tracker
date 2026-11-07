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
globalThis.__lendingDb = adapter;
registerHooks({
  resolve(s, c, n) {
    if (s === 'expo-sqlite') return { url: 'test:sqlite', shortCircuit: true };
    if (s === './database' || s === '@/lib/database')
      return { url: new URL('./database.ts', import.meta.url).href, shortCircuit: true };
    if (s === './quick-add-tags' || s === './tag-store') return n(`${s}.ts`, c);
    return n(s, c);
  },
  load(u, c, n) {
    if (u === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync=async()=>globalThis.__lendingDb;',
        shortCircuit: true,
      };
    if (u.endsWith('.ts')) {
      const l = n(u, { ...c, format: 'module' });
      return { ...l, format: 'module', source: stripTypeScriptTypes(l.source.toString()) };
    }
    return n(u, c);
  },
});
const api = await import('./lending.ts');
const { database } = await import('./database.ts');
const { accountBalances, monthlyReport } = await import('./reports.ts');
await database();
const input = (personId, kind, amountMinor, extra = {}) => ({
  personId,
  kind,
  amountMinor,
  date: 20000,
  note: null,
  accountId: 1,
  ...extra,
});
test('saved people and every money direction preserve balances but never enter reports', async () => {
  const p = await api.createPerson(' Alice ');
  assert.equal((await api.listPeople())[0].name, 'Alice');
  for (const [kind, amount] of [
    ['LEND', 1000],
    ['BORROW', 800],
    ['RECEIVE_REPAYMENT', 300],
    ['REPAY', 200],
  ])
    assert.equal((await api.saveLendingEntry(input(p.id, kind, amount))).status, 'saved');
  const totals = await api.listLendingTotals(p.id);
  assert.equal(totals.find((t) => t.direction === 'LENT').outstandingMinor, 700);
  assert.equal(totals.find((t) => t.direction === 'BORROWED').outstandingMinor, 600);
  assert.equal((await accountBalances())[0].balanceMinor, -100);
  assert.deepEqual(await monthlyReport(2024, 10), { spending: [], summaries: [] });
  assert.equal((await api.listLendingEntries(p.id)).length, 4);
});
test('historical assignment is explicit, direction safe, and preserves movement and import identity on edit', async () => {
  sqlite.exec(`INSERT INTO categories(id,name,type) VALUES (50,'Loan','EXPENSE'),(51,'Debt Collection','INCOME'),(52,'Debt','INCOME'),(53,'Repayment','EXPENSE');
 INSERT INTO transactions(id,type,amountMinor,date,accountId,categoryId,source) VALUES (50,'EXPENSE',500,20000,1,50,'IMPORT'),(51,'INCOME',100,20001,1,51,'IMPORT'),(52,'INCOME',900,20000,1,52,'IMPORT'),(53,'INCOME',900,20000,1,50,'IMPORT'),(54,'EXPENSE',200,20002,1,53,'IMPORT');
 INSERT INTO moneylover_import_rows VALUES ('original-csv-key',50);`);
  const p = await api.createPerson('Historical');
  assert.deepEqual(
    (await api.listUnassignedLendingTransactions()).map((e) => [e.transactionId, e.kind]),
    [
      [54, 'REPAY'],
      [51, 'RECEIVE_REPAYMENT'],
      [52, 'BORROW'],
      [50, 'LEND'],
    ],
  );
  const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');
  await saveTransactionEdit(await loadEditableTransaction(52), 'unassigned borrowing', false, '');
  assert.equal((await loadEditableTransaction(52)).excludeFromReport, 1);
  const before = await accountBalances();
  const linked = await api.assignLendingTransaction(50, p.id);
  assert.equal(linked.status, 'saved');
  await api.assignLendingTransaction(51, p.id);
  assert.deepEqual(await accountBalances(), before);
  assert.equal((await api.listLendingTotals(p.id))[0].outstandingMinor, 400);
  await api.saveLendingEntry(input(p.id, 'LEND', 600, { id: linked.id }));
  assert.equal(
    (await api.listLendingEntries(p.id)).find((e) => e.id === linked.id).transactionId,
    50,
  );
  assert.equal(
    sqlite
      .prepare('SELECT transactionId FROM moneylover_import_rows WHERE rowKey=?')
      .get('original-csv-key').transactionId,
    50,
  );
  await api.assignLendingTransaction(52, p.id);
  await api.assignLendingTransaction(54, p.id);
  assert.equal(
    (await api.listLendingTotals(p.id)).find((t) => t.direction === 'BORROWED').outstandingMinor,
    700,
  );
  await assert.rejects(api.assignLendingTransaction(53, p.id));
});
test('aggregate overpayment warnings cover edits, person/currency moves, and principal deletion without partial writes', async (t) => {
  const p = await api.createPerson('Warnings');
  const principal = await api.saveLendingEntry(input(p.id, 'LEND', 1000));
  const repayment = await api.saveLendingEntry(input(p.id, 'RECEIVE_REPAYMENT', 800));
  const { subscribeDataChanges } = await import('./data-changes.ts');
  let changes = 0;
  t.after(
    subscribeDataChanges(() => {
      changes++;
    }),
  );
  const edit = input(p.id, 'LEND', 500, { id: principal.id });
  assert.equal((await api.saveLendingEntry(edit)).status, 'confirmation_required');
  assert.equal((await api.listLendingTotals(p.id))[0].outstandingMinor, 200);
  assert.equal(
    (await api.deleteLendingEntry(principal.id, { confirmDelete: true })).status,
    'confirmation_required',
  );
  await assert.rejects(api.deleteLendingEntry(repayment.id));
  assert.equal(changes, 0, 'confirmation prompts and rejected writes must not refresh Home');
  await api.saveLendingEntry({ ...edit, confirmOverpayment: true });
  assert.equal(changes, 1, 'confirmed commit refreshes Home once');
  assert.equal((await api.listLendingTotals(p.id))[0].overpaidMinor, 300);
  assert.equal((await api.listLendingTotals(p.id))[0].outstandingMinor, 0);
  const q = await api.createPerson('Other');
  assert.equal(
    (await api.saveLendingEntry(input(q.id, 'LEND', 500, { id: principal.id }))).status,
    'confirmation_required',
  );
  sqlite.exec("INSERT INTO accounts(id,name,currencyCode) VALUES (9,'USD','USD')");
  assert.equal(
    (await api.saveLendingEntry(input(p.id, 'LEND', 500, { id: principal.id, accountId: 9 })))
      .status,
    'confirmation_required',
  );
  assert.equal(
    (await api.deleteLendingEntry(principal.id, { confirmDelete: true, confirmOverpayment: true }))
      .status,
    'deleted',
  );
  assert.equal((await api.listLendingTotals(p.id))[0].overpaidMinor, 800);
  await api.deleteLendingEntry(repayment.id, { confirmDelete: true });
  assert.deepEqual(await api.listLendingTotals(p.id), []);
});
test('writeoffs retain currency, dates and notes, affect no account, and never net people, directions or currencies', async () => {
  const p = await api.createPerson('Writeoffs');
  await api.saveLendingEntry(input(p.id, 'LEND', 1000));
  await api.saveLendingEntry(input(p.id, 'BORROW', 300));
  await api.saveLendingEntry(input(p.id, 'LEND', 700, { accountId: 9 }));
  const before = await accountBalances();
  const reportsBefore = await monthlyReport(2024, 10);
  const w = await api.saveLendingEntry(
    input(p.id, 'WRITE_OFF_LENT', 200, {
      accountId: undefined,
      currencyCode: 'BDT',
      note: ' waived ',
      date: 19999,
    }),
  );
  await api.saveLendingEntry(
    input(p.id, 'WRITE_OFF_BORROWED', 100, { accountId: undefined, currencyCode: 'BDT' }),
  );
  assert.deepEqual(await accountBalances(), before);
  assert.deepEqual(await monthlyReport(2024, 10), reportsBefore);
  const rows = await api.listLendingTotals(p.id);
  assert.deepEqual(
    rows.map((t) => [t.currencyCode, t.direction, t.outstandingMinor]),
    [
      ['BDT', 'BORROWED', 200],
      ['BDT', 'LENT', 800],
      ['USD', 'LENT', 700],
    ],
  );
  const e = (await api.listLendingEntries(p.id)).find((e) => e.id === w.id);
  assert.equal(e.transactionId, null);
  assert.equal(e.note, 'waived');
  assert.equal(e.date, 19999);
  assert.equal(
    (
      await api.saveLendingEntry(
        input(p.id, 'WRITE_OFF_LENT', 1100, { currencyCode: 'BDT', id: w.id }),
      )
    ).status,
    'confirmation_required',
  );
  await api.saveLendingEntry(input(p.id, 'WRITE_OFF_LENT', 300, { currencyCode: 'BDT', id: w.id }));
  await api.deleteLendingEntry(w.id, { confirmDelete: true });
  assert.equal(
    (await api.listLendingTotals(p.id)).find(
      (t) => t.currencyCode === 'BDT' && t.direction === 'LENT',
    ).outstandingMinor,
    1000,
  );
  await assert.rejects(
    api.saveLendingEntry(input(p.id, 'WRITE_OFF_LENT', 1, { currencyCode: undefined })),
  );
});

test('quick lending tags follow the linked Transaction and confirmation writes nothing early', async () => {
  const p = await api.createPerson('Tagged person');
  const saved = await api.saveLendingEntry(input(p.id, 'LEND', 100, { tagText: ' Trip, trip ' }));
  assert.equal(saved.status, 'saved');
  const entry = (await api.listLendingEntries(p.id))[0];
  const tags = () =>
    sqlite
      .prepare(
        'SELECT name FROM tags JOIN transaction_tags tt ON tt.tagId=tags.id WHERE tt.transactionId=?',
      )
      .all(entry.transactionId)
      .map((t) => t.name);
  assert.deepEqual(tags(), ['Trip']);
  await api.saveLendingEntry(input(p.id, 'LEND', 110, { id: entry.id }));
  assert.deepEqual(tags(), ['Trip']);
  const pending = await api.saveLendingEntry(
    input(p.id, 'RECEIVE_REPAYMENT', 200, { tagText: 'Not yet' }),
  );
  assert.equal(pending.status, 'confirmation_required');
  assert.equal((await api.listLendingEntries(p.id)).length, 1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM tags WHERE name='Not yet'").get().n, 0);
  await api.saveLendingEntry(
    input(p.id, 'RECEIVE_REPAYMENT', 200, { tagText: 'Confirmed', confirmOverpayment: true }),
  );
  assert.equal((await api.listLendingEntries(p.id)).length, 2);
  assert.equal((await api.listLendingTotals(p.id))[0].overpaidMinor, 90);
  sqlite.exec(
    "CREATE TRIGGER fail_lending_tags BEFORE INSERT ON transaction_tags BEGIN SELECT RAISE(ABORT, 'tag failure'); END;",
  );
  await assert.rejects(
    () => api.saveLendingEntry(input(p.id, 'BORROW', 50, { tagText: 'Rollback lending' })),
    /tag failure/,
  );
  sqlite.exec('DROP TRIGGER fail_lending_tags');
  assert.equal((await api.listLendingEntries(p.id)).length, 2);
  assert.equal(
    sqlite.prepare("SELECT count(*) AS n FROM tags WHERE name='Rollback lending'").get().n,
    0,
  );
});
