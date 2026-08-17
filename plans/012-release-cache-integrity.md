# Plan 012: Enforce Release Cache-Token Integrity

**Status:** READY
**Priority:** Medium
**Effort:** S
**Risk:** Low
**Audit finding:** #4
**Depends on:** Plan 010
**Planned at:** `eaf282c`

## Objective

Ensure GitHub Pages clients cannot retain a mixed or stale JavaScript module graph after releases. Replace the manually forgotten `r10` convention with a deterministic, repository-verified release token and a documented bump/check workflow.

## In Scope

- A consistent version token across `index.html` and static module imports.
- A dependency-free checker that detects stale or inconsistent tokens after source changes.
- CI integration and an ergonomic token-update command.
- Documentation for release/cache behavior.

## Out of Scope

- Introducing a bundler, service worker, CDN, or runtime dependency.
- Changing GitHub Pages hosting.

## Files to Modify

- `index.html`
- versioned imports under `src/`
- `scripts/check-release-cache.mjs`
- `scripts/update-release-cache.mjs` if separate from the checker
- `package.json`
- `.github/workflows/ci.yml`
- `AGENTS.md`
- `tests/README.md`
- `plans/012-release-cache-integrity.md`
- `plans/README.md`

## Implementation Steps

1. Define a deterministic release token from the normalized contents of deployable JavaScript files. Normalize existing `?v=...` substrings before hashing so the token does not depend circularly on itself.
2. Add a checker that enumerates the same deployable module graph, computes the expected token, and fails when any entry/import token is missing, inconsistent, or stale. Use Node built-ins only and stable path/content ordering.
3. Add an update command that rewrites only recognized version-token locations to the computed token, then re-runs the checker. It must fail safely on unexpected import syntax rather than broad replacement.
4. Replace all legacy `r10` references using the updater and verify every static import reachable from `index.html` is covered.
5. Add `test:release` and run it in CI. Document: modify source, run the updater, review token-only changes, then test/commit.
6. Explain the Pages `max-age` interaction and why graph-wide consistency matters for transitive ES modules.

## Acceptance Criteria

- Changing any deployable JS source without updating tokens makes `test:release` fail.
- The updater produces one stable token across repeated runs.
- Every static browser module edge uses that token; no `r10` remains.
- No bundler/runtime dependency is introduced.
- CI enforces the checker.

## Verification

```powershell
npm run release:cache
npm run test:release
npm run test:tooling
npm test
git diff --check
```

## Drift Check

Verify browser imports still use a shared `?v=r10` token and that no build pipeline now fingerprints assets. Preserve CI enforcement from Plan 010. If Plan 011 adds test-only imports, include only deployable browser modules in the release graph.

## Rollback

Revert the commit as one unit so checker expectations and deployed tokens cannot diverge.

