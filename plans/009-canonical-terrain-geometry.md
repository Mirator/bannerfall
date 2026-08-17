# Plan 009: Unify Rendered and Simulated Terrain Geometry

**Status:** READY
**Priority:** High
**Effort:** M
**Risk:** Medium
**Audit finding:** #2
**Depends on:** Plans 007-008
**Planned at:** `eaf282c`

## Objective

Define roads and rivers once and use the same sampled geometry for rendering, water collision, bridge traversal, road speed bonuses, and navigation checks. Remove invisible road bonuses and mismatches between curved visuals and straight collision chords.

## In Scope

- A canonical terrain-geometry representation derived from seeded world landmarks.
- Deterministic curve sampling shared by drawing and simulation.
- Exact agreement between visible road set and road-bonus set.
- River collision and bridge exceptions against the rendered course.
- Focused geometry regressions plus existing gameplay/performance coverage.

## Out of Scope

- Changing the map art direction, landmark generation, or balance values.
- General World decomposition (Plan 014).
- Spatial indexing for battle entities (Plan 015).

## Files to Modify

- `src/world.js`
- `tests/e2e/qa-audit.spec.js` or a new focused terrain spec
- `tests/README.md`
- `AGENTS.md`
- `plans/009-canonical-terrain-geometry.md`
- `plans/README.md`

## Implementation Steps

1. Replace independently maintained draw/simulation road lists with one declarative road definition list. Preserve the four intended visible connections unless a test proves a different product intent; no fifth invisible chord may receive a bonus.
2. Add a deterministic quadratic-curve sampler that includes both endpoints and uses a documented segment count or maximum step length. Build canonical polylines once per world initialization, not per frame.
3. Make terrain rendering consume those polylines. If smooth Canvas curves remain desirable, their control data must come from the same definition and the simulation polyline tolerance must be demonstrably smaller than collision/bonus widths.
4. Make `nearRiver`, road proximity/bonus logic, navigation validation, and bridge exceptions query the canonical polylines. Keep existing gameplay widths unless correcting the audited mismatch requires an explicitly tested adjustment.
5. Add deterministic tests that sample points on curved visible sections and prove rendering/simulation membership, verify the former invisible road chord gives no bonus, verify river centers block traversal away from bridges, and verify bridge corridors remain traversable.
6. Confirm geometry is cached and does not regress the established performance budgets.
7. Document the single-source-of-truth rule and how to add or test a road/river safely.

## Acceptance Criteria

- Every road that grants a movement bonus is rendered, and every intended rendered road grants it within the documented width.
- River collision follows the rendered curve within a tolerance smaller than the collision width.
- Bridge exceptions open only the intended crossing corridors.
- Canonical geometry is constructed outside the render/update hot path.
- Existing deterministic world, navigation, QA, and performance tests pass.

## Verification

```powershell
npm run test:qa
npm run test:perf
npm test
git diff --check
```

## Drift Check

Verify the audited mismatch still exists between the road/river drawing code and `nearRiver`/road proximity code. Preserve save-contract and party-resolution changes from Plans 007-008. Stop if a dependency has already introduced a canonical representation; update this plan rather than duplicating it.

## Rollback

Revert the commit; the change has no persistence-format effect.

