# Plan 003: Version, validate, and migrate campaign saves

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d29e284..HEAD -- src/main.js src/world.js src/save.js tests/e2e/save-schema.spec.js tests/e2e/campaign-persistence.spec.js README.md AGENTS.md tests/README.md plans/README.md`
> If an in-scope path changed since this plan was written, compare the current
> excerpts below with the live files. A semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-persistence-nonvictory-coverage.md` (DONE)
- **Category**: bug, migration, tests, docs
- **Planned at**: commit `d29e284`, 2026-08-17
- **Audit mapping**: finding #4 (version and deeply validate campaign saves)

## Why this matters

`loadRun()` currently accepts any object with three numeric-looking fields,
two arrays, and all camp IDs. Nested troop, camp, party, statistics, and range
data can still be malformed and crash later dereferences such as
`UNIT_TYPES[t.type].hp`. There is also no schema version, so future changes
cannot distinguish a migratable old save from an incompatible future save.

This plan creates one pure save boundary with an explicit current version,
migrates the unversioned format already in players' browsers, rejects corrupt
or future data before `World` sees it, and documents the compatibility policy.
It must preserve the static native-module runtime: no production dependency or
build step is allowed.

## Current state

- `src/main.js:7-16` owns a shallow validator:

  ```js
  function isValidSave(save) {
    if (!save || typeof save !== 'object') return false;
    if (typeof save.gold !== 'number' || typeof save.x !== 'number' || typeof save.y !== 'number') return false;
    if (!Array.isArray(save.troops) || !Array.isArray(save.camps)) return false;
    const ids = new Set(save.camps.map(c => c && c.id));
    return WORLD.camps.every(c => ids.has(c.id));
  }
  ```

- `src/main.js:55-63` parses storage and clears only data that reaches the
  shallow validator. Malformed JSON is caught but left in storage:

  ```js
  loadRun() {
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (!raw) return null;
      const save = JSON.parse(raw);
      if (!isValidSave(save)) { this.clearRun(); return null; }
      return save;
    } catch (e) { return null; }
  }
  ```

- `src/world.js:17-35` creates unversioned new saves and performs two ad-hoc
  legacy repairs in the scene constructor:

  ```js
  this.save = save || {
    gold: BALANCE.startGold,
    heroHp: HERO.hp, heroMaxHp: HERO.hp,
    troops: Array.from({ length: BALANCE.startTroops }, () => ({ type: 'spear' })),
    armyCap: BALANCE.armyCapBase,
    camps: WORLD.camps.map(c => ({ id: c.id, razed: false })),
    won: false,
    x: WORLD.heroStart.x, y: WORLD.heroStart.y,
    parties: null,
    runSeed: game.testSeed != null ? game.testSeed : (Math.random() * 1e9) | 0,
    stats: { won: 0, kills: 0, lost: 0, playT: 0 },
    hard: !!game.hardNext,
  };
  if (!this.save.stats) this.save.stats = { won: 0, kills: 0, lost: 0, playT: 0 };
  if (!this.save.runSeed) this.save.runSeed = 777;
  ```

- Nested values are trusted later. Examples include
  `src/battle.js:160-165`, where an unknown troop type makes `d` undefined,
  and `src/world.js:509`, which reads `UNIT_TYPES[t.type].hp`.
- `src/data.js` exports the canonical `WORLD`, `UNIT_TYPES`, `ENEMY_TYPES`,
  `HERO`, and `BALANCE` definitions. The save boundary must import these rather
  than copying camp/type IDs or default balance numbers.
- Browser persistence conventions and save-slot isolation are documented in
  `AGENTS.md` and `tests/README.md`. Model new E2E setup on
  `tests/e2e/campaign-persistence.spec.js:13-32` and always use isolated
  Playwright contexts with the real `bf_save` slot through `window.__g`.
- Baseline at `d29e284`: `npm test` exits 0 with nine Playwright tests. Three
  are active expected failures (AUDIT-02, AUDIT-03, AUDIT-05).

## Target compatibility contract

Create `src/save.js` as the sole load-time schema boundary. Export:

- `SAVE_VERSION`, initially integer `1`;
- `migrateSave(candidate)`, returning a newly constructed canonical save object
  or `null` without mutating the input;
- `parseSave(raw)`, returning the same canonical object or `null` for malformed
  JSON or invalid data.

The exact contract is:

1. A missing `version` is legacy version 0. Version 0 is accepted only when it
   satisfies the old minimum shape: finite `gold`, `x`, and `y`; arrays for
   `troops` and `camps`; and exactly one entry for every current `WORLD.camps`
   ID. Missing optional fields are migrated to the defaults listed below.
2. Version 1 is the current shape. A version greater than 1, a negative/non-
   integer version, duplicate/missing/unknown camp IDs, an unknown unit/enemy
   type, or an invalid required nested value returns `null`.
3. Reconstruct and return only known fields; do not spread arbitrary input
   properties into the result.
4. All numbers must be `Number.isFinite`. Counts/currency/seeds are integers;
   counters and gold are non-negative. Coordinates must be inside
   `0..WORLD.w` and `0..WORLD.h`. `heroMaxHp` is positive, `heroHp` is within
   `0..heroMaxHp`, `armyCap` is at least `BALANCE.armyCapBase` and at least the
   troop count, and optional troop HP is within `0..UNIT_TYPES[type].hp`.
5. Troops must contain known `UNIT_TYPES`. Camp garrisons and party `comp`
   arrays must contain known `ENEMY_TYPES`; every party `camp` must name a
   current `WORLD.camps` ID. Camp `razed`, `won`, and `hard` are booleans.
   Party/home coordinates use the same finite map bounds; `waryT` is a
   non-negative finite number.
6. `stats` contains finite non-negative `won`, `kills`, `lost`, and `playT`;
   the first three are integers. `battleCount` is a non-negative integer.
   `toast` is absent/null or a string.
7. Legacy defaults are: `heroHp`/`heroMaxHp` from `HERO.hp`, `armyCap` from
   `BALANCE.armyCapBase` (raised to troop count if necessary), `won=false`,
   `parties=null`, `runSeed=777`, zeroed stats, `hard=false`,
   `battleCount=0`, and no toast. Preserve valid supplied values.
8. The returned object always has `version: SAVE_VERSION`. A migrated save is
   written back as version 1 by the existing `startWorld()` -> `persistRun()`
   path after Continue.

Do not silently delete one bad troop/party or clamp corrupt values into range.
Reject the whole payload. Defaults are only for fields that were genuinely
optional in the unversioned legacy format.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Browser | `npx playwright install chromium` | exit 0 |
| Schema coverage | `npx playwright test tests/e2e/save-schema.spec.js` | all schema tests pass normally |
| Campaign coverage | `npx playwright test tests/e2e/campaign-persistence.spec.js` | exit 0; existing expected failures remain expected |
| Full gate | `npm test` | exit 0; no page/console errors |
| Diff hygiene | `git diff --check` | no output, exit 0 |

## Scope

**In scope** (the only files to modify):

- `src/save.js` (create)
- `src/main.js`
- `src/world.js`
- `tests/e2e/save-schema.spec.js` (create)
- `tests/e2e/campaign-persistence.spec.js` (only version-aware fixture/assertion updates)
- `README.md`
- `AGENTS.md`
- `tests/README.md`
- `plans/README.md` (status only)

**Out of scope** (do not touch):

- `src/battle.js`, `src/data.js`, or gameplay balance/content.
- Fixing AUDIT-02, AUDIT-03, or AUDIT-05 or removing any of their three
  `test.fail` annotations.
- Save import/export UI, cloud storage, multiple save slots, battle resume, or
  user-facing corruption recovery UI.
- Cache-token automation; use the repository's existing `?v=r10` convention
  for the new native-module import without changing unrelated tokens.
- New runtime dependencies or a production build step.

## Git workflow

- Branch: `codex/save-schema-v1`
- One logical commit is acceptable; match imperative history such as
  `Add campaign persistence regression coverage`.
- Do not push, merge, or open a PR unless explicitly instructed.

## Steps

### Step 1: Add the pure versioned save boundary

Create `src/save.js` importing current constants/types from `src/data.js?v=r10`.
Implement small private predicates/helpers (plain object, finite number,
non-negative integer, bounded coordinate, known typed arrays) and the three
exports described in the target contract. Reconstruct nested arrays/objects so
the returned object is detached from its input. Preserve optional troop `hp`,
camp `garrison`, party `home`, `waryT`, and optional toast only after validation.

Keep migration sequential even though only v0 -> v1 exists: first identify the
source version, apply v0 defaults, then validate/build v1. This gives a future
v1 -> v2 migration an obvious insertion point. Do not use exceptions for normal
validation failure.

**Verify**:
`rg -n "SAVE_VERSION|migrateSave|parseSave|UNIT_TYPES|ENEMY_TYPES|WORLD" src/save.js`
-> all three exports and production type sources are present; copied literal
lists of camp/unit/enemy IDs are absent.

### Step 2: Route creation and loading through the schema version

In `src/main.js`, remove `isValidSave`, import `parseSave`, remove `WORLD` from
the data import if it has no remaining caller, and make `loadRun()`:

1. read `this.saveKey` once;
2. return `null` when there is no value;
3. parse/migrate through `parseSave`;
4. clear the same slot and return `null` for every invalid payload, including
   malformed JSON;
5. return the canonical detached save otherwise.

Do not change `saveKey` or test-mode isolation.

In `src/world.js`, import `SAVE_VERSION`, add `version: SAVE_VERSION` to a new
save, and remove the constructor's ad-hoc `stats`/`runSeed` repairs. Those
defaults now belong to the migration boundary; fresh saves already provide
them. Existing in-memory battle transitions continue passing the same canonical
object back to `startWorld(save)`.

**Verify**:
`rg -n "isValidSave|JSON.parse\(raw\)|if \(!this\.save\.(stats|runSeed)" src/main.js src/world.js`
-> no matches, and
`rg -n "parseSave|SAVE_VERSION|version:" src/main.js src/world.js src/save.js`
-> the loader, fresh-save writer, and schema module are wired.

### Step 3: Add deterministic schema and migration coverage

Create `tests/e2e/save-schema.spec.js`. Follow the runtime-error collection and
raw `window.__g` storage conventions from the campaign spec. Add named tests for:

1. a fresh run stores `version: 1`;
2. a valid unversioned save with all current camp IDs migrates missing optional
   fields, continues into `world`, and is rewritten as version 1;
3. a complete version-1 save round-trips without losing valid troop HP, camp
   garrison, party/home/wary state, stats, hard mode, seed, or battle count;
4. malformed JSON is cleared and cannot Continue;
5. an unknown future version is cleared;
6. missing, duplicate, and unknown camp IDs are rejected (table-driven cases
   are fine within one named test);
7. unknown troop, garrison-enemy, and party-enemy types are rejected;
8. invalid nested shapes and numeric ranges (at minimum out-of-map coordinates,
   negative counters, hero HP above max, invalid troop HP) are rejected.

Each rejection test must assert `loadRun()` returns null and the real `bf_save`
slot is removed. Do not call `window.game`, which would switch to
`bf_save_test`. Each test collects and asserts no runtime errors.

Update the existing current-schema campaign round-trip to assert the stored and
restored save version, and replace any artificial party camp ID with a real
`WORLD.camps` ID if strict validation makes the fixture invalid. Preserve the
behavioral intent and uniqueness using a distinctive valid composition/home,
not a fake schema identifier.

**Verify**:
`npx playwright test tests/e2e/save-schema.spec.js` -> all schema tests pass,
with no expected-failure annotations, skips, or fixmes.

### Step 4: Document the version and migration contract

Update:

- `README.md`: add a short Save compatibility subsection linking to
  `src/save.js` as the canonical schema/migration implementation and
  `tests/README.md` for fixture guidance.
- `AGENTS.md`: require any save-field change to increment/migrate deliberately,
  update both fresh defaults and validation, add legacy/current/malformed
  fixtures, preserve `bf_save`/`bf_save_test` isolation, and run the focused
  schema plus campaign specs.
- `tests/README.md`: document v0 (unversioned) -> v1 behavior, rejection of
  unknown future/corrupt saves, the focused schema command, and how to construct
  valid fixtures from production IDs instead of inventing types/camps.

Do not duplicate the complete schema field list into several documents; keep
`src/save.js` authoritative and document maintenance rules and test commands.

**Verify**:
`rg -n "save-schema|SAVE_VERSION|unversioned|migration|bf_save_test" README.md AGENTS.md tests/README.md`
-> each audience can find the contract and command.

### Step 5: Run the complete gate and close the plan

Run the focused schema spec, campaign spec, and full suite. Confirm the campaign
spec still has exactly three `test.fail` annotations for AUDIT-02, AUDIT-03,
and AUDIT-05. Inspect browser output for page/console failures. Update only Plan
003's index status to DONE.

**Verify**:

```text
npx playwright test tests/e2e/save-schema.spec.js
npx playwright test tests/e2e/campaign-persistence.spec.js
npm test
rg -c "test.fail" tests/e2e/campaign-persistence.spec.js
git diff --check
git status --short
```

Expected: all commands exit 0; the count is exactly `3`; only in-scope paths
are modified.

## Test plan

- New browser E2E coverage in `tests/e2e/save-schema.spec.js` for fresh v1,
  unversioned migration, full v1 preservation, malformed JSON, future version,
  camp topology, known type validation, and numeric/nested bounds.
- Existing campaign round-trip remains green and becomes explicitly
  version-aware.
- Existing 17-record legacy QA remains unchanged and green.
- AUDIT-02, AUDIT-03, and AUDIT-05 remain running expected failures.

## Done criteria

- [ ] `src/save.js` is the only load-time validator/migrator and exports
      `SAVE_VERSION`, `migrateSave`, and `parseSave`.
- [ ] Fresh and migrated saves serialize with version 1.
- [ ] Invalid JSON, future versions, unknown IDs/types, bad nested shapes, and
      invalid numeric ranges return null and clear the active save slot.
- [ ] The unversioned format migrates documented optional defaults without
      mutating or silently dropping valid supplied state.
- [ ] `World` no longer performs ad-hoc loaded-save repairs.
- [ ] Focused schema and campaign specs plus `npm test` exit 0 with no runtime
      errors.
- [ ] Exactly three existing expected failures remain; none are skipped/fixed.
- [ ] README, AGENTS, and test documentation explain the compatibility workflow.
- [ ] No production dependency/build step or out-of-scope file changed.
- [ ] `git diff --check` exits 0 and Plan 003 is marked DONE.

## STOP conditions

Stop and report instead of improvising if:

- Current production code no longer matches the excerpts or another schema
  module/version already exists.
- A legitimate save produced by `d29e284` cannot fit the target contract without
  discarding state not listed here.
- Tests reveal production can emit an unknown troop/enemy/camp ID.
- Correct migration requires guessing whether a missing camp was razed; reject
  that payload rather than inventing campaign progress and report the conflict.
- Strict validation breaks a non-test gameplay path and fixing it requires
  changing battle/world rules or data definitions.
- Any AUDIT-02, AUDIT-03, or AUDIT-05 expected failure unexpectedly passes or
  fails for a new setup/runtime reason.
- Verification fails twice after a reasonable correction.

## Maintenance notes

- Every future schema change must decide whether old values can be migrated or
  must be rejected, increment `SAVE_VERSION` when the serialized meaning/shape
  changes, and retain fixtures for every supported source version.
- Reviewers should scrutinize defaulting versus rejection. Missing legacy
  optionals may default; malformed supplied values must not be silently fixed.
- Keep validation pure and detached from localStorage/UI. `Game.loadRun()` owns
  slot clearing; `src/save.js` owns shape/version decisions.
- This plan deliberately does not repair stale live snapshots or battle-entry
  persistence. Plans 004 and 005 build on this boundary.
