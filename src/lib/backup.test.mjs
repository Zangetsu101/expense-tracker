import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeBackup, encodeBackup, restoreBackup } from './backup.ts';

const native = readFileSync(
  new URL('../../scripts/fixtures/native-shaped-backup-v1.json', import.meta.url),
  'utf8',
);

test('numeric backup encoding and decoding keep cumulative string slicing linear', () => {
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
    assert.equal(decodeBackup(encodeBackup(data)).transactions.length, 256);
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
  const restored = decodeBackup(encodeBackup(data));
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
      { personId: 99 },
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

test('native v1 backups without import keys remain readable', () => {
  const data = decodeBackup(native);
  assert.equal(data.moneyLoverImportRows, undefined);
  assert.equal(decodeBackup(encodeBackup(data)).moneyLoverImportRows, undefined);
});

test('import row keys survive a JSON roundtrip and restore', async () => {
  const original = decodeBackup(native);
  const transactionId = original.transactions[0].id;
  original.moneyLoverImportRows = [{ rowKey: 'moneylover:row:1', transactionId }];
  const json = encodeBackup(original);
  let replaced;
  const restored = await restoreBackup(
    {
      snapshot: async () => original,
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

test('invalid import metadata never reaches the replacement boundary', async () => {
  const backup = decodeBackup(native);
  backup.moneyLoverImportRows = [{ rowKey: 'orphan', transactionId: -1 }];
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
