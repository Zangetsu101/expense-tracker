import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planImportCategories } from './import-categories.ts';

test('classifies signed categories and ignores blank names and zero amounts', () => {
  assert.deepEqual(
    planImportCategories([
      { category: 'Food', amount: -12 },
      { category: 'Salary', amount: 100 },
      { category: ' ', amount: -1 },
      { category: 'Food', amount: 0 },
    ]).categories,
    [
      {
        name: 'Food',
        type: 'EXPENSE',
        needsConfirmation: false,
        expenseCount: 1,
        incomeCount: 0,
        parent: null,
      },
      {
        name: 'Salary',
        type: 'INCOME',
        needsConfirmation: false,
        expenseCount: 0,
        incomeCount: 1,
        parent: null,
      },
    ],
  );
});

test('Mixed Category requires confirmation instead of receiving both types', () => {
  const plan = planImportCategories([
    { category: 'Other', amount: -2 },
    { category: 'Other', amount: 4 },
    { category: 'Other', amount: 5 },
  ]);
  assert.deepEqual(plan.categories, [
    {
      name: 'Other',
      type: null,
      needsConfirmation: true,
      expenseCount: 1,
      incomeCount: 2,
      parent: null,
    },
  ]);
});

test('curated taxonomy places matching expense categories beneath their parents', () => {
  const plan = planImportCategories([
    { category: 'Taxi', amount: -10 },
    { category: 'Cashback / Rewards', amount: 3 },
  ]);
  assert.deepEqual(plan.categories, [
    {
      name: 'Transportation',
      type: 'EXPENSE',
      needsConfirmation: false,
      expenseCount: 0,
      incomeCount: 0,
      parent: null,
    },
    {
      name: 'Taxi',
      type: 'EXPENSE',
      needsConfirmation: false,
      expenseCount: 1,
      incomeCount: 0,
      parent: 'Transportation',
    },
    {
      name: 'Cashback / Rewards',
      type: 'INCOME',
      needsConfirmation: false,
      expenseCount: 0,
      incomeCount: 1,
      parent: null,
    },
  ]);
});
