# Encounter power rebase: before and after (plans/028)

Baseline in `critiques/encounter-power-baseline.md`, measured on `b9ed84b` before any
`src/` edit. Everything below is measured with the hero completely idle — he never swings —
on pinned seeds, a fixed 1/60 timestep, a 1280x720 canvas, the cursor pinned to centre and
camera shake cleared. Raw rows are in `scripts/zz-*.json`.

**Headline, stated honestly: the generator's `even` band is now calibrated and consistent,
but the audit's own headline number was measuring something else.** The fight the phase-4
audit and Plan 027 both called "the standard roaming encounter" is a 0.57 power ratio — a
WEAK-tier fight by the new metric and by the old one alike (headcount 7 against 12). It was
never an even fight, and rebasing the generator does not change a hardcoded fixture. The
places the generator actually decides — the tier bands, the camp ladder, the floor — did
move, and the biggest movement is not in the average but in the variance.

## 1. The metric

`sqrt(total dps x total hit points)`, normalised so one spearman is 1.0, with an enemy's
cadence read as `cooldown + windup` and one fitted efficiency multiplier per body type. The
hero enters as `HERO.hp` hit points and no damage at all.

Fitted against two independently generated measurement sets:

| set | what it is | battles |
|---|---|---|
| `zz-power-grid.json` | hand-built enemy ladders, mostly one type deep, 8 player rosters | 1776 |
| `zz-power-rolled.json` | compositions from the SHIPPED roller on the shipped `compRolls`, 6 rosters | 768 |

The ladders are what separate one body's worth from another's — a grid of mixes cannot tell
a wolf from a raider. The rolled set is the distribution the generator actually produces, so
it is what decides where the 50% crossing lands. Rolled rows are up-weighted 4x in the fit
(`scripts/zz-power-fit3.mjs`); the logistic intercept is pinned at zero, so a ratio of 1.00
is a measured coin flip by construction rather than by later calibration.

| | headcount (shipped, at its own best crossing) | fitted fighting weight |
|---|---|---|
| decisive matchups called correctly, pooled | 84.7% (1978/2334) | **89.0% (2077/2334)** |
| ...on the hand-built ladders | 87.7% | **93.9%** |
| ...on rolled compositions | 78.6% | 79.0% |
| fitted on half the rosters, scored on the other half (ladders) | 87.0% | **93.9%** |

**The accuracy gain on rolled compositions is nil, and that is worth saying plainly.** Both
metrics sit near the ceiling there (~80%, because the rolled bands cluster around the
crossing where outcomes are genuinely random). The metric's value is not that it classifies
the average mix better. It is that it means the SAME THING for every mix:

| ratio at which the player's win rate crosses 50%, over the 45 roster-vs-enemy-family combinations in the ladder grid | min | p25 | median | p75 | max |
|---|---|---|---|---|---|
| headcount | 0.30 | 0.61 | 0.85 | 1.04 | 1.37 |
| fighting weight | 0.50 | 0.79 | **0.94** | 1.06 | 1.72 |

Headcount is not merely miscalibrated; it is miscalibrated by a different amount depending
on what the party is made of, which is why no single band could be honest for all of them.

### What a body is worth

| body | headcount said | measured (spearman = 1.0) | error |
|---|---|---|---|
| spearman | 1 | 1.00 | — |
| archer | 1 | 0.79 | overrated 27% |
| knight | 2 | 2.01 | correct |
| bandit | 1 | 0.80 | overrated 25% |
| raider | 1 | 0.89 | overrated 12% |
| wolf | 1 | 0.52 | **overrated 92%** |
| brute | 5 | 3.19 | **overrated 57%** |
| the hero, idle | 3 | ~0.5 marginal (120 hp, no damage) | **overrated ~6x** |

Where headcount and the measurement disagree most:

1. **The hero.** Three points out of a starting warband's seven — 43% of the number the
   generator scaled everything to — for a body that, when the player gives no orders and
   never swings, contributes 120 hit points and nothing else. This is the single largest
   error, and it is the one that made the same declared tier mean different things at
   different points in a run: the hero is 43% of a fresh warband's old strength and 21% of
   a late one's.
2. **The brute at 5 points.** Worth 3.19. A garrison rolled with two brutes was a third
   weaker than its badge claimed.
3. **The wolf at 1 point.** Worth 0.52. Overkill damage is wasted on 55 hit points, which
   the square law does not model on its own.

Two corrections went the other way and were surprises. **A raider is worth 1.65x its raw
damage-times-durability figure** — it shoots at 210 and keeps away at 150, so much of its
output lands before anything can answer. And **a brute is worth 1.90x its raw figure** even
while being worth far less than 5 points; 420 hit points that must be ground all the way
down are worth more than the square law's own arithmetic says.

**One fit disagreement is documented rather than averaged away.** The archer fits at 0.86
against the hand-built ladders and 1.30 against rolled mixes. That is not noise: a PURE wolf
pack sends every one of its bodies at `nearestFriendlyRanged` and eats the whole bow line,
which is a real mechanic but not a situation the generator produces. A rolled composition is
about a fifth wolves. 1.30 is the value that describes the fights the game serves, so it is
the one that ships, and the ladder value is recorded here so the next person does not
"correct" it.

## 2. Tier calibration — the number this plan was asked for

Both rows measured on the same harness, same rosters (a fresh 4-spear warband, a mid
8-troop one, a late 9-troop one), same seeds; the BEFORE row runs the pre-028 generator
reconstructed verbatim (`scripts/zz-tier-before.mjs`), the AFTER row runs the shipped one
(`scripts/zz-tier-calibrate.mjs`).

| tier | pre-028 idle win | post-028 idle win | pre-028 real power ratio | post-028 real power ratio |
|---|---|---|---|---|
| weak | 84.7% (216 runs) | 85.2% (216 runs) | 0.40 – 0.82 | 0.53 – 0.81 |
| **even** | **58.9% (360 runs)** | **49.1% (216 runs)** | **0.73 – 1.29** | **0.99 – 1.17** |
| strong | 0.0% (216 runs) | 0.0% (144 runs) | 1.39 – 2.40 | 1.48 – 1.70 |

**`even` is now 49.1%, inside the 40-60% target, and the band it delivers is 0.99-1.17
instead of 0.73-1.29.** The average was never the worst of it. Per roster, the old `even`
band produced this:

| old band | fresh warband | mid warband | late warband |
|---|---|---|---|
| 0.8 | 0.96 ratio, idle wins 62.5% | 0.83, 87.5% | 0.73, 79.2% |
| 1.0 | 1.12 ratio, idle wins 45.8% | 0.98, 66.7% | 0.93, 66.7% |
| 1.2 | **1.29 ratio, idle wins 0%** | 1.14, 58.3% | 1.13, 41.7% |

A starting warband that drew the top of the "even" band got a 1.29-power fight and lost it
every time, while a mid-campaign warband drew 1.14 from the same band and won it more often
than not. That is the defect, and it is a direct consequence of the hero counting three
points: he is a much larger share of a small warband's declared strength than of a large
one's, so the same multiplier produced a much harder fight early. The new band spans 0.18 of
ratio across all three rosters instead of 0.56.

The same fix removed a second, smaller bias inside the roller. `rollComposition` used to
stop on the overshoot, which is a systematic error whose size depends on the warband: one
bandit is 7% of a late warband's weight and 18% of a starting one's. It now stops on
whichever side of the target is closer. Before that change a fresh warband drawing a 1.10
band got a 1.20 fight; it now gets 1.08.

## 3. Sweep fixtures — before and after

Same harness as Plan 027 (`scripts/zz-enemy-command-sweep.mjs`), unchanged.

### Fixture A — hardcoded roaming party (24 seeds)

8 troops (4 spear / 3 archer / 1 knight) vs a FIXED 3 bandit / 2 raider / 2 wolf.

| policy | win % before -> after | avg lost | avg seconds |
|---|---|---|---|
| idle | 95.8 -> **95.8** | 1.58 -> 1.58 | 41.9 -> 41.9 |
| chargeAll | 100 -> 100 | 0.29 | 18.9 |
| split | 100 -> 100 | 0.42 | 22.0 |
| holdLine | 83.3 -> 83.3 | 1.21 | 51.1 |

**Byte-identical, and that is the correct result.** This fixture's composition is written
into the harness; the generator never touches it. Its 95.8% is not evidence about the
generator, and Plan 027's retrospective (and this plan's own brief) treating it as "the even
roaming fixture" was the error: measured, it is a **0.57** power ratio — the middle of the
WEAK band — and headcount agreed, calling it 7 against 12. An idle hero is supposed to win
that fight. Fixture A′ below is what this plan actually changes.

### Fixture A′ — a roaming party the generator drew at `even`

This is the row Fixture A cannot provide. From the calibration above, pooled over the three
rosters and 216 fights: **idle 58.9% -> 49.1%**, and the spread of what "even" means
narrowed from 0.73-1.29 to 0.99-1.17.

### Fixture B — organic camp raids (40 world seeds x 3 camps = 120 raids per policy)

| policy | win % before -> after | avg lost | avg seconds | unresolved |
|---|---|---|---|---|
| **idle** | 77.5 -> **70.8** | 3.80 -> 4.50 | 47.8 -> 49.5 | 12 -> 14 |
| chargeAll | 77.5 -> 68.3 | 4.68 -> 5.14 | 35.6 -> 41.2 | 1 -> 8 |
| split | 47.5 -> 36.7 | 6.33 -> 7.08 | 58.5 -> 57.6 | 20 -> 16 |
| holdLine | 53.3 -> 35.0 | 5.98 -> 6.53 | 60.6 -> 62.6 | 28 -> 32 |

Camps moved by 6.7 points and no more, which is the second thing worth saying plainly:
**the camp ladder was already close to honest.** `WORLD.camps[].tier` is 0.7 / 0.9 / 1.1, and
against the 9-troop harness warband the pre-028 generator delivered real power ratios of
about 0.66 / 0.89 / 1.06 for those three. It now delivers 0.70 / 0.90 / 1.10. The residual
movement comes from the archer revaluation raising the player's own weight, not from the
tiers being rewritten. Camps were never where the generator lied; a fresh warband's roaming
encounters were.

## 4. Orders versus idle — the `@sweep` annotation

**Not flipped. Measured against, not tied.**

Resolved at three times the fixture's own sample size, 360 raids per policy
(`scripts/zz-orders-wide.mjs`, raw in `scripts/zz-orders-wide.json`):

| policy | win % | standard error | avg lost | avg seconds | unresolved |
|---|---|---|---|---|---|
| **idle** | **71.7** | +/- 2.4 | 4.36 | 49.4 | 41 |
| chargeAll | 66.4 | +/- 2.5 | 5.16 | 40.0 | 20 |
| holdLine | 36.4 | +/- 2.5 | 6.47 | 63.7 | 106 |
| split | 35.6 | +/- 2.5 | 6.93 | 58.2 | 57 |

Paired seed by seed and camp by camp, which removes the fixture variance entirely:

| policy vs idle | policy won, idle lost | idle won, policy lost | margin | SE |
|---|---|---|---|---|
| chargeAll | 40 | 59 | **-5.3 points** | +/- 2.8 |
| split | 12 | 142 | -36.1 points | +/- 3.4 |
| holdLine | 8 | 135 | -35.3 points | +/- 3.3 |

Plan 019 measured -10 points, Plan 027 closed it to a 0.0 tie, and Plan 028 has it at -5.3
with a standard error of 2.8. That is a loss, not a tie and not noise. `test.fail()` stays
and now records this number. A smaller-sample draw of the same fixture (the spec's own 120
raids) landed at -2.5 and an earlier intermediate build at +3.0, which is exactly the
sampling behaviour that made the 360-raid run necessary.

**Why commanding still loses is unchanged from Plan 027's diagnosis and is now visible in
one column: `unresolved`.** Idle leaves 41 raids of 360 unfinished inside the harness's 95s
budget; chargeAll leaves 20 and finishes 9 seconds faster. Charging trades a real damage
penalty (`CHARGE_EXPOSURE`, 1.35x) for tempo, and the warband on `follow` does not need the
tempo. Harder encounters did not change that trade — they made it worse, because the penalty
scales with the incoming damage.

## 5. The campaign consequence

A fresh campaign, 20 seeds (`scripts/zz-tier-cal3.json`):

| | weak | even | strong | min ratio | max ratio |
|---|---|---|---|---|---|
| parties already on the map at start (n=88) | 33 | 27 | 28 | 0.49 | 1.81 |
| the next twelve spawn-timer draws (n=240) | 100 | 87 | 53 | 0.47 | 1.88 |

- **0 of 20 seeds open with nothing at or under the beatable ratio.** The structural half of
  the deadlock guarantee never has to fire at campaign start.
- A starting warband sees a genuine foothold: at the weak tier an idle hero wins 85% and
  loses well under one man. Camp c1's authored 0.7 tier is inside that band.
- The strong tier is a real problem and is meant to be: idle wins 0% of 144 of them, and the
  hero is 240 px/s faster than any pursuit, so avoiding one is always available and Plan
  020's break-off-and-raid is the price for doing so.

## 6. The deadlock guarantees

`isSettlementClaimed()` uses no strength metric at all and needed no change: it is the
structural half of the guarantee (a break-off is refused unless two settlements are
unclaimed), and it is a count of occupiers, not a comparison of forces.

`enforceBeatableFloor()` did need a real fix, and it was a genuine defect introduced by the
rebase rather than a test artefact. `rollComposition` fills until the target weight is
CROSSED, so a comp aimed anywhere inside the `even` band could land one body above
`beatablePartyRatio` and leave the campaign with nothing beatable on the map — the exact
deadlock the floor exists to prevent. `World.trimToBeatable()` pops bodies off the end until
the party is provably at or under the ratio, never below one body, and consumes no `simRng`
draws so it cannot perturb the campaign stream. The worst-case QA record
(`world_floor_guarantee_prevents_unwinnable_deadlock`) caught it and passes on the fix.

## 7. What is still wrong with the metric

Recorded so the next person does not rediscover it:

- **Mixed forces containing brutes still cross about 20% high** on the ladder grid — the
  model treats a brute's hit points as fully usable, and in a mix the light bodies die first
  and leave the brute alone. A linear per-body table cannot express that interaction.
- **A roster with no melee line is its worst case.** Six archers and nothing else is the
  roster the fit misses most often, in both directions. The game cannot produce that roster
  by accident, but a player can build it.
- **The multipliers are empirical and die with the unit tables.** Retuning `UNIT_TYPES`,
  `ENEMY_TYPES` or `HERO` invalidates them. The square law and the `cooldown + windup`
  cadence rule survive any retune; `POWER_EFFICIENCY` does not, and must be re-measured with
  both probes rather than hand-adjusted one entry at a time.
