import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homePeriod, parsePeriodSetting, periodKey } from './period.ts';

const day = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
// Monday 9 November 2026.
const today = day(2026, 11, 9);

test('a month period runs from the 1st and compares with the same point last month', () => {
  const p = homePeriod({ range: 'month', monthStart: 1 }, today);
  assert.equal(p.start, day(2026, 11, 1));
  assert.equal(p.end, today + 1);
  assert.equal(p.previousStart, day(2026, 10, 1));
  assert.equal(p.previousSameEnd, day(2026, 10, 10), 'nine days of October');
  assert.equal(p.label, 'November');
  assert.equal(p.previousLabel, 'October');
  assert.equal(p.rolling, false);
});

test('a payday month starts on the set day, in this month or the month before', () => {
  const before = homePeriod({ range: 'month', monthStart: 25 }, today);
  assert.equal(before.start, day(2026, 10, 25));
  assert.equal(before.previousStart, day(2026, 9, 25));
  assert.equal(before.label, '25 Oct – 24 Nov');
  assert.equal(before.previousLabel, 'last cycle');
  const after = homePeriod({ range: 'month', monthStart: 5 }, today);
  assert.equal(after.start, day(2026, 11, 5));
  assert.equal(after.previousSameEnd, day(2026, 10, 10));
  const january = homePeriod({ range: 'month', monthStart: 25 }, day(2027, 1, 3));
  assert.equal(january.start, day(2026, 12, 25));
  assert.equal(january.previousStart, day(2026, 11, 25));
});

test('a week starts on Saturday', () => {
  const p = homePeriod({ range: 'week', monthStart: 1 }, today);
  assert.equal(p.start, day(2026, 11, 7));
  assert.equal(p.previousStart, day(2026, 10, 31));
  assert.equal(p.previousSameEnd, day(2026, 11, 3));
  assert.equal(p.label, 'Week of 7 Nov');
  assert.equal(p.previousLabel, 'last week');
  const saturday = homePeriod({ range: 'week', monthStart: 1 }, day(2026, 11, 7));
  assert.equal(saturday.start, day(2026, 11, 7));
});

test('the last 90 days compare with the full 90 days before', () => {
  const p = homePeriod({ range: '90d', monthStart: 1 }, today);
  assert.equal(p.start, today - 89);
  assert.equal(p.previousStart, today - 179);
  assert.equal(p.previousSameEnd, p.start);
  assert.equal(p.rolling, true);
  assert.equal(p.previousLabel, 'the 90 days before');
});

test('a year compares with the same point last year', () => {
  const p = homePeriod({ range: 'year', monthStart: 1 }, today);
  assert.equal(p.start, day(2026, 1, 1));
  assert.equal(p.previousStart, day(2025, 1, 1));
  assert.equal(p.previousSameEnd, day(2025, 11, 10));
  assert.equal(p.label, '2026');
  assert.equal(p.previousLabel, '2025');
});

test('the same point never runs past the start of the current period', () => {
  // 31 March: the previous month (February) is shorter than the elapsed days.
  const p = homePeriod({ range: 'month', monthStart: 1 }, day(2026, 3, 31));
  assert.equal(p.previousSameEnd, day(2026, 3, 1));
});

test('a saved setting is read safely and falls back to this month', () => {
  assert.deepEqual(parsePeriodSetting(null), { range: 'month', monthStart: 1 });
  assert.deepEqual(parsePeriodSetting('not json'), { range: 'month', monthStart: 1 });
  assert.deepEqual(parsePeriodSetting('{"range":"week","monthStart":25}'), {
    range: 'week',
    monthStart: 25,
  });
  assert.deepEqual(parsePeriodSetting('{"range":"decade","monthStart":40}'), {
    range: 'month',
    monthStart: 1,
  });
  assert.deepEqual(parsePeriodSetting('{"range":"year","monthStart":2.5}'), {
    range: 'year',
    monthStart: 1,
  });
});

test('the period key changes with the range and the month start', () => {
  assert.equal(periodKey({ range: 'month', monthStart: 1 }), 'month:1');
  assert.notEqual(
    periodKey({ range: 'month', monthStart: 1 }),
    periodKey({ range: 'month', monthStart: 25 }),
  );
});
