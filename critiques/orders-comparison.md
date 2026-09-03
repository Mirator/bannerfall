# Orders that do what they say — per-slice measurements (Plan 040)

One row per slice, before and after, on both instruments the plan names. Commands:

```bash
python scripts/serve.py &
npx playwright test tests/e2e/stance-balance.spec.js --project=chromium \
  -g "stance measurements are deterministic"      # the four direct fixtures
npm run test:balance                              # the 360-raid @sweep guard
```

The four direct fixtures (`mixed`, `wolves`, `brute`, `raiders`) install their enemy list
straight through `startBattle` with `deploy: 0`, so no generator and no stage curve is
involved — they are the sensitive instrument. The `@sweep` guard is the 40-seed x 3-camp
organic camp raid, re-based by Plan 039 to a stage-matched fixture (four held settlements)
after Plan 038 saturated it.

## Slice 2 — the bow line answers a pack (audit finding 15)

`WOLF_STALK_R` 250 -> 180, one constant. The derivation is in the constant's own comment:
a stalking wolf occupies the band `[0.9R, 1.25R]` around its target, so for the whole band
to sit inside an archer's 230 px reach, `R <= 184`.

### The four direct fixtures, before -> after

| fixture / stance | seconds | troops lost | hero HP |
| --- | --- | --- | --- |
| `mixed` / follow | 25.1 -> 34.8 | 1 -> 1 | 111 -> 111 |
| `mixed` / charge | 15.8 -> 13.9 | 0 -> 0 | 120 -> 120 |
| `mixed` / **hold** | 45.5 -> **34.4** | 0 -> 1 | **3 -> 93** |
| `wolves` / follow | 17.6 -> 17.6 | 0 -> 0 | 120 -> 120 |
| `wolves` / charge | 10.9 -> 10.4 | 0 -> 0 | 120 -> 120 |
| `wolves` / hold | 14.8 -> 16.1 | 0 -> 0 | 120 -> 120 |
| `brute` / follow | 22.9 -> 24.9 | 0 -> 0 | — -> 96 |
| `brute` / charge | 15.8 -> 16.7 | 0 -> 0 | 120 -> 120 |
| `brute` / **hold** | 36.4 -> **23.3** | **2 -> 0** | — -> 120 |
| `raiders` / * | unchanged | unchanged | unchanged (no wolves in the fixture) |

The two rows that carry the change are the mixed-composition HOLD fights, which is where a
pack actually appears alongside something the line has to deal with. On `mixed` the hero
finished at **3 hit points** and now finishes at **93**: at 250 the pack stood at 225-312
px, outside the archers' 230, and spent the fight picking at the one body it could reach.
On `brute` a held line stops losing men entirely. `raiders` is the control — it contains no
wolves and did not move by a single tick.

### The `@sweep` guard, before -> after

| policy | before (Plan 039) | after |
| --- | --- | --- |
| idle | 68 | **73** |
| chargeAll | 75 | **76** |
| split | 53 | 51 |
| margin (best deliberate - idle) | **+7** | **+3** |

**The guard holds but its margin narrowed, and the reason is structural rather than
incidental.** Since Plan 033 "pressing nothing" means a formed line that HOLDS by default,
so an improvement to HOLD is an improvement to idle first. This slice makes the stance the
un-ordered player already gets better at the fight wolves create, and idle gains five
points against chargeAll's one.

That is not a reason to revert — the fix is correct, the direct fixtures show it doing
exactly what it was meant to do, and the plan's STOP condition is a FLIP, which did not
happen. It is a reason to record the margin prominently: at +3 on 120 raids per policy the
guard is no longer comfortably resolvable, and the next slice that helps HOLD could flip
it. Slices 1 and 3 both touch what a held line does.

### One thing the plan asserted that did not reproduce

The plan predicted that a held line against a pack "does nothing until the 14 s no-death
stall clock forces `bloodlust`", and asked for a test that the first wolf death lands
before `STALL_NO_DEATH`. Measured, that premise is false in that form: the first kill under
HOLD on the `wolves` fixture lands at **11.4 s at both 250 and 180** — the number does not
move at all. A test asserting it would have passed with the whole change reverted, which is
precisely the failure mode Plan 019 had to retract.

What is real is arithmetic, not an outcome, so that is what is asserted instead: `the wolf
stand band lies inside the bow line reach` in `stance-balance.spec.js` checks
`WOLF_STALK_R * 1.25 <= UNIT_TYPES.archer.range` and `WOLF_STALK_R * 0.9 >
UNIT_TYPES.spear.range`, both read from the shipped tables. It is a contract between two
tables that nothing guarded: raising the stalk radius or lowering the archer's range makes
a pack unanswerable again, which is the state this plan found the game in. Verified to fail
at 250 (`stands out to 312.5px, past the archer's 230px reach`) and pass at 180.


## Slice 1 — HOLD holds in a Break-the-position fight (audit finding 9)

The Break-the-position block ran for every stance: a squad with no hostile in reach took
the nearest standing guard as its target however far away it was, and the `d > wantR`
branch then replaced the hold anchor with a formation goal on it. A held body may now take
a guard only inside the reach its stance already uses for hostiles (`holdReach` — its own
range if it shoots, 140 if it does not); `charge` and `follow` are untouched.

**Measured directly: without the fix a held troop drifts 1793 px from where it was
anchored.** With it, 8 px. The new test in `battle-objectives.spec.js` asserts both halves
— HOLD stays home and leaves the guards at full health, CHARGE travels and damages one —
because a fix that made the position unbreakable would be worse than the defect.

### The `@sweep` guard, before -> after

| policy | after slice 2 | after slice 1 |
| --- | --- | --- |
| idle | 73 | **68** |
| chargeAll | 76 | 76 |
| split | 51 | 53 |
| margin | +3 | **+8** |

The margin slice 2 narrowed is restored, and for a coherent reason: an un-ordered line no
longer wanders onto the objective and completes it by accident, so "pressing nothing" stops
winning camp raids it did not fight for. Ordering a charge is unaffected at 76.

### The plan's acceptance criterion 1 is NOT met

The plan required that `holdLine`'s unresolved raids "do not rise". They rose, and this is
the honest record of trying to fix it.

| policy | before slice 1 | after slice 1 |
| --- | --- | --- |
| idle | 73.3%, 14 unresolved, 44.4 s | 68.3%, 23 unresolved, 55.5 s |
| chargeAll | 75.8%, 3 unresolved, 29.6 s | 75.8%, 3 unresolved, 29.6 s |
| split | 50.8%, 15 unresolved, 42.9 s | 52.5%, 19 unresolved, 44.6 s |
| `holdLine` | 61.7%, **18** unresolved, 45.2 s | 54.2%, **25** unresolved, 63.1 s |

The plan predicted this symptom and pointed at the enemy commander's `break` doctrine.
That is not the cause. Traced with `zz-stall-probe`, an unresolved raid looks like this: by
t=60 the player has 4-7 troops and the garrison is down to ONE body, the guards are
untouched at full health, `bloodlust` is armed, the survivor is on `follow` with LINE OF
SIGHT and moving at full commanded speed — and it never arrives. The doctrine presses
correctly; the body cannot converge on a line that does not move. Before slice 1 the held
line walked across the field to the guards, so the geometry changed constantly and the
fight resolved; a genuinely static line is a case the enemy movement has never had to
solve.

Three fixes were tried and MEASURED, and the record matters more than the outcome:

| attempt | holdLine unresolved | verdict |
| --- | --- | --- |
| bloodlust outranks `steerAroundObstacle` | 25 -> **27** | worse; bodies wedge on obstacles instead |
| slide along the arena edge (shipped) | 25 -> 25 | no aggregate change; fixes one real freeze |
| (a rout-to-victory stall breaker) | not attempted | would flip the `@sweep` guard, a hard STOP |

The third is worth stating because it is the obvious idea and it is wrong: converting
unresolved raids into victories would take idle from 68% to roughly 87% against chargeAll's
78%, flipping the guard the plan forbids tuning around. Any stall breaker that RESOLVES a
grind in the player's favour has that property. The only correct fix is to make the last
enemy actually arrive.

The arena-edge fix ships anyway, on its own evidence rather than on the aggregate: traced,
the last surviving brute stood at (1278, 1110) — exactly `W - ARENA_EDGE` — for
thirty-plus seconds at a commanded speed of 71 while its target sat 536 px west. A heading
that pushes into the wall is absorbed whole by the position clamp, so the body freezes at
full speed and re-derives the same dead heading every tick. `slideAlongArenaEdge` zeroes
the outward component and renormalises. It moved one raid of 120, which is honestly all it
was worth; it is shipped because a body standing still for thirty seconds is a defect
whatever the aggregate says.

**The remaining stalls are a pre-existing enemy-convergence defect that slice 1 exposes
rather than causes, and fixing it is its own plan.** It needs a look at why a body with
line of sight, full speed and a static target fails to close — most likely the interaction
of the sticky tangent hysteresis in `steerAroundObstacle` with a goal that never moves,
which is precisely the case its own comment says the hysteresis was added FOR.
