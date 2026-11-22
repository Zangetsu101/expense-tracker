import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveSource } from '../test/node-source-resolve.ts';

const sql = new DatabaseSync(':memory:');
let importCsv = '';
const adapter = {
  async execAsync(query) {
    sql.exec(query);
  },
  async runAsync(query, args = []) {
    const result = sql.prepare(query).run(...args);
    return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
  },
  async getAllAsync(query, args = []) {
    return sql.prepare(query).all(...args);
  },
  async getFirstAsync(query, args = []) {
    return sql.prepare(query).get(...args) ?? null;
  },
  async withExclusiveTransactionAsync(callback) {
    sql.exec('SAVEPOINT backup_test');
    try {
      const result = await callback(adapter);
      sql.exec('RELEASE backup_test');
      return result;
    } catch (error) {
      sql.exec('ROLLBACK TO backup_test; RELEASE backup_test');
      throw error;
    }
  },
};
registerHooks({
  resolve: resolveSource({
    'expo-sqlite': 'test:sqlite',
    'expo-document-picker': 'test:picker',
    'expo-file-system/legacy': 'test:legacy',
    'expo-file-system': 'test:file',
    'expo-sharing': 'test:sharing',
  }),
  load(url, context, nextLoad) {
    if (url === 'test:sqlite')
      return {
        format: 'module',
        source: 'export const openDatabaseAsync = async () => globalThis.__backupDb;',
        shortCircuit: true,
      };
    if (url === 'test:sharing')
      return {
        format: 'module',
        source: 'export const isAvailableAsync = async () => true, shareAsync = async () => {};',
        shortCircuit: true,
      };
    if (url === 'test:picker')
      return {
        format: 'module',
        source:
          'export const getDocumentAsync = async () => ({ canceled: false, assets: [{ uri: "test:csv" }] });',
        shortCircuit: true,
      };
    if (url === 'test:legacy')
      return {
        format: 'module',
        source:
          'export const StorageAccessFramework = {}; export const writeAsStringAsync = async () => {};',
        shortCircuit: true,
      };
    if (url === 'test:file')
      return {
        format: 'module',
        source: 'export class File { async text() { return globalThis.__backupCsv(); } }',
        shortCircuit: true,
      };
    if (url.endsWith('.ts'))
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8')),
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
globalThis.__backupDb = adapter;
globalThis.__backupCsv = () => importCsv;
const { database } = await import('./database.ts');
const { backupStore } = await import('./backup-adapter.ts');
const { importMoneyLoverFile } = await import('./import-csv.ts');
const { decodeBackup, encodeBackup, restoreBackup } = await import('./backup.ts');
// Simulate a database written before received amounts existed.
sql.exec(`PRAGMA foreign_keys = OFF; CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, currencyCode TEXT NOT NULL, openingBalanceMinor INTEGER NOT NULL DEFAULT 0, isFavorite INTEGER NOT NULL DEFAULT 0);
CREATE TABLE transactions (id INTEGER PRIMARY KEY, type TEXT NOT NULL, amountMinor INTEGER NOT NULL CHECK(amountMinor > 0), date INTEGER NOT NULL, accountId INTEGER NOT NULL REFERENCES accounts(id), transferAccountId INTEGER REFERENCES accounts(id), categoryId INTEGER REFERENCES categories(id) ON DELETE SET NULL, note TEXT, excludeFromReport INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'MANUAL');
INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'Cash', 'BDT'), (2, 'Bank', 'BDT');
INSERT INTO transactions (id, type, amountMinor, date, accountId, transferAccountId) VALUES (1, 'TRANSFER', 500, 20000, 1, 2);`);
await database();
test('opening an existing database adds received amounts without changing existing Transfer balances', async () => {
  assert.equal(
    sql.prepare('SELECT receivedAmountMinor FROM transactions WHERE id = 1').get()
      .receivedAmountMinor,
    null,
  );
  const { accountBalances } = await import('./reports.ts');
  assert.deepEqual((await accountBalances(20000)).map((a) => [a.id, a.balanceMinor]).sort(), [
    [1, -500],
    [2, 500],
  ]);
  sql.exec('DELETE FROM transactions; DELETE FROM accounts');
});

const tables = [
  'accounts',
  'categories',
  'transactions',
  'line_items',
  'tags',
  'transaction_tags',
  'transfer_candidates',
  'moneylover_import_rows',
  'app_settings',
  'people',
  'lending_entries',
];
function state() {
  return tables.map((table) => sql.prepare(`SELECT * FROM ${table} ORDER BY 1`).all());
}
function insert(query, ...values) {
  sql.prepare(query).run(...values);
}
function replaceDocument(data) {
  return restoreBackup(
    backupStore,
    {
      pickJsonDocument: async () => ({ uri: 'content://synthetic-backup', name: 'saved.json' }),
      readText: async () => encodeBackup(data),
    },
    async () => true,
  );
}

test('SQLite snapshot and replace retain imported Accounts, Categories, Transfers, queue, keys, tags and Line Items', async () => {
  insert(
    "INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor, isFavorite) VALUES (10, 'Wallet', 'BDT', 12000, 1)",
  );
  insert("INSERT INTO accounts (id, name, currencyCode) VALUES (11, 'Bank', 'BDT')");
  insert("INSERT INTO categories (id, name, type, iconKey) VALUES (20, 'Food', 'EXPENSE', 'food')");
  insert(
    "INSERT INTO categories (id, name, type, parentId, needsReview) VALUES (21, 'Lunch', 'EXPENSE', 20, 1)",
  );
  insert(
    "INSERT INTO transactions (id, type, amountMinor, date, accountId, transferAccountId, source) VALUES (30, 'TRANSFER', 500, 20120, 10, 11, 'IMPORT')",
  );
  insert(
    "INSERT INTO transactions (id, type, amountMinor, date, accountId, categoryId, note, excludeFromReport, source) VALUES (31, 'EXPENSE', 275, 20121, 10, 21, 'synthetic lunch', 1, 'IMPORT')",
  );
  insert(
    "INSERT INTO transactions (id, type, amountMinor, date, accountId, source) VALUES (32, 'INCOME', 275, 20121, 11, 'IMPORT')",
  );
  insert(
    "INSERT INTO line_items (id, transactionId, name, amountMinor, quantity) VALUES (40, 31, 'Rice', 275, 2.5)",
  );
  insert("INSERT INTO tags (id, name) VALUES (50, 'sample')");
  insert('INSERT INTO transaction_tags (transactionId, tagId) VALUES (31, 50)');
  insert(
    "INSERT INTO transfer_candidates (id, outgoingTxnId, incomingTxnId, confidenceNote, resolved) VALUES (60, 31, 32, 'weak match', 0)",
  );
  for (const [key, id] of [
    ['outgoing-leg', 30],
    ['incoming-leg', 30],
    ['expense-leg', 31],
    ['income-leg', 32],
  ]) {
    insert('INSERT INTO moneylover_import_rows (rowKey, transactionId) VALUES (?, ?)', key, id);
  }
  insert(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('backupSettings', ?)",
    JSON.stringify({
      favoriteAccountId: 10,
      displayRate: { base: 'BDT', quote: 'USD', rate: 0.01 },
    }),
  );
  const original = await backupStore.snapshot();
  const json = encodeBackup(original);
  assert.equal(original.categories.find((row) => row.id === 21).parentId, 20);
  assert.deepEqual(
    original.moneyLoverImportRows
      .filter((row) => row.transactionId === 30)
      .map((row) => row.rowKey),
    ['incoming-leg', 'outgoing-leg'],
  );
  assert.equal(original.transactions.find((row) => row.id === 31).excludeFromReport, true);
  const before = state();
  insert(
    "INSERT INTO transactions (id, type, amountMinor, date, accountId) VALUES (99, 'EXPENSE', 1, 20122, 10)",
  );
  await replaceDocument(decodeBackup(json));
  assert.deepEqual(state(), before);
  assert.deepEqual(await backupStore.snapshot(), original);
});

test('MoneyLover importer output survives SQLite backup and restore', async () => {
  importCsv = [
    'Id,Note,Amount,Category,Account,Currency,Date,Event,Exclude Report',
    '100,Send to Bank,-10.00,Withdrawal,Wallet,BDT,01/02/2025,,false',
    '101,From Wallet,10.00,Deposit,Bank,BDT,01/02/2025,,false',
    '102,,-12.00,Food,Wallet,BDT,01/02/2025,,true',
    '103,,12.00,Gift,Bank,BDT,01/02/2025,,false',
  ].join('\n');
  assert.equal(await importMoneyLoverFile(), 3);
  const original = await backupStore.snapshot();
  assert.equal(original.moneyLoverImportRows.length, 8);
  assert.ok(
    original.transactions.some((row) => row.type === 'TRANSFER' && row.amountMinor === 1000),
  );
  const before = state();
  insert(
    "INSERT INTO transactions (type, amountMinor, date, accountId) VALUES ('EXPENSE', 1, 20122, 10)",
  );
  await replaceDocument(decodeBackup(encodeBackup(original)));
  assert.deepEqual(state(), before);
  assert.equal(await importMoneyLoverFile(), 0);
});

test('lending links, write-offs and people survive restore and keyed reimport without duplicate movements', async () => {
  const lending = await import('./lending.ts');
  importCsv = [
    'Id,Note,Amount,Category,Account,Currency,Date,Event,Exclude Report',
    '201,synthetic lending,-10.00,Loan,Wallet,BDT,01/03/2025,,false',
  ].join('\n');
  assert.equal(await importMoneyLoverFile(), 1);
  const person = await lending.createPerson('Synthetic person');
  const [historical] = await lending.listUnassignedLendingTransactions();
  await lending.assignLendingTransaction(historical.transactionId, person.id);
  await lending.saveLendingEntry({
    personId: person.id,
    kind: 'WRITE_OFF_LENT',
    amountMinor: 100,
    date: 20150,
    currencyCode: 'BDT',
    note: 'synthetic waiver',
  });
  const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');
  await saveTransactionEdit(
    await loadEditableTransaction(historical.transactionId),
    'edited principal note',
    false,
    '',
  );
  const original = await backupStore.snapshot();
  assert.equal(
    original.lendingEntries.find((entry) => entry.transactionId === historical.transactionId).note,
    'edited principal note',
  );
  assert.deepEqual(
    original.people.map((row) => ({ ...row })),
    [person],
  );
  assert.equal(original.lendingEntries.length, 2);
  await replaceDocument(decodeBackup(encodeBackup(original)));
  assert.deepEqual(await backupStore.snapshot(), original);
  assert.equal(await importMoneyLoverFile(), 0);
  assert.equal((await lending.listLendingEntries(person.id)).length, 2);
  assert.equal((await lending.listLendingTotals(person.id))[0].outstandingMinor, 900);
});

test('assigned principal on either legacy transfer leg cannot be merged or lose backup history', async () => {
  const lending = await import('./lending.ts');
  const { confirmCandidate, listReviewCandidates } = await import('./review-queue.ts');
  const person = await lending.createPerson('Legacy queue person');
  for (const [kind, category, signedAmount, otherCategory] of [
    ['LEND', 'Loan', -42, 'Salary'],
    ['BORROW', 'Debt', 43, 'Food'],
  ]) {
    const note = `synthetic legacy ${kind}`;
    importCsv = [
      'Id,Note,Amount,Category,Account,Currency,Date,Event,Exclude Report',
      `901,${note},${signedAmount},${category},Wallet,BDT,01/04/2025,,false`,
      `902,synthetic counterpart,${-signedAmount},${otherCategory},Bank,BDT,01/04/2025,,false`,
    ].join('\n');
    assert.equal(await importMoneyLoverFile(), 2);
    const principal = (await lending.listUnassignedLendingTransactions()).find(
      (row) => row.note === note,
    );
    const counterpart = sql
      .prepare('SELECT id FROM transactions WHERE amountMinor = ? AND note = ?')
      .get(Math.abs(signedAmount) * 100, 'synthetic counterpart');
    const legs =
      kind === 'LEND'
        ? [principal.transactionId, counterpart.id]
        : [counterpart.id, principal.transactionId];
    const candidate = await adapter.runAsync(
      'INSERT INTO transfer_candidates (outgoingTxnId, incomingTxnId, confidenceNote) VALUES (?, ?, ?)',
      [...legs, 'Synthetic legacy candidate'],
    );
    await lending.assignLendingTransaction(principal.transactionId, person.id);
    assert.ok(!(await listReviewCandidates()).some((row) => row.id === candidate.lastInsertRowId));
    await assert.rejects(confirmCandidate(candidate.lastInsertRowId));
    // A stale/unresolved candidate must also be rejected at the mutation boundary.
    sql
      .prepare('UPDATE transfer_candidates SET resolved = 0 WHERE id = ?')
      .run(candidate.lastInsertRowId);
    const before = await backupStore.snapshot();
    await assert.rejects(confirmCandidate(candidate.lastInsertRowId), /principal|lending/i);
    assert.deepEqual(await backupStore.snapshot(), before);
    await replaceDocument(decodeBackup(encodeBackup(before)));
    assert.ok(
      (await lending.listLendingEntries(person.id)).some(
        (row) => row.transactionId === principal.transactionId && row.kind === kind,
      ),
    );
  }
});

test('native v1 fixture restores into SQLite without import keys', async () => {
  const native = readFileSync(
    new URL('../../scripts/fixtures/native-shaped-backup-v1.json', import.meta.url),
    'utf8',
  );
  const data = decodeBackup(native);
  assert.equal(data.moneyLoverImportRows, undefined);
  await replaceDocument(data);
  const restored = await backupStore.snapshot();
  for (const key of [
    'accounts',
    'categories',
    'transactions',
    'lineItems',
    'tags',
    'transactionTags',
    'transferCandidates',
    'settings',
  ]) {
    const expected = Array.isArray(data[key])
      ? [...data[key]].sort((a, b) =>
          key === 'transactionTags'
            ? a.transactionId - b.transactionId || a.tagId - b.tagId
            : a.id - b.id,
        )
      : data[key];
    assert.deepEqual(restored[key], expected, key);
  }
  assert.deepEqual(restored.moneyLoverImportRows, []);
  assert.deepEqual(restored.people, []);
  assert.deepEqual(restored.lendingEntries, []);
});

test('failed SQLite replacement rolls back every table including settings and import keys', async () => {
  const before = state();
  const data = await backupStore.snapshot();
  data.accounts.push({
    id: 999,
    name: 'New',
    currencyCode: 'BDT',
    openingBalanceMinor: 0,
    isFavorite: false,
  });
  data.moneyLoverImportRows = [{ rowKey: 'new-key', transactionId: data.transactions[0].id }];
  sql.exec(
    "CREATE TRIGGER fail_backup BEFORE INSERT ON moneylover_import_rows BEGIN SELECT RAISE(ABORT, 'forced backup failure'); END",
  );
  try {
    await assert.rejects(backupStore.replace(data), /forced backup failure/);
    assert.deepEqual(state(), before);
  } finally {
    sql.exec('DROP TRIGGER fail_backup');
  }
});

test('snapshot reads every table in one transaction and restore preserves device-local scheduling', async () => {
  const schedule = JSON.stringify({
    status: 'connected',
    interval: 'weekly',
    account: { email: 'private@example.com', photoUrl: null },
  });
  await adapter.runAsync(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('driveBackups', ?)",
    [schedule],
  );
  const getAll = adapter.getAllAsync;
  const getFirst = adapter.getFirstAsync;
  adapter.getAllAsync = async (...args) => {
    assert.equal(sql.isTransaction, true, 'snapshot read must share the database transaction');
    return getAll(...args);
  };
  adapter.getFirstAsync = async (...args) => {
    assert.equal(sql.isTransaction, true, 'settings read must share the database transaction');
    return getFirst(...args);
  };
  let snapshot;
  try {
    snapshot = await backupStore.snapshot();
  } finally {
    adapter.getAllAsync = getAll;
    adapter.getFirstAsync = getFirst;
  }
  assert.ok(!encodeBackup(snapshot).includes('private@example.com'));
  await backupStore.replace(snapshot);
  assert.equal(
    (await adapter.getFirstAsync("SELECT value FROM app_settings WHERE key = 'driveBackups'"))
      .value,
    schedule,
  );
});

test('credit-card settings and parent links survive backup; native backups clear them', async () => {
  const original = await backupStore.snapshot();
  const parent = original.accounts[0];
  const cardId = Math.max(...original.accounts.map((a) => a.id)) + 1;
  original.accounts.push({
    id: cardId,
    name: 'Backup card',
    currencyCode: parent.currencyCode,
    openingBalanceMinor: -1200,
    isFavorite: false,
  });
  original.creditCards = [
    { accountId: cardId, parentAccountId: parent.id, statementDay: 31, dueDay: 5 },
  ];
  await replaceDocument(decodeBackup(encodeBackup(original)));
  const restored = await backupStore.snapshot();
  assert.deepEqual(
    restored.creditCards.map((card) => ({ ...card })),
    original.creditCards,
  );
  assert.equal(restored.accounts.find((a) => a.id === cardId).openingBalanceMinor, -1200);
  for (const creditCards of [
    [{ ...original.creditCards[0], parentAccountId: cardId }],
    [{ ...original.creditCards[0], statementDay: 32 }],
    [{ ...original.creditCards[0], accountId: 99999 }],
    [original.creditCards[0], original.creditCards[0]],
  ])
    assert.throws(() => decodeBackup(JSON.stringify({ ...original, creditCards })), /credit.card/);
  delete original.creditCards;
  await replaceDocument(decodeBackup(encodeBackup(original)));
  assert.deepEqual((await backupStore.snapshot()).creditCards, []);
});

test('received amounts and a cross-Currency card parent survive JSON backup and replacement; old backups still restore', async () => {
  const data = decodeBackup(
    readFileSync(new URL('../../scripts/fixtures/backup-v1.json', import.meta.url), 'utf8'),
  );
  data.accounts.push({
    id: 2,
    name: 'USD card',
    currencyCode: 'USD',
    openingBalanceMinor: -20000,
    isFavorite: false,
  });
  data.transactions = [
    {
      ...data.transactions[0],
      type: 'TRANSFER',
      amountMinor: 1220000,
      receivedAmountMinor: 10000,
      transferAccountId: 2,
      categoryId: null,
    },
  ];
  data.creditCards = [{ accountId: 2, parentAccountId: 1, statementDay: null, dueDay: null }];
  await backupStore.replace(decodeBackup(encodeBackup(data)));
  const saved = await backupStore.snapshot();
  assert.equal(saved.transactions[0].receivedAmountMinor, 10000);
  assert.equal(saved.creditCards[0].parentAccountId, 1);
  const { accountBalances } = await import('./reports.ts');
  assert.equal((await accountBalances(99999)).find((a) => a.id === 2).balanceMinor, -10000);
  delete data.transactions[0].receivedAmountMinor;
  await backupStore.replace(decodeBackup(encodeBackup(data)));
  assert.equal((await accountBalances(99999)).find((a) => a.id === 2).balanceMinor, 1200000);
  assert.equal((await backupStore.snapshot()).transactions[0].receivedAmountMinor, undefined);
});

test('first-rate lookup finds the newest Transfer in either direction and gives Display Rate priority', async () => {
  const { loadFirstTransferRate } = await import('./transfer-rate-store.ts');
  const { saveDisplayRate } = await import('./display-rate-store.ts');
  await saveDisplayRate(null);
  sql.exec(`DELETE FROM credit_cards; DELETE FROM lending_entries; DELETE FROM transactions; DELETE FROM accounts;
    INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'BDT bank', 'BDT'), (2, 'USD bank', 'USD');`);
  assert.deepEqual(await loadFirstTransferRate('BDT', 'USD'), {
    base: 'USD',
    quote: 'BDT',
    rate: undefined,
  });
  sql.exec(`INSERT INTO transactions (id, type, amountMinor, receivedAmountMinor, date, accountId, transferAccountId) VALUES
    (1, 'TRANSFER', 1200000, 10000, 20000, 1, 2),
    (2, 'TRANSFER', 10000, 1214000, 20001, 2, 1),
    (3, 'TRANSFER', 1220000, 10000, 20001, 1, 2),
    (4, 'TRANSFER', 999, NULL, 20002, 1, 2);`);
  assert.deepEqual(await loadFirstTransferRate('USD', 'BDT'), {
    base: 'USD',
    quote: 'BDT',
    rate: 122,
    date: 20001,
  });
  await saveDisplayRate({ base: 'BDT', quote: 'USD', rate: 0.0082 });
  assert.deepEqual(await loadFirstTransferRate('USD', 'BDT'), {
    base: 'BDT',
    quote: 'USD',
    rate: 0.0082,
  });
});
