import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoDay, monthCycle, monthEndDay, monthIndex, weekStart } from './periods.ts';

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const span = (a, b) => ({ start: a, end: b });

test('a month cycle starts on its day, in this month or the month before', () => {
  assert.deepEqual(monthCycle(day(2026, 11, 13), 1), span(day(2026, 11, 1), day(2026, 12, 1)));
  assert.deepEqual(monthCycle(day(2026, 11, 13), 25), span(day(2026, 10, 25), day(2026, 11, 25)));
  // On the start day itself, the new cycle begins.
  assert.deepEqual(monthCycle(day(2026, 11, 25), 25), span(day(2026, 11, 25), day(2026, 12, 25)));
  assert.deepEqual(monthCycle(day(2027, 1, 3), 25, 1), span(day(2026, 11, 25), day(2026, 12, 25)));
});

test('a week starts on Saturday', () => {
  // Friday 13 November 2026, Saturday 14 November 2026.
  assert.equal(weekStart(day(2026, 11, 13)), day(2026, 11, 7));
  assert.equal(weekStart(day(2026, 11, 14)), day(2026, 11, 14));
});

test('a month index counts calendar months, and its last day ends the month', () => {
  assert.equal(monthIndex(day(2026, 2, 28)), 2026 * 12 + 1);
  assert.equal(monthEndDay(2026 * 12 + 1), day(2026, 2, 28));
  assert.equal(monthEndDay(2024 * 12 + 1), day(2024, 2, 29));
  assert.equal(monthEndDay(2026 * 12 + 11), day(2026, 12, 31));
});

test('isoDay writes the date as YYYY-MM-DD', () => {
  assert.equal(isoDay(day(2026, 3, 9)), '2026-03-09');
});
