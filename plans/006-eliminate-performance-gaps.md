# Plan 006: Eliminate audited scheduler, rendering, simulation, and pathfinding waste

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat eecb14b..HEAD -- src/main.js src/world.js src/battle.js package.json tests/e2e/performance.spec.js tests/qa_suite.js tests/e2e/qa.spec.js AGENTS.md tests/README.md plans/README.md`
> If an in-scope path changed since this plan was written, compare the current
> excerpts below with the live files. A semantic mismatch is a STOP condition.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/005-persist-battle-entry-checkpoint.md` (DONE)
- **Category**: perf, tests, tech-debt, docs
- **Planned at**: commit `eecb14b`, 2026-08-17
- **Audit mapping**: PERFORMANCE-01 through PERFORMANCE-05

## Why this matters

Bannerfall's shipped battle sizes are playable, but five avoidable costs stack
on every active frame: rendering can run when no 60 Hz simulation step occurred,
large static Canvas geometry is rebuilt even when offscreen or unchanged,
battle drawing creates short-lived arrays/objects/closures each frame, the
all-pairs separation loop performs linear team membership searches, and roaming
parties replan expensive river paths in synchronized bursts. Together these
costs waste CPU/battery at high refresh rates and create preventable stalls as
unit/party counts grow.

This single plan fixes all five audited gaps while preserving game feel,
determinism, visuals, the static native-module architecture, and save behavior.
The work is deliberately phased: land structural performance characterization
first, then scheduler, battle simulation, rendering, and navigation changes,
running the full gate after every phase.

## Current state and measured baseline

Baseline at `eecb14b`:

- `npm test` exits 0 with 17 Playwright tests. AUDIT-03 is the sole active
  expected failure and must remain so.
- The legacy suite includes `perf_smoke_200_half_second_steps` with an 8000 ms
  ceiling and seven deterministic river-pursuit cases. Preserve both record
  names and budgets.
- A read-only Chromium probe at 1280x720, scenario seed 42, counted Canvas calls
  for 20 explicit zero-time draws:

  | Scene | `beginPath` | `fill` | `stroke` | elapsed (informational) |
  |-------|-------------|--------|----------|-------------------------|
  | world | 31,140 | 29,320 | 1,860 | ~27 ms |
  | battle_big | 11,680 | 5,540 | 5,760 | ~15 ms |

  Timing is machine-dependent; the structural call counts are deterministic
  and are the regression baseline. The new tests use structural ceilings plus
  the existing broad wall-clock smoke guard.

### PERFORMANCE-01: duplicate scheduler draws

`src/main.js:306-345` always calls `game.draw()` after an rAF/watchdog pass,
even when the accumulator produced zero updates:

```js
let n = 0;
while (acc >= DT && n++ < 5) { game.update(DT); acc -= DT; }
game.draw();
// ... watchdog repeats the same unconditional draw
```

At 120/144 Hz, many rAF callbacks contain no 60 Hz state change. The watchdog
also renders background/hidden canvases. Direct test API calls at
`src/main.js:353-365` intentionally draw synchronously and must keep doing so.

### PERFORMANCE-02: uncached/offscreen static Canvas work

`src/world.js:755-853` reconstructs every blotch, river, road, and every scenery
object every draw. The scenery loop has no camera-bound rejection:

```js
for (const b of this.blotches) { /* rebuild polygon */ }
for (const r of this.rivers) { /* rebuild river path twice */ }
// ...
for (const it of this.scenery) { /* draw every mountain/tree/shrub/rock */ }
```

`src/battle.js:722-785` likewise rebuilds invariant island, region, blotch, and
static prop geometry. Do not allocate a full 3200x2200 world backing canvas;
that consumes roughly 28 MiB before overhead. Use reusable `Path2D` geometry
and viewport culling for the world, and a bounded per-battle static layer or
equivalent cached paths for the smaller 1250x880 arena. Animated fire, mill
vanes, water motion, entities, particles, labels, and HUD remain dynamic.

### PERFORMANCE-03: per-frame battle render allocations

`src/battle.js:723` replaces `_alerts` every draw. Lines 796-807 allocate a new
depth array, an object plus capturing closure per drawable, then sort it:

```js
this._alerts = [];
const draws = [];
for (const o of this.obstacles) draws.push({ y: o.y, f: () => this.drawObstacle(ctx, o) });
// troops/enemies/hero repeat the pattern
draws.sort((a, b) => a.y - b.y);
for (const d of draws) d.f();
```

Lines 832-845 rebuild wounded/bar arrays and call `some()` plus allocating
`filter()` inside the bar loop. Lines 878-891 rebuild balloon group objects and
sort `Object.keys()` to find dominant types. Reuse instance-owned scratch
buffers and entries, clear lengths instead of replacing arrays, use tagged
drawable entries instead of closures, count bar neighbors in one loop, and
compute dominant groups while grouping.

### PERFORMANCE-04: accidental cubic team lookup

`src/battle.js:595-605` builds a new combined array each update, then performs
two `this.troops.includes(...)` scans inside every unit pair:

```js
const all = [];
for (const t of this.troops) all.push(t);
for (const e of this.enemies) all.push(e);
// nested pair loop
const sameTeam = this.troops.includes(a) === this.troops.includes(b);
```

Give spawned units immutable `team` tags and reuse an instance scratch array.
Pair classification must become constant time without changing spacing values,
iteration order, or combat behavior.

### PERFORMANCE-05: synchronized path-planner bursts

`src/world.js:183-218` samples an entire segment every 14 px and performs one
direct plus up to two visibility checks per navigation node, allocating several
arrays for every call. `src/world.js:637-645` gives every new/restored party the
same immediate replan condition and fixed 0.6-second cadence:

```js
p.navT = (p.navT || 0) - dt;
if (p.navT <= 0 || !p.navGoal || goalChanged) {
  p.navGoal = this.pathGoal(p.x, p.y, goal);
  p.navFor = { x: goal.x, y: goal.y };
  p.navT = 0.6;
}
```

Stagger initial and subsequent replans deterministically, reuse planner scratch
storage, and reuse goal-to-node visibility while a party's target sector remains
within the existing 140 px tolerance. Preserve direct-path preference,
line-of-sight symmetry, bridge routing, unstick logic, and deterministic RNG.

## Target design constraints

1. Simulation remains fixed at 60 Hz. Scheduler optimization may skip only a
   render whose state did not change and which was not explicitly invalidated.
2. Add a small invalidation contract in `Game`: initial boot, resize, scene
   change, and UI state changes can request a draw. rAF draws after one or more
   updates or invalidation; the watchdog never draws while `document.hidden`.
   Direct `window.game.step/tap/click` behavior remains synchronous.
3. Cache geometry, not mutable gameplay state. World cache memory must remain
   bounded; no full-map bitmap. Battle static bitmap/cache must be instance-owned
   and no larger than the arena plus a small fixed margin.
4. Scratch arrays/objects are instance-owned and retain identity across frames.
   Logical lengths reset; stale entries beyond the active length are never read.
5. Unit `team` is assigned at spawn and never inferred through array scans.
6. Navigation staggering uses the existing seeded `World.rng`; do not introduce
   `Math.random()`. Cached target visibility is transient and never serialized.
7. No visual hierarchy, physics constants, AI thresholds, save schema, or public
   scenario names change.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Browser | `npx playwright install chromium` | exit 0 |
| Performance characterization | `npm run test:perf` | all performance tests pass normally |
| Legacy QA | `npm run test:qa` | 2 Playwright tests pass; embedded 17/17 records green |
| Persistence/schema | `npx playwright test tests/e2e/campaign-persistence.spec.js tests/e2e/save-schema.spec.js` | exit 0; only AUDIT-03 expected failure |
| Full gate | `npm test` | exit 0; no page/console errors |
| Diff hygiene | `git diff --check` | no output, exit 0 |

## Scope

**In scope** (the only files to modify):

- `src/main.js`
- `src/world.js`
- `src/battle.js`
- `package.json` (add `test:perf`; no dependency changes)
- `tests/e2e/performance.spec.js` (create)
- `tests/qa_suite.js` (only if adding structural metrics without renaming or
  weakening existing records)
- `tests/e2e/qa.spec.js` (only if the legacy record list intentionally grows)
- `AGENTS.md`
- `tests/README.md`
- `plans/README.md` (status only)

**Out of scope** (do not touch):

- `src/data.js`, `src/engine.js`, `src/save.js`, `index.html`, or save schema.
- Gameplay/balance constants, combat target selection, unit speed/damage,
  spacing radii, party aggression/flee thresholds, river collision margins,
  or camera behavior.
- Architecture finding about the module-global mutable battle palette. Static
  caches must work with the current single active battle; do not expand into a
  palette ownership refactor.
- WebGL, a framework, production dependencies, worker threads, OffscreenCanvas
  requirements, or a production build step.
- Full-map bitmap caching, approximate/quantized collision answers, or a spatial
  hash for combat target selection. The current shipped unit scale does not
  justify those risks.
- Fixing or removing AUDIT-03.

## Git workflow

- Branch: `codex/performance-gap-pass`
- Keep implementation phases as separately reviewable commits if practical,
  then a final docs/plan-status commit. If the operator requested one commit,
  use one cohesive imperative commit such as `Eliminate audited performance waste`.
- Do not push, merge, or open a PR unless explicitly instructed.

## Steps

### Step 1: Add deterministic structural performance characterization

Create `tests/e2e/performance.spec.js` using Playwright and
`collectRuntimeErrors` from `tests/e2e/test-helpers.js`. Add
`"test:perf": "playwright test tests/e2e/performance.spec.js"` to
`package.json`. Do not add a dependency or edit the lockfile.

The spec must contain these named tests:

1. **scheduler coalesces high-refresh callbacks and suppresses hidden watchdog
   draws**: install deterministic init-script fakes for rAF, interval callbacks,
   and clock before page load; drive 144 synthetic rAF callbacks across one
   second. Wrap `window.__g.update/draw` only to count calls. Assert roughly 60
   updates, no more than `updates + 2` draws, fewer than 80 draws, and at least
   one initial/invalidated draw. Mark the document hidden, invoke the captured
   watchdog with elapsed time, and assert its draw count does not increase.
   This test is expected to fail before Step 2; create it first, confirm the
   failure reason, then proceed.
2. **world rendering reuses static paths and culls offscreen scenery**: instrument
   `CanvasRenderingContext2D.beginPath/fill/stroke` before load, start seeded
   world scenario 42, perform 20 explicit zero-time draws, and assert
   `beginPath < 10000` (baseline 31,140). Retain references to the static path
   cache across draws and assert identity stability. Add a far-offscreen sentinel
   scenery entry whose draw-only size conversion throws; a draw must not touch
   it. This test is expected to fail before Step 4.
3. **battle rendering reuses scratch storage and static terrain**: start
   `battle_big`, capture the documented scratch/cache references, draw 20 times,
   and assert their identities are unchanged. Instrument Canvas calls and assert
   `beginPath < 9000` (baseline 11,680). Verify all live troops/enemies carry the
   correct team tags. Expected to fail before Steps 3-4.
4. **party replans are staggered and reuse goal visibility**: start a pinned
   world, replace parties with at least six deterministic river-crossing parties,
   instrument `lineClear`, and advance fixed 1/60 steps for at least 0.8 seconds.
   Assert initial `navT` values are within the documented stagger window and not
   all identical; no first-frame all-party replan occurs; maximum line-clear
   calls in one step are bounded to at most two parties' full planner cost; and
   a stable target sector reuses its goal-to-node visibility buffer. Expected to
   fail before Step 5.

Tests must use fixed simulation steps, seeded scenarios, structural counters,
and stable object identity. Do not assert a millisecond improvement except the
existing broad smoke budget. Do not use sleeps to make performance pass.

**Verify before source edits**: `npm run test:perf` -> the new tests execute and
fail only for the named missing optimizations, not setup/runtime errors. Record
that baseline in the commit message/body or executor report; do not mark them
skip/fixme/expected-failure.

### Step 2: Gate scheduler draws by updates, invalidation, and visibility

Refactor the module-scope scheduler in `src/main.js` with the smallest explicit
invalidation mechanism that meets the target constraints. Recommended shape:

- `Game.invalidate()` sets a boolean dirty flag.
- Initial construction starts dirty.
- `resize()`, `startWorld`, `startBattle`, `startVictory`, recovery-to-menu, and
  any direct menu/pause/mute transition which can visibly change without a later
  update call invalidate.
- rAF counts actual fixed updates and draws only when count > 0 or dirty, then
  clears dirty after a successful draw.
- watchdog advances the bounded accumulator as today but draws only when the
  document is visible and count > 0 or dirty.
- test API `step/tap/click` continues explicitly calling `game.draw()` and must
  clear/consume dirty consistently so the scheduler does not immediately
  duplicate it.

Do not reduce simulation updates, change `DT`, `MAX_ACC`, max catch-up steps, or
error recovery. Ensure a resize/scene change paints even if the next rAF has no
fixed step.

**Verify**:

- `npm run test:perf -g "scheduler"` -> one pass.
- `npm run test:qa` -> embedded 17/17 records unchanged.
- `rg -n "while \(acc >= DT|game\.draw\(\)|document\.hidden|invalidate" src/main.js`
  -> both schedulers have conditional draw logic; test API still draws.

### Step 3: Remove accidental separation complexity and reuse battle scratch

In `src/battle.js`:

1. Add `team: 'friendly'` in `spawnTroop` and `team: 'enemy'` in `spawnEnemy`.
   Keep all existing unit properties/order.
2. Initialize `_allUnits` once in the constructor. In every update, set its
   length to zero, append troops then enemies in the same order, and compare
   `a.team === b.team`. Preserve radii/push constants and pair iteration order.
3. Initialize instance scratch structures once: `_alerts`, `_drawEntries`,
   `_woundedEntries`, `_drawnBars`, and reusable friendly/enemy grouping arrays
   keyed by production type. Clear logical lengths each draw; never replace the
   arrays.
4. Populate reusable depth entries `{ y, kind, ref }` by index and sort only the
   active array length. Dispatch with a switch/helper by `kind`; do not retain
   per-entry closures.
5. Reuse wounded/bar entries. Replace `drawnBars.filter(...).length` with one
   non-allocating loop that checks overlap and counts regional neighbors.
6. Reuse group arrays and track the dominant type during grouping. Do not call
   `Object.keys(...).sort(...)` each frame. Move any per-frame helper closure
   that captures `ctx` into an instance method when it would otherwise allocate.

Scratch entries may grow to the high-water mark but must not retain dead unit
references beyond the active logical length. Explicitly null unused `ref`
entries after shrink if the backing array remains longer.

**Verify**:

- `npm run test:perf -g "battle rendering"` -> team and scratch identity portion
  passes (Canvas budget may remain pending Step 4).
- `rg -n "troops\.includes|const all = \[\]|const draws = \[\]|this\._alerts = \[\]|Object\.keys\(.*\)\.sort|drawnBars\.filter" src/battle.js`
  -> no matches.
- `npm run test:qa` -> determinism and combat records unchanged.

### Step 4: Cache static Canvas geometry and cull by camera bounds

#### World

In `World` construction, build instance-owned `Path2D` objects for invariant
polygon collections (blotches and lighting wedges), each river centerline, and
the four road curves. Drawing applies the same styles, alpha, line widths,
dashes, and order to cached paths. Geometry is built once; `draw()` must not
reconstruct it.

Add a small camera-bounds helper using `camera.x/y/w/h/zoom` plus a conservative
margin based on object size. Use it before drawing scenery, settlements, camps,
and parties. The hero remains drawn. Bounds must account for mountains/labels
so objects do not pop at screen edges. Do not cache animated settlement
windmills or stateful camp/party visuals; cull them only.

Do not create a full-map backing bitmap. `Path2D` cache plus culling is the
required bounded-memory solution.

#### Battle

Cache invariant arena background work in an instance-owned bounded layer no
larger than `(W + 2 * 64) x (H + 2 * 64)`, or use equivalent instance-owned
`Path2D` caches if the structural budget is met. Separate static props/terrain
from animated fire, mill vanes, water motion, units, projectiles, particles,
hold banner, and HUD. Preserve draw order and palette at battle construction.

The cache must be built after arena/biome geometry exists and reused across
draws. It must not read a later battle's palette during rendering. Do not solve
the separate module-global palette architecture finding in this plan.

Visually inspect deterministic seeded world, `battle_small`, `battle_big`, and
bridge scenes headlessly or headed. Save temporary before/after screenshots if
useful, but do not commit generated reports/screenshots. The structural test
also asserts cached identities and draw-call ceilings.

**Verify**:

- `npm run test:perf -g "world rendering|battle rendering"` -> both pass;
  20-draw `beginPath` counts are below 10,000 world and 9,000 battle.
- `npm run test:headed -- -g "legacy browser QA suite"` when a visible browser
  is available; otherwise capture and inspect Playwright screenshots for all
  four deterministic scenes. Report which visual path was used.
- `npm run test:qa` -> embedded 17/17 records and runtime-error check pass.

### Step 5: Amortize party pathfinding without changing route rules

In `src/world.js`:

1. Give each spawned/restored party a seeded transient `navT` in `[0, 0.3)`.
   For restored parties use the same `this.rng`; do not serialize `navT`.
2. Do not force every party to plan merely because `navGoal` is initially null.
   Until its first stagger expires, it may steer toward the raw goal. Keep the
   existing immediate replan when the target changes by more than 140 px.
3. After a plan, set the next transient cadence to a seeded value in
   `[0.5, 0.7)`, preventing permanent phase alignment.
4. Allocate planner scratch once per `World`: numeric start/goal/distance
   buffers, first-hop indices, and visited flags sized to `navNodes.length`.
   Fill/reuse them in `pathGoal()` instead of allocating `start`, `toGoal`,
   `dist`, `first`, and `done` arrays every call.
5. Store a per-party reusable goal-to-node visibility/distance buffer and its
   `navFor` coordinates. Recompute that half only when the target moves beyond
   the existing 140 px tolerance; start-to-node visibility remains recomputed
   from the moving party. Do not quantize collision positions or cache direct
   `lineClear` answers globally.
6. Preserve `lineClear` sampling, symmetry, nav edges, Dijkstra comparison/order,
   direct-path preference, and null/no-route behavior exactly.

If reusing one World-level scratch buffer conflicts with nested/reentrant path
calls, STOP; do not share mutable scratch across reentrant callers. Current code
is synchronous and non-reentrant, but verify rather than assume.

**Verify**:

- `npm run test:perf -g "party replans"` -> stagger/call-bound/cache-reuse test passes.
- `npm run test:qa` -> `world_no_party_freezes_at_rivers` and all other 16 records pass.
- Run the river record three consecutive times to catch deterministic drift:
  `npm run test:qa -- -g "legacy browser QA suite" --repeat-each=3` -> all six
  Playwright invocations pass (two QA tests x three repeats).

### Step 6: Document performance invariants and run the complete gate

Update `AGENTS.md` and `tests/README.md` with:

- `npm run test:perf` as the focused command after scheduler, Canvas, battle
  loop, or party-navigation changes;
- the scheduler invalidation rule and hidden-watchdog rule;
- static-cache boundaries and the prohibition on a full-map bitmap;
- scratch-buffer ownership/high-water cleanup rules;
- immutable unit team tags and constant-time separation classification;
- seeded path staggering and the rule not to approximate river collision;
- the structural Canvas budgets and instruction never to raise them merely to
  obtain green CI.

Run all focused gates and the full suite. Confirm AUDIT-03 is still the only
`test.fail`, no performance test is skipped/fixme/expected-failure, and no
runtime error is suppressed. Mark Plan 006 DONE only after all checks pass.

**Verify**:

```text
npm run test:perf
npm run test:qa
npx playwright test tests/e2e/campaign-persistence.spec.js tests/e2e/save-schema.spec.js
npm test
rg -n "test\.(fail|skip|fixme)" tests/e2e
git diff --check
git status --short
```

Expected: every command exits 0; only the existing AUDIT-03 line uses
`test.fail`; no performance test annotation exists; only in-scope paths changed.

## Test plan

- New `tests/e2e/performance.spec.js` with four structural tests covering:
  synthetic 144 Hz scheduling/hidden watchdog, world path reuse and culling,
  battle scratch/static reuse plus team tags, and staggered cached path planning.
- Existing wall-clock smoke record remains below its unchanged 8000 ms ceiling.
- Existing deterministic battle and river-pursuit records remain byte/behavior
  compatible and run repeatedly.
- Campaign and schema suites confirm performance changes did not alter saves,
  transitions, or known expected-failure state.
- Full suite reports no browser console/page errors.

## Done criteria

- [x] Synthetic 144 Hz produces roughly 60 updates, fewer than 80 draws, and no
      more than `updates + 2` draws; hidden watchdog produces no draw.
- [x] Direct test API calls, resize, initial boot, and scene/UI changes still
      produce a frame.
- [x] World 20-draw `beginPath` count is below 10,000; offscreen sentinel is not
      rendered; static path identities remain stable.
- [x] Battle 20-draw `beginPath` count is below 9,000; static/scratch identities
      remain stable; active scratch does not retain dead unit refs.
- [x] No `troops.includes` team lookup remains; units carry immutable correct
      team tags and separation constants/order are unchanged.
- [x] Party replans are seeded/staggered, planner scratch and goal visibility are
      reused, and line-clear burst bounds pass without approximate collision.
- [x] `npm run test:perf`, repeated legacy QA, persistence/schema suites, and
      `npm test` all exit 0 with no runtime errors.
- [x] The embedded 17 record names and the 8000 ms smoke budget are unchanged.
- [x] AUDIT-03 remains the sole active expected failure.
- [x] Documentation records every performance invariant and extension command.
- [x] No full-map bitmap, dependency, build step, gameplay constant, save schema,
      or out-of-scope file changed.
- [x] `git diff --check` exits 0 and Plan 006 is marked DONE.

## STOP conditions

Stop and report instead of improvising if:

- Current source no longer matches the excerpts or any performance gap was
  independently fixed in a materially different way.
- A structural performance test cannot be made deterministic without sleeping,
  disabling error capture, or asserting machine-specific milliseconds.
- Scheduler gating drops input edges, scene transitions, resize frames, pause/
  mute feedback, or synchronous test API rendering.
- Static caching changes seeded screenshots/visual hierarchy, requires a full
  world bitmap, exceeds the battle cache bound, or captures animated state.
- Scratch reuse changes depth order, HP-bar density, balloon selection, alert
  culling, combat determinism, or retains dead entities.
- Team tagging changes separation order/spacing or any unit can switch sides
  during a battle.
- Path optimization requires quantized/approximate river collision, changes a
  route decision, or causes any existing river-pursuit case to freeze.
- AUDIT-03 passes unexpectedly or fails for a setup/runtime reason.
- Any phase's focused/full verification fails twice after a reasonable correction.

## Maintenance notes

- Structural budgets are intentionally machine-independent. Review call counts,
  object identity, and algorithm shape before interpreting wall-clock noise.
- A future rendering rewrite must keep static cache memory bounded and animated
  layers separate. Do not trade CPU for an unbounded/full-map bitmap.
- Scratch arrays are safe only while scene update/draw is single-threaded and
  non-reentrant. Revisit ownership before workers, concurrent previews, or
  multiple battles.
- If unit counts grow enough that genuine O(U^2) separation becomes the next
  bottleneck, profile first and plan a spatial partition separately; this plan
  removes the accidental cubic multiplier only.
- If party counts/topology grow, profile before adding approximate caches. Exact
  river/bridge semantics and deterministic no-freeze coverage remain the higher
  priority.
