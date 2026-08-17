# Plan 004: Synchronize live world state before every save

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d29e284..HEAD -- src/main.js src/world.js tests/e2e/campaign-persistence.spec.js AGENTS.md tests/README.md plans/README.md`
> Plan 003 is expected to have changed some in-scope files. First require Plan
> 003 to be DONE and its full gate green, then compare the excerpts below. Any
> additional semantic mismatch is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/003-version-validate-migrate-saves.md`
- **Category**: bug, tests, docs
- **Planned at**: commit `d29e284`, 2026-08-17
- **Audit mapping**: finding #2 / AUDIT-02

## Why this matters

The campaign mutates hero and roaming-party positions on live `World` objects,
but periodic and pause saves serialize the older `scene.save` snapshot. A
refresh can therefore rewind the hero and parties by minutes or restore parties
at obsolete locations. Plan 002 already runs the exact regression on every
gate as an expected failure; this plan makes one live-state synchronization
method authoritative and retires only AUDIT-02.

## Current state

- `src/main.js:50-53` writes `scene.save` directly:

  ```js
  persistRun() {
    if (this.sceneName === 'world' && this.scene && this.scene.save && !this.scene.save.won) {
      try { localStorage.setItem(this.saveKey, JSON.stringify(this.scene.save)); } catch (e) {}
    }
  }
  ```

- That writer is used on initial world start (`src/main.js:66-72`), pause
  (`src/main.js:94-98`), and every four simulation seconds
  (`src/main.js:124-129`).
- `src/world.js:37` creates a separate live hero from saved coordinates.
- `src/world.js:118-120` already knows how to copy live parties into the save:

  ```js
  persistParties() {
    this.save.parties = this.parties.map(p => ({ camp: p.camp, x: p.x, y: p.y, comp: p.comp, home: p.home, waryT: p.waryT || 0 }));
  }
  ```

  It does not copy `hero.x/y`, and `Game.persistRun()` does not call it.
- `src/world.js:382-386` manually copies hero coordinates and parties only when
  a battle begins, which proves these fields are live-scene state rather than
  continuously updated save fields.
- `tests/e2e/campaign-persistence.spec.js:233-252` is the active regression. It
  changes only live hero/party coordinates, calls production `persistRun()`, and
  expects storage to equal the live scene. `test.fail` currently marks the known
  defect.
- After Plan 003, stored saves must remain valid versioned saves. Reuse its
  schema; do not add another serializer or validator.

## Target design

Add a `World.syncLiveStateToSave()` method which:

1. copies `this.hero.x/y` into `this.save.x/y`;
2. calls the existing `persistParties()` so its field selection remains the
   single party serialization definition;
3. returns `this.save` for the caller to serialize.

`Game.persistRun()` must call this method immediately before `JSON.stringify`
whenever the active scene is a non-won world. Initial, explicit, pause, and
timer saves all continue through this one method. Do not update `save.x/y` on
every movement tick; snapshot only at persistence boundaries.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Focused regression | `npx playwright test tests/e2e/campaign-persistence.spec.js -g "AUDIT-02"` | one normal passing test |
| Campaign suite | `npx playwright test tests/e2e/campaign-persistence.spec.js` | exit 0; AUDIT-03 and AUDIT-05 remain expected failures |
| Full gate | `npm test` | exit 0; no runtime errors |
| Diff hygiene | `git diff --check` | no output, exit 0 |

## Scope

**In scope** (the only files to modify):

- `src/main.js`
- `src/world.js`
- `tests/e2e/campaign-persistence.spec.js`
- `AGENTS.md`
- `tests/README.md`
- `plans/README.md` (status only)

**Out of scope** (do not touch):

- The Plan 003 schema/migration rules or `src/save.js`.
- Battle-entry persistence (AUDIT-05); Plan 005 owns it.
- Roaming-party restoration after defeat (AUDIT-03).
- Autosave cadence, visibility/page lifecycle hooks, storage-error UI, multiple
  slots, cloud saves, or battle resume.
- Per-frame mutation of serialized hero/party fields.
- Gameplay balance, AI movement, or party composition rules.

## Git workflow

- Branch: `codex/live-save-snapshot`
- Commit message style: imperative, for example
  `Synchronize live world state before saving`.
- Do not push, merge, or open a PR unless explicitly instructed.

## Steps

### Step 1: Establish the authoritative live snapshot method

In `src/world.js`, add `syncLiveStateToSave()` adjacent to
`persistParties()`. It must copy hero position, delegate party copying to
`persistParties()`, and return the same canonical save object. Do not clone the
whole scene and do not include transient velocity, facing, wander path, camera,
particles, or input state.

Keep `persistParties()` public because existing battle and test paths use it.
Do not duplicate its mapping in the new method.

**Verify**:
`rg -n "syncLiveStateToSave|persistParties\(\)|save\.x = this\.hero\.x|save\.y = this\.hero\.y" src/world.js`
-> one synchronization method delegates to the existing party method.

### Step 2: Make every world save synchronize immediately before serialization

In `Game.persistRun()` (`src/main.js`), retain the current scene/won guard and
save-key isolation, but obtain the serialized value from
`this.scene.syncLiveStateToSave()`. Call it inside the guarded path immediately
before `JSON.stringify`/`localStorage.setItem`.

The source of truth at that instant is:

- live `World.hero` for map coordinates;
- live `World.parties` for roaming-party persistence;
- `World.save` for gold, troops, camp progress, stats, mode, schema version,
  and other campaign fields.

Preserve the current no-throw behavior if localStorage is unavailable. Do not
change the timer, pause behavior, save key, or won-save clearing.

**Verify**:
`rg -n "persistRun\(|syncLiveStateToSave\(\)|JSON.stringify" src/main.js`
-> `persistRun()` synchronizes once before the only world-save serialization.

### Step 3: Promote AUDIT-02 from expected failure to regression

In `tests/e2e/campaign-persistence.spec.js`, remove only the AUDIT-02
`test.fail(...)` call. Preserve the name/reference and core assertion. Strengthen
the test so it proves both persistence entry paths:

1. explicit `window.__g.persistRun()` stores live hero and party coordinates;
2. after changing live coordinates again without touching `scene.save`, reset
   `saveTimer` and advance exactly enough deterministic fixed steps to cross the
   four-second autosave boundary; storage matches the live state at that
   boundary;
3. reload, Continue, and assert the world restores those stored coordinates.

Control the party fixture so the timer assertion compares the position at the
actual save boundary, not a later moving position. Advancing approximately
`4.01` seconds through the existing fixed-step helper is appropriate because
the final step performs world update and then persistence. Do not add wall-clock
sleep or use `window.game`.

AUDIT-03 and AUDIT-05 must remain annotated and must still fail for their named
assertions. Continue collecting page/console errors.

**Verify**:
`npx playwright test tests/e2e/campaign-persistence.spec.js -g "AUDIT-02"`
-> one passing test, expected status `passed`, actual status `passed`.

### Step 4: Update the persistence maintenance documentation

Update `AGENTS.md` and `tests/README.md`:

- describe `World.syncLiveStateToSave()` as the only map snapshot boundary;
- require new live campaign fields to be added there (or deliberately remain
  transient) and covered through explicit plus timed persistence;
- change AUDIT-02's matrix/status to fixed/pass and remove it from the active
  expected-failure list;
- state that AUDIT-03 and AUDIT-05 remain active and must not be weakened;
- retain Plan 003's save-version and test-slot rules.

**Verify**:
`rg -n "syncLiveStateToSave|AUDIT-02|AUDIT-03|AUDIT-05|timed" AGENTS.md tests/README.md`
-> the snapshot contract and remaining expected failures are unambiguous.

### Step 5: Run the complete gate and close the plan

Run the focused regression, entire campaign spec, schema spec from Plan 003,
and full gate. Use JSON reporting or equivalent to confirm AUDIT-02 is a normal
pass while AUDIT-03 and AUDIT-05 are actual failures with expected status
`failed`. Update only Plan 004's status to DONE.

**Verify**:

```text
npx playwright test tests/e2e/campaign-persistence.spec.js -g "AUDIT-02"
npx playwright test tests/e2e/save-schema.spec.js
npx playwright test tests/e2e/campaign-persistence.spec.js
npm test
rg -c "test.fail" tests/e2e/campaign-persistence.spec.js
git diff --check
git status --short
```

Expected: all commands exit 0; `test.fail` count is exactly `2`; only AUDIT-03
and AUDIT-05 remain expected failures; only in-scope paths changed.

## Test plan

- Convert the existing AUDIT-02 browser E2E into a normal pass.
- Cover explicit persistence, the real four-second autosave boundary, and a
  reload/Continue restoration without manually synchronizing `scene.save`.
- Keep save-schema coverage, two unrelated expected failures, and the 17-record
  legacy suite green.

## Done criteria

- [ ] One `World.syncLiveStateToSave()` method owns live hero/party snapshotting.
- [ ] `Game.persistRun()` calls it immediately before every world save.
- [ ] Explicit, pause, initial, and timer callers continue using `persistRun()`;
      no parallel serializer exists.
- [ ] AUDIT-02 passes normally through explicit, timed, and reload behavior.
- [ ] Exactly two active `test.fail` annotations remain: AUDIT-03 and AUDIT-05.
- [ ] `npm test` and focused schema/campaign specs exit 0 with no runtime errors.
- [ ] AGENTS and test docs describe the synchronization extension rule.
- [ ] No schema, battle, AI, cadence, or out-of-scope behavior changed.
- [ ] `git diff --check` exits 0 and Plan 004 is marked DONE.

## STOP conditions

Stop and report instead of improvising if:

- Plan 003 is not DONE or its schema/full gate is not green.
- Loaded/fresh saves no longer share one mutable `World.save` object.
- A relevant live campaign field exists outside hero/parties and `World.save`
  that must be snapshotted to fix AUDIT-02.
- The timer regression requires wall-clock sleeps or disabling runtime-error
  checks to pass.
- AUDIT-03 or AUDIT-05 unexpectedly passes, or fails for setup/runtime reasons.
- The implementation appears to require changing save schema, cadence,
  visibility lifecycle, battle logic, or party AI.
- Verification fails twice after a reasonable correction.

## Maintenance notes

- Review new live world state with one question: is it transient presentation
  state, or must it survive refresh? Persistent live fields belong in
  `syncLiveStateToSave()` and need an E2E reload assertion.
- Keep snapshotting at save boundaries. Mirroring every movement update would
  create two continuously mutable sources of truth.
- Plan 005 deliberately follows this plan so battle entry can call the same
  `persistRun()` path after its in-memory transaction.
