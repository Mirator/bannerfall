# Plan 007: Preserve Roaming Parties After Player Defeat

**Status:** DONE
**Priority:** High
**Effort:** S
**Risk:** Medium
**Audit finding:** #1
**Depends on:** Plan 006 (DONE)
**Planned at:** `eaf282c`

## Objective

Ensure an ordinary lost battle cannot silently delete a surviving roaming enemy party. The party must return to the world with exactly the surviving composition at the original encounter location, while existing camp-garrison and retreat behavior remains intact.

## In Scope

- Carry enough encounter metadata into battle resolution to reconstruct a roaming party.
- Restore surviving enemies after both retreat and ordinary defeat.
- Keep fully defeated parties removed.
- Convert the expected-failure campaign regression into a passing assertion.
- Document the lifecycle invariant and its regression-test entry point.

## Out of Scope

- Changing defeat penalties, teleport rules, battle balance, or camp behavior.
- Save-schema changes (Plan 008).
- Refactoring the wider World update loop (Plan 014).

## Files to Modify

- `src/world.js`
- `tests/e2e/campaign-persistence.spec.js`
- `tests/README.md`
- `AGENTS.md`
- `plans/007-defeat-party-restoration.md`
- `plans/README.md`

## Implementation Steps

1. In the roaming-party collision path in `World.update`, include the encounter party's world position and any state required for faithful reconstruction (at minimum `x`, `y`, `home`, `camp`, and composition) in `partyMeta` before removing it from `this.parties`.
2. Centralize roaming-party restoration in a small helper used by both the retreat and defeat paths. It must:
   - call `removeDead` on the post-battle enemy composition;
   - do nothing when no enemies survive;
   - restore at the encounter position, not the hero's post-defeat village position;
   - preserve the party's home/camp identity and produce a valid party object.
3. Leave camp-garrison restoration on its existing separate path. Do not create a free-roaming party for a camp battle.
4. Replace AUDIT-03's expected failure with exact assertions for remaining composition, party identity/home validity, and restoration location. Add a fully-wiped control case proving no party is recreated.
5. Update the QA documentation with the party lifecycle invariant and focused command.

## Acceptance Criteria

- Losing to a roaming party restores one valid party containing exactly the surviving enemies.
- The restored party is near the original encounter coordinates and not near the hero's defeat teleport unless those locations coincide.
- Retreat behavior remains correct and does not duplicate a party.
- Eliminating all enemies removes the party permanently.
- Camp battle resolution is unchanged.
- AUDIT-03 passes without `test.fail` or equivalent suppression.

## Verification

```powershell
npm run test:campaign
npm run test:qa
npm test
git diff --check
```

## Drift Check

Before editing, verify the roaming-party removal still occurs in `World.update`, `partyMeta` is still resolved in `World.resumeFromBattle`, and AUDIT-03 still records the expected failure. Changes from DONE dependency plans are expected; any unrelated semantic drift in these paths is a stop condition.

## Rollback

Revert the implementation commit. No persisted-data migration is introduced.
