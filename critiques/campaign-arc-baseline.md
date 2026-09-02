# Campaign arc — baseline (Plan 038 Slice A)

Measured 2026-09-02 on the tree at `5bcd88c` with no `src/` change of any kind: this
slice adds a harness and nothing else, so every number below is the shipped game.

Command, reproducible verbatim:

```bash
python scripts/serve.py &
node scripts/zz-campaign-probe.mjs --seeds 12 --workers 4 --label baseline
```

12 seeds (`1..12`, a plain arithmetic sequence chosen for count and not for content) x
four scripted policies = 48 campaigns, ~4 s of wall clock each. Raw records in
`scripts/zz-campaign-baseline.json`. The harness, its four policies and its three stated
blind spots are documented at the top of `tests/e2e/campaign-harness.js`; the two that
matter most for reading these numbers are that travel is teleport-plus-clock (a party
that would have intercepted the ride does not) and that the hero never swings.

Every run was replayed once and matched byte for byte (`campaign-arc.spec.js`, "the same
seed and policy replay identically"), so nothing here is averaged over a
non-deterministic run.

## The three headline numbers the audit could only estimate

### Time to victory, and who actually wins

| policy | campaign seconds | battles | won the run | battle win rate | storm win rate |
| --- | --- | --- | --- | --- | --- |
| `claimRush` | **54** | **1.0** | **2 / 12** | 17% | 17% |
| `campRaider` | 256 | 6.0 | 0 / 12 | 29% | 0% |
| `captureThenRaze` | 251 | 4.9 | 0 / 12 | 29% | 0% |
| `farmer` | 368 | 10.4 | 0 / 12 | 36% | 0% |

The policy that never fights until the storm is the only one that ever wins, and it does
so in a fifth of the campaign time of any policy that does fight. The audit called the
claim-everything route "the credible fastest win"; it is measured at 37-63 flowing
seconds and exactly one battle.

### The ratio the warband arrives at Wolfsjaw with

| policy | mean storm ratio | per seed (1..12) |
| --- | --- | --- |
| `claimRush` | **1.04** | 0.97 W · 1.07 · 0.87 W · 1.07 · 0.96 · 1.07 · 1.09 · 1.09 · 1.10 · 1.07 · 1.12 · 1.01 |
| `campRaider` | 2.34 | 1.64 · 2.54 · 2.45 · 2.44 · 2.48 · 1.47 · 2.46 · 2.66 · 2.44 · 2.61 · 2.45 · 2.48 |
| `captureThenRaze` | 1.93 | 1.69 · 1.66 · 1.91 · 1.56 · 1.30 · 1.85 · 0.99 · 1.07 · 4.54 · 1.27 · 4.34 · 1.01 |
| `farmer` | 2.35 | 2.59 · 1.58 · 1.98 · 2.44 · 2.48 · 2.59 · 2.46 · 2.66 · 2.44 · 2.61 · 1.90 · 2.48 |

**Fighting more than doubles the difficulty of the final fight.** This is the plan's
complaint stated as a measurement rather than as a reading of the code, and the mechanism
is visible in the weight column of the raw records: `claimRush` reaches the hold at a
fighting weight of **12.6** while `campRaider` reaches it at **4.0**. Two rules produce
that gap and neither is about spending well:

* Four claims commit four spec choices, and the harness commits the first option
  (Barracks) every time, so `claimRush` is handed **8 free spearmen** — from 4 bodies to
  a full 12-slot column — without a single fight.
* A camp raid costs men, and gold buys them back at a worse rate than they were lost.
  `campRaider` ends every run at the 25-gold defeat floor (`finalGold` 25 on 12 of 12)
  having spent 211 and earned 126.

Because the stronghold garrison target is `max(size * campWeightPerSize, mine * tier)`,
the `size * 0.9 = 9.0` floor binds for a warband that has been ground down: at weight 4.0
the ratio is 9.0 / 4.0 = 2.25 whatever the player did. The tier ladder never reaches it.

### Stronghold power at the storm

| policy | ENTRENCHED | WEAKENED | EXPOSED |
| --- | --- | --- | --- |
| `claimRush` | 0 | 0 | **12** |
| `campRaider` | 11 | 1 | 0 |
| `captureThenRaze` | 0 | 0 | 12 |
| `farmer` | 10 | 2 | 0 |

Four free claims reach EXPOSED on every seed. EXPOSED strips the garrison to 55% of its
rolled size, which is where `claimRush`'s 1.04 comes from: the tier ladder puts the hold
at roughly 1.5x its weight and the free power state hands most of that back. Razing all
three camps reaches only WEAKENED, which changes nothing at all — the audit's finding 9,
now with a column of its own.

### Gold earned per fight, by what was actually fought

Roaming fights only (a "-heavy" fight is one where a majority of the bodies are that
type), pooled across all four policies:

| majority body | won fights | gold per fight | gold per unit of fighting weight |
| --- | --- | --- | --- |
| wolf | 7 | 27.9 | **12.36** |
| bandit | 26 | 27.5 | 9.16 |
| raider | 15 | 28.3 | 8.88 |
| brute | 2 | 15.0 | **4.89** |

Gold per FIGHT is nearly flat, because the shipped rule is flat: `lootBase +
totalEnemies * lootPerEnemy` pays by headcount and cannot see what the bodies are. Gold
per unit of fighting weight therefore spans **2.5x**, and it pays most for the cheapest
thing on the map. `ENEMY_TYPES[type].gold` (bandit 6, raider 7, brute 25, wolf 4) has no
reader anywhere in `src/` — audit finding 4, confirmed by measurement rather than by
grep.

The brute row is two fights and is quoted only because it is the extreme; the wolf,
bandit and raider rows carry the claim.

## What this baseline is for

Slices B, C and D each re-run the command at the top of this file and append to
`critiques/campaign-arc-comparison.md`. The properties they have to move are:

1. `claimRush` cannot reach EXPOSED without razing a camp, and cannot claim four
   settlements out of the starting purse (Slice C).
2. `campRaider`'s storm ratio must fall BELOW `claimRush`'s on every seed — the sentence
   "gold buys something" as an assertion (Slice B).
3. Gold per fight must stop depending on which cheap body the roller picked (Slice D).

## Recorded, not asserted

* `floorFires` (times `enforceBeatableFloor` actually rewrote the map): 0.0 for
  `claimRush`, 0.8 `campRaider`, 0.9 `captureThenRaze`, 1.4 `farmer`. It is an emergency
  correction and it fires about once per fighting run.
* `raidsLanded` is **0 on all 48 runs**. No stronghold raid ever reached a player-held
  settlement. `RAID.firstDelayT` is 110 flowing seconds and every claim used to extend
  the grace to 60, so the whole regional-pressure mechanic is dead on every route
  measured here — `claimRush` finishes the campaign before the first raid is due.
* Unresolved 95 s windows are counted separately (`unresolved`) and resolved as a
  disengage rather than an invented defeat; see the harness header for why.
