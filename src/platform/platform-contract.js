// Capability boundary between the renderer and a web/desktop host.
// The contract deliberately contains no DOM, filesystem, IPC, or Steam types.
export const PLATFORM_SLOTS = Object.freeze({
  CAMPAIGN: 'campaign',
  TEST_CAMPAIGN: 'testCampaign',
  SETTINGS: 'settings',
});

export function assertPlatform(platform) {
  if (!platform || platform.kind !== 'web' && platform.kind !== 'desktop') {
    throw new TypeError('Platform must declare a supported kind');
  }
  for (const slot of Object.values(PLATFORM_SLOTS)) {
    for (const operation of ['read', 'write', 'remove']) {
      if (typeof platform.storage?.[operation] !== 'function') {
        throw new TypeError(`Platform storage is missing ${operation}(${slot})`);
      }
    }
  }
  if (typeof platform.storage.flush !== 'function') throw new TypeError('Platform storage is missing flush()');
  for (const method of ['isBackgrounded', 'onDeactivate', 'onSuspend', 'onResume']) {
    if (typeof platform.lifecycle?.[method] !== 'function') throw new TypeError(`Platform lifecycle is missing ${method}()`);
  }
  return Object.freeze(platform);
}
