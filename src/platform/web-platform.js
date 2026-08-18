import { assertPlatform, PLATFORM_SLOTS } from './platform-contract.js?v=rfa73e792131b';

const KEYS = Object.freeze({
  [PLATFORM_SLOTS.CAMPAIGN]: 'bf_save',
  [PLATFORM_SLOTS.TEST_CAMPAIGN]: 'bf_save_test',
  [PLATFORM_SLOTS.SETTINGS]: 'bf_mute',
});

function storageError(operation, slot, error) {
  const detail = error instanceof Error ? `: ${error.message}` : '';
  return new Error(`Web storage ${operation} failed for ${slot}${detail}`);
}

export function createWebPlatform() {
  let backgrounded = !!document.hidden;
  let suspended = backgrounded;
  const listeners = { deactivate: new Set(), suspend: new Set(), resume: new Set() };
  const notify = (kind, value) => { for (const listener of [...listeners[kind]]) listener(value); };
  const setBackgrounded = next => {
    const changed = next !== backgrounded;
    backgrounded = next;
    if (!changed) return;
    if (next) {
      notify('deactivate');
      if (!suspended) { suspended = true; notify('suspend'); }
    } else if (suspended) {
      suspended = false;
      notify('resume');
    }
  };
  const onVisibility = () => setBackgrounded(!!document.hidden);
  const onBlur = () => setBackgrounded(true);
  const onFocus = () => { if (!document.hidden) setBackgrounded(false); };
  const onPagehide = () => {
    notify('deactivate');
    if (!suspended) { suspended = true; notify('suspend'); }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pagehide', onPagehide);

  const storage = {
    read: async slot => {
      try { return localStorage.getItem(KEYS[slot]); }
      catch (error) { throw storageError('read', slot, error); }
    },
    write: async (slot, raw) => {
      try { localStorage.setItem(KEYS[slot], raw); }
      catch (error) { throw storageError('write', slot, error); }
    },
    remove: async slot => {
      try { localStorage.removeItem(KEYS[slot]); }
      catch (error) { throw storageError('remove', slot, error); }
    },
    flush: async () => {},
  };
  const lifecycle = {
    // Read the browser signal inside the adapter so scheduler code remains
    // host-agnostic; tests and future desktop adapters can provide their own
    // background state without touching document globals.
    isBackgrounded: () => backgrounded || !!document.hidden,
    onDeactivate: listener => { listeners.deactivate.add(listener); return () => listeners.deactivate.delete(listener); },
    onSuspend: listener => { listeners.suspend.add(listener); return () => listeners.suspend.delete(listener); },
    onResume: listener => { listeners.resume.add(listener); return () => listeners.resume.delete(listener); },
  };
  return assertPlatform({ kind: 'web', storage, lifecycle });
}
