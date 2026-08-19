import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';
import { BALANCE } from '../../src/data.js';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
}

test('requesting a battle opens a brief without committing any map-side mutation', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 424242 });
    const world = window.__g.scene;
    const before = world.parties.length;
    const battleCountBefore = world.save.battleCount || 0;
    let target = null;
    for (const p of world.parties) { if (!world.inSafeZone(p.x, p.y)) { target = p; break; } }
    world.hero.x = target.x; world.hero.y = target.y; world.grace = 0;
    window.game.step(0.1); // one tick: enough for the collision to be detected
    return {
      scene: window.__g.sceneName,
      screenKind: world.screen && world.screen.kind,
      partiesLen: world.parties.length,
      before,
      battleCountAfter: world.save.battleCount || 0,
      battleCountBefore,
      partyPresent: world.parties.includes(target),
    };
  });
  expect(result.scene).toBe('world');
  expect(result.screenKind).toBe('brief');
  expect(result.partiesLen).toBe(result.before);
  expect(result.partyPresent).toBe(true);
  expect(result.battleCountAfter).toBe(result.battleCountBefore);
  expect(runtimeErrors).toEqual([]);
});

test('confirm persists exactly once while still world, after splicing, then enters battle', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 424242 });
    const g = window.__g, world = g.scene;
    let target = null;
    for (const p of world.parties) { if (!world.inSafeZone(p.x, p.y)) { target = p; break; } }
    world.hero.x = target.x; world.hero.y = target.y; world.grace = 0;
    window.game.step(0.1); // opens the brief
    let persistCalls = 0, partyPresentAtPersist = null, sceneAtPersist = null;
    const original = g.persistRun.bind(g);
    g.persistRun = () => {
      persistCalls++;
      partyPresentAtPersist = world.parties.includes(target);
      sceneAtPersist = g.sceneName;
      return original();
    };
    g.input.injectAction('confirm', true);
    g.update(1 / 60);
    g.input.injectAction('confirm', false);
    return { persistCalls, partyPresentAtPersist, sceneAtPersist, sceneAfter: g.sceneName };
  });
  expect(result.persistCalls).toBe(1);
  // AGENTS.md: finish all map-side mutations (encounter removal included) before the
  // single persistRun() call — the checkpoint it writes must not still show the party.
  expect(result.partyPresentAtPersist).toBe(false);
  expect(result.sceneAtPersist).toBe('world');
  expect(result.sceneAfter).toBe('battle');
  expect(runtimeErrors).toEqual([]);
});

test('withdraw keeps the party on the map, charged, and blocks an instant rematch', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate((battleGrace) => {
    window.game.scenario('world', { seed: 424242 });
    const g = window.__g, world = g.scene;
    // Away from every settlement's canClash-blocking safe zone (WORLD.heroStart itself
    // sits ~128px from Ashford, just inside the 130px radius).
    world.hero.x = 1600; world.hero.y = 900;
    const mine = world.myStrength();
    world.parties.length = 0;
    const weak = {
      camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: Array.from({ length: Math.max(1, Math.round(mine * 0.4)) }, () => 'bandit'),
      home: { x: world.hero.x, y: world.hero.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    };
    world.parties.push(weak);
    world.grace = 0;
    g.update(1 / 60); // a weak party right on the hero flees -> caughtThem -> withdraw offered
    const canWithdraw = !!(world.screen && world.screen.canWithdraw);
    g.input.injectAction('withdraw', true);
    g.update(1 / 60);
    g.input.injectAction('withdraw', false);
    const afterWithdraw = {
      scene: g.sceneName, screenGone: !world.screen,
      partyPresent: world.parties.includes(weak), clashT: weak.clashT, waryT: weak.waryT,
    };
    // still standing on it the very next tick: must not force an instant rematch
    g.update(1 / 60);
    return { canWithdraw, afterWithdraw, screenAfterOneMoreTick: world.screen, battleGrace };
  }, BALANCE.battleGrace);
  expect(result.canWithdraw).toBe(true);
  expect(result.afterWithdraw.scene).toBe('world');
  expect(result.afterWithdraw.screenGone).toBe(true);
  expect(result.afterWithdraw.partyPresent).toBe(true);
  expect(result.afterWithdraw.clashT).toBeCloseTo(result.battleGrace, 5);
  expect(result.afterWithdraw.waryT).toBe(25);
  expect(result.screenAfterOneMoreTick).toBeNull();
  expect(runtimeErrors).toEqual([]);
});

test('withdraw is offered only for camp/stronghold assault and a fleeing party, never an ambush or a mutual skirmish', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const cases = ['campScouted', 'stronghold', 'partyFlee', 'ambush', 'party'];
  const results = {};
  for (const kind of cases) {
    results[kind] = await page.evaluate((k) => {
      window.game.scenario('world_brief', { kind: k, seed: 424242 });
      const world = window.__g.scene;
      return { screenKind: world.screen && world.screen.kind, canWithdraw: !!(world.screen && world.screen.canWithdraw) };
    }, kind);
  }
  expect(results.campScouted).toEqual({ screenKind: 'brief', canWithdraw: true });
  expect(results.stronghold).toEqual({ screenKind: 'brief', canWithdraw: true });
  expect(results.partyFlee).toEqual({ screenKind: 'brief', canWithdraw: true });
  expect(results.ambush).toEqual({ screenKind: 'brief', canWithdraw: false });
  expect(results.party).toEqual({ screenKind: 'brief', canWithdraw: false });
  expect(runtimeErrors).toEqual([]);
});

test('an unscouted stronghold brief shows the enemy as unknown; a scouted camp shows the true composition', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // Wolfsjaw is never auto-scouted by proximity (unlike ordinary camps), so an assault
  // on it is the one case decision 6's "unscouted force" actually reaches.
  const unscouted = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'stronghold', seed: 424242 });
    return window.__g.scene.screen.enemy;
  });
  expect(unscouted.scouted).toBe(false);
  // An ordinary camp auto-scouts the instant you're close enough to assault it, so a
  // regular camp brief always shows the real composition.
  const scouted = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'campScouted', seed: 424242 });
    return window.__g.scene.screen.enemy;
  });
  expect(scouted.scouted).toBe(true);
  expect(scouted.bodies).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});

test('aftermath blocks world input and freezes grace, then decays only after dismissal', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world_aftermath', { seed: 424242, result: { victory: true } });
    const g = window.__g, world = g.scene;
    const screenKindAtOpen = world.screen && world.screen.kind;
    const graceAtOpen = world.grace;
    const heroXAtOpen = world.hero.x;
    g.input.injectKey('KeyD', true); // try to move — must have no effect while blocked
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    g.input.injectKey('KeyD', false);
    const heroMovedWhileBlocked = world.hero.x !== heroXAtOpen;
    const graceFrozen = world.grace === graceAtOpen;
    g.input.injectAction('confirm', true); g.update(1 / 60); g.input.injectAction('confirm', false);
    const screenGoneAfterDismiss = !world.screen;
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    return {
      screenKindAtOpen, graceAtOpen, heroMovedWhileBlocked, graceFrozen,
      screenGoneAfterDismiss, graceAfterDismiss: world.grace,
    };
  });
  expect(result.screenKindAtOpen).toBe('aftermath');
  expect(result.heroMovedWhileBlocked).toBe(false);
  expect(result.graceFrozen).toBe(true);
  expect(result.screenGoneAfterDismiss).toBe(true);
  expect(result.graceAfterDismiss).toBeLessThan(result.graceAtOpen);
  expect(runtimeErrors).toEqual([]);
});

test('a won stronghold raid reaches the victory ending instead of an aftermath screen', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'stronghold', seed: 424242 });
    const g = window.__g;
    g.input.injectAction('confirm', true); g.update(1 / 60); g.input.injectAction('confirm', false);
    if (g.sceneName !== 'battle') throw new Error('fixture setup: confirming the stronghold brief did not start a battle');
    g.scene.endBattle(true);
    for (let i = 0; i < 200 && g.sceneName === 'battle'; i++) g.update(1 / 60);
    // onEnd fires inside one of the ticks above and constructs a new World with
    // save.won already true; THAT World's own update() (not this loop) is what
    // redirects to the victory scene, so it needs a few more ticks after the loop
    // above stops (it stops the instant sceneName flips away from 'battle').
    for (let i = 0; i < 5 && g.sceneName === 'world'; i++) g.update(1 / 60);
    return { scene: g.sceneName, won: g.finalSave && g.finalSave.won };
  });
  expect(result.scene).toBe('victory');
  expect(result.won).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('the aftermath reports per-side casualties, loot, and post-regen hero HP', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world_aftermath', { seed: 424242, result: { victory: true } });
    return window.__g.scene.screen;
  });
  expect(result.kind).toBe('aftermath');
  expect(result.victory).toBe(true);
  expect(typeof result.loot).toBe('number');
  expect(result.heroHp).toBeLessThanOrEqual(result.heroMaxHp);
  expect(Array.isArray(result.enemyLosses)).toBe(true);
  expect(Array.isArray(result.playerLosses)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
