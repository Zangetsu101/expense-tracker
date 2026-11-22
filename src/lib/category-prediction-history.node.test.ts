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
test('history isolates mode/Currency and excludes lending and ambiguous labels', async () => {
  db.exec(`CREATE TABLE accounts(id, currencyCode);
    CREATE TABLE categories(id, type, name, needsReview);
    CREATE TABLE transactions(id, type, accountId, categoryId, amountMinor, date, source, excludeFromReport);
    CREATE TABLE lending_entries(transactionId);
    INSERT INTO accounts VALUES(1,'BDT'),(2,'USD');
    INSERT INTO categories VALUES(1,'EXPENSE','Food',0),(2,'EXPENSE','Loan',0),(3,'INCOME','Salary',0),(4,'EXPENSE','Unknown',1);
    INSERT INTO transactions VALUES
    (1,'EXPENSE',1,1,100,1,'MANUAL',1),
    (2,'EXPENSE',2,1,100,1,'MANUAL',0),
    (3,'EXPENSE',1,1,100,1,'MANUAL',0),
    (4,'EXPENSE',1,2,100,1,'IMPORT',0),
    (5,'EXPENSE',1,2,100,1,'MANUAL',0),
    (6,'INCOME',1,3,100,1,'MANUAL',0),
    (7,'EXPENSE',1,4,100,1,'MANUAL',0);
    INSERT INTO lending_entries VALUES(3);`);
  const rows = await listCategoryEvidence('EXPENSE', 'BDT');
  assert.deepEqual(
    rows.map((r) => r.categoryId),
    [1, 2],
  );
});
