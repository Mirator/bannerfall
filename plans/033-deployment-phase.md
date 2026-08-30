# 033 — Deployment phase

## Problem

The deploy window (Plan 019 era) is a timer, not a decision. For up to 8 seconds
the enemy stands completely motionless while the player may reposition under no
pressure; combined with the Plan 027 muster (up to `CMD_FORM_MAX` = 6s of
standing at slots), the opening of a mutual fight is as much as 14 seconds of an
opponent doing visibly nothing. The player-side affordance is equally weak:
repositioning during the window is done by walking the hero around and reissuing
FOLLOW/HOLD, and any placement is undone the moment the fight starts unless the
player separately orders HOLD.

## Change

Replace the timed deploy window with a paused deployment phase.

- A battle that previously carried a positive deploy window (`setup.deploy`
  absent or > 0, and not an ambush) now opens `intro -> deploy` instead of
  `intro -> fight`. In `deploy` the simulation is fully paused: no phases run,
  `battle.time` does not advance, no clocks accumulate. The state is left by an
  explicit CONFIRM (Enter / E), gated by a short arm delay (`DEPLOY_ARM_T`) so a
  buffered keypress from the map cannot skip the phase unseen — the same
  arm-before-commit rule the world-screen modals follow.
- The player positions his men by dragging them (hero included) with the mouse,
  clamped to his own deployment ground: everything on his side of the field up
  to `DEPLOY_NO_MANS` short of the field's midline along the approach axis.
  Squad orders (1/2/3, Tab) still land during the phase, as they already did
  during the intro banner.
- On confirm, every troop's hold anchor is set to its placed position and every
  squad whose stance is still the neutral `follow` is put on HOLD. Without this
  the placement is fiction — FOLLOW walks every body straight back to its
  formation slot behind the hero on the first fight tick. A squad the player
  explicitly ordered during the phase keeps that order.
- The enemy deploys too: a battle with a deployment phase spawns its force
  already formed — melee ranks in front (bandit rank 0, brute rank 1), raiders
  behind, wolves split onto the wings — instead of the legacy seeded scatter,
  using the same eslot geometry the Plan 027 muster reads. Fights without the
  phase (ambush, caught-fleeing, `deploy: 0` fixtures) keep the scatter spawn:
  an ambush pincer has no parade formation by definition.
- The old window's countdown HUD, its first-blood early-out, and the
  enemy-frozen block at the top of `updateEnemyPhase` are deleted. The
  `THEY ADVANCE!` horn moves to the confirm. `deployT`/`deployMax` no longer
  exist; fixtures that wrote `deployT = 0` are inert and fixtures that need the
  fight running keep forcing `state = 'fight'` exactly as before.

## What this buys

Complaint 1 of the combat rehaul ("the enemy politely waits") loses both of its
standing-still sources: the frozen window is gone entirely, and because the
enemy now starts formed, the commander's first decision finds `isFormedUp`
nearly satisfied and spends at most a short march on `form` before the assault
doctrine goes in, instead of walking to slots from a scatter and standing.

## Test impact (updated honestly, not weakened)

- `qa_suite.js` record 26 (enemy command symmetry) re-reads its deploy-window
  clause against the new mechanic: no commander order while `state === 'deploy'`
  (the phase runs no ticks at all), squads neutral at entry, divergence after
  confirm. Records that drive a battle to its end through production paths gain
  one CONFIRM tap where they used to wait out the window.
- Battle visual baselines change by design: the 1.5s settle frame for a
  non-ambush battle now shows the paused deployment screen (both formed lines,
  the deployment frontier, the instruction panel). `battle_bridge` is an ambush
  and keeps its live frame. Baselines are recaptured through the Visual
  baselines workflow, per tests/README.md.
- `tests/README.md`'s intro rule gains the deploy rule: a production-path battle
  sits paused in `deploy` until CONFIRM; fixtures either force `state = 'fight'`
  or tap Enter.

## Measurements

- `npm test` full gate after the change: 181/181, including the recaptured
  battle baselines (regenerated in the CI-equivalent Linux container; the
  `battle_bridge` ambush baseline needed no change, which is the control that
  the scatter path is untouched).
- The 360-raid balance sweep (`npm run test:balance`) drives production battle
  entry, so it DOES cross the phase; `raidSweep` gained the armed CONFIRM press.
  The first attempt reused the cumulative fixture clock for the arm wait, the
  confirm was refused, and the guard's throw made `test.fail()` report green in
  2.0s — the exact vacuous-measurement failure the fixture's own comments warn
  about. Fixed with a dedicated arm clock; the honest run takes 3.3 minutes.
- Measured on the fixed sweep (120 raids per policy): idle 67% (was 69.2%),
  chargeAll 52% (was 68%), split 35% (was 45%). "Pressing nothing" now includes
  the unavoidable deployment confirm, after which the warband holds its placed
  line; the enemy starts formed and assaults as one body. The idle line barely
  moved; charging into a pre-formed enemy lost sixteen points. The orders-vs-idle
  finding stands with a wider margin (fifteen points against commanding), and
  the `test.fail` annotation stays.
