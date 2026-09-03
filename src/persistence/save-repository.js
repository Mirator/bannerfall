import { parseSave } from '../save.js?v=r3ac1d341fd40';
import { PLATFORM_SLOTS } from '../platform/platform-contract.js?v=r3ac1d341fd40';

const SETTINGS_DEFAULTS = Object.freeze({ muted: false });

export class SaveRepository {
  constructor(platform) {
    this.platform = platform;
    this.cache = new Map();
    this.initialized = false;
    this.queue = Promise.resolve();
    this.lastError = null;
  }

  async initialize() {
    const slots = Object.values(PLATFORM_SLOTS);
    const raws = await Promise.all(slots.map(slot => this.platform.storage.read(slot)));
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
  // lastError tracks the outcome of the most recently SETTLED queued operation, not a
  // permanent latch: a later operation that succeeds clears it, so one transient failure
  // does not pin flush() to reject forever once the queue has moved past it. Nothing
  // inside flush() consumes or clears this field, so concurrent flush() calls all observe
  // the same value and cannot race each other into losing a still-current error.
  #enqueue(slot, operation) {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(
      () => { this.lastError = null; },
      error => { this.lastError = error; },
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
      if (this.lastError) throw this.lastError;
      await this.platform.storage.flush();
      if (this.lastError) throw this.lastError;
    });
  }
}
