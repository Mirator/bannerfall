import { test, expect } from '@playwright/test';
import { bootWorld, collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Plan 024 Phase 2: sampleBattlefield(world, approach, seed, fieldW, fieldH) is a pure,
// read-only function — it has no rendering and no scene, so it is imported directly (not
// reached through window.game) the same way stance-balance.spec.js dynamic-imports
// '/src/data.js' for read-only constants. Test positions are chosen against the
// hand-authored river anchors and bridge points in src/world/terrain.js:104-107
// (river 0 near world x~950-1060, bridges at [985,640] and [1055,1655]; river 1 near
// x~2380-2500, bridge at [2437,745]).
// Each test calls bootWorld() itself (a fresh seeded world), so this only repositions the
// hero on the already-booted world.scene and samples — no second world is constructed.
async function sampleAt(page, { x, y, approach = 'E', seed = 12345 }) {
  return page.evaluate(async ({ x, y, approach, seed }) => {
    const world = window.__g.scene;
    world.hero.x = x; world.hero.y = y;
    const { sampleBattlefield } = await import('/src/world/battlefield-brief.js');
    const { FIELD } = await import('/src/battle/constants.js');
    return sampleBattlefield(world, approach, seed, FIELD.W, FIELD.H);
  }, { x, y, approach, seed });
}

test('a hero east of a river gets it on his west side; west of it, the mirror holds', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // River 0 runs roughly x~900-1060 through y~1000. Both positions sit well clear of
  // both of that river's bridges ([985,640], [1055,1655]) so this also exercises the
  // ford-synthesis path required whenever no bridge falls in the sampling window.
  const east = await sampleAt(page, { x: 1150, y: 1000 });
  const west = await sampleAt(page, { x: 750, y: 1000 });

  expect(east.rivers.length).toBe(1);
  expect(east.rivers[0].pts.every(([px]) => px < 1250)).toBe(true); // W/2 = 1250
  expect(east.crossings.length).toBeGreaterThan(0);
  expect(east.crossings.every(c => c.kind === 'ford')).toBe(true);

  expect(west.rivers.length).toBe(1);
  expect(west.rivers[0].pts.every(([px]) => px > 1250)).toBe(true);
  expect(west.crossings.length).toBeGreaterThan(0);
  expect(west.crossings.every(c => c.kind === 'ford')).toBe(true);

  assertNoRuntimeErrors(runtimeErrors);
});

test('rivers.length > 0 always implies crossings.length > 0, bridge or ford', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Near bridge [985, 640]: the bridge branch.
  const withBridge = await sampleAt(page, { x: 1150, y: 640 });
  expect(withBridge.rivers.length).toBeGreaterThan(0);
  expect(withBridge.crossings.length).toBeGreaterThan(0);
  expect(withBridge.crossings.some(c => c.kind === 'bridge')).toBe(true);

  // Away from every bridge on river 0: the synthesised-ford branch.
  const noBridge = await sampleAt(page, { x: 1150, y: 1000 });
  expect(noBridge.rivers.length).toBeGreaterThan(0);
  expect(noBridge.crossings.length).toBeGreaterThan(0);
  expect(noBridge.crossings.every(c => c.kind === 'ford')).toBe(true);

  // Open country: no river, and the implication is vacuously satisfied (not tested by
  // omission — the empty-rivers case is covered by its own scenario below).
  const open = await sampleAt(page, { x: 1700, y: 2100 });
  expect(open.rivers.length).toBe(0);

  assertNoRuntimeErrors(runtimeErrors);
});

test('same world position and seed produce a deep-equal brief', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  const pos = { x: 1150, y: 1000, approach: 'E', seed: 999 };
  const first = await sampleAt(page, pos);
  const second = await sampleAt(page, pos);

  expect(second).toEqual(first);
  assertNoRuntimeErrors(runtimeErrors);
});

test('open country yields no river, no road, and some scrub', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  const open = await sampleAt(page, { x: 1700, y: 2100 });

  expect(open.rivers).toEqual([]);
  expect(open.roads).toEqual([]);
  expect(open.scrub.length).toBeGreaterThan(0);

  assertNoRuntimeErrors(runtimeErrors);
});

test('rock radius is capped so a boulder never reads as a landform', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Plan 024 corrective pass. World rock sizes are s=14-30 (src/world/terrain.js's rock
  // scatter), so the raw mapping `r = s * 1.1 * S` reaches 132 — as large as the smallest
  // hill (130) and larger than a river collision circle (~88). This world position samples a
  // rock whose raw radius would be ~129; confirm it comes back capped well under both.
  const field = await sampleAt(page, { x: 300, y: 1500 });
  expect(field.rocks.length).toBeGreaterThan(0);
  for (const r of field.rocks) expect(r.r).toBeLessThanOrEqual(70);
  expect(field.rocks.some(r => r.r === 70)).toBe(true); // pins the cap: this rock actually hits it

  assertNoRuntimeErrors(runtimeErrors);
});

test('sampleBattlefield reads world without mutating it', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  const result = await page.evaluate(async () => {
    const world = window.__g.scene;
    world.hero.x = 1150; world.hero.y = 1000;
    const before = {
      sceneryLength: world.scenery.length,
      rivers: JSON.parse(JSON.stringify(world.rivers)),
      heroX: world.hero.x, heroY: world.hero.y,
    };
    const { sampleBattlefield } = await import('/src/world/battlefield-brief.js');
    const { FIELD } = await import('/src/battle/constants.js');
    sampleBattlefield(world, 'E', 555, FIELD.W, FIELD.H);
    const after = {
      sceneryLength: world.scenery.length,
      rivers: JSON.parse(JSON.stringify(world.rivers)),
      heroX: world.hero.x, heroY: world.hero.y,
    };
    return { before, after };
  });

  expect(result.after).toEqual(result.before);
  assertNoRuntimeErrors(runtimeErrors);
});
