import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const state = {
  interval: 'off',
  account: 'you@example.com',
  registered: false,
  available: true,
  platform: 'android',
  calls: [],
};
globalThis.__backupTaskTest = state;
const mocks = {
  'expo-router/entry': `if(typeof globalThis.__backupTaskTest.task!=='function')throw Error('Backup task must be defined before Router starts');`,
  'react-native': `export const Platform={get OS(){return globalThis.__backupTaskTest.platform}};`,
  'expo-background-task': `const s=globalThis.__backupTaskTest;
    export const BackgroundTaskResult={Success:1,Failed:2},BackgroundTaskStatus={Available:2,Restricted:1};
    export const getStatusAsync=async()=>s.available?2:1;
    export const registerTaskAsync=async(name,options)=>{s.calls.push(['register',name,options]);if(s.registrationFailure)throw Error('native failure');s.registered=true};
    export const unregisterTaskAsync=async(name)=>{s.calls.push(['unregister',name]);s.registered=false};`,
  'expo-task-manager': `const s=globalThis.__backupTaskTest;
    export const defineTask=(name,fn)=>{s.name=name;s.task=fn};
    export const isTaskRegisteredAsync=async()=>s.registered;
    export const isAvailableAsync=async()=>s.available;`,
  '@/lib/drive-backup-adapter': `const s=globalThis.__backupTaskTest;
    export const driveBackups={status:async()=>s,runDue:async(force)=>{s.calls.push(['run',force]);if(s.runFailure)throw Error('database failure');return s}};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier in mocks
      ? { url: `task-mock:${specifier}`, shortCircuit: true }
      : next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('task-mock:'))
      return { format: 'module', source: mocks[url.slice(10)], shortCircuit: true };
    if (url.endsWith('/backup-background-task.ts'))
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')),
        shortCircuit: true,
      };
    return next(url, context);
  },
});
// Loading the configured entry must register the task without mounting a route.
const { main } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
await import(main.startsWith('.') ? new URL(`../../${main}`, import.meta.url) : main);
const { reconcileBackupTask, changeBackups, runScheduledBackup, subscribeBackupSchedule } =
  await import('./backup-background-task.ts');

test('background registration follows saved preference and retries native failures', async () => {
  assert.equal(typeof state.task, 'function', 'headless task defined on module load');
  assert.equal(await reconcileBackupTask(), null);
  assert.equal(state.calls.length, 0);
  state.interval = 'daily';
  state.registrationFailure = true;
  assert.match(await reconcileBackupTask(), /Background scheduling failed/);
  state.registrationFailure = false;
  assert.equal(await reconcileBackupTask(), null);
  assert.deepEqual(state.calls.at(-1), ['register', state.name, { minimumInterval: 60 }]);
  state.calls = [];
  await reconcileBackupTask();
  assert.equal(state.calls.length, 0, 'does not register repeatedly');
  state.interval = 'off';
  await reconcileBackupTask();
  assert.deepEqual(state.calls.at(-1), ['unregister', state.name]);
  state.interval = 'daily';
  await reconcileBackupTask();
  state.account = null;
  await reconcileBackupTask();
  assert.deepEqual(state.calls.at(-1), ['unregister', state.name], 'Disconnect stops the task');
  state.account = 'you@example.com';
});

test('restriction is visible while foreground backups remain usable', async () => {
  state.interval = 'weekly';
  state.available = false;
  assert.match(await reconcileBackupTask(), /Overdue backups will run when you open/);
  let notifications = 0;
  const unsubscribe = subscribeBackupSchedule(() => notifications++);
  await runScheduledBackup(true);
  assert.deepEqual(state.calls.at(-1), ['run', true]);
  assert.equal(notifications, 1);
  await assert.rejects(
    changeBackups(async () => {
      throw new Error('sign-in failed');
    }),
    /sign-in failed/,
  );
  assert.equal(notifications, 2, 'failed operations also notify');
  unsubscribe();
  await runScheduledBackup();
  assert.equal(notifications, 2);
});

test('headless task reports success, write failures, database failures and task errors', async () => {
  assert.equal(await state.task({}), 1);
  state.lastError = { kind: 'auth', message: 'Access removed' };
  assert.equal(await state.task({}), 2);
  state.lastError = null;
  state.runFailure = true;
  assert.equal(await state.task({}), 2);
  state.runFailure = false;
  assert.equal(await state.task({ error: new Error('expired') }), 2);
  const calls = state.calls.length;
  state.platform = 'ios';
  assert.equal(await reconcileBackupTask(), null);
  assert.equal(await state.task({}), 2);
  assert.equal(state.calls.length, calls);
});

test.after(() => {
  hooks.deregister();
  delete globalThis.__backupTaskTest;
});
