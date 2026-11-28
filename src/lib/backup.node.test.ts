import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertCleanBackup } from './backup-v1.ts';
import { decodeBackup, encodeBackup, restoreBackup } from './backup.ts';

const native = readFileSync(
  new URL('../../scripts/fixtures/native-shaped-backup-v1.json', import.meta.url),
  'utf8',
);

test('numeric backup decoding and the clean check keep cumulative string slicing linear', () => {
  const data = decodeBackup(native);
  data.transactions = Array.from({ length: 256 }, (_, index) => ({
    ...data.transactions[0],
    id: index + 1,
  }));
  const json = JSON.stringify(data, null, 2);
  const originalSlice = String.prototype.slice;
  let slicedCharacters = 0;
  // Instrument string slicing to catch quadratic backup processing.
  // eslint-disable-next-line no-extend-native
  String.prototype.slice = function (...args) {
    const result = originalSlice.apply(this, args);
    slicedCharacters += result.length;
    return result;
  };
  try {
    assert.equal(decodeBackup(json).transactions.length, 256);
    assertCleanBackup(data);
  } finally {
    // eslint-disable-next-line no-extend-native -- Restore the instrumented method even on failure.
    String.prototype.slice = originalSlice;
  }
  assert.ok(
    slicedCharacters <= json.length * 8,
    `Sliced ${slicedCharacters} characters for a ${json.length}-character backup`,
  );
});

test('raw integer safety preserves numeric syntax and escaped string contents', () => {
  for (const token of ['9007199254740991', '-9007199254740991', '0', '-0']) {
    assert.doesNotThrow(() => decodeBackup(`{"schemaVersion":1,"extra":${token}}`));
  }
  for (const token of [
    '9007199254740992',
    '9007199254740993',
    '-9007199254740992',
    '-9007199254740993',
  ]) {
    assert.throws(() => decodeBackup(`{"schemaVersion":1,"extra":${token}}`), /integer too large/);
  }
  for (const token of [
    '1.25',
    '-0.5',
    '1e2',
    '1E+2',
    '-1e-2',
    '9007199254740993.0',
    '9007199254740993e0',
  ]) {
    assert.doesNotThrow(() => decodeBackup(`{"schemaVersion":1,"extra":${token}}`));
  }
  for (const token of ['1.25', '9007199254740993.0', '9007199254740993e0']) {
    assert.throws(
      () => decodeBackup(`{"schemaVersion":1,"accounts":[{"id":${token}}]}`),
      /not a safe integer/,
    );
  }
  assert.equal(decodeBackup('{"schemaVersion":1,"accounts":[{"id":1e2}]}').accounts[0].id, 100);
  const text = '9007199254740993 "quoted" \\ backslash';
  assert.doesNotThrow(() => decodeBackup(JSON.stringify({ schemaVersion: 1, extra: text })));
  assert.throws(
    () =>
      decodeBackup(`{"schemaVersion":1,"extra":${JSON.stringify(text)},"unsafe":9007199254740993}`),
    /integer too large/,
  );
  for (const token of ['01', '1.', '1e', '--1', '+1']) {
    assert.throws(() => decodeBackup(`{"schemaVersion":1,"extra":${token}}`), SyntaxError);
  }
});

test('people, linked principal and write-offs roundtrip without changing financial records', () => {
  const data = decodeBackup(native);
  data.people = [{ id: 1, name: 'Ada' }];
  data.lendingEntries = [
    {
      id: 1,
      personId: 1,
      kind: 'WRITE_OFF_LENT',
      transactionId: null,
      currencyCode: 'BDT',
      amountMinor: 50,
      dateEpochDay: 20000,
      note: null,
    },
  ];
  assertCleanBackup(data);
  const restored = decodeBackup(JSON.stringify(data));
  assert.deepEqual(restored.people, data.people);
  assert.deepEqual(restored.lendingEntries, data.lendingEntries);
  assert.deepEqual(restored.transactions, data.transactions);
});

test('invalid lending metadata is rejected before replacement', async () => {
  const base = decodeBackup(native);
  base.people = [{ id: 1, name: 'Ada' }];
  const entry = {
    id: 1,
    personId: 1,
    kind: 'WRITE_OFF_LENT',
    transactionId: null,
    currencyCode: 'BDT',
    amountMinor: 50,
    dateEpochDay: 20000,
    note: null,
  };
  const invalid = [
    { people: null },
    { people: [null] },
    { people: [{ id: 1, name: ' ' }] },
    {
      people: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'ada' },
      ],
    },
    { lendingEntries: {} },
    { lendingEntries: [null] },
    ...[
      { personId: 1.5 },
      { kind: 'OTHER' },
      { amountMinor: 0 },
      { currencyCode: '' },
      { dateEpochDay: 1.5 },
      { note: 7 },
      { transactionId: 999 },
      { kind: 'LEND' },
    ].map((patch) => ({ lendingEntries: [{ ...entry, ...patch }] })),
    { lendingEntries: [entry, entry] },
  ];
  for (const patch of invalid) {
    let replaced = false;
    await assert.rejects(
      () =>
        restoreBackup(
          {
            replace: async () => {
              replaced = true;
            },
          },
          {
            pickJsonDocument: async () => ({ uri: 'content://backup', name: 'saved.json' }),
            readText: async () => JSON.stringify({ ...base, lendingEntries: [entry], ...patch }),
          },
          async () => true,
        ),
      /backup|safe integer/,
    );
    assert.equal(replaced, false);
  }
});

test('a file can name a missing person, but the strict check refuses it', () => {
  const data = decodeBackup(native);
  data.people = [{ id: 1, name: 'Ada' }];
  const entry = {
    id: 1,
    personId: 99,
    kind: 'WRITE_OFF_LENT',
    transactionId: null,
    currencyCode: 'BDT',
    amountMinor: 50,
    dateEpochDay: 20000,
    note: null,
  };
  // The restore names the missing person and stops (backup-v1-restore.ts).
  const decoded = decodeBackup(JSON.stringify({ ...data, lendingEntries: [entry] }));
  assert.throws(() => assertCleanBackup(decoded), /lending metadata/);
});

test('a reimbursement without a person key is not a shop refund', () => {
  const data = JSON.parse(native);
  for (const reimbursement of [
    { transactionId: 102, expenseId: 100 },
    { transactionId: 102, expenseId: 100, personId: 0 },
  ])
    assert.throws(
      () => decodeBackup(JSON.stringify({ ...data, reimbursements: [reimbursement] })),
      /reimbursement link/,
    );
});

test('a reimbursement with an explicit null person is a shop refund', () => {
  const data = JSON.parse(native);
  // The payment must use the Currency of the Expense.
  data.transactions.find((row) => row.id === 102).accountId = 1;
  const refund = { transactionId: 102, expenseId: 100, personId: null };
  assert.deepEqual(
    decodeBackup(JSON.stringify({ ...data, reimbursements: [refund] })).reimbursements,
    [refund],
  );
});

test('a reimbursement person that is not a number is refused', () => {
  const data = JSON.parse(native);
  const reimbursement = { transactionId: 102, expenseId: 100, personId: 'x' };
  assert.throws(
    () => decodeBackup(JSON.stringify({ ...data, reimbursements: [reimbursement] })),
    /personId is not a safe integer/,
  );
});

test('a file can keep a received amount on an Expense, and the strict check refuses it', () => {
  const data = JSON.parse(native);
  data.transactions[0].receivedAmountMinor = 50;
  const decoded = decodeBackup(JSON.stringify(data));
  assert.throws(() => assertCleanBackup(decoded), /amount received/);
});

test('a file can keep a Transfer whose Accounts are missing, and the strict check refuses it', () => {
  const data = JSON.parse(native);
  data.transactions[1].accountId = 98;
  data.transactions[1].transferAccountId = 99;
  data.transactions[1].receivedAmountMinor = 100;
  const decoded = decodeBackup(JSON.stringify(data));
  assert.throws(() => assertCleanBackup(decoded), /Transaction Account/);
});

test('a received amount that is not positive is refused', () => {
  const data = JSON.parse(native);
  for (const amount of [0, -1]) {
    data.transactions[1].receivedAmountMinor = amount;
    assert.throws(() => decodeBackup(JSON.stringify(data)), /amount received/);
  }
});

test('a backup that the app writes needs the Accounts of each Transaction', () => {
  const data = decodeBackup(native);
  const transfer = data.transactions.find((row) => row.type === 'TRANSFER');
  for (const patch of [
    { id: data.transactions[0].id, accountId: 99 },
    { id: transfer.id, transferAccountId: 99 },
    { id: transfer.id, transferAccountId: null },
  ]) {
    const transactions = data.transactions.map((row) =>
      row.id === patch.id ? { ...row, ...patch } : row,
    );
    assert.throws(() => assertCleanBackup({ ...data, transactions }), /Transaction Account/);
  }
});

test('native v1 backups without import keys remain readable', () => {
  const data = decodeBackup(native);
  assert.equal(data.moneyLoverImportRows, undefined);
  assert.equal(decodeBackup(JSON.stringify(data)).moneyLoverImportRows, undefined);
});

test('import row keys survive a JSON roundtrip and restore', async () => {
  const original = decodeBackup(native);
  const transactionId = original.transactions[0].id;
  original.moneyLoverImportRows = [{ rowKey: 'moneylover:row:1', transactionId }];
  assertCleanBackup(original);
  const json = JSON.stringify(original);
  let replaced;
  const restored = await restoreBackup(
    {
      replace: async (data) => {
        replaced = data;
      },
    },
    {
      pickJsonDocument: async () => ({ uri: 'content://backup', name: 'saved.json' }),
      readText: async () => json,
    },
    async () => true,
  );
  assert.equal(restored, true);
  assert.deepEqual(replaced.moneyLoverImportRows, original.moneyLoverImportRows);
});

test('import rows of a deleted Transaction decode, but the strict check refuses them', () => {
  const backup = decodeBackup(native);
  backup.moneyLoverImportRows = [{ rowKey: 'orphan', transactionId: 999 }];
  assert.deepEqual(decodeBackup(JSON.stringify(backup)).moneyLoverImportRows, [
    { rowKey: 'orphan', transactionId: 999 },
  ]);
  assert.throws(() => assertCleanBackup(backup), /Invalid backup moneyLoverImportRows/);
});

test('invalid import metadata never reaches the replacement boundary', async () => {
  const backup = decodeBackup(native);
  backup.moneyLoverImportRows = [{ rowKey: '', transactionId: backup.transactions[0].id }];
  let replaced = false;
  await assert.rejects(
    () =>
      restoreBackup(
        {
          replace: async () => {
            replaced = true;
          },
        },
        {
          pickJsonDocument: async () => ({ uri: 'content://backup', name: 'saved.json' }),
          readText: async () => JSON.stringify(backup),
        },
        async () => true,
      ),
    /Invalid backup moneyLoverImportRows/,
  );
  assert.equal(replaced, false);
});

test('restore validates before confirmation and waits for consent before replacement', async () => {
  const events = [];
  let finish;
  const restoring = restoreBackup(
    {
      replace: async () => {
        events.push('replace');
      },
    },
    {
      pickJsonDocument: async () => {
        events.push('pick');
        return { uri: 'content://backup', name: 'saved.json' };
      },
      readText: async () => {
        events.push('read');
        return native;
      },
    },
    async (name) => {
      events.push(`confirm:${name}`);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['pick', 'read', 'confirm:saved.json']);
  finish(true);
  assert.equal(await restoring, true);
  assert.equal(events.at(-1), 'replace');
});

test('restore cancellation and invalid files never replace data', async () => {
  for (const scenario of ['picker cancelled', 'confirmation cancelled', 'invalid']) {
    let confirmations = 0;
    let replacements = 0;
    const restoring = restoreBackup(
      {
        replace: async () => {
          replacements++;
        },
      },
      {
        pickJsonDocument: async () =>
          scenario === 'picker cancelled' ? null : { uri: 'content://backup', name: 'saved.json' },
        readText: async () => (scenario === 'invalid' ? '{invalid' : native),
      },
      async () => {
        confirmations++;
        return false;
      },
    );
    if (scenario === 'invalid') await assert.rejects(restoring);
    else assert.equal(await restoring, false);
    assert.equal(replacements, 0);
    assert.equal(confirmations, scenario === 'confirmation cancelled' ? 1 : 0);
  }
});

test('received amounts are optional safe positive minor units on cross-Currency Transfers only', () => {
  const data = decodeBackup(native);
  const from = data.accounts[0];
  data.accounts.push({
    ...from,
    id: 9999,
    currencyCode: from.currencyCode === 'USD' ? 'BDT' : 'USD',
  });
  const transaction = {
    ...data.transactions[0],
    type: 'TRANSFER',
    accountId: from.id,
    transferAccountId: 9999,
    receivedAmountMinor: 100,
  };
  data.transactions = [transaction];
  assertCleanBackup(data);
  assert.equal(decodeBackup(JSON.stringify(data)).transactions[0].receivedAmountMinor, 100);
  for (const receivedAmountMinor of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    transaction.receivedAmountMinor = receivedAmountMinor;
    assert.throws(() => assertCleanBackup(data), /received|safe integer/);
  }
  transaction.receivedAmountMinor = 100;
  transaction.type = 'EXPENSE';
  assert.throws(() => assertCleanBackup(data), /amount received/);
  transaction.type = 'TRANSFER';
  data.accounts.at(-1).currencyCode = from.currencyCode;
  assert.throws(() => assertCleanBackup(data), /amount received/);
  delete transaction.receivedAmountMinor;
  assert.doesNotThrow(() => assertCleanBackup(data));
});

const v2 = readFileSync(new URL('../../scripts/fixtures/backup-v2.json', import.meta.url), 'utf8');

test('a v2 file decodes, and encode then decode gives the same data', () => {
  const data = decodeBackup(v2);
  assert.equal(data.schemaVersion, 2);
  assert.deepEqual(data, JSON.parse(v2));
  assert.deepEqual(decodeBackup(encodeBackup(data)), data);
});

test('encode writes only v2, so it refuses a v1 backup', () => {
  assert.throws(
    () => encodeBackup(decodeBackup(native)),
    /Unknown backup field transferCandidates/,
  );
});

test('a v2 file with a wrong structure is refused before any change', async (t) => {
  const broken = (change) => {
    const data = JSON.parse(v2);
    change(data);
    return () => decodeBackup(JSON.stringify(data));
  };
  const cases = [
    [(data) => delete data.legs, /Invalid backup legs/],
    [(data) => (data.legs = {}), /Invalid backup legs/],
    [(data) => (data.extra = []), /Unknown backup field extra/],
    [(data) => (data.legs[0].id = 1), /Invalid backup legs row 1: id/],
    [(data) => delete data.legs[0].personId, /Invalid backup legs row 1: personId/],
    [(data) => (data.legs[0].amountMinor = 1.5), /Invalid backup legs row 1: amountMinor/],
    [(data) => (data.legs[0].accountId = '1'), /Invalid backup legs row 1: accountId/],
    [(data) => (data.transactions[0].kind = 'LEND'), /Invalid backup transactions row 1: kind/],
    [
      (data) => (data.transactions[3].direction = 'OUT'),
      /Invalid backup transactions row 4: direction/,
    ],
    [
      (data) => (data.transactions[0].excludeFromReport = 0),
      /Invalid backup transactions row 1: excludeFromReport/,
    ],
    [(data) => (data.categories[0].type = 'TRANSFER'), /Invalid backup categories row 1: type/],
    [(data) => (data.accounts[0].currencyCode = 'taka'), /Invalid backup accounts row 1/],
    [(data) => (data.legs[0].currencyCode = 'bdt'), /Invalid backup legs row 1: currencyCode/],
    [(data) => (data.lineItems[0].quantity = '2'), /Invalid backup lineItems row 1: quantity/],
    [(data) => data.accounts.push(data.accounts[0]), /Duplicate backup accounts row 4/],
    [
      (data) => data.transactionTags.push(data.transactionTags[0]),
      /Duplicate backup transactionTags row 3/,
    ],
    [(data) => (data.settings = null), /Invalid backup settings/],
    [(data) => (data.settings.favoriteAccountId = '1'), /Invalid backup settings/],
    [(data) => (data.settings.displayRate.rate = 0), /Invalid backup settings/],
    [(data) => (data.settings.displayRate.source = 'bank'), /Invalid backup settings/],
    [(data) => (data.settings.theme = 'dark'), /Invalid backup settings/],
  ];
  for (const [index, [change, error]] of cases.entries())
    await t.test(`case ${index + 1}: ${error}`, () => assert.throws(broken(change), error));
  assert.throws(
    () => decodeBackup(v2.replace('"amountMinor": -1500', '"amountMinor": -9007199254740993')),
    /integer too large/,
  );
});

test('a backup with a schema version after 3 is refused', () => {
  assert.throws(() => decodeBackup('{"schemaVersion":4}'), /Unsupported backup schema version/);
});
