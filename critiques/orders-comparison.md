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
