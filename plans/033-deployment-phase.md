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

## Test impact

- `qa_suite.js` record 26 (enemy command symmetry) re-reads its deploy-window
  clause against the new mechanic: no commander order while `state === 'deploy'`
  (the phase runs no ticks at all), squads neutral at entry, divergence after
  confirm. Records that drive a battle to its end through production paths gain
  one CONFIRM tap where they used to wait out the window.
- Battle visual baselines change by design: the 1.5s settle frame for a
  non-ambush battle now shows the paused deployment screen (both formed lines,
  the deployment frontier, the instruction panel). `battle_bridge` is an ambush
  and keeps its live frame. The PNGs in this branch were captured in the
  CI-equivalent Linux container (`npm run test:visual:linux -- --update-snapshots`);
  the Visual baselines workflow stays the canonical writer, and the PR gate is
  what adjudicates whether the container capture matches CI — if it disagrees,
  the workflow recaptures them.
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

## Review pass (same branch, second commit)

An eight-angle review with per-candidate verification found ten confirmed
defects in the first commit; all were fixed before the PR:

- Three qa_suite records (perf smoke, seeded-battle determinism, RNG-domain
  independence) stepped a paused deployment scene and asserted nothing about
  live combat. All three now confirm through the shared `soundAdvance()` helper,
  which also replaced the five hand-rolled confirm rituals.
- The formed enemy line centred on the exact Break-guard muster point: a
  3-guard line's middle tower sat at distance 0.0 from rank-0's centre column,
  and guards are not obstacles, so nothing resolved the overlap while paused.
  The formation now stands 70 behind the guard line when objective targets
  exist. The muster-anchor and deployment placements also share one
  `slotOffset()` source and one clamp margin.
- A deliberate FOLLOW pressed during the phase was indistinguishable from the
  neutral default and silently promoted to HOLD at confirm; the press itself
  was also a silent no-op. `issueCommand` records deploy-phase orders in
  `_deployOrdered` (before its repeat no-op, which is skipped during the phase
  so the press is acknowledged), and `confirmDeploy` promotes only unordered
  squads.
- Squad hold banners anchored at the hero (N stacked pennants) and pre-ordered
  HOLD squads kept stale order-time anchors; banners now anchor at each squad's
  placed centroid, refreshed at confirm, with the same confirmation rings
  `issueCommand` draws.
- The fit-to-action camera followed the dragged body, closing a same-frame
  feedback loop (measured gain 0.275-0.885, 1.4-8.7x over-travel before the
  clamps arrest it). The camera holds still while a drag is held and refits on
  release.
- Campaign playT accrued through the unbounded pause; `Battle.isTimeFrozen()`
  now feeds main.js's existing blocking gate.
- A command flash issued during the phase never decayed (the intro shared the
  bounded form of the defect); both paused branches decay it now.
- `Input.clear()` (the alt-tab recovery) left `mouse.down` true, so a drag
  survived focus loss and glued the unit to the cursor; clear() resets it.
- The player's troops opened the phase as the ride-in scatter blob, so an
  instant confirm held a blob, not a line; they now deploy on FOLLOW's own slot
  geometry, and the hero opens facing the enemy on every approach (slotPos
  hangs the formation off travelFacing, which was hardcoded east).
- Cleanup from the same review: dead `deployT` writes removed from six e2e
  fixtures, the `deploy: 4` second-count literals removed from site-menu (the
  field is a tri-state read for truthiness), the zone tint derives from
  adx/ady instead of a second string-keyed cascade, the frontier dash length is
  clipped to the field, and a perf budget case covers the deploy render path,
  which no budget could previously reach.

Not changed, recorded as accepted: the stronghold reserve wave's `at` now
counts live-fight seconds only (the old `deploy: 4` window advanced
battle.time, so the wave effectively arrived ~21s into fighting; it is 25s of
fighting now — the fight-relative meaning is the intended one going forward).
The scatter simRng draws for deploy-enabled battles are deliberately kept and
now say so in place. Throws inside the `test.fail` sweep still report a broken
fixture as green — inherited from the two pre-existing entry guards; fixing it
means rethinking the annotation pattern, not this slice.

## Wide paired measurement (scripts/zz-orders-wide.mjs, fixed this branch)

The Plan 028 harness measured zero runs since Plan 030 (KeyE now opens the site
menu, and its `continue` fell through silently). It drives the full current
entry flow with every gate asserted. On this branch, 360 raids per policy:
idle 66.7+/-2.5, chargeAll 54.7+/-2.6, holdLine 53.1, split 33.3; paired
McNemar margin chargeAll vs idle -11.9+/-3.2 points. Output preserved as
`scripts/zz-orders-033-deploy.json`; Plan 028's committed
`zz-orders-wide.json` is untouched.

## The orders-vs-idle finding resolved

The review pass moved the sweep a second time, and this time it crossed. The
first commit's numbers (idle 67 / chargeAll 52 / split 35) kept the annotation:
the deficit against commanding had widened. The review pass then made the
player's troops deploy formed instead of as the ride-in scatter, and a
formed-tight line holding at spawn is a no-input baseline the enemy commander
punishes: measured twice on the shipped sweep, digit for digit both runs,
idle 49 / chargeAll 60 / split 34. Commanding beats pressing nothing by eleven
points, outside every earlier margin's drift band (0.0 in Plan 027, -0.9 in
Plan 029, both left unflipped for exactly that reason). The `test.fail`
annotation carried since Plan 019's retraction is removed on its own stated
terms, and the assertion now guards the property. CLAUDE.md and
tests/README.md are updated to match.
