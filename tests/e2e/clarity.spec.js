// Plan 049's three claims, each asserted where it can actually be checked:
//
//   1. the battlefield carries less non-gameplay information, and none of it sits on the
//      ground the player deploys, fights and decides on;
//   2. terrain changes what a formation is worth — high ground lengthens a bow's reach, the
//      trees blunt what lands under them and slow a horse more than a man;
//   3. the campaign teaches one command at a time, and a command it has not taught yet does
//      nothing when its key is pressed.
//
// The visual suite cannot see any of this: it compares whole canvases at a tolerance that
// absorbs a scatter of small marks, and it has no way to press a key. This file is the gate.
import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, assertNoRuntimeErrors, bootWorld } from './test-helpers.js';
import { lessonFor, NO_LESSON, commandUnlocked, LESSON_IDS } from '../../src/tutorial.js';
import { SCATTER, CLEAN_R, HIGH_GROUND_R, HIGH_GROUND_RANGE, WOOD_COVER, WOOD_MOUNTED } from '../../src/battle/constants.js';

// The prop kinds Plan 049 classes as removable. Kept in the test as a literal rather than
// imported: if production widens the set, this list is the review surface for whether the
// new kind is really decoration and not something the player reads.
const CLEARABLE = ['tuft', 'pebbles', 'bones', 'log', 'stump', 'boulder', 'crops', 'reeds'];

async function battleState(page, scenario, pick) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  return page.evaluate(({ name, fn }) => {
    window.game.scenario(name);
    // eslint-disable-next-line no-new-func
    return new Function('battle', `return (${fn})(battle);`)(window.__g.scene);
  }, { name: scenario, fn: pick.toString() });
}

test('pure decoration is thinner than the terrain it decorates and never crowds a formation', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const out = await battleState(page, 'battle_woods', battle => {
    const clearable = ['tuft', 'pebbles', 'bones', 'log', 'stump', 'boulder', 'crops', 'reeds'];
    const enemyCx = battle.W / 2 + battle.adx * 410, enemyCy = battle.H / 2 + battle.ady * 410;
    return {
      area: battle.W * battle.H,
      counts: battle.props.reduce((acc, p) => { acc[p.kind] = (acc[p.kind] || 0) + 1; return acc; }, {}),
      decoration: battle.props.filter(p => clearable.includes(p.kind))
        .map(p => ({ kind: p.kind, x: p.x, y: p.y })),
      hero: { x: battle.hero.x, y: battle.hero.y },
      enemy: { x: enemyCx, y: enemyCy },
      objective: battle.objective && battle.objective.x != null
        ? { x: battle.objective.x, y: battle.objective.y, r: battle.objective.r || 0 } : null,
      crossings: battle.props.filter(p => p.kind === 'bridgeSpan' || p.kind === 'ford').map(p => ({ x: p.x, y: p.y })),
      terrainProps: battle.props.filter(p => ['woodFloor', 'hillFoot', 'tree', 'scrub'].includes(p.kind)).length,
    };
  });

  // Density is derived from area, so the assertion is too — a bigger field must not quietly
  // become a denser one. The +1 is the rounding the production count does.
  expect(out.counts.tuft || 0).toBeLessThanOrEqual(Math.round(out.area / SCATTER.tuft) + 1);
  expect(out.counts.pebbles || 0).toBeLessThanOrEqual(Math.round(out.area / SCATTER.pebbles) + 1);
  // The field is still dressed: this is a thinning pass, not a stripping one.
  expect(out.counts.tuft || 0).toBeGreaterThan(0);
  expect(out.terrainProps).toBeGreaterThan(0);

  // Nothing removable stands on tactical ground.
  const zones = [
    { ...out.hero, r: CLEAN_R.deploy },
    { ...out.enemy, r: CLEAN_R.deploy },
    { x: (out.hero.x + out.enemy.x) / 2, y: (out.hero.y + out.enemy.y) / 2, r: CLEAN_R.contact },
    ...out.crossings.map(c => ({ ...c, r: CLEAN_R.crossing })),
    ...(out.objective ? [{ x: out.objective.x, y: out.objective.y, r: out.objective.r + CLEAN_R.objective }] : []),
  ];
  for (const p of out.decoration) {
    expect(CLEARABLE).toContain(p.kind);
    for (const z of zones) {
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      expect(d, `${p.kind} at ${Math.round(p.x)},${Math.round(p.y)} stands on tactical ground`).toBeGreaterThanOrEqual(z.r);
    }
  }
  assertNoRuntimeErrors(errors);
});

test('high ground lengthens a bow and the trees blunt what lands under them', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  const out = await battleState(page, 'battle_woods', battle => {
    const hill = battle.obstacles.find(o => o.kind === 'hill');
    const wood = battle.zones.find(z => z.kind === 'wood');
    const open = { x: battle.W / 2, y: 60 };
    const sample = (x, y) => ({
      range: battle.terrainRangeMulAt(x, y),
      cover: battle.terrainCoverAt(x, y),
      foot: battle.terrainSpeedAt(x, y, false),
      horse: battle.terrainSpeedAt(x, y, true),
    });
    return {
      hasHill: !!hill, hasWood: !!wood,
      // A point on the slope: outside the collider, inside the high-ground ring.
      slope: hill ? sample(hill.x + hill.r * 1.25, hill.y) : null,
      crest: hill ? { r: hill.r } : null,
      wood: wood ? sample(wood.x, wood.y) : null,
      open: sample(open.x, open.y),
      // Everything a zone claims must be finite: a zone missing `mul` used to make the
      // speed product NaN, which is silent and fatal.
      speedsFinite: battle.zones.every(z => Number.isFinite(battle.terrainSpeedAt(z.x || 0, z.y || 0, false))),
      // The rules in isolation, on a synthetic field. The sampled map is what proves the
      // rules REACH the game; two zones authored here are what pin their exact values,
      // because a generated field can overlap two woods or two slopes and the clamp that
      // stops a stack of them from freezing a horse would mask the single-zone number.
      synthetic: (() => {
        const real = battle.zones;
        battle.zones = [
          { kind: 'wood', x: 0, y: 0, r: 100, mul: 0.8, cover: 0.75, mountedMul: 0.82 },
          { kind: 'high', x: 500, y: 0, r: 100, rangeMul: 1.2 },
          { kind: 'high', x: 560, y: 0, r: 100, rangeMul: 1.2 },
        ];
        const out = { wood: sample(0, 0), twoSlopes: sample(530, 0), nowhere: sample(-900, -900) };
        battle.zones = real;
        return out;
      })(),
    };
  });

  expect(out.hasHill, 'the wooded-highland fixture must have a hill to stand on').toBe(true);
  expect(out.hasWood, 'the wooded-highland fixture must have woods to shelter in').toBe(true);
  expect(out.speedsFinite).toBe(true);

  // Open ground is the baseline for all three rules.
  expect(out.open).toMatchObject({ range: 1, cover: 1 });
  expect(out.open.foot).toBeCloseTo(out.open.horse, 6);

  // A bow on the slope reaches further; the slope is not also faster or safer.
  expect(out.slope.range).toBeCloseTo(HIGH_GROUND_RANGE, 6);
  expect(out.slope.cover).toBe(1);

  // Under the trees, on the generated map: arrows land softer and a horse is slower there
  // than a man. The exact factors are asserted on the synthetic field below, because two
  // overlapping woods stack their speed penalty into the clamp and would hide them here.
  expect(out.wood.cover).toBeCloseTo(WOOD_COVER, 6);
  expect(out.wood.horse).toBeLessThan(out.wood.foot);

  const syn = out.synthetic;
  expect(syn.nowhere).toMatchObject({ range: 1, cover: 1, foot: 1, horse: 1 });
  expect(syn.wood.cover).toBeCloseTo(WOOD_COVER, 6);
  expect(syn.wood.foot).toBeCloseTo(0.8, 6);
  expect(syn.wood.horse / syn.wood.foot).toBeCloseTo(WOOD_MOUNTED, 6);
  // Two slopes that overlap are ONE piece of high ground, not twice as high.
  expect(syn.twoSlopes.range).toBeCloseTo(HIGH_GROUND_RANGE, 6);

  // And the slope really is a ring around the collider, not the collider itself.
  expect(HIGH_GROUND_R).toBeGreaterThan(1);
  assertNoRuntimeErrors(errors);
});

test('the lesson unlocks one command per battle and never fewer than it did before', () => {
  // Battle 1 offers none of them: the units run on their FOLLOW default, which is what a
  // player who presses nothing gets anyway.
  expect(lessonFor(1)).toMatchObject({ unlocked: [], teach: 'follow' });
  expect(lessonFor(2)).toMatchObject({ unlocked: ['follow'], teach: 'charge' });
  expect(lessonFor(3)).toMatchObject({ unlocked: ['follow', 'charge'], teach: 'hold' });
  expect(lessonFor(4)).toMatchObject({ unlocked: ['follow', 'charge', 'hold'], teach: null });
  expect(lessonFor(40)).toMatchObject({ unlocked: ['follow', 'charge', 'hold'], teach: null });
  // Monotonic: a later battle can never take a command away.
  for (let n = 1; n < 8; n++) {
    for (const id of lessonFor(n).unlocked) expect(lessonFor(n + 1).unlocked).toContain(id);
  }
  // A fight built without a lesson — every scenario fixture, the balance sweep, the legacy
  // QA runner — has everything.
  for (const id of LESSON_IDS) expect(commandUnlocked(NO_LESSON, id)).toBe(true);
  // A garbage battle number must not open more than battle 1 does.
  expect(lessonFor(0).unlocked).toEqual([]);
  expect(lessonFor(NaN).unlocked).toEqual([]);
});

test('a command the campaign has not taught does nothing on its key, but the API still obeys', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });
  const out = await page.evaluate(() => {
    const game = window.__g;
    const battle = { squads: null };
    // Drive the real battle scene through the real key path. `battle_small` carries no
    // lesson, so it is the control; the lesson is then installed by hand to model battle 1.
    window.game.scenario('battle_small');
    const b = game.scene;
    const press = action => { game.input.injectAction(action, true); b.updateCommandPhase(game.input); game.input.injectAction(action, false); game.input.endFrame(); };
    const stances = () => Object.fromEntries(Object.keys(b.squads).map(k => [k, b.squads[k].stance]));

    b.lesson = { battle: 1, unlocked: [], teach: 'follow' };
    press('commandCharge');
    const lockedKey = stances();
    // The API is NOT gated: the AI, the sweep and the QA runner all drive it directly.
    b.issueCommand('charge', null);
    const lockedApi = stances();

    b.lesson = { battle: 3, unlocked: ['follow', 'charge'], teach: 'hold' };
    b.issueCommand('follow', null);
    press('commandCharge');
    const unlockedKey = stances();
    press('commandHold');
    const stillLockedKey = stances();
    battle.squads = { lockedKey, lockedApi, unlockedKey, stillLockedKey };
    return battle.squads;
  });

  // Battle 1: the key is inert.
  expect(Object.values(out.lockedKey).every(s => s === 'follow')).toBe(true);
  // Overlapping zones must not compound (see terrainRangeMulAt).
  // ...but the command itself still works when something other than a player issues it.
  expect(Object.values(out.lockedApi).some(s => s === 'charge')).toBe(true);
  // Battle 3: charge is taught, so its key lands.
  expect(Object.values(out.unlockedKey).some(s => s === 'charge')).toBe(true);
  // Hold is next battle's lesson, so its key is still inert.
  expect(Object.values(out.stillLockedKey).some(s => s === 'hold')).toBe(false);
  assertNoRuntimeErrors(errors);
});
