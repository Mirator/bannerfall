import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

function assertNoRuntimeErrors(runtimeErrors) {
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
}

async function openPlayerGame(page, runtimeErrors) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => {
    localStorage.removeItem('bf_save');
    localStorage.removeItem('bf_save_test');
    window.__g.testMode = false;
  });
  assertNoRuntimeErrors(runtimeErrors);
}

async function startRawWorld(page, seed = 11) {
  await page.evaluate(worldSeed => {
    window.__g.testSeed = worldSeed;
    window.__g.startWorld(null);
  }, seed);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
}

async function currentSave(page) {
  return page.evaluate(() => structuredClone(window.__g.scene.save));
}

async function rejectRealSave(page, payload) {
  return page.evaluate(value => {
    window.__g.testMode = false;
    localStorage.setItem('bf_save', typeof value === 'string' ? value : JSON.stringify(value));
    const loaded = window.__g.loadRun();
    return { loaded, stored: localStorage.getItem('bf_save') };
  }, payload);
}

test('fresh run stores version 1', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1101);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bf_save')));
  expect(stored.version).toBe(1);
  expect(stored.camps.map(camp => camp.id)).toEqual(['c1', 'c2', 'c3', 'strong']);
  assertNoRuntimeErrors(runtimeErrors);
});

test('valid unversioned save migrates defaults and is rewritten as version 1', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1102);
  const legacy = await currentSave(page);
  delete legacy.version;
  delete legacy.heroHp;
  delete legacy.heroMaxHp;
  delete legacy.armyCap;
  delete legacy.won;
  delete legacy.parties;
  delete legacy.runSeed;
  delete legacy.stats;
  delete legacy.hard;
  delete legacy.battleCount;

  await page.evaluate(value => localStorage.setItem('bf_save', JSON.stringify(value)), legacy);
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  const migratedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(migratedBeforeContinue.version).toBe(1);
  expect(migratedBeforeContinue.parties).toBe(null);
  expect(migratedBeforeContinue.heroHp).toBe(120);
  expect(migratedBeforeContinue.heroMaxHp).toBe(120);
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  const migrated = await page.evaluate(() => ({
    save: structuredClone(window.__g.scene.save),
    stored: JSON.parse(localStorage.getItem('bf_save')),
  }));
  expect(migrated.save.version).toBe(1);
  expect(migrated.save.heroHp).toBe(120);
  expect(migrated.save.heroMaxHp).toBe(120);
  expect(migrated.save.armyCap).toBe(12);
  expect(migrated.save.won).toBe(false);
  expect(migrated.save.parties.length).toBeGreaterThan(0);
  expect(migrated.save.runSeed).toBe(777);
  expect(migrated.save.stats).toEqual({ won: 0, kills: 0, lost: 0, playT: expect.any(Number) });
  expect(migrated.save.hard).toBe(false);
  expect(migrated.save.battleCount).toBe(0);
  expect(migrated.stored.version).toBe(1);
  assertNoRuntimeErrors(runtimeErrors);
});

test('complete version-1 save round-trips nested state without losing fields', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1103);
  const save = await currentSave(page);
  save.version = 1;
  save.gold = 731;
  save.heroHp = 87;
  save.heroMaxHp = 140;
  save.troops = [{ type: 'spear', hp: 73 }, { type: 'archer', hp: 44 }, { type: 'knight' }];
  save.armyCap = 13;
  save.camps = [
    { id: 'c1', razed: false, garrison: ['bandit', 'wolf'] },
    { id: 'c2', razed: true },
    { id: 'c3', razed: false, garrison: ['brute'] },
    { id: 'strong', razed: false },
  ];
  save.x = 1711;
  save.y = 944;
  save.parties = [{ camp: 'c1', x: 1811, y: 984, comp: ['bandit', 'wolf'], home: { x: 1600, y: 900 }, waryT: 8 }];
  save.runSeed = 4422;
  save.stats = { won: 2, kills: 19, lost: 3, playT: 47.5 };
  save.hard = true;
  save.battleCount = 9;
  save.toast = 'Keep the banner high';
  await page.evaluate(value => localStorage.setItem('bf_save', JSON.stringify(value)), save);
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  const parsedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(parsedBeforeContinue.toast).toBe('Keep the banner high');
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  const restored = await page.evaluate(() => structuredClone(window.__g.scene.save));
  expect(restored.version).toBe(1);
  expect(restored.gold).toBe(731);
  expect(restored.heroHp).toBe(87);
  expect(restored.heroMaxHp).toBe(140);
  expect(restored.troops).toEqual([{ type: 'spear', hp: 73 }, { type: 'archer', hp: 44 }, { type: 'knight' }]);
  expect(restored.camps).toEqual(save.camps);
  expect(restored.x).toBe(1711);
  expect(restored.y).toBe(944);
  expect(restored.parties).toEqual(save.parties);
  expect(restored.runSeed).toBe(4422);
  expect(restored.stats.playT).toBeGreaterThanOrEqual(47.5);
  expect(restored.stats.won).toBe(2);
  expect(restored.stats.kills).toBe(19);
  expect(restored.stats.lost).toBe(3);
  expect(restored.hard).toBe(true);
  expect(restored.battleCount).toBe(9);
  expect(restored.toast).toBe(null);
  assertNoRuntimeErrors(runtimeErrors);
});

test('malformed JSON is cleared and cannot Continue', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  const result = await rejectRealSave(page, '{not json');
  expect(result).toEqual({ loaded: null, stored: null });
  assertNoRuntimeErrors(runtimeErrors);
});

test('unknown future version is cleared and cannot Continue', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1105);
  const save = await currentSave(page);
  save.version = 2;
  const result = await rejectRealSave(page, save);
  expect(result).toEqual({ loaded: null, stored: null });
  assertNoRuntimeErrors(runtimeErrors);
});

test('missing, duplicate, and unknown camp IDs are rejected and clear bf_save', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1106);
  const base = await currentSave(page);
  const cases = [
    ['missing', value => value.camps.pop()],
    ['duplicate', value => { value.camps[1].id = value.camps[0].id; }],
    ['unknown', value => { value.camps[0].id = 'invented'; }],
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    const result = await rejectRealSave(page, candidate);
    expect(result, name).toEqual({ loaded: null, stored: null });
  }
  assertNoRuntimeErrors(runtimeErrors);
});

test('unknown troop, garrison-enemy, and party-enemy types are rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1107);
  const base = await currentSave(page);
  const cases = [
    ['troop', value => { value.troops[0].type = 'invented'; }],
    ['garrison', value => { value.camps[0].garrison = ['invented']; }],
    ['party', value => { value.parties = [{ camp: 'c1', x: 100, y: 100, comp: ['invented'] }]; }],
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    const result = await rejectRealSave(page, candidate);
    expect(result, name).toEqual({ loaded: null, stored: null });
  }
  assertNoRuntimeErrors(runtimeErrors);
});

test('invalid nested shapes and numeric ranges are rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1108);
  const base = await currentSave(page);
  const cases = [
    ['hero coordinate', value => { value.x = 3201; }],
    ['party coordinate', value => { value.parties = [{ camp: 'c1', x: -1, y: 100, comp: ['bandit'] }]; }],
    ['negative counter', value => { value.stats.kills = -1; }],
    ['hero hp above max', value => { value.heroHp = value.heroMaxHp + 1; }],
    ['invalid troop hp', value => { value.troops[0].hp = UNIT_MAX_HP + 1; }],
    ['invalid party home', value => { value.parties = [{ camp: 'c1', x: 100, y: 100, comp: ['bandit'], home: { x: 100, y: 2201 } }]; }],
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    const result = await rejectRealSave(page, candidate);
    expect(result, name).toEqual({ loaded: null, stored: null });
  }
  assertNoRuntimeErrors(runtimeErrors);
});

const UNIT_MAX_HP = 101;
