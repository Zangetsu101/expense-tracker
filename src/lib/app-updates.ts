export type NativeUpdateState = {
  isChecking: boolean;
  isDownloading: boolean;
  isStartupProcedureRunning: boolean;
  isUpdatePending: boolean;
  isRestarting: boolean;
  downloadProgress?: number;
  lastCheckForUpdateTimeSinceRestart?: Date;
};
export type UpdateStatus = 'unsupported' | 'idle' | 'checking' | 'downloading' | 'current' | 'ready' | 'restarting' | 'error';
export type UpdateState = { status: UpdateStatus; error?: string; progress?: number };
type UpdateAPI = {
  check: () => Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean }>;
  fetch: () => Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>;
  reload: () => Promise<void>;
};
export const UPDATE_COOLDOWN = 30 * 60 * 1000;

export function createUpdateController(supported: boolean, api: UpdateAPI, now = Date.now) {
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported' };
  let native: NativeUpdateState;
  let busy = false;
  let lastAttempt: number | undefined;
  const listeners = new Set<() => void>();
  const set = (next: UpdateState) => { state = next; listeners.forEach(fn => fn()); };
  const nativeBusy = () => native && (native.isChecking || native.isDownloading || native.isStartupProcedureRunning || native.isRestarting);
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    sync(next: NativeUpdateState) {
      native = next;
      if (!supported) return;
      if (next.lastCheckForUpdateTimeSinceRestart) lastAttempt = Math.max(lastAttempt ?? 0, next.lastCheckForUpdateTimeSinceRestart.getTime());
      if (next.isRestarting) set({ status: 'restarting' });
      else if (next.isDownloading) set({ status: 'downloading', progress: next.downloadProgress });
      else if (next.isChecking || next.isStartupProcedureRunning) set({ status: 'checking' });
      else if (next.isUpdatePending) set({ status: 'ready' });
      else if (!busy && (state.status === 'checking' || state.status === 'downloading')) set({ status: 'idle' });
    },
    async check(manual = false) {
      if (!supported || busy || nativeBusy() || state.status === 'ready' || state.status === 'restarting') return;
      if (!manual && lastAttempt !== undefined && now() - lastAttempt < UPDATE_COOLDOWN) return;
      lastAttempt = now();
      busy = true;
      set({ status: 'checking' });
      try {
        const result = await api.check();
        if (native?.isUpdatePending) { set({ status: 'ready' }); return; }
        if (result.isAvailable || result.isRollBackToEmbedded) {
          set({ status: 'downloading' });
          const downloaded = await api.fetch();
          set({ status: downloaded.isNew || downloaded.isRollBackToEmbedded || native?.isUpdatePending ? 'ready' : 'current' });
        } else set({ status: 'current' });
      } catch {
        if (native?.isUpdatePending) set({ status: 'ready' });
        else set(manual ? { status: 'error', error: 'Could not check or download the update. Check your connection and try again.' } : { status: 'idle' });
      } finally { busy = false; }
    },
    async restart() {
      if (!supported || busy || nativeBusy() || state.status !== 'ready') return;
      busy = true;
      set({ status: 'restarting' });
      try { await api.reload(); }
      catch { set({ status: 'ready', error: 'Could not restart. Try Restart to update again.' }); }
      finally { busy = false; }
    },
  };
}

export function watchUpdateLifecycle(appState: { currentState: string | null; addEventListener: (event: 'change', callback: (state: string) => void) => { remove: () => void } }, check: () => void) {
  let previous = appState.currentState;
  if (previous === 'active') check();
  const subscription = appState.addEventListener('change', next => {
    if (next === 'active' && previous !== 'active') check();
    previous = next;
  });
  return () => subscription.remove();
}
