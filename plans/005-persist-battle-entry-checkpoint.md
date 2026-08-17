# Plan 005: Persist a coherent checkpoint before entering battle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan's status in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat d29e284..HEAD -- src/world.js src/main.js tests/e2e/campaign-persistence.spec.js AGENTS.md tests/README.md plans/README.md`
> Plans 003-004 are expected to have changed some paths. Require both to be DONE
> and green, then compare the excerpts below. Any other semantic mismatch is a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/004-sync-live-world-save.md`
- **Category**: bug, tests, docs
- **Planned at**: commit `d29e284`, 2026-08-17
- **Audit mapping**: finding #5 / AUDIT-05

## Why this matters

Starting a battle is a multi-field campaign transaction: hero coordinates and
battle count change, the live party list is copied, and a colliding roaming
party may already have been removed. The scene then switches to `battle`, where
the world-only autosave guard can no longer persist those changes. Reloading
during the battle therefore resumes an older, internally inconsistent map
snapshot. Plan 002 already exercises this exact boundary as AUDIT-05; this plan
commits the completed entry transaction before the scene switch and retires
only that expected failure.

## Current state

- `src/world.js:382-388` mutates world/save state and immediately switches:

  ```js
  startBattle(comp, title, onWinExtra, arena, ambush, partyMeta, subtitle) {
    const save = this.save;
    save.x = this.hero.x; save.y = this.hero.y;
    save.battleCount = (save.battleCount || 0) + 1;
    this.persistParties();
    this.game.sfx.horn(147);
    this.game.startBattle({
  ```

- For roaming encounters, `src/world.js:687-700` removes the colliding party and
  calls `persistParties()` before entering `startBattle(...)`:

  ```js
  const idx = this.parties.indexOf(p);
  this.parties.splice(idx, 1);
  this.persistParties();
  // ...
  this.startBattle(p.comp, /* ... */);
  ```

- `src/main.js:50-53` persists only while `sceneName === 'world'`. Once
  `Game.startBattle()` sets `sceneName = 'battle'`, timer/pause calls cannot
  write the checkpoint.
- Plan 004 will make `Game.persistRun()` synchronize live hero and party state
  before serialization. Battle entry must reuse that writer rather than adding
  direct `localStorage` or another mapping.
- `tests/e2e/campaign-persistence.spec.js:254-278` compares `_lastSave` after
  entry with parsed `bf_save`. It currently has a `test.fail` annotation because
  stored `x`, `y`, `battleCount`, and parties predate the transaction.
- Battle result resolution later returns through `game.startWorld(save)`, which
  persists the post-result world. That path is already covered and is not the
  target of this plan.

## Checkpoint semantics

The checkpoint is the completed map-side entry transaction, written while the
active scene is still `world` and immediately before `Game.startBattle()`.
It includes the Plan 003 schema version and the Plan 004 synchronized snapshot:

- current hero map coordinates;
- incremented battle count;
- current campaign fields;
- current roaming-party list after any encounter removal.

Bannerfall does not serialize or resume an in-progress `Battle`. A reload during
battle can Continue from this last coherent map checkpoint. Adding a pending
encounter record, replaying the battle, or changing what a reload means is out
of scope; those require a separate product decision and schema migration.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Focused regression | `npx playwright test tests/e2e/campaign-persistence.spec.js -g "AUDIT-05"` | one normal passing test |
| Campaign suite | `npx playwright test tests/e2e/campaign-persistence.spec.js` | exit 0; only AUDIT-03 remains expected failure |
| Schema suite | `npx playwright test tests/e2e/save-schema.spec.js` | all pass |
| Full gate | `npm test` | exit 0; no runtime errors |
| Diff hygiene | `git diff --check` | no output, exit 0 |

## Scope

**In scope** (the only files to modify):

- `src/world.js`
- `tests/e2e/campaign-persistence.spec.js`
- `AGENTS.md`
- `tests/README.md`
- `plans/README.md` (status only)

`src/main.js` is read-only for this plan. Plan 004's `persistRun()` contract
must already be sufficient.

**Out of scope** (do not touch):

- `src/main.js`, `src/save.js`, the save version, or snapshot field mappings.
- Restoring a victorious/retreated/defeated roaming party; AUDIT-03 remains.
- Serializing battle units, projectiles, formation, timers, RNG state, or a
  pending encounter; in-progress battle resume is not being added.
- Changing encounter removal, battle count meaning, rewards, attrition,
  difficulty, or result callbacks.
- Surfacing localStorage errors to the player.

## Git workflow

- Branch: `codex/battle-entry-checkpoint`
- Commit message style: imperative, for example
  `Persist campaign state before battles`.
- Do not push, merge, or open a PR unless explicitly instructed.

## Steps

### Step 1: Flush the completed entry transaction before the scene switch

In `World.startBattle()` (`src/world.js`), after all entry mutations are
complete and before the horn/`this.game.startBattle(...)`, call the production
`this.game.persistRun()` path exactly once.

The required order is:

1. capture the current hero position (the Plan 004 writer will also synchronize
   it; retaining the explicit assignment is acceptable until a later cleanup);
2. increment `battleCount`;
3. ensure the current party list reflects any encounter removal;
4. call `game.persistRun()` while `sceneName` is still `world`;
5. play the horn and construct/switch to `Battle`.

Do not write localStorage directly. Do not move persistence after
`game.startBattle`, where the world guard rejects it. Preserve current behavior
when storage throws: `persistRun()` swallows that browser-storage failure and
the battle still begins.

**Verify**:
`rg -n -A12 "startBattle\(comp" src/world.js`
-> `persistRun()` appears after entry-state mutation and before
`this.game.startBattle(...)`.

### Step 2: Promote AUDIT-05 from expected failure to regression

In `tests/e2e/campaign-persistence.spec.js`, remove only AUDIT-05's
`test.fail(...)`. Preserve its finding-labelled name and its comparison of
stored versus in-memory `x`, `y`, `battleCount`, and parties. Add assertions
that:

- the stored save carries the current schema version from Plan 003;
- the test is still in `battle` when storage is inspected;
- the checkpoint contains the removed roaming-party list rather than the
  pre-collision list;
- after a reload and Continue, the restored world has the same hero position,
  battle count, and party list as the checkpoint.

The reload assertion characterizes the documented map-checkpoint semantics; it
must not expect the in-progress battle to resume. Do not weaken the existing
field equality assertions or use `window.game`.

AUDIT-03 remains annotated, active, and failing for its original party-defeat
assertion. AUDIT-02 should already be a normal pass from Plan 004.

**Verify**:
`npx playwright test tests/e2e/campaign-persistence.spec.js -g "AUDIT-05"`
-> one passing test, expected status `passed`, actual status `passed`.

### Step 3: Document the battle checkpoint boundary

Update `AGENTS.md` and `tests/README.md` so future agents/developers know:

- every transition from world to battle must finish all map-side mutations and
  call `Game.persistRun()` before switching scenes;
- the stored value is a coherent map checkpoint, not a serialized battle;
- adding resumable battles or pending encounters requires an explicit schema
  design/migration rather than expanding this checkpoint casually;
- AUDIT-05 is fixed/pass and removed from the active expected-failure list;
- only AUDIT-03 remains expected, and its assertion must not be weakened.

Keep Plan 003's schema rules and Plan 004's live snapshot rules intact.

**Verify**:
`rg -n "checkpoint|world.*battle|AUDIT-03|AUDIT-05|persistRun" AGENTS.md tests/README.md`
-> transition order, reload semantics, and remaining debt are documented.

### Step 4: Run the complete gate and close the plan

Run schema, campaign, and full suites. Use JSON reporting or equivalent to
confirm AUDIT-05 is a normal pass, AUDIT-02 remains a normal pass, and AUDIT-03
still executes and fails for its named assertion with expected status `failed`.
Update only Plan 005's status to DONE.

**Verify**:

```text
npx playwright test tests/e2e/campaign-persistence.spec.js -g "AUDIT-05"
npx playwright test tests/e2e/save-schema.spec.js
npx playwright test tests/e2e/campaign-persistence.spec.js
npm test
rg -c "test.fail" tests/e2e/campaign-persistence.spec.js
git diff --check
git status --short
```

Expected: all commands exit 0; the count is exactly `1`; it belongs to
AUDIT-03; only in-scope files changed.

## Test plan

- Convert the existing AUDIT-05 test into a normal regression.
- Assert the checkpoint while the battle is active and after reload/Continue.
- Cover schema version, hero coordinates, battle count, and party-list equality.
- Retain Plan 003 schema tests, Plan 004 live snapshot coverage, AUDIT-03's
  running expected failure, and the legacy 17-record suite.

## Done criteria

- [ ] Every `World.startBattle()` path flushes once after map mutation and before
      switching to `battle`.
- [ ] The implementation reuses `Game.persistRun()`; there is no direct or
      duplicate localStorage writer in `world.js`.
- [ ] AUDIT-05 passes normally while inspecting active-battle storage and after
      reload/Continue.
- [ ] AUDIT-02 remains a normal pass and exactly one expected failure remains,
      AUDIT-03.
- [ ] Schema, campaign, and full suites exit 0 with no runtime errors.
- [ ] Documentation defines the map-checkpoint/non-resumable-battle boundary.
- [ ] No save-schema, result, encounter, balance, or battle-resume behavior changed.
- [ ] `git diff --check` exits 0 and Plan 005 is marked DONE.

## STOP conditions

Stop and report instead of improvising if:

- Plans 003 or 004 are not DONE and green.
- `Game.persistRun()` cannot snapshot and serialize the active world before the
  scene switch without changes to `src/main.js`.
- A battle path switches `sceneName` before reaching `World.startBattle()`.
- Correctness appears to require persisting a pending encounter or full battle
  state; that is a schema/product expansion outside this plan.
- The reload characterization would duplicate or resurrect the removed party,
  or alter battle-count meaning.
- AUDIT-02 regresses or AUDIT-03 unexpectedly passes/fails for a new reason.
- Verification fails twice after a reasonable correction.

## Maintenance notes

- Review transition ordering as a transaction: mutate map state, snapshot/write,
  then switch scenes. New world-to-battle entry paths must preserve that order.
- The checkpoint intentionally does not promise combat resume. If that product
  requirement changes, introduce a versioned pending-battle record and dedicated
  migration/tests rather than stuffing transient `Battle` state into this save.
- AUDIT-03 remains the only persistence/non-victory defect from the original
  trio after this plan; its eventual fix must remove its annotation and update
  the same documentation matrix.
