# 035 — Price the fight against a player who plays

STATUS: READY — this is a handoff plan, written before implementation for an
agent starting fresh in another session. Everything needed to execute it is in
this file, the files it names, and the repository contracts (`CLAUDE.md`,
`AGENTS.md`, `tests/README.md` — read those first, as always).

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
