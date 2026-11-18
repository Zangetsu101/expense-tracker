import assert from 'node:assert/strict';
import { test } from 'node:test';
import { median, moverRows, paceResult, periodsBack } from './usual-spending.ts';

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
// Friday 13 November 2026.
const today = day(2026, 11, 13);
const months = periodsBack('month', today, 1, 7);
const row = (date, amountMinor, extra = {}) => ({
  currencyCode: 'BDT',
  categoryId: 11,
  categoryName: 'Groceries',
  topId: 1,
  topName: 'Food',
  date,
  amountMinor,
  ...extra,
});
/** One Expense on the 5th and one on the 20th of each month before November 2026. */
const history = (early, late, from = 5) =>
  Array.from({ length: from }, (_, k) => [
    row(day(2026, 10 - k, 5), early[k]),
    row(day(2026, 10 - k, 20), late[k]),
  ]).flat();

test('periodsBack gives the current period first and then each period before it', () => {
  assert.deepEqual(months[0], { start: day(2026, 11, 1), end: day(2026, 12, 1) });
  assert.deepEqual(months[1], { start: day(2026, 10, 1), end: day(2026, 11, 1) });
  assert.equal(months.length, 8);
  const payday = periodsBack('month', today, 25, 1);
  assert.deepEqual(payday[0], { start: day(2026, 10, 25), end: day(2026, 11, 25) });
  // Weeks start on Saturday, as on Home. 13 November 2026 is a Friday.
  const weeks = periodsBack('week', today, 1, 1);
  assert.deepEqual(weeks[0], { start: day(2026, 11, 7), end: day(2026, 11, 14) });
  assert.deepEqual(weeks[1], { start: day(2026, 10, 31), end: day(2026, 11, 7) });
});

test('median takes the middle value, or the mean of the two middle values', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([100, 200, 300, 400, 500, 600]), 350);
  assert.equal(median([]), 0);
});

test('pace compares the period so far with the median of 6 periods at the same day', () => {
  const rows = [
    ...history([100, 200, 300, 400, 500, 600, 9999], [50, 50, 50, 50, 50, 50, 50], 7),
    row(day(2026, 11, 2), 500),
  ];
  const pace = paceResult(rows, months, today, 'BDT');
  assert.equal(pace.status, 'ready');
  assert.equal(pace.spentMinor, 500);
  assert.equal(pace.usualMinor, 350, 'the seventh month back is not part of usual');
  assert.equal(pace.usualFullMinor, 400);
  assert.equal(pace.periods, 6);
  assert.equal(pace.dayOfPeriod, 13);
  assert.equal(pace.length, 30);
  assert.equal(pace.projectedMinor, Math.round((500 / 13) * 30));
  assert.equal(pace.leftPerDayMinor, Math.round((400 - 500) / 17));
  assert.equal(pace.spent.length, 13);
  assert.equal(pace.spent[0], 0);
  assert.equal(pace.spent[12], 500);
  assert.equal(pace.usual.length, 30);
  assert.equal(pace.usual[3], 0, 'no month has spending before the 5th');
  assert.equal(pace.usual[4], 350);
  assert.equal(pace.usual[29], 400);
  assert.ok(pace.low[4] <= pace.usual[4] && pace.usual[4] <= pace.high[4]);
});

test('pace needs 3 full periods with Expenses, and counts empty periods after the first', () => {
  const two = paceResult(history([100, 200], [0, 0], 2), months, today, 'BDT');
  assert.deepEqual(two, { status: 'notEnough', spentMinor: 0, needed: 1 });
  // An empty month between months with Expenses counts as zero.
  const gap = [row(day(2026, 10, 5), 300), row(day(2026, 8, 5), 300)];
  const pace = paceResult(gap, months, today, 'BDT');
  assert.equal(pace.status, 'ready');
  assert.equal(pace.periods, 3);
  assert.equal(pace.usualMinor, 300);
});

test('pace counts only the chosen Currency', () => {
  const rows = [
    ...history([100, 100, 100], [0, 0, 0], 3),
    row(day(2026, 11, 2), 700, { currencyCode: 'USD' }),
  ];
  assert.equal(paceResult(rows, months, today, 'BDT').spentMinor, 0);
  assert.deepEqual(paceResult(rows, months, today, 'USD'), {
    status: 'notEnough',
    spentMinor: 700,
    needed: 3,
  });
});

test('movers roll children up into parent Categories and sort by the change', () => {
  const coffee = { categoryId: 12, categoryName: 'Coffee' };
  const doctor = { categoryId: 21, categoryName: 'Doctor', topId: 2, topName: 'Health' };
  const rows = [
    ...history([100, 100, 100], [0, 0, 0], 3),
    ...[10, 9, 8].map((m) => row(day(2026, m, 6), 40, coffee)),
    ...[10, 9, 8].map((m) => row(day(2026, m, 6), 200, doctor)),
    row(day(2026, 11, 2), 150),
    row(day(2026, 11, 3), 80, coffee),
    row(day(2026, 11, 4), 900, doctor),
    row(day(2026, 11, 20), 999, doctor),
  ];
  const movers = moverRows(rows, months, today, 'BDT', 'current');
  assert.equal(movers.status, 'ready');
  assert.deepEqual(
    movers.rows.map((r) => [r.name, r.nowMinor, r.usualMinor]),
    [
      ['Health', 900, 200],
      ['Food', 230, 140],
    ],
  );
  assert.deepEqual(
    movers.rows[1].children.map((r) => [r.name, r.id, r.nowMinor, r.usualMinor]),
    [
      ['Groceries', 11, 150, 100],
      ['Coffee', 12, 80, 40],
    ],
  );
  assert.equal(movers.totalNowMinor, 1130);
  assert.equal(movers.totalUsualMinor, 340);
});

test('movers for the last month compare the full month with the 6 months before it', () => {
  const rows = [
    ...history([100, 100, 100, 100], [0, 0, 0, 0], 4),
    row(day(2026, 10, 25), 300),
    row(day(2026, 11, 2), 5000),
  ];
  const movers = moverRows(rows, months, today, 'BDT', 'last');
  assert.equal(movers.status, 'ready');
  assert.deepEqual(
    movers.rows.map((r) => [r.name, r.nowMinor, r.usualMinor]),
    [['Food', 400, 100]],
  );
});

test('movers need 3 full periods with Expenses', () => {
  const movers = moverRows(history([100], [0], 1), months, today, 'BDT', 'current');
  assert.deepEqual(movers, { status: 'notEnough', needed: 2 });
});

test('an Expense with no Category is its own row', () => {
  const none = { categoryId: null, categoryName: null, topId: null, topName: null };
  const rows = [
    ...[10, 9, 8].map((m) => row(day(2026, m, 6), 40, none)),
    row(day(2026, 11, 2), 100, none),
  ];
  const movers = moverRows(rows, months, today, 'BDT', 'current');
  assert.deepEqual(
    movers.rows.map((r) => [r.id, r.name, r.nowMinor, r.usualMinor, r.children.length]),
    [[null, null, 100, 40, 1]],
  );
});
