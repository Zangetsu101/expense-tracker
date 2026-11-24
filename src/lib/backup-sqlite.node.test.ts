import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveSource } from '../test/node-source-resolve.ts';

const sql = new DatabaseSync(':memory:');
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
  isInTransactionSync: () => sql.isTransaction,
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
        source: 'export const getDocumentAsync = async () => ({ canceled: true });',
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
        source: 'export class File {}',
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
const { database } = await import('./database.ts');
const { backupStore } = await import('./backup-adapter.ts');
const { decodeBackup, encodeBackup, restoreBackup } = await import('./backup.ts');
const { addTransaction } = await import('../test/ledger-rows.ts');
await database();

// Leg ids and Write-off ids are not stable across a restore, so the state leaves them out.
const tables = {
  accounts: 'SELECT * FROM accounts ORDER BY id',
  categories: 'SELECT * FROM categories ORDER BY id',
  transactions: "SELECT * FROM transactions WHERE kind <> 'WRITE_OFF' ORDER BY id",
  legs: `SELECT l.transactionId, l.accountId, l.personId, l.currencyCode, l.amountMinor FROM legs l
    JOIN transactions t ON t.id = l.transactionId WHERE t.kind <> 'WRITE_OFF'
    ORDER BY l.transactionId, l.accountId, l.personId`,
  lineItems: 'SELECT * FROM line_items ORDER BY id',
  tags: 'SELECT * FROM tags ORDER BY id',
  transactionTags: 'SELECT * FROM transaction_tags ORDER BY transactionId, tagId',
  settings: 'SELECT * FROM app_settings ORDER BY key',
  people: 'SELECT * FROM people ORDER BY id',
  splitShares: 'SELECT * FROM split_shares ORDER BY expenseId, personId',
  reimbursements: 'SELECT * FROM reimbursements ORDER BY transactionId',
  creditCards: 'SELECT * FROM credit_cards ORDER BY accountId',
};
function state() {
  return Object.fromEntries(
    Object.entries(tables).map(([name, query]) => [
      name,
      sql
        .prepare(query)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
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

test('SQLite snapshot and replace retain Accounts, Categories, Transfers, tags, Line Items and settings', async () => {
  insert(
    "INSERT INTO accounts (id, name, currencyCode, openingBalanceMinor) VALUES (10, 'Wallet', 'BDT', 12000)",
  );
  insert("INSERT INTO accounts (id, name, currencyCode) VALUES (11, 'Bank', 'BDT')");
  insert("INSERT INTO categories (id, name, type, iconKey) VALUES (20, 'Food', 'EXPENSE', 'food')");
  insert("INSERT INTO categories (id, name, type, parentId) VALUES (21, 'Lunch', 'EXPENSE', 20)");
  addTransaction(sql, {
    id: 30,
    type: 'TRANSFER',
    amountMinor: 500,
    date: 20120,
    accountId: 10,
    transferAccountId: 11,
  });
  addTransaction(sql, {
    id: 31,
    type: 'EXPENSE',
    amountMinor: 275,
    date: 20121,
    accountId: 10,
    categoryId: 21,
    note: 'synthetic lunch',
    excludeFromReport: 1,
  });
  addTransaction(sql, { id: 32, type: 'INCOME', amountMinor: 275, date: 20121, accountId: 11 });
  insert(
    "INSERT INTO line_items (id, transactionId, name, amountMinor, quantity) VALUES (40, 31, 'Rice', 275, 2.5)",
  );
  insert("INSERT INTO tags (id, name) VALUES (50, 'sample')");
  insert('INSERT INTO transaction_tags (transactionId, tagId) VALUES (31, 50)');
  insert("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('favoriteAccountId', '10')");
  insert(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('displayRate', ?)",
    JSON.stringify({ base: 'BDT', quote: 'USD', rate: 0.01 }),
  );
  const original = await backupStore.snapshot();
  const json = encodeBackup(original);
  assert.equal(original.categories.find((row) => row.id === 21).parentId, 20);
  assert.equal(original.transactions.find((row) => row.id === 31).excludeFromReport, true);
  assert.deepEqual(
    { ...original.transactions.find((row) => row.id === 30) },
    {
      id: 30,
      type: 'TRANSFER',
      amountMinor: 500,
      dateEpochDay: 20120,
      accountId: 10,
      transferAccountId: 11,
      categoryId: null,
      note: null,
      excludeFromReport: false,
      source: 'MANUAL',
    },
    'a Transfer in one Currency has no received amount',
  );
  assert.deepEqual(original.settings, {
    favoriteAccountId: 10,
    displayRate: { base: 'BDT', quote: 'USD', rate: 0.01 },
  });
  assert.equal(original.accounts.find((row) => row.id === 10).isFavorite, true);
  assert.deepEqual(original.transferCandidates, []);
  const before = state();
  addTransaction(sql, { id: 99, type: 'EXPENSE', amountMinor: 1, date: 20122, accountId: 10 });
  await replaceDocument(decodeBackup(json));
  assert.deepEqual(state(), before);
  assert.deepEqual(await backupStore.snapshot(), original);
});

test('lending links, write-offs and people survive restore', async () => {
  const lending = await import('./lending.ts');
  const person = await lending.createPerson('Synthetic person');
  const lent = await lending.saveLendingEntry({
    personId: person.id,
    kind: 'LEND',
    amountMinor: 1000,
    date: 20149,
    accountId: 10,
    note: 'synthetic lending',
  });
  const writeOff = await lending.saveLendingEntry({
    personId: person.id,
    kind: 'WRITE_OFF_LENT',
    amountMinor: 100,
    date: 20150,
    currencyCode: 'BDT',
    note: 'synthetic waiver',
  });
  const { loadEditableTransaction, saveTransactionEdit } = await import('./transaction-edit.ts');
  await saveTransactionEdit(
    await loadEditableTransaction(lent.id),
    'edited principal note',
    false,
    '',
  );
  const original = await backupStore.snapshot();
  assert.deepEqual(
    original.lendingEntries.map((entry) => ({ ...entry })),
    [
      {
        id: lent.id,
        personId: person.id,
        kind: 'LEND',
        transactionId: lent.id,
        currencyCode: 'BDT',
        amountMinor: 1000,
        dateEpochDay: 20149,
        note: 'edited principal note',
      },
      {
        id: writeOff.id,
        personId: person.id,
        kind: 'WRITE_OFF_LENT',
        transactionId: null,
        currencyCode: 'BDT',
        amountMinor: 100,
        dateEpochDay: 20150,
        note: 'synthetic waiver',
      },
    ],
    'each entry uses the id of its Transaction',
  );
  const linked = original.transactions.find((row) => row.id === lent.id);
  assert.deepEqual(
    [linked.type, linked.excludeFromReport, linked.categoryId],
    ['EXPENSE', true, null],
  );
  assert.equal(
    original.transactions.some((row) => row.id === writeOff.id),
    false,
    'a Write-off is not a v1 Transaction',
  );
  assert.deepEqual(
    original.people.map((row) => ({ ...row })),
    [person],
  );
  const before = state();
  await replaceDocument(decodeBackup(encodeBackup(original)));
  assert.deepEqual(state(), before);
  const restored = await backupStore.snapshot();
  const highest = Math.max(...original.transactions.map((row) => row.id));
  assert.equal(
    restored.lendingEntries[1].id,
    highest + 1,
    'a restored Write-off gets the next id after the other Transactions',
  );
  assert.deepEqual(
    { ...restored, lendingEntries: restored.lendingEntries.map(({ id, ...entry }) => entry) },
    { ...original, lendingEntries: original.lendingEntries.map(({ id, ...entry }) => entry) },
  );
  assert.equal((await lending.listLendingEntries(person.id)).length, 2);
  assert.equal((await lending.listLendingTotals(person.id))[0].outstandingMinor, 900);
});

test('native v1 fixture restores into SQLite and drops the MoneyLover data', async () => {
  const native = readFileSync(
    new URL('../../scripts/fixtures/native-shaped-backup-v1.json', import.meta.url),
    'utf8',
  );
  const data = decodeBackup(native);
  assert.equal(data.moneyLoverImportRows, undefined);
  await replaceDocument(data);
  const restored = await backupStore.snapshot();
  const expected = {
    ...data,
    categories: [...data.categories].sort((a, b) => a.id - b.id),
    // The legs model has no source and no transfer candidates (ADR 0012), and it keeps the
    // received amount of every Transfer between Currencies (ADR 0013).
    transactions: data.transactions.map((row) => ({
      ...row,
      ...(row.id === 101 ? { receivedAmountMinor: row.amountMinor } : {}),
      source: 'MANUAL',
    })),
    transferCandidates: [],
  };
  for (const key of [
    'accounts',
    'categories',
    'transactions',
    'lineItems',
    'tags',
    'transactionTags',
    'transferCandidates',
    'settings',
  ])
    assert.deepEqual(
      JSON.parse(JSON.stringify(restored[key])),
      JSON.parse(JSON.stringify(expected[key])),
      key,
    );
  assert.equal(restored.moneyLoverImportRows, undefined);
  assert.deepEqual(restored.people, []);
  assert.deepEqual(restored.lendingEntries, []);
});

test('failed SQLite replacement rolls back every table including settings', async () => {
  const before = state();
  const data = await backupStore.snapshot();
  data.accounts.push({
    id: 999,
    name: 'New',
    currencyCode: 'BDT',
    openingBalanceMinor: 0,
    isFavorite: false,
  });
  data.settings.displayRate = null;
  sql.exec(
    "CREATE TRIGGER fail_backup BEFORE INSERT ON line_items BEGIN SELECT RAISE(ABORT, 'forced backup failure'); END",
  );
  try {
    await assert.rejects(backupStore.replace(data), /forced backup failure/);
    assert.deepEqual(state(), before);
  } finally {
    sql.exec('DROP TRIGGER fail_backup');
  }
});

test('a restore rejects rows that break the legs model and changes nothing', async () => {
  const before = state();
  const data = await backupStore.snapshot();
  data.transactions.push({
    id: 998,
    type: 'EXPENSE',
    amountMinor: 1,
    dateEpochDay: 20000,
    accountId: 4040,
    transferAccountId: null,
    categoryId: null,
    note: null,
    excludeFromReport: false,
    source: 'MANUAL',
  });
  await assert.rejects(
    backupStore.replace(data),
    /Row 998 of transactions needs Account 4040, which does not exist/,
  );
  assert.deepEqual(state(), before);
});

const fixture = () =>
  decodeBackup(
    readFileSync(new URL('../../scripts/fixtures/backup-v1.json', import.meta.url), 'utf8'),
  );
const writeOff = (id, amountMinor = 100) => ({
  id,
  personId: 1,
  kind: 'WRITE_OFF_LENT',
  transactionId: null,
  currencyCode: 'BDT',
  amountMinor,
  dateEpochDay: 20722,
  note: null,
});

test('a restore leaves out rows of a deleted Transaction and repairs missing Categories', async () => {
  // Old phones deleted on a connection with foreign keys off, so old backups can have these.
  const data = fixture();
  data.categories.push({
    id: 2,
    name: 'Orphan',
    type: 'EXPENSE',
    parentId: 99,
    iconKey: null,
    needsReview: false,
  });
  data.transactions[0].categoryId = 98;
  data.tags = [{ id: 5, name: 'old' }];
  // Transaction 2 was deleted. The Write-off gets id 2, but it must not get these rows.
  data.transactionTags = [
    { transactionId: 1, tagId: 5 },
    { transactionId: 2, tagId: 5 },
  ];
  data.lineItems = [{ id: 7, transactionId: 2, name: 'left', amountMinor: 1, quantity: null }];
  data.people = [{ id: 1, name: 'Ali' }];
  data.lendingEntries = [writeOff(4)];
  await replaceDocument(data);
  const restored = await backupStore.snapshot();
  assert.equal(restored.lendingEntries[0].id, 2);
  assert.deepEqual(restored.lineItems, []);
  assert.deepEqual(
    restored.transactionTags.map((link) => ({ ...link })),
    [{ transactionId: 1, tagId: 5 }],
  );
  assert.equal(restored.categories.find((row) => row.id === 2).parentId, null);
  assert.equal(restored.transactions[0].categoryId, null);
});

/** Restores the JSON text as the app does: decode, confirm, then replace. */
function restoreJson(json) {
  return restoreBackup(
    backupStore,
    {
      pickJsonDocument: async () => ({ uri: 'content://old-backup', name: 'old.json' }),
      readText: async () => json,
    },
    async () => true,
  );
}

test('a restore of a raw file deletes each kind of row that a delete left behind', async () => {
  // A clean backup with an Expense, a split share, a reimbursement and a card.
  const clean = fixture();
  clean.accounts.push({
    id: 2,
    name: 'Card',
    currencyCode: 'BDT',
    openingBalanceMinor: 0,
    isFavorite: false,
  });
  clean.transactions.push({
    ...clean.transactions[0],
    id: 2,
    type: 'INCOME',
    categoryId: null,
    dateEpochDay: clean.transactions[0].dateEpochDay + 1,
  });
  clean.people = [{ id: 1, name: 'Ali' }];
  clean.splitShares = [{ expenseId: 1, personId: 1, amountMinor: 500 }];
  clean.reimbursements = [{ transactionId: 2, expenseId: 1, personId: 1 }];
  clean.creditCards = [{ accountId: 2, parentAccountId: 1, statementDay: null, dueDay: null }];
  clean.lendingEntries = [];
  clean.moneyLoverImportRows = [];
  await restoreJson(JSON.stringify(clean));
  const expected = await backupStore.snapshot();

  // Transaction 9 and Account 9 were deleted. Each row below points to one of them.
  const orphans = {
    moneyLoverImportRows: [{ rowKey: 'gone', transactionId: 9 }],
    lendingEntries: [
      {
        id: 1,
        personId: 1,
        kind: 'LEND',
        transactionId: 9,
        currencyCode: 'BDT',
        amountMinor: 1,
        dateEpochDay: 1,
        note: null,
      },
    ],
    splitShares: [...clean.splitShares, { expenseId: 9, personId: 1, amountMinor: 1 }],
    reimbursements: [
      ...clean.reimbursements,
      { transactionId: 9, expenseId: 1, personId: null },
      { transactionId: 1, expenseId: 9, personId: null },
    ],
    creditCards: [
      ...clean.creditCards,
      { accountId: 9, parentAccountId: 1, statementDay: null, dueDay: null },
    ],
  };
  for (const [key, rows] of Object.entries(orphans)) {
    await restoreJson(JSON.stringify(fixture()));
    assert.equal(await restoreJson(JSON.stringify({ ...clean, [key]: rows })), true, key);
    assert.deepEqual(await backupStore.snapshot(), expected, key);
  }

  // A reimbursement whose split share was deleted goes with the share.
  await restoreJson(JSON.stringify({ ...clean, splitShares: [] }));
  const withoutShare = await backupStore.snapshot();
  assert.deepEqual(withoutShare.reimbursements, []);
  // A missing card parent becomes no parent, as SET NULL would do.
  await restoreJson(
    JSON.stringify({ ...clean, creditCards: [{ ...clean.creditCards[0], parentAccountId: 9 }] }),
  );
  assert.equal((await backupStore.snapshot()).creditCards[0].parentAccountId, null);
});

test('a raw file with a stale received amount restores, and a lost destination is named', async () => {
  const data = fixture();
  data.transactions[0].receivedAmountMinor = 50;
  assert.equal(await restoreJson(JSON.stringify(data)), true);
  assert.equal((await backupStore.snapshot()).transactions[0].receivedAmountMinor, undefined);
  const before = state();
  data.accounts.push({
    id: 2,
    name: 'USD',
    currencyCode: 'USD',
    openingBalanceMinor: 0,
    isFavorite: false,
  });
  data.transactions[0] = {
    ...data.transactions[0],
    type: 'TRANSFER',
    categoryId: null,
    transferAccountId: 9,
    receivedAmountMinor: 100,
  };
  await assert.rejects(
    restoreJson(JSON.stringify(data)),
    /Row 1 of transactions needs destination Account 9/,
  );
  assert.deepEqual(state(), before);
});

test('a file that names a missing person stops before any change', async () => {
  await restoreJson(JSON.stringify(fixture()));
  const before = state();
  const data = fixture();
  data.people = [{ id: 1, name: 'Ali' }];
  data.lendingEntries = [writeOff(1)];
  data.lendingEntries[0].personId = 7;
  await assert.rejects(
    restoreJson(JSON.stringify(data)),
    /Row 1 of lending_entries needs person 7, which does not exist/,
  );
  assert.deepEqual(state(), before);
});

test('a restore makes one tag of tags whose names differ only by case', async () => {
  // The old schema compared tag names by case, so an old backup can have both.
  const data = fixture();
  data.tags = [
    { id: 5, name: 'Trip' },
    { id: 6, name: 'trip' },
  ];
  data.transactionTags = [
    { transactionId: 1, tagId: 5 },
    { transactionId: 1, tagId: 6 },
  ];
  await replaceDocument(data);
  const restored = await backupStore.snapshot();
  assert.deepEqual(
    restored.tags.map((tag) => ({ ...tag })),
    [{ id: 5, name: 'Trip' }],
  );
  assert.deepEqual(
    restored.transactionTags.map((link) => ({ ...link })),
    [{ transactionId: 1, tagId: 5 }],
  );
});

test('a restore refuses a Write-off id above the safe integer range and changes nothing', async () => {
  const data = fixture();
  data.transactions[0].id = Number.MAX_SAFE_INTEGER - 1;
  data.people = [{ id: 1, name: 'Ali' }];
  // A large lending entry id does not matter: Write-offs get the next ids in order.
  data.lendingEntries = [writeOff(Number.MAX_SAFE_INTEGER, 100)];
  await replaceDocument(data);
  assert.equal((await backupStore.snapshot()).lendingEntries[0].id, Number.MAX_SAFE_INTEGER);
  await replaceDocument(fixture());
  const restoredOnce = state();
  data.lendingEntries.push(writeOff(1, 50));
  await assert.rejects(replaceDocument(data), /Transaction id that is too large/);
  assert.deepEqual(state(), restoredOnce);
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
    assert.throws(() => encodeBackup({ ...original, creditCards }), /credit.card/);
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
  // The destination leg now stores the amount, so the next backup has it.
  assert.equal((await backupStore.snapshot()).transactions[0].receivedAmountMinor, 1220000);
});

test('first-rate lookup finds the newest Transfer in either direction and gives Display Rate priority', async () => {
  const { loadFirstTransferRate } = await import('./transfer-rate-store.ts');
  const { saveDisplayRate } = await import('./display-rate-store.ts');
  await saveDisplayRate(null);
  sql.exec(`DELETE FROM credit_cards; DELETE FROM reimbursements; DELETE FROM transactions;
    DELETE FROM accounts;
    INSERT INTO accounts (id, name, currencyCode) VALUES (1, 'BDT bank', 'BDT'), (2, 'USD bank', 'USD');`);
  assert.deepEqual(await loadFirstTransferRate('BDT', 'USD'), {
    base: 'USD',
    quote: 'BDT',
    rate: undefined,
  });
  for (const [id, amountMinor, receivedAmountMinor, date, accountId, transferAccountId] of [
    [1, 1200000, 10000, 20000, 1, 2],
    [2, 10000, 1214000, 20001, 2, 1],
    [3, 1220000, 10000, 20001, 1, 2],
  ])
    addTransaction(sql, {
      id,
      type: 'TRANSFER',
      amountMinor,
      receivedAmountMinor,
      date,
      accountId,
      transferAccountId,
    });
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

test('split shares, person payments and refunds survive a v1 backup round trip', async () => {
  const original = await backupStore.snapshot();
  const account = original.accounts[0];
  const { addQuickTransaction } = await import('./quick-add-tags.ts');
  const { createPerson } = await import('./lending.ts');
  const person = await createPerson('Split backup person');
  const entry = { accountId: account.id, categoryId: null, date: new Date(2025, 0, 1), note: null };
  await addQuickTransaction(
    {
      ...entry,
      type: 'EXPENSE',
      amountMinor: 3000,
      shares: [{ personId: person.id, amountMinor: 2000 }],
    },
    'dinner',
  );
  const expenseId = sql.prepare('SELECT MAX(id) AS id FROM transactions').get().id;
  await assert.rejects(
    addQuickTransaction(
      {
        ...entry,
        type: 'INCOME',
        amountMinor: 1500,
        date: new Date(2024, 11, 31),
        reimbursement: { expenseId, personId: person.id },
      },
      '',
    ),
    /on or after the expense/,
  );
  await addQuickTransaction(
    {
      ...entry,
      type: 'INCOME',
      amountMinor: 1500,
      reimbursement: { expenseId, personId: person.id },
    },
    '',
  );
  await addQuickTransaction(
    { ...entry, type: 'INCOME', amountMinor: 200, reimbursement: { expenseId, personId: null } },
    '',
  );
  const snapshot = await backupStore.snapshot();
  const decoded = decodeBackup(encodeBackup(snapshot));
  assert.deepEqual(decoded.splitShares, [{ expenseId, personId: person.id, amountMinor: 2000 }]);
  assert.deepEqual(
    decoded.reimbursements.map(({ personId }) => personId),
    [person.id, null],
  );
  assert.throws(() => encodeBackup({ ...decoded, splitShares: [] }), /reimbursement/);
  const early = structuredClone(decoded);
  const payment = early.transactions.find(({ id }) => id === early.reimbursements[0].transactionId);
  payment.dateEpochDay = early.transactions.find(({ id }) => id === expenseId).dateEpochDay - 1;
  assert.throws(() => decodeBackup(JSON.stringify(early)), /reimbursement/);
  const legacy = { ...original };
  delete legacy.splitShares;
  delete legacy.reimbursements;
  await backupStore.replace(decodeBackup(encodeBackup(legacy)));
  assert.deepEqual((await backupStore.snapshot()).reimbursements, []);
  await backupStore.replace(decoded);
  assert.deepEqual(decodeBackup(encodeBackup(await backupStore.snapshot())), decoded);
});
