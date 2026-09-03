# 039 — A beaten warband can come back, and the hold actually rides out

STATUS: DONE (2026-09-02), except this plan's own acceptance criterion 3, which is NOT
met: `raidsLanded` is still 0 across the campaign sweep. Both underlying defects are fixed
and proven by direct tests, but a whole scripted campaign is 17-20 seconds of WORLD time
against a 110-second `RAID.firstDelayT`, so the cadence cannot fire inside a measured run.
The constants were deliberately not re-scaled to fit an instrument that under-counts real
riding. Plan 038's criterion 3 went 9/12 -> 11/12. Numbers in
`critiques/campaign-recovery-and-pressure.md`.

Written 2026-09-02 against the tree at `9375040` (Plan 038 merged).
It is the plan Plan 038 named in three places as "Plan 039": the wipe death spiral
that holds its acceptance criterion 3 open, the regional-pressure mechanic that
measured zero landed raids across 96 campaigns, and the `@sweep` fixture Plan 038
saturated. Line numbers are from `9375040` and will drift.

Every claim below was re-verified against the code, and the two campaign numbers
come from `scripts/zz-campaign-baseline3.json` / `zz-campaign-final.json`, the
48-campaign columns Plan 038 measured.

## The complaint this resolves

Plan 038 made gold buy something: the campaign's dominant strategy inverted, and a
warband that fights and spends now reaches Wolfsjaw at three times the weight of
one that rides past. Three things it deliberately did not touch are now the
binding ones.

1. **A wipe is unrecoverable, and it is the only thing still failing Plan 038's
   criterion 3.** Defeat floors gold at 25 and backfills the column to TWO
   spearmen (`src/world/battle-transition.js:176,186`). The floor guarantee then
   promises a fight at `BALANCE.beatablePartyRatio` = 1.30, which `src/data.js`
   itself records as a **27.9%** win for a player who charges. So the offered
   move after a wipe is a fight you lose seven times in ten, which cuts gold
   again. Measured on the shipped tree: `campRaider` seeds 1, 2 and 12 each lost
   one fight costing ten to twelve men and ended the run at **exactly 25 gold**,
   at fighting weight 4.6, 6.6 and 2.5 — against `claimRush`'s steady 6.6. Those
   are precisely the three seeds where criterion 3 fails. Audit finding 4.
2. **The stronghold never rides out.** `raidsLanded` is **0 across all 96
   campaigns** in both of Plan 038's columns, and the reason is structural rather
   than a timing accident: `updateRegionalPressure` (`src/world.js:1221-1225`)
   filters targets to `rec.owner === OWNERSHIP.PLAYER`, so a player who claims
   nothing is never raided at all. `campRaider` and `farmer` hold zero
   settlements by construction and are therefore exempt from the entire regional
   layer. The one policy that does claim finishes in 52 flowing seconds, under
   `RAID.firstDelayT`'s 110. A milestone's worth of mechanic — the raid cadence,
   the defense battle, `graceAfterDefenseT`, the occupation-and-retake loop — has
   never fired in a measured campaign.
3. **The `@sweep` guard is saturated and can no longer detect a regression.**
   `raidSweep` (`tests/e2e/stance-balance.spec.js:135`) installs
   `['spear' x4, 'archer' x3, 'knight' x2]` — which is *exactly*
   `STAGE_LATE_ROSTER`, the roster the stage curve calls stage 7 — into a
   **stage-0** save, then raids c1/c2/c3. Under Plan 038's pricing that is by
   construction the easiest fight the game can produce: `encounterBase()` returns
   6.85 where `myStrength()` is 12.6, so the garrison target is nearly halved.
   Measured before and after Plan 038: idle 49 -> 94, chargeAll 60 -> 100, split
   34 -> 92. The guard's property still holds and the margin is intact, but at
   100% against 94% there is almost no room left for a real regression to show up
   in, and one policy is pinned at the ceiling.

## Design decisions

- **Distress is DERIVED, not persisted.** The obvious fix for 1 is a
  consecutive-defeat counter, and that is a new persisted field and a v5
  migration. It is also the wrong rule: the game should help a warband that is
  actually on the floor, not one that happened to lose twice while strong. The
  predicate reads `myStrength()` against `BALANCE.encounterStage.base` — the
  fresh warband's own weight, already computed in `data.js` — so a campaign is in
  distress exactly when it is no better off than the day it started. **No save
  schema change, and none is anticipated; if one appears, stop and re-plan.**
- **Relief changes what is OFFERED, never what is charged.** The floor guarantee
  already exists to keep something beatable on the map. In distress it aims at a
  band a beaten warband can actually win rather than at the top of `even`. The
  clamp, the trim and the "prefer adding over rewriting a scouted party" rule are
  untouched.
- **`beatablePartyRatio` does not move.** It is measured (Plan 035) and it is the
  right number for a healthy warband. Distress adds a SECOND, tighter promise; it
  does not retune the first.
- **The hold rides at the March, not only at the player's holdings.** Wolfsjaw
  seizing neutral ground is already a thing the game does — a broken-off party
  does exactly that (`World.isSettlementClaimed`). Letting the regional raid do
  it too makes the mechanic exist for every route, and an occupied neutral
  settlement is a real cost: it cannot be claimed while held. The raid reuses the
  break-off floor rule verbatim (never take the last unclaimed settlement).
- **The sweep fixture is re-based by MEASUREMENT, on headroom, not on which
  policy wins.** The assertion is not touched. Candidate stages are measured and
  the one that restores a usable margin is chosen; the numbers for every
  candidate go in the comparison file whichever way they fall.

## Slice A — a beaten warband can come back

### The rule

Two named values in `src/data.js`, both beside the floor they qualify:

```
BALANCE.distress = {
  // At or below this fighting weight the campaign is on the floor. Derived from
  // the stage curve's own base (the fresh warband), never typed.
  atWeight: BALANCE.encounterStage.base,
  // What the floor guarantee promises INSTEAD of beatablePartyRatio while there.
  partyRatio: <measured>,
  // The column a defeat musters back up to, when below it and not on HARD.
  musterTo: BALANCE.startTroops,
}
```

- `World.inDistress()` — one predicate, `myStrength() <= BALANCE.distress.atWeight`.
- `enforceBeatableFloor` (`src/world.js:487-512`) reads
  `inDistress() ? distress.partyRatio : beatablePartyRatio` for BOTH the
  "is anything beatable" test and the band it trims to. Nothing else changes:
  it still prefers adding a party over rewriting a scouted one, still trims
  exactly, still consumes no extra RNG.
- The defeat branch (`battle-transition.js:186`) musters back to
  `BALANCE.distress.musterTo` instead of the literal 2, still only when below it,
  still never on HARD, and the toast says how many rallied.

`partyRatio` starts at the top of the `weak` band (0.90, measured at 93.6% for a
charging player) and is moved only by measurement.

### Tests

- `tests/qa_suite.js:1091-1096` (the deadlock record) keeps asserting the floor
  against `beatablePartyRatio` for a healthy warband, and gains a distress case:
  a wiped warband must be offered a fight at or under `distress.partyRatio`.
- A `regional-campaign.spec.js` case for the muster: a defeat that leaves one man
  rallies back to `musterTo` at the nearest settlement, and a defeat that leaves
  a full column rallies nobody.
- A NEW harness policy, `rebuilder`, is what actually measures recovery, and
  adding one rather than editing the four existing ones is deliberate: every
  number in `critiques/campaign-arc-comparison.md` stays comparable. It is
  `campRaider`'s route plus one rule — while `inDistress()`, hunt the weakest
  beatable party instead of marching to the next objective, up to a bounded
  number of times. That is the player the relief is FOR.

  This matters because of something the plan's first draft got wrong. Relief
  alone cannot move Plan 038's criterion 3: `campRaider` attempts each camp once
  and then storms, so on seeds 1, 2 and 12 it marches to Wolfsjaw with whatever
  survived and never takes a recovery fight, however winnable. Checked
  arithmetically before writing any code — mustering seed 12 from two spearmen
  back to four moves its storm ratio from 3.48 to about 1.93, still a loss and
  still worse than `claimRush`'s 1.34. **Criterion 3 is therefore NOT expected to
  reach 12/12 from this slice**, and the honest measurement is `rebuilder` against
  `campRaider` on those three seeds: does a campaign that uses the recovery
  actually climb out? Whatever the answer, criterion 3's annotation is rewritten
  to say which part of the failure is the game and which is the scripted player.

## Slice B — the hold actually rides out

- `updateRegionalPressure`'s target filter takes player-held settlements first;
  when there are none it falls back to any settlement not owned by the player and
  not already claimed by a party, refusing the last unclaimed one exactly as
  `World.isSettlementClaimed`'s caller does. The dispatch toast distinguishes the
  two ("raiders march on X" against "raiders seize X").
- `RAID.firstDelayT` is re-examined against the measured campaign lengths
  (`campRaider` 155 flowing seconds, `claimRush` 52). It moves only if the
  measurement says the mechanic still cannot fire in a real run.
- Acceptance: `raidsLanded` must be greater than zero across the 48-campaign
  sweep, and at least one `defense` fight must appear in the records. Both are
  recorded per policy in the comparison file.

## Slice C — re-base the saturated sweep fixture

- `raidSweep` gains a `stage` argument: how many settlements the fixture holds
  before it raids. The roster does not change and neither does the assertion.
- Measure idle / chargeAll / split at stage 0 (today), and at the reachable
  stages, over the same 40 seeds x 3 camps. Choose the stage that puts the
  policies back in a measurable band — no column at 100 or 0 — and record every
  candidate.
- If the guard's direction flips at the chosen stage, **STOP**: report it, keep
  the fixture where it is, and re-plan. A fixture is not allowed to be chosen for
  the answer it gives.

## Files to modify

| File | Slice |
| --- | --- |
| `src/data.js` (`BALANCE.distress`) | A |
| `src/world.js` (`inDistress`, `enforceBeatableFloor`, `updateRegionalPressure`) | A, B |
| `src/world/battle-transition.js` (the defeat muster) | A |
| `src/region.js` (`RAID`, only if measured) | B |
| `tests/qa_suite.js`, `tests/e2e/regional-campaign.spec.js` | A, B |
| `tests/e2e/stance-balance.spec.js` (`raidSweep` stage argument) | C |
| `tests/e2e/campaign-arc.spec.js` (criterion 3's annotation) | A |
| `critiques/campaign-arc-comparison.md`, `AGENTS.md`, `SCOPE.md`, `tests/README.md`, `plans/README.md`, `progress.md` | all |

## Acceptance criteria

1. A warband at or below the fresh-warband weight is offered a fight it can win:
   asserted structurally in `qa_suite.js`, and visible as `campRaider`'s three
   spiral seeds recovering in the sweep.
2. Plan 038's criterion 3 improves from 9/12. If it reaches 12/12 the
   `test.fail()` comes off; if not, the remaining seeds are explained.
3. `raidsLanded` > 0 and at least one defense battle appears across the sweep.
4. `claimRush` does NOT start winning campaigns again — relief must not undo Plan
   038. Its win count stays at 0 of 12.
5. The `@sweep` guard still passes, with a margin measured on an unsaturated
   fixture.

Gates: `npm test`, `npm run test:balance`, `npm run test:perf` (the world tick
pipeline is touched), `npm run release:cache` then `npm run test:release`.

## STOP conditions

- Relief makes `claimRush` win again, or pushes any policy's battle win rate
  above 90%: the distress band is too generous. Halve it and re-measure; do not
  compensate by moving `beatablePartyRatio`.
- The sweep guard's direction flips at the re-based stage. Keep the old fixture,
  record why.
- Any step needs a new persisted field. None is anticipated. Stop and re-plan
  with a v5 migration rather than smuggling one in.

## What NOT to do

- Do not move `BALANCE.beatablePartyRatio`, `partyTiers`, `POWER_EFFICIENCY`,
  `HERO_POWER` or `WORLD.camps[].tier`. Each invalidates a measurement from Plans
  028/029/035, and none is the defect here.
- Do not weaken `deliberate orders beat giving no order at all`. Slice C changes
  the fixture it measures on, never the inequality it asserts.
- Do not add a consecutive-defeat counter to the save.
- Do not fold in Plan 040's battle work (HOLD in a Break fight, the stalking
  wolf pack). It is written and independent.
