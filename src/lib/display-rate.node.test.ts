import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

// The app_settings rows, by key.
const settings = new Map();
globalThis.__displayRateDb = {
  getFirstAsync: async (sql) => {
    const value = settings.get(/key = '(\w+)'/.exec(sql)[1]);
    return value === undefined ? null : { value };
  },
  runAsync: async (sql, values) => {
    if (sql.startsWith('DELETE')) settings.delete(/key = '(\w+)'/.exec(sql)[1]);
    else settings.set(/VALUES \('(\w+)'/.exec(sql)[1], values[0]);
  },
};
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
const { combinedMinor, combinedCategorySpending, rowsInCurrency, usableRate } =
  await import('./display-rate.ts');
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

test('save writes only the displayRate row and can clear the rate', async () => {
  settings.set('favoriteAccountId', '7');
  await saveDisplayRate(rate);
  assert.deepEqual(JSON.parse(settings.get('displayRate')), rate);
  assert.deepEqual(await getDisplayRate(), rate);
  await saveDisplayRate(null);
  assert.equal(settings.has('displayRate'), false);
  assert.equal(await getDisplayRate(), null);
  assert.equal(settings.get('favoriteAccountId'), '7');
  await assert.rejects(saveDisplayRate({ ...rate, rate: Infinity }));
});

test('usableRate keeps a valid Display Rate only', () => {
  const rate = { base: 'USD', quote: 'BDT', rate: 120 };
  assert.equal(usableRate(rate), rate);
  assert.equal(usableRate({ ...rate, rate: 0 }), null);
  assert.equal(usableRate(null), null);
});

test('rowsInCurrency converts each row at the Display Rate, or leaves out the other Currencies', () => {
  const rate = { base: 'USD', quote: 'BDT', rate: 120 };
  const rows = [
    { currencyCode: 'BDT', amountMinor: 1_000, date: 1 },
    { currencyCode: 'USD', amountMinor: 10, date: 2 },
  ];
  assert.deepEqual(rowsInCurrency(rows, rate, 'BDT'), {
    rows: [
      { currencyCode: 'BDT', amountMinor: 1_000, date: 1 },
      { currencyCode: 'BDT', amountMinor: 1_200, date: 2 },
    ],
    leftOutOthers: false,
  });
  assert.deepEqual(rowsInCurrency(rows, null, 'BDT'), {
    rows: [{ currencyCode: 'BDT', amountMinor: 1_000, date: 1 }],
    leftOutOthers: true,
  });
  assert.equal(rowsInCurrency(rows.slice(0, 1), null, 'BDT').leftOutOthers, false);
});
