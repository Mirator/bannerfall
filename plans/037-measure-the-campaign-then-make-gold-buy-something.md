# 037 — Measure the campaign arc, then make gold buy something

STATUS: DONE (2026-09-02). All four slices shipped, plus one fix this plan did not
anticipate and deliberately scoped in only after measuring that nothing else could deliver
criterion 3: `campVictoryExtra`'s absorption of surviving roaming parties into Wolfsjaw
when the last linked camp is razed was unbounded, and was the one force in the game that
bypassed `encounterBase()`. It is now bounded by `BALANCE.strongholdRemnantCeiling` and
the bands that do not fit stay on the map.

The before/after is in `critiques/campaign-arc-baseline.md` and
`critiques/campaign-arc-comparison.md`. The headline: `campRaider` went from winning 0 of
12 campaigns to 4, `claimRush` from 2 to 0, and the campaign's dominant strategy inverted.

Acceptance criterion 3 holds on 9 of 12 seeds (from 2 of 12 before the remnant fix) and
the assertion stays open with a `test.fail` annotation in
`tests/e2e/campaign-arc.spec.js`. The three failures are the wipe death spiral this plan
lists as out of scope (finding 5): a warband that loses a fight costing it ten men lands
on the 25-gold floor and never rebuilds. That, re-basing the shipped `@sweep` fixture
(whose stage-0 roster now makes it a walkover), and the raid cadence that still never
lands are the head of Plan 038.

Written 2026-09-02 as a handoff plan from the gameplay audit in
`critiques/gameplay-audit-2026-09-02.md` (findings 7, 1, 2, 5, in that order).
Every code claim below was re-verified against the tree at `5bcd88c` before
writing; line numbers are from that commit and will drift.

## The complaint this resolves

The battle layer has been measured to three digits across Plans 028-035. The
campaign layer has never been measured at all: no plan records time-to-victory,
gold curve, fights per run, or which route a scripted player takes to Wolfsjaw.
Reading the code instead of measuring it turns up four rules that together make
the economy a treadmill and the strategic layer skippable:

1. **Every encounter is priced off `myStrength()`.** `spawnParty` targets
   `mine * band` (`src/world.js:441`), `rollGarrison` targets
   `max(size * 0.9, mine * tier * hardMul)` (`:551-553`), the regional raid
   targets `mine * 1.1` (`:1170`), and the stronghold reserve wave is sized off
   `mine` in `src/world/battle-transition.js`. `myStrength()` prices troops,
   veterancy and the Drillyard perk (`:563-566`). So recruits, the army-cap
   ladder and the banner raise both sides equally; camp c1 sits at ratio 0.71
   whether the warband weighs 4.6 or 12.6. On top of that `rollPartyBand`
   shifts weights toward `strong` as camps fall (`:412-421`; mean band 1.15 at
   0 razed, 1.44 at 3 razed), so the player pays gold for harder fights.
2. **A claim is free and unconditional** (`src/world/site-menu.js:113-119`,
   `World.claimSettlement` `:987`). Four claims reach `strongholdPoints = 4`
   which is EXPOSED (`src/region.js:142-144`), remove the reserve wave at two
   captures (`:193`), and pay four perk points (`src/progression.js:175-179`).
   Each claim also EXTENDS raid grace (`winSettlement`, `world.js:977`:
   `raidCdT = max(raidCdT, 60)`), and `RAID.firstDelayT` is 110 flowing
   seconds. A ride past all four settlements is roughly 60-120 s of clock.
   The credible fastest win never fights until the storm.
3. **The game's own copy pushes the worse route.** Toasts say "Raid the camps
   to stop the raids", but razing all three sets `partyCap()` to 0
   (`world.js:530-533`), so roaming spawns and gold income stop and the map
   empties, while the band shift above makes what is left harder.
4. **`ENEMY_TYPES[type].gold` is dead data.** Loot is
   `lootBase + totalEnemies * lootPerEnemy` (`src/battle/combat.js:135`); the
   per-type field (`src/data.js:119-131`: bandit 6, raider 7, brute 25, wolf 4)
   has no reader anywhere in `src/`. Under the flat rule a wolf pays 10.8 gold
   per unit of fighting weight and a brute 1.6, so the dominant income is
   running down fleeing wolf-heavy weak parties.

The order matters. Measure first, so each rule change has a before and an
after on the same seeds and the same policies, exactly as Plan 035 did for the
tier ladder.

## Design decisions

- **The harness is the deliverable of slice A, and it is a `@sweep` check, not
  a PR gate.** Same split `playwright.config.js` already makes: tagged
  `@sweep`, runs under `npm run test:balance`, excluded from `npm test`. A
  campaign is ~25 battles at up to 95 s of simulated time each; it does not
  belong in the 30 s per-test gate.
- **Encounters are priced off campaign STAGE, with a partial correction for
  the warband.** Stage is `strongholdPoints(save)` (0..7: held settlements plus
  razed linked camps, `src/region.js:163-165`). It is already a pure
  derivation over the save, so this needs no save-schema change. The
  correction uses a fractional exponent, not a clamp: a clamp keeps the ratio
  constant inside its window, which is the exact defect being removed.
- **The floor guarantee, the odds words and party mood stay relative to
  `myStrength()`.** `beatablePartyRatio` (`world.js:487-512`), `oddsWord()`
  (`data.js:516-520`) and the chase/flee thresholds (`world.js:776-777`) all
  answer "can THIS player beat THIS party" and must keep reading the real
  warband. Only the generator's TARGET changes.
- **A claim costs gold, and EXPOSED needs at least one razed camp.** A militia
  fight per neutral settlement was considered and rejected for this slice: it
  is a new battle setup, a new brief title and a new objective tuning, an L on
  its own. A gold price and a gate are an M and they close the speedrun.
- **Loot pays per body type through one exported formula.** `lootFor(comp)` in
  `src/data.js` is read by `endBattle` and by every test, so the QA suite and
  the game cannot disagree about a number.
- **No band moves.** `BALANCE.partyTiers`, `beatablePartyRatio`,
  `POWER_EFFICIENCY`, `HERO_POWER` and `WORLD.camps[].tier` were all measured
  in Plans 028/029/035 and are out of scope. Slice B changes what the bands
  multiply, not the bands.

## Slice A — the campaign harness

### Shape

- `tests/e2e/campaign-harness.js`: a helper module, browser-side code passed
  through `page.evaluate` like `raidSweep` in `tests/e2e/stance-balance.spec.js:125-198`.
- `tests/e2e/campaign-arc.spec.js`: the `@sweep` spec that runs the policies
  below over N seeds and asserts the structural properties listed under
  Acceptance. One non-sweep smoke test (2 seeds, 4 fights, `forced` resolve)
  runs in `npm test` so the harness cannot rot silently.
- `scripts/zz-campaign-probe.mjs`: the scratch probe for wide exploration
  (many seeds, alpha grid for slice B), same conventions as
  `scripts/zz-tier035-probe.mjs` (argv flags, JSON out under `scripts/`,
  `--workers` fan-out). NOT a gate.

### Rules the harness must obey

- Boot exactly as `regional-campaign.spec.js:23-36` does: `scenario('world',
  {seed})`, park `game.update`, drive `real(1/60)` explicitly. Pin the canvas
  to 1280x720 before measuring anything (`stance-balance.spec.js:131-134`:
  outcomes depend on canvas size through hero aim).
- Everything through `window.game` writes `bf_save_test`. Assert `bf_save` is
  untouched at the end of the spec, as `qa.spec.js` does.
- **Travel is teleport plus clock.** Riding around rivers cannot be scripted
  reliably (the 2026-09-02 playtest hero sat 14 s against a bank). For each
  leg: set `world.hero.x/y` to the destination offset by 100 px, set
  `world.grace = 0`, then tick `distance / HERO.speed` seconds with
  `window.game.keepAwake(true)` so spawns, raids, party moods and the raid
  timer advance as they would on a real ride. Record this as the harness's
  known blind spot: parties that would have intercepted the ride do not.
- **A modal resolver runs after every tick.** `world.screen.kind`:
  `'spec'`/`'perk'` — wait `CHOICE_ARM_T` then confirm the first option;
  `'brief'` — apply the policy's fight rule (below); `'aftermath'` — confirm.
  Any unhandled kind throws. Never `continue` past a modal.
- **Battles go through the production entry** with every edge asserted, copied
  from `raidSweep`: site-menu row Enter → brief Enter → wait `deploy` and arm
  ~0.5 s → Enter → assert `state === 'fight'` → `issueCommand` per policy →
  tick to `end` or 95 s. Two resolve modes: `real` (the default; the number
  that matters) and `forced` (`endBattle(battle, true)` after the deploy
  confirm, for economy-only runs and the smoke test — the pattern
  `scripts/zz-economy-probe.mjs` already uses).
- Orders are `chargeAll` unless the policy says otherwise; the hero never
  swings (the harness cannot script hero input — Plan 035's stated limit).
- Stop a run at victory (`save.won`), at a wall of 3600 flowing seconds, or
  after 60 battles. Record which.

### Policies (all scripted, all deterministic per seed)

| id | route | spend rule |
| --- | --- | --- |
| `claimRush` | claim the four settlements in nearest-first order, then storm Wolfsjaw | none |
| `campRaider` | scout+raid c1, c2, c3 in `tier` order, storm | fill the column with the cheapest body; expand when full and affordable |
| `captureThenRaze` | claim two, raze one, claim two, raze two, storm | as `campRaider` |
| `farmer` | before each objective, hunt the weakest live party if its ratio ≤ `oddsFavored`, up to 3 times | as `campRaider`, plus knights at the town |

The hunt in `farmer` teleports next to the party and rides one tick toward
it so `tryClash` fires, then resolves the brief through the same rule
(withdraw if offered and outmatched, otherwise fight).

### Per-run record

`seed, policy, outcome (won/wall/cap), playT, battles, wins, losses,
retreats, goldEarned, goldSpent, finalGold, finalWeight (myStrength at
storm), razed, captures, raidsLanded, raidsDefended, strongholdStateAtStorm,
storm.ratio, storm.won, floorFires (count of enforceBeatableFloor rewrites),
fights[]: {kind, ratio, won, durationT, lost}`.

Reproducibility check: the same seed and policy must produce a byte-identical
record on two consecutive runs before any number is written down.

### Baseline

Run all four policies over 12 seeds on the UNCHANGED tree and write
`critiques/campaign-arc-baseline.md` with the table and the three headline
numbers the audit only estimated: time-to-victory per policy, `storm.ratio`
per policy, and gold earned per fight by party composition. Slices B-D each
re-run the same command and append to `critiques/campaign-arc-comparison.md`.

## Slice B — price encounters off campaign stage

### The formula

One function in `src/world.js`, the only place a generator target is computed:

```
encounterBase() =
  stage  = BALANCE.encounterStage.base
         + BALANCE.encounterStage.perPoint * strongholdPoints(this.save)
  corr   = clamp( (myStrength() / stage) ^ BALANCE.encounterStage.alpha,
                  BALANCE.encounterStage.corrMin, BALANCE.encounterStage.corrMax )
  return stage * corr
```

With `alpha` in (0, 1) the realised ratio `enemy / mine` falls as the warband
outgrows the stage curve: `ratio = band * (mine/stage)^(alpha-1)`. At
`alpha = 0.4` a warband at twice the stage weight fights at 0.66 of the band;
one at half the stage weight fights at 1.5 of it, and the floor guarantee
still promises a beatable party. Starting values, to be moved only by
measurement: `base` = the fresh warband's weight (`playerStrength` of four
spearmen — compute it, do not type 4.6), `perPoint` so that stage 7 equals
the `late` roster in `scripts/zz-tier035-probe.mjs` (four spear, three
archer, two knight), `alpha 0.4`, `corrMin 0.6`, `corrMax 1.6`.

### Call sites that switch from `mine` to `encounterBase()`

- `spawnParty` target (`world.js:441`).
- `rollGarrison` target (`:551-553`): `max(size * campWeightPerSize,
  encounterBase() * tier * hardMul)`. Also quantise the garrison seed on
  `Math.round(encounterBase())` instead of `Math.round(mine)` so the frozen
  roll is a function of stage, which closes audit finding 12 (an early scout
  freezing every camp at starter weight) as a side effect. Say so in the
  comment.
- The regional raid (`:1170`), `mine * 1.1` → `encounterBase() * 1.1`.
- The stronghold reserve wave, `clamp(mine * 0.8, ...)` at
  `src/world/battle-transition.js:298`. Same substitution.
- Apply `hardMul` inside `encounterBase()` rather than only at the garrison,
  so HARD finally touches roaming parties and raids (audit finding 15). One
  multiplier, one place; record the before/after in the comparison file.

### Call sites that KEEP `myStrength()`

`enforceBeatableFloor` (`:487-512`) and `trimToBeatable`, `oddsWord()` and
both `oddsStronger`/`oddsFavored` consumers, party chase/flee thresholds
(`:776-777`), the brief's "yours N" line, the hover panel. Add a one-line
comment at `myStrength()` naming the two questions: "what can this player
beat" reads `myStrength()`, "how big is the next fight" reads
`encounterBase()`.

### `rollPartyBand`'s shift

Leave the weights as they are for the first measurement. The stage curve now
carries the rise; if `campRaider` at stage 6-7 measures more than 10 points
below its stage-0 win rate on the harness, flatten the shift (`wWeak` fixed
at 0.40) and re-measure. Decide by the number, not by argument.

### Tests that will break and how they should change

- `tests/qa_suite.js:822-880` (the tier record) asserts each spawned party's
  `strength / mine` lands inside a declared band. It must divide by
  `encounterBase()` instead; expose it on `World` as a method so the suite can
  read it. The one-body tolerance logic stays.
- `tests/qa_suite.js:1091-1096` (the floor) keeps dividing by `mine`; it is
  correct as written.
- `zz-tier035-probe.mjs` installs comps at an exact ratio of `mine` on
  purpose; it is unaffected, and `npm run test:balance` must still hold its
  sweep guard (`deliberate orders beat giving no order at all`) — that sweep
  installs a fixed roster and raids at the camp tier, so the garrison target
  moves. Run it before and after; if the guard flips, STOP and record why.
- `AGENTS.md` "Campaign lifecycle" and "Fighting weight (Plan 028)" both state
  that the bands multiply `myStrength()`. Rewrite those sentences; the
  `data.js` comment block above `partyTiers` (`:390-425`) likewise.

## Slice C — price the claim

- `BALANCE.claimCost = { village: 60, town: 100 }` (read `s.kind`). The site
  menu row becomes `Claim it for your banner — 60g`, `enabled: gold >= cost`,
  `disabledReason: 'Need 60 gold'`, matching `recruitRow`'s shape
  (`site-menu.js:55-64`). `claimSettlement` debits gold, adds to
  `stats.goldSpent`, and refuses when short.
- Grace: a claim does not extend raid grace. In `winSettlement`, apply
  `raidCdT = max(raidCdT, graceAfterCaptureT)` only when the call came from a
  battle (`onWinExtra`); `claimSettlement` passes `{ claimed: true }` and
  skips it. Rationale in the comment: grace is earned by winning a fight, not
  by riding past.
- `STRONGHOLD_POWER`: EXPOSED requires `points >= 4 && razedLinkedCamps >= 1`.
  Express it as a field (`exposedNeedsRazed: 1`), not a conditional, and
  update the comment at `src/region.js:137-140` which currently promises the
  opposite ("every supported seed reaches Exposed by capturing all four
  settlements even if no camp ever falls"). The beatable route that comment
  protects is now c1 at tier 0.7 priced off stage; the harness's `claimRush`
  and `captureThenRaze` rows are the evidence it still exists.
- Copy: the "Raid the camps to stop the raids" toasts
  (`battle-transition.js:160` area) stay true once EXPOSED needs a razed camp;
  leave them, but add the cost to the claim row's `detail`.
- Tests: `regional-campaign.spec.js:107-136` asserts `raidCdT >= graceAfterCaptureT`
  after a claim — invert it (claim leaves `raidCdT` unchanged) and add a
  capture-by-battle case that still gets grace. The two-claim tests at
  `:176` and `:218-225` start with 80 gold; give them `save.gold = 500` in the
  fixture. `region.spec.js`: add the EXPOSED gate case (4 captures, 0 razed →
  WEAKENED; 4 captures, 1 razed → EXPOSED) and the summary/label derivation.
  Save fixtures do not change: no new field.

## Slice D — wire loot to body type

- `export function lootFor(comp)` in `src/data.js`:
  `BALANCE.lootBase + sum(ENEMY_TYPES[type].gold)`. Delete `lootPerEnemy`.
- `endBattle` (`combat.js:135`): `battle.loot = lootFor(battle.setup.enemies)`.
  `setup.enemies` is the force that entered (`battle.js:55, 291`); keep paying
  for the whole force on any victory, as today, so a Hold-the-ground win with
  survivors is not penalised.
- Retune the four `gold` values so that gold per fighting weight is flat
  across bandit/raider/wolf and brute pays about 1.3x that rate. Compute the
  weights with `enemyStrength([type])` from `src/data.js` rather than by hand.
  The values were never tuned (they had no reader), so there is nothing to
  preserve except the campaign total: `campRaider`'s `goldEarned` per battle
  on the harness must land within ±15% of the slice-C figure, or scale all
  four together.
- Tests: `tests/qa_suite.js:98-99` binds `LOOT_BASE`/`LOOT_PER_ENEMY` and
  asserts the loot arithmetic somewhere below; replace with `lootFor`.
  `world-screens.spec.js:282-291` only checks `typeof loot`. The `farmer`
  policy row in the comparison file is the proof the wolf farm closed: gold
  per fight for a wolf-heavy party must drop, brute-heavy must rise.

## Files to modify

| File | Slice |
| --- | --- |
| `tests/e2e/campaign-harness.js`, `tests/e2e/campaign-arc.spec.js` | A |
| `scripts/zz-campaign-probe.mjs` | A |
| `critiques/campaign-arc-baseline.md`, `critiques/campaign-arc-comparison.md` | A-D |
| `src/world.js` (`encounterBase`, `spawnParty`, `rollGarrison`, raid dispatch, `winSettlement`, `claimSettlement`) | B, C |
| `src/world/battle-transition.js` (reserve wave, grace call) | B, C |
| `src/data.js` (`BALANCE.encounterStage`, `claimCost`, `lootFor`, comment blocks) | B, C, D |
| `src/region.js` (`STRONGHOLD_POWER`, comment) | C |
| `src/world/site-menu.js` (claim row) | C |
| `src/battle/combat.js` (`endBattle`) | D |
| `tests/qa_suite.js`, `tests/e2e/regional-campaign.spec.js`, `tests/e2e/region.spec.js` | B, C, D |
| `AGENTS.md`, `SCOPE.md`, `tests/README.md`, `plans/README.md`, `progress.md` | all |

## Acceptance criteria

Structural, asserted by `campaign-arc.spec.js` under `@sweep`:

1. Same seed and policy → byte-identical record across two runs.
2. `claimRush` cannot reach `strongholdStateAtStorm === 'exposed'` (needs a
   razed camp) and pays at least `3 * claimCost.village + claimCost.town`
   gold, so it cannot complete on `startGold` without at least one fight.
3. `campRaider`'s `storm.ratio` is LOWER than `claimRush`'s on every seed:
   a warband that fought and spent arrives at Wolfsjaw with better odds than
   one that did not. This is the sentence "gold buys something" as a test.
4. Gold per fight for the `farmer` policy's wolf-heavy hunts is within 25% of
   its bandit-heavy hunts (flat gold per weight).
5. `npm run test:balance`'s existing sweep guard still passes.

Recorded, not asserted (the numbers go in the comparison file with the
seeds and the command line): time-to-victory per policy before and after
each slice; win rate at storm per policy; `floorFires` per run; HARD vs
normal for `campRaider` after slice B.

Gates: `npm test` green (the smoke test included), `npm run test:balance`,
`npm run test:perf` after the `world.js` edits (the tick pipeline is
touched), `npm run release:cache` then `npm run test:release`.

## STOP conditions

- The harness cannot make two runs of one seed agree. Fix determinism before
  measuring anything; do not average over a non-deterministic run.
- After slice B, `campRaider`'s win rate on c1 at stage 0 with the fresh
  roster falls below 60%, or the existing sweep guard flips. Record, revert
  the constant, re-measure; do not move a band to compensate.
- After slice C, no policy reaches Wolfsjaw inside the 3600 s wall on more
  than 2 of 12 seeds. The claim price or the EXPOSED gate is then too steep
  for the current raid cadence; halve `claimCost` first, and if that is not
  enough the gate is the culprit and the slice is BLOCKED pending a design
  call, not silently softened.
- Any step needs a new persisted field. None is anticipated; if one appears,
  stop and re-plan with a v6 migration rather than smuggling it in.

## What NOT to do

- Do not touch `BALANCE.partyTiers`, `beatablePartyRatio`,
  `POWER_EFFICIENCY`, `HERO_POWER`, `WORLD.camps[].tier` or the unit tables.
  Each invalidates a measurement from Plans 028/029/035 and none is the
  defect here.
- Do not weaken `deliberate orders beat giving no order at all`
  (`stance-balance.spec.js`, `@sweep`). It is a hard guard.
- Do not make `myStrength()` read stage. It answers a different question.
- Do not script the hero's sword in the harness. The bands price the sword
  (Plan 035); a scripted swing would be an invented player.
- Do not fold finding 4's fix (keep parties spawning after all camps fall)
  into this plan. Measure it first with the harness this plan builds; it is
  the natural Plan 038.
- Do not `skip` or `fixme`. An expected failure carries `test.fail` and a
  reference to this plan.

## Out of scope, recorded for the next plans

- `partyCap()` reaching 0 after three razes empties the map (audit finding 4).
- The wipe death spiral: 25 gold floor and two volunteers against a floor
  fight the data table calls a 27.9% win (finding 5).
- Coldwell's permanent free heal makes `healCost` and the Market's heal
  discount dead (finding 8).
- WEAKENED changes nothing on its own; EXPOSED thins by body count and keeps
  65-78% of weight (finding 9).
- `rollGarrison` skips `encounterWeightClamp` (finding 10), one `clamp()`.
- The 130 vs 260 px settlement sanctuary mismatch already on record in
  `plans/036-initiative-reads-who-closed.md`.

## Effort

A: M. B: M-L (the formula is small; the test rewrites and the two sweeps are
the cost). C: M. D: S. Sequential, one PR per slice, each with its
comparison-file entry.
