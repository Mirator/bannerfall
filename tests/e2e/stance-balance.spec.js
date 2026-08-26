import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

// Plan 019 balance harness.
//
// Each fixture runs once per stance with the hero COMPLETELY IDLE, so the reported
// numbers isolate what the order itself did. A stance set is healthy when no single
// order wins on both time-to-win and troops-lost across the fixtures below: the
// wolf pack should reward HOLD, and the raider band should reward CHARGE.
//
// The harness deliberately drives the raw handle: it needs a battle-only fixture that
// is not one of the named scenarios, and battles never persist, so no save slot is
// touched. Advancement replaces the live scheduler and calls the real fixed-step
// update directly, so rAF and watchdog timing cannot contaminate a measurement.

const DT = 1 / 60;
const TIMEOUT_S = 90;

const rep = (type, n) => Array.from({ length: n }, () => ({ type }));

// Composition strengths are matched across fixtures (7 on the shared strength scale)
// so the only thing that varies between them is WHICH enemy behavior is present.
const FIXTURES = {
  // the ordinary mid-campaign roaming fight from the phase-4 audit
  mixed: {
    troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
    enemies: [...rep('bandit', 3), ...rep('raider', 2), ...rep('wolf', 2)],
    seed: 11,
  },
  // wolves hunt the backline at speed 158: a braced line should beat chasing them
  wolves: {
    troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
    enemies: [...rep('wolf', 5), ...rep('bandit', 2)],
    seed: 11,
  },
  // the only fixture with a brute, so the slam AoE that CHARGE exposure interacts with is
  // actually measured. HOLD wins here through slam avoidance, NOT through bracing: a brute
  // moves at 55 and can never reach BRACE_SPEED.
  brute: {
    troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
    enemies: [...rep('brute', 1), ...rep('bandit', 3), ...rep('wolf', 2)],
    seed: 11,
  },
  // raiders kite at 210 range: standing still should be worse than closing
  raiders: {
    troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
    enemies: [...rep('raider', 5), ...rep('bandit', 2)],
    seed: 11,
  },
};

const STANCES = ['follow', 'charge', 'hold'];

async function runStance(page, fixtureName, stance, orders = null) {
  return page.evaluate(({ fixture, stance, orders, dt, timeoutS }) => {
    const game = window.__g;
    // Freeze the live scheduler so only explicit steps advance the simulation,
    // then drive the real update directly. Restored in `finally`.
    const realUpdate = game.update.bind(game);
    game.update = () => {};
    try {
      game.startBattle({
        troops: fixture.troops,
        enemies: fixture.enemies,
        seed: fixture.seed,
        title: 'BALANCE HARNESS',
        arena: 'road',
        biome: 'rose',
        deploy: 0,
        approach: 'E',
        heroHp: 120,
        heroMaxHp: 120,
        onEnd: () => {},
      });
      const b = game.scene;
      b.state = 'fight';
      b.deployT = 0;
      // An idle hero aims at the cursor, and FOLLOW formation slots hang off hero facing,
      // so the pointer is a real simulation input. Pin it to the canvas centre and clear
      // any residual camera shake, or a stray mouse position silently rewrites the result.
      game.input.injectMouse(game.camera.w / 2, game.camera.h / 2, false);
      game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
      if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
      else b.issueCommand(stance);
      let t = 0;
      while (b.state !== 'end' && t < timeoutS) { realUpdate(dt); t += dt; }
      return {
        stance: stance || Object.values(orders).join('/'),
        resolved: b.state === 'end',
        seconds: Math.round(t * 10) / 10,
        victory: !!b.victory,
        lost: b.startTroops - b.troops.length,
        heroHp: Math.round(b.hero.hp),
      };
    } finally {
      game.update = realUpdate;
    }
  }, { fixture: FIXTURES[fixtureName], stance, orders, dt: DT, timeoutS: TIMEOUT_S });
}

async function measure(page, fixtureName) {
  await page.goto('/');
  const results = {};
  for (const stance of STANCES) results[stance] = await runStance(page, fixtureName, stance);
  return results;
}

// A split order: one stance per squad, issued through the same production entry point the
// Tab-plus-number keys use.
async function runSplit(page, fixtureName, orders) {
  return runStance(page, fixtureName, null, orders);
}

// Organic camp raids: the fight the campaign actually serves the player. Unlike the
// fixtures above these use real garrison rolls (bigger, with brutes) in the camp arena,
// reached through the production `E` raid input. Camp coordinates come from the live
// `WORLD.camps` table, never hardcoded.
async function raidSweep(page, orders, seeds, campIds) {
  await page.goto('/');
  return page.evaluate(async ({ orders, seeds, campIds, dt }) => {
    const { WORLD } = await import('/src/data.js');
    const game = window.__g;
    // Outcomes depend on canvas size (the fit-to-action camera feeds hero aim, which feeds
    // FOLLOW formation), so pin it before measuring anything.
    const canvas = document.getElementById('game');
    canvas.width = 1280; canvas.height = 720;
    game.camera.w = 1280; game.camera.h = 720;
    const mix = ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'];
    const totals = { runs: 0, wins: 0, lost: 0, heroHp: 0 };
    const real = game.update.bind(game);
    game.update = () => {};
    try {
      for (const seed of seeds) {
        for (const campId of campIds) {
          const camp = WORLD.camps.find(c => c.id === campId);
          window.game.scenario('world', { seed });
          const world = game.scene;
          world.save.troops = mix.map(type => ({ type }));
          world.save.gold = 500;
          world.hero.x = camp.x; world.hero.y = camp.y; world.grace = 0;
          game.input.injectMouse(640, 360, false);
          game.input.injectKey('KeyE', true); real(dt); game.input.injectKey('KeyE', false);
          // Plan 021: KeyE now opens a pre-battle brief (still scene 'world') before
          // committing — confirm it to reach the same battle entry this sweep measures.
          if (game.sceneName === 'world' && world.screen && world.screen.kind === 'brief') {
            game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
          }
          if (game.sceneName !== 'battle') continue;
          const b = game.scene;
          game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
          let t = 0;
          // orders issued during `intro` are discarded, so wait the banner out first
          while (b.state === 'intro' && t < 3) { real(dt); t += dt; }
          if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
          while (b.state !== 'end' && t < 95) { real(dt); t += dt; }
          totals.runs++;
          if (b.victory) totals.wins++;
          totals.lost += b.startTroops - b.troops.length;
          totals.heroHp += Math.max(0, Math.round(b.hero.hp));
        }
      }
    } finally { game.update = real; }
    return {
      runs: totals.runs,
      winPct: Math.round(100 * totals.wins / totals.runs),
      avgLost: Math.round(10 * totals.lost / totals.runs) / 10,
      avgHeroHp: Math.round(totals.heroHp / totals.runs),
    };
  }, { orders, seeds, campIds, dt: DT });
}

test.describe('stance balance', () => {
  test('stance measurements are deterministic and error-free', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const table = {};
    for (const name of Object.keys(FIXTURES)) table[name] = await measure(page, name);

    // Recorded so a balance change is always attributable to a visible number.
    // Non-resolution inside the window is data, not a failure: a stance that grinds
    // is a legitimate measurement, and the player's own out is the retreat edge.
    console.log('stance balance:\n' + JSON.stringify(table, null, 2));

    // Determinism is the hard contract this harness rests on — every later balance
    // assertion is meaningless if the same fixture and stance can drift. FOLLOW is
    // checked explicitly: it is the stance that reads hero facing through `slotPos()`,
    // and the two legacy determinism records both drive CHARGE, which ignores it. That
    // blind spot hid decorative camera shake leaking into fight outcomes.
    for (const stance of STANCES) {
      const repeat = await runStance(page, 'mixed', stance);
      expect(repeat, `mixed/${stance} must replay identically`).toEqual(table.mixed[stance]);
    }

    expect(errors).toEqual([]);
  });

  // RETRACTED — this slot held `a split order beats every uniform order on the mixed
  // fight`, asserted from seed 11 at a 1280x720 canvas. It does not generalize: an
  // independent 10-seed sweep held 1/10, and outcomes also move with canvas size
  // (seed 11 FOLLOW is 41.2s/1 lost at 1280x720, 30.1s/0 at 1024x640, 28.4s/0 at
  // 1600x900) because the fit-to-action camera feeds hero aim and therefore FOLLOW
  // formation. It also held `no uniform stance is the right answer everywhere`, which
  // was vacuous: the wolf and raider fixtures alone guarantee it, so it passed with the
  // whole feature reverted. Both are replaced by the honest measurement below.

  // @sweep: 360 raids, minutes of wall clock, and a recorded finding rather than a
  // regression guard — it cannot go red on a code change, only report a different margin.
  // It runs as its own check (.github/workflows/balance-sweep.yml) so the PR gate does not
  // wait on it; `npm run test:balance` runs it locally. The annotation below stays.
  test('deliberate orders beat giving no order at all', { tag: '@sweep' }, async ({ page }) => {
    // EXPECTED FAILURE — Plan 019's premise is not met, measured on the fight the campaign
    // actually serves: organic camp raids with real garrison rolls, hero parked and idle.
    // The warband is a competent auto-battler, so orders are decoration on a fight that
    // resolves itself. Squad plumbing, stance trade-offs and the HUD are sound in isolation,
    // and the wolf/raider guards below still generalize — what is missing is any reason to
    // touch the keyboard. Do not delete this annotation to tidy the suite; remove it only
    // when commanding actually beats not commanding.
    //
    // Sample size, and why it changed (plans/024, "RETRACTED" section): the original 5
    // seeds x 3 camps = 15 raids/policy was noise-dominated. Two independent wide sweeps of
    // the SAME policies disagreed with each other by 17 points on idle alone (73% vs 56% at
    // 60 and 120 raids respectively) — far larger than the 2-6 point gap between policies in
    // any single sample of that size. Pooled across every sweep taken (15 + 60 + 120 = 195
    // raids/policy), idle led chargeAll 61.7% to 56.7%: the defect is real, but a strict
    // inequality on 15 raids flips on sampling noise regardless of what the game does.
    //
    // This fixture now runs 40 seeds x 3 camps = 120 raids/policy (360 raids total across
    // idle/chargeAll/split). The 40 seeds are `1..40` — a plain arithmetic sequence with no
    // hand-picked values, chosen only for count, not content, so the result cannot be
    // accused of landing on favorable seeds.
    //
    // Measured on this exact fixture (this file, seeds 1..40) across two consecutive runs:
    // idle 73%/73%, chargeAll 62%/60%, split 33%/33% — idle leads chargeAll by 10-11 points
    // both times (the small chargeAll drift between runs is the harness's own residual
    // non-determinism at this scale, not a seed effect; direction and margin are what
    // matter here and both held). Same direction as the pooled 61.7/56.7 margin above (this
    // 120-raid draw landed toward the high end of that pooled range, same as the plan's own
    // 60-raid sweep did). The assertion below (best deliberate policy beats idle) still
    // fails honestly both times, so `test.fail()` reports green — not decided on one run.
    //
    // Plan 027 (enemy command symmetry) attacked this from the other side — the enemy got
    // squads, stances and a commander instead of the player getting more affordances — and
    // it moved the margin without overturning the finding. Re-measured on this exact
    // fixture after that change: idle 78%, chargeAll 78%, split 48%. Charging everything
    // came up twelve points (it was 62%) while pressing nothing barely moved, so the
    // ten-point deficit was a TIE. A tie does not satisfy a strict `toBeGreaterThan`,
    // and flipping the annotation on a zero-point margin would repeat exactly the mistake
    // Plan 019 had to retract, so the annotation stayed. `plans/027-enemy-command-symmetry.md`
    // and `critiques/enemy-command-comparison.md` carry the full before/after table, the
    // isolation control that proves the untouched path replays the old numbers digit for
    // digit, and the four enemy behaviours that measured as making the game EASIER.
    //
    // Plan 028 (encounter power rebase) attacked it from the THIRD side — the encounter
    // generator now sizes every fight on measured combat power instead of headcount — and
    // it did not overturn the finding either. It was resolved at three times this
    // fixture's sample size to make sure: 360 raids per policy
    // (`scripts/zz-orders-wide.mjs`, `scripts/zz-orders-wide.json`), idle 71.7% +/- 2.4,
    // chargeAll 66.4% +/- 2.5, holdLine 36.4%, split 35.6%. Paired seed by seed and camp
    // by camp, charging won 40 raids that pressing nothing lost and lost 59 that it won:
    // a margin of -5.3 +/- 2.8 points AGAINST commanding. This is not a tie and not noise,
    // it is a measured loss, so the annotation stays and the assertion keeps reporting it
    // honestly. See `critiques/encounter-power-comparison.md`.
    test.fail();
    test.setTimeout(600_000); // measured ~168s wall-clock for the full 360-raid sweep; ~3.6x headroom
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40, plain and unpicked
    const camps = ['c1', 'c2', 'c3'];
    const idle = await raidSweep(page, null, seeds, camps);
    const chargeAll = await raidSweep(page, { spear: 'charge', archer: 'charge', knight: 'charge' }, seeds, camps);
    const split = await raidSweep(page, { spear: 'charge', archer: 'hold', knight: 'charge' }, seeds, camps);
    console.log('camp-raid policy sweep:');
    console.log(JSON.stringify({ idle, chargeAll, split }, null, 2));

    const best = [chargeAll, split].reduce((a, b) => (b.winPct > a.winPct ? b : a));
    expect(best.winPct, 'the best deliberate order policy must beat pressing nothing')
      .toBeGreaterThan(idle.winPct);
  });

  test('battle outcomes are independent of canvas size and cursor position', async ({ page }) => {
    // Regression for the worst defect found in the Plan 019 review. Hero aim comes from the
    // cursor through `Camera.toWorld`, whose origin is the fit-to-action camera - which is
    // positioned from the viewport. Formation slots used to hang off aim, so the SAME seed
    // and stance produced 41.2s/1 lost at 1280x720 and 28.4s/0 lost at 1600x900, and a
    // player resizing the window changed who lived. `slotPos()` now reads `travelFacing`.
    // FOLLOW is the stance under test because it is the only one that consults formation.
    await page.goto('/');
    const results = await page.evaluate(({ fixture, dt, timeoutS }) => {
      const game = window.__g;
      const canvas = document.getElementById('game');
      const run = () => {
        const real = game.update.bind(game);
        game.update = () => {};
        try {
          game.startBattle({
            troops: fixture.troops, enemies: fixture.enemies, seed: fixture.seed,
            title: 'VIEWPORT REGRESSION', arena: 'road', biome: 'rose',
            deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
          });
          const b = game.scene;
          b.state = 'fight'; b.deployT = 0;
          let t = 0;
          while (b.state !== 'end' && t < timeoutS) { real(dt); t += dt; }
          return `${Math.round(t * 10) / 10}s/${b.startTroops - b.troops.length}lost/${Math.round(b.hero.hp)}hp`;
        } finally { game.update = real; }
      };
      const out = { viewports: [], cursors: [] };
      for (const [w, h] of [[1280, 720], [1024, 640], [1600, 900], [900, 1400]]) {
        canvas.width = w; canvas.height = h; game.camera.w = w; game.camera.h = h;
        game.input.injectMouse(w / 2, h / 2, false);
        out.viewports.push(run());
      }
      canvas.width = 1280; canvas.height = 720; game.camera.w = 1280; game.camera.h = 720;
      for (const [mx, my] of [[640, 360], [20, 20], [1260, 700]]) {
        game.input.injectMouse(mx, my, false);
        out.cursors.push(run());
      }
      return out;
    }, { fixture: FIXTURES.mixed, dt: DT, timeoutS: TIMEOUT_S });

    expect(new Set(results.viewports).size,
      `outcome varied with canvas size: ${results.viewports.join(' | ')}`).toBe(1);
    expect(new Set(results.cursors).size,
      `outcome varied with cursor position: ${results.cursors.join(' | ')}`).toBe(1);
  });

  test('each single-behavior fixture keeps its intended right answer', async ({ page }) => {
    // Regression guards, already true at the Plan 019 baseline: these two directional
    // properties are what makes HOLD and CHARGE meaningfully different, so the stance
    // trade-off work must not invert them.
    const wolves = await measure(page, 'wolves');
    const raiders = await measure(page, 'raiders');

    expect(wolves.hold.lost, 'HOLD must not lose more men than CHARGE to a wolf pack')
      .toBeLessThanOrEqual(wolves.charge.lost);
    expect(raiders.charge.seconds, 'CHARGE must close a raider band faster than HOLD')
      .toBeLessThan(raiders.hold.seconds);
  });

  test('every stance can finish a winnable fight', async ({ page }) => {
    // Regression for the defect found while recording the Plan 019 baseline: FOLLOW
    // against a kiting raider band used to run past 90s without resolving, because
    // `bloodlust` only watched for damage and kiting raiders keep landing hits. The
    // no-death stall clock (`STALL_NO_DEATH`) is what closes it.
    const table = {};
    for (const name of Object.keys(FIXTURES)) table[name] = await measure(page, name);

    for (const [name, results] of Object.entries(table)) {
      for (const stance of STANCES) {
        expect(results[stance].resolved, `${name}/${stance} must reach a terminal state`).toBe(true);
      }
    }
  });
});
