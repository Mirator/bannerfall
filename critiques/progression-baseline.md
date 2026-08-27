# Plan 029 baseline — measured on `7de3bb5` before any `src/` edit

`7de3bb5` is the Plan 028 encounter-power rebase. Everything below is a machine-measured run
on that tree, recorded so the after-numbers have something honest to be compared against.

Harnesses, all scratch (`zz-` prefixed, not in any gate):

- `scripts/zz-enemy-command-sweep.mjs --label prog-before` — 24 roaming fights and 120 camp
  raids per order policy, the Plan 027/028 sweep unchanged.
- `scripts/zz-brace-probe.mjs --label before` — new for this plan. 12 seeds on each of two
  fixtures, player melee squads on HOLD, sampling every enemy inside a holding melee troop's
  strike reach on every tick.
- `scripts/zz-tier-calibrate.mjs --label prog-before` — the Plan 028 tier honesty harness.

## 1. Order policies (`zz-sweep-prog-before.json`)

Roaming fixture, 24 seeds, idle hero unless the policy says otherwise:

| policy | win % | avg troops lost | avg seconds | avg hero hp | unresolved |
|---|---|---|---|---|---|
| idle | 95.8 | 1.58 | 41.9 | 101 | 1/24 |
| chargeAll | 100.0 | 0.29 | 18.9 | 119 | 0/24 |
| split | 100.0 | 0.42 | 22.0 | 118 | 0/24 |
| holdLine | 83.3 | 1.21 | 51.1 | 50 | 1/24 |

Organic camp raids, 40 seeds x 3 camps = 120 per policy:

| policy | win % | avg troops lost | avg seconds | avg hero hp | unresolved |
|---|---|---|---|---|---|
| idle | **70.8** | 4.50 | 49.5 | 91 | 14/120 |
| chargeAll | 68.3 | 5.14 | 41.2 | 88 | 8/120 |
| split | 36.7 | 7.08 | 57.6 | 46 | 16/120 |
| holdLine | **35.0** | 6.53 | 62.6 | 69 | 32/120 |

These reproduce Plan 028's reported figures (idle 70.8% on raids), so the sweep is a valid
control for this slice.

The number this plan is actually about is the last row. **Holding loses 36 points of win
rate against doing nothing** and leaves 32 of 120 fights unresolved. HOLD is not a
trade-off the player is choosing wrong; on the raid fixture it is close to a dead option.
Section 2 is why.

## 2. The brace bonus does not fire (`zz-brace-before.json`)

`BRACE_SPEED` is 120. `src/battle/constants.js` states that only a wolf (158) can cross it,
which was already the corrected form of a claim Plan 019 had to retract. Plan 027 then gave
the enemy a commander that sends bandits and brutes forward on its own timing, so the claim
needed re-measuring rather than re-reasoning.

Sampling every enemy inside a holding melee troop's strike reach — the exact population the
`closingFast` predicate in `updateTroopPhase` is applied to:

| fixture | body | samples | speed: median / p90 / max | closing: median / p90 / max | over 120 (speed) | over 120 (closing) |
|---|---|---|---|---|---|---|
| roaming | bandit | 19240 | 5.1 / 52.2 / 115.5 | −0.5 / 6.5 / 90.2 | 0.1% | **0%** |
| roaming | wolf | 6346 | 10.7 / 64.8 / 173.7 | −0.3 / 20.1 / 124.3 | 2.5% | 0.2% |
| roaming | raider | 1310 | 5.9 / 64.6 / 204.0 | −3.0 / 3.2 / 26.4 | 1.4% | **0%** |
| brute-heavy | bandit | 39683 | 2.8 / 44.4 / 104.0 | −0.1 / 7.8 / 90.0 | 0.1% | **0%** |
| brute-heavy | brute | 22344 | 4.9 / 52.2 / 100.4 | −1.3 / 0.8 / 61.9 | **0%** | **0%** |
| brute-heavy | wolf | 7893 | 0.2 / 52.2 / 208.9 | 0.0 / 2.4 / 203.2 | 6.1% | 1.5% |

**The median closing speed is negative for every body on both fixtures.** By the time
anything is inside spear reach it has braked to wind up its own blow and separation is
pushing it back out. The mechanic reads the wrong instant, and no threshold value repairs
that: a bonus keyed on "over 120" fires on 0-6% of contacts, and one keyed on closing speed
fires on 0-1.5%. The documented "this is a wolf counter" is generous — it is a wolf counter
about one contact in fifty.

## 3. Why the obvious repair also fails

The natural fix is to latch the fastest speed seen in the last second and brace against that
instead. Measured before it was designed in, on the same samples, with a 1.0s rolling peak:

| fixture | body | latched peak: median / p90 / max | caught at 70 | at 80 | at 100 | at 120 |
|---|---|---|---|---|---|---|
| roaming | bandit | 73.0 / 103.9 / 134.8 | 72.7% | 34.8% | 12.4% | 4.6% |
| roaming | wolf | 75.3 / 122.0 / 205.0 | 83.2% | 43.6% | 23.0% | 12.6% |
| brute-heavy | brute | 72.9 / 93.0 / 130.3 | 79.4% | 28.2% | 4.8% | 0.7% |

The medians are the tell. A brute's base speed is **55**, and its latched peak median is
**72.9** — higher than a bandit's own base walk. That is not locomotion. It is the
`+= cos * 85` knockback impulse that every landed hit applies to its target, and it is the
largest term in the distribution for every body. Any rule keyed in the 40-90 band would read
"I hit it, therefore it charged me".

The conclusion the plan takes from this: brace must read **commanded locomotion while
approaching a hostile**, latched over a short memory, and never raw velocity.

## 4. Tier honesty (`zz-tier-prog-before.json`)

The Plan 028 calibration, re-run unchanged, so the after-run has a same-tree control. Its
purpose in this slice is the mid-progression question Plan 028 could not ask, because
nothing about a warband changed across a run except its roster.

*(table recorded from the harness output — see the comparison document for the after-run)*

## What the baseline says the slice has to do

1. Rebuild brace on commanded approach speed, so HOLD stops being a 35% option.
2. Split spear and archer, because `dmg: 10` on both is the literal reason neither has a
   fight it wins.
3. Charge the knight what it is worth in slots, because the cap is the binding constraint.
4. Give the run a state that survives a battle, and make gold buy its ceiling.
