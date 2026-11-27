import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { legsSchema } from './legs-schema.ts';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const db = new DatabaseSync(':memory:');
let failCommit = false;
db.exec(legsSchema);
const adapter = {
  runAsync: async (sql, params) => {
    const result = db.prepare(sql).run(...params);
    return { ...result, lastInsertRowId: Number(result.lastInsertRowid) };
  },
  getAllAsync: async (sql, params = []) => db.prepare(sql).all(...params),
  getFirstAsync: async (sql, params) => db.prepare(sql).get(...params) ?? null,
  async withExclusiveTransactionAsync(callback) {
    db.exec('SAVEPOINT create_account');
    try {
      const result = await callback(adapter);
      if (failCommit) throw new Error('commit failed');
      db.exec('RELEASE create_account');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO create_account; RELEASE create_account');
      throw error;
    }
  },
};
globalThis.__accountsTestDb = adapter;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database')
      return {
        format: 'module',
        source:
          'export const database = async () => globalThis.__accountsTestDb; export const isFavoriteSql = (a) => `(${a}.id IS (SELECT CAST(value AS INTEGER) FROM app_settings WHERE key = \'favoriteAccountId\'))`; export async function setFavoriteAccount(id) { const row = globalThis.__accountsTestDb; const accounts = await row.getAllAsync("SELECT id FROM accounts"); if (!accounts.some(a => a.id === id)) throw Error("Account not found."); await row.runAsync("INSERT OR REPLACE INTO app_settings (key, value) VALUES (\'favoriteAccountId\', ?)", [String(id)]); }',
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
const {
  createAccount,
  listManagedAccounts,
  parseOpeningBalance,
  setFavoriteAccount,
  updateAccount,
} = await import('./accounts.ts');

test('opening balance parses exact minor units, including negative and zero', () => {
  assert.equal(parseOpeningBalance('-12.34'), -1234);
  assert.equal(parseOpeningBalance('0'), 0);
  assert.equal(parseOpeningBalance('+2.5'), 250);
  for (const value of ['', '1.234', '1e3', 'NaN', '90071992547410', '1,000'])
    assert.throws(() => parseOpeningBalance(value));
});

test('creation validates before writing, parameterizes names and stores currency and opening balance', async () => {
  for (const input of [
    { name: ' ', currencyCode: 'USD', openingBalance: '0' },
    { name: 'Cash', currencyCode: 'US$ ', openingBalance: '0' },
    { name: 'Cash', currencyCode: 'USD', openingBalance: '1.234' },
  ])
    await assert.rejects(createAccount(input));
  assert.equal((await listManagedAccounts()).length, 0);
  await createAccount({
    name: "  O'Brien; DROP TABLE accounts; -- ",
    currencyCode: ' bdt ',
    openingBalance: '-10.01',
  });
  await createAccount({ name: 'Savings', currencyCode: 'USD', openingBalance: '25' });
  await assert.rejects(
    createAccount({ name: ' savings ', currencyCode: 'EUR', openingBalance: '0' }),
    /already exists/,
  );
  const rows = await listManagedAccounts();
  assert.equal(rows[0].name, "O'Brien; DROP TABLE accounts; --");
  assert.equal(rows[0].currencyCode, 'BDT');
  assert.equal(rows[0].openingBalanceMinor, -1001);
  assert.equal(rows[1].openingBalanceMinor, 2500);
  await setFavoriteAccount(rows[1].id);
  assert.equal((await listManagedAccounts())[0].name, 'Savings');
});

test('Account cache notification follows commit and excludes failed writes', async () => {
  const { subscribeDataChanges } = await import('./data-changes.ts');
  const events = [];
  const unsubscribe = subscribeDataChanges(() =>
    events.push({
      inTransaction: db.isTransaction,
      found: db.prepare('SELECT id FROM accounts WHERE name = ?').get('Cache notification'),
    }),
  );
  try {
    await createAccount({ name: 'Cache notification', currencyCode: 'USD', openingBalance: '1' });
    assert.equal(events.length, 1);
    assert.equal(events[0].inTransaction, false, 'observers must only see committed writes');
    assert.ok(events[0].found);
    failCommit = true;
    await assert.rejects(
      createAccount({ name: 'Rolled back notification', currencyCode: 'USD', openingBalance: '1' }),
      /commit failed/,
    );
    assert.equal(
      db.prepare('SELECT id FROM accounts WHERE name = ?').get('Rolled back notification'),
      undefined,
    );
    assert.equal(events.length, 1, 'rollback must not refresh the cache');
    failCommit = false;
    await assert.rejects(
      createAccount({ name: 'Cache notification', currencyCode: 'USD', openingBalance: '1' }),
    );
    assert.equal(events.length, 1, 'rejected duplicate must not refresh the cache');
  } finally {
    failCommit = false;
    unsubscribe();
  }
});

test('cards keep non-card parents across Currencies; imported Accounts can be renamed and converted', async () => {
  await createAccount({ name: 'Card parent', currencyCode: 'USD', openingBalance: '100' });
  const parent = (await listManagedAccounts()).find((a) => a.name === 'Card parent');
  await createAccount({
    name: 'Credit card',
    currencyCode: 'USD',
    openingBalance: '-25',
    isCreditCard: true,
    parentAccountId: parent.id,
    statementDay: 20,
    dueDay: 5,
  });
  const card = (await listManagedAccounts()).find((a) => a.name === 'Credit card');
  assert.equal(card.card.parentAccountId, parent.id);
  assert.equal(card.openingBalanceMinor, -2500);
  await assert.rejects(
    updateAccount(parent.id, {
      name: parent.name,
      currencyCode: 'USD',
      openingBalance: '100',
      isCreditCard: true,
    }),
    /Change the cards/,
  );
  await createAccount({
    name: 'Different Currency',
    currencyCode: 'BDT',
    openingBalance: '0',
    isCreditCard: true,
    parentAccountId: parent.id,
  });
  await assert.rejects(
    createAccount({
      name: 'Card parent cycle',
      currencyCode: 'USD',
      openingBalance: '0',
      isCreditCard: true,
      parentAccountId: card.id,
    }),
    /liquid Account/,
  );
  await assert.rejects(
    createAccount({
      name: 'Invalid day',
      currencyCode: 'USD',
      openingBalance: '0',
      isCreditCard: true,
      dueDay: 32,
    }),
    /between 1 and 31/,
  );
  await updateAccount(card.id, {
    name: 'Renamed card',
    currencyCode: 'USD',
    openingBalance: '-25',
    isCreditCard: true,
  });
  assert.equal(
    (await listManagedAccounts()).find((a) => a.id === card.id).card.parentAccountId,
    null,
  );
  await updateAccount(card.id, {
    name: 'Renamed account',
    currencyCode: 'USD',
    openingBalance: '25',
  });
  assert.equal((await listManagedAccounts()).find((a) => a.id === card.id).card, undefined);
});
