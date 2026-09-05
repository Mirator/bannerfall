# Plan 045 — fights that end, and a margin worth arguing about

- Status: **SLICES E, A and D1 IMPLEMENTED.** B, C and D2 remain PROPOSED — see
  "What actually shipped" below for why B in particular is its own change.
- Successor to `plans/044-the-sweep-tells-the-truth.md`, whose slice 1 (the instrument) is
  implemented.
- Prerequisite: Plan 044 slice 1. The sweep now prints `unresolved` and a paired margin with
  its standard error, budgets timeouts, and guards drift against a committed table. Without
  that, none of the slices below can be told apart from noise.

## What slice 1 exposed

Fixing the instrument turned one number into four, and three of them are new findings.

1. **Camp raids can fail to end at all, and nothing in the game stops them.**
   `updateStalematePhase` (`ai-phases.js:979`) is a one-shot behaviour flag: after 10s with
   no damage or `STALL_NO_DEATH` (14s) with no death, `bloodlust` fires once and the
   survivors stop kiting and close in. If they still cannot reach each other, nothing else
   happens — ever. There is no terminal stall resolution anywhere in the battle loop. The
   sweep's "95s window" is a *harness* cap, not a game rule, so what a player experiences at
   the same moment is a fight that simply never finishes.
2. **It still happens on `main`.** After Plan 042's obstacle rescue the sweep measures
   holdLine at 7/120 raids unresolved and idle at 4/120. Better than the 25 and 23 it was,
   but not zero, and the ones that remain are the same shape.
3. **The margin the whole finding rests on is unresolvable at this sample size.** The paired
   standard error is ~5.5 points against differences of 3–6. No plan in this history has ever
   had the sample to settle it, in either direction.

## Slice A — a fight always ends

The player-facing half of finding 1, and the reason to do it first: this is a defect a person
can hit, not a harness artefact. A camp raid that hangs gives the player one out — walk to
the retreat edge — and the HUD does not offer that prompt until 45s in unless they happen to
wander near the right edge (`battle/hud.js`, the `nearEscape || time > 45` gate).

Proposal: after `bloodlust` has fired and a further stall window passes with no death on
either side, resolve the fight rather than continuing it. Options, in preference order:

- **A1.** Escalate: pull both sides toward the arena centre with collision softened between
  teams, so contact is geometrically guaranteed. Keeps the fight a fight.
- **A2.** Terminate as a mutual disengage — the withdraw result that already exists
  (`retreated: true`), with its existing world consequences. Honest, cheap, and reuses a
  path the player already understands.
- **A3.** Terminate on the objective's own terms where one exists (a Hold fight already has a
  clock; a Break fight can score the guards).

A1 is the better game and the larger change; A2 is the smaller one and strictly better than
the current "nothing". Whichever is chosen, the acceptance test is the sweep's timeout
column going to zero for every policy, and the budget in `TIMEOUT_BUDGET_PCT` being tightened
to match in the same change.

Expect this to move the balance table: raids that currently time out are scored as losses,
and A2 in particular converts them into withdrawals. **Re-record
`tests/e2e/__baselines__/orders-sweep.json` in the same change, with the measured before/after
in this plan.** That is what the drift guard is for.

## What actually shipped

**Slice E** is in `AGENTS.md` under Determinism and RNG domains.

**Slice A** is `STALL_TERMINAL` (30s, twice the game's own `STALL_NO_DEATH`) plus the
`battle.closing` clock in `updateStalematePhase`. While it holds, obstacle steering and the
obstacle push-out both stand down on BOTH sides, so bodies walk straight at what they are
fighting and the fight resolves itself by combat. It decides nothing: unit-vs-unit separation
is untouched, so somebody still has to land the blows, and handing the win to whoever has more
bodies left would have invented a scoring rule the game does not have. It is a clock, not a
latch — one death clears it.

Measured on the fixture that motivated it, camp raid world seed 7 / camp c1: **600+ simulated
seconds with 541 of them without a death, before; resolves at 104s, a victory with all seven
troops alive, after.** Guarded by `a camp raid that cannot reach itself still ends` in
`battlefield-terrain.spec.js`, which drives the production entry (E, site menu, brief, deploy
confirm) and was verified to FAIL with the terminator disabled before it was accepted.

One thing the diagnosis changed: the harness window. `raidSweep` capped raids at an inline
95s, and that number was doing two jobs badly — camp raid seed 7 / c2 resolves honestly at
131s and was being scored identically to the one that never ended. It is `RAID_WINDOW_S = 180`
now, so `unresolved` means what the Plan 044 budget assumes it means.

**Slice D1** put holdLine in the sweep.

The table moved and was re-recorded with that justification, per slice E's own rule:

| policy | before (Plan 042 record) | after | unresolved before → after |
| --- | --- | --- | --- |
| idle | 82 | 84 | 4 → 0 |
| chargeAll | 78 | 78 | 1 → 0 |
| split | 76 | 76 | 0 → 0 |
| holdLine | 71 | 77 | 7 → 0 |

holdLine moved most because it deadlocked most. Paired margins against idle are now
chargeAll −5.8 ± 5.3, split −8.3 ± 5.5, holdLine −7.5 ± 5.1 — all still inside their own
error bars, and all slightly more negative than before, which is worth noting for slice C:
once stalls resolve, commanding looks no better, not better.

**Slice B is deliberately not in that change.** It moves plank collider positions, which moves
the drawn props, which re-records battle visual baselines — and per `AGENTS.md` those are
captured through the `Visual baselines` workflow and reviewed PNG by PNG by a human. Bundling
that with a gameplay terminator would put two independent re-records in one diff. It is also
no longer urgent: with slice A in place nothing hangs, so B is now about fight QUALITY (the
brute in the fixture above wasted ~45s orbiting before the terminator reached it) rather than
about fights that never end.

## Slice B — the palisade is a pocket generator

The geometric half. `placeCamp` (`battle/terrain.js:302`) lays 7 circle colliders at 42px
centres with ±7px jitter, radius 13, one gate at index 3:

| unit | radius | contact radius | fits the 16px inter-plank gap? |
| --- | --- | --- | --- |
| wolf | 8 | 27 | yes (needs 16) |
| spear / archer / bandit / raider | 10 | 29 | **no** (needs 20) |
| knight | 12 | 31 | **no** (needs 24) |
| brute | 18 | 37 | **no** (needs 36) |

Two consequences. The wall is solid except at the gate for everything but a wolf, so the
16px gaps are decorative — and the jitter decides, per camp, how deep the pockets between
planks are. And the *inflated* contact radius (27–37) exceeds the half-spacing (21), so
"in simultaneous contact with more than one collider" — the trigger the Plan 042 rescue keys
on — is true for anything standing anywhere along the palisade. It detects a wall, not a
trap; only the 1.5s stall timer separates the two cases.

Proposal: one capsule/segment collider per palisade run with an explicit gate gap, replacing
the seven circles. Plank *props* keep their jitter — it is the colliders that must be a
wall. Plan 042 recorded that "restoring the old physical placement alone removed that
particular deadlock", which is the same finding from the other side: the pocket is an
accident of where the circles land.

If this lands, the Plan 042 rescue is answering a case that no longer occurs, and slice B
should be followed by measuring whether it can be simplified — its envelope growth is what
makes a detour cost up to 20.7s for a bandit and 33.7s for a brute. Do not delete it
speculatively; measure first.

Also expected to move the table. Same rule: re-record with the numbers in the plan.

## Slice C — settle the margin, once, at a sample size that can

Not a gate. A one-off recorded measurement, in the tradition of
`critiques/*-comparison.md`.

The paired margin's standard error is `sqrt(discordant) / N`, and roughly 35% of pairs are
discordant here, so `SE ≈ sqrt(0.35 / N)`. Resolving a 5-point margin at 2 sigma needs
`SE ≤ 2.5`, i.e. **N ≈ 560 raids per policy** — 4.7× the sweep. At the measured ~0.5s per
raid that is about 4.5 minutes per policy, ~20 minutes for four: unacceptable in CI, trivial
as a one-off.

Run it after slices A and B, not before: both change the quantity being measured, and the
answer is only worth having on a fixture whose fights end. Record the result in
`critiques/`, and let it decide whether "commanding beats pressing nothing" is a property to
pursue by design or one to retire.

## Slice D — the coverage the instrument still lacks

1. **holdLine belongs in the sweep.** It is the slowest policy and therefore the first to
   deadlock — 25/120 pre-042, 7/120 now, the highest of any policy in both — yet the shipped
   sweep runs only idle/chargeAll/split and would not have shown it. Adding it costs about
   60s of the sweep's own check, and it is the canary the PR-gate probe already uses.
2. **Audit `campaign-arc.spec.js`'s `@sweep` with the same lens.** It failed inside PR #34
   (10/12 against a required 11/12) and passed later in the same PR, which is the signature
   of a threshold at the edge of what its sample resolves. Ask it the same three questions
   slice 1 asked this one: does it report the runs it failed to measure, is its threshold
   inside its own error bar, and is there a committed baseline to diff against.

## Slice E — the rule (carried from Plan 044 slice 4)

`AGENTS.md`: a change to battle navigation, obstacle geometry, or any terrain RNG stream
invalidates every recorded balance number. Such a PR re-runs the sweep and records the new
table in the same change, and a red sweep blocks the merge unless the plan states why the new
number is the correct one.

Worth writing now rather than after slices A and B, because both of them are exactly the kind
of change it governs — and both will legitimately move the baseline, which is the case the
rule has to describe without becoming a licence to re-record on demand.

## Sequencing

E, then A, then B, then D1, then C, then D2.

E first because it is a paragraph and it governs everything after it. A before B because it
is player-facing and its acceptance criterion (zero timeouts) is also the cleanest measurement
of whether B was needed. C last because it is the only one whose answer changes if anything
before it moves.

Each of A and B re-records the baseline once, with its before/after table in this plan. Two
deliberate re-records, each justified by a measurement, is the process working; a third
without a stated reason is the smell the drift guard exists to catch.
