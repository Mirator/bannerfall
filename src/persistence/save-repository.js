import { parseSave } from '../save.js?v=rfdf6abae5ce0';
import { PLATFORM_SLOTS } from '../platform/platform-contract.js?v=rfdf6abae5ce0';

const SETTINGS_DEFAULTS = Object.freeze({ muted: false });

// Only read failures are retryable startup storage errors. Parser/programming
// faults must retain their normal error reporting rather than masquerading as one.
export class StorageReadError extends Error {
  constructor(slot, cause) {
    super(`Could not read ${slot}: ${cause.message}`, { cause });
    this.name = 'StorageReadError';
    this.slot = slot;
  }
}

export class SaveRepository {
  constructor(platform) {
    this.platform = platform;
    this.cache = new Map();
    this.initialized = false;
    this.queue = Promise.resolve();
    this.errors = new Map();
    this.statusListeners = new Set();
  }

  async initialize() {
    const slots = Object.values(PLATFORM_SLOTS);
    const raws = await Promise.all(slots.map(async slot => {
      try { return await this.platform.storage.read(slot); }
      catch (error) { throw new StorageReadError(slot, error); }
    }));
    const [campaign, testCampaign, settings] = raws;
    this.cache.set(PLATFORM_SLOTS.CAMPAIGN, this.#parseCampaign(campaign, PLATFORM_SLOTS.CAMPAIGN));
    this.cache.set(PLATFORM_SLOTS.TEST_CAMPAIGN, this.#parseCampaign(testCampaign, PLATFORM_SLOTS.TEST_CAMPAIGN));
    this.cache.set(PLATFORM_SLOTS.SETTINGS, this.#parseSettings(settings));
    this.initialized = true;
    return this;
  }

  #parseCampaign(raw, slot) {
    if (!raw) return null;
    const save = parseSave(raw);
    if (save) return save;
    this.#enqueue(slot, () => this.platform.storage.remove(slot)).catch(() => {});
    return null;
  }

  #parseSettings(raw) {
    if (!raw) return { ...SETTINGS_DEFAULTS };
    if (raw === '1' || raw === '0') return { muted: raw === '1' };
    try {
      const value = JSON.parse(raw);
      return { muted: value && value.muted === true };
    } catch {
      this.#enqueue(PLATFORM_SLOTS.SETTINGS, () => this.platform.storage.remove(PLATFORM_SLOTS.SETTINGS)).catch(() => {});
      return { ...SETTINGS_DEFAULTS };
    }
  }

  #campaignSlot(testMode) { return testMode ? PLATFORM_SLOTS.TEST_CAMPAIGN : PLATFORM_SLOTS.CAMPAIGN; }
  // Failures belong to their durability slot. A settings write cannot recover a
  // failed campaign write; flush failures need a successful flush of their own.
  get lastError() { return [...this.errors.values()].at(-1) ?? null; }
  onStatusChange(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  #settled(slot, error = null) {
    if (error) this.errors.set(slot, error);
    else this.errors.delete(slot);
    for (const listener of this.statusListeners) listener(slot, error);
  }
  #enqueue(slot, operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => { this.#settled(slot); },
      error => { this.#settled(slot, error); },
    );
    return run;
  }

  getCampaign(testMode = false) { return this.cache.get(this.#campaignSlot(testMode)) ?? null; }
  getSettings() { return this.cache.get(PLATFORM_SLOTS.SETTINGS) ?? { ...SETTINGS_DEFAULTS }; }

  writeCampaign(testMode, save) {
    const slot = this.#campaignSlot(testMode);
    const raw = JSON.stringify(save);
    this.cache.set(slot, save);
    return this.#enqueue(slot, () => this.platform.storage.write(slot, raw));
  }

  removeCampaign(testMode = false) {
    const slot = this.#campaignSlot(testMode);
    this.cache.set(slot, null);
    return this.#enqueue(slot, () => this.platform.storage.remove(slot));
  }

  setMuted(muted) {
    const settings = { muted: !!muted };
    this.cache.set(PLATFORM_SLOTS.SETTINGS, settings);
    return this.#enqueue(PLATFORM_SLOTS.SETTINGS, () => this.platform.storage.write(PLATFORM_SLOTS.SETTINGS, settings.muted ? '1' : '0'));
  }

  flush() {
    return this.queue.then(async () => {
      // A previously failed flush is retryable; slot failures require a new
      // successful operation on that slot before the aggregate flush may succeed.
      const slotError = [...this.errors].find(([slot]) => slot !== 'flush');
      if (slotError) throw slotError[1];
      try {
        await this.platform.storage.flush();
        this.#settled('flush');
      } catch (error) {
        this.#settled('flush', error);
        throw error;
      }
      if (this.lastError) throw this.lastError;
    });
  }
}
