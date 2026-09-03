// Hero movement against terrain. `moveBlocked` deflects instead of gluing: a held
// direction key into a river bank must TRAVEL along the bank, because a damped hero drops
// under BALANCE.worldWakeSpeed and freezes the campaign (Plan 023) — a held key used to buy
// 57 of 60 seconds pinned to the bank with only the wordless freeze wash to explain it.
// The freeze mechanic itself lives in world-freeze.spec.js; this file covers the movement
// side, including the guard that the fix did NOT buy motion by weakening the freeze.
import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

const SEED = 1234;

async function boot(page) {
  await page.goto('/');
  await page.evaluate((seed) => window.game.scenario('world', { seed }), SEED);
}

// Derive the jam site from the canonical terrain (world.riverLines / world.bridgePts are
// buildTerrainGeometry's own outputs, the single source) rather than pinning a literal:
// the sampled river point farthest from any bridge, stepped west until the ground is clear.
// From there `moveRight` pushes the hero straight into the bank on ONE axis, which is the
// exact input that used to stall — with a single-axis press, one of moveBlocked's
// axis-separated fallbacks is the hero's current position and "succeeded" without moving.
const JAM_SITE = `(() => {
  const world = window.__g.scene;
  let best = null;
  for (const p of world.riverLines[0]) {
    if (p[1] < 300 || p[1] > world.H - 300) continue;
    let d = Infinity;
    for (const [bx, by] of world.bridgePts) d = Math.min(d, Math.hypot(p[0] - bx, p[1] - by));
    if (!best || d > best.d) best = { p, d };
  }
  let x = best.p[0], y = best.p[1];
  while (x > 80 && world.blockedAt(x, y)) x -= 2;
  return { x: x - 6, y, bridgeDist: best.d };
})()`;

test('a held key against a river bank travels along it instead of jamming', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(`(() => {
    const g = window.__g, world = g.scene;
    const site = ${JAM_SITE};
    world.parties.length = 0; // isolate from an incidental clash on the way down the bank
    world.hero.x = site.x; world.hero.y = site.y; world.hero.vx = 0; world.hero.vy = 0;
    const from = { x: world.hero.x, y: world.hero.y };
    window.game.action('moveRight', true);
    let flowingTicks = 0, movingTicks = 0, wallCueTicks = 0, path = 0;
    let prev = { x: world.hero.x, y: world.hero.y };
    for (let i = 0; i < 600; i++) { // 10s at the fixed timestep
      g.update(1 / 60);
      const stepLen = Math.hypot(world.hero.x - prev.x, world.hero.y - prev.y);
      if (stepLen > 0.05) movingTicks++;
      path += stepLen;
      if (world.timeFlowing()) flowingTicks++;
      if (world.heroWallT > 0) wallCueTicks++;
      prev = { x: world.hero.x, y: world.hero.y };
    }
    window.game.action('moveRight', false);
    return {
      site, path, flowingTicks, movingTicks, wallCueTicks,
      travelled: Math.hypot(world.hero.x - from.x, world.hero.y - from.y),
      insideTerrain: world.blockedAt(world.hero.x, world.hero.y),
    };
  })()`);
  // eslint-disable-next-line no-console
  console.log('bank slide:', JSON.stringify(result));
  expect(result.insideTerrain).toBe(false); // deflected along the bank, never pushed into it
  expect(result.travelled).toBeGreaterThan(200);
  expect(result.path).toBeGreaterThan(400);
  expect(result.movingTicks).toBeGreaterThan(540); // 90% of the held ticks actually moved
  expect(result.flowingTicks).toBeGreaterThan(540); // ...so the campaign clock stayed live
  // ...and the map knew it was riding a collider, which is what the freeze cue reads to name
  // the reason on the ticks a rider really is walled in with nowhere to go.
  expect(result.wallCueTicks).toBeGreaterThan(60);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('the freeze cue names the barrier only while the rider is walled in and pushing', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // The wash alone says "held"; the walled-in-and-still-pushing case is the one stall it
  // cannot explain, so drawFreezeCue adds a line there and NOWHERE else. Presentation reads
  // `heroWallT`/`heroWallRiver` and never writes them, so driving the draw from set values
  // is exactly the contract — and it is why the parked-hero world baselines cannot move.
  const result = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    const painted = [];
    const draw = (stale, wallT, river) => {
      world.staleT = stale; world.heroWallT = wallT; world.heroWallRiver = river;
      const ctx = g.ctx || document.querySelector('#game').getContext('2d');
      const original = ctx.fillText.bind(ctx);
      const seen = [];
      ctx.fillText = (text, ...rest) => { seen.push(text); return original(text, ...rest); };
      g.draw();
      ctx.fillText = original;
      painted.push(seen.filter(t => typeof t === 'string' && t.includes('bars the way')));
    };
    draw(1, 0, false);    // parked, no input: wash only, which is what the baselines capture
    draw(0, 1, true);     // riding a bank with time flowing: the cue itself is not drawn
    draw(1, 1, true);     // walled in at a river with a key held
    draw(1, 1, false);    // walled in against solid ground
    world.staleT = 0; world.heroWallT = 0; world.heroWallRiver = false;
    return painted;
  });
  expect(result[0]).toEqual([]);
  expect(result[1]).toEqual([]);
  expect(result[2]).toEqual(['The river bars the way — cross at a bridge or ford']);
  expect(result[3]).toEqual(['Broken ground bars the way — ride around it']);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('pressing into terrain keeps the campaign alive without softening the freeze', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // Two halves of one rule. The slide keeps realized speed above BALANCE.worldWakeSpeed, so
  // `timeFlowing()` stays a pure speed test — it must NOT learn about held input, or a hero
  // parked against a wall with a key down would keep the world alive while standing still.
  const result = await page.evaluate(`(() => {
    const g = window.__g, world = g.scene;
    const site = ${JAM_SITE};
    world.parties.length = 0;
    world.hero.x = site.x; world.hero.y = site.y; world.hero.vx = 0; world.hero.vy = 0;
    window.game.action('moveRight', true);
    const timeBefore = world.time;
    for (let i = 0; i < 300; i++) g.update(1 / 60);
    const pressing = { advanced: world.time - timeBefore, speed: world.heroSpeed, stale: world.staleT };
    // Now pin the hero: no input at all, from the same spot. It must freeze exactly as
    // world-freeze.spec.js demands.
    window.game.action('moveRight', false);
    world.hero.x = site.x; world.hero.y = site.y; world.hero.vx = 0; world.hero.vy = 0;
    while (world.timeFlowing()) g.update(1 / 60);
    const parkedAt = world.time;
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    return {
      pressing,
      parked: { advanced: world.time - parkedAt, frozen: world.isTimeFrozen(), stale: world.staleT,
        speed: world.heroSpeed, wallCue: world.heroWallT },
    };
  })()`);
  expect(result.pressing.advanced).toBeGreaterThan(4.5); // ~5s of held input, world awake
  expect(result.pressing.speed).toBeGreaterThan(40);
  expect(result.pressing.stale).toBe(0);
  expect(result.parked.advanced).toBe(0);
  expect(result.parked.frozen).toBe(true);
  expect(result.parked.speed).toBe(0);
  expect(result.parked.stale).toBe(1);
  expect(result.parked.wallCue).toBe(0); // no input held => no "the river bars the way" line
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
