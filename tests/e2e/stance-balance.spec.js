import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';
import { WOLF_STALK_R, HOLD_REACH_MELEE } from '../../src/battle/constants.js';
import ORDERS_BASELINE from './__baselines__/orders-sweep.json' with { type: 'json' };
import { UNIT_TYPES } from '../../src/data.js';

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
  // actually measured.
  //
  // Plan 029 changed what HOLD means here, and the old note ("HOLD wins through slam
  // avoidance, NOT bracing: a brute moves at 55 and can never reach BRACE_SPEED") is now
  // wrong in both halves. A brute ORDERED forward by the enemy commander's `commit`
  // doctrine does latch the rush memory, so a braced line can punish it; and HOLD is also
  // what arms the archers' anti-brute counter, which is deliberately gated behind steady
  // aim rather than being free (see bonusVersus in ai-phases.js for the 7.5 points of idle
  // camp-raid win rate the ungated version handed away). This fixture is therefore the one
  // that measures whether HOLD is a real answer to a heavy body rather than a slower FOLLOW.
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
      // An idle hero aims at the cursor, and FOLLOW formation slots hang off hero facing,
      // so the pointer is a real simulation input. Pin it to the canvas centre and clear
      // any residual camera shake, or a stray mouse position silently rewrites the result.
      game.input.injectMouse(game.camera.w / 2, game.camera.h / 2, false);
      game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
      if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
      else b.issueCommand(stance);
      let t = 0;
      // Plan 040: when the FIRST enemy body falls, not just when the fight ends. A stance
      // that produces nothing for fourteen seconds and then wins on the no-death stall
      // clock reads identically to one that fought, if all you record is the total.
      const startEnemies = b.enemies.length;
      let firstKillT = null;
      while (b.state !== 'end' && t < timeoutS) {
        realUpdate(dt); t += dt;
        if (firstKillT === null && b.enemies.length < startEnemies) firstKillT = Math.round(t * 10) / 10;
      }
      return {
        stance: stance || Object.values(orders).join('/'),
        resolved: b.state === 'end',
        seconds: Math.round(t * 10) / 10,
        firstKillT,
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
// `held` is how many settlements the fixture owns before it raids (Plan 039). It is the
// fixture's CAMPAIGN STAGE: since Plan 038 every generated force is priced off
// `strongholdPoints(save)` = held settlements + razed linked camps, and this fixture used
// to sit at stage 0 while installing the near-capped roster the stage curve calls stage 7.
// That made it, by construction, the easiest fight the game can produce — measured idle 94
// and chargeAll 100, a saturated column with no room left for a regression to show in.
async function raidSweep(page, orders, seeds, campIds, held = 0) {
  await page.goto('/');
  return page.evaluate(async ({ orders, seeds, campIds, dt, held }) => {
    const { WORLD } = await import('/src/data.js');
    const game = window.__g;
    // Outcomes depend on canvas size (the fit-to-action camera feeds hero aim, which feeds
    // FOLLOW formation), so pin it before measuring anything.
    const canvas = document.getElementById('game');
    canvas.width = 1280; canvas.height = 720;
    game.camera.w = 1280; game.camera.h = 720;
    const mix = ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'];
    const totals = { runs: 0, wins: 0, lost: 0, heroHp: 0 };
    const rows = []; // Plan 044: one entry per raid — the pairing and the timeout budget
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
          // Stage, as ownership: the camps must stay un-razed (they are what this sweep
          // raids), so held settlements are the only points available to it.
          for (let i = 0; i < held && i < world.save.settlements.length; i++) {
            world.save.settlements[i].owner = 'player';
          }
          world.hero.x = camp.x; world.hero.y = camp.y; world.grace = 0;
          game.input.injectMouse(640, 360, false);
          game.input.injectKey('KeyE', true); real(dt); game.input.injectKey('KeyE', false);
          // Plan 030: KeyE opens the site menu (its raid row selected), and Plan 021's
          // pre-battle brief sits behind that — two confirms to reach the same battle entry
          // this sweep measures. Both are asserted rather than skipped: a `continue` here
          // would let the sweep silently measure nothing if the flow changes again.
          if (game.sceneName === 'world' && world.screen && world.screen.kind === 'site') {
            game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
          }
          if (game.sceneName === 'world' && world.screen && world.screen.kind === 'brief') {
            game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
          }
          if (game.sceneName !== 'battle') {
            throw new Error('camp assault did not reach a battle: scene=' + game.sceneName +
              ', screen=' + ((world.screen || {}).kind || 'none'));
          }
          const b = game.scene;
          game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
          let t = 0;
          // orders issued during `intro` are discarded, so wait the banner out first
          while (b.state === 'intro' && t < 3) { real(dt); t += dt; }
          // Plan 033: production-path battles pause on the deployment phase. Arm CONFIRM
          // (DEPLOY_ARM_T), then press it — asserted like the two confirms above, so the
          // sweep can never silently measure a fight that was paused the whole window.
          // The confirm's hold-promotion is part of what "pressing nothing" now means: an
          // idle player still sounds the advance, and his placed line holds by default.
          let armT = 0; // its own clock: `t` already carries the intro wait
          while (b.state === 'deploy' && armT < 0.5) { real(dt); t += dt; armT += dt; }
          if (b.state === 'deploy') {
            game.input.injectKey('Enter', true); real(dt); t += dt; game.input.injectKey('Enter', false);
          }
          if (b.state !== 'fight') {
            throw new Error('the deploy confirm did not start the fight: state=' + b.state);
          }
          if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
          while (b.state !== 'end' && t < 95) { real(dt); t += dt; }
          totals.runs++;
          if (b.victory) totals.wins++;
          totals.lost += b.startTroops - b.troops.length;
          totals.heroHp += Math.max(0, Math.round(b.hero.hp));
          // Plan 044: a raid that never reached a terminal state inside the window is NOT a
          // loss, it is a raid this harness failed to measure — and scoring it as a loss is
          // what manufactured this sweep's entire recorded margin for five plans. Recorded
          // per raid so the caller can both budget them and pair policies seed by seed.
          rows.push({ seed, campId, resolved: b.state === 'end', victory: !!b.victory });
        }
      }
    } finally { game.update = real; }
    return {
      runs: totals.runs,
      winPct: Math.round(100 * totals.wins / totals.runs),
      avgLost: Math.round(10 * totals.lost / totals.runs) / 10,
      avgHeroHp: Math.round(totals.heroHp / totals.runs),
      unresolved: rows.filter(r => !r.resolved).length,
      rows,
    };
  }, { orders, seeds, campIds, dt: DT, held });
}

// Plan 044: the paired (McNemar) comparison the sweep should always have used. The policies
// run the SAME seeds and camps, so comparing two rounded `winPct` integers with `>` throws
// away the pairing and compares two independent-looking proportions whose difference the
// sample cannot resolve. Over discordant pairs only, the margin is (wonOnly - lostOnly) / N
// and its standard error is sqrt(discordant) / N.
function pairedMargin(policy, idle) {
  const key = r => `${r.seed}|${r.campId}`;
  const idleWon = new Map(idle.rows.map(r => [key(r), r.victory]));
  let wonOnly = 0, lostOnly = 0;
  for (const r of policy.rows) {
    const i = idleWon.get(key(r));
    if (r.victory && !i) wonOnly++;
    else if (!r.victory && i) lostOnly++;
  }
  const discordant = wonOnly + lostOnly, n = policy.rows.length;
  const marginPct = Math.round(1000 * (wonOnly - lostOnly) / n) / 10;
  const sePct = discordant ? Math.round(1000 * Math.sqrt(discordant) / n) / 10 : 0;
  return { wonOnly, lostOnly, discordant, marginPct, sePct,
    sigma: sePct ? Math.round(10 * Math.abs(marginPct) / sePct) / 10 : 0 };
}

// A policy that cannot finish its fights is not a measurement. Pre-Plan-042 this sweep ran
// at 19% (idle) and 21% (holdLine) unresolved and printed nothing about it; on the tree that
// budget was written against the worst policy is 5.8%. See plans/044.
const TIMEOUT_BUDGET_PCT = 10;

// The same budget for the 24-raid PR-gate probe below, loosened to what THAT sample can
// resolve. Calibrated by running the probe against both trees (seeds 1..8 x 3 camps):
//
//     policy      pre-042 9c5270d   main 2df8896
//     idle              3 (12.5%)       0
//     chargeAll         0               0
//     holdLine          7 (29.2%)       3 (12.5%)
//
// 20% sits between the two and fails the broken tree on holdLine, the slowest policy and so
// the best canary. Tightening it to the full sweep's 10% would fail the healthy tree on a
// three-raid subsample fluctuation around a true rate of 5.8%.
const PROBE_TIMEOUT_BUDGET_PCT = 20;

// Drift tolerance against the committed table: 2x the per-policy standard error at 120 raids
// (sqrt(0.8 * 0.2 / 120) = 3.7 points). Ordinary sampling movement passes; the 14-point idle
// shift PR #34 introduced does not.
const BASELINE_DRIFT_PCT = 7.4;

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

  // @sweep: 360 raids and minutes of wall clock, so it runs as its own check
  // (.github/workflows/balance-sweep.yml) and the PR gate does not wait on it;
  // `npm run test:balance` runs it locally.
  //
  // IT CAN GO RED, AND A RED SWEEP BLOCKS THE MERGE. The header that used to sit here said
  // the opposite — "a recorded finding rather than a regression guard … it cannot go red on
  // a code change" and "the annotation below stays" — describing a `test.fail()` that Plan
  // 033 had already removed. `.github/workflows/balance-sweep.yml` carried the same stale
  // claim in the description a reviewer reads beside the red X. PR #34 was merged over three
  // red sweep runs. Do not reintroduce either sentence.
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
    //
    // Plan 029 (unit identity and progression) is the FOURTH attempt and the closest so
    // far, and it still does not overturn the finding. It rebuilt the brace so that it
    // actually fires (measured, the old rule fired on 0-6% of contacts because it read the
    // target's velocity at the instant of the swing, when a body in spear reach has already
    // braked) and gave the archer an anti-brute counter gated behind steady aim. Both make
    // HOLD worth pressing, and the numbers moved accordingly on this exact fixture: over
    // 120 raids per policy, holdLine went from 35.0% to 51.7% and split from 36.7% to
    // 45.0%, while idle went from 70.8% to 69.2%. The best deliberate policy is now within
    // ONE POINT of pressing nothing (69% idle against 68% chargeAll on the run recorded in
    // `critiques/progression-comparison.md`) where Plan 028 measured a 5.3-point deficit.
    // One point behind is still behind, `toBeGreaterThan` is still a strict inequality, and
    // flipping an annotation on a margin inside the harness's own run-to-run drift is the
    // exact mistake Plan 019 had to retract. The annotation stays.
    //
    // Plan 032 (facing and flank arcs) was the FIFTH attempt, measured against pre-033 main,
    // and it moved the margin to zero for the second time in this finding's history. It named
    // what the previous four were working around: nothing in the damage arithmetic read
    // `facing`, so a blow landed for the same number from in front and from directly behind,
    // and Plan 027's flanking muster changed only where the enemy walked rather than what the
    // walk was worth. A melee blow from outside the defender's front arc now pays FLANK_BONUS,
    // and a set line cannot brace against what reaches it from behind — both rules symmetric,
    // both reading the shipped constants on the enemy side. Measured on this exact fixture
    // (pre-033 baseline): idle 69 -> 68, chargeAll 68 -> 68, split 45 -> 48, so the best
    // deliberate policy went from one point behind pressing nothing to LEVEL with it. Both
    // replayed digit for digit across two consecutive runs. Idle FELL, which was the failure
    // mode the slice was watching for: both sides encircle, but a camp garrison outnumbers
    // the warband, so the extra blows land on the player at least as often.
    //
    // A tie is not a strict inequality and the annotation stayed at that point. Worth
    // recording because it is the near miss: FLANK_BONUS = 1.60 made this assertion PASS
    // (67 / 68 / 43, chargeAll ahead by one). It was rejected rather than shipped —
    // commanding does not improve between 1.35 and 1.60 (chargeAll is 68 at both) and split
    // is five points worse, so the whole crossing was one point of erosion on idle, inside
    // the noise of 120 raids. Picking the constant that produces it would have been choosing
    // a value to satisfy this line. See `plans/032-facing-and-flank-arcs.md` finding 3.
    //
    // Plan 033 (the deployment phase) changed what BOTH columns of this sweep mean, and it
    // is the change that finally resolved the finding. "Pressing nothing" now includes the
    // one press nobody can skip — confirming the deployment — after which the un-ordered
    // warband HOLDS its placed line instead of following, and both sides start formed. The
    // plan's first commit measured idle 67 / chargeAll 52 / split 35 (annotation kept: the
    // deficit against commanding had WIDENED). Its review pass then made the player's
    // troops deploy formed instead of as the ride-in scatter, and the formed-tight line
    // holding at spawn is a no-input baseline the enemy commander can actually punish:
    // measured TWICE on this exact fixture, digit for digit both runs, idle 49 / chargeAll
    // 60 / split 34. Commanding beats pressing nothing by eleven points — far outside the
    // run-to-run drift every earlier margin drowned in (Plan 027's 0.0, Plan 029's -0.9).
    //
    // The `test.fail()` that sat here from Plan 019's retraction to Plan 033 is therefore
    // removed on its own stated terms ("remove it only when commanding actually beats not
    // commanding").
    //
    // PLAN 044 RETRACTS THAT CONCLUSION, and with it the strict inequality this test used to
    // assert. The margin every plan above argued over was, in large part, the TIMEOUT gap
    // between policies, and this harness never printed timeouts at all. Measured at 120
    // raids per policy, each raid split into win / timeout (never terminal inside the 95s
    // window, scored as a loss) / real loss:
    //
    //                 pre-042 9c5270d      rescue disabled        main 2df8896
    //                 win%  t/o  loss      win%  t/o  loss      win%  t/o  loss
    //     idle        68.3   23    15      63.3   25    19      81.7    4    18
    //     chargeAll   75.8    3    26      79.2    4    21      78.3    1    25
    //     split       52.5   18    39      58.3   18    32      75.8    0    29
    //     holdLine    54.2   25    30      51.7   30    28      70.8    7    28
    //
    // Idle timed out on 23 of 120 raids and chargeAll on 3: a 20-raid gap, ~17 points of win
    // rate, against a recorded margin of +7.5. Plan 042's obstacle rescue closed that gap
    // (idle 23 -> 4) and left the REAL losses alone (15 -> 18, 26 -> 25, 39 -> 29, 30 -> 28),
    // so the raids it recovered resolve as wins and the ranking inverted. Charging was not
    // winning more fights; it was finishing them (median 20s against idle's 42s) before the
    // palisade could deadlock them.
    //
    // Paired (McNemar) margins for chargeAll against idle: +7.5 +/- 6.0 pre-042 (1.2 sigma),
    // +15.8 +/- 6.2 with the rescue disabled, -3.3 +/- 5.4 on main (0.6 sigma). The only
    // reading past two sigma is the one with the deadlocks left in. This test never measured
    // its property at a resolvable confidence, so asserting `best > idle` was asserting a
    // coin flip — it passed Plan 040 at +3 (0.6 sigma) and fails now at -3.3 (0.6 sigma) on
    // the same evidence quality.
    //
    // What is asserted instead, below: the two things this sample CAN resolve.
    //   1. A timeout budget. A policy that cannot finish its fights is not a measurement, and
    //      the old fixture would have failed this at 19% and 21%.
    //   2. Drift against a committed baseline table. That is the guard PR #34 needed: idle
    //      moving 68 -> 82 is enormous against a per-policy SE of ~4, and fails loudly here,
    //      where `best > idle` merely flipped sign and got argued about.
    // The margin itself is RECORDED with its confidence interval on every run. Whether
    // commanding should beat pressing nothing is a live design question again (see
    // plans/044-the-sweep-tells-the-truth.md); it is not a property this fixture can assert.
    // PLAN 039 RE-BASED THE FIXTURE, and this is the one change to it that was not a
    // change to what it asserts. Plan 038 priced every generated force off campaign STAGE,
    // and this fixture installs the near-capped roster the stage curve calls stage 7 into a
    // stage-0 save — by construction the easiest fight the game can produce. It saturated:
    // idle went 49 -> 94 and chargeAll 60 -> 100, pinning a column at the ceiling where no
    // regression could ever show. Measured over the same 40 seeds x 3 camps at three
    // candidate stages (`node scripts/zz-orders-wide.mjs --seeds 40 --held N`):
    //
    //     held  idle   chargeAll  split  holdLine
    //        0  94.2       100.0   91.7      94.2   <- saturated, chargeAll at the ceiling
    //        2  86.7        92.5   73.3      80.0
    //        4  67.5        75.0   52.5      61.7   <- chosen
    //
    // Four held settlements is the highest stage this fixture can reach (the camps must
    // stay un-razed — they are what it raids), it puts all four policies in a measurable
    // band with nothing at 0 or 100, and the guard's margin WIDENS from 5.8 to 7.5 points.
    // The stage was chosen on headroom, and the grid is recorded here whichever way it fell.
    test.setTimeout(600_000); // measured ~168s wall-clock for the full 360-raid sweep; ~3.6x headroom
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1); // 1..40, plain and unpicked
    const camps = ['c1', 'c2', 'c3'];
    const HELD = 4;
    const idle = await raidSweep(page, null, seeds, camps, HELD);
    const chargeAll = await raidSweep(page, { spear: 'charge', archer: 'charge', knight: 'charge' }, seeds, camps, HELD);
    const split = await raidSweep(page, { spear: 'charge', archer: 'hold', knight: 'charge' }, seeds, camps, HELD);
    const measured = { idle, chargeAll, split };

    // The record, printed whichever way the assertions fall — including the two numbers the
    // old table hid: how many raids never finished, and what the margin's error bar is.
    const table = {};
    for (const [name, r] of Object.entries(measured)) {
      table[name] = { runs: r.runs, winPct: r.winPct, unresolved: r.unresolved,
        avgLost: r.avgLost, avgHeroHp: r.avgHeroHp };
      if (name !== 'idle') table[name].pairedVsIdle = pairedMargin(r, idle);
    }
    console.log('camp-raid policy sweep:');
    console.log(JSON.stringify(table, null, 2));
    console.log('delta vs ' + ORDERS_BASELINE.recordedAt + ' baseline:');
    console.log(JSON.stringify(Object.fromEntries(Object.entries(measured).map(([name, r]) =>
      [name, { winPct: r.winPct - ORDERS_BASELINE.policies[name].winPct,
        unresolved: r.unresolved - ORDERS_BASELINE.policies[name].unresolved }])), null, 2));

    // 1. The timeout budget. Unresolved is not a loss, it is a raid this harness failed to
    //    measure; a policy over the budget invalidates every number beside it.
    for (const [name, r] of Object.entries(measured)) {
      expect(100 * r.unresolved / r.runs,
        `${name} left ${r.unresolved}/${r.runs} raids unresolved — a policy that cannot finish ` +
        `its fights is not a measurement (see plans/044)`).toBeLessThanOrEqual(TIMEOUT_BUDGET_PCT);
    }

    // 2. Drift against the committed table. Tolerance is 2x the per-policy standard error at
    //    this sample size (sqrt(0.8*0.2/120) = 3.7 points), so ordinary sampling movement
    //    passes and a real balance shift — PR #34 moved idle by 14 — does not. Re-record
    //    tests/e2e/__baselines__/orders-sweep.json in the same change that moves it, and say
    //    in the plan why the new number is the correct one.
    for (const [name, r] of Object.entries(measured)) {
      const was = ORDERS_BASELINE.policies[name];
      expect(Math.abs(r.winPct - was.winPct),
        `${name} moved ${was.winPct} -> ${r.winPct} against the recorded baseline ` +
        `(${ORDERS_BASELINE.recordedAt}); re-record it deliberately or explain the shift`)
        .toBeLessThanOrEqual(BASELINE_DRIFT_PCT);
    }
  });

  // Plan 044: the sweep above is minutes of wall clock and runs in its own check, so the PR
  // gate never saw the defect it was built to catch. This is the cheap half — the timeout
  // budget only, over 8 seeds x 3 camps (24 raids/policy, ~30s) — and it is deliberately NOT
  // tagged @sweep so it runs inside `npm test`.
  //
  // It asserts nothing about the MARGIN: at 24 raids the standard error is ~8 points, which
  // could not resolve a policy difference if it tried. Deadlocks are a different quantity and
  // a much louder one — see the calibration table at PROBE_TIMEOUT_BUDGET_PCT — so this is
  // the part worth paying for on every pull request.
  //
  // holdLine is in this probe and not in the sweep above on purpose: it is the slowest policy
  // and therefore the first to deadlock, which makes it the canary.
  test('no order policy deadlocks its way through a camp raid', async ({ page }) => {
    test.setTimeout(180_000);
    const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
    const camps = ['c1', 'c2', 'c3'];
    const policies = {
      idle: null,
      chargeAll: { spear: 'charge', archer: 'charge', knight: 'charge' },
      holdLine: { spear: 'hold', archer: 'hold', knight: 'charge' },
    };
    const table = {};
    for (const [name, orders] of Object.entries(policies)) {
      const r = await raidSweep(page, orders, seeds, camps, 4);
      table[name] = { runs: r.runs, winPct: r.winPct, unresolved: r.unresolved };
    }
    console.log('camp-raid deadlock probe:\n' + JSON.stringify(table, null, 2));
    for (const [name, r] of Object.entries(table)) {
      expect(100 * r.unresolved / r.runs,
        `${name} left ${r.unresolved}/${r.runs} camp raids unresolved inside the 95s window`)
        .toBeLessThanOrEqual(PROBE_TIMEOUT_BUDGET_PCT);
    }
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
          b.state = 'fight';
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

  test('the wolf stand band lies inside the bow line reach', () => {
  // Plan 040, finding 15, asserted as the ARITHMETIC it is rather than as an outcome.
  //
  // A stalking wolf backs off under `0.9 R` and stands its ground out to `1.25 R`
  // (updateEnemyPhase in ai-phases.js), so a pack occupies the band [0.9R, 1.25R] around
  // its target. At WOLF_STALK_R 250 that band was 225-312 px against an archer's range of
  // 230: most of a pack stood outside the only weapon the warband owns that can reach it,
  // because nothing it fields except the knight (175) and the hero (315) can catch a body
  // moving at 158. The whole band must sit inside archer range, which is R <= 184; the
  // shipped 180 leaves a stalker standing between 162 and 225.
  //
  // This is a CONTRACT BETWEEN TWO TABLES and nothing else guarded it. Raising
  // WOLF_STALK_R, or lowering the archer's range, silently makes a pack unanswerable
  // again — which is the state this plan found the game in. Both bounds are read from the
  // shipped constants, so retuning either is allowed and decoupling them is not.
  //
  // The lower bound used to read UNIT_TYPES.spear.range (30), which is the gap a spearman
  // closes to swing and NOT the ground a braced line covers. That left ~130px of slack:
  // the assertion passed with WOLF_STALK_R nearly reverted to 250, which is the whole
  // defect it exists to catch. The reach a held melee body actually reaches for anything
  // at all is HOLD_REACH_MELEE (ai-phases.js `holdReach`), so that is the bound.
  const stand = { near: WOLF_STALK_R * 0.9, far: WOLF_STALK_R * 1.25 };
  expect(stand.far,
    `a stalking wolf stands out to ${stand.far}px, past the archer's ${UNIT_TYPES.archer.range}px ` +
    'reach — a held bow line cannot answer a pack and nothing else the warband owns can catch one')
    .toBeLessThanOrEqual(UNIT_TYPES.archer.range);
  // And it must stay OUT of melee reach, or the pack stops being a skirmisher problem and
  // becomes a slow bandit that walks into the spears.
  expect(stand.near,
    `a stalking wolf closes to ${stand.near}px, inside a held line's ${HOLD_REACH_MELEE}px ` +
    'reach — the pack is no longer something melee cannot solve')
    .toBeGreaterThan(HOLD_REACH_MELEE);
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


test('explicit pre-fight FOLLOW survives deployment while the untouched default holds', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  const out = await page.evaluate(() => {
    const g = window.__g, real = g.update.bind(g), dt = 1 / 60;
    g.update = () => {};
    try {
      const run = (keys, duringDeploy = false, ambush = false) => {
        g.startBattle({ troops: [{ type: 'spear' }, { type: 'archer' }],
          enemies: [{ type: 'bandit' }], seed: 17, ambush, onEnd: () => {} });
        const b = g.scene;
        const press = key => { g.input.injectKey(key, true); real(dt); g.input.injectKey(key, false); };
        if (duringDeploy) for (let i = 0; i < 100; i++) real(dt);
        const orderState = b.state;
        for (const key of keys) press(key);
        for (let i = 0; i < 100 && b.state === 'intro'; i++) real(dt);
        const afterIntro = b.state;
        if (b.state === 'deploy') {
          for (let i = 0; i < 30; i++) real(dt);
          press('Enter');
        }
        return { orderState, afterIntro, state: b.state,
          spear: b.squads.spear.stance, archer: b.squads.archer.stance };
      };
      return {
        untouched: run([]), follow: run(['Digit1']), charge: run(['Digit2']),
        changedBack: run(['Digit2', 'Digit1']), selected: run(['Tab', 'Digit1']),
        deployFollow: run(['Digit1'], true), ambush: run(['Digit1'], false, true),
      };
    } finally { g.update = real; }
  });
  for (const key of ['untouched', 'follow', 'charge', 'changedBack', 'selected']) {
    expect(out[key].orderState).toBe('intro');
    expect(out[key].afterIntro).toBe('deploy');
    expect(out[key].state).toBe('fight');
  }
  expect(out.untouched.spear).toBe('hold');
  expect(out.untouched.archer).toBe('hold');
  for (const key of ['follow', 'changedBack', 'deployFollow', 'ambush']) {
    expect(out[key].spear).toBe('follow');
    expect(out[key].archer).toBe('follow');
  }
  expect(out.charge.spear).toBe('charge');
  expect(out.charge.archer).toBe('charge');
  expect(out.selected.spear).toBe('follow');
  expect(out.selected.archer).toBe('hold');
  expect(out.deployFollow.orderState).toBe('deploy');
  expect(out.ambush.afterIntro).toBe('fight');
  expect(errors).toEqual([]);
});
