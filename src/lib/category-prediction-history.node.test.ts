import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
const db = new DatabaseSync(':memory:');
const previousDb = globalThis.__predictionDb;
const hadDb = Object.hasOwn(globalThis, '__predictionDb');
globalThis.__predictionDb = { getAllAsync: async (sql, params) => db.prepare(sql).all(...params) };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database') return { url: 'test:prediction-db', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:prediction-db')
      return {
        format: 'module',
        source: 'export const database=async()=>globalThis.__predictionDb;',
        shortCircuit: true,
      };
    return next(url, context);
  },
});
after(() => {
  hooks.deregister();
  db.close();
  if (hadDb) globalThis.__predictionDb = previousDb;
  else delete globalThis.__predictionDb;
});
const { listCategoryEvidence } = await import('./category-prediction-history.ts');
test('history isolates type and Currency and excludes linked lending', async () => {
  db.exec(`CREATE TABLE categories(id, type, name);
    CREATE TABLE transactions(id, kind, categoryId, date);
    CREATE TABLE legs(transactionId, accountId, personId, currencyCode, amountMinor);
    INSERT INTO categories VALUES(1,'EXPENSE','Food'),(2,'EXPENSE','Transport'),(3,'INCOME','Salary');
    INSERT INTO transactions VALUES
    (1,'EXPENSE',1,1),
    (2,'EXPENSE',1,1),
    (3,'LENDING',1,1),
    (5,'EXPENSE',2,1),
    (6,'INCOME',3,1);
    INSERT INTO legs VALUES
    (1,1,NULL,'BDT',-100),
    (2,2,NULL,'USD',-100),
    (3,1,NULL,'BDT',-100),
    (3,NULL,1,'BDT',100),
    (5,1,NULL,'BDT',-100),
    (6,1,NULL,'BDT',100);`);
  const rows = await listCategoryEvidence('EXPENSE', 'BDT');
  assert.deepEqual(
    rows.map((r) => [r.categoryId, r.accountId, r.amountMinor]),
    [
      [1, 1, 100],
      [2, 1, 100],
    ],
  );
});
