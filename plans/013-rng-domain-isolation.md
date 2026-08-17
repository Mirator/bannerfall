# Plan 013: Isolate Gameplay and Presentation Randomness

**Status:** READY
**Priority:** Medium
**Effort:** M
**Risk:** Medium
**Audit finding:** #7
**Depends on:** Plan 011
**Planned at:** `eaf282c`

## Objective

Make deterministic gameplay outcomes independent from optional dust, particles, screen effects, and other presentation-only random draws. Identical seeds and inputs must produce identical simulation results even when effects are disabled or their density changes.

## In Scope

- Deterministically derived RNG streams for simulation, presentation, and existing camera shake where applicable.
- Classification and migration of every world/battle random call.
- Regression tests comparing outcomes with presentation effects enabled and disabled.
- Documentation for assigning future random draws to a domain.

## Out of Scope

- Changing combat balance or making multiplayer lockstep.
- Replacing the existing PRNG algorithm unless needed for seed derivation.
- General module decomposition (Plan 014).

## Files to Modify

- `src/engine.js`
- `src/world.js`
- `src/battle.js`
- relevant deterministic Playwright specs
- `tests/README.md`
- `AGENTS.md`
- `plans/013-rng-domain-isolation.md`
- `plans/README.md`

## Implementation Steps

1. Add a small deterministic seed-derivation helper with named integer domain constants. It must preserve the full supported seed range, including zero, and avoid JS string-hash/process randomness.
2. Construct explicit RNG streams per world/battle instance: simulation for decisions that can affect state/outcomes, presentation for purely visual emission/variation, and retain/derive a dedicated shake stream if current tests rely on it.
3. Audit every random draw. Arrow trajectory/spread, AI choices, spawn/navigation decisions, composition, and any random position influencing collisions belong to simulation. Particle angle/size/lifetime, dust, decorative jitter, and non-colliding debris belong to presentation.
4. Rename fields/parameters so domain intent is visible (`simRng`, `fxRng`, etc.). Do not leave a generic stream available in hot gameplay code.
5. Add a test hook that disables or changes effect emission without suppressing simulation calls. Run identical seeded scripted battles/world steps under both modes and compare canonical gameplay snapshots: positions, HP, composition, objectives, result, and simulation RNG state if exposed.
6. Re-run visual baselines. Only update snapshots for an intentional, reviewed visual-sequence change; gameplay snapshots must remain equivalent.
7. Document the rule and a short checklist for new random features.

## Acceptance Criteria

- Disabling particles/dust does not change gameplay outcomes for identical seeds and inputs.
- Adding presentation-only random draws cannot advance the simulation RNG.
- All current random calls are assigned to an explicit domain.
- Seed zero remains deterministic.
- Campaign, QA, visual, and performance suites pass.

## Verification

```powershell
npm run test:qa
npm run test:visual
npm run test:perf
npm test
git diff --check
```

## Drift Check

Inventory all live `rng`, `rand`, and random helper uses in `engine.js`, `world.js`, and `battle.js`. Plan 008's zero-seed fix and Plan 011's visual baselines are expected. Stop if unexplained new randomness cannot be classified safely.

## Rollback

Revert the commit. No save migration is required unless stream state was newly persisted; this plan should derive streams from existing stable seeds instead.

