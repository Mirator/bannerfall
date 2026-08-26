# Encounter power rebase: the state before (plans/028)

Measured on branch `encounter-power-rebase` at `b9ed84b` (the Plan 027 commander slice,
before any `src/` edit of this plan), with the Plan 027 harness unchanged:

```
python scripts/serve.py
node scripts/zz-enemy-command-sweep.mjs --label enc-before
```

Raw rows: `scripts/zz-sweep-enc-before.json`. Hero completely idle in every run (he never
swings), canvas pinned to 1280x720, cursor pinned to centre, camera shake cleared, fixed
1/60 timestep, no wall-clock waits.

**This baseline is the commander-inclusive state, re-measured rather than quoted.** Every
number below reproduces `critiques/enemy-command-comparison.md`'s AFTER column digit for
digit, which is the check that the harness and the branch are what they claim to be.

## Fixture A — standard roaming-party encounter (24 seeds, 1..24)

8 troops (4 spear / 3 archer / 1 knight) vs 3 bandit / 2 raider / 2 wolf, road arena,
deploy 0.

| policy | win % | avg lost | avg seconds | hero HP | unresolved |
|---|---|---|---|---|---|
| **idle** | **95.8** | 1.58 | 41.9 | 101 | 1 |
| chargeAll | 100 | 0.29 | 18.9 | 119 | 0 |
| split | 100 | 0.42 | 22.0 | 118 | 0 |
| holdLine | 83.3 | 1.21 | 51.1 | 50 | 1 |

## Fixture B — organic camp raids (40 world seeds x 3 camps = 120 raids per policy)

| policy | win % | avg lost | avg seconds | hero HP | unresolved |
|---|---|---|---|---|---|
| **idle** | **77.5** | 3.80 | 47.8 | 100 | 12 |
| chargeAll | 77.5 | 4.68 | 35.6 | 93 | 1 |
| split | 47.5 | 6.33 | 58.5 | 65 | 20 |
| holdLine | 53.3 | 5.98 | 60.6 | 78 | 28 |

| gap: best deliberate policy minus idle | value |
|---|---|
| camp raids, 120 per policy | **0.0 points** (chargeAll 77.5 vs idle 77.5) |

## What this baseline is for

Plan 027 closed the orders-vs-idle gap from -10.0 points to a 0.0 tie and left the idle win
rate where it was. Its own retrospective names the remaining cause: the encounter generator
balances on headcount-derived strength points while actual combat power is lopsided. On the
Fixture A roster the two sides are roughly 71 dps / 750 hp (player, hero excluded) against
46 dps / 610 hp (enemy) — and 46 is itself generous, because it divides damage by `cooldown`
alone while an enemy's real cadence is `cooldown + windup`. Recomputed on the cadence the
engine actually runs, the enemy side of the "even" fixture is **33.7 dps**.

Plans/028 rebases the generator on measured combat power. These are the numbers it will be
judged against, and the `@sweep` `test.fail` annotation in
`tests/e2e/stance-balance.spec.js` may only flip on a robust measured win over the second
table's idle row.
