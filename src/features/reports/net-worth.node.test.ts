import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// Resolve the `@/lib/` path alias that the app bundler provides.
const hooks = registerHooks({
  resolve: (specifier, context, next) =>
    specifier.startsWith('@/lib/')
      ? {
          url: new URL(`../../lib/${specifier.slice(6)}.ts`, import.meta.url).href,
          shortCircuit: true,
        }
      : next(specifier, context),
});
const { netWorth } = await import('./net-worth.ts');
hooks.deregister();

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const month = (y, m) => y * 12 + m - 1;
// Friday 13 November 2026.
const today = day(2026, 11, 13);
const cash = { id: 1, name: 'Cash', currencyCode: 'BDT', openingBalanceMinor: 1000 };
const card = { id: 2, name: 'Card', currencyCode: 'BDT', openingBalanceMinor: 0 };
const wise = { id: 3, name: 'Wise', currencyCode: 'USD', openingBalanceMinor: 10 };
const rate = { base: 'USD', quote: 'BDT', rate: 100 };
const changes = [
  { accountId: 1, month: month(2026, 9), changeMinor: 500 },
  { accountId: 1, month: month(2026, 11), changeMinor: -200 },
  { accountId: 2, month: month(2026, 10), changeMinor: -300 },
  { accountId: 3, month: month(2026, 10), changeMinor: 5 },
];
const lend = (kind, amountMinor, date, currencyCode = 'BDT') => ({
  personId: 1,
  kind,
  amountMinor,
  date,
  currencyCode,
});

test('net worth is one line at the Display Rate, with one point for each month end', () => {
  const result = netWorth(
    { accounts: [cash, card, wise], changes, lending: [], rate, mainCurrency: 'BDT', today },
    3,
  );
  assert.deepEqual(
    result.points.map((point) => point.day),
    [day(2026, 8, 31), day(2026, 9, 30), day(2026, 10, 31), today],
  );
  assert.equal(result.series.length, 1);
  const [series] = result.series;
  assert.equal(series.currencyCode, 'BDT');
  assert.deepEqual(series.accounts, [2000, 2500, 2700, 2500]);
  assert.equal(series.totalMinor, 2500);
  assert.deepEqual(
    result.accounts.map((a) => [a.name, a.balanceMinor, a.mainMinor]),
    [
      ['Cash', 1300, 1300],
      ['Card', -300, -300],
      ['Wise', 15, 1500],
    ],
  );
});

test('without a usable Display Rate, each Currency has its own line', () => {
  const result = netWorth(
    { accounts: [cash, card, wise], changes, lending: [], rate: null, mainCurrency: 'BDT', today },
    1,
  );
  assert.deepEqual(
    result.series.map((s) => [s.currencyCode, s.accounts]),
    [
      ['BDT', [1200, 1000]],
      ['USD', [15, 15]],
    ],
  );
  assert.equal(result.accounts[2].mainMinor, null);
});

test('lending adds what people owe you and takes away what you owe, as of each point', () => {
  const lending = [
    lend('LEND', 400, day(2026, 10, 3)),
    lend('RECEIVE_REPAYMENT', 100, day(2026, 11, 2)),
    lend('BORROW', 50, day(2026, 9, 9)),
    lend('LEND', 7, day(2026, 11, 20)),
  ];
  const result = netWorth(
    { accounts: [cash], changes, lending, rate, mainCurrency: 'BDT', today },
    2,
  );
  const [series] = result.series;
  assert.deepEqual(series.accounts, [1500, 1500, 1300]);
  assert.deepEqual(series.withLending, [1450, 1850, 1550]);
  assert.deepEqual(series.lending, { oweYouMinor: 300, youOweMinor: 50 });
});

test('all history starts at the first month with activity', () => {
  const result = netWorth(
    { accounts: [cash], changes, lending: [], rate, mainCurrency: 'BDT', today },
    'all',
  );
  assert.equal(result.points[0].day, day(2026, 9, 30));
  assert.equal(result.points.length, 3);
  const empty = netWorth(
    { accounts: [cash], changes: [], lending: [], rate, mainCurrency: 'BDT', today },
    'all',
  );
  assert.deepEqual(
    empty.points.map((point) => point.day),
    [today],
  );
});

test('Net worth includes the Investment while the Liquid line includes the Credit Card', () => {
  const fund = { ...wise, kind: 'investment' };
  const creditCard = { ...card, kind: 'card' };
  const {
    series: [series],
  } = netWorth(
    { accounts: [cash, creditCard, fund], changes, lending: [], rate, mainCurrency: 'BDT', today },
    1,
  );
  assert.deepEqual(series.accounts, [2700, 2500]);
  assert.deepEqual(series.liquidNet, [1200, 1000]);
  assert.deepEqual(series.composition, { liquid: 1300, investment: 1500, card: -300 });
});
