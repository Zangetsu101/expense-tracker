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
  isInTransactionSync: () => sqlite.isTransaction,
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
const { accountBalances, rangeReport } = await import('./reports.ts');
const monthlyReport = (year, month) =>
  rangeReport(Date.UTC(year, month - 1, 1) / 86400000, Date.UTC(year, month, 1) / 86400000);
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
test('a new lending entry tells listeners its Transaction, and an edit does not', async (t) => {
  const p = await api.createPerson('Signal');
  const { subscribeDataChanges } = await import('./data-changes.ts');
  const saved = [];
  t.after(subscribeDataChanges((change) => saved.push(change)));
  const entry = await api.saveLendingEntry(input(p.id, 'LEND', 100));
  await api.saveLendingEntry(input(p.id, 'LEND', 200, { id: entry.id }));
  assert.deepEqual(saved, [{ id: entry.id, date: 20000, accountIds: [1] }, undefined]);
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

test('create stores the ID that the caller chose and rejects an ID that is in use', async () => {
  assert.deepEqual(await api.createPerson(' Chosen ', 41), { id: 41, name: 'Chosen' });
  assert.equal(sqlite.prepare('SELECT name FROM people WHERE id=41').get().name, 'Chosen');
  await assert.rejects(api.createPerson('Other', 41));
  await assert.rejects(api.createPerson('Zero', 0), /positive integer/);
});

test('rename trims the name and keeps the person and their totals', async () => {
  const p = await api.createPerson('Old name');
  await api.saveLendingEntry(input(p.id, 'BORROW', 100));
  await api.saveLendingEntry(input(p.id, 'LEND', 500, { accountId: 9 }));
  await assert.rejects(api.renamePerson(p.id, '  '), /Enter a person name/);
  await assert.rejects(api.renamePerson(9999, 'Missing'), /Person not found/);
  assert.deepEqual(await api.renamePerson(p.id, ' Kay '), { id: p.id, name: 'Kay' });
  const ledger = await api.loadPersonLedger(p.id);
  assert.equal(ledger.person.name, 'Kay');
  assert.ok(ledger.entries.every((row) => row.personName === 'Kay'));
  const overview = (await api.listPeopleWithLendingTotals()).find((person) => person.id === p.id);
  assert.deepEqual(overview.totals, ledger.totals);
  assert.deepEqual(
    overview.totals.map((total) => [total.direction, total.currencyCode, total.outstandingMinor]),
    [
      ['BORROWED', 'BDT', 100],
      ['LENT', 'USD', 500],
    ],
  );
});
