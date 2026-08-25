import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPlatform, PLATFORM_SLOTS } from '../../src/platform/platform-contract.js';
import { SaveRepository } from '../../src/persistence/save-repository.js';

function fakePlatform(initial = {}) {
  const values = new Map(Object.entries(initial));
  const events = { deactivate: new Set(), suspend: new Set(), resume: new Set() };
  const calls = [];
  const platform = {
    kind: 'desktop',
    storage: {
      read: async slot => { calls.push(['read', slot]); return values.get(slot) ?? null; },
      write: async (slot, raw) => { calls.push(['write', slot]); values.set(slot, raw); },
      remove: async slot => { calls.push(['remove', slot]); values.delete(slot); },
      flush: async () => { calls.push(['flush']); },
    },
    lifecycle: {
      isBackgrounded: () => false,
      onDeactivate: listener => { events.deactivate.add(listener); return () => events.deactivate.delete(listener); },
      onSuspend: listener => { events.suspend.add(listener); return () => events.suspend.delete(listener); },
      onResume: listener => { events.resume.add(listener); return () => events.resume.delete(listener); },
    },
  };
  return { platform: assertPlatform(platform), values, events, calls };
}

function validSaveRaw() {
  return JSON.stringify({
    version: 2, gold: 0, heroHp: 120, heroMaxHp: 120,
    troops: [{ type: 'spear' }], armyCap: 12,
    camps: [{ id: 'c1', razed: false }, { id: 'c2', razed: false }, { id: 'c3', razed: false }, { id: 'strong', razed: false }],
    won: false, x: 620, y: 1250, parties: null, runSeed: 7,
    stats: { won: 0, kills: 0, lost: 0, playT: 0 }, hard: false, battleCount: 0,
  });
}

test('platform contract exposes semantic slots and lifecycle unsubscribe', async () => {
  const fake = fakePlatform();
  const repository = new SaveRepository(fake.platform);
  await repository.initialize();
  await repository.setMuted(true);
  await repository.flush();
  assert.equal(fake.values.get(PLATFORM_SLOTS.SETTINGS), '1');
  assert.deepEqual(repository.getSettings(), { muted: true });
  let calls = 0;
  const unsubscribe = fake.platform.lifecycle.onDeactivate(() => { calls++; });
  for (const listener of fake.events.deactivate) listener();
  unsubscribe();
  for (const listener of fake.events.deactivate) listener();
  assert.equal(calls, 1);
  assert.ok(fake.calls.some(([operation, slot]) => operation === 'read' && slot === PLATFORM_SLOTS.CAMPAIGN));
});

test('storage errors identify operation and semantic slot', async () => {
  const fake = fakePlatform().platform;
  fake.storage.write = async () => { throw new Error('quota'); };
  const repository = new SaveRepository(fake);
  await repository.initialize();
  await assert.rejects(repository.setMuted(true), /quota/);
  assert.match(repository.lastError.message, /quota/);
});

test('repository hydrates before serving cache and cleans invalid campaigns', async () => {
  const fake = fakePlatform({ [PLATFORM_SLOTS.CAMPAIGN]: '{bad' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const read = fake.platform.storage.read;
  fake.platform.storage.read = async slot => { await gate; return read(slot); };
  const repository = new SaveRepository(fake.platform);
  const initializing = repository.initialize();
  assert.equal(repository.initialized, false);
  assert.equal(repository.getCampaign(false), null);
  release();
  await initializing;
  await repository.flush();
  assert.equal(fake.values.has(PLATFORM_SLOTS.CAMPAIGN), false);
  assert.equal(repository.getCampaign(false), null);
});

test('repository queues writes and removals in invocation order', async () => {
  const fake = fakePlatform();
  const order = [];
  fake.platform.storage.write = async (slot, raw) => {
    await new Promise(resolve => setTimeout(resolve, raw.includes('"gold":1') ? 15 : 0));
    order.push(['write', raw]);
    fake.values.set(slot, raw);
  };
  fake.platform.storage.remove = async slot => { order.push(['remove', slot]); fake.values.delete(slot); };
  const repository = new SaveRepository(fake.platform);
  await repository.initialize();
  const first = { ...JSON.parse(validSaveRaw()), gold: 1 };
  const second = { ...JSON.parse(validSaveRaw()), gold: 2 };
  const firstWrite = repository.writeCampaign(false, first);
  const secondWrite = repository.writeCampaign(false, second);
  const removal = repository.removeCampaign(false);
  await Promise.all([firstWrite, secondWrite, removal]);
  await repository.flush();
  assert.deepEqual(order.map(entry => entry[0]), ['write', 'write', 'remove']);
  assert.equal(fake.values.has(PLATFORM_SLOTS.CAMPAIGN), false);
});

test('flush rejects queued failures and preserves an observable lastError', async () => {
  const fake = fakePlatform();
  const repository = new SaveRepository(fake.platform);
  await repository.initialize();
  fake.platform.storage.write = async () => { throw new Error('disk full'); };
  await assert.rejects(repository.writeCampaign(false, JSON.parse(validSaveRaw())), /disk full/);
  await assert.rejects(repository.flush(), /disk full/);
  assert.match(repository.lastError.message, /disk full/);
});

test('flush recovers once a later write succeeds, clearing the stale lastError', async () => {
  const fake = fakePlatform();
  const repository = new SaveRepository(fake.platform);
  await repository.initialize();
  const write = fake.platform.storage.write;
  fake.platform.storage.write = async () => { throw new Error('quota blip'); };
  await assert.rejects(repository.writeCampaign(false, JSON.parse(validSaveRaw())), /quota blip/);
  await assert.rejects(repository.flush(), /quota blip/);
  assert.match(repository.lastError.message, /quota blip/);

  fake.platform.storage.write = write;
  await repository.writeCampaign(false, JSON.parse(validSaveRaw()));
  await assert.doesNotReject(repository.flush(),
    'a recovered write must clear the earlier failure instead of latching it forever');
  assert.equal(repository.lastError, null);
});

// The contract's whole job is refusing a host that cannot serve the renderer. Until
// these existed the suite only ever built a VALID fake and walked the happy path, so
// both `throw` sites in assertPlatform() were unexecuted and a future desktop adapter
// could have shipped a missing slot without the boundary noticing.
test('assertPlatform rejects every host shape the boundary forbids', () => {
  const valid = () => fakePlatform().platform;

  assert.throws(() => assertPlatform(null), TypeError, 'null host must be refused');
  assert.throws(() => assertPlatform(undefined), TypeError, 'missing host must be refused');
  assert.throws(() => assertPlatform({ ...valid(), kind: 'steam' }), /supported kind/,
    'an unknown host kind must be refused, not assumed web');
  assert.throws(() => assertPlatform({ ...valid(), kind: undefined }), /supported kind/);

  for (const operation of ['read', 'write', 'remove']) {
    const host = valid();
    const storage = { ...host.storage };
    delete storage[operation];
    assert.throws(() => assertPlatform({ ...host, storage }), new RegExp(`missing ${operation}\\(`),
      `storage missing ${operation}() must be refused`);
  }

  const noFlush = valid();
  const flushless = { ...noFlush.storage };
  delete flushless.flush;
  assert.throws(() => assertPlatform({ ...noFlush, storage: flushless }), /missing flush\(\)/);

  for (const method of ['isBackgrounded', 'onDeactivate', 'onSuspend', 'onResume']) {
    const host = valid();
    const lifecycle = { ...host.lifecycle };
    delete lifecycle[method];
    assert.throws(() => assertPlatform({ ...host, lifecycle }), new RegExp(`missing ${method}\\(\\)`),
      `lifecycle missing ${method}() must be refused`);
  }

  // and the accepted host comes back frozen, so nothing can widen it after the check
  const accepted = assertPlatform(valid());
  assert.equal(Object.isFrozen(accepted), true);
});

test('settings survive both stored shapes and recover from a corrupt blob', async () => {
  // the JSON object shape, which nothing exercised: only the legacy '1'/'0' strings were
  const objectForm = fakePlatform({ [PLATFORM_SLOTS.SETTINGS]: '{"muted":true}' });
  const fromObject = new SaveRepository(objectForm.platform);
  await fromObject.initialize();
  assert.deepEqual(fromObject.getSettings(), { muted: true });

  const objectFalse = fakePlatform({ [PLATFORM_SLOTS.SETTINGS]: '{"muted":"yes"}' });
  const fromLoose = new SaveRepository(objectFalse.platform);
  await fromLoose.initialize();
  assert.deepEqual(fromLoose.getSettings(), { muted: false }, 'only a real boolean true means muted');

  // a corrupt blob falls back to defaults AND drops the bad value, the same contract
  // #parseCampaign already had a test for
  const corrupt = fakePlatform({ [PLATFORM_SLOTS.SETTINGS]: 'not json at all' });
  const recovered = new SaveRepository(corrupt.platform);
  await recovered.initialize();
  assert.deepEqual(recovered.getSettings(), { muted: false });
  await recovered.flush();
  assert.equal(corrupt.values.has(PLATFORM_SLOTS.SETTINGS), false,
    'a corrupt settings blob must be removed, not left to fail again on the next boot');
});
