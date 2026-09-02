# Campaign arc — before and after (Plan 037)

Companion to `critiques/campaign-arc-baseline.md`, which records the untouched tree at
`5bcd88c` and the three headline numbers the audit could only estimate. This file records
what slices B, C and D moved, plus one fix outside the plan's original scope — bounding
the remnant absorption at Wolfsjaw — which was added only after measurement showed nothing
inside the scope could deliver acceptance criterion 3.

**The headline: the campaign's dominant strategy inverted.** On the untouched tree the
only policy that ever won a run was `claimRush`, the one that never fights until the storm
(2 of 12). It now wins none, and `campRaider` — which fights every camp and spends what it
earns — went from 0 of 12 to **4 of 12**, with `captureThenRaze` also at 4.

Command, reproducible verbatim, run once per column:

```bash
python scripts/serve.py &
node scripts/zz-campaign-probe.mjs --seeds 12 --workers 3 --label baseline2   # src/ stashed
node scripts/zz-campaign-probe.mjs --seeds 12 --workers 3 --label final
```

12 seeds (`1..12`) x four scripted policies = 48 campaigns per column. Raw records in
`scripts/zz-campaign-baseline2.json` and `scripts/zz-campaign-final.json`.

**Both columns were measured with the SAME policy definitions.** The heal rule was
changed during the work — a policy that healed only the hero rode half-dead columns into
fights, and `playerStrength` prices bodies at full health, so the recorded ratio was
flattering a warband that was not there. The baseline was therefore re-run with `src/`
stashed rather than compared against the first draft's numbers; the original
policy-v1 baseline is kept in `scripts/zz-campaign-baseline.json` and quoted in
`campaign-arc-baseline.md`, and the two are not interchangeable.

## Per policy, before -> after

| policy | won the run | campaign s | battles | battle win % | gold / battle | weight at the hold | storm ratio | stronghold state at the storm |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claimRush` | **2 -> 0** | 54 -> 52 | 1.0 -> 1.0 | 17 -> 0 | 45 -> 0 | 12.6 -> **6.6** | 1.04 -> **1.36** | 12 EXPOSED -> **12 ENTRENCHED** |
| `campRaider` | **0 -> 4** | 246 -> **155** | 6.1 -> 4.7 | 33 -> **73** | 25 -> 87 | 4.3 -> **12.9** | 2.29 -> **1.27** | 11 WEAKENED, 1 ENTRENCHED |
| `captureThenRaze` | **1 -> 4** | 252 -> 213 | 5.0 -> 5.0 | 34 -> **60** | 38 -> 78 | 6.6 -> **8.7** | 1.99 -> **1.67** | 8 EXPOSED, 2 WEAKENED, 2 ENTRENCHED |
| `farmer` | 0 -> 1 | 364 -> 368 | 10.7 -> 10.3 | 38 -> 39 | 17 -> 18 | 4.1 -> 4.3 | 2.20 -> 2.28 | 8 ENTRENCHED, 4 WEAKENED |

`gold / battle` is `goldEarned / battles` and it moved for a reason that is not the loot
rule: `campRaider` now reaches and wins the stronghold, which pays a 200 g razing bonus.
What the loot RULE did in isolation is measured further down.

The two things the plan set out to change both moved, and both moved a long way:

* **Fighting now pays.** `campRaider` wins more than twice as many of its battles (33% ->
  73%), finishes the route in two thirds the time, and reaches Wolfsjaw at three times the
  fighting weight (4.3 -> 12.9) and at a storm ratio of 1.27 rather than 2.29. Under the
  old rule it arrived at the hold *weaker than it started* and never won a campaign; it now
  arrives at roughly the late-game roster and wins a third of them.
* `farmer` is the policy that did NOT improve, and it is worth saying so: hunting
  favourable roaming parties before every objective still leaves it at weight 4.3 and a
  39% battle win rate, against 38% before. Farming weak parties was never the problem the plan set out to fix,
  and pricing encounters off stage does not make it a route — it just stops paying
  disproportionately well per unit of fighting weight (see criterion 4).
* **Riding past is no longer free.** `claimRush` can afford exactly one claim out of
  `startGold` (60 of 80, `claimsRefused` 3.0 per run), so it reaches the hold ENTRENCHED
  on 12 of 12 seeds instead of EXPOSED on 12 of 12, at fighting weight 6.6 instead of
  12.6, and it stops winning campaigns altogether.

## The acceptance criteria

| # | criterion | result |
| --- | --- | --- |
| 1 | same seed + policy -> byte-identical record | **holds** — asserted every sweep |
| 2 | `claimRush` cannot reach EXPOSED, and four claims cost more than `startGold` | **holds** — 280 g against 80 g; 12/12 ENTRENCHED |
| 3 | `campRaider` storms at a lower ratio than `claimRush` on every seed | **9 / 12** — the three failures are the wipe death spiral, see below |
| 4 | gold per fight no longer depends on body type | **holds**, and the stronger property below holds too |
| 5 | the existing `@sweep` guard still passes | **holds** — chargeAll 100% against idle 94% |

### Criterion 4, and why the plan's version of it was too weak

Roaming fights, pooled across all four policies, a "-heavy" fight being one where a
majority of the bodies are that type:

| majority body | gold per fight (before -> after) | gold per unit of fighting weight (before -> after) |
| --- | --- | --- |
| wolf | 27.9 -> 26.2 | **12.36 -> 8.21** |
| bandit | 27.1 -> 22.9 | 9.71 -> 8.41 |
| raider | 28.6 -> 18.7 | 8.87 -> 8.45 |
| brute | 15.0 -> 31.0 | **4.89 -> 10.11** |

Gold per FIGHT was already flat before the change (27.9 against 27.1), because parties are
generated to a weight target — a wolf-heavy party simply has more bodies, and a per-body
rule pays the same total. The criterion as written would have passed on the untouched
tree. The real defect was gold per unit of fighting weight, which spanned **2.53x** and
paid most for the cheapest thing on the map; it now spans **1.23x**, and the three light
bodies land within 3% of each other (8.21 / 8.41 / 8.45). `campaign-arc.spec.js` asserts
both, and says in the test why the plan's own version is the weaker one.

`BALANCE.lootBase` was halved from 10 to 5 as part of this. Paying per body type on its
own raised campaign income 25% over the flat rule — past the +/-15% the plan allowed a
loot change to move the economy by — because the brute went from 5 gold to 26 and camp
garrisons are where the brutes are. The plan's suggested remedy, scaling the four per-type
values down together, cannot be done at integer granularity without wrecking the flat rate
they exist to hold (4 / 4 / 2 spans 30%). Cutting the body-BLIND term instead leaves every
per-type rate exactly where it was tuned.

What the loot RULE did, isolated by re-scoring every won fight in the final column under
both formulas (so the comparison is the same fights, not the same aggregate):

| policy | ordinary fights | camp raids | roaming fights | including the storm |
| --- | --- | --- | --- | --- |
| `campRaider` | **+13.2%** | +18.2% | -11.2% | +17.9% |
| `captureThenRaze` | **+12.3%** | +16.1% | -8.9% | +21.7% |
| `farmer` | -5.5% | -5.5% | -5.6% | -4.0% |

The plan's +/-15% is met on every fight that exists in both columns. The excess in the last
column is entirely the stronghold assaults `campRaider` now WINS — four of them, against a
brute-heavy garrison, on runs that previously ended in defeat. There is no "before" figure
for a fight that did not happen, so including it measures a campaign that got further
rather than a loot rate that changed. Roaming fights pay slightly LESS than they did, which
is the wolf farm closing.

### Criterion 3 — 9 of 12, and the fix that got it there

The first measurement of the finished slices A-D put this at **2 of 12**, and the cause was
not the pricing the plan changed. It was `campVictoryExtra` in
`src/world/settlement-interactions.js`: **razing the LAST linked camp absorbed every
surviving roaming party into Wolfsjaw's garrison** ("bandit remnants withdraw into Wolfsjaw
and man its walls") and then deleted them from the map. That force bypassed
`encounterBase()` entirely, was additive without bound, and was worth more than everything
a warband gained by fighting.

Seed 3 was the clean demonstration, because nothing went wrong on it: `campRaider` reached
the hold at fighting weight **17.4** against `claimRush`'s **6.6** — two and a half times
stronger — and still stormed at a WORSE ratio (1.42 against 1.33). Its garrison target was
15.5 by the stage curve; the remnants topped it up to a measured **24.8**.

The absorption is now bounded by `BALANCE.strongholdRemnantCeiling` (1.25), computed from
the same `max(size * campWeightPerSize, encounterBase() * tier)` expression `rollGarrison`
targets. Two rules keep it honest: it bounds what may be ADDED and never trims a garrison
the player already scouted (`rollGarrison`'s own house rule), and the bands the walls have
no room for **stay on the March** instead of being deleted — the old rule emptied the map
at the exact moment the campaign asked the player to go and win it.

Measured effect on the same 12 seeds, everything else identical:

| seeds | before the ceiling | after |
| --- | --- | --- |
| 3 razed camps (3, 4, 5, 8, 9, 10, 11) | 1.42, 2.88, 1.70, 1.98, 2.33, 2.20, 2.01 | **0.69, 0.68, 0.98, 0.77, 1.00, 0.92, 0.81** |
| 2 razed camps (1, 2, 6, 7) | 2.00, 1.46, 1.11, 1.31 | unchanged (no absorption happens) |
| 0 razed (12) | 3.48 | unchanged |

Criterion 3 goes from 2/12 to **9/12**, and `campRaider` goes from winning 0 campaigns to
4. The game's own toast ("Raid the camps to stop the raids") finally points at the route
that ends in the *easiest* final fight rather than the hardest.

One number puts the whole slice in perspective: on the untouched tree, across all 48
campaigns, **no run ever razed all three linked camps**. Fighting cost more than it paid,
so no policy got that far. On the final tree 13 of 48 do.

**The three remaining failures are a different finding, and it is one this plan lists as
out of scope: the wipe death spiral (audit finding 5).** Seeds 1, 2 and 12 are runs where
`campRaider` lost a fight that cost it ten to twelve men, landed on the 25-gold defeat
floor, and never rebuilt — all three end the run at exactly 25 gold, at fighting weight
4.6, 6.6 and 2.5 against `claimRush`'s steady 6.6. Seed 12 lost its very first roaming
fight and razed nothing at all. A warband that fought and LOST does not arrive at Wolfsjaw
stronger, and no encounter pricing can make it so; what is missing is a recovery path. The
assertion stays open with `test.fail()` per the repository's rule that an expected failure
is annotated and never skipped, and it is the head of Plan 038.

## Slice B in isolation, and one side effect worth recording

Slice B alone (stage-priced encounters, measured before slices C and D:
`scripts/zz-campaign-sliceB.json`) moved `campRaider`'s battle win rate 29% -> 55% and its
first camp raid — c1 at stage 0 with a fresh warband — to a **92%** win rate over 12 seeds
at a mean ratio of 0.55. The plan's STOP condition for this slice was a first-raid win
rate below 60%; it is comfortably clear.

**The existing `@sweep` guard did not flip, but its fixture became much easier.** Measured
on `tests/e2e/stance-balance.spec.js`'s 360-raid sweep after slice B:

| policy | before | after |
| --- | --- | --- |
| idle | 49 | **94** |
| chargeAll | 60 | **100** |
| split | 34 | 92 |

The guard's property (the best deliberate policy beats pressing nothing) still holds and
by a clear margin, so nothing was weakened. But the reason for the jump is structural and
should be recorded before someone reads those numbers as a balance change: that fixture
installs a near-capped roster (4 spear, 3 archer, 2 knight) into a **stage-0** campaign —
nothing held, nothing razed — which under the stage curve is by construction the easiest
fight the game can produce. `encounterBase()` returns 6.85 there where `myStrength()` is
12.6, so the garrison target is nearly halved. The fixture now has very little headroom
left in which to detect a regression. Re-basing it on a stage that matches its roster is
a Plan 038 item; changing it here would have changed what the guard measures in the same
commit that changed the thing it guards.

## HARD, which now touches more than camps

`hardEncounterMul` (1.25) was a literal inside `rollGarrison`, so HARD scaled camp
garrisons and nothing else — not roaming parties, not regional raids, not the stronghold's
reserve wave (audit finding 15). It now applies once, inside `encounterBase()`. Not
separately swept; the change is one multiplier in one place and the harness runs normal
difficulty.

## Recorded, not asserted

* `floorFires` (times `enforceBeatableFloor` actually rewrote the map): 0.0 -> 0.0
  `claimRush`, 0.7 -> 0.2 `campRaider`, 1.1 -> 0.5 `captureThenRaze`, 1.6 -> 1.4 `farmer`.
  The emergency correction fires roughly half as often, which is what a generator that
  stops chasing the warband should do.
* The remnant ceiling is covered by its own regression test in
  `tests/e2e/regional-campaign.spec.js` ("razing the last camp reinforces Wolfsjaw within
  its stage-priced ceiling"), driven through the production raid path against a
  deliberately overstacked fixture — six bands against a hold with room for four — so both
  halves are asserted: the hold IS reinforced, and never past its ceiling, and the bands it
  cannot take are still on the map afterwards.
* `raidsLanded` is still **0 across all 48 runs**, on both columns. Removing the claim's
  grace extension was not enough on its own: `RAID.firstDelayT` is 110 flowing seconds and
  `claimRush` finishes the whole campaign in 52. The regional-pressure mechanic remains
  effectively dead for every route this harness measures, and the harness's own blind spot
  (travel is teleport-plus-clock, so nothing intercepts a ride) is not the cause — the
  raid timer runs on the same flowing clock the legs pay.
* No policy reaches the wall or the battle cap on any seed, so Plan 037's slice-C STOP
  condition (fewer than 10 of 12 seeds reaching Wolfsjaw) is not triggered: every run
  reaches the hold.
* `unresolved` 95 s windows are resolved as a disengage and counted separately rather than
  scored as an invented defeat; see the harness header.
