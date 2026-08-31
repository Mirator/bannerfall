# Re-pricing the fight against a player who plays: the measured curve (plans/035)

Everything below is measured through the PRODUCTION battle entry — the site menu, the
pre-battle brief and the deployment confirm are all pressed, and every edge is asserted, so
no row can come from a scene that never started. Fixed 1/60 timestep, 1280x720 canvas,
cursor pinned to centre, camera shake cleared. The hero never swings in any row: the harness
cannot script hero input, which is why the BANDS are where an active player is priced and
the sword stays the player's margin over what the map showed him.

Instruments: `scripts/zz-tier035-probe.mjs` (ratio ladder, both encounter paths, four
policies) and `scripts/zz-camp035-curve.mjs` (the camp tier ladder on its own `tier` values).
Raw rows in `scripts/zz-party035a.json`, `zz-party035b.json`, `zz-party035c.json`,
`zz-scout2.json`, `zz-camp035-after.json`.

## 0. Why a new probe

Plan 028's probe (`scripts/zz-power-probe2.mjs`) measured the idle curve by reaching into
the scene: `b.state = 'fight'; b.deployT = 0`. That pre-dates Plan 033. The deployment phase
is now the thing that decides what "pressing nothing" even means — an idle player still
confirms a deployment, after which his placed line HOLDS instead of following — so a probe
that skips it measures a game that no longer ships. The new probe presses the confirm.

## 1. Two scoring conventions, and why both are reported

An unresolved 95-second window is not a win and not obviously a loss. The shipped sweep
(`tests/e2e/stance-balance.spec.js`) scores it as a loss: its `winPct` denominator is total
runs, not resolved runs. That convention is kept here as the primary one, with the honest
"who beat whom" rate reported beside it, because the two disagree by tens of points for one
policy and by nothing at all for another:

| party path, ratio 1.175, n = 330 each | closed only | stalls as losses | stall rate |
|---|---|---|---|
| idle (deployment confirm only) | 77.0% +/- 3.0 | 46.7% +/- 2.7 | 39% |
| chargeAll | 55.7% +/- 2.8 | 52.1% +/- 2.7 | 6% |

**An idle line fails to close 39% of roaming fights.** It is not winning those; nobody is.
The battlefield of a roaming fight is SAMPLED from wherever the hero stands, and on bridge
and forest ground a line that holds where it was placed is a line the enemy never reaches.
A charging line stalls 6% of the time, so its crossing barely moves between conventions —
which is exactly why the CHARGING crossing is the one this slice calibrates on.

## 2. The curve this slice is calibrated on

Roaming-party path, driven through a real party clash, three rosters
(4-body starting warband / 7-body mid / 9-body near-cap), six sampled battlefields rotated
by seed so both policies fight identical ground, 330 battles per cell.

| ratio | idle (all) | chargeAll (all) | holdLine (all) | chargeAll (closed) |
|---|---|---|---|---|
| 0.775 | 57.9 | **93.6** | — | 94.5 |
| 1.00 | 54.5 | **77.3** | 46.1 | 81.2 |
| 1.05 | 53.6 | **67.9** | 45.2 | 70.7 |
| 1.15 | 43.6 | **52.7** | 39.1 | 57.2 |
| 1.175 | 46.7 | **52.1** | — | 55.7 |
| 1.25 | 32.1 | **38.8** | 30.6 | 42.0 |
| 1.30 | 27.3 | 27.9 | 29.4 | 30.7 |
| 1.725 | 3.0 | 3.9 | — | 4.1 |

Two things follow, and only one of them was in the plan's premise.

**The premise holds: charging is the strongest simple input, everywhere the outcome is in
doubt.** It leads idle by 23 points at 1.00, 9 at 1.15 and 7 at 1.25, and by nothing at
1.30 where every policy has lost. This is the property the sweep guard asserts, measured on
a different path and at nearly three times the sweep's sample size.

**The old `even` band was a walkover.** It ran 0.95-1.20. At 1.00 a commanding player wins
77.3%; the top of the band, 1.20, interpolates to about 46%. The measured 50% crossing is at **ratio
1.18**, not at 1.00 as Plan 028's comment claimed — that comment was accurate for an idle
player before Plan 033 and has been false since.

## 3. What moved

The whole ladder moved up by 0.10. Every band width and every gap between bands is
unchanged: only its position moved, and no unit stat, efficiency multiplier or formula was
touched.

| knob | Plan 028 | Plan 035 | what it measures now (chargeAll, stalls as losses) |
|---|---|---|---|
| `partyTiers.weak` | 0.55-0.80 | 0.65-0.90 | 93.6% at the centre — a foothold, taken with orders |
| `partyTiers.even` | 0.95-1.20 | 1.05-1.30 | **52.1% +/- 2.7 at the centre** (55.7% closed) |
| `partyTiers.strong` | 1.40-1.85 | 1.50-1.95 | 3.9% at the centre — the tier the sword decides |
| `beatablePartyRatio` | 1.20 | 1.30 | 27.9% — pinned to the top of `even`, as designed |
| `oddsFavored` | 0.85 | 1.05 | below it: 77.3% at 1.00 |
| `oddsStronger` | 1.15 | 1.30 | above it: 27.9% and falling |

The odds words were the one knob with a choice in it. Plan 028 left them at 0.85/1.15 on the
explicit grounds that "a ratio of 1.0 is a measured coin flip, so 'an even fight' finally is
one". That premise is now false, so keeping the words would have the map call a 77% fight
"even" and a 53% fight "⚠ they outmatch you". They are set to the same interval as the even
tier band, which puts the measured coin flip (1.18) near the middle of the "even fight" band
instead of past its top, and makes the word and the generator's tier describe one fight.

## 4. What did NOT move, and the check that says it did not have to

`WORLD.camps[].tier` is a separate ladder and this slice leaves it alone. Plan 035 requires
proof it still spans winnable-to-punishing. Measured on its own tiers through the production
raid entry, 60 seeds per cell, `chargeAll`:

| camp | tier | realised ratio (fresh / late) | fresh | mid | late |
|---|---|---|---|---|---|
| c1 | 0.7 | 0.69 / 0.71 | 100% | 100% | 96.7% |
| c2 | 0.9 | 0.89 / 0.90 | 38.3% | 60.0% | 60.0% |
| c3 | 1.1 | 1.10 / 1.10 | 50.0% | 25.0% | 21.7% |
| Wolfsjaw Hold | 1.5 | 1.97 / 1.50 | 0% | 0% | 0% |

It spans. c1 is a free win at every roster, c2 and c3 are real fights, and the hold is 0%
without the hero swinging at all three rosters — which is what a stronghold assault gated
behind its own modifiers should be. The stronghold's realised ratio is also an
UNDERSTATEMENT: it is read off the starting force, and every one of the 60 stronghold runs
per cell carried one reserve wave on top of it. Three side notes worth recording rather than
fixing here:

* The curve is **not monotonic in tier for a starting warband** (c2 at 0.9 measures 38%,
  c3 at 1.1 measures 50%). Camp identity — arena, terrain, objective — moves the outcome
  more than 0.2 of ratio does. Camp raids are also uniformly HARDER than roaming fights at
  the same ratio (the camp chargeAll crossing sits near 0.93 against the roaming path's
  1.18), which is why `partyTiers` is calibrated on the roaming path it governs and not on
  the camp path.
* The stronghold's realised ratio for a fresh warband is 1.97, not 1.5, because
  `campWeightPerSize` (size 10 x 0.9 = 9.0) floors it above `mine x 1.5`. That is the floor
  doing its documented job.
* **The camp path does not reproduce the roaming path's clean charging dominance, and that
  is worth stating rather than glossing.** `idle` out-reads `chargeAll` at c3 for all three
  rosters (73 vs 50 fresh, 43 vs 25 mid, 50 vs 22 late) and at c2 for a starting warband
  (73 vs 38); `chargeAll` wins decisively at c2 for mid and late (60 vs 45 and 60 vs 10),
  which is exactly where idle's own stalls concentrate (17 of 60 idle runs at mid/c2, 15 at
  late/c2). Camp identity moves the outcome more than either the ratio or the policy does.
  This is why nothing in this slice tunes a camp knob from a policy comparison.

## 5. Effect on the shipped sweep

`deliberate orders beat giving no order at all` is a hard guard and had to keep holding. It
does — and its numbers did not move at all: idle 53 / chargeAll 60 / split 37, twice, digit
for digit against the baseline measured on the same machine before any `src/` edit. The plan
expected them to move because re-pricing changes garrison sizes. It does not: the sweep
measures CAMP raids, sized by `WORLD.camps[].tier`, and this slice changed only the
roaming-party generator. An unchanged sweep is therefore the evidence that the change is
confined to the path it was meant to touch, not a sign the change did nothing.

One property of that sweep is worth stating because it was not visible before this slice
replicated it exactly. On the baseline, over the fights that CLOSED, idle and chargeAll are
within noise (59.3% against 61.0%); the sweep's 7-point margin is almost entirely the
difference in how often each policy runs the clock out (12 idle stalls against 2). The guard
is measuring something real — a line that never closes is not a policy that wins — but it is
measuring stall avoidance more than it is measuring won fights.

## 6. Out of scope, found while measuring

World position **(1600, 900)** — the spot the `world_aftermath` test scenario uses — samples
a battlefield whose obstacle field contains six r=60 trees at x 1090-1170, y 730-940: a
solid wall directly across the engagement axis. Both lines freeze about 80px apart and
neither side ever closes. 3/3 seeds ran the full 95s window with every surviving enemy at
full hit points, bloodlust armed at 14s and nothing behind it. `STALL_NO_DEATH` arms
`bloodlust`, and `bloodlust` tells the enemy to close in — but nothing makes it able to.
This is a terrain/steering defect rather than a pricing one; the probe excludes that spot
and names it rather than working around it silently. The same mechanism is what produces
the 39% idle stall rate in section 1, so it is not a single unlucky coordinate.
