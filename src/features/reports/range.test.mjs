import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canStepForward,
  matchingShortcut,
  monthCycle,
  parseFiscalStart,
  rangeTitle,
  shortcutRange,
  stepRange,
} from './range.ts';

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const span = (a, b) => ({ start: a, end: b });
// Friday 13 November 2026.
const today = day(2026, 11, 13);
const plain = { monthStart: 1, fiscalStart: 6 };
const payday = { monthStart: 25, fiscalStart: 6 };

test('the month shortcuts follow the start day of the month', () => {
  assert.deepEqual(shortcutRange('month', today, plain), span(day(2026, 11, 1), day(2026, 12, 1)));
  assert.deepEqual(
    shortcutRange('lastMonth', today, plain),
    span(day(2026, 10, 1), day(2026, 11, 1)),
  );
  assert.deepEqual(
    shortcutRange('month', today, payday),
    span(day(2026, 10, 25), day(2026, 11, 25)),
  );
  assert.deepEqual(
    shortcutRange('lastMonth', today, payday),
    span(day(2026, 9, 25), day(2026, 10, 25)),
  );
  // On the start day itself, the new cycle begins.
  assert.deepEqual(monthCycle(day(2026, 11, 25), 25), span(day(2026, 11, 25), day(2026, 12, 25)));
  assert.deepEqual(monthCycle(day(2027, 1, 3), 25, 1), span(day(2026, 11, 25), day(2026, 12, 25)));
});

test('the year shortcuts use the first day of the first month', () => {
  assert.deepEqual(
    shortcutRange('fiscalYear', today, plain),
    span(day(2026, 7, 1), day(2027, 7, 1)),
  );
  assert.deepEqual(
    shortcutRange('lastFiscalYear', today, plain),
    span(day(2025, 7, 1), day(2026, 7, 1)),
  );
  assert.deepEqual(
    shortcutRange('fiscalYear', day(2026, 3, 2), plain),
    span(day(2025, 7, 1), day(2026, 7, 1)),
  );
  assert.deepEqual(shortcutRange('year', today, plain), span(day(2026, 1, 1), day(2027, 1, 1)));
  assert.deepEqual(shortcutRange('lastYear', today, plain), span(day(2025, 1, 1), day(2026, 1, 1)));
});

test('an arrow moves full months by their number of months', () => {
  const november = shortcutRange('month', today, plain);
  assert.deepEqual(stepRange(november, -1, plain), span(day(2026, 10, 1), day(2026, 11, 1)));
  const cycle = shortcutRange('month', today, payday);
  assert.deepEqual(stepRange(cycle, -1, payday), span(day(2026, 9, 25), day(2026, 10, 25)));
  const fiscal = shortcutRange('fiscalYear', today, plain);
  assert.deepEqual(stepRange(fiscal, -1, plain), span(day(2025, 7, 1), day(2026, 7, 1)));
  const quarter = span(day(2026, 1, 1), day(2026, 4, 1));
  assert.deepEqual(stepRange(quarter, 1, plain), span(day(2026, 4, 1), day(2026, 7, 1)));
  // Calendar months still move by months when the start day of the month is not 1.
  assert.deepEqual(stepRange(quarter, -1, payday), span(day(2025, 10, 1), day(2026, 1, 1)));
});

test('an arrow moves any other range by its number of days', () => {
  const tenDays = span(day(2026, 11, 3), day(2026, 11, 13));
  assert.deepEqual(stepRange(tenDays, -1, plain), span(day(2026, 10, 24), day(2026, 11, 3)));
  assert.deepEqual(stepRange(tenDays, 1, plain), span(day(2026, 11, 13), day(2026, 11, 23)));
});

test('the next arrow stops at the range that has today', () => {
  assert.equal(canStepForward(shortcutRange('month', today, plain), today), false);
  assert.equal(canStepForward(shortcutRange('lastMonth', today, plain), today), true);
  assert.equal(canStepForward(span(day(2026, 11, 3), day(2026, 11, 13)), today), true);
});

test('the title names the range and its dates', () => {
  assert.deepEqual(rangeTitle(shortcutRange('month', today, plain), today, plain), {
    name: 'November 2026',
    dates: '1 Nov – 30 Nov 2026 · in progress',
  });
  assert.deepEqual(rangeTitle(shortcutRange('month', today, payday), today, payday), {
    name: '25 Oct – 24 Nov 2026',
    dates: '31 days · in progress',
  });
  assert.deepEqual(rangeTitle(shortcutRange('fiscalYear', today, plain), today, plain), {
    name: 'FY 2026–27',
    dates: '1 Jul 2026 – 30 Jun 2027 · in progress',
  });
  assert.equal(rangeTitle(shortcutRange('lastYear', today, plain), today, plain).name, '2025');
  assert.deepEqual(rangeTitle(span(day(2025, 11, 1), day(2026, 2, 1)), today, plain), {
    name: 'Nov 2025 – Jan 2026',
    dates: '1 Nov 2025 – 31 Jan 2026',
  });
  assert.deepEqual(rangeTitle(span(day(2026, 11, 3), day(2026, 11, 13)), today, plain), {
    name: '3 Nov – 12 Nov 2026',
    dates: '10 days',
  });
  assert.equal(rangeTitle(span(today, today + 1), today, plain).dates, '1 day · in progress');
});

test('a range that a shortcut makes selects that shortcut', () => {
  assert.equal(
    matchingShortcut(shortcutRange('lastMonth', today, plain), today, plain),
    'lastMonth',
  );
  assert.equal(matchingShortcut(shortcutRange('year', today, plain), today, plain), 'year');
  assert.equal(matchingShortcut(span(day(2026, 11, 3), day(2026, 11, 13)), today, plain), null);
});

test('the first month of the fiscal year reads from a stored value', () => {
  assert.equal(parseFiscalStart('6'), 6);
  assert.equal(parseFiscalStart('0'), 0);
  assert.equal(parseFiscalStart('12'), 0);
  assert.equal(parseFiscalStart(null), 0);
  assert.equal(parseFiscalStart('x'), 0);
});
