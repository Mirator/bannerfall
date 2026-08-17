# Plan 014: Establish Maintainable World and Battle Simulation Seams

**Status:** READY
**Priority:** Medium
**Effort:** L
**Risk:** High
**Audit finding:** #8
**Depends on:** Plans 009, 011, and 013
**Planned at:** `eaf282c`

## Objective

Reduce the regression surface of the two high-churn god modules by extracting coherent simulation phases behind named, testable seams and by making battle palette/configuration instance-owned. Preserve behavior and avoid an architectural rewrite.

## In Scope

- Break `World.update` and `Battle.update` into short orchestration methods with coherent phase helpers.
- Extract only low-coupling pure helpers/data where that materially clarifies ownership.
- Replace the mutable module-global battle palette with per-instance immutable or privately owned state.
- Add phase-level invariants/tests plus all existing semantic and visual regression coverage.
- Document ownership boundaries and extension points.

## Out of Scope

- ECS conversion, framework adoption, TypeScript migration, or wholesale class redesign.
- New gameplay behavior.
- Spatial indexing and scalability changes (Plan 015).
- Broad rendering redesign.

## Files to Modify

- `src/world.js`
- `src/battle.js`
- narrowly scoped new modules under `src/world/` and/or `src/battle/` when they have a clear single responsibility
- focused tests under `tests/e2e/`
- `tests/README.md`
- `AGENTS.md`
- `plans/014-world-battle-seams.md`
- `plans/README.md`

## Implementation Steps

1. Characterize live update ordering with tests for the sensitive boundaries: input before movement, collisions before result resolution, projectile damage before removal, spawn timers, retreat/defeat resolution, and one-result-only behavior.
2. Refactor `World.update` into a concise ordered pipeline of named phases such as hero movement/terrain, landmark interactions, party AI/encounters, and spawn/particle maintenance. Helpers may remain private methods when extracting a module would require a large mutable context object.
3. Refactor `Battle.update` into a concise ordered pipeline covering hero/input, allied units, enemy units, separation/collisions, projectiles/effects, and terminal result. Preserve exact ordering established in step 1.
4. Extract pure functions or stable data definitions only where imports remain acyclic and the API is small. Do not create generic manager/service abstractions.
5. Replace module-global mutable palette `P` with an instance-owned palette created from immutable defaults plus mode overrides. Every draw/helper must receive or access the owning battle's palette; constructing one battle may not mutate another battle's colors.
6. Add a two-instance palette isolation regression and phase-order/state regressions. Use deterministic and visual suites to catch mechanical-reference mistakes.
7. Record the final ownership map in `AGENTS.md`: which phase owns which arrays/timers, where terrain helpers live, and where future mechanics should be added.

## Acceptance Criteria

- Top-level World and Battle update methods read as ordered orchestration and are each no more than roughly 100 lines excluding comments/blank lines.
- No mutable module-global palette remains; two battle instances retain independent palettes.
- No circular imports or new runtime dependencies are introduced.
- Deterministic state, save/campaign behavior, visuals, and performance budgets remain unchanged within existing tolerances.
- New phase tests protect ordering that would otherwise be implicit.

## Verification

```powershell
npm run test:save
npm run test:campaign
npm run test:qa
npm run test:visual
npm run test:perf
npm test
git diff --check
```

## Drift Check

Re-measure file/update sizes and inspect palette ownership on the live branch. Preserve canonical terrain and split RNG domains from DONE dependencies. If dependency work already created suitable seams, extend those rather than creating parallel abstractions. Stop on behavior changes that cannot be characterized before refactoring.

## Rollback

Revert the commit as a unit. This plan should not alter persistence format or require data rollback.

