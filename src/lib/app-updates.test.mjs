import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUpdateController, UPDATE_COOLDOWN, watchUpdateLifecycle } from './app-updates.ts';

const idle = {
  isChecking: false,
  isDownloading: false,
  isStartupProcedureRunning: false,
  isUpdatePending: false,
  isRestarting: false,
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(supported = true) {
  const calls = [];
  let time = 100;
  const api = {
    check: async () => {
      calls.push('check');
      return { isAvailable: false };
    },
    fetch: async () => {
      calls.push('fetch');
      return { isNew: true };
    },
    reload: async () => {
      calls.push('reload');
    },
  };
  const controller = createUpdateController(supported, api, () => time);
  controller.sync(idle);
  return {
    controller,
    api,
    calls,
    advance: () => {
      time += UPDATE_COOLDOWN;
    },
  };
}
test('manual checks bypass automatic cooldown; foreground failures are quiet and throttled', async () => {
  const { controller, api, calls, advance } = fixture();
  api.check = async () => {
    calls.push('check');
    throw Error('offline');
  };
  await controller.check();
  assert.equal(controller.getSnapshot().status, 'idle');
  await controller.check();
  assert.equal(calls.length, 1);
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.match(controller.getSnapshot().error, /connection/);
  api.check = async () => ({ isAvailable: false });
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'current');
  advance();
  await controller.check();
  assert.equal(controller.getSnapshot().status, 'current');
});
test('serializes checks and downloads and never reloads until explicitly requested', async () => {
  const { controller, api, calls } = fixture();
  const check = deferred(),
    download = deferred();
  api.check = () => {
    calls.push('check');
    return check.promise;
  };
  api.fetch = () => {
    calls.push('fetch');
    return download.promise;
  };
  const running = controller.check(true);
  assert.equal(controller.getSnapshot().status, 'checking');
  await controller.check(true);
  await controller.restart();
  assert.deepEqual(calls, ['check']);
  check.resolve({ isAvailable: true });
  await Promise.resolve();
  assert.equal(controller.getSnapshot().status, 'downloading');
  controller.sync({ ...idle, isDownloading: true, downloadProgress: 0.42 });
  assert.equal(controller.getSnapshot().progress, 0.42);
  await controller.check(true);
  await controller.restart();
  download.resolve({ isNew: true });
  await running;
  controller.sync({ ...idle, isUpdatePending: true });
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(calls, ['check', 'fetch']);
  await controller.check(true);
  await controller.restart();
  assert.deepEqual(calls, ['check', 'fetch', 'reload']);
});
test('cached pending updates and native startup work take precedence', async () => {
  const { controller, calls } = fixture();
  controller.sync({ ...idle, isStartupProcedureRunning: true });
  await controller.check(true);
  controller.sync({ ...idle, isDownloading: true });
  await controller.check(true);
  assert.deepEqual(calls, []);
  controller.sync({ ...idle, isUpdatePending: true });
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(calls, []);
});
test('startup check timestamp prevents immediate duplicate request', async () => {
  const { controller, calls, advance } = fixture();
  controller.sync({ ...idle, lastCheckForUpdateTimeSinceRestart: new Date(100) });
  await controller.check();
  assert.deepEqual(calls, []);
  advance();
  await controller.check();
  assert.deepEqual(calls, ['check']);
});
test('unsupported runtimes never invoke update APIs', async () => {
  const { controller, calls } = fixture(false);
  controller.sync({ ...idle, isUpdatePending: true });
  await controller.check(true);
  await controller.restart();
  assert.equal(controller.getSnapshot().status, 'unsupported');
  assert.deepEqual(calls, []);
});
test('download failure retries; reload failure keeps downloaded update available', async () => {
  const { controller, api } = fixture();
  api.check = async () => ({ isAvailable: true });
  api.fetch = async () => {
    throw Error('offline');
  };
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'error');
  api.fetch = async () => ({ isNew: true });
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'ready');
  api.reload = async () => {
    throw Error('reload');
  };
  await controller.restart();
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.match(controller.getSnapshot().error, /restart/);
});
test('rollback directives are fetched and require explicit restart too', async () => {
  const { controller, api, calls } = fixture();
  api.check = async () => ({ isAvailable: false, isRollBackToEmbedded: true });
  api.fetch = async () => ({ isNew: false, isRollBackToEmbedded: true });
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(calls, []);
});
test('a no-longer-new fetch does not falsely offer restart', async () => {
  const { controller, api } = fixture();
  api.check = async () => ({ isAvailable: true });
  api.fetch = async () => ({ isNew: false });
  await controller.check(true);
  assert.equal(controller.getSnapshot().status, 'current');
});
test('lifecycle checks on launch and transitions to active and removes listener', () => {
  let callback,
    checks = 0,
    removed = false;
  const cleanup = watchUpdateLifecycle(
    {
      currentState: 'active',
      addEventListener(event, fn) {
        assert.equal(event, 'change');
        callback = fn;
        return {
          remove() {
            removed = true;
          },
        };
      },
    },
    () => checks++,
  );
  assert.equal(checks, 1);
  callback('active');
  assert.equal(checks, 1);
  callback('inactive');
  callback('background');
  callback('active');
  assert.equal(checks, 2);
  cleanup();
  assert.equal(removed, true);
});
test('pending updates cannot restart during native startup or download activity', async () => {
  const { controller, calls } = fixture();
  for (const flag of ['isStartupProcedureRunning', 'isDownloading', 'isChecking', 'isRestarting']) {
    controller.sync({ ...idle, isUpdatePending: true, [flag]: true });
    await controller.restart();
    assert.deepEqual(calls, [], flag);
  }
  controller.sync({ ...idle, isUpdatePending: true });
  await controller.restart();
  assert.deepEqual(calls, ['reload']);
});
