import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

let stored;
const tx = {
  getFirstAsync: async (sql) =>
    sql.includes('app_settings') ? (stored ? { value: stored } : null) : { id: 42 },
  runAsync: async (_sql, values) => {
    stored = values[0];
  },
};
globalThis.__displayRateDb = { ...tx, withExclusiveTransactionAsync: async (fn) => fn(tx) };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './database.ts') return { url: 'test:database', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:database')
      return {
        format: 'module',
        source: 'export const database = async () => globalThis.__displayRateDb;',
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
const { combinedMinor, combinedCategorySpending } = await import('./display-rate.ts');
const { saveDisplayRate, getDisplayRate } = await import('./display-rate-store.ts');

const rate = { base: 'USD', quote: 'BDT', rate: 100 };
test('combined totals require an exact pair and explicit rate', () => {
  const rows = [
    { currencyCode: 'USD', amountMinor: 100 },
    { currencyCode: 'BDT', amountMinor: 10000 },
  ];
  assert.equal(combinedMinor(rows, null), null);
  assert.equal(combinedMinor(rows, rate), 200);
  assert.equal(combinedMinor([...rows, { currencyCode: 'EUR', amountMinor: 100 }], rate), null);
  assert.equal(combinedMinor(rows, { ...rate, quote: 'EUR' }), null);
  assert.equal(combinedMinor(rows, { ...rate, rate: 0 }), null);
  assert.equal(combinedMinor([rows[0]], null), 100);
  assert.equal(combinedMinor(rows, { ...rate, rate: Number.MIN_VALUE }), null);
});

test('category totals convert quote-only and shared categories into base currency', () => {
  const spending = [
    { categoryId: 1, categoryName: 'Food', currencyCode: 'BDT', amountMinor: 10000 },
    { categoryId: 1, categoryName: 'Food', currencyCode: 'USD', amountMinor: 100 },
    { categoryId: 2, categoryName: 'Rent', currencyCode: 'BDT', amountMinor: 5000 },
  ];
  assert.deepEqual(
    combinedCategorySpending(spending, rate).map(({ categoryId, amountMinor }) => [
      categoryId,
      amountMinor,
    ]),
    [
      [1, 200],
      [2, 50],
    ],
  );
  assert.deepEqual(combinedCategorySpending(spending, null), []);
  assert.deepEqual(
    combinedCategorySpending(
      [...spending, { categoryId: 3, categoryName: 'Other', currencyCode: 'EUR', amountMinor: 10 }],
      rate,
    ),
    [],
  );
});

test('save preserves favorite account and other settings and can clear rate', async () => {
  stored = JSON.stringify({ favoriteAccountId: 7, displayRate: null, custom: true });
  await saveDisplayRate(rate);
  assert.deepEqual(JSON.parse(stored), { favoriteAccountId: 7, displayRate: rate, custom: true });
  assert.deepEqual(await getDisplayRate(), rate);
  await saveDisplayRate(null);
  assert.equal(await getDisplayRate(), null);
  assert.equal(JSON.parse(stored).favoriteAccountId, 7);
  await assert.rejects(saveDisplayRate({ ...rate, rate: Infinity }));
});
