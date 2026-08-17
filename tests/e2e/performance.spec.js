import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

async function startWorld(page, seed = 42) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(seedValue => window.game.scenario('world', { seed: seedValue }), seed);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
}

test('scheduler coalesces high-refresh callbacks and suppresses hidden watchdog draws', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    let now = 0;
    const raf = [];
    const intervals = [];
    window.__perfClock = () => now;
    window.__perfRaf = raf;
    window.__perfIntervals = intervals;
    window.requestAnimationFrame = callback => { raf.push(callback); return raf.length; };
    window.setInterval = callback => { intervals.push(callback); return intervals.length; };
    window.performance.now = () => now;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__perfHidden });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__perfRaf && window.__perfIntervals);
  const result = await page.evaluate(() => {
    let updates = 0, draws = 0;
    const game = window.__g;
    const update = game.update.bind(game), draw = game.draw.bind(game);
    game.update = dt => { updates++; return update(dt); };
    game.draw = () => { draws++; return draw(); };
    let callback = window.__perfRaf.shift();
    for (let i = 0; i < 144; i++) {
      window.__perfClock = () => (i + 1) * (1000 / 144);
      callback((i + 1) * (1000 / 144));
      callback = window.__perfRaf.shift();
    }
    const beforeHidden = draws;
    window.__perfHidden = true;
    window.__perfClock = () => 1000;
    window.__perfIntervals[0]();
    return { updates, draws, beforeHidden, rafs: window.__perfRaf.length };
  });
  expect(result.updates).toBeGreaterThanOrEqual(58);
  expect(result.updates).toBeLessThanOrEqual(62);
  expect(result.draws).toBeLessThanOrEqual(result.updates + 2);
  expect(result.draws).toBeLessThan(80);
  expect(result.beforeHidden).toBeGreaterThan(0);
  expect(result.draws).toBe(result.beforeHidden);
  await expect.poll(() => runtimeErrors).toEqual([]);
});

test('world rendering reuses static paths and culls offscreen scenery', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await startWorld(page);
  const result = await page.evaluate(() => {
    const world = window.__g.scene;
    const ctx = document.getElementById('game').getContext('2d');
    let beginPath = 0;
    const original = CanvasRenderingContext2D.prototype.beginPath;
    CanvasRenderingContext2D.prototype.beginPath = function (...args) { beginPath++; return original.apply(this, args); };
    const cache = world._staticPaths;
    const sentinel = { kind: 'tree', x: 999999, y: 999999, s: 20 };
    world.scenery.push(sentinel);
    const originalSize = sentinel.s;
    for (let i = 0; i < 20; i++) window.__g.draw();
    CanvasRenderingContext2D.prototype.beginPath = original;
    return { beginPath, cache, cacheAgain: world._staticPaths, sentinelSize: sentinel.s, originalSize, ctx: !!ctx };
  });
  expect(result.beginPath).toBeLessThan(10000);
  expect(result.cache).toBeTruthy();
  expect(result.cacheAgain).toBe(result.cache);
  expect(result.sentinelSize).toBe(result.originalSize);
  expect(runtimeErrors).toEqual([]);
});

test('battle rendering reuses scratch storage and static terrain', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => window.game.scenario('battle_big'));
  const result = await page.evaluate(() => {
    const battle = window.__g.scene;
    let beginPath = 0;
    const original = CanvasRenderingContext2D.prototype.beginPath;
    CanvasRenderingContext2D.prototype.beginPath = function (...args) { beginPath++; return original.apply(this, args); };
    const refs = {
      alerts: battle._alerts,
      drawEntries: battle._drawEntries,
      woundedEntries: battle._woundedEntries,
      drawnBars: battle._drawnBars,
      static: battle._staticLayer || battle._staticPaths,
      allUnits: battle._allUnits,
    };
    for (let i = 0; i < 20; i++) window.__g.draw();
    CanvasRenderingContext2D.prototype.beginPath = original;
    return {
      beginPath,
      same: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v === (k === 'static' ? (battle._staticLayer || battle._staticPaths) : battle['_' + k])])),
      teams: [...battle.troops].every(t => t.team === 'friendly') && [...battle.enemies].every(e => e.team === 'enemy'),
      counts: { troops: battle.troops.length, enemies: battle.enemies.length },
    };
  });
  expect(result.beginPath).toBeLessThan(9000);
  expect(Object.values(result.same).every(Boolean)).toBeTruthy();
  expect(result.teams).toBeTruthy();
  expect(runtimeErrors).toEqual([]);
});

test('party replans are staggered and reuse goal visibility', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await startWorld(page, 424242);
  const result = await page.evaluate(() => {
    const world = window.__g.scene;
    const base = world.parties[0];
    world.parties = Array.from({ length: 6 }, (_, i) => ({
      camp: base.camp, x: 820 + i * 20, y: 580 + i * 12, vx: 0, vy: 0,
      facing: 0, bob: i, comp: base.comp.slice(), home: { x: 820, y: 580 },
      wander: { x: 2100, y: 1100 }, wanderT: 99, waryT: 0, navT: i * 0.04,
    }));
    const initial = world.parties.map(p => p.navT);
    const original = world.lineClear.bind(world);
    let calls = 0;
    world.lineClear = (...args) => { calls++; return original(...args); };
    const perStep = [];
    for (let i = 0; i < 60; i++) {
      calls = 0;
      window.__g.update(1 / 60);
      perStep.push(calls);
    }
    const cacheRefs = world.parties.map(p => p._navGoalVisibility || p._navVisibility || null);
    const before = calls;
    window.__g.update(1 / 60);
    const after = calls;
    return { initial, perStep, cache: cacheRefs, stableReuse: after <= before + 2 };
  });
  expect(new Set(result.initial.map(v => Math.round(v * 100))).size).toBeGreaterThan(1);
  expect(result.perStep[0]).toBeLessThan(30);
  expect(result.cache.every(Boolean)).toBeTruthy();
  expect(result.stableReuse).toBeTruthy();
  expect(runtimeErrors).toEqual([]);
});
