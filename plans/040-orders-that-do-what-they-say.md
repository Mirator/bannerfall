# 040 — Orders that do what they say: a line that holds, arrows that land, a squad you can send

STATUS: IN PROGRESS. Slices 2 and 1 shipped 2026-09-02. Slice 1 fixed HOLD (a held troop
drifted 1793 px before it, 8 px after) and restored the guard margin slice 2 narrowed
(+3 -> +8), but its acceptance criterion 1 is NOT met: holdLine unresolved raids rose
18 -> 25. Traced, the cause is not the break doctrine the plan predicted but a pre-existing
enemy-convergence defect that slice 1 exposes — the last survivor has line of sight and
full speed and still never arrives at a line that does not move. Three fixes were measured;
two failed and one (slideAlongArenaEdge) moved a single raid and shipped on its own
evidence. Full record in critiques/orders-comparison.md. Slices 3 and 4 remain.

Slice 2 shipped 2026-09-02 (`WOLF_STALK_R` 250 -> 180). Its
before/after is in `critiques/orders-comparison.md`, including one thing this plan
asserted that did not reproduce: the first wolf death under HOLD lands at 11.4 s at BOTH
radii, so the stall-clock test the slice asked for would have been vacuous and a
structural contract between `WOLF_STALK_R` and the archer's range is asserted instead.
Also recorded there: the `@sweep` guard's margin narrowed from +7 to +3, because since
Plan 033 "pressing nothing" IS a held line, so improving HOLD improves idle first.
Slices 1, 3 and 4 remain.

Written 2026-09-02 as a handoff plan from the gameplay audit in
`critiques/gameplay-audit-2026-09-02.md` (battle findings 9, 15, 8, 11 — listed
here in the order they should be executed, not the order the audit ranked
them). Every code reference was re-verified against the tree at `9375040`
(after Plan 038 merged); line numbers are from that commit and will drift.

Numbered 040 because 039 is already spoken for: the shipped Plan 038 names its
own follow-ups (the wipe death spiral, re-basing the saturated `@sweep`
fixture, the raid cadence that never lands) as "Plan 039" in three places.
This plan is independent of those; it touches the battle scene only.

## The complaint this resolves

The battle audit's summary: "player agency is capped by the input surface, and
two of the three orders do not do what their names say." Four defects, two of
them one-constant fixes, two of them real slices:

1. **HOLD does not hold in a Break-the-position fight.** In `updateTroopPhase`
   (`src/battle/ai-phases.js:401-495`) the stance chain sets `goal = hold
   anchor` for a holding troop with nothing in reach (`:430`), but the
   Break-the-position block that follows (`:438-459`, condition at `:442`, "the
   guards must be attackable by everyone")
   runs for every stance, takes the nearest standing guard as `engage`, and the
   `d > wantR` branch at `:461-495` then replaces the hold goal with a formation
   goal on the guard. A braced spear line in a camp raid walks across the field.
   This is consistent with `holdLine` costing 62-63 s and 30 of 120 raids
   unresolved in `critiques/progression-comparison.md`.
2. **A stalking wolf pack sits just outside the bow line's reach.**
   `WOLF_STALK_R = 250` (`src/battle/constants.js:229`); a holding wolf backs
   off under `0.9 R = 225` and stands its ground out to `1.25 R = 312.5`
   (`ai-phases.js:733-738`). Archer range is 230 (`src/data.js:94`). Nothing the
   player owns except the knight (175) and the hero (315) can catch a wolf at
   158, so a HOLD line against a pack does nothing until the 14 s no-death stall
   clock (`STALL_NO_DEATH`) forces `bloodlust`. Fourteen seconds of nothing,
   then a scripted "THEY CLOSE IN!".
3. **Arrows do not lead, and connect only within 16 px of a pre-fixed point.**
   `fireArrow` (`src/battle/combat.js`) stores `tx, ty` at loose time plus one
   `simRng` spread draw; `updateProjectilePhase` (`src/battle.js:722-746`)
   resolves a friendly arrow with `nearestEnemy(hx, hy, 16)`, a centre-distance
   query that ignores body radius, and an enemy arrow with the same 16 against
   the hero and troops. Flight time at range 230 with `projSpeed 340` is 0.68 s.
   A bandit closing at 92 moves 62 px in that window; a brute at 55 moves 37.
   Both exceed 16, so the bow line reliably hits only bodies that have already
   braked to wind up. The archer's whole promise is legible output and its
   arrows look random.
4. **There is no way to send a squad somewhere.** The player's vocabulary is
   `SQUAD_CYCLE` and three stance keys (`battle.js:768-773`). `issueCommand('hold')`
   anchors each troop where it stands (`:486-491`), so repositioning a line is
   FOLLOW, ride there, HOLD, and it lands wherever the hero's formation put it.
   The deployment phase (`updateDeployPhase`, `:585-620`) is the only place a
   body is placed directly, and only before the horn. Bad North's core verb is
   absent, and the measured 11-point idle-to-chargeAll margin is the ceiling of
   this input surface, not a tuning failure.

## Design decisions

- **Four slices, one PR each, in the order below: 2, 1, 3, 4.** The two
  one-constant fixes first because they are independent and cheap, and because
  each changes the number the later slices are measured against. Every slice
  runs `npm run test:balance` before and after and records the two numbers.
- **The sweep guard is the one assertion that must not move.** `deliberate
  orders beat giving no order at all` (`tests/e2e/stance-balance.spec.js`,
  `@sweep`) is a hard guard since Plan 033. A slice that flips it STOPs and is
  recorded, not tuned around.
- **Both sides read the same rule** (Plan 027's symmetry, AGENTS.md "Enemy
  command"). Arrow leading and the radius-aware landing apply to raiders as
  well as archers. The move order is player-only because the enemy commander
  already places its muster through `placeEnemyDeployment`.
- **Simulation must not read presentation.** The move order takes a WORLD point
  from `Camera.toWorld(mouse)` exactly as the deployment drag does. It is the
  first order that depends on the cursor, so it is never issued in any `@sweep`
  measurement and the `battle outcomes are independent of canvas size and
  cursor position` test keeps driving keys only.
- **No save-schema change.** Squad anchors, stances and selection are battle
  state; a battle is not resumable (AGENTS.md "Battle orders are per-squad").
- **RNG draw order is preserved.** `fireArrow` consumes exactly one `simRng`
  draw today and will consume exactly one after leading. The move order adds
  no draws. The nine battle visual baselines settle at 1.5 s; anything that
  changes a body's position before then is a baseline change and is recorded
  as such.

## The instrument: what "before and after" means after Plan 038

Plan 038 priced encounters off campaign stage, and `critiques/campaign-arc-comparison.md`
records the side effect on the shipped `@sweep` fixture: it installs a near-capped
roster into a stage-0 campaign, so `encounterBase()` returns 6.85 against a
`myStrength()` of 12.6 and the garrison target is nearly halved. Measured after
that slice: idle **94%**, chargeAll **100%**, split 92%. The guard's inequality
still holds, but a fixture at 100% cannot show a regression or an improvement.
Re-basing it is a Plan 039 item. Until that lands, every slice here measures
with two instruments, and records both:

- **The four direct `startBattle` fixtures** in `stance-balance.spec.js`
  (`mixed`, `wolves`, `brute`, `raiders`; `runStance`, `:62-107`). They install
  the enemy list directly with `deploy: 0`, so no generator and no stage curve
  is involved; they are unaffected by Plan 038 and are the sensitive
  instrument for slices 2 and 3.
- **A stage-matched `raidSweep`.** Add an optional `stage` argument to
  `raidSweep` (`:125-198`) that, after `scenario('world', {seed})`, marks all
  four settlements player-owned and the two camps NOT under assault razed, so
  `strongholdPoints` is 6 and `encounterBase()` sits near the fixture roster's
  `myStrength()`. Assert inside the harness that the two are within 10% of
  each other before the raid, so the fixture cannot drift silently into a
  walkover again. Run the existing stage-0 sweep too, because the guard is the
  guard; report the stage-6 columns as the before/after in
  `critiques/orders-comparison.md`. If Plan 039 has already re-based the
  fixture when this plan starts, use its fixture and drop this helper.

## Slice 1 — HOLD holds in a Break-the-position fight (finding 9)

- In the Break-the-position block (`ai-phases.js:442`), a troop on `hold` may
  take a guard as `engage` only inside the same reach its stance already uses
  for hostiles: `maxR` (140 melee, `t.d.range` ranged, `:427-428`). Outside
  that, `goal` stays the hold anchor. `follow` and `charge` are unchanged:
  they still go to work on the nearest guard.
- Rationale in the comment: the guards stay "attackable by everyone" — a
  charging or following squad still breaks them, and a held line breaks the
  one it was placed next to. Elimination remains a parallel win
  (`resolveBattleResult`, AGENTS.md "Battle simulation"), so a held line that
  never touches a guard still wins when the garrison dies; verify that the
  Entrenched reserve wave does not leave an unreachable guard count by
  checking `tests/e2e/battle-objectives.spec.js:414` still passes unchanged.
- Test: a new case in `battle-objectives.spec.js` on the `battle_break`
  scenario (or a fixture with `objectiveTargets` placed 400+ px from the
  line): confirm deploy, issue `hold` to every squad, tick 10 s, assert every
  troop within 60 px of its `holdX/holdY` and every guard undamaged; then
  issue `charge` and assert a guard takes damage within 10 s.
- Measure: `raidSweep` `holdLine` column before and after — unresolved raids
  (30/120 in `critiques/progression-comparison.md`) and mean duration. Expect
  unresolved to FALL (a held line no longer strings itself across the field
  into a stall); if it rises, the enemy commander's `break` doctrine is not
  reaching the line and the slice STOPs for a look at `enemy-command.js`
  rather than at this gate.

## Slice 2 — the bow line answers a pack (finding 15)

- `WOLF_STALK_R` 250 → **180**. Derivation: the stand band is `0.9 R` to
  `1.25 R` (`ai-phases.js:733-738`); for the whole band to sit inside archer
  range 230, `R ≤ 184`. At 180 a stalking wolf backs off under 162 and stands
  between 162 and 225 — outside a holding spearman's 140 reach, inside the
  bow's 230. That is the trade the audit asked for: a pack is still not a
  melee problem, and HOLD (steady aim) becomes its answer. Rewrite the
  constant's comment (`constants.js:226-228`) with this arithmetic; the
  current text about "nothing the player owns can catch a wolf" stays true
  and is the reason the bow must be able to.
- `WOLF_COMMIT_HP`, `WOLF_RECOIL_T`, `WOLF_ISOLATION_*` unchanged.
- Tests: `stance-balance.spec.js:405-416` already guards `HOLD must not lose
  more men than CHARGE to a wolf pack`; add to the `wolves` fixture a
  measurement that the first wolf death under HOLD lands before
  `STALL_NO_DEATH` (14 s) — the property that was false at 250. Record HOLD's
  `seconds` and `lost` on the fixture before and after.
- Measure: `raidSweep` idle/chargeAll/split before and after. The
  `mixed`/`brute` fixtures carry two wolves each, so the sweep moves; the guard
  must hold.

## Slice 3 — arrows lead and land on bodies (finding 8)

### Leading

- `fireArrow(battle, sx, sy, tx, ty, ...)` gains the target's velocity
  (`tvx, tvy`, default 0). Both loose sites pass it: the archer at
  `ai-phases.js:541` (`engage.vx, engage.vy`; a guard's stand-in has fixed
  zero velocity by construction, `:450-457`) and the raider at `:657`
  (`to.vx, to.vy`). One-step lead: `T0 = d / speed; tx += tvx * T0; ty += tvy
  * T0`, then recompute `d` and `T` from the led point. Apply the spread draw
  AFTER leading so the single `simRng` call stays in the same place in the
  stream. A second refinement iteration is not worth a measurement; state
  that in the comment.
- Lead the raw velocity, not a smoothed one. A brute in windup decays its
  velocity by 0.8 per tick (`:641-643`), so the lead naturally shrinks to zero
  on a body that has stopped to strike — which is the case the current code
  already hits.

### Landing

- Replace the three 16 px centre checks in `updateProjectilePhase`
  (`battle.js:732, 736, 739`) with `ARROW_HIT_PAD + body.radius`, one new
  constant in `constants.js`, starting value **8**. A brute (radius 18) is
  hit within 26 px of the landing point, a wolf (radius 8) within 16 — the
  current number becomes the smallest body's, not every body's.
  `nearestEnemy(hx, hy, R)` is a centre-distance query: query with
  `ARROW_HIT_PAD + 18` (the largest enemy radius, read from `ENEMY_TYPES`,
  not typed) and then test the found body against its own radius. Same on the
  friendly side for troops and the hero (`HERO.radius` 14).
- `arrowDamageAgainst` (`combat.js`) is unchanged: the counter still resolves
  against the body found, and AGENTS.md's facing exclusion for arrows still
  stands (an arrow has no honest incoming direction).

### The re-fit this forces

Both changes raise the archer's and the raider's realised output.
`POWER_EFFICIENCY` (`src/data.js:275-321`) is fitted, not reasoned, and
AGENTS.md "Fighting weight" is explicit: retuning what a body does invalidates
the multipliers, not the formula. So:

1. Before touching anything, run the four `stance-balance` fixtures and
   `raidSweep` and record them.
2. Land the two changes with `ARROW_HIT_PAD = 8`.
3. Re-run the fit exactly as Plan 029 did: `scripts/zz-power-probe2.mjs` on
   both grids (`zz-power-prog-grid.json`, `zz-power-prog-rolled.json`
   shapes), then `scripts/zz-power-fit3.mjs`, maximum likelihood, logistic
   intercept pinned at zero, rolled rows up-weighted 8x. Replace the archer
   and raider (and any other multiplier that moved by more than 0.03), and
   append the fit to `critiques/progression-comparison.md`'s table as a new
   dated row. Do not hand-adjust one entry.
4. With the new multipliers `myStrength()` and `enemyStrength()` change, so
   the correction term in `encounterBase()` (Plan 038, `src/world.js:587-589`)
   and every realised ratio change. Re-run `raidSweep` and
   `scripts/zz-tier035-probe.mjs` at ratios 1.0/1.175/1.3 with `chargeAll`.
   Plan 035's 50% crossing was 1.18 on the roaming path. If it moves by more
   than 0.10, STOP: the bands were calibrated for the old archer and the
   decision to move them is Plan 035's author's, recorded in the comparison
   file with both numbers, not made here.
5. Only then decide `ARROW_HIT_PAD`. The audit's suspicion is that 8 is
   right and 16 was compensating for no lead; if raiders now shred the hero
   (the audit's finding 6 already calls him unpriced), the pad is the knob,
   not `ENEMY_TYPES.raider.dmg`.

### Visual baselines

Arrows in flight are drawn. `battle-*.png` baselines that contain a
projectile at 1.5 s will diff because the landing point moved. Re-record only
those, list each in the plan's shipped section with the reason "arrow
trajectory", and confirm with `npm run test:visual:linux` that no other pixel
moved. This is a legitimate simulation change, not a green-CI update; the
rule in CLAUDE.md is about the latter.

### Tests

- New unit-level case in `stance-balance.spec.js` (not `@sweep`): a lone
  holding archer at 200 px against one bandit walking a straight line across
  its front; assert hit rate over 10 arrows ≥ 70% (was ~0 by the arithmetic
  above; measure the real number first and assert below it).
- `facing-flank.spec.js` is untouched (arrows are excluded from facing).
- `world-battle-seams.spec.js` asserts the projectile phase runs before the
  result phase; unchanged.

## Slice 4 — a squad you can send (finding 11)

### The order

- `Battle.issueMove(squadType, wx, wy)`: sets the squad's stance to `hold`,
  its banner anchor to `(wx, wy)`, and each troop's `holdX/holdY` to `(wx,
  wy)` plus that troop's offset from the squad's current centroid, so the
  line arrives in the shape it left in. Offsets are clamped to a 90 px
  radius so a scattered squad regroups rather than reproducing its scatter.
  Melee hold steering already walks a troop to its anchor and engages only
  hostiles within 140 (`ai-phases.js:409-412`), and Phase 4b resolves the
  river-crossing waypoint before steering (`:560+`), so a point across a
  river is reached by the ford. Nothing in the movement tail changes.
- `squadType === null` (whole warband selected) moves every manned squad,
  each to the same point with its own offsets, exactly as `issueCommand`
  fans out through `mannedSquads()`.
- The anchor is refused, with the existing red-ring particle and no horn, if
  it is outside `[40, W-40] x [40, H-40]` or inside an obstacle. Extract the
  obstacle test from `updateDeployPhase` (`battle.js:611-614`) into
  `isPlacementBlocked(x, y, r)` and call it from both places; one rule for
  "can a body stand here".
- `this.command = this.aggregateStance()` afterwards, so the legacy `command`
  mirror stays truthful (`'hold'` if every squad now holds, `'mixed'`
  otherwise). Horn 220 and `commandFlash = { text: 'FORWARD!', t: 0.9 }` —
  a different word from HOLD! because the player did a different thing.
- Deploy state: refused. Dragging is the placement verb before the horn, and
  a second way to move bodies there would let `_deployOrdered` and the
  promotion rule disagree. Fight state only.

### Input

- Mouse: `Input` gains `mouse.rightClicked` (edge, cleared in `endFrame`)
  from `mousedown` with `e.button === 2` — the canvas already suppresses
  `contextmenu` (`engine.js:90`). `updateCommandPhase` in fight state: on
  `rightClicked`, `issueMove(selectedSquad, ...camera.toWorld(mouse))`.
- Keyboard: `ACTIONS.COMMAND_MOVE` bound to `KeyF`, meaning "send the selected
  squad to where I stand" — `issueMove(selectedSquad, hero.x, hero.y)`. This
  is the keyboard-only path a later controller plan will re-bind, and it is
  what the tests drive. Add it to `DEFAULT_BINDINGS`, to the SETTINGS controls
  string in `src/main.js:729`, and to the HUD hint at `hud.js:331`
  (`'TAB pick squad · 1 follow 2 charge 3 hold · F / RMB send'`).
- Check `tests/tooling/config-contract.test.js` and
  `input-actions.spec.js:25` for the action-table contract and extend both.

### Presentation

- The per-squad hold banner (`battle/render-scene.js:196-208`) already draws
  at `squad.holdX/holdY`; a sent squad therefore gets its marker at the
  destination for free. Add, while the squad centroid is more than 40 px from
  its anchor, a dashed ink line from centroid to banner. Presentation reads
  simulation, never the reverse.
- One `particles.ring` at the destination on the order, in `P.friend`.

### Tests

- `qa_suite.js:406-470` keep passing unchanged: `Digit3` still anchors in
  place, `command` still mirrors, selection still narrows.
- New Playwright case (`stance-balance.spec.js`, not `@sweep`): `battle_big`,
  past intro, Tab to spear, place the hero 300 px from the spear centroid,
  press `KeyF`; assert `squads.spear.stance === 'hold'`, `squads.spear.holdX/Y`
  within 2 px of the hero, archers and knights untouched, `command ===
  'mixed'`, and after 8 s the spear centroid within 40 px of the anchor.
  Second case: a right-click via `injectMouse` with a `button` argument (extend
  the test seam) onto a blocked point is refused: stance unchanged, no anchor
  write. Third: `KeyF` during `deploy` is a no-op.
- `battle outcomes are independent of canvas size and cursor position`
  (`stance-balance.spec.js:358`) is unchanged and must stay green; it never
  issues a move.
- `performance.spec.js` budgets the battle draw path; the dashed line is one
  stroke per moving squad — confirm the structural Canvas count with
  `npm run test:perf`.

### Not measured, and said so

The sweep cannot judge WHERE to send a squad, so this slice ships without a
win-rate claim, the way Plan 019 shipped its plumbing. The audit's argument is
that the 11-point margin is an input-surface ceiling; the honest follow-up is
a scripted `moveLine` policy in a later sweep (send spears to the ford, bows
behind them) once Plan 037's harness exists. Record that as the open question
in the shipped section.

## Files to modify

| File | Slice |
| --- | --- |
| `src/battle/ai-phases.js` (Break block gate; arrow loose sites) | 1, 3 |
| `src/battle/constants.js` (`WOLF_STALK_R`, `ARROW_HIT_PAD`) | 2, 3 |
| `src/battle/combat.js` (`fireArrow` lead) | 3 |
| `src/battle.js` (`updateProjectilePhase`, `issueMove`, `isPlacementBlocked`, `updateCommandPhase`) | 3, 4 |
| `src/data.js` (`POWER_EFFICIENCY` re-fit rows and comment) | 3 |
| `src/engine.js` (`mouse.rightClicked`, `injectMouse` button) | 4 |
| `src/input-actions.js` (`COMMAND_MOVE`) | 4 |
| `src/battle/render-scene.js`, `src/battle/hud.js`, `src/main.js:729` | 4 |
| `tests/e2e/battle-objectives.spec.js`, `tests/e2e/stance-balance.spec.js`, `tests/e2e/input-actions.spec.js`, `tests/tooling/config-contract.test.js` | 1-4 |
| `tests/e2e/__screenshots__/**/battle-*.png` (arrow trajectory only) | 3 |
| `critiques/progression-comparison.md` (fit row), a new `critiques/orders-comparison.md` (per-slice sweep before/after) | all |
| `AGENTS.md` "Battle simulation" (move order, arrow landing rule), `SCOPE.md`, `plans/README.md`, `progress.md` | all |

## Acceptance criteria

1. Slice 1: the new hold-vs-guard test passes; `holdLine` unresolved raids
   in `raidSweep` do not rise; the sweep guard holds.
2. Slice 2: first wolf death under HOLD on the `wolves` fixture lands before
   14 s; `HOLD must not lose more men than CHARGE to a wolf pack` still
   holds; the sweep guard holds.
3. Slice 3: the lone-archer hit-rate test passes at the measured floor;
   `POWER_EFFICIENCY` carries a dated re-fit with pooled accuracy at or above
   the Plan 029 figure (89.7%); the Plan 035 50% crossing moved by ≤ 0.10 or
   the slice is STOPPED with both numbers recorded; the sweep guard holds.
4. Slice 4: the three move-order tests pass; every existing `qa_suite`
   command record passes unchanged; the cursor-independence test is
   untouched and green; `npm run test:perf` within budget.
5. Every slice: `npm test`, `npm run test:balance`, `npm run release:cache`
   then `npm run test:release`.

## STOP conditions

- The `@sweep` guard flips in any slice. Record the before/after row, revert
  the slice's constant or rule, and stop; do not move `FLANK_BONUS`,
  `BRACE_*`, `CHARGE_EXPOSURE` or any band to recover it.
- Slice 3's re-fit moves the Plan 035 crossing by more than 0.10 (above).
- Slice 3's re-fit drops pooled accuracy below 85%, which means the square
  law is no longer describing the archer and the plan needs a design review,
  not a multiplier.
- Slice 4 needs a save field or a cross-phase context object. Neither is
  anticipated; either is a re-plan.

## What NOT to do

- Do not touch `HERO_POWER`, `BALANCE.partyTiers`, `beatablePartyRatio`,
  `WORLD.camps[].tier`, or unit `dmg`/`hp`/`range`. This plan changes what
  the units DO, and prices it by re-fitting; it does not retune them.
- Do not extend arrow damage to facing or the brace. AGENTS.md records why an
  arrow has no honest incoming direction.
- Do not let the move order set `charge`. A sent squad HOLDS where it
  arrives; charging is still the key for charging.
- Do not add the move order to any `@sweep` policy in this plan.
- Do not `skip` or `fixme`. An expected failure carries `test.fail` and a
  reference to this plan.

## Out of scope, recorded for the next plans

- The knight wins every duel and the spear is 2x the gold value of either
  alternative (audit finding 10); a roster with counters is its own plan.
- Terrain as a position (finding 14): hills as a defender bonus.
- The hero is unpriced and uncatchable (finding 12).
- Break guards are not colliders (finding 12 in the audit's battle section).
- The 3.28x stacked damage model has no on-screen tell (finding 16).

## Effort

1: S. 2: S. 3: M (the code is small; the re-fit and the sweeps are the
cost). 4: M. Sequential, one PR per slice, each with its row in
`critiques/orders-comparison.md`.
