# Plan 011: Add Deterministic Canvas Visual Regression Coverage

**Status:** READY
**Priority:** Medium
**Effort:** M
**Risk:** Low
**Audit finding:** #5
**Depends on:** Plan 009 and Plan 010
**Planned at:** `eaf282c`

## Objective

Detect unintended changes to the actual pixels players see in representative world and battle scenes, using deterministic state setup and reviewable Playwright screenshot baselines.

## In Scope

- Deterministic canvas screenshot tests for representative world and battle states.
- Stable viewport, device scale, animation/time control, seeds, and state transitions.
- Cross-platform-tolerant screenshot comparison without tolerating structural art regressions.
- A focused visual test command and baseline-update workflow.
- Documentation for intentional baseline review.

## Out of Scope

- Pixel-perfect coverage of every animation frame or device size.
- Replacing semantic/state assertions with screenshots.
- Redesigning visuals.

## Files to Modify

- `playwright.config.js`
- `tests/e2e/visual-regression.spec.js`
- committed snapshot PNGs under the Playwright snapshot convention
- `package.json`
- `tests/README.md`
- `AGENTS.md`
- `plans/011-canvas-visual-regression.md`
- `plans/README.md`

## Implementation Steps

1. Define a visual-test helper that loads the game at the canonical 1280x720 viewport/device scale, sets fixed seeds, advances only explicit fixed simulation steps, waits for fonts/layout readiness, and removes timing-dependent focus/cursor artifacts.
2. Capture at least four materially distinct art states: a seeded world overview, a road/river/bridge area, a small roaming-party battle, and a large/camp or bridge battle. Prefer canvas regions that exercise terrain, units, projectiles/obstacles, and HUD composition.
3. Use Playwright `toHaveScreenshot` with a platform-neutral snapshot path. Choose a documented threshold and maximum differing-pixel ratio from measured local repeatability; it must tolerate minor rasterization/font differences but fail on missing terrain, units, or major palette/layout shifts.
4. Prove determinism by running the visual suite repeatedly before accepting baselines. Keep screenshots at controlled settled frames rather than real-time waits.
5. Add `test:visual`; decide explicitly whether it belongs in the default CI command or a named CI step. It must run on every pull request, not only manually.
6. Document how to inspect diffs, update snapshots intentionally, and require human review of changed PNGs. Note that `--update-snapshots` is not a repair command.

## Acceptance Criteria

- Repeated local visual runs produce no diff.
- CI runs the visual suite and fails on a meaningful canvas regression.
- The baselines cover both world and battle rendering after deterministic setup.
- Existing semantic QA remains enabled and green.
- Snapshot tolerance is recorded with rationale in the test or documentation.

## Verification

```powershell
npm run test:visual
npm run test:visual
npm run test:qa
npm test
git diff --check
```

## Drift Check

Verify no screenshot assertions or committed canvas baselines already exist. Use the canonical geometry produced by Plan 009 and the CI policy from Plan 010. If rendering changed after this plan was written, regenerate only after confirming the live state is intended and deterministic.

## Rollback

Revert the test/config/baseline commit. No production runtime behavior should be included in this plan.

