import { test, expect } from '@playwright/test';
import { bootToMenu, collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Plan 032: facing, the flank arc, and the brace's own front arc.
//
// Every fixture below is a TWO-BODY battle stepped exactly as far as it takes for ONE blow to
// land. The claim under test is arithmetic about a single strike, so a fight-scale fixture
// would measure the fight rather than the rule; fight-scale questions belong to the balance
// harness in `stance-balance.spec.js`, which is where this plan's win-rate numbers were taken.
//
// Three harness rules carry over from that harness and are load-bearing here too: the live
// scheduler is parked and the real fixed-step update is driven directly, the pointer is pinned
// to the canvas centre, and camera shake is zeroed. Battles never persist, so driving the raw
// `window.__g` handle touches no save slot.
//
// The hero is parked far away in every fixture, because he is deliberately OUTSIDE the flank
// rule in both directions (see the FRONT_ARC block in `src/battle/constants.js`): his facing
// comes from the cursor through `Camera.toWorld`, so making his back a damage multiplier would
// put fight outcomes back under the mouse — the defect `battle outcomes are independent of
// canvas size and cursor position` exists to catch.
//
// Two timing facts make a single tick enough, and both are properties of the pipeline rather
// than of these fixtures: `updateTroopPhase` runs BEFORE `updateEnemyPhase`, so a troop's blow
// reads the enemy facing this fixture set; and a body turns onto its target by only
// 1 - exp(-8/60) = 12.5% of the remaining angle per tick, so a body pinned to face away is
// still 157 degrees off — well outside the 110-degree arc — when the blow lands.

const DT = 1 / 60;
// Field coordinates well inside the 2500x1760 arena and clear of both spawn points, so
// nothing but the two bodies placed by hand can enter these numbers.
const EX = 1300, EY = 900;

// Every fixture opens the same two-body battle and parks everything that could contribute a
// second term to the damage. Returns the live scene.
const OPEN = `(g, troops, enemies) => {
  g.startBattle({
    troops, enemies, seed: 7, title: 'FACING FIXTURE', arena: 'road', biome: 'rose',
    deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
  });
  const b = g.scene;
  b.state = 'fight';
  g.input.injectMouse(g.camera.w / 2, g.camera.h / 2, false);
  g.camera.shakeT = 0; g.camera.shakeAmp = 0; g.camera.sx = 0; g.camera.sy = 0;
  // Out of every reach: he must not swing, be swung at, or pull a troop off its target.
  b.hero.x = 200; b.hero.y = 200; b.hero.vx = 0; b.hero.vy = 0;
  return b;
}`;

test('a melee blow from outside the defender front arc is a flank; one from the front is not', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  // A spearman stands due WEST of a bandit, inside his own strike reach, and swings on the
  // first tick. The only thing that differs between the two runs is which way the BANDIT is
  // looking. Everything else is pinned: the squad is on the neutral order so neither the
  // brace nor the archer's counter is in play, and the enemy commander cannot have issued
  // anything at t = 0 (CMD_TICK is 0.8s), so charge exposure is not in play either.
  const out = await page.evaluate(async ({ dt, EX, EY, open }) => {
    const g = window.__g;
    const { UNIT_TYPES } = await import('/src/data.js');
    const { FLANK_BONUS } = await import('/src/battle/constants.js');
    const openBattle = eval(open);
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const run = (banditFacingAway) => {
        const b = openBattle(g, [{ type: 'spear' }], [{ type: 'bandit' }]);
        const t = b.troops[0], e = b.enemies[0];
        e.x = EX; e.y = EY; e.vx = 0; e.vy = 0;
        e.cd = 999; e.windupT = 0;                  // the bandit never swings inside the measurement
        e.facing = banditFacingAway ? 0 : Math.PI;  // east (turned away) or west (at the spearman)
        t.x = EX - 30; t.y = EY; t.vx = 0; t.vy = 0;
        t.facing = 0; t.cd = 0;                     // squared up, and his blow lands this tick
        const hp0 = e.hp;
        real(dt);
        return hp0 - e.hp;
      };
      return { front: run(false), back: run(true), declared: UNIT_TYPES.spear.dmg, bonus: FLANK_BONUS };
    } finally { g.update = real; }
  }, { dt: DT, EX, EY, open: OPEN });

  // The front case is the control: it must be the declared damage and nothing else, which is
  // what makes the ratio below attributable to the flank rather than to some other term.
  expect(out.front, 'a blow into the face must be the declared damage exactly').toBeCloseTo(out.declared, 6);
  expect(out.back / out.front, 'a blow from behind must pay FLANK_BONUS').toBeCloseTo(out.bonus, 6);

  assertNoRuntimeErrors(runtimeErrors);
});

test('the enemy flanks on exactly the same terms', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  // Plan 027's symmetry rule: the mirror of the fixture above, with the bandit swinging and
  // the spearman's own facing the variable. The bandit's windup is set directly so its blow
  // lands on the tick under measurement rather than after its telegraph.
  const out = await page.evaluate(async ({ dt, EX, EY, open }) => {
    const g = window.__g;
    const { ENEMY_TYPES } = await import('/src/data.js');
    const { FLANK_BONUS } = await import('/src/battle/constants.js');
    const openBattle = eval(open);
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const run = (spearFacingAway) => {
        const b = openBattle(g, [{ type: 'spear' }], [{ type: 'bandit' }]);
        const t = b.troops[0], e = b.enemies[0];
        e.x = EX; e.y = EY; e.vx = 0; e.vy = 0;
        e.cd = 999; e.windupT = dt / 2;             // its strike resolves on the tick below
        t.x = EX - 30; t.y = EY; t.vx = 0; t.vy = 0;
        t.cd = 999;                                 // the spearman never swings inside the measurement
        t.facing = spearFacingAway ? Math.PI : 0;   // west (turned away) or east (at the bandit)
        const hp0 = t.hp;
        real(dt);
        return hp0 - t.hp;
      };
      return { front: run(false), back: run(true), declared: ENEMY_TYPES.bandit.dmg, bonus: FLANK_BONUS };
    } finally { g.update = real; }
  }, { dt: DT, EX, EY, open: OPEN });

  expect(out.front, 'a blow into the face must be the declared damage exactly').toBeCloseTo(out.declared, 6);
  expect(out.back / out.front, 'the enemy must pay the same FLANK_BONUS, not a different one')
    .toBeCloseTo(out.bonus, 6);

  assertNoRuntimeErrors(runtimeErrors);
});

test('a braced line pays only against a rush inside its own front arc', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  // HOLD is issued through the production `issueCommand` entry point after both bodies are
  // placed, so the hold anchor is where the man actually stands. The rush latch is pinned
  // directly on the bandit — the same thing the Plan 029 QA record does, because the latch is
  // written by the movement branch and a fixture that had to earn it would be measuring the
  // approach rather than the brace. The bandit faces the spearman in BOTH runs, so the flank
  // multiplier is 1 either way and the only variable left is the brace.
  const out = await page.evaluate(async ({ dt, EX, EY, open }) => {
    const g = window.__g;
    const { UNIT_TYPES } = await import('/src/data.js');
    const { BRACE_BONUS } = await import('/src/battle/constants.js');
    const openBattle = eval(open);
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const run = (spearFacingAway) => {
        const b = openBattle(g, [{ type: 'spear' }], [{ type: 'bandit' }]);
        const t = b.troops[0], e = b.enemies[0];
        e.x = EX; e.y = EY; e.vx = 0; e.vy = 0;
        e.cd = 999; e.windupT = 0;
        e.facing = Math.PI;         // at the spearman in both runs: flank is 1 either way
        e.rushT = 1.0;              // "came in at a rush", the latch the brace reads
        t.x = EX - 30; t.y = EY; t.vx = 0; t.vy = 0;
        b.issueCommand('hold', 'spear');
        t.facing = spearFacingAway ? Math.PI : 0;
        t.cd = 0;
        const hp0 = e.hp;
        real(dt);
        return hp0 - e.hp;
      };
      return { front: run(false), back: run(true), declared: UNIT_TYPES.spear.dmg, bonus: BRACE_BONUS };
    } finally { g.update = real; }
  }, { dt: DT, EX, EY, open: OPEN });

  expect(out.front / out.declared, 'a rush into the front arc must pay BRACE_BONUS')
    .toBeCloseTo(out.bonus, 6);
  expect(out.back, 'a line cannot brace against what reaches it from behind')
    .toBeCloseTo(out.declared, 6);

  assertNoRuntimeErrors(runtimeErrors);
});

test('the flank multiplier is melee only: a slam and an arrow are untouched', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  // Both halves of the "melee only" decision, pinned so a later change cannot quietly extend
  // the rule to either. The slam is an AoE ring with no incoming direction; the arrow resolves
  // against whoever is nearest where it falls, long after it was loosed. See the FRONT_ARC
  // block in `src/battle/constants.js`.
  const out = await page.evaluate(async ({ dt, EX, EY, open }) => {
    const g = window.__g;
    const { UNIT_TYPES, ENEMY_TYPES } = await import('/src/data.js');
    const openBattle = eval(open);
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      // ---- a brute slams a spearman standing squarely behind it
      const b1 = openBattle(g, [{ type: 'spear' }], [{ type: 'brute' }]);
      const t1 = b1.troops[0], e1 = b1.enemies[0];
      e1.x = EX; e1.y = EY; e1.vx = 0; e1.vy = 0;
      e1.cd = 999; e1.windupT = dt / 2; e1.facing = 0;   // looking east, away from him
      t1.x = EX - 60; t1.y = EY; t1.vx = 0; t1.vy = 0;   // inside slamR (100), behind the brute
      t1.facing = Math.PI; t1.cd = 999;
      const slamHp0 = t1.hp;
      real(dt);
      const slam = slamHp0 - t1.hp;

      // ---- an archer shoots a bandit that never turns to face him. The bandit is re-pinned
      // (position AND facing) before every tick of the arrow's flight, the same fixture
      // discipline `battle-objectives.spec.js` uses, so the shot lands on a body whose back is
      // provably turned rather than on one that has drifted or rotated during the flight.
      const b2 = openBattle(g, [{ type: 'archer' }], [{ type: 'bandit' }]);
      const t2 = b2.troops[0], e2 = b2.enemies[0];
      t2.x = EX; t2.y = EY; t2.vx = 0; t2.vy = 0; t2.facing = 0; t2.cd = 0;
      let arrow = null;
      for (let i = 0; i < 240 && arrow === null; i++) {
        e2.x = EX + 200; e2.y = EY; e2.vx = 0; e2.vy = 0;
        e2.cd = 999; e2.windupT = 0; e2.facing = 0;      // east: the archer is squarely behind
        const hp0 = e2.hp;
        real(dt);
        if (e2.hp !== hp0) arrow = hp0 - e2.hp;
      }
      return { slam, slamDeclared: ENEMY_TYPES.brute.dmg, arrow, arrowDeclared: UNIT_TYPES.archer.dmg };
    } finally { g.update = real; }
  }, { dt: DT, EX, EY, open: OPEN });

  expect(out.slam, "a brute's slam must not flank the men behind it").toBeCloseTo(out.slamDeclared, 6);
  expect(out.arrow, 'an arrow must have landed for this assertion to mean anything').not.toBeNull();
  expect(out.arrow, 'an arrow must not flank a target with its back turned').toBeCloseTo(out.arrowDeclared, 6);

  assertNoRuntimeErrors(runtimeErrors);
});

test('the hero cannot be flanked: his facing is the cursor and must not enter a multiplier', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  // The third exclusion, and the load-bearing one (see the FRONT_ARC block in constants.js):
  // deleting the hero guard inside flankMul would make hero damage a function of the mouse.
  // The bandit stands due WEST of the hero while the hero's facing is pinned EAST — squarely
  // outside his front arc — and the blow must still be the declared damage exactly.
  const out = await page.evaluate(async ({ dt, EX, EY, open }) => {
    const g = window.__g;
    const { ENEMY_TYPES } = await import('/src/data.js');
    const openBattle = eval(open);
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = openBattle(g, [], [{ type: 'bandit' }]);
      const h = b.hero, e = b.enemies[0];
      h.x = EX; h.y = EY; h.vx = 0; h.vy = 0;
      h.facing = 0; h.travelFacing = 0; h.iframesT = 0;   // looking east
      e.x = EX - 30; e.y = EY; e.vx = 0; e.vy = 0;        // striking from the west, at his back
      e.cd = 999; e.windupT = dt / 2;
      const hp0 = h.hp;
      real(dt);
      return { dealt: hp0 - h.hp, declared: ENEMY_TYPES.bandit.dmg };
    } finally { g.update = real; }
  }, { dt: DT, EX, EY, open: OPEN });

  expect(out.dealt, 'a blow at the hero\'s back must be the declared damage — never a flank')
    .toBeCloseTo(out.declared, 6);

  assertNoRuntimeErrors(runtimeErrors);
});

test('the arc boundary sits between 90 and 130 degrees off the facing', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootToMenu(page);

  // The four fixtures above all test 0 versus 180 degrees, which any arc width in (0, 180)
  // satisfies — so nothing pinned FRONT_ARC itself. Two probes bracket the shipped 110: a
  // blow arriving 90 degrees off the defender's facing is front (declared damage), one 130
  // degrees off is a flank. A retune of FRONT_ARC outside (90, 130) — or an inverted
  // comparison — fails one of the two.
  const out = await page.evaluate(async ({ dt, EX, EY, open }) => {
    const g = window.__g;
    const { UNIT_TYPES } = await import('/src/data.js');
    const { FLANK_BONUS } = await import('/src/battle/constants.js');
    const openBattle = eval(open);
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const run = (offDeg) => {
        const b = openBattle(g, [{ type: 'spear' }], [{ type: 'bandit' }]);
        const t = b.troops[0], e = b.enemies[0];
        e.x = EX; e.y = EY; e.vx = 0; e.vy = 0;
        e.cd = 999; e.windupT = 0;
        e.facing = Math.PI; // looking west; the attacker's bearing is measured off this
        const bearing = Math.PI - offDeg * Math.PI / 180;
        t.x = EX + Math.cos(bearing) * 30; t.y = EY + Math.sin(bearing) * 30;
        t.vx = 0; t.vy = 0; t.cd = 0;
        t.facing = Math.atan2(EY - t.y, EX - t.x);
        const hp0 = e.hp;
        real(dt);
        return hp0 - e.hp;
      };
      return { at90: run(90), at130: run(130), declared: UNIT_TYPES.spear.dmg, bonus: FLANK_BONUS };
    } finally { g.update = real; }
  }, { dt: DT, EX, EY, open: OPEN });

  expect(out.at90, '90 degrees off the facing is inside the front arc').toBeCloseTo(out.declared, 6);
  expect(out.at130 / out.at90, '130 degrees off the facing is a flank').toBeCloseTo(out.bonus, 6);

  assertNoRuntimeErrors(runtimeErrors);
});
