# Plan 029 — measured before and after

Everything here is a machine-measured run. The before column is
`critiques/progression-baseline.md`, taken on `7de3bb5` (the Plan 028 power rebase) before
any `src/` edit. Same harnesses, same seeds.

## 1. The brace: what was wrong, what the repair had to be, and how often it now fires

The pre-029 rule was `len(target.vx, target.vy) > BRACE_SPEED` evaluated at the instant of
the swing. Sampling every enemy inside a holding melee troop's strike reach over 24 fights
on two fixtures — precisely the population the predicate is applied to:

| fixture | body | contacts | median speed | median CLOSING speed | fired |
|---|---|---|---|---|---|
| roaming | bandit | 19240 | 5.1 | −0.5 | 0.1% |
| roaming | wolf | 6346 | 10.7 | −0.3 | 2.5% |
| roaming | raider | 1310 | 5.9 | −3.0 | 1.4% |
| brute-heavy | bandit | 39683 | 2.8 | −0.1 | 0.1% |
| brute-heavy | brute | 22344 | 4.9 | −1.3 | **0%** |
| brute-heavy | wolf | 7893 | 0.2 | 0.0 | 6.1% |

The median CLOSING speed is negative for every body on both fixtures: by the time anything
is in spear reach it has braked to wind up its own blow and separation is pushing it back
out. This is not a threshold that needs lowering. It is the wrong instant.

**The obvious repair also fails, and that was measured before it was designed in.** Latching
the fastest speed seen in the last second gives a median latched peak of 73.0 for bandits,
75.3 for wolves and **72.9 for brutes** — whose base speed is 55. That is not locomotion; it
is the `+= cos * 85` knockback impulse every landed hit applies, and it is the largest term
in the distribution for every body. A rule keyed anywhere in the 40-90 band would mean "I
hit it, therefore it charged me".

So the shipped rule latches **commanded locomotion while approaching a hostile**, before
terrain scaling, with two clauses: at or above `BRACE_SPEED` (130 — an inherently fast body:
wolf 158, knight 175) or above `BRACE_CHARGE_MUL` x its own walk (1.10 — a body that was
ordered forward: charge x1.15, bloodlust x1.3).

Re-measured on the same two fixtures, the share of contacts on which a braced swing now
carries the bonus:

| fixture | body | before | after |
|---|---|---|---|
| roaming | wolf | 2.5% | **35.4%** |
| roaming | bandit | 0.1% | 0% |
| roaming | raider | 1.4% | 0% |
| brute-heavy | wolf | 6.1% | **24.0%** |
| brute-heavy | brute | 0% | **2.6%** |
| brute-heavy | bandit | 0.1% | 0.6% |

**Stated plainly, because it is a partial success:** the brace is a real wolf counter now,
firing on a quarter to a third of contacts instead of one in forty. Against bandits and
brutes it fires only when the enemy commander orders `commit` or the stall clock arms
bloodlust, and in a fight the player is winning that rarely happens — 2.6% of brute contacts
and under 1% of bandit contacts. The mechanism is proven, and a QA record pins the stance
directly to prove it; what the organic fixtures show is that it does not come up often. This
is NOT "the brace is now a brute counter", and that claim is made nowhere.

## 2. The power metric, re-fitted

Plan 028 documents that retuning `UNIT_TYPES` invalidates the fitted multipliers. It was
retuned, so they were re-measured: 1776 hand-built ladder battles plus 768 rolled
compositions, re-fitted the same way (maximum likelihood, logistic intercept pinned at zero,
rolled rows up-weighted).

| | headcount (at its own best crossing) | fitted fighting weight |
|---|---|---|
| decisive matchups called correctly, pooled | 84.6% (1970/2328) | **89.7% (2088/2328)** |
| ...on the hand-built ladders | 85.8% | **93.5%** |
| ...on rolled compositions | 82.3% | 82.0% |

The STOP condition — "if the re-fitted power metric cannot recover headcount-or-better
prediction after the unit retune, stop and report" — **did not fire**: 89.7% against 84.6%
pooled and 93.5% against 85.8% on the ladders. On rolled compositions the two metrics tie
(82.0% against 82.3%, a 0.3-point difference on 768 samples). That is the same shape Plan
028 reported and it is stated rather than hidden: both metrics sit near the ceiling there,
because rolled bands cluster around the crossing where outcomes are genuinely random.

| multiplier | Plan 028 | Plan 029 |
|---|---|---|
| spear | 1.00 (unit of account) | 1.00 |
| archer | 1.30 | 1.43 |
| knight | 1.20 | 1.31 |
| bandit | 1.00 | 1.04 |
| raider | 1.65 | 2.00 |
| brute | 1.90 | 2.00 |
| wolf | 0.95 | 0.92 |

One methodological change: the rolled up-weight went from 4x to 8x, because at 4x the fit
put the crossing at about 1.07 rather than 1.00 — the same failure Plan 028 hit at 1x and
fixed with the same knob. At 8x the rolled crossing sits at about 1.05 (67% idle win at
ratio 1.00, 39% at 1.10, 30% at 1.20), so the `even` band still straddles a coin flip.

**The fit was run twice, and the first run measured the wrong game.** With the archer's
counter ungated (see section 4) the brute fitted at 1.74; gated, it returns to 2.00, because
a gated archer no longer halves it. Every number above is from the gated build.

## 3. Tier honesty at mid progression

`scripts/zz-tier-calibrate.mjs` gained two veteran rosters, because the question Plan 028
could not ask is whether the generator keeps sizing fights honestly as the player's warband
outgrows its base types. `vetMid` is the eight-body mid roster with every man a Veteran;
`vetLate` is the late roster under a stage-2 banner with Elites and a Champion in it.

**A harness bug had to be found first, and it looked exactly like a balance finding.** The
first run reported a Champion-heavy warband winning 16.7% of even fights against an
unblooded one's 66.7%, which reads as "the rank multiplier is worth nothing". It was not: the
harness built its battle roster with `troops.map(t => ({ type: t.type }))` and dropped
`vet`, so every veteran roster was SIZED as veterans and then FIELDED as raw recruits.
Recorded here because a measurement that confirms a plausible worry is the one most likely
to be believed without checking.

Corrected, and measured against the final gated build with the re-fitted metric,
`realRatio` tracks the drawn band for every roster — which is the property tier honesty
actually is:

| roster | fighting weight | realRatio across the `even` band (0.95-1.20) | idle win in that band |
|---|---|---|---|
| fresh | 4.56 | 1.04 - 1.13 | 69.4% |
| mid | 8.96 | 1.02 - 1.16 | 55.5% |
| late | 10.97 | 1.00 - 1.15 | 44.4% |
| **vetMid** | 9.97 | 1.01 - 1.14 | **55.6%** |
| **vetLate** | 14.18 | 1.00 - 1.15 | **72.2%** |

The STOP condition — "even-tier fights against a mid-progression warband still land near
ratio 1.0" — **did not fire**. A veteran warband draws a proportionally heavier fight rather
than the same one, and 0 of 20 fresh campaigns open with nothing beatable on the map.

The stronger result is the pairing: **vetMid delivers 55.6% where the same eight bodies
unblooded deliver 55.5%.** At mid progression — the case the brief named — a rank is priced
almost exactly right, and the generator neither punishes nor rewards the player for having
built something.

**The gap that remains is at the top of the ladder: vetLate wins 72.2% of its even fights
against unblooded `late`'s 44.4%.** That is recorded as a finding rather than papered over.
The cause is structural: rank scales damage and hit points on the SAME bodies, and the
square law credits that linearly, while a real fight rewards fewer-tougher bodies
superlinearly (less overkill, fewer targets to lose), and `vetLate` is the only roster
carrying Champions at 1.40. The honest correction is to fit the rank credit against a grid
of ranked rosters the way `POWER_EFFICIENCY` itself was fitted; at 12 seeds a cell the
present data cannot support calibrating an exponent, and inventing one on that evidence is
the mistake Plans 019, 027 and 028 each declined to make. It is the top follow-up. The
direction of the error is player-favourable, so nothing becomes unwinnable while it stands.

## 4. The regression this slice introduced, and how it was found and closed

The first complete build measured the camp-raid IDLE win rate at **78.3%** against the
baseline's 70.8% — undoing Plan 028's entire gain on that fixture and then some. The task
this slice was given says to run the sweep specifically so that "progression didn't reopen
the AFK farm". It had.

The cause was the archer's anti-brute counter, shipped unconditionally. Camp garrisons are
the brute-heavy fights, so doubling a bow line's damage against a brute is a large real
power gain concentrated in exactly the fixture that measures idle play — handed to a player
pressing nothing.

Gating the counter behind STEADY AIM (the bow squad on HOLD) returns the number to
**70.8%**, digit for digit, over the same 120 raids. That is a clean attribution: the
unconditional counter was the whole regression. It is also the better design, and it is this
plan's own perk rule applied to unit identity — the archer keeps the role, and buys it with
an order instead of receiving it for free.

## 5. Order policies, before and after

`scripts/zz-enemy-command-sweep.mjs`, same seeds both sides. Roaming fixture 24 seeds; camp
raids 40 seeds x 3 camps = 120 per policy.

Roaming fixture:

| policy | win % | troops lost | seconds | unresolved |
|---|---|---|---|---|
| idle | 95.8 -> 95.8 | 1.58 -> 1.71 | 41.9 -> 42.8 | 1 -> 1 |
| chargeAll | 100 -> 100 | 0.29 -> 0.33 | 18.9 -> 17.8 | 0 -> 0 |
| split | 100 -> 100 | 0.42 -> 0.63 | 22.0 -> 21.3 | 0 -> 0 |
| holdLine | 83.3 -> 83.3 | 1.21 -> 1.33 | 51.1 -> 52.4 | 1 -> **0** |

Organic camp raids — the fight the campaign actually serves:

| policy | win % | troops lost | seconds | unresolved |
|---|---|---|---|---|
| idle | 70.8 -> **69.2** | 4.50 -> 4.21 | 49.5 -> 49.2 | 14 -> 18 |
| chargeAll | 68.3 -> 68.3 | 5.14 -> 5.18 | 41.2 -> 40.1 | 8 -> 7 |
| split | 36.7 -> **45.0** | 7.08 -> 6.78 | 57.6 -> 55.7 | 16 -> 18 |
| holdLine | 35.0 -> **51.7** | 6.53 -> 6.39 | 62.6 -> 63.3 | 32 -> 30 |

Two things to read off this.

**The AFK farm did not reopen.** Idle camp raids went 70.8% -> 69.2% and idle roaming stayed
at 95.8%. That is the number the slice was told to watch, and it did not move the wrong way.

**HOLD stopped being a trap.** It was 35.8 points behind pressing nothing and is now 17.5
behind; split closed from 34.1 behind to 24.2. The best deliberate policy went from 2.5
points behind idle to **0.9 points behind**. The `@sweep` annotation therefore **stays** — a
strict inequality is not satisfied by "one point behind", and a margin inside the harness's
own run-to-run drift is exactly what Plan 019 had to retract. This is the fourth plan to
attack that finding and the closest any has come.

## 6. Does gold matter again

`scripts/zz-economy-probe.mjs`: 6 campaign openings, 14 roaming fights each, played through
the real world paths, under a policy that spends what it has on the things offered (fill the
column, buy a cap upgrade when the column is full, raise the banner when nothing else is
wanted).

| fight | loot | gold held after | slots / cap | banner |
|---|---|---|---|---|
| 1 | 32.5 | 37.5 | 9 / 12 | 0 |
| 3 | 36.7 | 55.8 | 12 / 12.3 | 0 |
| 5 | 48.3 | 79.2 | 14 / 14 | 0 |
| 7 | 88.3 | 120.0 | 15.8 / 16 | 0 |
| 10 | 95.0 | 185.8 | 18.3 / 18.3 | 0.2 |
| 12 | 86.0 | 160.0 | 20 / 20 | 0.2 |
| 14 | 93.0 | 161.0 | 21 / 21.2 | 0.6 |

Mean earned 918 g and mean spent 863 g across the opening. Gold held never runs away: every
fight's income is consumed, and the first banner stage (150 g) is only reached around fight
10-14 — where the audit found gold "stops being a resource after about four fights".

The sink ladder, for completeness: spearman 15 (12 at Ashford), archer 25 (20 at Brindle),
knight 60 **and two places in the column**, heal 10, army cap 40 + 20 per upgrade bought,
banner 150 then 400. The knight's slot cost is what re-prices the whole ladder — the audit's
"fill every slot with knights" plan now costs twice the cap it used to.

Two honest caveats. A player who stops expanding the column will bank gold, and the banner
plus healing is then the only sink — the cap upgrade is what keeps the curve binding, not
the banner. And perks stayed at 0 across this measurement, because a roaming fight razes no
camp and captures no settlement: the perk track is deliberately gated on campaign
objectives, so a player who only farms parties earns none of it.
