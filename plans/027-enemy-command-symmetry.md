# Plan 027: Give the enemy a commander, so the player's orders have something to answer

**Status:** STOPPED ON ITS OWN CONDITION, shipped as structure rather than as the fix. The enemy commander is built, measured and green, but the plan's headline premise is NOT met and is claimed nowhere: over 120 organic camp raids an idle hero still wins 77.5% where he won 75%. What the slice did buy is the gap -- the best deliberate order policy went from 10 points behind pressing nothing to level with it -- plus four measured negative results. The `@sweep` `test.fail` annotation stays.
**Priority:** P0 (gameplay audit, phase 4 — "the game plays itself")
**Effort:** L
**Risk:** High (the most balance-sensitive loop in the game, plus nine visual baselines and the `@sweep` finding)
**Audit finding:** `critiques/phase4/gameplay-audit.md`; `critiques/phase4/self-playing-fix-options.md`
**Baseline recorded at:** `critiques/enemy-command-baseline.md` (measured on `cba5629` before any `src/` edit)
**Depends on:** Plan 019 (squads and stance trade-offs — DONE as optional depth), Plan 024 (battlefield terrain, cover)

## Objective

Make an inattentive commander lose fights he currently wins, by giving the enemy the same
thing Plan 019 gave the player: squads, stances, and someone deciding between them.

The measured diagnosis in `self-playing-fix-options.md` is not "the enemy is too weak" —
enemy damage x2, x3, x4, focus fire, pincer spawns, staggered waves and a fully passive
player troop AI were each measured and each failed. It is that **both AIs converge to melee
and the arithmetic resolves itself from either side.** Enemy stat tuning changes how fast
that happens; it never changes who is deciding. Nobody is.

So this plan changes nothing about damage, hp, speed or spawn count. It changes **who picks
the engagement.** An enemy that stands off on ground it chose, shoots, and commits only when
the exchange favours it is an enemy the player must actually answer — and the three answers
already exist and are already bound to keys.

## Design decisions

Settled; changing one needs a new review.

1. **Enemy squads mirror player squads exactly.** One squad per `ENEMY_TYPES` key
   (`bandit`, `raider`, `brute`, `wolf`), membership derived from type and never assigned,
   `{ stance, anchorX, anchorY }` per squad. Same shape as `Battle.squads`, same three
   stance names (`follow` / `charge` / `hold`), same mechanics: brace bonus, steady aim,
   charge exposure, formation slots. Symmetry is the point — a fourth enemy-only verb would
   make the enemy a different game than the one the player is playing.
2. **`follow` is byte-identical to today's enemy AI.** It is the default, and it is what
   every enemy is on until the commander's first decision. That makes the change auditable
   (any behaviour difference is attributable to an order) and keeps the visual baselines
   untouched — see decision 4.
3. **No save-schema change.** Enemy squad state and the commander are reconstructed from
   `setup.seed` at `Battle` construction, exactly as `simRng`/`fxRng` are. Battles are not
   resumable; there is nothing to persist.
4. **The commander's first decision lands at `CMD_TICK = 0.8 s` of live fight time.** The
   visual baselines settle at 1.5 s. Eight of the nine battle baselines carry the default
   8-second deploy window, during which no enemy phase runs at all; the ninth
   (`battle_bridge`, `ambush: true`, deploy 0) reaches only 0.4 s of live fight after its
   1.1 s intro. A first decision at 0.8 s is therefore provably outside every captured
   frame. This is a real constraint on the tuning, not an implementation detail.
5. **The no-death stall clock keeps its guarantee, unweakened.** `STALL_NO_DEATH` and
   `bloodlust` are what terminate a kiting stalemate, and this plan makes the enemy kite on
   purpose. `bloodlust` therefore *overrides the commander*: once it arms, the commander
   stops choosing and every enemy squad is on the `press` doctrine — plain `follow`, which is
   the pre-027 stall-breaker exactly — for the rest of the fight. Charge speed and bloodlust
   speed are taken as a maximum, never multiplied.
   *(Revised during execution. This decision originally said `charge`. Measured, making the
   enemy eat `CHARGE_EXPOSURE` for the rest of every long fight took the camp-raid idle win
   rate from 75% to 89% — the stall-breaker is the engine ending a grind, and it must not
   also hand the player a 35% damage bonus.)*
6. **Cover comes from Plan 024's `battle.blockers`, read-only.** The commander pulls its
   anchor toward real cover when there is any within reach. Briefless template fights have
   few or no blockers and simply get the un-pulled anchor; that is a normal case, not a
   degraded one.
7. **RNG:** a new `RNG_DOMAINS.ENEMY_COMMAND` stream derived with
   `deriveSeed(setup.seed ?? 1, ...)`. It must not touch `simRng`, so the existing draw
   sequence — and therefore every legacy determinism record — is unperturbed by the
   commander's own randomness. Used only for the per-battle nerve offset and the anchor's
   lateral jitter; every other decision is a pure function of battle state.

## The four archetypes

*Revised during execution against measurement; the original table is quoted in the
Implementation findings below, together with why each part of it did not survive.*

Each is a doctrine for how that squad executes the three shared stances. The commander picks
the stance; the archetype decides what it looks like. Only two of the four muster in a line
(`mustersInLine()` in `enemy-command.js` is the single source): a bow is already at its
working range wherever it stands, and a wolf in a line is a slow bandit with a quarter of the
hit points.

| type | `hold` | `charge` (only ever ordered by `commit`) |
|---|---|---|
| **bandit** (92, 110 hp) | walks to its slot on the muster line, stands there, and fights **braced** whatever reaches it — the anvil the player has to attack into | presses at charge speed and pays charge exposure for it |
| **brute** (55, 420 hp, slam) | stands in the second rank of the muster and does **not** walk into the line on sight — it goes in on the commander's timing | commits with the rest |
| **raider** (82, ranged 210) | does not muster. Keeps its own working range exactly as before, and what `hold` buys it is **steady aim** (`BOW_SPREAD_BRACED`, 0.05 against a walking 0.12) | closes, and holds fire while advancing — the same "a charge forfeits the bow line" rule the player's archers have |
| **wolf** (158, 55 hp) | **stalks** at `WOLF_STALK_R`, refuses to close, commits on its own only against a wounded or isolated target, and **breaks off for `WOLF_RECOIL_T` after every bite** instead of standing in the scrum | runs the target down as before |

## The commander

Re-decides every `CMD_TICK` seconds from state it computes once per decision, never per unit:
the player's centroid and mean spread, the surviving troop fraction, and `bloodlust`. One of
five doctrines results, and the muster is a one-way gate — once the assault is ordered the
commander never falls back to forming up, which is what bounds fight duration.

| doctrine | trigger | orders |
|---|---|---|
| `form` | the force has not finished mustering, and `CMD_FORM_MAX` has not elapsed | everyone holds: the line walks to the chosen ground, the bows shoot from range, the pack stalks |
| `flank` | mustered, and the player is an **unsplit blob** (spread under `BLOB_SPREAD`) | the line goes in; bows and wolves keep holding. The muster point was placed off the player's weaker flank, which is what makes this different from `break` |
| `break` | mustered, and the player is anything else — a **line with width** to push through | identical orders, from a muster point placed frontally |
| `press` | `bloodlust`, or a `hold` objective that has to be contested | everyone on `follow` — the pre-027 AI exactly |
| `commit` | the player's warband is down past `CMD_BLOOD_FRAC` of its starting size | everything charges, shields down. The only doctrine that pays charge exposure, reached only when the player cannot punish it |

The reaction the brief asked for lives in **where the force musters**, not in a per-unit
swerve: an unsplit blob has no frontage, so the line forms off whichever wing carries fewer
of its melee; a strung-out line gets hit frontally through the thin part. A per-unit flanking
arc was tried first and does not converge — see finding 2.

A doctrine change raises the existing `commandFlash` banner and a horn. This reuses the
mechanism player orders already use; it adds no HUD element, no new draw pass and no baseline
exposure (it cannot fire before 0.8 s).

## In scope

- `src/battle/enemy-command.js`: squad state, commander, anchors, slots. New module.
- `src/battle/ai-phases.js`: `updateEnemyPhase` reads the stance; the three archetype
  execution paths; the enemy brace/steady-aim/charge-speed mirrors.
- `src/battle/combat.js`: charge exposure applied to a charging enemy, mirroring the troop path.
- `src/battle/constants.js`: the new named constants. No scattered literals.
- `src/battle.js`: construction and one new ordered phase, behind a delegating seam.
- `src/engine.js`: the `ENEMY_COMMAND` RNG domain.
- Coverage: a QA record proving enemy squads take divergent stances deterministically and
  that `bloodlust` overrides the commander; the `@sweep` annotation updated **only if the
  measurement supports it**.
- `critiques/enemy-command-comparison.md`, `AGENTS.md`, `tests/README.md`, `progress.md`.

## Out of scope

- Any change to `ENEMY_TYPES`/`UNIT_TYPES` stats, `HERO` stats, spawn counts or the fair-band
  guarantee. All measured and rejected in `self-playing-fix-options.md`.
- A HUD panel showing enemy stances. The banner is the affordance in this slice.
- World-map behaviour of any kind. Plan 023's freeze is world-scene; this is battle-scene.
- Battle objectives and win conditions (Option 1 in the options document) — separate work.

## STOP conditions

- **If the idle win rate does not fall on both fixtures, stop and report.** A commander that
  makes the fight look busier without changing who wins is decoration, and this plan's whole
  premise is that the enemy AI, not enemy stats, is the lever.
- **If mean fight duration balloons, that is a defect to fix inside this slice, not a cost to
  accept.** An enemy that refuses to lose by standing off is no better than one that refuses
  to win. Duration is measured before and after and reported either way.
- **If deliberate orders still do not beat idle over 120 raids, the `test.fail` annotation
  stays.** It is removed only in the change that makes it true, with the numbers. A truthful
  negative result is the acceptable outcome; a flip validated on a favourable handful of
  seeds is the exact mistake Plan 019 had to retract.
- If a favourable fight becomes unwinnable with correct orders, that is overtuning — back the
  thresholds off rather than shipping it.
- If the per-unit stance lookup moves a performance budget, stop rather than raising it.
- If any visual baseline changes, stop: decision 4 says none can, so a diff means the
  commander is acting inside a captured frame and the timing is wrong.

## Verification

```powershell
npm run release:cache
npm run test:release
npm run test:tooling
npm run test:perf
npm run test:visual
npm test
node scripts/zz-enemy-command-sweep.mjs --label after
```


## Outcome

Recorded against `critiques/enemy-command-baseline.md`, in full in
`critiques/enemy-command-comparison.md`.

| fixture, hero idle | before | after |
|---|---|---|
| roaming party, 24 seeds: win % / lost / seconds | 95.8 / 0.46 / 37.4 | 95.8 / **1.58** / 41.9 |
| camp raids, 120 raids: win % / lost / seconds | 75.0 / 4.02 / 46.3 | 77.5 / 3.80 / 47.8 |
| camp raids: best deliberate policy minus idle | **-10.0 points** | **0.0 points** |

The first STOP condition — "if the idle win rate does not fall on both fixtures, stop and
report" — fired. It is reported rather than worked around. Idle costs 3.4x the men it used
to on the roaming fixture, which is the "inattention costs" half; it does not lose, which is
the half that is missing.

## Implementation findings

Each of these changed what shipped, and each cost a full 120-raid measurement to establish.

0. **What the plan originally specified, and did not survive measurement.** The design
   above was written before any of it ran. The original said: raiders muster in the second
   rank of the line and hold there; a charging raider arcs around the melee line toward the
   backline; `flank` and `break` send raiders, wolves and brutes charging while the bandits
   hold; `bloodlust` orders everything to charge; and there is no muster gate. Every one of
   those five is now different, and findings 2-6 are the measurements that changed them.
1. **The `follow` path is provably untouched, and that is what makes the rest readable.**
   With the commander forced off and every enemy squad left on `follow`, both fixtures replay
   the pre-027 numbers digit for digit (95.8/0.46/37.4/105/1 and 75.0/4.02/46.3/94/7). Every
   other number in the comparison is therefore attributable to an order, not to drift. This
   control is worth re-running before trusting any future change here.
2. **A per-unit flanking swerve does not converge.** The first design had a charging raider
   rotate its approach heading by a constant `FLANK_ARC` off the bearing to its target. A
   constant rotation applied to a constantly re-read bearing orbits a target that does not
   move: a lone raider circled a static warband at a fixed 497 units for the entire 90s
   budget, three of eight seeds unresolved. Flanking is now WHERE THE FORCE MUSTERS, decided
   once per decision by the commander, and there is no per-unit swerve at all.
3. **The muster point must sit outside everything the player can reach without deciding to.**
   At `CMD_STANDOFF = 150` the muster walked the enemy line into the middle of the player's
   blob and stood it still there; the fixture resolved in 16.8s against a 37.4s baseline,
   because a stationary clump inside a warband is the easiest thing on the field to kill. It
   is 340 now — past melee's FOLLOW engage radius (150) and past bow range (207).
4. **Only the men with spears muster.** Marching bows to a formation slot behind the melee
   put them out of their own 210 range and out of the fight; a wolf standing in a line is a
   slow bandit with a quarter of the hit points. `mustersInLine()` is the single source for
   who waits and who fights from where its archetype wants to be, and the readiness count
   ignores everyone else — counting the whole roster made an all-bow force wait out
   `CMD_FORM_MAX` every time for a line it was never going to form.
5. **Four "obviously smarter" enemy behaviours are measured net losses for the enemy** and
   were removed rather than shipped: concentration of fire (75% -> 81.7% idle win rate), the
   same with sticky targets (80.8%), raiders preferring the player's bow line
   (81.7% -> 88.3%), and head-hunting a stationary commander (100% on the roaming fixture).
   The common cause is one sentence: in this engine every second an enemy spends not
   attacking is damage it does not deal, and an enemy that manoeuvres is an enemy that is not
   swinging. See the comparison document for each mechanism.
6. **Charge exposure has to be rationed on the enemy side.** Ordering `charge` under
   `bloodlust` — for the rest of every long fight — handed the player a 35% damage bonus and
   took the camp-raid idle win rate from 75% to 89% on its own. `bloodlust` now orders
   `press` (plain `follow`), which is also exactly the pre-027 stall-breaker; `charge` is
   reserved for the one doctrine reached when the player's warband is already broken enough
   that the exposure cannot be punished.
7. **The audit's central claim survives contact from the other direction.**
   `self-playing-fix-options.md` established that no enemy STAT change fixes the self-playing
   problem. This slice establishes that no enemy BEHAVIOUR change does either, for the same
   underlying reason: the encounter generator's 0.7-1.2x fair band counts bodies, and on the
   real combat scale the roaming fixture is roughly 71 dps / 750 hp against 46 dps / 610 hp.
   The two levers still standing are the two this plan put out of scope — change the win
   condition (Option 1) or change the encounter generator (Option 2). The commander is a
   prerequisite for the second, not a substitute for it.

## What shipped

- `src/battle/enemy-command.js`: enemy squads, the commander, the muster anchor (which reads
  Plan 024 cover read-only), formation slots, and the doctrine table.
- `src/battle/ai-phases.js`: `updateEnemyPhase` reads the stance; the archetype paths; the
  enemy brace, steady-aim, charge-speed and wolf hit-and-run mirrors.
- `src/battle/combat.js`: charge exposure applied to a charging enemy.
- `src/battle/constants.js`, `src/engine.js` (`RNG_DOMAINS.ENEMY_COMMAND`), `src/battle.js`
  (construction plus the `updateEnemyCommandPhase` / `enemyStance` / `assignEnemySlots`
  seams), `src/battle/objectives.js` (reinforcement waves take slots).
- `tests/qa_suite.js` record 26 and its name in `tests/e2e/qa.spec.js`.
- No save-schema change, no new runtime dependency, no performance-budget change, no visual
  baseline touched.

## Deliberately not done

- **No HUD panel for enemy stances.** The doctrine banner reuses `commandFlash`, so the
  player is told what the other side just did without a new draw pass or a tenth baseline. A
  proper enemy-intent readout belongs with whatever makes the commander matter.
- **No change to the encounter generator or the win condition**, which the measurements say
  are the actual levers. Both are larger than this slice and both deserve their own plan.
- **The `@sweep` annotation is untouched.** A tie is not a win, and the assertion is a strict
  inequality. Flipping it on a 0.0-point margin would be exactly the mistake Plan 019 had to
  retract.
