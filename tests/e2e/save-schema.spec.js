import { test, expect } from '@playwright/test';
import {
  collectRuntimeErrors, assertNoRuntimeErrors, openPlayerGame as openPlayerGameWith,
} from './test-helpers.js';
import { WORLD } from '../../src/data.js';

// This suite owns its own clear key so it cannot wipe the other persistence suite's slot.
const openPlayerGame = (page, runtimeErrors) => openPlayerGameWith(page, runtimeErrors, 'qa-clear-save');

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

test('fresh run stores version 5 with neutral ownership and empty progression', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1101);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('bf_save')));
  expect(stored.version).toBe(5);
  expect(stored.camps.map(camp => camp.id)).toEqual(['c1', 'c2', 'c3', 'strong']);
  expect(stored.settlements).toEqual([
    { id: 'ashford', occupied: false, owner: 'neutral' },
    { id: 'brindle', occupied: false, owner: 'neutral' },
    { id: 'coldwell', occupied: false, owner: 'neutral' },
    { id: 'keep', occupied: false, owner: 'neutral' },
  ]);
  expect(stored.stats).toEqual({
    won: 0, kills: 0, lost: 0, playT: expect.any(Number),
    battlesLost: 0, goldEarned: 0, goldSpent: 0, captures: 0,
  });
  // Plan 029: a fresh campaign has taken no perks, flies the plain banner, and carries no
  // blooded men. Perk POINTS are deliberately absent from the schema — they are derived.
  expect(stored.perks).toEqual([]);
  expect(stored.banner).toBe(0);
  expect(stored.troops.every(t => t.vet === undefined)).toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});

test('valid unversioned save migrates defaults and is rewritten as version 5', async ({ page }) => {
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
  delete legacy.perks;   // Plan 029 (v5) fields: an unversioned shape predates them
  delete legacy.banner;

  await reloadWithRealSave(page, legacy);
  const migratedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(migratedBeforeContinue.version).toBe(5);
  expect(migratedBeforeContinue.parties).toBe(null);
  expect(migratedBeforeContinue.heroHp).toBe(120);
  expect(migratedBeforeContinue.heroMaxHp).toBe(120);
  expect(migratedBeforeContinue.settlements).toEqual([
    { id: 'ashford', occupied: false, owner: 'neutral' },
    { id: 'brindle', occupied: false, owner: 'neutral' },
    { id: 'coldwell', occupied: false, owner: 'neutral' },
    { id: 'keep', occupied: false, owner: 'neutral' },
  ]);
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  const migrated = await page.evaluate(() => ({
    save: structuredClone(window.__g.scene.save),
    stored: JSON.parse(localStorage.getItem('bf_save')),
  }));
  expect(migrated.save.version).toBe(5);
  expect(migrated.save.heroHp).toBe(120);
  expect(migrated.save.heroMaxHp).toBe(120);
  expect(migrated.save.armyCap).toBe(12);
  expect(migrated.save.won).toBe(false);
  expect(migrated.save.parties.length).toBeGreaterThan(0);
  expect(migrated.save.runSeed).toBe(777);
  expect(migrated.save.stats).toEqual({
    won: 0, kills: 0, lost: 0, playT: expect.any(Number),
    battlesLost: 0, goldEarned: 0, goldSpent: 0, captures: 0,
  });
  expect(migrated.save.hard).toBe(false);
  expect(migrated.save.battleCount).toBe(0);
  expect(migrated.save.perks).toEqual([]);
  expect(migrated.save.banner).toBe(0);
  expect(migrated.save.settlements).toEqual([
    { id: 'ashford', occupied: false, owner: 'neutral' },
    { id: 'brindle', occupied: false, owner: 'neutral' },
    { id: 'coldwell', occupied: false, owner: 'neutral' },
    { id: 'keep', occupied: false, owner: 'neutral' },
  ]);
  expect(migrated.stored.version).toBe(5);
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
  delete legacy.perks;
  delete legacy.banner;
  await reloadWithRealSave(page, legacy);
  const migrated = await page.evaluate(() => window.__g.loadRun());
  expect(migrated.version).toBe(5);
  expect(migrated.parties).toEqual([{
    camp: 'c1', x: 1200, y: 1500, comp: ['bandit'], home: { x: 1050, y: 1500 }, waryT: 2, clashT: 0,
  }]);
  assertNoRuntimeErrors(runtimeErrors);
});

test('version-2 save migrates to version 5 with every settlement unowned, safe for world construction', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1111);
  const legacy = await currentSave(page);
  legacy.version = 2;
  delete legacy.settlements; // version 2 never had this field
  delete legacy.perks;       // nor these, which arrived with version 5
  delete legacy.banner;
  await reloadWithRealSave(page, legacy);
  const migratedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(migratedBeforeContinue.version).toBe(5);
  expect(migratedBeforeContinue.settlements).toEqual([
    { id: 'ashford', occupied: false, owner: 'neutral' },
    { id: 'brindle', occupied: false, owner: 'neutral' },
    { id: 'coldwell', occupied: false, owner: 'neutral' },
    { id: 'keep', occupied: false, owner: 'neutral' },
  ]);
  await page.keyboard.press('c');
  // "immediately safe for world construction": the world must boot from the migrated save
  // without a runtime error, and the settlements it exposes must match what was migrated.
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  const restored = await page.evaluate(() => ({
    version: window.__g.scene.save.version,
    settlements: window.__g.scene.save.settlements,
  }));
  expect(restored.version).toBe(5);
  expect(restored.settlements).toEqual(migratedBeforeContinue.settlements);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a version-3 save migrates ownership, raid intent, and summary counters to version 5', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1113);
  const v3 = await currentSave(page);
  v3.version = 3;
  // strip every v4-only field: a genuine v3 save predates ownership, raid intent
  // and the summary counters
  v3.settlements = v3.settlements.map(({ id, occupied }) => ({ id, occupied }));
  v3.settlements.find(s => s.id === 'ashford').occupied = true;
  for (const p of v3.parties || []) { delete p.raid; delete p.raidKind; }
  delete v3.perks;
  delete v3.banner;
  delete v3.stats.battlesLost;
  delete v3.stats.goldEarned;
  delete v3.stats.goldSpent;
  delete v3.stats.captures;
  await reloadWithRealSave(page, v3);
  const migrated = await page.evaluate(() => window.__g.loadRun());
  expect(migrated.version).toBe(5);
  expect(migrated.settlements).toEqual([
    { id: 'ashford', occupied: true, owner: 'neutral' },
    { id: 'brindle', occupied: false, owner: 'neutral' },
    { id: 'coldwell', occupied: false, owner: 'neutral' },
    { id: 'keep', occupied: false, owner: 'neutral' },
  ]);
  expect(migrated.stats).toEqual({
    won: v3.stats.won, kills: v3.stats.kills, lost: v3.stats.lost, playT: expect.any(Number),
    battlesLost: 0, goldEarned: 0, goldSpent: 0, captures: 0,
  });
  // no party grew a raid out of thin air
  expect(migrated.parties.every(p => p.raid === undefined)).toBe(true);
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  // the occupied settlement still blocks service after the migration
  const ashford = WORLD.settlements.find(x => x.id === 'ashford');
  const suspended = await page.evaluate(({ sx, sy }) => {
    const world = window.__g.scene;
    world.hero.x = sx; world.hero.y = sy;
    return world.isSettlementOccupied({ id: 'ashford', x: sx, y: sy });
  }, { sx: ashford.x, sy: ashford.y });
  expect(suspended).toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a version-3 save with a party carrying raid is rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1116);
  const v3 = await currentSave(page);
  v3.version = 3;
  // a genuine v3 shape predates ownership, raid intent and the summary counters
  v3.settlements = v3.settlements.map(({ id, occupied }) => ({ id, occupied }));
  delete v3.perks;
  delete v3.banner;
  delete v3.stats.battlesLost;
  delete v3.stats.goldEarned;
  delete v3.stats.goldSpent;
  delete v3.stats.captures;
  // raid state did not exist before v4; a legacy party carrying it must be refused,
  // not silently accepted the way a hand-edited or tampered save could smuggle it through.
  v3.parties = [{ camp: 'c1', x: 100, y: 100, comp: ['bandit'], raid: 'brindle' }];
  const result = await rejectRealSave(page, v3);
  expect(result).toEqual({ loaded: null, stored: null });
  assertNoRuntimeErrors(runtimeErrors);
});

test('a version-3 save with a party carrying raidKind is rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1117);
  const v3 = await currentSave(page);
  v3.version = 3;
  v3.settlements = v3.settlements.map(({ id, occupied }) => ({ id, occupied }));
  delete v3.perks;
  delete v3.banner;
  delete v3.stats.battlesLost;
  delete v3.stats.goldEarned;
  delete v3.stats.goldSpent;
  delete v3.stats.captures;
  // raidKind alone (no raid target) is still v4-only state and must be refused on
  // a legacy party, the same as a bare raid target.
  v3.parties = [{ camp: 'c1', x: 100, y: 100, comp: ['bandit'], raidKind: 'regional' }];
  const result = await rejectRealSave(page, v3);
  expect(result).toEqual({ loaded: null, stored: null });
  assertNoRuntimeErrors(runtimeErrors);
});

test('a current-version save with a party carrying raid and raidKind still parses and round-trips', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1118);
  const save = await currentSave(page);
  save.version = 5;
  save.parties = [{
    camp: 'c1', x: 100, y: 100, comp: ['bandit'], home: { x: 1050, y: 1500 },
    waryT: 0, clashT: 0, raid: 'brindle', raidKind: 'regional',
  }];
  await reloadWithRealSave(page, save);
  const parsedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(parsedBeforeContinue.parties).toEqual(save.parties);
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  const restored = await page.evaluate(() => window.__g.scene.save.parties);
  expect(restored).toEqual(save.parties);
  assertNoRuntimeErrors(runtimeErrors);
});

test('complete version-5 save round-trips nested state without losing fields', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1103);
  const save = await currentSave(page);
  save.version = 5;
  save.gold = 731;
  save.heroHp = 87;
  save.heroMaxHp = 140;
  // Plan 029: a blooded roster. The archer is an Elite (vet 7), which the banner at stage 1
  // allows, and his hp is above the BASE 60 because a ranked body really has more — the
  // validator's bound is the ranked maximum, so this is the field that proves it.
  save.troops = [
    { type: 'spear', hp: 73, vet: 3 },
    { type: 'archer', hp: 70, vet: 7 },
    { type: 'knight' },
  ];
  save.perks = ['setSpears', 'warhorn', 'hammerAnvil'];
  save.banner = 1;
  // A knight is two places in the column now, so three bodies cost four slots.
  save.armyCap = 13;
  save.camps = [
    { id: 'c1', razed: false, garrison: ['bandit', 'wolf'] },
    { id: 'c2', razed: true },
    { id: 'c3', razed: false, garrison: ['brute'] },
    { id: 'strong', razed: false },
  ];
  save.settlements = [
    { id: 'ashford', occupied: true, owner: 'player', spec: 'barracks' },
    { id: 'brindle', occupied: false, owner: 'player' },
    { id: 'coldwell', occupied: false, owner: 'neutral' },
    { id: 'keep', occupied: false, owner: 'neutral' },
  ];
  save.x = 1711;
  save.y = 944;
  save.parties = [
    { camp: 'c1', x: 1811, y: 984, comp: ['bandit', 'wolf'], home: { x: 1600, y: 900 }, waryT: 8, clashT: 0 },
    { camp: 'c2', x: 700, y: 1150, comp: ['bandit'], home: { x: 1850, y: 500 }, waryT: 0, clashT: 0, occupying: 'coldwell' },
    { camp: 'c3', x: 900, y: 400, comp: ['wolf'], home: { x: 2350, y: 1150 }, waryT: 0, clashT: 0, raid: 'brindle', raidKind: 'regional' },
  ];
  save.runSeed = 4422;
  save.stats = { won: 2, kills: 19, lost: 3, playT: 47.5, battlesLost: 1, goldEarned: 300, goldSpent: 120, captures: 2 };
  save.hard = true;
  save.battleCount = 9;
  save.toast = 'Keep the banner high';
  await reloadWithRealSave(page, save);
  const parsedBeforeContinue = await page.evaluate(() => window.__g.loadRun());
  expect(parsedBeforeContinue.toast).toBe('Keep the banner high');
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  const restored = await page.evaluate(() => structuredClone(window.__g.scene.save));
  expect(restored.version).toBe(5);
  expect(restored.gold).toBe(731);
  expect(restored.heroHp).toBe(87);
  expect(restored.heroMaxHp).toBe(140);
  expect(restored.troops).toEqual([
    { type: 'spear', hp: 73, vet: 3 },
    { type: 'archer', hp: 70, vet: 7 },
    { type: 'knight' },
  ]);
  expect(restored.perks).toEqual(['setSpears', 'warhorn', 'hammerAnvil']);
  expect(restored.banner).toBe(1);
  expect(restored.camps).toEqual(save.camps);
  expect(restored.settlements).toEqual(save.settlements);
  expect(restored.x).toBe(1711);
  expect(restored.y).toBe(944);
  expect(restored.parties).toEqual(save.parties);
  expect(restored.runSeed).toBe(4422);
  expect(restored.stats).toEqual(save.stats);
  expect(restored.hard).toBe(true);
  expect(restored.battleCount).toBe(9);
  expect(restored.toast).toBe(null);
  assertNoRuntimeErrors(runtimeErrors);
});

// ---------------------------------------------------------------- Plan 029: v4 -> v5
// Three properties, and each is a rule the plan states rather than a shape check:
//   * a v4 campaign migrates with empty progression and every man unblooded;
//   * a v4 shape carrying any v5-only field is REFUSED, matching how buildParties refuses
//     `raid` on a pre-v4 party — that pattern is what stops a hand-edited or tampered save
//     smuggling state through a version it predates;
//   * a v4 army that no longer fits the new SLOT arithmetic is grandfathered rather than
//     lost, because refusing a legitimate save is worse than widening its cap.
test('a version-4 save migrates to version 5 with empty progression and unblooded troops', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1120);
  const v4 = await currentSave(page);
  v4.version = 4;
  v4.troops = [{ type: 'spear' }, { type: 'archer', hp: 40 }];
  v4.stats.captures = 2; // two settlements already taken before the perk system existed
  delete v4.perks;
  delete v4.banner;
  await reloadWithRealSave(page, v4);
  const migrated = await page.evaluate(() => window.__g.loadRun());
  expect(migrated.version).toBe(5);
  expect(migrated.perks).toEqual([]);
  expect(migrated.banner).toBe(0);
  expect(migrated.troops).toEqual([{ type: 'spear' }, { type: 'archer', hp: 40 }]);
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  // The two captures it already banked are re-derived into two perk choices, so a migrated
  // campaign collects what it earned before the system existed rather than losing it.
  const offered = await page.evaluate(async () => {
    // NOT window.game: this suite drives a REAL player save and must never touch the
    // test slot. The progression module is pure, so importing it here is free.
    const { perkChoiceDue } = await import('/src/progression.js');
    return {
      due: perkChoiceDue(window.__g.scene.save),
      kind: window.__g.scene.screen && window.__g.scene.screen.kind,
    };
  });
  expect(offered.due).toBe(true);
  expect(offered.kind).toBe('perk');
  assertNoRuntimeErrors(runtimeErrors);
});

test('a version-4 save carrying any v5-only progression field is rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1121);
  const base = await currentSave(page);
  base.version = 4;
  delete base.perks;
  delete base.banner;
  const cases = [
    ['perks', value => { value.perks = ['setSpears']; }],
    ['empty perks', value => { value.perks = []; }],
    ['banner', value => { value.banner = 1; }],
    ['troop vet', value => { value.troops = [{ type: 'spear', vet: 3 }]; }],
  ];
  for (const [name, mutate] of cases) {
    const candidate = structuredClone(base);
    mutate(candidate);
    const result = await rejectRealSave(page, candidate);
    expect(result, name).toEqual({ loaded: null, stored: null });
  }
  assertNoRuntimeErrors(runtimeErrors);
});

test('a version-4 knight army is grandfathered past the new two-slot cost', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1122);
  const v4 = await currentSave(page);
  v4.version = 4;
  // The exact army the audit called optimal: twelve knights inside a cap of twelve. Under
  // the new arithmetic that is 24 places in the column, and refusing the save would delete
  // a legitimate campaign for a rule that did not exist when it was written.
  v4.troops = Array.from({ length: 12 }, () => ({ type: 'knight' }));
  v4.armyCap = 12;
  delete v4.perks;
  delete v4.banner;
  await reloadWithRealSave(page, v4);
  const migrated = await page.evaluate(() => window.__g.loadRun());
  expect(migrated.version).toBe(5);
  expect(migrated.troops).toHaveLength(12);
  expect(migrated.armyCap).toBe(24); // widened to fit what the player already had
  // The grandfather exists for legal armies the SLOT rule outgrew, not for shapes v4
  // itself refused: a cap below the BODY count was malformed under every version, and
  // widening it would reward hand-editing with a bigger army.
  const v4bad = structuredClone(v4);
  v4bad.troops = Array.from({ length: 13 }, () => ({ type: 'knight' }));
  expect(await rejectRealSave(page, v4bad)).toEqual({ loaded: null, stored: null });
  assertNoRuntimeErrors(runtimeErrors);
});

test('invalid version-5 progression shapes are rejected', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1123);
  const base = await currentSave(page);
  const cases = [
    ['unknown perk', value => { value.perks = ['invented']; }],
    ['duplicate perk', value => { value.perks = ['setSpears', 'setSpears']; }],
    ['perks not an array', value => { value.perks = 'setSpears'; }],
    // A perk exists only where a milestone paid for it — this fresh save has earned zero
    // points — and a tier only opens over perks ALREADY taken, whatever the budget says.
    ['perk with no milestone earned', value => { value.perks = ['setSpears']; }],
    ['tier-2 perk taken first', value => { value.stats.captures = 1; value.perks = ['hammerAnvil']; }],
    ['banner above the top stage', value => { value.banner = 3; }],
    ['negative banner', value => { value.banner = -1; }],
    ['fractional vet', value => { value.troops = [{ type: 'spear', vet: 1.5 }]; }],
    ['negative vet', value => { value.troops = [{ type: 'spear', vet: -1 }]; }],
    // The banner is the ceiling on rank, so a record claiming a rank this banner cannot
    // teach is a tampered save rather than a legal one.
    ['rank above the banner ceiling', value => { value.banner = 0; value.troops = [{ type: 'spear', vet: 7 }]; }],
    // A veteran's hp bound is his RANKED maximum, and an unblooded body's is the base.
    ['unblooded troop above base hp', value => { value.troops = [{ type: 'spear', hp: 101 }]; }],
    ['veteran above his ranked maximum', value => { value.banner = 1; value.troops = [{ type: 'spear', vet: 3, hp: 113 }]; }],
    ['army cap below the slots in use', value => {
      value.troops = [{ type: 'knight' }, { type: 'knight' }, { type: 'knight' }, { type: 'knight' },
        { type: 'knight' }, { type: 'knight' }, { type: 'knight' }];
      value.armyCap = 12; // 14 slots in use
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

test('a veteran at his ranked maximum hit points loads', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1124);
  const save = await currentSave(page);
  save.banner = 1;
  // 100 base x the Veteran multiplier (1.12) is exactly 112, and the validator's bound is
  // that number rather than the base 100 — a saved veteran must not fail to load.
  save.troops = [{ type: 'spear', vet: 3, hp: 112 }];
  save.armyCap = 12;
  await reloadWithRealSave(page, save);
  const parsed = await page.evaluate(() => window.__g.loadRun());
  expect(parsed.troops).toEqual([{ type: 'spear', hp: 112, vet: 3 }]);
  assertNoRuntimeErrors(runtimeErrors);
});

// A perk that shifts the rank thresholds shifts the hit-point bound with them, and the
// validator has to know that or it refuses a save the game itself just wrote. Found by
// reading rather than by a failure, which is exactly why it gets a fixture.
test('the Drillyard perk shifts the validator hit-point bound, not just the in-battle rank', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1125);
  const base = await currentSave(page);
  base.banner = 1;
  // Six battles is rank 1 (Veteran, 112 hp) normally and rank 2 (Elite, 125 hp) with
  // Drillyard, because the perk brings every threshold one battle closer.
  base.troops = [{ type: 'spear', vet: 6, hp: 125 }];
  base.armyCap = 12;
  // Perks are budget-checked against milestones, so the fixture carries the five that
  // pay for its five perks: three razed camps plus two captures.
  base.camps.forEach(c => { if (c.id !== 'strong') c.razed = true; });
  base.stats.captures = 2;

  const withoutPerk = structuredClone(base);
  withoutPerk.perks = [];
  expect(await rejectRealSave(page, withoutPerk)).toEqual({ loaded: null, stored: null });

  const withPerk = structuredClone(base);
  withPerk.perks = ['setSpears', 'steadyHands', 'warhorn', 'hammerAnvil', 'drillyard'];
  await reloadWithRealSave(page, withPerk);
  const parsed = await page.evaluate(() => window.__g.loadRun());
  expect(parsed).not.toBe(null);
  expect(parsed.troops).toEqual([{ type: 'spear', hp: 125, vet: 6 }]);
  assertNoRuntimeErrors(runtimeErrors);
});

// The other direction of the same shift, and the reason the rank-vs-banner check reads
// the UNSHIFTED rank: at banner 0 accrual parks a man at exactly vet 6 (rank 2 would
// exceed cap 1), and taking Drillyard afterwards makes the SHIFTED thresholds call that
// same vet 6 an Elite. A validator checking the shifted rank against the ceiling refused
// the save the game itself wrote — and a refused slot is erased, so taking a tier-3 perk
// destroyed the campaign on the next launch.
test('a veteran parked at the banner ceiling still loads after Drillyard shifts the thresholds', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, 1126);
  const save = await currentSave(page);
  save.banner = 0;
  save.troops = [{ type: 'spear', vet: 6 }];
  save.armyCap = 12;
  // Five milestones pay for the five perks: three razed camps plus two captures.
  save.camps.forEach(c => { if (c.id !== 'strong') c.razed = true; });
  save.stats.captures = 2;
  save.perks = ['setSpears', 'steadyHands', 'warhorn', 'hammerAnvil', 'drillyard'];
  await reloadWithRealSave(page, save);
  const parsed = await page.evaluate(() => window.__g.loadRun());
  expect(parsed).not.toBe(null);
  expect(parsed.troops).toEqual([{ type: 'spear', vet: 6 }]);
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
  save.version = 6;
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
