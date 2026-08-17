# Plan 015: Bound Battle Simulation Scaling with Spatial Broad Phases

**Status:** READY
**Priority:** Medium (explicit audit item #9; high future impact)
**Effort:** L
**Risk:** High
**Audit finding:** #9
**Depends on:** Plan 014
**Planned at:** `eaf282c`

## Objective

Remove avoidable quadratic scaling in large battles while preserving exact gameplay semantics at current army sizes. Introduce reusable spatial broad phases for target selection and separation, replace quadratic active-prefix ordering, and add scale-sensitive regression budgets.

## In Scope

- Per-step spatial indexes for active troops, enemies, and relevant obstacles.
- Radius/nearest queries that preserve exact distance/tie behavior.
- Neighbor-only separation with each unordered pair resolved once.
- A bounded-complexity active-prefix ordering strategy.
- Structural work counters and representative stress/performance tests.
- Documentation for index lifecycle and performance budgets.

## Out of Scope

- Raising army caps or changing balance solely to showcase the optimization.
- GPU/Web Worker migration, object pooling redesign, or rendering overhaul.
- Approximate targeting that changes outcomes.

## Files to Modify

- `src/battle.js`
- a narrowly scoped spatial-index module under `src/battle/`
- `tests/e2e/performance.spec.js`
- deterministic battle/QA specs as needed
- `tests/README.md`
- `AGENTS.md`
- `plans/015-battle-spatial-scalability.md`
- `plans/README.md`

## Implementation Steps

1. Add deterministic stress fixtures and diagnostic counters before optimizing. Count candidate distance checks, separation pairs, obstacle candidates, and active ordering operations at small/current/large populations; retain wall-clock thresholds only as a coarse guard.
2. Implement a reusable uniform-grid or spatial-hash broad phase with fixed cell sizing derived from maximum interaction radii. Rebuild/reuse storage once per appropriate simulation phase without per-entity allocations in the hot loop.
3. Replace repeated full-array nearest-target scans with spatial queries. The returned target must match brute force for randomized deterministic fixtures, including equal-distance tie rules and effectively unbounded search cases.
4. Replace all-pairs troop/enemy separation with neighboring-cell candidates. Resolve each unordered eligible pair exactly once and preserve faction/collision rules and update ordering.
5. Index static obstacles or precompute their spatial buckets so unit-obstacle collision queries do not scan every obstacle per unit when counts grow.
6. Replace insertion sorting of large active prefixes with a deterministic O(n log n) in-place strategy or another measured bounded approach. Preserve draw order/tie behavior and avoid reintroducing hot-path allocation churn.
7. Add brute-force equivalence tests at small sizes, deterministic outcome tests at current sizes, and structural scaling assertions showing candidate work grows near-linearly for spatially distributed 400-1000 unit scenarios rather than approaching all-pairs counts.
8. Re-run the existing current-size performance scenario and visual suite. Reject the change if normal-size overhead materially worsens established budgets without a measured justification.
9. Document grid ownership, rebuild points, cell-size assumptions, counters, and how to extend queries safely.

## Acceptance Criteria

- Optimized nearest queries match brute force in deterministic equivalence tests.
- Separation never double-applies a pair and preserves current scenario outcomes.
- At 400+ spatially distributed units, candidate checks are a small documented fraction of the naive quadratic count.
- The audited 1000-unit update no longer exhibits the prior quadratic growth trend, while current 25-unit performance remains within existing limits.
- No unbounded army-size behavior is silently changed and no runtime dependency is added.

## Verification

```powershell
npm run test:qa
npm run test:visual
npm run test:perf
npm test
git diff --check
```

## Drift Check

Inspect the live phase seams from Plan 014 and inventory all full active-array scans, separation loops, obstacle loops, and insertion sorts. Update exact integration points to those seams. Stop if targeting/order semantics are not covered by characterization tests before replacing algorithms.

## Rollback

Revert the commit. Keep stress fixtures only if they remain valid against the pre-optimization implementation and do not make the standard suite impractical.

