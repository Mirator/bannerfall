import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

test('world and battle expose ordered simulation seams', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 42 });
    const world = window.__g.scene;
    const worldPhases = [
      'updateHeroMovement', 'updateWorldClock', 'updateSettlementInteractions',
      'updateCampInteraction', 'updateParties', 'updatePartySpawns', 'updateCameraAndEffects',
    ];
    // Plan 023: the FULL pipeline only runs while the hero rides, so spin the horse past
    // BALANCE.worldWakeSpeed before wrapping. A real held input rather than keepAwake(),
    // because updateHeroMovement is itself one of the phases whose order is asserted here.
    // Seed 42 spawns its parties at camps and 10 ticks is 167ms of travel, so no clash can
    // intrude on the measured tick.
    window.game.action('moveRight', true);
    for (let i = 0; i < 10; i++) window.__g.update(1 / 60);
    const worldOrder = [];
    for (const name of worldPhases) {
      const original = world[name];
      world[name] = function (...args) {
        worldOrder.push(name);
        return original.apply(this, args);
      };
    }
    window.__g.update(1 / 60);
    const rodeAwake = world.timeFlowing();
    window.game.action('moveRight', false);

    window.game.scenario('battle_small');
    const first = window.__g.scene;
    first.state = 'fight';
    first.stateT = 2;
    const battlePhases = [
      'updateCommandPhase', 'updateHeroPhase', 'updateTroopPhase', 'updateEnemyPhase',
      'updateSeparationPhase', 'updateProjectilePhase', 'updateStalematePhase',
      'resolveBattleResult', 'updatePresentationPhase',
    ];
    const battleOrder = [];
    for (const name of battlePhases) {
      const original = first[name];
      first[name] = function (...args) {
        battleOrder.push(name);
        return original.apply(this, args);
      };
    }
    window.__g.update(1 / 60);
    const firstPalette = first.palette;
    const second = new first.constructor(window.__g, {
      troops: [{ type: 'spear' }], enemies: [{ type: 'bandit' }], seed: 99,
      biome: 'night', title: 'ISOLATION', onEnd: () => {},
    });
    return {
      worldPhases: worldPhases.every(name => typeof world[name] === 'function'),
      worldOrder,
      rodeAwake,
      battlePhases: battlePhases.every(name => typeof first[name] === 'function'),
      battleOrder,
      palettesAreDistinct: first.palette !== second.palette,
      palettesFrozen: Object.isFrozen(first.palette) && Object.isFrozen(second.palette),
      firstStableAfterSecond: first.palette.ground === firstPalette.ground,
      biomeChanged: first.palette.ground !== second.palette.ground,
    };
  });

  expect(result).toEqual({
    worldPhases: true,
    worldOrder: [
      'updateHeroMovement', 'updateWorldClock', 'updateSettlementInteractions',
      'updateCampInteraction', 'updateParties', 'updatePartySpawns', 'updateCameraAndEffects',
    ],
    rodeAwake: true,
    battlePhases: true,
    battleOrder: [
      'updateCommandPhase', 'updateHeroPhase', 'updateTroopPhase', 'updateEnemyPhase',
      'updateSeparationPhase', 'updateProjectilePhase', 'updateStalematePhase',
      'resolveBattleResult', 'updatePresentationPhase',
    ],
    palettesAreDistinct: true,
    palettesFrozen: true,
    firstStableAfterSecond: true,
    biomeChanged: true,
  });
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('a world-scene modal blocks every other world phase for the tick', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 424242 });
    const world = window.__g.scene;
    // Away from every settlement's canClash-blocking safe zone.
    world.hero.x = 1600; world.hero.y = 900;
    const mine = world.myStrength();
    world.parties.length = 0;
    world.parties.push({
      camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: Array.from({ length: Math.max(1, Math.round(mine)) }, () => 'bandit'),
      home: { x: world.hero.x, y: world.hero.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
    world.grace = 0;
    window.__g.update(1 / 60); // opens the pre-battle brief
    const screenKind = world.screen && world.screen.kind;
    // Plan 023 adds updateWorldClock here: the modal gate now sits ABOVE the ambient clock,
    // so an open brief freezes `world.time` and the freeze cue too, not just the simulation.
    const worldPhases = [
      'updateHeroMovement', 'updateWorldClock', 'updateSettlementInteractions',
      'updateCampInteraction', 'updateParties', 'updatePartySpawns', 'updateCameraAndEffects',
    ];
    const worldOrder = [];
    for (const name of worldPhases) {
      const original = world[name];
      world[name] = function (...args) { worldOrder.push(name); return original.apply(this, args); };
    }
    const timeAtOpen = world.time;
    window.__g.update(1 / 60); // the brief is open: none of the wrapped phases may run
    return { screenKind, worldOrder, clockFrozen: world.time === timeAtOpen };
  });
  expect(result.screenKind).toBe('brief');
  expect(result.worldOrder).toEqual([]);
  expect(result.clockFrozen).toBe(true);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('a stopped hero freezes every dt-driven world phase', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 42 });
    const world = window.__g.scene;
    const worldPhases = [
      'updateHeroMovement', 'updateWorldClock', 'updateSettlementInteractions',
      'updateCampInteraction', 'enforceBeatableFloor', 'updateParties',
      'updatePartySpawns', 'updateCameraAndEffects',
    ];
    const worldOrder = [];
    for (const name of worldPhases) {
      const original = world[name];
      world[name] = function (...args) { worldOrder.push(name); return original.apply(this, args); };
    }
    window.__g.update(1 / 60); // the hero has never moved: world time is stale
    return { worldOrder, flowing: world.timeFlowing(), frozen: world.isTimeFrozen() };
  });
  // Plan 023, the freeze contract in one line. Hero movement runs because it OWNS the
  // coast-down that decides the freeze; the clock runs because it advances the cue that
  // explains the freeze; the two interaction phases run because they take no `dt` and are
  // how a stopped player recruits, heals, scouts and presses an assault; updateParties runs
  // in its reduced form so a clash already inside range still resolves. Everything holding a
  // timer — the beatable floor, spawns, the camera and particles — must NOT appear.
  expect(result.worldOrder).toEqual([
    'updateHeroMovement', 'updateWorldClock', 'updateSettlementInteractions',
    'updateCampInteraction', 'updateParties',
  ]);
  expect(result.flowing).toBe(false);
  expect(result.frozen).toBe(true);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
