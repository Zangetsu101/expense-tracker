import assert from 'node:assert/strict';
import test from 'node:test';
import { changeMark, currencyTotals, hasChildren, scopeCurrencies } from './report-presentation.ts';

const accounts = [
  { id: 1, currencyCode: 'BDT' },
  { id: 2, currencyCode: 'BDT' },
  { id: 3, currencyCode: 'USD' },
  { id: 4, currencyCode: 'EUR' },
];
const spend = (categoryId, categoryName, topId, topName, amountMinor, currencyCode = 'BDT') => ({
  categoryId,
  categoryName,
  topId,
  topName,
  amountMinor,
  currencyCode,
});

test('the Currencies in scope put the main Currency first', () => {
  assert.deepEqual(scopeCurrencies(accounts, undefined, 'USD'), ['USD', 'BDT', 'EUR']);
  assert.deepEqual(scopeCurrencies(accounts, 2, 'USD'), ['BDT']);
  assert.deepEqual(scopeCurrencies(accounts, 99, 'USD'), []);
});

test('the totals of one Currency roll children up into parent Categories', () => {
  const totals = currencyTotals(
    {
      summaries: [
        { currencyCode: 'BDT', incomeMinor: 2000, expenseMinor: 1000 },
        { currencyCode: 'USD', incomeMinor: 0, expenseMinor: 50 },
      ],
      spending: [
        spend(11, 'Groceries', 1, 'Food', 300),
        spend(1, 'Food', 1, 'Food', 100),
        spend(12, 'Coffee', 1, 'Food', 200),
        spend(2, 'Rent', 2, 'Rent', 350),
        spend(null, null, null, null, 50),
        spend(3, 'Other', 3, 'Other', 50, 'USD'),
        spend(4, 'Zero', 4, 'Zero', 0),
      ],
    },
    'BDT',
  );
  assert.equal(totals.netMinor, 1000);
  assert.deepEqual(
    totals.categories.map((row) => [row.name, row.amountMinor, row.share]),
    [
      ['Food', 600, 60],
      ['Rent', 350, 35],
      [null, 50, 5],
    ],
  );
  assert.deepEqual(
    totals.categories[0].children.map((row) => [row.name, row.amountMinor, row.share]),
    [
      ['Groceries', 300, 30],
      ['Coffee', 200, 20],
      ['Food', 100, 10],
    ],
  );
  assert.equal(hasChildren(totals.categories[0]), true);
  assert.equal(hasChildren(totals.categories[1]), false);
  assert.equal(hasChildren(totals.categories[2]), false);
});

test('a parent Category with one child that is not itself has children', () => {
  assert.equal(hasChildren({ id: 1, children: [{ id: 5 }] }), true);
});

test('a Currency with no activity has zero totals', () => {
  assert.deepEqual(currencyTotals({ summaries: [], spending: [] }, 'EUR'), {
    currencyCode: 'EUR',
    incomeMinor: 0,
    expenseMinor: 0,
    netMinor: 0,
    categories: [],
  });
});

test('a marker shows a change of at least a fifth of usual', () => {
  assert.equal(changeMark(120, 100), 'up');
  assert.equal(changeMark(119, 100), null);
  assert.equal(changeMark(80, 100), 'down');
  assert.equal(changeMark(81, 100), null);
  assert.equal(changeMark(5, 0), 'up');
  assert.equal(changeMark(0, 0), null);
});
