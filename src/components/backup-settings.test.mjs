import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const scenario = {};
globalThis.__backupUI = scenario;
const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const root = new URL('../../', import.meta.url);
const mocks = {
  '@/components/loading': `export const Skeleton='Skeleton';`,
  '@expo/ui': `import React from 'react'; export const Host='Host',Column='Column',Text='Text';export const Button=({label,onPress,children})=>React.createElement('Pressable',{accessibilityLabel:label,onPress},children);export const BottomSheet=({isPresented,children,...props})=>isPresented?React.createElement('BottomSheet',props,children):null;`,
  'react-native': `export const View='View',Text='Text',Pressable='Pressable',ActivityIndicator='ActivityIndicator';export const useWindowDimensions=()=>({width:390,height:844});export const Platform={get OS(){return globalThis.__backupUI.platform}};export const Alert={alert:(...args)=>globalThis.__backupUI.alerts.push(args)};`,
  '@/lib/backup-adapter': `export const backupStore={},backupDocuments={};`,
  '@/lib/backup': `const scenario=globalThis.__backupUI;export const exportBackup=async()=>{scenario.calls.push(['export']);return scenario.export()};export const restoreBackup=async(store,documents,confirm)=>{scenario.calls.push(['restore']);return scenario.restore(confirm)};`,
  '@/lib/backup-background-task': `const scenario=globalThis.__backupUI;
    export const subscribeBackupSchedule=(fn)=>{scenario.changed=fn;return ()=>{scenario.changed=null}};
    export const reconcileBackupTask=async()=>scenario.schedulerMessage;
    export const runScheduledBackup=async(force)=>{scenario.calls.push(['save',force]);await scenario.save();return {...scenario.schedule}};
    export const configureBackupSchedule=async(interval,directory)=>{scenario.calls.push(['configure',interval,directory]);scenario.schedule.interval=interval;scenario.schedule.directoryUri=directory??scenario.schedule.directoryUri;if(interval!=='off')await scenario.save();return {...scenario.schedule}};`,
  '@/lib/scheduled-backup-adapter': `const scenario=globalThis.__backupUI;
    export const scheduledBackups={status:()=>scenario.load()};
    export const chooseScheduledBackupFolder=async()=>{scenario.calls.push(['choose']);return scenario.pick()};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier in mocks) return { url: `backup-ui:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('@/')) {
      const stem = specifier.replace('@/', 'src/');
      return {
        url: new URL(`${stem}${specifier.startsWith('@/components/') ? '.tsx' : '.ts'}`, root).href,
        shortCircuit: true,
      };
    }
    return next(
      specifier,
      context.parentURL?.startsWith('backup-ui:')
        ? { ...context, parentURL: import.meta.url }
        : context,
    );
  },
  load(url, context, next) {
    if (url.startsWith('backup-ui:'))
      return { format: 'module', source: mocks[url.slice(10)], shortCircuit: true };
    if (url.startsWith(root.href) && /\.tsx?$/.test(url))
      return {
        format: 'module',
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        }).outputText,
      };
    return next(url, context);
  },
});
const { BackupSettings } = await import('./backup-settings.tsx');
let renderer;
const button = (label) =>
  renderer.root.findAllByType('Pressable').find((n) => n.props.accessibilityLabel === label);
const press = (label) =>
  act(async () => {
    button(label).props.onPress();
  });
const text = () =>
  renderer.root
    .findAllByType('Text')
    .map((n) => n.children.join(''))
    .join('\n');
const props = { disabled: false, onBusyChange: (busy) => (scenario.busy = busy) };
async function mount(initial = {}) {
  Object.assign(scenario, {
    platform: 'android',
    alerts: [],
    calls: [],
    busy: false,
    schedulerMessage: null,
    schedule: {
      interval: 'off',
      directoryUri: null,
      lastSuccess: null,
      lastError: null,
      files: [],
    },
    pick: async () => null,
    export: async () => 'content://copy',
    restore: async (confirm) => confirm('saved.json'),
  });
  scenario.load = async () => ({ ...scenario.schedule });
  scenario.save = async () => {
    scenario.schedule.lastError = null;
    scenario.schedule.lastSuccess = Date.now();
  };
  Object.assign(scenario, initial);
  await act(async () => {
    renderer = create(React.createElement(BackupSettings, props));
  });
}
const choose = (label) =>
  act(async () =>
    scenario.alerts
      .at(-1)[2]
      .find((b) => b.text === label)
      .onPress(),
  );
test('Backup settings', async (t) => {
  t.afterEach(async () => act(async () => renderer?.unmount()));
  t.after(() => {
    hooks.deregister();
    delete globalThis.__backupUI;
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });
  await t.test(
    'one compact group offers destination choices and supports a saved folder with schedule Off',
    async () => {
      await mount();
      scenario.schedule.directoryUri = 'content://provider/tree/primary%3ABackups';
      await act(async () => scenario.changed());
      assert.equal(button('Folder').props.accessibilityValue.text, 'Backups');
      assert.ok(!text().includes('Scheduled backups'));
      assert.ok(!text().includes('Back up now'));
      await press('Create backup');
      const labels = renderer.root
        .findAllByType('Pressable')
        .map((n) => n.props.accessibilityLabel);
      assert.ok(labels.indexOf('Backups') < labels.indexOf('Choose another location…'));
      await press('Backups');
      assert.deepEqual(scenario.calls, [['save', true]]);
      assert.equal(scenario.schedule.interval, 'off');
      assert.match(text(), /Last backup to folder:/);
      assert.doesNotMatch(text(), /Never/);
    },
  );
  await t.test('extra copies preserve the saved folder and its recovery point', async () => {
    await mount({
      schedule: {
        interval: 'daily',
        directoryUri: 'content://provider/tree/primary%3ABackups',
        lastSuccess: 12345,
        lastError: null,
        files: [],
      },
    });
    await press('Create backup');
    await press('Choose another location…');
    assert.match(text(), /Extra copy saved elsewhere/);
    assert.equal(scenario.schedule.directoryUri, 'content://provider/tree/primary%3ABackups');
    assert.equal(scenario.schedule.lastSuccess, 12345);
    assert.deepEqual(scenario.calls, [['export']]);
  });
  await t.test(
    'schedule setup cancellation keeps Off; choosing a folder enables the requested interval',
    async () => {
      await mount();
      await press('Schedule');
      await press('Daily');
      assert.deepEqual(scenario.calls, [['choose']]);
      assert.equal(button('Schedule').props.accessibilityValue.text, 'Off');
      scenario.pick = async () => 'content://chosen';
      await press('Schedule');
      await press('Weekly');
      assert.deepEqual(scenario.calls.at(-1), ['configure', 'weekly', 'content://chosen']);
      assert.equal(button('Schedule').props.accessibilityValue.text, 'Weekly');
    },
  );
  await t.test(
    'folder stays editable with schedule Off and selecting it does not enable scheduling',
    async () => {
      await mount();
      scenario.pick = async () => 'content://provider/tree/primary%3ABackups';
      await press('Folder');
      assert.deepEqual(scenario.calls, [
        ['choose'],
        ['configure', 'off', 'content://provider/tree/primary%3ABackups'],
      ]);
      assert.equal(button('Schedule').props.accessibilityValue.text, 'Off');
    },
  );
  await t.test(
    'folder failures mark Folder and cancellation preserves the failure and last success',
    async () => {
      await mount({
        schedule: {
          interval: 'off',
          directoryUri: 'content://provider/tree/primary%3ABackups',
          lastSuccess: 12345,
          lastError: 'Permission revoked',
          files: [],
        },
      });
      assert.equal(button('Folder').props.accessibilityValue.text, 'Needs attention');
      assert.match(text(), /Choose a folder to restore access/);
      await press('Folder');
      assert.equal(button('Folder').props.accessibilityValue.text, 'Needs attention');
      assert.equal(scenario.schedule.lastSuccess, 12345);
      scenario.pick = async () => 'content://provider/tree/primary%3ABackups';
      await press('Folder');
      assert.deepEqual(scenario.calls.at(-1), ['save', true]);
      assert.equal(button('Folder').props.accessibilityValue.text, 'Backups');
      assert.doesNotMatch(text(), /Backup couldn’t be saved/);
    },
  );
  await t.test(
    'storage failures mark Folder; interrupted writes mark Create backup until retry succeeds',
    async () => {
      await mount({
        schedule: {
          interval: 'daily',
          directoryUri: 'content://provider/tree/primary%3ABackups',
          lastSuccess: 12345,
          lastError: 'ENOSPC: no space left',
          files: [],
        },
      });
      assert.match(text(), /Choose a folder with available space/);
      scenario.schedule.lastError = 'Backup verification failed.';
      await act(async () => scenario.changed());
      assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
      assert.equal(button('Folder').props.accessibilityValue.text, 'Backups');
      scenario.save = async () => {};
      await press('Create backup');
      assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
      assert.equal(scenario.schedule.lastSuccess, 12345);
      scenario.save = async () => {
        scenario.schedule.lastError = null;
        scenario.schedule.lastSuccess = Date.now();
      };
      await press('Create backup');
      assert.equal(button('Create backup').props.accessibilityValue, undefined);
    },
  );
  await t.test(
    'an extra-copy failure retries that export; cancellation does not clear it',
    async () => {
      await mount();
      scenario.export = async () => {
        throw Error('Permission denied in extra-copy folder');
      };
      await press('Create backup');
      await press('Choose a location…');
      assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
      assert.notEqual(button('Folder').props.accessibilityValue.text, 'Needs attention');
      scenario.export = async () => null;
      await press('Create backup');
      assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
      scenario.export = async () => 'copy';
      await press('Create backup');
      assert.equal(button('Create backup').props.accessibilityValue, undefined);
      assert.equal(scenario.calls.filter((c) => c[0] === 'save').length, 0);
    },
  );
  for (const error of ['Permission revoked', 'Write interrupted']) {
    await t.test(
      `a newer saved-folder failure replaces an older extra-copy failure: ${error}`,
      async () => {
        await mount({
          schedule: {
            interval: 'daily',
            directoryUri: 'content://provider/tree/primary%3ABackups',
            lastSuccess: 12345,
            lastError: null,
            files: [],
          },
        });
        scenario.export = async () => {
          throw Error('Extra-copy write interrupted');
        };
        await press('Create backup');
        await press('Choose another location…');
        scenario.pick = async () => 'content://provider/tree/primary%3ABackups';
        scenario.save = async () => {
          scenario.schedule.lastError = error;
        };
        await press('Folder');
        if (error === 'Permission revoked') {
          assert.equal(button('Folder').props.accessibilityValue.text, 'Needs attention');
          assert.equal(button('Create backup').props.accessibilityValue, undefined);
          scenario.pick = async () => null;
          await press('Folder');
          assert.equal(button('Folder').props.accessibilityValue.text, 'Needs attention');
          assert.equal(scenario.schedule.lastSuccess, 12345);
        } else {
          assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
          await press('Create backup');
          assert.deepEqual(scenario.calls.at(-1), ['save', true]);
        }
        assert.equal(scenario.calls.filter((call) => call[0] === 'export').length, 1);
      },
    );
  }
  await t.test(
    'background attempts replace stale extra-copy errors even when the saved-folder error text is unchanged',
    async () => {
      await mount({
        schedule: {
          interval: 'daily',
          directoryUri: 'content://provider/tree/primary%3ABackups',
          lastSuccess: 12345,
          lastError: 'Permission revoked',
          attempt: 1,
          files: [],
        },
      });
      scenario.export = async () => {
        throw Error('Extra-copy write interrupted');
      };
      await press('Create backup');
      await press('Choose another location…');
      assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
      await act(async () => scenario.changed());
      assert.equal(
        button('Create backup').props.accessibilityValue.text,
        'Retry',
        'no new attempt must not replace the latest error',
      );
      scenario.schedule.attempt = 2;
      await act(async () => scenario.changed());
      assert.equal(button('Folder').props.accessibilityValue.text, 'Needs attention');
      assert.equal(button('Create backup').props.accessibilityValue, undefined);
    },
  );
  await t.test('turning scheduling Off does not dismiss an extra-copy failure', async () => {
    await mount();
    scenario.export = async () => {
      throw Error('Write interrupted');
    };
    await press('Create backup');
    await press('Choose a location…');
    await press('Schedule');
    await press('Off');
    assert.equal(button('Create backup').props.accessibilityValue.text, 'Retry');
    assert.match(text(), /Backup couldn’t be saved/);
  });
  await t.test('pending saves lock all four rows and report busy to the parent', async () => {
    await mount({
      schedule: {
        interval: 'daily',
        directoryUri: 'content://provider/tree/primary%3ABackups',
        lastSuccess: 12345,
        lastError: null,
        files: [],
      },
    });
    let finish;
    scenario.save = () => new Promise((resolve) => (finish = resolve));
    await press('Create backup');
    await press('Backups');
    assert.equal(scenario.busy, true);
    for (const label of ['Create backup', 'Restore from file', 'Schedule', 'Folder'])
      assert.equal(button(label).props.disabled, true);
    assert.match(text(), /Saving backup/);
    await press('Folder');
    assert.equal(scenario.calls.length, 1);
    await act(async () => finish());
    assert.equal(scenario.busy, false);
  });
  await t.test(
    'restore confirms the selected filename, preserves cancellation, and retries on the affected row',
    async () => {
      await mount();
      await press('Restore from file');
      assert.match(scenario.alerts.at(-1)[1], /saved.json/);
      await choose('Cancel');
      assert.doesNotMatch(text(), /has been replaced/);
      scenario.restore = async () => {
        throw Error('Invalid backup');
      };
      await press('Restore from file');
      assert.equal(button('Restore from file').props.accessibilityValue.text, 'Retry');
      assert.match(text(), /Current data was kept/);
      scenario.restore = async (confirm) => confirm('other.json');
      await press('Restore from file');
      await choose('Replace data');
      assert.match(text(), /Current data has been replaced/);
      assert.equal(button('Restore from file').props.accessibilityValue, undefined);
    },
  );
  await t.test(
    'initial read only defers Schedule and Folder; a failed read can retry in place',
    async () => {
      let resolveLoad;
      await mount({ load: () => new Promise((resolve) => (resolveLoad = resolve)) });
      assert.equal(button('Schedule').props.disabled, true);
      assert.equal(button('Folder').props.disabled, true);
      assert.equal(button('Create backup').props.disabled, false);
      assert.equal(button('Restore from file').props.disabled, false);
      await act(async () => resolveLoad({ ...scenario.schedule }));
      scenario.load = async () => {
        throw Error('db unavailable');
      };
      await act(async () => scenario.changed());
      assert.equal(button('Schedule').props.accessibilityValue.text, 'Retry');
      scenario.load = async () => ({ ...scenario.schedule });
      await press('Schedule');
      assert.equal(button('Schedule').props.accessibilityValue.text, 'Off');
    },
  );
  await t.test(
    'retention failure reports a saved backup and foreground restriction stays a short footer',
    async () => {
      await mount({
        schedule: {
          interval: 'daily',
          directoryUri: 'content://provider/tree/primary%3ABackups',
          lastSuccess: 12345,
          lastError: 'Backup saved, but an older backup could not be removed.',
          files: [],
        },
      });
      assert.equal(button('Folder').props.accessibilityValue.text, 'Needs attention');
      assert.match(text(), /Backup saved. Older backups couldn’t be removed/);
      assert.doesNotMatch(text(), /Backup couldn’t be saved/);
      scenario.schedule.lastError = null;
      scenario.schedulerMessage = 'Background backups are unavailable';
      await act(async () => scenario.changed());
      assert.match(text(), /Automatic backups run when you open the app/);
      assert.doesNotMatch(text(), /Background backups are unavailable/);
    },
  );
});
