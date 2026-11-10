import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/database') return { url: 'pace-test:database', shortCircuit: true };
    if (specifier.startsWith('@/lib/'))
      return {
        url: new URL(`../../lib/${specifier.slice(6)}.ts`, import.meta.url).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'pace-test:database')
      return { format: 'module', source: 'export const database = () => {};', shortCircuit: true };
    return next(url, context);
  },
});
const { paceSummary, convertTo } = await import('./pace.ts');
hooks.deregister();

const rate = { base: 'USD', quote: 'BDT', rate: 120 };
const balances = [
  { currencyCode: 'BDT', balanceMinor: 1_200_000 },
  { currencyCode: 'USD', balanceMinor: 10_000 },
];
const pace = [
  { currencyCode: 'BDT', spentMinor: 60_000, sameMinor: 50_000, previousMinor: 90_000 },
  { currencyCode: 'USD', spentMinor: 1_000, sameMinor: 0, previousMinor: 2_000 },
];

test('convertTo uses the Display Rate in both directions', () => {
  assert.equal(
    convertTo(
      [
        { currencyCode: 'BDT', amountMinor: 12_000 },
        { currencyCode: 'USD', amountMinor: 100 },
      ],
      rate,
      'BDT',
    ),
    24_000,
  );
  assert.equal(
    convertTo(
      [
        { currencyCode: 'BDT', amountMinor: 12_000 },
        { currencyCode: 'USD', amountMinor: 100 },
      ],
      rate,
      'USD',
    ),
    200,
  );
  assert.equal(convertTo([{ currencyCode: 'BDT', amountMinor: 5 }], null, 'BDT'), 5);
  assert.equal(convertTo([{ currencyCode: 'EUR', amountMinor: 5 }], rate, 'BDT'), null);
  assert.equal(convertTo([{ currencyCode: 'USD', amountMinor: 5 }], null, 'BDT'), null);
});

test('with a Display Rate, the card shows one total in the main Currency and converted Pace', () => {
  const summary = paceSummary({ balances, pace, rate, mainCurrency: 'BDT' });
  assert.deepEqual(summary.total, { currencyCode: 'BDT', amountMinor: 2_400_000 });
  assert.deepEqual(summary.rate, rate);
  assert.deepEqual(
    summary.parts.map((part) => part.currencyCode),
    ['BDT', 'USD'],
  );
  assert.deepEqual(summary.pace, {
    currencyCode: 'BDT',
    spentMinor: 180_000,
    sameMinor: 50_000,
    previousMinor: 330_000,
  });
  assert.equal(summary.paceOnly, null);
});

test('without a Display Rate, the card shows each Currency and Pace counts the main Currency only', () => {
  const summary = paceSummary({ balances, pace, rate: null, mainCurrency: 'BDT' });
  assert.equal(summary.total, null);
  assert.equal(summary.rate, null);
  assert.deepEqual(summary.pace, pace[0]);
  assert.equal(summary.paceOnly, 'BDT');
});

test('an invalid Display Rate does not combine the totals', () => {
  for (const bad of [
    { ...rate, rate: 0 },
    { ...rate, rate: Infinity },
    { ...rate, quote: 'USD' },
  ]) {
    const summary = paceSummary({ balances, pace, rate: bad, mainCurrency: 'BDT' });
    assert.equal(summary.total, null);
    assert.equal(summary.paceOnly, 'BDT');
  }
});

test('a rate for another pair does not combine the totals', () => {
  const summary = paceSummary({
    balances,
    pace,
    rate: { base: 'EUR', quote: 'BDT', rate: 130 },
    mainCurrency: 'BDT',
  });
  assert.equal(summary.total, null);
  assert.equal(summary.paceOnly, 'BDT');
});

test('one Currency needs no rate and no note', () => {
  const summary = paceSummary({
    balances: [balances[0]],
    pace: [pace[0]],
    rate: null,
    mainCurrency: 'BDT',
  });
  assert.deepEqual(summary.total, { currencyCode: 'BDT', amountMinor: 1_200_000 });
  assert.equal(summary.paceOnly, null);
  assert.deepEqual(summary.pace, pace[0]);
});

test('no spending in the main Currency gives zero Pace', () => {
  const summary = paceSummary({ balances, pace: [], rate: null, mainCurrency: 'BDT' });
  assert.deepEqual(summary.pace, {
    currencyCode: 'BDT',
    spentMinor: 0,
    sameMinor: 0,
    previousMinor: 0,
  });
});
