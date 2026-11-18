export type NativeUpdateState = {
  isChecking: boolean;
  isDownloading: boolean;
  isStartupProcedureRunning: boolean;
  isUpdatePending: boolean;
  downloadedUpdate?: { updateId?: string };
  isRestarting: boolean;
  downloadProgress?: number;
  lastCheckForUpdateTimeSinceRestart?: Date;
};
export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'current'
  | 'ready'
  | 'restarting'
  | 'error';
export type UpdateState = { status: UpdateStatus; error?: string; progress?: number };
type UpdateAPI = {
  check: () => Promise<{
    isAvailable: boolean;
    isRollBackToEmbedded?: boolean;
    manifest?: { id?: string };
  }>;
  fetch: () => Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>;
  reload: () => Promise<void>;
};
export const UPDATE_COOLDOWN = 30 * 60 * 1000;

export function createUpdateController(supported: boolean, api: UpdateAPI, now = Date.now) {
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported' };
  let native: NativeUpdateState;
  let busy = false;
  let lastAttempt: number | undefined;
  let focusCheckPending = false;
  const listeners = new Set<() => void>();
  const set = (next: UpdateState) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  const nativeBusy = () =>
    native &&
    (native.isChecking ||
      native.isDownloading ||
      native.isStartupProcedureRunning ||
      native.isRestarting);
  const checkAfterSettling = () => {
    if (focusCheckPending && !busy && !nativeBusy()) void controller.check('focus');
  };
  const controller = {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    sync(next: NativeUpdateState) {
      native = next;
      if (!supported) return;
      if (next.lastCheckForUpdateTimeSinceRestart)
        lastAttempt = Math.max(lastAttempt ?? 0, next.lastCheckForUpdateTimeSinceRestart.getTime());
      if (next.isRestarting) set({ status: 'restarting' });
      else if (next.isDownloading) set({ status: 'downloading', progress: next.downloadProgress });
      else if (next.isChecking || next.isStartupProcedureRunning) set({ status: 'checking' });
      else if (!busy && next.isUpdatePending) set({ status: 'ready' });
      else if (!busy && (state.status === 'checking' || state.status === 'downloading'))
        set({ status: 'idle' });
      checkAfterSettling();
    },
    async check(trigger: 'automatic' | 'manual' | 'focus' = 'automatic') {
      if (!supported || state.status === 'restarting') return;
      if (busy || nativeBusy()) {
        if (trigger === 'focus') focusCheckPending = true;
        return;
      }
      if (state.status === 'ready' && trigger !== 'focus') return;
      if (
        trigger === 'automatic' &&
        lastAttempt !== undefined &&
        now() - lastAttempt < UPDATE_COOLDOWN
      )
        return;
      if (trigger === 'focus') focusCheckPending = false;
      const wasReady = state.status === 'ready';
      lastAttempt = now();
      busy = true;
      set({ status: 'checking' });
      try {
        const result = await api.check();
        const hasCachedUpdate = wasReady || native?.isUpdatePending;
        const discoveredId = result.manifest?.id;
        const alreadyDownloaded =
          discoveredId !== undefined && discoveredId === native?.downloadedUpdate?.updateId;
        if (hasCachedUpdate && (trigger !== 'focus' || alreadyDownloaded)) {
          set({ status: 'ready' });
          return;
        }
        if (result.isAvailable || result.isRollBackToEmbedded) {
          set({ status: 'downloading' });
          const downloaded = await api.fetch();
          set({
            status:
              downloaded.isNew ||
              downloaded.isRollBackToEmbedded ||
              hasCachedUpdate ||
              native?.isUpdatePending
                ? 'ready'
                : 'current',
          });
        } else set({ status: hasCachedUpdate ? 'ready' : 'current' });
      } catch {
        if (wasReady || native?.isUpdatePending) set({ status: 'ready' });
        else
          set(
            trigger === 'manual'
              ? {
                  status: 'error',
                  error:
                    'Could not check or download the update. Check your connection and try again.',
                }
              : { status: 'idle' },
          );
      } finally {
        busy = false;
        checkAfterSettling();
      }
    },
    async restart() {
      if (!supported || busy || nativeBusy() || state.status !== 'ready') return;
      busy = true;
      set({ status: 'restarting' });
      try {
        await api.reload();
      } catch {
        set({ status: 'ready', error: 'Could not restart. Try Restart to update again.' });
      } finally {
        busy = false;
      }
    },
  };
  return controller;
}

export function watchUpdateLifecycle(
  appState: {
    currentState: string | null | undefined;
    addEventListener: (
      event: 'change',
      callback: (state: string) => void,
    ) => { remove: () => void };
  },
  check: () => void,
) {
  let previous = appState.currentState;
  if (previous === 'active') check();
  const subscription = appState.addEventListener('change', (next) => {
    if (next === 'active' && previous !== 'active') check();
    previous = next;
  });
  return () => subscription.remove();
}
