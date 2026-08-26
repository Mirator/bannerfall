# Plan 028: Rebase the encounter generator on measured combat power

**Status:** DONE, with its headline premise CORRECTED rather than met. The generator is
rebased on a measured metric and the `even` band is calibrated (an idle hero wins 49.1% of
216 of them, against 58.9% before, and the band delivers 0.99-1.17 of real power instead of
0.73-1.29). But the audit number this plan set out to move -- "an idle hero wins 96% of
roaming fights" -- did not move, because that fixture is a hardcoded 0.57-ratio party that
BOTH metrics classify as weak. The camp ladder moved only 6.7 points, because its authored
0.7/0.9/1.1 tiers were already close to honest for a mid-size warband. The `@sweep`
`test.fail` annotation STAYS: measured over 360 raids per policy, pressing nothing beats the
best deliberate order by 5.3 +/- 2.8 points.
**Priority:** P0 (gameplay audit, phase 4 — "the game plays itself")
**Effort:** L
**Risk:** High (every generated encounter in the campaign, plus the legibility layer that
describes them and the Plan 020 deadlock guarantees that bound them)
**Audit finding:** `critiques/phase4/gameplay-audit.md`;
`critiques/phase4/self-playing-fix-options.md` Option 2
**Baseline recorded at:** `critiques/encounter-power-baseline.md` (measured on `b9ed84b`,
the Plan 027 commander slice, before any `src/` edit)
**Depends on:** Plan 020 (the tier system this rebases), Plan 021 (the legibility surfaces
this has to keep honest), Plan 027 (the enemy commander, which its own retrospective calls
a prerequisite for this rather than a substitute)

## Objective

Make the number the map balances on mean something, so that a fight the map calls even is
one an inattentive commander can lose.

Two investigations converge on the same cause and both stopped on it. Stat tuning failed
(`self-playing-fix-options.md`: enemy damage x2, x3, x4, focus fire, pincer spawns,
staggered waves, a passive player AI — each measured, each rejected). Smarter enemy AI
failed (Plan 027: five behaviours measured as net wins FOR THE PLAYER). Both retrospectives
end at the same sentence: **the encounter generator balances on headcount while actual
combat power is lopsided.** A brute counts 5 and a wolf counts 1; measured, one brute is
worth 3.19 spearmen and one wolf 0.52, and an idle hero counted 3 is worth about half of
one. Because the errors do not cancel, "12 strength" is not a difficulty — it is a
lottery, and one whose bias moves with the size of the warband, because the hero is 43% of
a starting warband's declared strength and 21% of a late one's.

Nothing downstream of a dishonest generator can make an idle hero lose the fights it
generates. This plan replaces the number.

*(Corrected during execution: the measurement did NOT support the strongest form of that
diagnosis. See Implementation findings 1 and 2 — the roaming fixture the audits quote is
a weak-tier fight by both metrics, and the camp ladder was already close to honest. What
the measurement does support is the variance claim, and that turned out to be the whole
defect.)*

## Design decisions

Settled; changing one needs a new review.

1. **Fighting weight is `sqrt(total dps x total hit points)`, normalised so one spearman is
   1.0.** That product is the Lanchester square law, which is what a fight between two
   lines that each shoot at whoever is nearest actually obeys. The square root makes it
   scale linearly with force size, so it drops in wherever the old strength points were and
   the tier bands and odds thresholds keep their intuitive meaning.
2. **Enemy cadence is `cooldown + windup`, not `cooldown`.** An enemy telegraphs its blow
   and only starts its cooldown once the strike lands. Every previous piece of arithmetic
   in this line of work — including the audit's "46 dps" for the roaming fixture — divided
   by `cooldown` alone and overstated the enemy by 38%.
3. **Per-type efficiency multipliers are FITTED, not reasoned out.** The raw product is
   wrong about specific bodies for reasons that are real but not in the formula: a raider
   delivers much of its output before anything can answer, a brute is hit points that must
   be ground all the way down, a wolf is 55 hit points that soak overkill. One multiplier
   per type, scaling both damage and hit points (so it scales that body's contribution
   linearly), fitted by maximum likelihood against a measured matchup grid with the
   logistic intercept pinned at zero — so a ratio of 1.00 is a measured coin flip by
   construction rather than by later calibration.
4. **The hero is soak, not damage.** He enters the metric as `HERO.hp` hit points and zero
   output. The generator therefore sizes every fight against a commander who gives no
   orders and never swings — which is precisely the player the phase-4 audit found winning
   96% of roaming fights — and everything the player does with the sword is his margin over
   the odds the map showed him. The consequence is stated on the warband hover panel in
   words, because a number that omits the player's own sword must say so.
5. **The metric is balance data and lives in `src/data.js`,** beside `UNIT_TYPES`,
   `ENEMY_TYPES`, the tier bands and `oddsWord` — the module that already owns every
   balance table and imports nothing, so no new import edge and no cycle risk. The existing
   `enemyStrength`/`playerStrength` names are kept and REDEFINED rather than joined by a
   parallel second metric: two numbers for "how strong is this force" is the failure mode
   this plan exists to remove.
6. **No save-schema change.** Fighting weight is derived from composition, and composition
   is already persisted. `SAVE_VERSION` stays 4.
7. **The odds thresholds do not move.** `oddsStronger` 1.15 and `oddsFavored` 0.85 stay
   exactly as they are, and that is the point: they are ratios of a quantity whose 1.0 is
   now a measured coin flip, so "an even fight" finally is one. The party badge's
   outmatched marker gives up its own hardcoded 1.3 and reads `oddsStronger` too.

## Deriving the metric

Two probes, because one is not enough and finding out why cost a full round of fitting.

- `scripts/zz-power-probe.mjs` — 296 hand-built matchups over 8 player rosters and enemy
  ladders that are mostly one type deep, 6 seeds each: **1776 battles.** This is what
  separates one body's worth from another's; a grid of average mixes cannot tell a wolf
  from a raider.
- `scripts/zz-power-probe2.mjs` — 6 rosters x 8 target bands x 2 composition tables x 8
  seeds: **768 battles**, every enemy force drawn through the SHIPPED `rollComposition` on
  the shipped `compRolls` weights. This is the distribution the generator actually
  produces, and it is what decides where the 50% crossing lands. Fitted on the ladders
  alone, the metric put the crossing at 1.12 on rolled compositions rather than 1.00.

`scripts/zz-power-fit3.mjs` fits both together, rolled rows weighted 4x, intercept pinned
at zero.

| | headcount (at its own best crossing) | fitted fighting weight |
|---|---|---|
| decisive matchups called correctly, pooled | 84.7% (1978/2334) | **89.0% (2077/2334)** |
| ...on the hand-built ladders | 87.7% | **93.9%** |
| ...on rolled compositions | 78.6% | 79.0% |
| ladder fit held out on unseen rosters | 87.0% | **93.9%** |
| crossing ratio across 45 roster-vs-family combinations (IQR, target 1.00) | 0.61 - 1.04 | **0.79 - 1.06** |

**The accuracy gain on rolled compositions is nil**, and the plan says so rather than
quoting only the ladder figure: both metrics sit near the ~80% ceiling there, because
rolled bands cluster around the crossing where outcomes are genuinely random. The
metric's value is the last row — it means the same thing for every composition, where
headcount means a different thing depending on what the party is made of.

The fit is reported in full in `critiques/encounter-power-comparison.md`, including the
three places it is still wrong.

## In scope

- `src/data.js`: `attackCycle`, `POWER_EFFICIENCY`, `UNIT_POWER`/`ENEMY_POWER`,
  `POWER_UNIT`, `HERO_POWER`, `forceWeight`, the redefined `enemyStrength`/`playerStrength`,
  `weightText`, a power-target `rollComposition`, the retuned `partyTiers`,
  `beatablePartyRatio`, `encounterWeightClamp`, `campWeightPerSize`, `garrisonBruteCaps`.
- `src/world.js`: `spawnParty`, `rollComp`, `rollGarrison`, `enforceBeatableFloor`, the
  regional raid roll.
- `src/world/battle-transition.js`: the stronghold reserve wave.
- Legibility: `src/world-screens.js` (hover panels, brief columns),
  `src/world/render-actors.js` (party badge threshold), `src/battle/hud.js` (defeat advice).
- `src/main.js`: the three scenario party fixtures, expressed in weight rather than bodies.
- `src/world.js`: `World.trimToBeatable()`, added during execution — see Implementation
  finding 7.
- Coverage: the Plan 020 records updated to the new semantics with their intent preserved;
  the `@sweep` annotation touched ONLY if the measurement supports it (it did not; the
  annotation stays and now records the measured margin).
- `critiques/encounter-power-baseline.md`, `critiques/encounter-power-comparison.md`,
  `AGENTS.md`, `tests/README.md`, `progress.md`, `plans/README.md`.

## Out of scope

- Any change to `UNIT_TYPES`, `ENEMY_TYPES`, `HERO`, costs, the army cap or unit AI. The
  metric describes the game; it does not retune it.
- The party AI's own chase/flee thresholds (`pStr > mine * 1.3`, the 0.75/1.1 flee bars).
  They are behavioural tuning rather than encounter generation, and they now read on an
  honest scale for free. Retuning them is a separate measurement.
- Battle objectives and win conditions (Option 1 in the options document).
- A save-schema change of any kind.

## STOP conditions

- **If the power metric cannot predict small-matchup outcomes better than headcount, stop
  and report.** The whole plan rests on the claim that headcount is the wrong number; if a
  measured alternative is no better, the diagnosis is wrong and no amount of retuning bands
  will help.
- **If calibrating `even` to genuinely contested makes the early campaign unwinnable for a
  competent active player, stop and report.** A fresh warband must still have a foothold:
  the weak band has to stay a real foothold and a fresh campaign must not open with nothing
  on the map it can beat.
- **If deliberate orders still do not beat idle over the 120-raid sweep, the `test.fail`
  annotation stays.** It flips only on a robust measured win across seeds, in the same
  change that makes it true. A truthful negative is the acceptable outcome; a flip validated
  on a favourable margin is the mistake Plan 019 had to retract and Plan 027 declined to
  repeat on a 0.0-point tie.
- If the deadlock floor cannot be expressed on the new metric while still provably
  guaranteeing a completable campaign, stop rather than shipping a weaker guarantee.
- If a performance budget moves, stop and lower the encounter clamp rather than raising the
  budget.

## Verification

```powershell
npm run release:cache
npm run test:release
npm run test:tooling
npm run test:perf
npm run test:visual
npm test
node scripts/zz-enemy-command-sweep.mjs --label enc-after
node scripts/zz-tier-calibrate.mjs
```

## Test semantics deliberately changed

Plan 020's records encode the OLD meaning of strength. Redefining what strength means is a
spec change, so each of these asserts the same INTENT on the new scale. None loosens a
bound to pass; each is listed with what it used to say and what it says now.

1. **`world_party_strength_stays_in_2_24_band` -> `world_party_weight_stays_in_the_encounter_clamp`.**
   The clamp was the literal `[2, 24]` strength points in the record's own name; it is
   `BALANCE.encounterWeightClamp` now, read from the balance table rather than restated, so
   the bound and the code cannot drift. Same extremes driven (a 0.0001x band and a 100x
   band). A one-body tolerance is added, on both sides, because the roller places WHOLE
   BODIES and stops on whichever side of the target is nearer — so a realised weight sits
   within one body of its target in either direction. The tolerance is the heaviest LIGHT
   body, because `rollComposition` refuses any brute that would overshoot at all, so the
   body that decides the stop is always a light one.
2. **`world_party_spawn_tiers_weighted_toward_strong`: classification boundaries, and one
   assertion made real.** The record classified a draw by hardcoded 0.75/1.35 cutoffs
   chosen as the midpoints of the gaps between the old bands. It derives those midpoints
   from `BALANCE.partyTiers` now, so they follow the bands instead of silently mis-sorting
   them. Every assertion is unchanged in intent: all three tiers must appear, `strong` must
   grow and `weak` must shrink as camps fall, and nothing may land outside all three. The
   last of those was VACUOUS before — the old `tierOf` always returned one of three names,
   so `other` could never be non-zero and `assert(other === 0, 'a spawned party landed
   outside all three declared tiers')` asserted nothing at all. A draw now counts as
   `other` when its ratio falls in a gap between the declared bands or outside them, which
   is the property the assertion always claimed to check. This is a strengthening, not a
   relaxation.
3. **`hover on the warband states the hero counts for three` -> `...states how the hero
   enters the odds`.** The panel used to assert the string `you count for 3`. The hero is
   not three spearmen; he is 120 hit points the odds assume you will not swing. The test
   asserts the panel still states, in words, how he enters the odds — and additionally that
   the panel carries a numeric fighting weight, which it did not check before.
4. **`world rendering stays within its own budget...` (performance.spec.js): the fixture
   party is pinned at 12 bodies.** It was `Math.round(world.myStrength())` bandits, which
   evaluated to 12 on the old scale and would evaluate to 5 on the new one. This is a
   RENDERING budget test — the quantity under test is how many tokens are drawn, not how
   strong they are — so halving the load would have quietly weakened the budget it guards.
   The budget itself is untouched.
5. **`the brief roster names every type present, in declared order`
   (tests/tooling/label-contract.test.js): the pinned strength number becomes a pinned
   contract.** It asserted `model.player.strength === 3 + UNIT_KEYS.length + 1`, an
   open-coded copy of the headcount rule. Restating the new formula there would just be a
   second copy of the metric that could drift from the first, so the test now asserts that
   the brief reports exactly what the shared `playerStrength()` produces for that roster,
   that the value is finite and positive, and that `weightText()` formats it — which is
   more of the label contract than it checked before, not less.

## Outcome

Full tables in `critiques/encounter-power-comparison.md`.

| | before | after |
|---|---|---|
| idle win, generator-drawn `even` party (216-360 fights) | 58.9% | **49.1%** |
| real power ratio the `even` band actually delivers | 0.73 - 1.29 | **0.99 - 1.17** |
| idle win, `weak` band | 84.7% | 85.2% |
| idle win, `strong` band | 0.0% | 0.0% |
| idle win, camp raids (120) | 77.5% | 70.8% |
| idle win, hardcoded roaming fixture (24) | 95.8% | 95.8% |
| best deliberate order minus idle, 360 raids | -10.0 (Plan 019) / 0.0 (Plan 027) | **-5.3 +/- 2.8** |
| decisive matchups the metric calls correctly | 84.7% (headcount) | **89.0%**, 93.9% on ladders |

## Implementation findings

Each of these changed what shipped, and each cost a measurement.

1. **The audit's headline fixture was never an even fight.** The "standard roaming
   encounter" an idle hero wins 95.8% of is 3 bandits, 2 raiders and 2 wolves against 8
   troops: a 0.57 power ratio, and headcount agreed at 7 against 12. Both metrics call it
   WEAK. Plan 027's retrospective, and this plan's own brief, treated it as evidence that
   even fights are player-favoured. It is not. It is evidence that a weak fight is
   winnable, which is the design.
2. **The camp ladder was already close to honest.** `WORLD.camps[].tier` is 0.7 / 0.9 /
   1.1, and the pre-028 generator delivered about 0.66 / 0.89 / 1.06 of real power against
   the nine-troop harness warband. Camp raids therefore moved 77.5% to 70.8% and no
   further, and most of even that comes from the archer revaluation raising the player's
   own weight rather than from the tiers being rewritten.
3. **The real defect was VARIANCE, and its cause was the hero counting three points.** He
   is 43% of a starting warband's old strength and 21% of a late one's, so the same
   declared tier meant very different fights at different points in a run. The old `even`
   band gave a fresh warband a 1.29 ratio at its top (idle wins 0%) and a mid warband a
   1.14 (idle wins 58.3%). The new band spans 0.18 of ratio across all three rosters
   instead of 0.56. That is what this slice actually fixed.
4. **Two of the fitted multipliers came out opposite to the intuition that motivated
   them.** A raider is worth 1.65x its raw damage-times-durability figure and a brute
   1.90x. Both were expected to be worth LESS, on the reasoning that a slow brute arrives
   late and a kiting raider spends its time not attacking; the measurement says the
   opposite in both cases. The naive arithmetic the brief proposed (dps x hp, no
   corrections) predicts 87.4% of decisive ladder matchups and headcount predicts 87.7% --
   the corrections are the whole difference between "no better than headcount" and 93.9%.
5. **The archer's multiplier depends on which grid you fit.** 0.86 against hand-built enemy
   ladders, 1.30 against rolled compositions. A pure wolf pack sends every body at
   `nearestFriendlyRanged` and eats the whole bow line, which the ladder grid is full of
   and real play is not. Both numbers are recorded; 1.30 ships because it describes the
   fights the generator serves.
6. **The roller's overshoot was a second, hidden bias with the same shape as the hero
   one.** `rollComposition` stopped on the crossing body, and one body is 7% of a late
   warband's weight and 18% of a starting one's, so a fresh campaign was quietly served
   harder fights than the band it drew. Stopping on whichever side of the target is closer
   took a fresh warband's realised ratio at a 1.10 draw from 1.20 to 1.08, and took the
   pooled `even` idle win rate from 38% to 49.1%.
7. **The beatable-party floor was genuinely broken by the rebase, and the worst-case test
   caught it.** A comp aimed anywhere inside the `even` band could overshoot
   `beatablePartyRatio` by one body and leave nothing beatable on the map -- the exact
   deadlock the floor exists to prevent. `World.trimToBeatable()` makes the guarantee
   structural: pop bodies until the party is provably at or under the ratio, never below
   one body, consuming no `simRng` draws. `isSettlementClaimed()` needed no change at all;
   it counts occupiers and compares no forces.
8. **No visual baseline moved.** The brief and hover panels genuinely changed their text
   ("fighting weight 4.6" for "7") and the party fixtures behind two baselines changed body
   count, but all 20 comparisons passed inside the suite's existing tolerance with no diff
   artifacts generated. Nothing was recaptured and nothing was left stale.
9. **The `@sweep` finding is now a measured loss rather than a tie.** 360 raids per policy,
   paired seed by seed and camp by camp: charging everything won 40 raids that pressing
   nothing lost and lost 59 that it won, a margin of -5.3 +/- 2.8 points. The mechanism is
   visible in the `unresolved` column -- idle leaves 41 of 360 unfinished and chargeAll 20,
   nine seconds faster. Charging buys tempo with `CHARGE_EXPOSURE`, and a warband on
   `follow` does not need the tempo. Harder encounters made that trade worse rather than
   better, because the penalty scales with the incoming damage.

## STOP conditions: what fired

- "If the power metric cannot predict small-matchup outcomes better than headcount, stop."
  **Did not fire.** 89.0% pooled against 84.7%, 93.9% against 87.7% on the ladders, and the
  crossing-consistency interquartile range tightened from 0.61-1.04 to 0.79-1.06.
- "If calibrating `even` to contested makes the early campaign unwinnable, stop." **Did not
  fire.** 0 of 20 fresh campaigns open with nothing at or under the beatable ratio, the
  weak tier is a real foothold at 85.2% idle, and camp c1's authored 0.7 tier sits inside
  it.
- "If deliberate orders still do not beat idle, the annotation stays." **Fired, and the
  annotation stays**, with the measured -5.3 point margin now recorded in the test itself.
- "If the deadlock floor cannot be expressed on the new metric while still provably
  guaranteeing a completable campaign, stop." **Did not fire** -- but only after
  `trimToBeatable()`. The first implementation could not make the guarantee and the
  worst-case record failed until it did.
- "If a performance budget moves, stop." **Did not fire.** No budget was touched.

## Deliberately not done

- **The camp tiers were not retuned.** They are authored content in `WORLD.camps` and they
  now mean what they read as. Making camps harder is a design decision, not a consequence
  of measuring them, and it belongs in its own plan with its own before and after.
- **The party AI's chase/flee thresholds were not retuned.** `pStr > mine * 1.3` and the
  0.75/1.1 flee bars are behavioural tuning; they read on an honest scale for free now, and
  changing them is a separate measurement.
- **`oddsWord`'s thresholds were not moved.** 1.15/0.85 around a measured coin flip is
  correct, and the party badge gave up its own hardcoded 1.3 to use them instead.
- **No save-schema change.** Fighting weight is derived from composition, which is already
  persisted. `SAVE_VERSION` stays 4.
