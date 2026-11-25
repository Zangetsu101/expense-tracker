import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { adaptBackup, evaluate, rank, replay } from './category-prediction.mjs';

const categories = [
  { id: 1, name: 'Alpha', type: 'EXPENSE', needsReview: false },
  { id: 2, name: 'Beta', type: 'EXPENSE', needsReview: false },
  { id: 3, name: 'Income', type: 'INCOME', needsReview: false },
];
const row = (overrides = {}) => ({
  id: 1,
  day: 1,
  amountMinor: 100,
  type: 'EXPENSE',
  currency: 'USD',
  accountId: 1,
  categoryId: 1,
  ...overrides,
});
const query = row({ day: 10 });

test('ranking isolates future dates, same dates, Currency and mode', () => {
  const history = [
    row(),
    ...[{ day: 10 }, { day: 11 }, { currency: 'EUR' }, { type: 'INCOME' }].map((overrides, index) =>
      row({ id: index + 2, categoryId: 2, ...overrides }),
    ),
  ];
  for (const method of ['recent', 'frequency', 'amount']) {
    assert.deepEqual(rank(history, query, categories, method), [1, 2]);
  }
});

test('recent-first uses date then id, then SQLite NOCASE Category name and id', () => {
  assert.deepEqual(
    rank(
      [row({ id: 90, day: 1 }), row({ id: 2, day: 2, categoryId: 2 })],
      query,
      categories,
      'recent',
    ),
    [2, 1],
  );
  assert.deepEqual(
    rank(
      [row({ id: 90, day: 2 }), row({ id: 91, day: 2, categoryId: 2 })],
      query,
      categories,
      'recent',
    ),
    [2, 1],
  );
  assert.deepEqual(rank([], query, [...categories].reverse(), 'recent'), [1, 2]);
  assert.deepEqual(
    rank([], query, [{ id: 7, name: 'alpha', type: 'EXPENSE' }, categories[0]], 'recent'),
    [1, 7],
  );
});

test('amount affinity beats recent-first and frequency when repeated amounts identify a Category', () => {
  const history = [
    row({ day: 1 }),
    row({ id: 2, day: 2, categoryId: 2, amountMinor: 900 }),
    row({ id: 3, day: 3, categoryId: 2, amountMinor: 900 }),
  ];
  assert.equal(rank(history, query, categories, 'recent')[0], 2);
  assert.equal(rank(history, query, categories, 'frequency')[0], 2);
  assert.equal(rank(history, query, categories, 'amount')[0], 1);
});

test('amount ranker prefers selected Account but falls back within Currency', () => {
  const history = [row(), row({ id: 2, accountId: 2, categoryId: 2 })];
  assert.equal(rank(history, query, categories, 'amount')[0], 1);
  assert.equal(rank(history, { ...query, accountId: 3 }, categories, 'amount')[0], 2);
  assert.equal(rank([history[1]], query, categories, 'amount')[0], 2);
});

test('nearby amounts and recency affect ranking with explicit alternative weights', () => {
  const weights = { halfLife: 10, accountBoost: 1, exact: 8, nearby: 3 };
  const history = [row({ amountMinor: 1000 }), row({ id: 2, categoryId: 2, amountMinor: 105 })];
  assert.equal(rank(history, query, categories, 'amount', weights)[0], 2);
  const old = [row({ day: -100 }), row({ id: 2, day: 9, categoryId: 2, amountMinor: 900 })];
  assert.equal(rank(old, query, categories, 'amount', weights)[0], 2);
});

test('replay counts cold starts as misses/hits and never trains within a held-out date', () => {
  const rows = [
    row({ categoryId: 2 }),
    row({ id: 2, categoryId: 2 }),
    row({ id: 3, day: 2, categoryId: 2 }),
  ];
  const result = replay(rows, categories);
  assert.deepEqual(result.metrics['development/all/recent'], { n: 2, cold: 2, top1: 0, top3: 2 });
  assert.deepEqual(result.metrics['final/all/recent'], { n: 1, cold: 0, top1: 1, top3: 1 });
  assert.equal(result.split.final[0], '1970-01-03');
  assert.deepEqual(replay([rows[1], rows[0], rows[2]], categories), result);
});

function backup(transactions) {
  return JSON.stringify({
    schemaVersion: 1,
    accounts: [{ id: 1, currencyCode: 'USD' }],
    categories: [...categories, { id: 4, name: 'Loan', type: 'EXPENSE', needsReview: false }],
    transactions: transactions.map((overrides, index) => ({
      id: index + 1,
      type: 'EXPENSE',
      amountMinor: 100,
      dateEpochDay: index + 1,
      accountId: 1,
      categoryId: 1,
      source: 'IMPORT',
      transferAccountId: null,
      excludeFromReport: true,
      note: 'PRIVATE SENTINEL',
      ...overrides,
    })),
  });
}

test('adapter filters nonordinary and unusable labels while keeping report-excluded ordinary Transactions', () => {
  const result = adaptBackup(
    backup([
      {},
      { type: 'TRANSFER', transferAccountId: 1 },
      { categoryId: 999 },
      { categoryId: 3 },
      { amountMinor: 0 },
    ]),
  );
  assert.deepEqual(
    result.rows.map((row) => row.id),
    [1],
  );
  assert.deepEqual(result.provenance.excluded, {
    transfer_or_unknown_type: 1,
    missing_or_mismatched_category: 2,
    missing_or_invalid_metadata: 1,
  });
  assert.equal(JSON.stringify(result.rows).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(evaluate(backup([{}, {}]))).includes('PRIVATE'), false);
});

test('adapter reuses schema/integer validation and rejects duplicate IDs', () => {
  assert.throws(() => adaptBackup('{"schemaVersion":99}'), /schema version/);
  assert.throws(() => adaptBackup(backup([{ id: 1 }, { id: 1 }])), /duplicate/);
  assert.throws(
    () => adaptBackup(backup([{ amountMinor: 9007199254740992 }])),
    /integer too large/,
  );
});

test('the adapter refuses a backup with a missing Account or person', () => {
  assert.throws(() => adaptBackup(backup([{}, { accountId: 999 }])), /Transaction Account/);
  const data = JSON.parse(backup([{}]));
  data.people = [];
  data.lendingEntries = [
    {
      id: 1,
      personId: 7,
      kind: 'WRITE_OFF_LENT',
      transactionId: null,
      currencyCode: 'USD',
      amountMinor: 100,
      dateEpochDay: 1,
      note: null,
    },
  ];
  assert.throws(() => adaptBackup(JSON.stringify(data)), /lending metadata/);
});

test('linked Person movements are excluded even with ordinary Category labels', () => {
  const data = JSON.parse(backup([{}, {}]));
  data.transactions[0].note = null;
  data.transactions[0].transferAccountId = null;
  data.people = [{ id: 1, name: 'PRIVATE PERSON' }];
  data.lendingEntries = [
    {
      id: 1,
      personId: 1,
      kind: 'LEND',
      transactionId: 1,
      currencyCode: 'USD',
      amountMinor: 100,
      dateEpochDay: 1,
      note: null,
    },
  ];
  const result = adaptBackup(JSON.stringify(data));
  assert.equal(result.provenance.excluded.linked_person_movement, 1);
  assert.deepEqual(
    result.rows.map((item) => item.id),
    [2],
  );
});

test('the recent baseline uses linked lending history and the amount ranker skips it', () => {
  const data = JSON.parse(
    backup([{ categoryId: 1 }, { categoryId: 4, note: null }, { categoryId: 1 }]),
  );
  data.people = [{ id: 1, name: 'Sam' }];
  data.lendingEntries = [
    {
      id: 1,
      personId: 1,
      kind: 'LEND',
      transactionId: 2,
      currencyCode: 'USD',
      amountMinor: 100,
      dateEpochDay: 2,
      note: null,
    },
  ];
  const result = evaluate(JSON.stringify(data));
  assert.equal(result.metrics['final/all/recent'].top1, 0);
  assert.equal(result.metrics['final/all/amount'].top1, 1);
  assert.equal(result.metrics['final/all/amount'].cold, 0);
});

test('top-3 misses when the target falls beyond the third candidate', () => {
  const fourth = { id: 4, name: 'Zulu', type: 'EXPENSE', needsReview: false };
  const extra = { id: 5, name: 'Charlie', type: 'EXPENSE', needsReview: false };
  const result = replay(
    [row({ categoryId: 4 }), row({ id: 2, day: 2 })],
    [...categories, fourth, extra],
  );
  assert.deepEqual(result.metrics['development/all/recent'], { n: 1, cold: 1, top1: 0, top3: 0 });
});

test('the adapter reads a v2 backup as the v1 export of the same data', () => {
  const json = readFileSync(new URL('./fixtures/backup-v2.json', import.meta.url), 'utf8');
  const { rows, baselineRows, provenance } = adaptBackup(json);
  assert.deepEqual(rows, [
    {
      id: 1,
      type: 'EXPENSE',
      currency: 'BDT',
      accountId: 1,
      categoryId: 2,
      amountMinor: 1500,
      day: 20722,
    },
    {
      id: 2,
      type: 'INCOME',
      currency: 'BDT',
      accountId: 1,
      categoryId: 3,
      amountMinor: 90000,
      day: 20722,
    },
    {
      id: 7,
      type: 'EXPENSE',
      currency: 'BDT',
      accountId: 2,
      categoryId: 1,
      amountMinor: 2500,
      day: 20751,
    },
  ]);
  assert.deepEqual(
    baselineRows.map((row) => row.id),
    [1, 2, 7],
  );
  assert.equal(provenance.schemaVersion, 2);
  // A Write-off moves no money on an Account, so it is not a v1 Transaction.
  assert.deepEqual(provenance.raw, {
    accounts: 3,
    categories: 3,
    transactions: 6,
    lendingEntries: 2,
  });
  assert.deepEqual(provenance.sources, { MANUAL: 6 });
  assert.deepEqual(provenance.excluded, {
    transfer_or_unknown_type: 1,
    linked_person_movement: 1,
    missing_or_mismatched_category: 1,
  });
});
