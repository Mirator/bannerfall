# Plan 029: Unit identity, and something to build between fights

**Status:** DONE. Both halves shipped and measured. Unit identity is real (the brace fires
on 24-35% of wolf contacts against 2.5-6% before, and spear/archer no longer share a damage
number); progression is persistent (save v5) and priced by the encounter generator. The
`@sweep` `test.fail` annotation STAYS, but at the narrowest margin any plan has produced:
the best deliberate order policy is 0.9 points behind pressing nothing, against Plan 028's
-5.3. One regression was introduced, measured, and closed inside the slice — see
Implementation finding 3.
**Priority:** P0 (gameplay audit, phase 4 — findings 2 and 3: "army composition is solved:
knights only" and "gold stops being a resource after about four fights")
**Effort:** XL
**Risk:** High (retunes `UNIT_TYPES`, which Plan 028 documents as invalidating the fitted
power metric; bumps the save schema; adds the first persistent progression in the game)
**Audit finding:** `critiques/phase4/gameplay-audit.md` findings 2 and 3, recommendation 3
**Baseline recorded at:** `critiques/progression-baseline.md` (measured on `7de3bb5`, the
Plan 028 power-rebase slice, before any `src/` edit)
**Depends on:** Plan 019 (stances and the brace mechanic this fixes), Plan 021 (the modal
machinery the perk screen reuses), Plan 027 (the enemy commander whose ordered timing this
plan's brace rule reads), Plan 028 (the power metric this plan is obliged to re-fit)

## Objective

Give the three unit types a fight each of them uniquely wins, and give the player something
that survives the end of a battle other than a gold counter that stopped mattering four
fights ago.

The two are one slice, in that order, because progression multiplies whatever a unit is
worth. Ranking up three interchangeable bodies is three times nothing.

## What the baseline measured

Two probes before any `src/` edit. Both are in `critiques/progression-baseline.md`; the two
findings that changed the design are here.

### 1. The brace bonus does not fire. Not rarely — essentially never.

`BRACE_SPEED` is 120 and `src/battle/constants.js` says only a wolf (158) can cross it.
Plan 019 already had to retract a "brute counter" claim over exactly this, and Plan 027 then
gave the enemy a commander that sends brutes and bandits in on its own timing, so the claim
was re-measured rather than re-reasoned.

`scripts/zz-brace-probe.mjs` samples every enemy inside a holding melee troop's strike reach
— precisely the population the `closingFast` test is applied to — over 24 fights on two
fixtures. At the moment a braced spearman can swing, the thing it is swinging at is
**stationary**:

| fixture | body | contact samples | median speed | median CLOSING speed | over 120 (speed) | over 120 (closing) |
|---|---|---|---|---|---|---|
| roaming | bandit | 19240 | 5.1 | −0.5 | 0.1% | **0%** |
| roaming | wolf | 6346 | 10.7 | −0.3 | 2.5% | 0.2% |
| roaming | raider | 1310 | 5.9 | −3.0 | 1.4% | **0%** |
| brute-heavy | bandit | 39683 | 2.8 | −0.1 | 0.1% | **0%** |
| brute-heavy | brute | 22344 | 4.9 | −1.3 | **0%** | **0%** |
| brute-heavy | wolf | 7893 | 0.2 | 0.0 | 6.1% | 1.5% |

The median closing speed is NEGATIVE for every body on both fixtures: by the time something
is in spear reach it has braked to swing and separation is pushing it back out. The mechanic
reads the wrong instant. Lowering the threshold does not fix that — it is not a threshold
problem, it is a "measure the approach, not the impact" problem.

### 2. Raw velocity cannot be the measurement either, because knockback dominates it.

The obvious repair — latch the fastest speed seen in the last second and brace against that
— was measured before it was designed in. It does not work: the latched peak clusters around
72-79 for *every* body, brutes (base speed 55) included. That is not locomotion, it is the
`+= cos * 85` knockback impulse every landed hit applies. A rule keyed anywhere in the 40-90
band would mean "I hit it, therefore it charged me".

## Design decisions

Settled; changing one needs a new review.

1. **Brace reads COMMANDED locomotion, latched, not velocity at the swing.** A unit sets a
   `rushT` memory whenever the movement branch is steering it *toward* a hostile at a speed
   that counts as a rush; the brace bonus reads that memory. Knockback never enters it,
   because knockback is not a commanded speed. The memory is `BRACE_MEMORY` seconds — long
   enough that a spearman's 1.05s cooldown still lands the receiving blow, short enough that
   a body standing in the scrum trading hits stops being "a charge" after the first exchange.
2. **"A rush" is two clauses, because bodies have different natural speeds.** A closer counts
   as rushing when its commanded speed is at or above `BRACE_SPEED` (an inherently fast body:
   wolf 158, knight 175) **or** above `BRACE_CHARGE_MUL` times its own walking speed (a body
   that was *ordered* forward: `charge` is ×1.15, bloodlust ×1.3). Terrain multipliers are
   deliberately excluded: a bandit strolling down a road (92 × 1.14 = 105) is not charging
   anybody. `BRACE_SPEED` drops 120 → 130 — it is now the "naturally fast" clause only, and
   130 sits above every walking body in the game and below the wolf and the knight.
   The rule is symmetric, exactly as Plan 027 requires: it is the same predicate on both
   sides, so it catches the player's knights (175, always) and the player's spears (only
   under a CHARGE order) for the enemy's held line, and the enemy's wolves (always) and its
   bandits, raiders and **brutes** (only once the commander orders `commit`, or the stall
   clock arms bloodlust) for the player's.
3. **Spear and archer stop sharing a damage number, and each gets one fight it wins.** The
   audit's complaint is literal: `dmg: 10` on both. Spear becomes 12 at cadence 1.05 and owns
   the brace; archer becomes 13 at cadence 2.2 — a slower, heavier shot — and carries
   `bonusVs: { brute: 2.0 }`, which is the one enemy a melee line cannot safely stand beside
   (a 100-radius slam). The archer's raw output is deliberately almost unchanged (5.91 dps
   against 5.88) so the identity comes from the shape of its damage rather than from more of
   it; the spear's rises 20% because the spear is the body the audit found worthless.
4. **`bonusVs` is a declared table on the unit type, not a special case in the phase.** A new
   unit type declares its own counter or has none; the combat path reads the table. Applied
   to the archer's arrow at the moment it is loosed (the projectile carries its damage), and
   to a melee swing at the moment it lands.
5. **A knight costs 2 army-cap slots.** `UNIT_TYPES[type].slots` (default 1) and one shared
   `armySlots(troops)` in `data.js`. The audit's finding 2 is that the knight is strictly best
   per slot and the cap is the binding constraint; charging it as two is the audit's own fix.
   Every cap read goes through `armySlots`, including the save validator.
6. **Veterancy is battles SURVIVED, on a victory only, stored as one integer.** `troop.vet`
   counts won battles this body walked out of. Rank is derived (`rankOf(vet)`), never stored,
   so there is one number to persist and no way for the two to disagree. Retreats and defeats
   do not count: awarding on a retreat would make "ride in, ride out" a training montage.
7. **Rank is a single multiplier that scales both hit points and damage,** which is the same
   shape `POWER_EFFICIENCY` uses, so a ranked body scales its own contribution to fighting
   weight linearly and the power metric needs no new concept to account for it.
8. **A perk strengthens DECIDING, never idling.** Every one of the nine either amplifies an
   order's effect (brace, steady aim, charge), removes an order's cost, or rewards an input
   the player has to press (the dash rally). None is a flat aura on a troop standing in the
   blob: an aura would reward exactly the behaviour Plans 027 and 028 spent two slices
   measuring as already too strong.
9. **Perks are earned from milestones the world already emits** — camps razed plus
   settlements brought under the banner — and the count is DERIVED from persisted state
   (`perkPointsEarned(save) > save.perks.length`), never incremented by an event. That makes
   the award idempotent across a reload, a defeat, and a re-entry, which is the failure mode
   an event counter would have.
10. **The perk screen is a world-scene modal on Plan 021's existing machinery.** Same
    `world.screen` field, same `updateWorldScreens` branch, same queue-behind-the-aftermath
    behaviour the specialization choice already has. No new pause concept.
11. **The banner is the gold sink, and it buys a CEILING rather than a bonus.** Each banner
    stage raises the maximum rank a troop may reach. Gold buys the room; keeping men alive
    across fights is what fills it. This is the version of "banner upgrades" that does not
    become a flat aura, and it is what puts attrition and gold on the same axis.
12. **`SAVE_VERSION` 4 → 5.** Three new persisted fields (`troop.vet`, `save.perks`,
    `save.banner`). Pre-v5 shapes REFUSE all three, matching how `buildParties` refuses
    `raid` on a pre-v4 party.

## The perk list

Three tiers of three. A tier unlocks on the number of perks already taken (0 / 2 / 4), so the
ladder is legible from the first screen without a tree.

| tier | id | name | effect | why it is a decision |
|---|---|---|---|---|
| I | `setSpears` | Set Spears | brace bonus 1.8 → 2.2 for your troops | pays only when you press HOLD |
| I | `steadyHands` | Steady Hands | your braced bow spread ×0.6 | pays only when you press HOLD |
| I | `warhorn` | Warhorn | your charge exposure 1.35 → 1.18 | pays only when you press CHARGE |
| II | `hammerAnvil` | Hammer and Anvil | your charge speed ×1.15 → ×1.32 | a charge that actually arrives |
| II | `quickRelease` | Quick Release | shields come back up instantly when you rescind CHARGE (`CHARGE_RECOVER` → 0) | rewards taking an order BACK |
| II | `bodkins` | Bodkin Points | archers' anti-brute bonus 2.0 → 2.8 | pays only if you brought bows to a brute |
| III | `drillyard` | Drillyard | every veteran rank arrives one battle sooner | compounds the thing you built |
| III | `warlord` | Warlord | the hero's dash clears charge exposure from troops it passes and grants them charge speed for 1.5s | pays only on a pressed dash |
| III | `veteranCadre` | Veteran Cadre | recruits join already blooded (`vet` 1) | makes replacing a dead veteran cheaper, not free |

`warlord` is the one that is neither an order amplifier nor a cost remover: it is the
"dash/rally utility" the brief asked for, and it is the only perk that makes the hero's own
input matter to the warband — which is phase 4's recommendation 1 in miniature.

## Veterancy and the banner

| rank | name | battles survived | multiplier | banner stage required |
|---|---|---|---|---|
| 0 | — | 0 | 1.00 | — |
| 1 | Veteran | 3 | 1.12 | 0 (free) |
| 2 | Elite | 7 | 1.25 | 1 (150 g) |
| 3 | Champion | 12 | 1.40 | 2 (400 g) |

`vet` stops accruing at the banner's ceiling rather than being clamped at read time, so
`playerStrength(troops)` keeps its Plan 028 signature and no caller has to be handed the
banner stage to ask how strong a warband is. Raising the banner lets men resume earning.

Chevrons on the token: one per rank, drawn on the world warband badge and on the battle unit.

## In scope

- `src/data.js`: split spear/archer damage, `bonusVs`, `slots`, `armySlots()`, the re-fitted
  `POWER_EFFICIENCY`, `BALANCE.bannerCosts`.
- `src/progression.js` (new): `VET_RANKS`, `rankOf`, `rankMul`, `bannerRankCap`, `PERKS`,
  `PERK_IDS`, `perkMods`, `perkPointsEarned`, `availablePerks`. Pure over `(save)` and the
  data tables, imports `data.js` only — the same contract `region.js` holds.
- `src/save.js`: `SAVE_VERSION` 5, the three new fields, ranked-hp validation, `armySlots`
  in the cap rule, and the v4 army-cap grandfather (see STOP conditions).
- `src/battle/constants.js`: `BRACE_SPEED` 130, `BRACE_CHARGE_MUL`, `BRACE_MEMORY`.
- `src/battle/ai-phases.js`: the `rushT` latch on both sides, the brace read, `bonusVs`.
- `src/battle.js`: rank multipliers at spawn, perk mods on the instance, `vet` on survivors.
- `src/battle/combat.js`: perk-modified charge exposure.
- `src/battle/render-units.js`: veteran chevrons.
- `src/world.js`, `src/world/settlement-interactions.js`: `armySlots` in the recruit refusal,
  the banner purchase, the perk milestone check.
- `src/world/battle-transition.js`: `vet` award on victory, perks into `setup`.
- `src/world-screens.js`: the perk modal, the recruit-screen role text, hover/brief veterancy.
- `src/world/render-actors.js`: slot-cost prompt text, banner prompt, chevrons.
- `src/input-actions.js`: `UPGRADE_BANNER` on `KeyB`.
- Coverage: `save-schema.spec.js` (legacy/current/malformed v5 fixtures), the QA recruit
  record's cap semantics, `world-screens.spec.js` perk modal, `campaign-persistence.spec.js`.
- `critiques/progression-baseline.md`, `critiques/progression-comparison.md`, `AGENTS.md`,
  `tests/README.md`, `progress.md`, `plans/README.md`.

## Out of scope

- The heal cost / upkeep economy pass (Option 4). This slice adds sinks; it does not retune
  `healCost` or add wages.
- Battle objectives and win conditions.
- The hero's own stats. `HERO` is untouched, so the Plan 028 soak term is unchanged.
- Enemy types. `ENEMY_TYPES` is untouched; only the player's side is retuned, which bounds
  what the power re-fit has to re-establish.
- A skill tree, respecs, or perk removal. Nine perks, three tiers, permanent.

## STOP conditions

- **If the re-fitted power metric cannot recover headcount-or-better prediction after the
  unit retune, stop and report.** Plan 028's whole claim is that fighting weight means the
  same thing for every composition; a retune that breaks that has to be backed out, not
  shipped with a stale fit.
- **If the generator's player-power reading does not track a mid-progression warband, stop.**
  Tier honesty is Plan 028's deliverable. If an even-tier fight against a ranked warband does
  not land near ratio 1.0, veterancy has silently rotted the generator and the fix belongs
  in this slice, not the next one.
- **If knight-2-slots plus the unit retune makes any existing campaign fixture unwinnable for
  an active player, stop and report.** The cap change is a nerf to the strongest strategy, not
  a nerf to having an army.
- **If the v4→v5 migration cannot round-trip the existing fixtures, stop before shipping any
  gameplay code on top of it.** A schema that loses a campaign is worse than no progression.
- **If deliberate orders still do not beat idle over the sweep, the `@sweep` `test.fail`
  annotation stays.** It flips only on a robust measured win across seeds, in the change that
  makes it true. A truthful negative is the acceptable outcome — this is the third plan in a
  row to be told so and the second to have to obey it.
- **If a performance budget moves, stop** and cut the per-tick work rather than raising it.
- If a visual baseline goes stale, leave it, list it, and say so. Baselines are captured only
  through the pinned-Linux CI workflow; the 1.5% cap is not negotiable.

## Verification

```powershell
npm run release:cache
npm run test:release
npm run test:tooling
npm run test:perf
npm test
npm run test:balance
node scripts/zz-power-probe.mjs  --label prog-grid
node scripts/zz-power-probe2.mjs --label prog-rolled
node scripts/zz-power-fit3.mjs
node scripts/zz-tier-calibrate.mjs --label prog-after
node scripts/zz-enemy-command-sweep.mjs --label prog-after
node scripts/zz-brace-probe.mjs --label after
```

## Test semantics deliberately changed

Each of these encodes tuning or a schema version this plan changes. None loosens a bound;
each asserts the same intent against the new spec, and two are strengthenings.

1. **`tests/e2e/save-schema.spec.js`: every version assertion moves 4 -> 5**, and version 4
   becomes a legacy shape with its own migration fixture. The suite gained five records
   rather than only being renumbered: a v4 campaign migrating with empty progression (and
   its already-banked captures re-derived into perk choices), a v4 shape carrying any
   v5-only field being refused, a v4 knight army being grandfathered past the new slot
   arithmetic, invalid v5 progression shapes, and a veteran loading at his ranked maximum
   hit points. `save.version = 5` in the "unknown future version" record becomes 6.
2. **`world_party_break_off_occupies_settlement_and_recapture_restores_service`
   (tests/qa_suite.js): the fixture party is built to a WEIGHT bar, not a body count.** It
   was `Math.ceil(mine * 1.6)` bandits with an assertion that the result exceeds
   `mine * 1.3`. Those two numbers only agreed at the pre-029 spearman tuning, and the
   record broke the moment the spearman was retuned — it encoded a stale damage ratio rather
   than the property it tests. It now adds bandits until the weight bar is cleared. The
   assertion is unchanged.
3. **`economy_recruit_cost_cap_and_gold_refusals` (tests/qa_suite.js): extended, not
   changed.** Every original assertion stands. It now also drives the knight's two-slot
   cost: with one place left in the column a spearman fits and a knight does not, the
   refusal names the reason, and two free places take exactly one knight rather than two.
4. **`regional-campaign.spec.js`: three `screenOpen === false` assertions become
   `screenKind !== 'spec'`.** Committing a specialization now legitimately queues the perk
   choice that same capture earned. The intent — "the spec choice is done and does not
   re-open" — is unchanged and is asserted more precisely than before, since the old boolean
   could not distinguish "no screen" from "not this screen". The occupier fixture also takes
   a perk, because a v5 campaign with one capture has already been offered one.
5. **`campaign-persistence.spec.js`: the round-trip fixture gains a blooded roster.** It
   asserted `troops: ['spear','archer','knight']` by type only; it now round-trips `vet`,
   `perks` and `banner` as well, which is more of the schema than it checked before.
6. **The `brute` fixture comment in `stance-balance.spec.js` is corrected.** It claimed
   "HOLD wins through slam avoidance, NOT bracing: a brute moves at 55 and can never reach
   BRACE_SPEED". Both halves are now false — a brute ordered forward by `commit` does latch,
   and HOLD is also what arms the archers' counter. No assertion changed.

## Outcome

Full tables in `critiques/progression-comparison.md`.

| | before | after |
|---|---|---|
| brace fires, wolf contacts (roaming / brute-heavy) | 2.5% / 6.1% | **35.4% / 24.0%** |
| brace fires, brute contacts | 0% | **2.6%** |
| idle win, camp raids (120) | 70.8% | **69.2%** |
| idle win, roaming fixture (24) | 95.8% | 95.8% |
| holdLine win, camp raids | 35.0% | **51.7%** |
| split win, camp raids | 36.7% | **45.0%** |
| best deliberate order minus idle, camp raids | -2.5 | **-0.9** |
| decisive matchups the metric calls correctly, pooled | 84.6% (headcount) | **89.7%**, 93.5% on ladders |
| even-band idle win, mid warband / same warband blooded | n/a | **55.5% / 55.6%** |
| gold held after 14 opening fights (spend-what-you-have policy) | n/a | 161 g, banner stage 0.6 |

## Implementation findings

Each of these changed what shipped, and each cost a measurement.

1. **The brace was not a weak mechanic, it was a dead one, and the obvious repair was also
   wrong.** Both halves are in `critiques/progression-baseline.md`: the median CLOSING speed
   of a body inside a holding spearman's reach is NEGATIVE for every enemy type, so a rule
   reading velocity at the swing fires on 0-6% of contacts; and latching the fastest recent
   velocity instead reads knockback, not locomotion, because the `+= cos * 85` impulse gives
   a brute (base speed 55) a median latched peak of 72.9. The shipped rule latches commanded
   locomotion while approaching a hostile. Measuring the second failure BEFORE designing it
   in is the only reason it is not in the shipped code.
2. **The brace is a wolf counter and says so.** It now fires on 24-35% of wolf contacts, and
   on bandits and brutes only under `commit` or bloodlust — 2.6% of brute contacts in an
   organic fight. The mechanism is proven by a QA record that pins the stance directly; the
   organic rate is low because a player who is winning rarely pushes the commander that far.
   The plan does not claim a brute counter, which is the claim Plan 019 had to retract.
3. **This slice introduced an AFK-farm regression, and the sweep caught it.** The first
   complete build measured idle camp raids at 78.3% against the 70.8% baseline — worse than
   before Plan 028. The cause was the archer's anti-brute counter shipped unconditionally:
   camp garrisons are the brute-heavy fights, so a free doubling against brutes is a large
   real power gain handed to a player pressing nothing. Gating it behind steady aim returned
   the figure to 70.8% digit for digit over the same 120 raids, which is a clean attribution.
   It is also the better design and is this plan's own perk rule (decision 8) applied to unit
   identity: the archer keeps the role and buys it with an order.
4. **The re-fit had to be run twice for the same reason.** The first fit was measured against
   the ungated build and put the brute at 1.74; against the gated build it is 2.00, because a
   gated archer no longer halves a brute. Shipping the first table would have priced every
   brute in the game against a bonus the player only sometimes has.
5. **A harness bug looked exactly like a balance finding, and nearly was reported as one.**
   The tier calibration's first veteran run showed a Champion-heavy warband winning 16.7% of
   even fights against an unblooded warband's 66.7% — a tidy story about the rank multiplier
   being over-priced. It was not: `zz-tier-calibrate.mjs` built its battle roster with
   `troops.map(t => ({ type: t.type }))` and dropped `vet`, so every veteran roster was SIZED
   as veterans and FIELDED as recruits. Corrected, vetMid delivers 55.6% where unblooded mid
   delivers 55.5%.
6. **Veterancy is priced correctly at mid progression and over-credited at the top.** vetMid
   matches mid to within a tenth of a point; vetLate wins 72.2% of its even fights against
   unblooded late's 44.4%. The cause is structural — the square law credits per-body quality
   linearly, and a real fight rewards fewer-tougher bodies superlinearly. Fitting the rank
   credit against a grid of ranked rosters is the correct fix and is the top follow-up; at 12
   seeds a cell the present data cannot support calibrating an exponent, and inventing one on
   that evidence is the mistake three previous plans declined to make.
7. **The Drillyard perk would have written saves the validator refused.** Found by reading
   rather than by a failing test: the perk shifts every rank threshold, so a body legitimately
   reaches rank 2 at `vet` 6, while `buildTroops` computed its hit-point bound at threshold
   shift 0 and would have capped that man at the Veteran maximum. Whatever grants a rank must
   bound it. It has a fixture now.
8. **A single `legacy` boolean could not survive a second schema version.** Version 4 is a
   legacy shape now and legitimately carries the ownership and raid fields v3 must be refused
   for, so `buildV1` takes the declared version and derives `legacy` / `preV4` / `preV5` from
   it. The first attempt kept one flag and refused every real v4 campaign.
9. **The v4 army-cap migration grandfathers rather than refuses.** Twelve knights inside a cap
   of twelve was the audit's own "solved" army and is 24 places under the new arithmetic.
   Refusing that save would delete a legitimate campaign for a rule that postdates it, so the
   cap is widened to fit and the slot cost binds future recruits instead.

## STOP conditions: what fired

- "If the re-fitted power metric cannot recover headcount-or-better prediction, stop."
  **Did not fire.** 89.7% pooled against 84.6%, 93.5% against 85.8% on the ladders. On rolled
  compositions the two tie (82.0% against 82.3%), which is reported rather than hidden.
- "If the generator's player-power reading does not track a mid-progression warband, stop."
  **Did not fire.** `realRatio` tracks the drawn band at 1.00-1.16 for every roster including
  both veteran ones, and vetMid's even-band idle win matches unblooded mid's to a tenth of a
  point. The remaining vetLate gap is recorded as finding 6.
- "If knight-2-slots plus the unit retune makes any existing campaign fixture unwinnable for
  an active player, stop." **Did not fire.** 0 of 20 fresh campaigns open with nothing
  beatable, the weak tier remains a foothold, and every campaign fixture in the suite passes.
- "If the v4->v5 migration cannot round-trip the existing fixtures, stop before shipping
  gameplay code on top." **Did not fire**, but only after findings 7, 8 and 9 — the first
  migration refused every v4 save and the first validator would have refused a Drillyard one.
- "If deliberate orders still do not beat idle over the sweep, the annotation stays."
  **Fired, and the annotation stays.** The margin narrowed from -5.3 to -0.9 points, which is
  the closest any of the four attempts has come and is still not a strict inequality.
- "If a performance budget moves, stop." **Did not fire.** No budget touched; `test:perf` is
  green.
- "If a visual baseline goes stale, leave it, list it, and say so." **Fired.** Two brief
  baselines are stale — see below.

## Deliberately not done

- **The rank credit was not calibrated with an exponent.** See finding 6: the correct fix is a
  fit against a ranked-roster grid, and the tier harness at 12 seeds a cell cannot support
  inventing one.
- **The heal cost and upkeep economy were not touched.** Option 4 is separate work; this slice
  adds sinks rather than re-pricing the existing ones.
- **`ENEMY_TYPES` and `HERO` were not retuned.** Only the player's side moved, which bounds
  what the power re-fit had to re-establish and keeps the Plan 028 soak term unchanged.
- **No new audio assets.** The perk commit and the banner purchase reuse the existing
  `horn`/`coin` buses.
- **No new visual baseline for the perk screen.** Baselines are captured only through the
  pinned-Linux CI workflow, so adding one is the owner's dispatch, not a local recapture.
