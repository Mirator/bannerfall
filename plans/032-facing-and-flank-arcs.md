# Plan 032: Make where a man is standing worth something

**Status:** DONE as a mechanic, NOT as the fix. Facing is now read by the damage arithmetic on
both sides: a melee blow from outside a body's front arc pays `FLANK_BONUS`, and a set line
cannot brace against what reaches it from behind. Measured over the same 120 organic camp
raids the previous four plans used, the best deliberate order policy went from one point
behind pressing nothing to LEVEL with it (68 against 68), and the idle win rate fell rather
than rose — the AFK-farm direction this slice was watching for. A tie is not a strict
inequality, so the `@sweep` `test.fail` annotation STAYS. One tuning value was probed and
rejected; see finding 3.
**Priority:** P0 (gameplay audit, phase 4 — "the game plays itself")
**Effort:** M
**Risk:** Medium (touches the damage path on both sides, which every balance number in the
repository is downstream of; no schema, no RNG, no new state)
**Baseline recorded at:** the `@sweep` fixture itself (`tests/e2e/stance-balance.spec.js`),
measured on `69e75d1` before any `src/` edit: idle 69 / chargeAll 68 / split 45.
**Depends on:** Plan 019 (stances), Plan 027 (the enemy commander and its symmetry rule),
Plan 029 (the rush latch this plan gates)

## Objective

Give position a price.

The audit finding four plans have now attacked from four sides is that pressing nothing wins.
Plan 027 established that no enemy BEHAVIOUR change fixes it; Plan 028 that no encounter-SIZE
change does; Plan 029 that unit identity gets within a point and no further. This plan names
what all three were working around:

**Nothing in the damage arithmetic read `facing`.** Every body has carried one since the first
battle build, and it fed rendering and knockback direction and nothing else. A blow landed for
the same number from in front, from the side, and from directly behind. So Plan 027's flanking
muster changed only where the enemy walked to, never what the walk was worth; and an idle blob
and a deliberately arranged line took precisely the same hits. There was no positional
mechanic to command *for*.

## Design decisions

Settled; changing one needs a new review.

1. **One cone, two rules.** `FRONT_ARC` (±110°) is the half-angle of the cone a body is
   actually facing. A melee blow landing outside it is a flank and is multiplied by
   `FLANK_BONUS`. A rush arriving outside it cannot be braced against. Both are the same claim
   about where a man is looking when the blow arrives, so they read one predicate
   (`inFrontArc`) and one constant.
2. **±110°, and the width is the whole design.** A unit turns onto its target at
   `1 - exp(-8 dt)` (troops) or `1 - exp(-6 dt)` (enemies) — it is square to whatever it CHOSE
   to fight within about a fifth of a second. So the arc does not price "which way is he
   pointing", it prices **"he is already committed to somebody else"**: the second man onto a
   body, and the man who arrives while it is winding up on someone behind him. A narrow cone
   would fire on nearly every contact in a scrum and mean nothing; a very wide one would fire
   only on a literal back-stab and never fire at all.
3. **`FLANK_BONUS` is 1.35, the same number as `CHARGE_EXPOSURE`.** Both are "your formation
   is open and it costs you". They are the two positional prices in the game and pricing them
   differently would be a claim no measurement supports. It is a shipped constant, not a
   `battle.*` field: no perk moves it, deliberately — the flank is geometry, and a perk making
   the player's own back safer would be the flat aura Plan 029's perk rule forbids. Both sides
   therefore read the same number, which is Plan 027's symmetry requirement satisfied by
   construction rather than by convention.
4. **Melee only.** An **arrow** resolves against whoever is nearest WHERE IT FALLS, hundreds of
   milliseconds after it was loosed and after the target has turned; "from where did this land"
   has no honest answer at that instant, and `arrowDamageAgainst` already resolves the shooter's
   declared counter against a body the arrow was not necessarily aimed at. The bow line also
   already buys its identity on a different axis (steady aim plus `bonusVs`), and stacking a
   third multiplier there is how the Plan 029 finding-3 regression happened. A **brute's slam**
   is an AoE ring centred on the brute, so the bodies inside it have no incoming direction
   either; the code already excludes the slam from `BRACE_BONUS` for exactly this reason, and a
   1.35x slam is a lethality change, which is what the phase-4 audit measured and rejected.
5. **The HERO is outside the rule in both directions**, which is what keeps it symmetric rather
   than merely applied to both teams. His facing comes from the cursor through
   `Camera.toWorld`, so making his back a damage multiplier would put fight outcomes back under
   the mouse — the exact defect `battle outcomes are independent of canvas size and cursor
   position` exists to catch, and the reason `slotPos()` reads `travelFacing`. He also has no
   stance, which is why `damageFriendly` already exempts him from charge exposure. Exempting
   him as an attacker too (rather than only as a defender) keeps it one sentence instead of a
   rule that applies in one direction and not the other.
6. **No new state, no new RNG, no schema change.** The mechanic reads `facing`, which every
   body already carries, at the moment a blow lands. It consumes no random draws, so every
   seeded record and every determinism guard is unperturbed by its existence.

## In scope

- `src/battle/constants.js`: `FRONT_ARC`, `FLANK_BONUS`, and the measured rationale.
- `src/battle/ai-phases.js`: `inFrontArc`/`flankMul`, the front-arc gate inside `braceMul`, and
  the two melee damage call sites (troop → enemy, enemy → troop).
- `tests/e2e/facing-flank.spec.js`: new. Four deterministic two-body fixtures.
- `tests/e2e/stance-balance.spec.js`: the `test.fail` comment block extended with this plan's
  numbers. The annotation itself is untouched.
- `AGENTS.md`, `tests/README.md`, `progress.md`, `plans/README.md`.

## Out of scope

- Any HUD or render affordance for a flank. The multiplier is legible through the hit numbers
  and the fight; a floating "FLANKED!" would be a tenth visual baseline for a slice that has
  not yet earned one.
- A facing mechanic for the hero, in either direction. See decision 5.
- Any change to `UNIT_TYPES`, `ENEMY_TYPES`, `HERO`, spawn counts or the encounter generator.
  Plan 028's fit is priced on those tables and this slice deliberately leaves them alone, so
  the fitted power metric stays valid.
- A per-unit "attack the flank" AI. Plan 027 finding 2 measured a per-unit swerve as
  non-convergent (a lone raider orbited a static warband for a full 90s budget) and it is not
  re-attempted here. What this plan adds is the PRICE of a flank; who chooses to take one is
  the existing surround behaviour on both sides.

## STOP conditions

- **If the idle win rate RISES, stop and reconsider the gating.** Both sides encircle (the
  `jit` offsets), so a flank multiplier could be a gift to a player whose warband
  auto-surrounds — which is precisely the AFK-farm regression Plan 029's finding 3 had to
  close. **Did not fire:** idle fell 69 → 68.
- **If deliberate orders still do not beat idle over the sweep, the annotation stays.**
  **Fired, and the annotation stays.** 68 against 68 is a tie; `toBeGreaterThan` is a strict
  inequality, and Plan 027 already declined to flip on a 0.0-point margin.
- **If a tuning value has to be chosen to make the assertion pass, do not choose it.**
  **Fired.** See finding 3.
- If a performance budget moves, stop rather than raising it. **Did not fire.**
- If a visual baseline changes, stop and explain: the battle baselines settle at 1.5s and the
  two forces are 820 (or 1180) units apart, so no melee blow can have landed inside a captured
  frame. **Did not fire** — all twenty baselines pass unmodified.

## Verification

```powershell
npm run release:cache
npm run test:release
npm run test:tooling
npm test
npm run test:balance
```

## Outcome

Camp-raid policy sweep, 120 raids per policy, seeds 1..40 x camps c1/c2/c3, hero idle
(`tests/e2e/stance-balance.spec.js`, the `@sweep` fixture):

| policy | before | after | avg lost before → after | avg hero hp before → after |
|---|---|---|---|---|
| idle | 69% | **68%** | 4.2 → 4.2 | 94 → 91 |
| chargeAll | 68% | **68%** | 5.2 → 5.1 | 88 → 86 |
| split | 45% | **48%** | 6.8 → 6.7 | 55 → 57 |
| best deliberate minus idle | **-1** | **0** | | |

Both the before and the after figures replayed digit for digit across two consecutive runs, so
the one- and three-point movements are the fixture's answer and not its drift.

The progression of this finding across the five plans that have attacked it:

| plan | best deliberate minus idle |
|---|---|
| 019 (as retracted) | -10.0 |
| 027 (enemy command) | 0.0 |
| 028 (power rebase, 360 raids) | -5.3 ± 2.8 |
| 029 (unit identity) | -0.9 |
| **032 (facing and flanks)** | **0.0** |

## Implementation findings

1. **The flank is a net loss for the player, and that is the point.** Both sides surround, so
   the naive expectation is that it cancels. It does not: a camp garrison outnumbers the
   warband, so more enemies get a second man onto a defender than the other way round, and the
   idle win rate fell a point while the hero finished three points of health lower on average.
   No gating was needed — the version that had to be considered (flank only under an order, or
   only against a defender engaged elsewhere) was never built, because the ungated rule already
   moved in the intended direction. The second of those gates is also close to a no-op by
   construction: a defender faces whoever it chose to fight, so "outside the front arc" already
   means "busy with someone else" nine times in ten.
2. **The brace's front-arc gate is narrower in effect than it reads.** A troop turns onto its
   engaged target within about a fifth of a second, so a holding spearman is square to almost
   everything he swings at. What the gate actually removes is the FIRST blow against a rusher
   that closed from behind while the man was still turned on somebody else — the case where a
   set line manifestly has not set itself. That is the right amount of mechanic for the claim
   "a line cannot brace against what hits it from behind", and it needed a hand-built fixture
   to demonstrate at all, which is why `facing-flank.spec.js` pins the latch directly rather
   than trying to earn it in an organic fight.
3. **`FLANK_BONUS = 1.60` makes the `@sweep` assertion pass, and was rejected for it.**
   Probed on the same fixture: 67 / 68 / 43. `chargeAll` clears `idle` by one point, the strict
   inequality is satisfied, and `test.fail()` reports "Expected to fail, but passed". It is not
   a win. Commanding did not improve — chargeAll is 68 at 1.35 and 68 at 1.60 — and split is
   five points worse. The entire crossing is one point of erosion on the idle number, one point
   out of 120 raids, well inside the sampling noise of a binomial at that size. Choosing the
   constant that produces that crossing is choosing a value to satisfy an assertion, which is
   the mistake Plan 019 had to retract and Plans 027, 028 and 029 each declined to repeat.
   1.35 ships, and it ships for a reason that is not the assertion: it is `CHARGE_EXPOSURE`,
   the game's existing price for an open formation.
4. **Arrows were left out on a mechanical argument, not a balance one.** The interesting part
   is that the balance argument points the same way: the archer already carries two
   order-gated multipliers (`BOW_SPREAD_BRACED` and `bonusVs`), and Plan 029's finding 3 is the
   record of what a third, ungated one did to the idle win rate. Had the mechanics been
   ambiguous, that measurement would have decided it.
5. **The measurement environment had to be isolated before any number could be trusted.** The
   first pass of this slice measured a full gate at 10 failures and an after-sweep at 0% wins
   across all three policies. Neither was real: `playwright.config.js` uses
   `reuseExistingServer` on a fixed port 8474, and a `python scripts/serve.py` from a different
   checkout already held it, so every spec was running against another tree's files while
   reading this one's assertions. Re-measured against a server pinned to this worktree, the
   pre-change gate is 181/181 green. Anything measured on a shared 8474 is worth nothing; check
   what the port is actually serving before believing a number from it.

## Deliberately not done

- **The annotation was not flipped.** See finding 3 and the STOP conditions. It is now a tie
  for the second time in the finding's history, and Plan 027's reasoning for not flipping on a
  tie applies unchanged.
- **No wide (360-raid) paired re-measurement.** `scripts/zz-orders-wide.mjs`, which Plan 028
  used for exactly that, no longer reaches a battle: it drives `KeyE` and then expects a
  `brief`, and Plan 030 put the site menu in between, so every raid hits its
  `if (game.sceneName !== 'battle') continue`. Fixing it is worth doing before the next attempt
  on this finding — a one-point margin cannot be resolved at 120 raids and a paired
  seed-by-seed comparison is what would settle it — but it is a separate change to a scratch
  harness rather than something to fold into a gameplay slice.
- **No flank affordance in the HUD or the renderer.** See Out of scope.

## Post-merge (Plan 033 underneath, review pass applied)

Plan 033's deployment phase merged under this slice and resolved the
orders-vs-idle finding on its own (idle 49 / chargeAll 60 without the arcs), so
the sweep assertion this plan measured against is a hard guard now, not an
expected failure. With the arcs live on top of the deployment phase the guard
holds: 51 / 59 / 38 (idle / chargeAll / split), measured twice digit for digit,
both before and after the review fixes — expected, because the camp-raid sweep
drives E-approach fights only and the review's facing fixes are identity
operations on 'E'. Split rose from 34 to 38 with the arcs live: the mixed-order
policy is where the flank pays most.

A ten-finding review pass (eight angles, per-candidate verification) landed on
the merged branch: troop and ambush-enemy facing were still hardcoded east/west
(a deterministic 1.35x opening tax on three of four approaches, and a backwards
deployment tableau); the hero exemption moved inside flankMul and gained the
fixture that guards it; the enemy brace routes through the one braceMul; the
FRONT_ARC width gained a 90-vs-130-degree bracket fixture; the spear role and
Set Spears strings now name the front-arc condition; and every stale
"annotation stays" sentence was reworded to the merged reality. One finding was
accepted rather than changed: the brace's arc gate is nearly unreachable in
live play (a striker lerps onto its target before its cooldown lands the blow)
and its comment now says so.
