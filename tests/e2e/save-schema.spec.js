import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

function assertNoRuntimeErrors(runtimeErrors) {
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
}

async function openPlayerGame(page, runtimeErrors) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.addInitScript(() => {
    if (sessionStorage.getItem('qa-clear-save') !== '1') {
      localStorage.removeItem('bf_save');
      localStorage.removeItem('bf_save_test');
      sessionStorage.setItem('qa-clear-save', '1');
    }
  });
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => { window.__g.testMode = false; });
  assertNoRuntimeErrors(runtimeErrors);
}

async function reloadWithRealSave(page, value) {
  const token = `qa-seed-${Date.now()}-${Math.random()}`;
  await page.addInitScript(({ seedToken, raw }) => {
    if (sessionStorage.getItem(seedToken) !== '1') {
      localStorage.setItem('bf_save', raw);
      sessionStorage.setItem(seedToken, '1');
    }
  }, { seedToken: token, raw: typeof value === 'string' ? value : JSON.stringify(value) });
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
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
  await reloadWithRealSave(page, payload);
  return page.evaluate(async () => {
    window.__g.testMode = false;
    const loaded = window.__g.loadRun();
    await window.__g.saves.flush().catch(() => {});
    return { loaded, stored: localStorage.getItem('bf_save') };
  });
}

test('fresh run stores version 3', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1101);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bf_save')));
  expect(stored.version).toBe(3);
  expect(stored.camps.map(camp => camp.id)).toEqual(['c1', 'c2', 'c3', 'strong']);
  expect(stored.settlements).toEqual([
    { id: 'ashford', occupied: false },
    { id: 'brindle', occupied: false },
    { id: 'coldwell', occupied: false },
    { id: 'keep', occupied: false },
  ]);
  assertNoRuntimeErrors(runtimeErrors);
});

test('valid unversioned save migrates defaults and is rewritten as version 3', async ({ page }) => {
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
  delete legacy.settlements;

  await reloadWithRealSave(page, legacy);
  const migratedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(migratedBeforeContinue.version).toBe(3);
  expect(migratedBeforeContinue.parties).toBe(null);
  expect(migratedBeforeContinue.heroHp).toBe(120);
  expect(migratedBeforeContinue.heroMaxHp).toBe(120);
  expect(migratedBeforeContinue.settlements).toEqual([
    { id: 'ashford', occupied: false },
    { id: 'brindle', occupied: false },
    { id: 'coldwell', occupied: false },
    { id: 'keep', occupied: false },
  ]);
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  const migrated = await page.evaluate(() => ({
    save: structuredClone(window.__g.scene.save),
    stored: JSON.parse(localStorage.getItem('bf_save')),
  }));
  expect(migrated.save.version).toBe(3);
  expect(migrated.save.heroHp).toBe(120);
  expect(migrated.save.heroMaxHp).toBe(120);
  expect(migrated.save.armyCap).toBe(12);
  expect(migrated.save.won).toBe(false);
  expect(migrated.save.parties.length).toBeGreaterThan(0);
  expect(migrated.save.runSeed).toBe(777);
  expect(migrated.save.stats).toEqual({ won: 0, kills: 0, lost: 0, playT: expect.any(Number) });
  expect(migrated.save.hard).toBe(false);
  expect(migrated.save.battleCount).toBe(0);
  expect(migrated.save.settlements).toEqual([
    { id: 'ashford', occupied: false },
    { id: 'brindle', occupied: false },
    { id: 'coldwell', occupied: false },
    { id: 'keep', occupied: false },
  ]);
  expect(migrated.stored.version).toBe(3);
  assertNoRuntimeErrors(runtimeErrors);
});

test('version-1 roaming parties migrate a missing home from their canonical camp', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1109);
  const legacy = await currentSave(page);
  legacy.version = 1;
  legacy.parties = [{ camp: 'c1', x: 1200, y: 1500, comp: ['bandit'], waryT: 2 }];
  delete legacy.settlements;
  await reloadWithRealSave(page, legacy);
  const migrated = await page.evaluate(() => window.__g.loadRun());
  expect(migrated.version).toBe(3);
  expect(migrated.parties).toEqual([{
    camp: 'c1', x: 1200, y: 1500, comp: ['bandit'], home: { x: 1050, y: 1500 }, waryT: 2, clashT: 0,
  }]);
  assertNoRuntimeErrors(runtimeErrors);
});

test('version-2 save migrates to version 3 with every settlement unoccupied, safe for world construction', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1111);
  const legacy = await currentSave(page);
  legacy.version = 2;
  delete legacy.settlements; // version 2 never had this field
  await reloadWithRealSave(page, legacy);
  const migratedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(migratedBeforeContinue.version).toBe(3);
  expect(migratedBeforeContinue.settlements).toEqual([
    { id: 'ashford', occupied: false },
    { id: 'brindle', occupied: false },
    { id: 'coldwell', occupied: false },
    { id: 'keep', occupied: false },
  ]);
  await page.keyboard.press('c');
  // "immediately safe for world construction": the world must boot from the migrated save
  // without a runtime error, and the settlements it exposes must match what was migrated.
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  const restored = await page.evaluate(() => ({
    version: window.__g.scene.save.version,
    settlements: window.__g.scene.save.settlements,
  }));
  expect(restored.version).toBe(3);
  expect(restored.settlements).toEqual(migratedBeforeContinue.settlements);
  assertNoRuntimeErrors(runtimeErrors);
});

test('complete version-3 save round-trips nested state without losing fields', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1103);
  const save = await currentSave(page);
  save.version = 3;
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
  save.settlements = [
    { id: 'ashford', occupied: true },
    { id: 'brindle', occupied: false },
    { id: 'coldwell', occupied: false },
    { id: 'keep', occupied: false },
  ];
  save.x = 1711;
  save.y = 944;
  save.parties = [
    { camp: 'c1', x: 1811, y: 984, comp: ['bandit', 'wolf'], home: { x: 1600, y: 900 }, waryT: 8, clashT: 0 },
    { camp: 'c2', x: 700, y: 1150, comp: ['bandit'], home: { x: 1850, y: 500 }, waryT: 0, clashT: 0, occupying: 'ashford' },
  ];
  save.runSeed = 4422;
  save.stats = { won: 2, kills: 19, lost: 3, playT: 47.5 };
  save.hard = true;
  save.battleCount = 9;
  save.toast = 'Keep the banner high';
  await reloadWithRealSave(page, save);
  const parsedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(parsedBeforeContinue.toast).toBe('Keep the banner high');
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  const restored = await page.evaluate(() => structuredClone(window.__g.scene.save));
  expect(restored.version).toBe(3);
  expect(restored.gold).toBe(731);
  expect(restored.heroHp).toBe(87);
  expect(restored.heroMaxHp).toBe(140);
  expect(restored.troops).toEqual([{ type: 'spear', hp: 73 }, { type: 'archer', hp: 44 }, { type: 'knight' }]);
  expect(restored.camps).toEqual(save.camps);
  expect(restored.settlements).toEqual(save.settlements);
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

test('zero run seed survives load and battle entry', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 0);
  expect(await page.evaluate(() => window.__g.scene.save.runSeed)).toBe(0);
  await page.evaluate(() => {
    const world = window.__g.scene;
    world.startBattle(['bandit'], 'ZERO SEED CHECK', null, 'road');
  });
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('battle');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bf_save')).runSeed)).toBe(0);
  assertNoRuntimeErrors(runtimeErrors);
});

test('validated hero maximum HP is used by battle and current HP is clamped', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1110);
  await page.evaluate(() => {
    const world = window.__g.scene;
    world.save.heroMaxHp = 200;
    world.save.heroHp = 175;
    world.startBattle(['bandit'], 'HP CONTRACT CHECK', null, 'road');
  });
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('battle');
  await expect.poll(() => page.evaluate(() => ({ hp: window.__g.scene.hero.hp, maxHp: window.__g.scene.hero.maxHp })))
    .toEqual({ hp: 175, maxHp: 200 });
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
  save.version = 4;
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

test('missing, duplicate, unknown, and malformed settlement entries are rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1112);
  const base = await currentSave(page);
  const cases = [
    ['missing', value => value.settlements.pop()],
    ['duplicate', value => { value.settlements[1].id = value.settlements[0].id; }],
    ['unknown', value => { value.settlements[0].id = 'invented'; }],
    ['non-boolean occupied', value => { value.settlements[0].occupied = 'yes'; }],
    ['party occupying an unknown settlement', value => {
      value.parties = [{ camp: 'c1', x: 100, y: 100, comp: ['bandit'], home: { x: 1050, y: 1500 }, occupying: 'invented' }];
    }],
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
    ['party missing home', value => { value.parties = [{ camp: 'c1', x: 100, y: 100, comp: ['bandit'] }]; }],
    ['hero maximum too large', value => { value.heroMaxHp = 10001; }],
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
