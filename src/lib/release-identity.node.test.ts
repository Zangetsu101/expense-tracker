import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(
  readFileSync(new URL('./release-identity.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const { releaseIdentity } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
const running = {
  version: '0.1.0',
  commit: '6742b15c3ec031c06a5721edbefd91933b42435a',
  platform: 'android',
  development: false,
  expoGo: false,
  isEnabled: true,
  updateId: 'running-update-id',
  createdAt: new Date('2026-11-05T00:00:00Z'),
  runtimeVersion: '0.1.0',
  channel: 'production',
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
};
test('running release includes full launch metadata and a short CI commit', () => {
  const result = releaseIdentity(running);
  assert.equal(result.summary, 'Version 0.1.0 · Release 6742b15');
  for (const value of [
    running.commit,
    running.updateId,
    '2026-11-05T00:00:00.000Z',
    'production',
    'Embedded launch: false',
    'Runtime version: 0.1.0',
  ])
    assert.ok(result.details.includes(value));
});
test('unstamped OTA uses running update ID; embedded fallback never borrows a pending ID', () => {
  assert.equal(
    releaseIdentity({ ...running, commit: null }).summary,
    'Version 0.1.0 · Update running-',
  );
  const result = releaseIdentity({
    ...running,
    commit: null,
    isEmbeddedLaunch: true,
    isEmergencyLaunch: true,
    emergencyLaunchReason: 'Failed launch',
  });
  assert.equal(result.summary, 'Version 0.1.0 · Embedded');
  assert.match(result.details, /Emergency launch: true\nEmergency reason: Failed launch/);
});
test('web, development, Expo Go, disabled updates and missing version are explicit', () => {
  for (const [change, label] of [
    [{ platform: 'web' }, 'Web'],
    [{ development: true }, 'Development'],
    [{ expoGo: true }, 'Development'],
    [{ isEnabled: false, commit: null }, 'Updates disabled'],
  ])
    assert.equal(releaseIdentity({ ...running, ...change }).summary, `Version 0.1.0 · ${label}`);
  assert.equal(
    releaseIdentity({ ...running, version: null, commit: 'bad', updateId: null }).summary,
    'Version unknown · OTA update',
  );
});
