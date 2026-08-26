# Enemy command symmetry: before and after (plans/027)

Same harness, same fixtures, same seeds, both sides of the change:
`scripts/zz-enemy-command-sweep.mjs`, hero completely idle in every run, canvas pinned to
1280x720, cursor pinned to centre, camera shake cleared. BEFORE is `origin/main` at
`cba5629`; AFTER is this working tree. Raw per-run rows are in
`scripts/zz-sweep-before.json` and `scripts/zz-sweep-after.json`.

**Headline: the idle win rate did not fall. The plan's own STOP condition fired, and the
`@sweep` `test.fail` annotation stays.** What did change is recorded below, honestly, along
with the four negative results that are the more useful part of this slice.

## Fixture A — standard roaming-party encounter (24 seeds, 1..24)

8 troops (4 spear / 3 archer / 1 knight) vs 3 bandit / 2 raider / 2 wolf, road arena.

| policy | win % before → after | avg lost before → after | avg seconds before → after | hero HP before → after |
|---|---|---|---|---|
| **idle** | 95.8 → **95.8** | 0.46 → **1.58** | 37.4 → 41.9 | 105 → 101 |
| chargeAll | 100 → 100 | 0.79 → 0.29 | 21.0 → 18.9 | 105 → 119 |
| split | 100 → 100 | 0.42 → 0.42 | 16.9 → 22.0 | 120 → 118 |
| holdLine | 87.5 → 83.3 | 1.46 → 1.21 | 49.2 → 51.1 | 37 → 118 |

Idle still wins the same fights. It now pays **3.4x the casualties** to do it (0.46 → 1.58
men per fight), and takes 12% longer. That is the "inattention costs" half of the target,
and it is the only part of the headline goal this slice reached.

## Fixture B — organic camp raids (40 world seeds x 3 camps = 120 raids per policy)

| policy | win % before → after | avg lost before → after | avg seconds before → after | unresolved before → after |
|---|---|---|---|---|
| **idle** | 75.0 → **77.5** | 4.02 → 3.80 | 46.3 → 47.8 | 7 → 12 |
| chargeAll | 65.0 → **77.5** | 5.25 → 4.68 | 41.8 → 35.6 | 6 → 1 |
| split | 31.7 → 47.5 | 6.34 → 6.33 | 59.3 → 58.5 | 32 → 20 |
| holdLine | 38.3 → 53.3 | 6.28 → 5.98 | 59.9 → 60.6 | 30 → 28 |

The interesting column is the second one. Idle moved 2.5 points (inside this harness's own
documented noise at this sample size). Every deliberate policy moved 12-16 points:

| gap: best deliberate policy minus idle | before | after |
|---|---|---|
| camp raids, 120 per policy | **-10.0** | **0.0** |

**A formed-up, patient enemy is something a commanded warband can answer and an
uncommanded one cannot exploit.** The baseline's converging swarm punished a charge — you
ran into a rabble already coming at you from every angle. An enemy that musters and then
assaults on its own timing can be hit while it is doing so, which is what the 65% → 77.5%
on chargeAll is. It is a tie, not a win, and `expect(best.winPct).toBeGreaterThan(idle.winPct)`
is a strict inequality, so `test.fail()` still reports honestly and stays.

## The four negative results

Each was implemented, measured over the full 120-raid fixture, and removed. These are the
substance of the slice; they extend the negative-results table in
`critiques/phase4/self-playing-fix-options.md` rather than contradicting it.

| lever | camp-raid idle win % | verdict |
|---|---|---|
| baseline (no commander) | 75.0 | — |
| **concentration of fire** (melee finishes the wounded man already in reach) | 81.7 | **helps the player** — removed |
| ...the same, with sticky targets so it cannot churn | 80.8 | still helps the player — removed |
| **raiders prefer the player's bow line** | 88.3 (with the above) | **helps the player** — removed |
| **head-hunting a stationary commander** (wolves + bows go for an idle hero) | 100 on the roaming fixture | **helps the player** — removed |
| commander only, as shipped | 77.5 | kept |

1. **Concentration of fire helps the player.** Damage spread across eight men removes
   nothing from their output until one finally falls, so finishing the wounded one looks
   free. It is not: a unit that re-picks its mark stops to re-approach, and lands fewer
   blows than it would have on the man it was already next to. Adding hysteresis so the
   choice sticks recovered less than a point. This is the same shape as the phase-4 audit's
   own "enemies focus-fire the weakest troop → *helps the player*" row, found again from a
   different direction.
2. **Raiders preferring the archers helps the player.** It is the obvious smart play — the
   bow line is the softest thing that can hurt a formed-up enemy — and it walks an 85 hp
   raider across the field and through four spearmen to reach a 60 hp archer.
3. **Head-hunting a stationary commander helps the player.** An idle hero sits in the
   middle of his own formation. Everything sent at him crosses the spear line first and
   dies there. The mechanic only works if the hero is genuinely exposed, and an idle hero
   on FOLLOW never is — which is precisely the case it was built for.
4. **Charge exposure on the enemy is a gift when the enemy charges often.** Ordering
   `charge` under `bloodlust` — i.e. for the rest of every long fight — took the camp-raid
   idle win rate from 75% to 89% on its own. `bloodlust` now orders `press` (plain
   `follow`), and `charge` is reserved for the one doctrine reached when the player's
   warband is already broken and cannot punish it.

## Why the idle win rate did not move, and what would move it

A control run isolates this cleanly. With the commander disabled and every enemy left on
`follow`, the harness reproduces the pre-027 numbers **exactly** — 95.8% / 0.46 / 37.4s /
105 hp on Fixture A and 75.0% / 4.02 / 46.3s / 7 unresolved on Fixture B, digit for digit.
So the `follow` path is provably untouched and every number above is attributable to an
order.

With that established, the pattern across seven measured configurations is consistent:
**in this engine every second an enemy spends not attacking is damage it does not deal, and
the player's warband out-damages the party regardless of how the party is arranged.** On
the real combat scale the roaming fixture is roughly 71 dps and 750 hit points against
46 dps and 610 — the encounter generator's 0.7-1.2x "fair band" counts bodies, not fighting
weight. Positioning cannot flip a fight that lopsided, and a smarter enemy that fights less
is simply a weaker enemy.

That is the same conclusion `self-playing-fix-options.md` reached from the stat-tuning side,
now confirmed from the behavioural side. The two levers it leaves standing are the ones this
plan put out of scope on purpose:

- **Change the win condition** (Option 1). Troops target `nearestEnemy` and nothing else, so
  an objective is the one job the army provably cannot do for the player.
- **Change the encounter generator** (Option 2). Delete the fair band, or make it count
  fighting weight rather than bodies, so the player is sometimes offered a fight the numbers
  say he loses. The commander shipped here is what makes such a fight interesting rather
  than merely lethal — it is a prerequisite for Option 2, not a substitute for it.

## Feel

- **Duration did not balloon.** Fixture A idle 37.4 → 41.9s (+12%), Fixture B idle
  46.3 → 47.8s (+3%). Every deliberate policy got *faster* or held. The `form` muster is
  capped at `CMD_FORM_MAX = 6s` and the assault is monotone — the commander never falls
  back to mustering — so the patient phase is bounded by construction rather than by luck.
- **Unresolved raids: idle 7 → 12 of 120.** This is the one number moving the wrong way and
  it is reported rather than hidden. Every one of them is a 95-second timeout in the
  harness, not a hung fight: the no-death stall clock still arms and still closes them, just
  later than the harness's budget. `split` and `holdLine` unresolved counts both fell
  (32 → 20, 30 → 28), so the net across the fixture is an improvement.
- **No favourable fight became unwinnable.** Fixture A stays at 95.8-100% for every policy
  except `holdLine`, which was already the worst order at baseline.
