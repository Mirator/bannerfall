# Plan 010: Fail CI on Flaky Playwright Results

**Status:** READY
**Priority:** Medium
**Effort:** S
**Risk:** Low
**Audit finding:** #6
**Depends on:** Plans 007-009
**Planned at:** `eaf282c`

## Objective

Keep one CI retry for diagnostic value while making any retry-dependent pass fail the workflow. Document how contributors reproduce and diagnose flaky tests.

## In Scope

- Enable Playwright's flaky-test failure policy in CI only.
- Preserve zero retries locally and one diagnostic retry in CI.
- Add a lightweight configuration contract check that cannot itself become flaky.
- Update QA/CI documentation.

## Out of Scope

- Quarantining known failures or increasing retry counts.
- Changing gameplay tests unrelated to the configuration contract.
- Visual snapshots (Plan 011).

## Files to Modify

- `playwright.config.js`
- `package.json`
- `.github/workflows/ci.yml`
- a small Node configuration-contract test under `tests/tooling/`
- `tests/README.md`
- `AGENTS.md`
- `plans/010-ci-flake-enforcement.md`
- `plans/README.md`

## Implementation Steps

1. Set `failOnFlakyTests` from the same explicit CI predicate used for retries. Local execution must remain strict with zero retries; CI must retry once and report a flaky pass as failure.
2. Add a dependency-free `node:test` contract that imports/evaluates the Playwright config under local and CI environments and asserts the retry and flaky-failure matrix. Restore process environment changes within the test.
3. Add a focused npm script for tooling/config checks and invoke it from the CI workflow before Playwright. Do not silently redefine the documented gameplay/performance scripts.
4. Document that CI retry output is diagnostic, never an acceptance mechanism, and show the focused local command.

## Acceptance Criteria

- CI configuration has `retries === 1` and `failOnFlakyTests === true`.
- Local configuration has `retries === 0` and does not falsely label a non-retried pass flaky.
- The configuration contract runs without launching a browser.
- Existing CI and local test commands continue to work.

## Verification

```powershell
npm run test:tooling
npm run test:qa
npm test
git diff --check
```

## Drift Check

Verify the CI workflow still invokes `npm test`, Playwright still derives retries from `process.env.CI`, and no flaky-failure policy already exists. Expected test changes from earlier DONE plans must be preserved.

## Rollback

Revert the commit; no runtime or saved-data behavior changes.

