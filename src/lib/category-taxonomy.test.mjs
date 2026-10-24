import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryPath, visibleTaxonomy } from './category-taxonomy.ts';

const items = [
  { id: 1, name: 'Food', type: 'EXPENSE', parentId: null },
  { id: 2, name: 'Groceries', type: 'EXPENSE', parentId: 1 },
  { id: 3, name: 'Vegetables', type: 'EXPENSE', parentId: 2 },
  { id: 4, name: 'Coffee', type: 'EXPENSE', parentId: 1 },
  { id: 5, name: 'Salary', type: 'INCOME', parentId: null },
];
const tree = nodes => nodes.map(node => [node.item.name, tree(node.children)]);

test('browse preserves recursive grouping and search reveals ancestor paths or matching subtrees', () => {
  assert.deepEqual(tree(visibleTaxonomy(items, 'EXPENSE', '')), [
    ['Food', [['Groceries', [['Vegetables', []]]], ['Coffee', []]]],
  ]);
  assert.equal(visibleTaxonomy(items, 'EXPENSE', '')[0].reveal, false);
  const matches = visibleTaxonomy(items, 'EXPENSE', ' VEGETABLES ');
  assert.deepEqual(tree(matches), [['Food', [['Groceries', [['Vegetables', []]]]]]]);
  assert.equal(matches[0].children[0].reveal, true);
  assert.deepEqual(tree(visibleTaxonomy(items, 'EXPENSE', 'groceries')), [
    ['Food', [['Groceries', [['Vegetables', []]]]]],
  ]);
  assert.deepEqual(visibleTaxonomy(items, 'EXPENSE', 'salary'), []);
  assert.deepEqual(visibleTaxonomy(items, 'INCOME', 'nothing'), []);
  assert.equal(categoryPath(items, items[2]), 'Food / Groceries / Vegetables');
});

test('orphaned, cross-type, and cyclic categories remain browsable without recursive loops', () => {
  const malformed = [
    { id: 1, name: 'Orphan', type: 'EXPENSE', parentId: 99 },
    { id: 2, name: 'Income', type: 'INCOME', parentId: null },
    { id: 3, name: 'Cross type', type: 'EXPENSE', parentId: 2 },
    { id: 4, name: 'Cycle A', type: 'EXPENSE', parentId: 5 },
    { id: 5, name: 'Cycle B', type: 'EXPENSE', parentId: 4 },
  ];
  assert.deepEqual(tree(visibleTaxonomy(malformed, 'EXPENSE', '')), [
    ['Orphan', []], ['Cross type', []], ['Cycle A', [['Cycle B', []]]],
  ]);
  assert.equal(categoryPath(malformed, malformed[0]), 'Orphan');
  assert.equal(categoryPath(malformed, malformed[2]), 'Cross type');
  assert.equal(categoryPath(malformed, malformed[3]), 'Cycle B / Cycle A');
});
