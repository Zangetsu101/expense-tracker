import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPublishedUpdates, runtimeVersionFrom } from './runtime-version.mjs';

const hash = 'b2556f74e47c6886822ca323f2aeca08490c932d';
const output = (fields) => JSON.stringify({ fingerprintSources: [], ...fields });

test('accepts a fingerprint runtime version from the managed workflow', () => {
  assert.equal(
    runtimeVersionFrom({
      output: output({ runtimeVersion: hash, workflow: 'managed' }),
      androidIgnored: true,
    }),
    hash,
  );
});

test('rejects a checkout where Git does not ignore android/', () => {
  assert.throws(
    () =>
      runtimeVersionFrom({
        output: output({ runtimeVersion: hash, workflow: 'managed' }),
        androidIgnored: false,
      }),
    /ignore android/,
  );
});

test('rejects the generic workflow, which hashes android/', () => {
  assert.throws(
    () =>
      runtimeVersionFrom({
        output: output({ runtimeVersion: hash, workflow: 'generic' }),
        androidIgnored: true,
      }),
    /managed workflow/,
  );
});

test('rejects a runtime version that is not a fingerprint', () => {
  for (const runtimeVersion of ['0.2.0', null]) {
    assert.throws(
      () =>
        runtimeVersionFrom({
          output: output({ runtimeVersion, workflow: 'managed' }),
          androidIgnored: true,
        }),
      /fingerprint/,
    );
  }
});

test('accepts published updates that have the runtime version of the checkout', () => {
  const updates = [
    { id: 'a', runtimeVersion: hash },
    { id: 'b', runtimeVersion: hash },
  ];
  assert.doesNotThrow(() => checkPublishedUpdates(updates, hash));
});

test('rejects a published update with a different runtime version', () => {
  const updates = [{ id: 'a', runtimeVersion: '0.2.0' }];
  assert.throws(() => checkPublishedUpdates(updates, hash), /Update a has runtime version 0\.2\.0/);
});

test('rejects output that reports no published update', () => {
  assert.throws(() => checkPublishedUpdates([], hash), /did not report/);
});
