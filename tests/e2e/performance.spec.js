import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, bootWorld } from './test-helpers.js';

const startWorld = (page, seed = 42) => bootWorld(page, { seed });

test('scheduler coalesces high-refresh callbacks and suppresses hidden watchdog draws', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    const raf = [];
    const intervals = [];
    window.__perfState = { now: 0, hidden: false };
    window.__perfRaf = raf;
    window.__perfIntervals = intervals;
    window.requestAnimationFrame = callback => { raf.push(callback); return raf.length; };
    window.setInterval = callback => { intervals.push(callback); return intervals.length; };
    window.performance.now = () => window.__perfState.now;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__perfState.hidden });
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
      window.__perfState.now = (i + 1) * (1000 / 144);
      callback(window.__perfState.now);
      callback = window.__perfRaf.shift();
    }
    const beforeHidden = draws;
    const updatesBeforeWatchdog = updates;
    window.__perfState.hidden = true;
    window.__perfState.now = 1401;
    window.__perfIntervals[0]();
    return { updates, rafUpdates: updatesBeforeWatchdog, draws, beforeHidden, updatesBeforeWatchdog, rafs: window.__perfRaf.length };
  });
  expect(result.rafUpdates).toBeGreaterThanOrEqual(58);
  expect(result.rafUpdates).toBeLessThanOrEqual(62);
  expect(result.draws).toBeLessThanOrEqual(result.updates + 2);
  expect(result.draws).toBeLessThan(80);
  expect(result.beforeHidden).toBeGreaterThan(0);
  expect(result.draws).toBe(result.beforeHidden);
  expect(result.updates).toBeGreaterThan(result.updatesBeforeWatchdog);
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
    const sentinel = { kind: 'rock', x: 999999, y: 999999, s: 20 };
    Object.defineProperty(sentinel, 'rot', { get() { throw new Error('offscreen sentinel was rendered'); } });
    world.scenery.push(sentinel);
    for (let i = 0; i < 20; i++) window.__g.draw();
    CanvasRenderingContext2D.prototype.beginPath = original;
    return { beginPath, cache, cacheAgain: world._staticPaths, ctx: !!ctx };
  });
  expect(result.beginPath).toBeLessThan(10000);
  expect(result.cache).toBeTruthy();
  expect(result.cacheAgain).toBe(result.cache);
  expect(runtimeErrors).toEqual([]);
});

test('world rendering stays within its own budget with hover latched on and a brief open', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await startWorld(page);
  const result = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    world.hero.x = 1600; world.hero.y = 900; // clear of every settlement's safe zone
    // Plan 028 semantic update: this used to be `Math.round(world.myStrength())` bandits,
    // which was 12 on the old headcount scale and would be 5 on the fighting-weight scale.
    // This is a RENDERING BUDGET test — the number that matters is how many tokens and
    // brief rows are drawn, not how strong they are — so the body count is pinned at the
    // 12 it has always measured rather than allowed to halve with the metric change.
    world.parties.length = 0;
    world.parties.push({
      camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: Array.from({ length: 12 }, () => 'bandit'),
      home: { x: world.hero.x, y: world.hero.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
    world.grace = 0;
    g.update(1 / 60); // opens the pre-battle brief
    // Latch the hover pointer on over the hero token (not just the untouched boot
    // default) so the hover panel is actually drawn every frame below too.
    g.camera.x = world.hero.x; g.camera.y = world.hero.y;
    const cx = g.camera.w / 2, cy = g.camera.h / 2;
    window.game.mouse(cx + 4, cy);
    window.game.mouse(cx, cy);
    let beginPath = 0;
    const original = CanvasRenderingContext2D.prototype.beginPath;
    CanvasRenderingContext2D.prototype.beginPath = function (...args) { beginPath++; return original.apply(this, args); };
    for (let i = 0; i < 20; i++) g.draw();
    CanvasRenderingContext2D.prototype.beginPath = original;
    return {
      beginPath,
      screenKind: world.screen && world.screen.kind,
      hoverKind: world.hoverTarget && world.hoverTarget.kind,
    };
  });
  expect(result.screenKind).toBe('brief');
  // Hover is suppressed while a modal is open (world.js draw()), so this exercises the
  // pointer-moved latch's own per-frame coordinate comparison every draw without ever
  // actually drawing the hover panel over the brief.
  expect(result.hoverKind).toBeNull();
  // Its own, separate budget — the existing un-briefed <10000 case (above) stays
  // untouched, since hover there is latched off with no pointer movement at all.
  expect(result.beginPath).toBeLessThan(12000);
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
    for (const unit of [...battle.troops, ...battle.enemies]) unit.hp = unit.maxHp * 0.5;
    battle.enemies[0].windupT = 1;
    window.__g.draw();
    const capacity = {
      draw: battle._drawEntries.length,
      wounded: battle._woundedEntries.length,
      bars: battle._drawnBars.length,
      alerts: battle._alerts.length,
    };
    const refs = {
      alerts: battle._alerts,
      drawEntries: battle._drawEntries,
      woundedEntries: battle._woundedEntries,
      drawnBars: battle._drawnBars,
      static: battle._staticTiles || battle._staticLayer || battle._staticPaths,
      allUnits: battle._allUnits,
      alertEntry: battle._alerts[0],
      drawEntry: battle._drawEntries[0],
      woundedEntry: battle._woundedEntries[0],
      barEntry: battle._drawnBars[0],
      drawEntryPool: battle._drawEntries.slice(),
      woundedEntryPool: battle._woundedEntries.slice(),
      barEntryPool: battle._drawnBars.slice(),
    };
    window.__g.draw();
    const sameEntries = {
      alert: refs.alertEntry === battle._alerts[0],
      draw: battle._drawEntries.includes(refs.drawEntry),
      wounded: refs.woundedEntry === battle._woundedEntries[0],
      bar: refs.barEntry === battle._drawnBars[0],
    };
    const removedTroops = battle.troops.splice(-3);
    const removedEnemies = battle.enemies.splice(-3);
    const removedObstacles = battle.obstacles.splice(-3);
    for (const unit of [...battle.troops, ...battle.enemies]) unit.hp = unit.maxHp;
    battle._alertCount = 0;
    window.__g.draw();
    const shrink = {
      capacityRetained: battle._drawEntries.length === capacity.draw && battle._woundedEntries.length === capacity.wounded && battle._drawnBars.length === capacity.bars,
      drawInactive: battle._drawEntries.length - battle._drawEntriesActive,
      woundedInactive: battle._woundedEntries.length - battle._woundedEntriesActive,
      barsInactive: battle._drawnBars.length - battle._drawnBarsActive,
      drawRefsCleared: battle._drawEntries.slice(battle._drawEntriesActive).every(entry => entry.ref === null),
      woundedRefsCleared: battle._woundedEntries.slice(battle._woundedEntriesActive).every(entry => entry.u === null),
      barsCleared: battle._drawnBars.slice(battle._drawnBarsActive).every(entry => entry.x === 0 && entry.y === 0),
    };
    battle.troops.push(...removedTroops);
    battle.enemies.push(...removedEnemies);
    battle.obstacles.push(...removedObstacles);
    for (const unit of [...battle.troops, ...battle.enemies]) unit.hp = unit.maxHp * 0.5;
    battle.enemies[0].windupT = 1;
    window.__g.draw();
    CanvasRenderingContext2D.prototype.beginPath = original;
    return {
      beginPath,
      same: Object.fromEntries(Object.entries(refs).filter(([k]) => ['alerts', 'drawEntries', 'woundedEntries', 'drawnBars', 'static', 'allUnits'].includes(k)).map(([k, v]) => [k, v === (k === 'static' ? (battle._staticTiles || battle._staticLayer || battle._staticPaths) : battle['_' + k])])),
      sameEntries,
      drawFound: !!refs.drawEntry && battle._drawEntries.includes(refs.drawEntry),
      teams: [...battle.troops].every(t => t.team === 'friendly') && [...battle.enemies].every(e => e.team === 'enemy'),
      counts: { troops: battle.troops.length, enemies: battle.enemies.length },
      shrink,
      regrowDrawIdentity: battle._drawEntries.slice(0, battle._drawEntriesActive).every(entry => refs.drawEntryPool.includes(entry)),
      regrowWoundedIdentity: battle._woundedEntries.slice(0, battle._woundedEntriesActive).every(entry => refs.woundedEntryPool.includes(entry)),
      regrowBarIdentity: battle._drawnBars.slice(0, battle._drawnBarsActive).every(entry => refs.barEntryPool.includes(entry)),
      regrowActive: battle._drawEntriesActive > 0 && battle._woundedEntriesActive > 0 && battle._drawnBarsActive > 0,
    };
  });
  expect(result.beginPath).toBeLessThan(9000);
  expect(Object.values(result.same).every(Boolean)).toBeTruthy();
  expect(Object.values(result.sameEntries).every(Boolean)).toBeTruthy();
  expect(result.teams).toBeTruthy();
  expect(result.shrink.capacityRetained).toBeTruthy();
  expect(result.shrink.drawInactive).toBeGreaterThan(0);
  expect(result.shrink.woundedInactive).toBeGreaterThan(0);
  expect(result.shrink.barsInactive).toBeGreaterThan(0);
  expect(result.shrink.drawRefsCleared).toBeTruthy();
  expect(result.shrink.woundedRefsCleared).toBeTruthy();
  expect(result.shrink.barsCleared).toBeTruthy();
  expect(result.regrowActive).toBeTruthy();
  expect(result.regrowDrawIdentity).toBeTruthy();
  expect(result.regrowWoundedIdentity).toBeTruthy();
  expect(result.regrowBarIdentity).toBeTruthy();
  expect(runtimeErrors).toEqual([]);
});

test('battle spatial queries match the legacy nearest-target semantics', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => window.game.scenario('battle_big'));
  const result = await page.evaluate(() => {
    const battle = window.__g.scene;
    const enemies = battle.enemies;
    enemies.forEach((e, i) => { e.x = 90 + (i * 173) % 1060; e.y = 80 + (i * 97) % 700; });
    battle._enemyGrid.rebuild(enemies);
    const points = [
      [battle.hero.x, battle.hero.y, 1e9], [100, 100, 35], [625, 440, 180], [1180, 820, 1e9],
      [enemies[0].x + 24, enemies[0].y - 11, 80],
    ];
    for (let i = 0; i < 100; i++) points.push([(i * 137) % 2500, (i * 71) % 1760, [24, 90, 1e9][i % 3]]);
    const checks = points.map(([x, y, maxR]) => {
      let expected = null, best = 1e18;
      for (const e of enemies) {
        const d = (x - e.x) ** 2 + (y - e.y) ** 2;
        if (d < maxR * maxR && d < best) { best = d; expected = e; }
      }
      const actual = battle.nearestEnemy(x, y, maxR);
      return expected === actual;
    });
    const tieA = enemies[0], tieB = enemies[1];
    tieA.x = 500; tieA.y = 400; tieB.x = 700; tieB.y = 400;
    for (let i = 2; i < enemies.length; i++) { enemies[i].x = 1100; enemies[i].y = 820; }
    battle._enemyGrid.rebuild(enemies);
    const tieResult = battle.nearestEnemy(600, 400) === tieA;
    const troops = battle.troops;
    battle._friendlyGrid.rebuild(troops);
    const friendlyChecks = points.slice(0, 20).map(([x, y]) => {
      let expected = battle.hero, best = (x - battle.hero.x) ** 2 + (y - battle.hero.y) ** 2;
      for (const t of troops) {
        const d = (x - t.x) ** 2 + (y - t.y) ** 2;
        if (d < best) { best = d; expected = t; }
      }
      return battle.nearestFriendly(x, y).obj === expected;
    });
    const rangedChecks = points.slice(0, 20).map(([x, y], i) => {
      const maxR = i % 2 ? 70 : 1e9;
      let expected = null, best = maxR * maxR;
      for (const t of troops) {
        if (!t.d.ranged) continue;
        const d = (x - t.x) ** 2 + (y - t.y) ** 2;
        if (d < best) { best = d; expected = t; }
      }
      return battle.nearestFriendlyRanged(x, y, maxR) === expected;
    });
    return { checks, tieResult, friendlyChecks, rangedChecks };
  });
  expect(result.checks.every(Boolean)).toBeTruthy();
  expect(result.tieResult).toBeTruthy();
  expect(result.friendlyChecks.every(Boolean)).toBeTruthy();
  expect(result.rangedChecks.every(Boolean)).toBeTruthy();
  expect(runtimeErrors).toEqual([]);
});

test('battle spatial broad phases keep distributed candidate work subquadratic', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; window.setInterval = () => 0; });
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => window.game.scenario('battle_big'));
  const result = await page.evaluate(() => {
    const battle = window.__g.scene;
    const targetMeasurements = [];
    const separationMeasurements = [];
    for (const size of [400, 1000]) {
      const units = [];
      for (let i = 0; i < size; i++) {
        const x = 30 + ((i * 83) % 1190);
        const y = 30 + ((i * 47) % 820);
        units.push({ x, y, d: { radius: 12, ranged: false }, team: i % 2 ? 'enemy' : 'friendly' });
      }
      battle._enemyGrid.clearStats();
      battle._enemyGrid.rebuild(units);
      for (const unit of units) battle.nearestEnemy(unit.x, unit.y);
      targetMeasurements.push({
        size,
        checks: battle._enemyGrid.stats.candidateChecks,
        naive: size * size,
        fraction: battle._enemyGrid.stats.candidateChecks / (size * size),
      });

      battle.troops = units.slice(0, size / 2);
      battle.enemies = units.slice(size / 2);
      battle.obstacles = [{ x: 625, y: 440, r: 30 }];
      battle.hero.x = -500; battle.hero.y = -500;
      battle._unitGrid.clearStats(); battle._obstacleGrid.clearStats();
      battle.updateSeparationPhase(battle.hero);
      const stats = battle.getSpatialStats();
      separationMeasurements.push({
        size,
        checks: stats.separationChecks,
        pairs: stats.separationPairs,
        naive: size * (size - 1) / 2,
        fraction: stats.separationChecks / (size * size),
      });
    }
    return { targetMeasurements, separationMeasurements };
  });
  expect(result.targetMeasurements[0].fraction).toBeLessThan(0.25);
  expect(result.targetMeasurements[1].fraction).toBeLessThan(0.20);
  expect(result.separationMeasurements[0].fraction).toBeLessThan(0.25);
  expect(result.separationMeasurements[1].fraction).toBeLessThan(0.20);
  expect(result.separationMeasurements[1].checks).toBeLessThan(result.separationMeasurements[1].naive * 0.5);
  expect(runtimeErrors).toEqual([]);
});

test('designed-size separation matches an independent brute-force reference', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; window.setInterval = () => 0; });
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => window.game.scenario('battle_big'));
  const result = await page.evaluate(() => {
    const battle = window.__g.scene;
    const units = [];
    for (let i = 0; i < 48; i++) units.push({
      x: 540 + ((i * 37) % 190), y: 330 + ((i * 61) % 190),
      d: { radius: 10 + (i % 3) }, team: i % 2 ? 'enemy' : 'friendly',
    });
    const ordered = [...units.filter(u => u.team === 'friendly'), ...units.filter(u => u.team === 'enemy')];
    const expected = ordered.map(u => ({ x: u.x, y: u.y }));
    const radius = i => ordered[i].d.radius;
    for (let i = 0; i < expected.length; i++) {
      for (let j = i + 1; j < expected.length; j++) {
        const sameTeam = ordered[i].team === ordered[j].team;
        const rr = radius(i) + radius(j) + (sameTeam ? 13 : 7);
        const dx = expected[i].x - expected[j].x, dy = expected[i].y - expected[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2), push = (rr - d) / d * (sameTeam ? 0.95 : 0.8);
          expected[i].x += dx * push; expected[i].y += dy * push;
          expected[j].x -= dx * push; expected[j].y -= dy * push;
        }
      }
    }
    battle.troops = units.filter(u => u.team === 'friendly');
    battle.enemies = units.filter(u => u.team === 'enemy');
    battle.obstacles = [];
    battle.hero.x = -500; battle.hero.y = -500;
    battle.updateSeparationPhase(battle.hero);
    const actual = [...battle.troops, ...battle.enemies];
    let maxError = 0;
    for (let i = 0; i < actual.length; i++) {
      maxError = Math.max(maxError, Math.abs(actual[i].x - expected[i].x), Math.abs(actual[i].y - expected[i].y));
    }
    return { maxError, usedLegacy: battle._unitGrid.stats.rebuilds === 0 };
  });
  expect(result.usedLegacy).toBeTruthy();
  expect(result.maxError).toBeLessThan(1e-9);
  expect(runtimeErrors).toEqual([]);
});

test('party replans are staggered and reuse goal visibility', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  // This structural test drives simulation with direct fixed-timestep calls below. Hold the
  // production watchdog before boot so a slow CI frame cannot advance navT while the fixture
  // is being assembled; this does not alter the World timers or the behavior under test.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    window.setInterval = () => 0;
  });
  await startWorld(page, 424242);
  await page.evaluate(() => {
    for (let seed = 424242; seed < 424300 && window.__g.scene.parties.length < 6; seed++) {
      window.__g.testSeed = seed;
      window.__g.startWorld(null);
    }
    if (window.__g.scene.parties.length < 6) throw new Error('fixture setup: no deterministic production world produced six parties');
  });
  const result = await page.evaluate(() => {
    const world = window.__g.scene;
    const parties = world.parties.slice(0, 6);
    parties.forEach((p, i) => {
      p.x = 820 + i * 14; p.y = 1000 + i * 18;
      p.wander = { x: 1100, y: 1000 + i * 18 }; p.wanderT = 99;
      p.navFor = null; p.navGoal = null;
    });
    const initial = parties.map(p => p.navT);
    // Plan 023: party AI only runs while the hero rides, and this fixture parks the hero on
    // purpose so nothing but the replan staggering is under test. keepAwake() keeps the
    // world simulating WITHOUT moving the hero, so every count below is unchanged.
    window.game.keepAwake(true);
    const original = world.lineClear.bind(world);
    const originalPathGoal = world.pathGoal.bind(world);
    let calls = 0;
    let planners = 0;
    world.lineClear = (...args) => { calls++; return original(...args); };
    world.pathGoal = (...args) => { planners++; return originalPathGoal(...args); };
    const perStep = [];
    const plannerPerStep = [];
    calls = 0; planners = 0;
    window.__g.update(1 / 60);
    perStep.push(calls); plannerPerStep.push(planners);
    for (let i = 0; i < 60; i++) {
      calls = 0;
      planners = 0;
      window.__g.update(1 / 60);
      perStep.push(calls);
      plannerPerStep.push(planners);
    }
    const targetParty = parties[0];
    if (!targetParty._navGoalVisibility) throw new Error('fixture setup: target did not receive goal visibility cache');
    const cacheRef = targetParty._navGoalVisibility;
    targetParty._navGoalX = NaN; targetParty._navGoalY = NaN;
    targetParty.navT = 0;
    for (const p of parties.slice(1)) p.navT = 10;
    calls = 0; planners = 0;
    window.__g.update(1 / 60);
    const uncachedCalls = calls;
    targetParty.navT = 0;
    calls = 0; planners = 0;
    window.__g.update(1 / 60);
    const stableCalls = calls;
    const stablePlannerCount = planners;
    return {
      initial, perStep, plannerPerStep,
      boundedInitial: initial.every(v => v >= 0 && v < 0.3),
      distinctInitial: new Set(initial.map(v => Math.round(v * 1000))).size > 1,
      cacheSame: cacheRef === targetParty._navGoalVisibility,
      uncachedCalls, stableCalls, stablePlannerCount,
    };
  });
  expect(result.boundedInitial).toBeTruthy();
  expect(result.distinctInitial).toBeTruthy();
  expect(result.plannerPerStep[0]).toBeLessThan(6);
  expect(Math.max(...result.plannerPerStep)).toBeLessThanOrEqual(2);
  expect(result.cacheSame).toBeTruthy();
  expect(result.stablePlannerCount).toBe(1);
  expect(result.stableCalls).toBeLessThan(result.uncachedCalls);
  expect(runtimeErrors).toEqual([]);
});
