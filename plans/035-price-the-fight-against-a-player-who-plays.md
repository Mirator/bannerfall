# 035 — Price the fight against a player who plays

STATUS: SHIPPED (2026-08-31). Written as a handoff plan before implementation;
the "What was measured and what shipped" section at the end records the result,
including the two places where measurement contradicted the plan's premises.

## The complaint this resolves

"The player is too strong" — the last open item of the 2026-08-31 combat-rehaul
assessment (the other three were resolved by Plans 032/033/034: facing/flank
arcs, the deployment phase, terrain legibility plus the crossing wall).

## Why the player is too strong, precisely

Plan 028 deliberately prices every encounter against a player who does NOTHING:
`HERO_POWER` in `src/data.js` enters the fighting-weight metric as 120 hit
points and zero damage, and `BALANCE.partyTiers.even` (0.95-1.20) was
calibrated so a ratio of 1.0 is a coin flip for an idle commander. That was the
right honesty move when idle was the strongest policy. It no longer is: since
Plan 033 the no-input baseline (confirm the deployment, placed line holds) wins
53% of camp raids while chargeAll wins 60% (measured 2026-08-31,
digit-identical across two sweep runs — `npm run test:balance`). Every fight
the map calls "even" is therefore comfortably winnable for a player who gives
one order, and everything the hero's own sword does (22 dmg x 3 targets at
0.34s, dash i-frames every 2.2s, speed 315 against a fastest enemy of 158) is
unpriced surplus on top of that.

## The change

Recalibrate what "even" means: an even fight should be a measured coin flip for
a player who COMMANDS — the chargeAll policy, the strongest simple input — not
for one who presses nothing. Do it by moving the tier bands, not the metric:

1. **Measure the win-rate-vs-ratio curve under the chargeAll policy.** The
   instrument exists: `scripts/zz-power-probe2.mjs` measured the idle curve for
   Plan 028 (idle won ~95% at ratio 0.7, ~60% at 1.0, ~44% at 1.1, ~24% at 1.2
   — all stale numbers now, pre-033). Update or clone it to (a) drive the
   current production battle entry — see `raidSweep` in
   `tests/e2e/stance-balance.spec.js` for the exact confirm sequence: site-menu
   Enter, brief Enter, deployment arm ~0.4s then Enter, each edge ASSERTED so
   the probe can never silently measure a paused scene — and (b) issue the
   chargeAll orders after the deploy confirm. Measure idle too, same seeds, for
   the paired margin. Use 300+ raids per ratio point: the binomial SE at 120 is
   4-5 points and past attempts on this finding drowned in less.
2. **Set `BALANCE.partyTiers.even` to straddle the chargeAll 50% crossing**,
   `weak` to stay a foothold a fresh warband takes with orders, and `strong` to
   a fight that needs placement, orders and the sword. Keep the structural
   couplings intact — they are the trap in this slice:
   - `BALANCE.beatablePartyRatio` is PINNED to the top of the even band by
     design ("beatable" and "a fair fight" must be the same number — Plan 020's
     rationale, restated at the definition in `src/data.js`). Move them
     together.
   - `BALANCE.encounterWeightClamp` and `campWeightPerSize` keep their own
     meanings; check the camp tier curve (`WORLD.camps[].tier`) still spans
     winnable-to-punishing under the new bands by measuring a raid at each camp
     with a starting warband.
   - `oddsStronger`/`oddsFavored` are ratios of the same weight scale, so the
     odds words move meaning automatically — re-read their comment and decide
     whether 1.15/0.85 still bracket the new even band sensibly.
3. **Only then decide the hero trim.** The re-pricing may absorb most of the
   sword surplus (fights get bigger, the same sword clears a smaller fraction
   of them). If a post-change playtest still trivializes even fights, the two
   measured degenerate loops are `HERO.swingMaxTargets` 3 -> 2 and dash
   i-frames applying to arrows (make them melee-only). Change nothing here
   without a before/after sweep and a written reason; the phase-4 audit's
   lethality rejections are the precedent.

## What NOT to do

- Do not give `HERO_POWER` fitted dps. Plan 028 measured that letting the fit
  choose hero credit drives it to zero (a parameter constant across every
  roster is a boundary artefact), and the harness cannot script hero input, so
  any dps number would be invented. The bands are where "an active player" is
  priced.
- Do not touch `POWER_EFFICIENCY` or the square-law formula — retuning unit
  stats invalidates that table (its comment explains the re-fit protocol), and
  this slice retunes no unit stat.
- Do not weaken `deliberate orders beat giving no order at all`
  (`tests/e2e/stance-balance.spec.js`, tagged `@sweep`). It is a hard guard
  now, NOT an expected failure — Plan 033 flipped it and its comment block is
  the history. Re-pricing changes garrison sizes, so the sweep numbers WILL
  move: run it twice, digit-identical or explain why not, and the guard must
  hold.

## Fixtures and records that will move (update honestly, never loosen)

- `tests/qa_suite.js` records `world_party_weight_stays_in_the_encounter_clamp`
  and `world_party_spawn_tiers_weighted_toward_strong` derive their bounds from
  `BALANCE.partyTiers` since Plan 028, so they follow the bands — verify rather
  than assume.
- `tests/e2e/world-hover.spec.js` asserts odds words and weights on fixtures;
  `tests/e2e/world-screens.spec.js` asserts brief contents. A band change can
  flip an "even" fixture to "favored" — fix the fixture's composition, never
  the assertion's meaning.
- `critiques/` holds the Plan 028 calibration records; add the new curve there
  the way `encounter-power-comparison.md` did.

## The workflow this repo runs (follow it exactly)

An entry in `progress.md` (plain measured prose, no adjectives). Implement on a
branch off main. `npm run release:cache` then `npm run test:release` after ANY
src/ edit. Full gate `npm test` — expect 188/189 locally: `battle-break.png` is
a documented Windows-only rasterization drift; the CI-equivalent container
passes it (`npm run test:visual:linux`, needs Docker Desktop running). Balance
sweep `npm run test:balance` twice. Visual baselines only via the
CI-equivalent container with the PR gate adjudicating (Plan 033's provenance
rule; record which PNGs changed and name the unchanged controls). Then an
adversarial code review of the branch diff before the PR — the last three
slices each ran eight finder angles with per-candidate verification, and every
one found real defects the gates had missed; the recurring classes were
vacuous fixtures (a test silently measuring a paused or empty scene) and
frame-of-reference blindness (a test sampling in the same frame the code under
test generated). Fix what survives verification, re-measure, THEN open the PR,
wait for both CI checks (`qa`, `sweep`), and merge.

## Definition of done

- The measured chargeAll win rate at the centre of the new `even` band is
  50 +/- 5 over at least 300 raids, and the idle rate at the same ratio is
  recorded beside it (it should sit clearly below 50 — that gap IS the
  incentive to command).
- The beatable floor, camp curve, odds words and both qa records hold under the
  new bands, updated where the bands moved them.
- The sweep guard holds, twice, with the numbers recorded in this plan file.
- Everything merged to main through a green PR.

---

## What was measured and what shipped (2026-08-31)

Full record in `critiques/reprice-active-player-comparison.md`; raw rows in
`scripts/zz-party035a.json`, `zz-party035b.json`, `zz-party035c.json`,
`zz-scout2.json`, `zz-camp035-after.json`. Instruments:
`scripts/zz-tier035-probe.mjs` (ratio ladder, both encounter paths, four policy
columns) and `scripts/zz-camp035-curve.mjs` (the camp tier ladder on its own
`tier` values). Both drive the PRODUCTION battle entry with every confirm edge
asserted, and the ratio probe replays digit for digit (660/660 rows identical
across two consecutive runs), so its numbers are measurements rather than draws.

### The change

| knob | before | after |
|---|---|---|
| `partyTiers.weak` | 0.55-0.80 | 0.65-0.90 |
| `partyTiers.even` | 0.95-1.20 | 1.05-1.30 |
| `partyTiers.strong` | 1.40-1.85 | 1.50-1.95 |
| `beatablePartyRatio` | 1.20 | 1.30 |
| `oddsFavored` | 0.85 | 1.05 |
| `oddsStronger` | 1.15 | 1.30 |

The whole ladder moved up by 0.10. Every band width and every gap between bands
is unchanged, and no unit stat, efficiency multiplier or formula was touched, so
`POWER_EFFICIENCY` and the square law are exactly as Plan 029 left them.

### The curve (roaming-party path, 330 battles per cell, three rosters, six sampled battlefields)

Scoring an unresolved 95s window as a loss, which is what the shipped sweep's
`winPct` does:

| ratio | 0.775 | 1.00 | 1.05 | 1.15 | 1.175 | 1.25 | 1.30 | 1.725 |
|---|---|---|---|---|---|---|---|---|
| chargeAll | 93.6 | **77.3** | 67.9 | 52.7 | **52.1** | 38.8 | 27.9 | 3.9 |
| idle | 57.9 | 54.5 | 53.6 | 43.6 | 46.7 | 32.1 | 27.3 | 3.0 |
| holdLine | — | 46.1 | 45.2 | 39.1 | — | 30.6 | 29.4 | — |

The 50% crossing for a commanding player is at ratio **1.18**, not at 1.00 as
Plan 028's comment claimed. The old `even` band therefore ran from a 77% fight to
about a 46% one — the walkover the complaint named.

### Definition of done, item by item

* **chargeAll at the centre of the new even band (1.175) is 50 +/- 5 over at
  least 300 raids.** Measured twice at n=330: **52.1% +/- 2.7** before the band
  change and **48.8% +/- 2.8** after it (55.7% and 52.3% counting only fights
  that closed). Inside the tolerance on all four figures. The two runs are not
  digit-identical and should not be: the band change perturbs the campaign's own
  `simRng` stream through `rollPartyBand`, so the second run is an independent
  draw at the same ratio, not a replay. The probe itself is deterministic
  (verified: 0/660 rows differed on a same-code repeat).
* **The idle rate recorded beside it.** 46.7% before / 42.4% after — below 50, as
  the plan expected. But see contradiction 2 below: on the honest "who beat whom"
  metric idle reads 77%, and the difference is a 39% stall rate.
* **The beatable floor** moved with the even band's top, as mandated. A fight at
  the floor measures 27.9% for a charging player.
* **The camp curve** was measured on its own tiers rather than assumed, 60 seeds
  per cell, `chargeAll`: c1 (0.7) 100% at every roster, c2 (0.9) 38/60/60 for
  fresh/mid/late, c3 (1.1) 50/25/22, Wolfsjaw Hold (1.5) 0% at all three. It
  spans winnable to punishing and needed no change.
* **Both qa records held** without editing an assertion — they derive their
  bounds from `BALANCE.partyTiers`, and the gaps between bands were preserved
  precisely so the tier record's gap-midpoint classification still works.
* **The sweep guard holds, twice, digit for digit:** idle 53 / chargeAll 60 /
  split 37 on both runs — identical to the pre-change baseline measured on this
  machine before any `src/` edit. Worth recording that the baseline itself is not
  identical to the number `progress.md` carries for Plan 034 on the same code
  (52 / 58 / 38): the sweep drifts a point or two across environments even though
  its seeds are pinned and its timestep fixed. The before/after comparison inside
  one environment is exact, which is what the guard needs; a single absolute
  figure quoted from another machine is not. That is the correct result, not a missed effect: the sweep measures
  CAMP raids, whose garrisons are sized by `camp.tier`, and this slice changed
  only the roaming-party generator. The plan predicted the numbers would move;
  they did not, and that is the evidence the change is confined to the path it
  was meant to touch.
* **Gate:** 189/190 (`npm test`). The one failure is `battle-break.png`, the
  documented Windows-only rasterization drift — confirmed by stashing every
  `src/` change and watching it fail identically on unmodified code. No visual
  baseline was updated by this slice.
* **Hero trim (step 3): NOT taken.** The re-pricing absorbed the surplus it was
  meant to: at the new even centre a commanding player with an idle sword is at
  50%, so `swingMaxTargets` and the dash i-frames are untouched and no
  before/after sweep was spent on them. Step 3's precondition ("if a post-change
  playtest still trivializes even fights") is not met.

### Where measurement contradicted the plan

1. **"chargeAll, the strongest simple input" — true, but not for the reason the
   plan's numbers implied.** It leads idle by 23 points at ratio 1.00 and 9 at
   1.15, so the premise holds. What does not hold is the sweep's 53-vs-60 as
   evidence for it. Replicating the sweep's own fixture exactly reproduces both
   figures to the digit (64 idle wins and 72 chargeAll wins out of 120) and shows
   the margin is almost entirely the difference in how often each policy runs the
   clock out: 12 idle stalls against 2. Over fights that CLOSED the two policies
   are 59.3% and 61.0% — within noise. The guard is measuring stall avoidance
   more than won fights. It was not weakened, and this is recorded rather than
   acted on.
2. **The plan expected the idle rate at the even centre to "sit clearly below
   50 — that gap IS the incentive to command". It does under the sweep's
   convention (46.7%) and it does not under the honest one (77.0%).** The
   reconciliation is a 39% stall rate: an idle line fails to close 39% of roaming
   fights, against 6% for a charging one. It is not winning those fights; nobody
   is. The gap is real, but it is bought as much by an idle line failing to reach
   the enemy as by a charging line beating him. Both columns are reported in the
   critique for that reason.

### Out of scope, found while measuring

World position **(1600, 900)** — the coordinate the `world_aftermath` test
scenario uses — samples a battlefield whose obstacle field contains six r=60
trees at x 1090-1170, y 730-940: a solid wall directly across the engagement
axis. Both lines freeze about 80px apart and neither side ever closes; 3/3 seeds
ran the full 95s window with every surviving enemy at full hit points,
`bloodlust` armed at 14s and nothing behind it. `STALL_NO_DEATH` arms
`bloodlust`, and `bloodlust` orders the enemy to close in, but nothing makes it
ABLE to. This is a terrain/steering defect, not a pricing one; the probe excludes
that coordinate and names it rather than working around it silently. The same
mechanism produces the 39% idle stall rate above, so it is not one unlucky spot.

### Coverage added

`odds_words_are_ordered_and_bracket_the_even_tier_band` (`tests/qa_suite.js`).
The plan's handoff notes said `tests/e2e/world-hover.spec.js` asserts odds words;
it does not, and nothing else in the gate touched `oddsWord` either — both
thresholds could be moved by any amount, in either direction, or crossed over
each other, with the suite still green. The record asserts the vocabulary's
contract rather than a tuning value: three distinct and reachable words,
`oddsFavored` below `oddsStronger`, a label monotonic in enemy weight, and the
even WORD band bracketing the even TIER band with the weak and strong tiers
outside it. Mutation-checked: it fails on the pre-change pair (1.15/0.85), on a
narrowed pair (1.30/1.10) and on a crossed pair (1.05/1.30).
