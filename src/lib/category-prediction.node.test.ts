import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankCategoryIds, categoryContribution } from './category-prediction.ts';

const row = { categoryId: 2, accountId: 1, amountMinor: 10000, day: 100 };
test('measured scoring weights exact, nearby, account and age evidence', () => {
  assert.equal(categoryContribution(row, 10000, 1, 100), 18);
  assert.equal(categoryContribution(row, 10000, 1, 190), 9);
  assert.equal(categoryContribution(row, 10000, 2, 100), 9);
  assert.equal(categoryContribution(row, 20000, 2, 100), 1);
  assert.ok(categoryContribution(row, 10500, 2, 100) > 1);
});
test('ranks without mutating fallback order; ignores future and unavailable categories', () => {
  const ids = [1, 2, 3];
  assert.deepEqual(rankCategoryIds(ids, [row], 10000, 1, 100), [2, 1, 3]);
  assert.deepEqual(ids, [1, 2, 3]);
  assert.deepEqual(rankCategoryIds(ids, [row], 10000, 1, 99), ids);
  assert.deepEqual(rankCategoryIds(ids, [{ ...row, categoryId: 9 }], 10000, 1, 100), ids);
});
test('empty history, invalid amount and tied scores retain recent-first order', () => {
  assert.deepEqual(rankCategoryIds([3, 2], [], 10000, 1, 100), [3, 2]);
  assert.deepEqual(rankCategoryIds([3, 2], [row], 0, 1, 100), [3, 2]);
  assert.deepEqual(
    rankCategoryIds([3, 2], [row, { ...row, categoryId: 3 }], 10000, 1, 100),
    [3, 2],
  );
});
