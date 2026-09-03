// Plan 023: the campaign world is alive only while the hero rides. World.timeFlowing()
// (realized hero speed >= BALANCE.worldWakeSpeed) is the single rule; everything below
// pins one consequence of it. The ORDERED-PHASE contract lives next to its siblings in
// world-battle-seams.spec.js ('a stopped hero freezes every dt-driven world phase') — this
// file covers the observable behaviour those phases produce.
import { test, expect } from '@playwright/test';
import { WORLD } from '../../src/data.js';
import { collectRuntimeErrors } from './test-helpers.js';

const SEED = 424242;
const ASHFORD = WORLD.settlements.find(s => s.id === 'ashford');
const LIVE_CAMP = WORLD.camps.find(c => c.id === 'c1');

async function boot(page) {
  await page.goto('/');
  await page.evaluate((seed) => window.game.scenario('world', { seed }), SEED);
}

test('a stopped hero holds every world clock', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    const world = window.__g.scene;
    const snapshot = () => ({
      time: world.time, grace: world.grace, spawnT: world.spawnT,
      particles: world.particles.list.length,
      parties: world.parties.map(p => [p.x, p.y, p.waryT, p.chaseT, p.wanderT, p.navT, p.mood]),
    });
    // `msgT` is deliberately NOT in that snapshot: it is the toast timer, which is
    // presentation and drains on every tick (asserted below). It used to be pinned here
    // with the simulation clocks, which meant a message raised on the last riding tick
    // stayed on screen forever once the horse stopped.
    world.say('a toast that must clear even though time is stale', 3);
    const before = snapshot();
    window.game.step(5);
    return {
      before, after: snapshot(), state: window.game.state().world,
      toastCleared: world.msgT <= 0,
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.toastCleared, 'a toast raised before the freeze never expired').toBe(true);
  expect(result.state.flowing).toBe(false);
  expect(result.state.time).toBe(0);
  expect(result.state.speed).toBe(0);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('a frozen tick consumes no simulation or effect randomness', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  // Campaign randomness must not depend on how long the player stood still: two identical
  // seeds must hand out the same next draw whether or not five idle seconds elapsed first.
  const result = await page.evaluate((seed) => {
    const draws = (idleSeconds) => {
      window.game.scenario('world', { seed });
      if (idleSeconds) window.game.step(idleSeconds);
      const world = window.__g.scene;
      return { sim: world.simRng(), fx: world.fxRng() };
    };
    return { immediate: draws(0), afterIdle: draws(5) };
  }, SEED);
  expect(result.afterIdle).toEqual(result.immediate);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('riding revives the world, and the coast keeps it alive past the key release', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    const heroAtRest = { x: world.hero.x, y: world.hero.y };
    const partiesAtRest = world.parties.map(p => [p.x, p.y]);
    window.game.action('moveRight', true);
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const riding = {
      flowing: world.timeFlowing(), time: world.time,
      heroMoved: world.hero.x !== heroAtRest.x,
      partiesMoved: world.parties.some((p, i) => p.x !== partiesAtRest[i][0] || p.y !== partiesAtRest[i][1]),
    };
    // Release the keys. The hero must COAST, not stop dead, so the world stays alive for a
    // while yet — freezing on the release frame would strand the hero mid-slide.
    window.game.action('moveRight', false);
    const xAtRelease = world.hero.x;
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    const coasting = { flowing: world.timeFlowing(), stillTravelling: world.hero.x !== xAtRelease };
    // Then it settles: the coast damping is asymptotic, so updateHeroMovement snaps the
    // last few px/s to an exact zero. Bounded loop rather than a magic tick count.
    let ticksToSettle = 0;
    while (world.heroSpeed !== 0 && ticksToSettle < 120) { g.update(1 / 60); ticksToSettle++; }
    return {
      riding, coasting, ticksToSettle,
      settled: { flowing: world.timeFlowing(), speed: world.heroSpeed },
    };
  });
  expect(result.riding.flowing).toBe(true);
  expect(result.riding.time).toBeGreaterThan(0.9);
  expect(result.riding.heroMoved).toBe(true);
  expect(result.riding.partiesMoved).toBe(true);
  expect(result.coasting.flowing).toBe(true);
  expect(result.coasting.stillTravelling).toBe(true);
  expect(result.settled.flowing).toBe(false);
  expect(result.settled.speed).toBe(0);
  expect(result.ticksToSettle).toBeLessThan(120); // it really did reach an exact stop
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('the stale cue fades in while stopped and clears on resume', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    // Ride first so the cue starts from zero rather than from the boot fade-in.
    window.game.action('moveRight', true);
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    const whileRiding = world.staleT;
    window.game.action('moveRight', false);
    // Coast down first — the cue only starts fading in once time actually freezes — then
    // sample partway through the 0.3s fade rather than at a hard-coded tick count.
    while (world.timeFlowing()) g.update(1 / 60);
    for (let i = 0; i < 9; i++) g.update(1 / 60); // ~0.15s => about half strength
    const partway = world.staleT;
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    const settled = world.staleT;
    window.game.action('moveRight', true);
    for (let i = 0; i < 20; i++) g.update(1 / 60);
    window.game.action('moveRight', false);
    return { whileRiding, partway, settled, afterResume: world.staleT };
  });
  expect(result.whileRiding).toBe(0);
  expect(result.partway).toBeGreaterThan(0.3);
  expect(result.partway).toBeLessThan(0.7);
  expect(result.settled).toBe(1);
  expect(result.afterResume).toBe(0);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('a clash already inside range still resolves while time is frozen', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // Letting go of the keys must not shake off a party that has already closed on you —
  // this is the ONE thing party AI still does on a frozen tick.
  const result = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    world.hero.x = 1600; world.hero.y = 900; // clear of every settlement safe zone
    world.hero.vx = 0; world.hero.vy = 0;
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
    g.update(1 / 60);
    return { frozen: world.isTimeFrozen(), screenKind: world.screen && world.screen.kind };
  });
  expect(result.frozen).toBe(true);
  expect(result.screenKind).toBe('brief');
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('a distant party cannot reach a stopped hero', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // Standing still makes the player untouchable by a party that has NOT yet closed. That is
  // the mechanic as designed, not an oversight: it is symmetric (the player cannot reach
  // them either) and self-limiting (every objective needs riding). Asserted here so it
  // cannot be quietly softened into a proximity exception.
  const result = await page.evaluate(() => {
    const g = window.__g, world = g.scene;
    world.hero.x = 1600; world.hero.y = 900;
    world.hero.vx = 0; world.hero.vy = 0;
    const mine = world.myStrength();
    world.parties.length = 0;
    world.parties.push({
      camp: 'c1', x: 1900, y: 900, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: Array.from({ length: Math.max(3, Math.ceil(mine * 1.6 / 5)) }, () => 'brute'),
      home: { x: 1900, y: 900 }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
    world.grace = 0;
    const p = world.parties[0];
    const at = { x: p.x, y: p.y };
    window.game.step(10);
    return { moved: p.x !== at.x || p.y !== at.y, screen: world.screen, parties: world.parties.length };
  });
  expect(result.moved).toBe(false);
  expect(result.screen).toBeNull();
  expect(result.parties).toBe(1); // no spawn timer fired either
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('town and camp interaction still work while time is frozen', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // The biggest hazard in this design: standing still IS how a player recruits, heals,
  // scouts and presses an assault. Those two phases take no `dt` and must never be gated,
  // so both are exercised here with a hero that has never moved.
  const result = await page.evaluate(({ camp, town }) => {
    const g = window.__g, world = g.scene;
    world.parties.length = 0; // isolate from incidental party contact

    // Plan 030: one press opens the site menu, a second commits the row. Both of those
    // ticks happen on a hero that has never moved, which is the whole point.
    const press = (action) => {
      g.input.injectAction(action, true);
      g.update(1 / 60);
      g.input.injectAction(action, false);
    };

    // 1) press an assault on a camp from a dead standstill
    world.hero.x = camp.x; world.hero.y = camp.y;
    world.hero.vx = 0; world.hero.vy = 0;
    world.grace = 0;
    press('worldPrimary');
    const menuAtCamp = { frozen: world.isTimeFrozen(), screenKind: world.screen && world.screen.kind };
    press('confirm'); // commit the raid row
    const assault = { frozen: world.isTimeFrozen(), screenKind: world.screen && world.screen.kind };
    world.screen = null; world.pending = null;

    // 2) recruit in a town from a dead standstill
    world.hero.x = town.x; world.hero.y = town.y;
    world.hero.vx = 0; world.hero.vy = 0;
    world.save.gold = 500;
    const goldBefore = world.save.gold, troopsBefore = world.save.troops.length;
    press('worldPrimary'); // opens the site menu, spearman row selected
    press('confirm');
    return {
      menuAtCamp,
      assault,
      recruit: {
        frozen: world.isTimeFrozen(),
        goldSpent: goldBefore - world.save.gold,
        troopsGained: world.save.troops.length - troopsBefore,
        stillOpen: world.screen && world.screen.kind,
      },
    };
  }, { camp: LIVE_CAMP, town: ASHFORD });
  expect(result.menuAtCamp.frozen).toBe(true);
  expect(result.menuAtCamp.screenKind).toBe('site');
  expect(result.assault.frozen).toBe(true);
  expect(result.assault.screenKind).toBe('brief');
  expect(result.recruit.frozen).toBe(true);
  expect(result.recruit.stillOpen).toBe('site'); // the menu survives a purchase
  expect(result.recruit.goldSpent).toBeGreaterThan(0);
  expect(result.recruit.troopsGained).toBe(1);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('campaign playtime does not accrue while the map is frozen', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    const g = window.__g;
    const read = () => g._lastSave.stats.playT;
    const atRest = read();
    window.game.step(3);
    const afterIdle = read();
    window.game.action('moveRight', true);
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    window.game.action('moveRight', false);
    return { atRest, afterIdle, afterRide: read() };
  });
  expect(result.afterIdle).toBeCloseTo(result.atRest, 5);
  expect(result.afterRide - result.afterIdle).toBeGreaterThan(0.9);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});

test('an open modal freezes the ambient clock and holds the cue', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  const result = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'party', seed: 424242 });
    const g = window.__g, world = g.scene;
    const before = { time: world.time, stale: world.staleT, screen: world.screen && world.screen.kind };
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    return { before, after: { time: world.time, stale: world.staleT } };
  });
  expect(result.before.screen).toBe('brief');
  expect(result.after.time).toBe(result.before.time);
  expect(result.after.stale).toBe(result.before.stale);
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
});
