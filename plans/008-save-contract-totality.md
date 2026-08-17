# Plan 008: Make the Save Contract Total and Battle-Stat Safe

**Status:** DONE
**Priority:** High
**Effort:** M
**Risk:** Medium
**Audit finding:** #3
**Depends on:** Plan 007
**Planned at:** `eaf282c`

## Objective

Make every save accepted by validation safe to load and play. Introduce an explicit schema migration for legacy party homes, propagate saved hero maximum HP into battle, and preserve the valid zero seed instead of replacing it through truthiness defaults.

## In Scope

- Advance the current save schema version and migrate supported legacy versions.
- Require runtime-critical roaming-party fields in the current schema.
- Derive missing legacy party homes from canonical camp data during migration.
- Validate numerical bounds and structural relationships needed by runtime code.
- Honor `heroMaxHp` in battle setup and clamp current HP consistently.
- Replace seed truthiness fallbacks with nullish/explicit fallbacks.
- Add adversarial schema, migration, round-trip, and gameplay tests.

## Out of Scope

- Redesigning the save format or adding cloud/multiple saves.
- Changing balance values or the upgrade economy.
- Party lifecycle changes covered by Plan 007.

## Files to Modify

- `src/save.js`
- `src/world.js`
- `src/battle.js`
- `tests/e2e/save-schema.spec.js`
- `tests/e2e/campaign-persistence.spec.js`
- `tests/README.md`
- `AGENTS.md`
- `plans/008-save-contract-totality.md`
- `plans/README.md`

## Implementation Steps

1. Increment `SAVE_VERSION` and define the current schema so all runtime-dereferenced fields are mandatory. In particular, current-version roaming parties must have a finite two-number `home`, valid composition, finite coordinates, and valid optional camp identity.
2. Implement deterministic migration from each supported older version. For a legacy party without `home`, derive it from the referenced canonical camp; reject the save when this cannot be derived safely. Migration must return a fresh current-version object and pass it through the same validator as a native current save.
3. Audit validator predicates for finite numbers, non-negative integer counts, bounded HP/max-HP relationships, and IDs used as array indices. Reject malformed current-version states instead of repairing them implicitly.
4. Thread the saved maximum HP into `World.startBattle` and `Battle`. Remove hardcoded reset to base `HERO.hp`; initialize battle hero maximum/current HP from validated state and clamp current HP to the maximum.
5. Replace `seed || fallback` and equivalent valid-zero bugs in world/battle load paths with `??` or explicit validation-backed selection.
6. Add tests for v0/v1 migration, missing legacy home derivation, an invalid current save with missing home, hostile numeric values, zero-seed preservation, upgraded maximum HP in battle, and current-version round-trip.
7. Document supported versions, migration policy, validator totality, and the focused verification commands.

## Acceptance Criteria

- Loading any save that passes validation does not throw in the immediate world frame or battle entry paths covered by tests.
- Legacy supported saves migrate deterministically to the current version.
- A current-version party without a valid home is rejected.
- Saved maximum HP is honored in battle and survives a battle round trip.
- Seed `0` remains seed `0` across new/load/battle transitions.
- Existing valid saves and campaign tests continue to pass.

## Verification

```powershell
npm run test:save
npm run test:campaign
npm run test:qa
npm test
git diff --check
```

## Drift Check

Verify `SAVE_VERSION`, `migrateSave`, current validators, `World.startBattle`, and Battle hero initialization still match the audited responsibilities. Plan 007 changes to battle-result party metadata are expected and must be preserved. Stop on other unexplained changes to persistence semantics.

## Rollback

Revert the commit. Because this introduces a new on-disk version, do not partially roll back only the reader or only the writer.

## Completion Notes

- `SAVE_VERSION` is now 2. Unversioned (v0) and version-1 saves migrate through
  the same canonical validator; v1 parties without `home` derive it from the
  matching production camp. Current v2 parties require a valid finite home and
  non-empty enemy composition.
- Hero maximum/current HP is validated and propagated into battle setup, and
  world/battle seed defaults preserve valid zero values with nullish selection.
- Focused browser coverage now includes migration, malformed v2 rejection,
  zero-seed persistence, and upgraded hero maximum HP in battle.
- Verification: `npx playwright test tests/e2e/save-schema.spec.js`,
  `npx playwright test tests/e2e/campaign-persistence.spec.js`, `npm test`, and
  `git diff --check`.
