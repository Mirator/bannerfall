# Plan 002: Cover persistence and non-victory campaign transitions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat c07be05..HEAD -- tests/e2e/campaign-persistence.spec.js tests/e2e/test-helpers.js tests/README.md AGENTS.md plans/README.md`
> This plan expects Plan 001 to have changed four of these paths after
> `c07be05`; that planned dependency is not drift. First confirm Plan 001 is
> marked DONE and its documented commands pass. Any additional mismatch or any
> change to the current-state production excerpts below is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-one-command-browser-qa.md`
- **Category**: tests, docs
- **Planned at**: commit `c07be05`, 2026-08-17

## Why this matters

The current 17-check suite is green but does not exercise real reloads, the real
player save slot, battle-entry persistence, or a roaming party's loss/retreat
lifecycle. Three confirmed campaign defects therefore remain invisible: autosaves
serialize stale live positions, battle entry is not flushed to storage, and a
roaming party disappears when it defeats the player.

This plan adds executable characterization around those boundaries without
fixing gameplay source. Already-confirmed broken expectations must use
Playwright's `test.fail` annotation: the test still runs, the overall QA command
stays green while the defect is acknowledged, and Playwright will fail with an
"unexpected pass" when a future fix lands without removing the annotation. This
is preferable to `skip` or `fixme`, which would stop exercising the defect.

## Current state

- `Game.persistRun()` only serializes `scene.save`; it does not snapshot live
  `World.hero` or live parties:

  ```js
  // src/main.js:50-52
  persistRun() {
    if (this.sceneName === 'world' && this.scene && this.scene.save && !this.scene.save.won) {
      try { localStorage.setItem(this.saveKey, JSON.stringify(this.scene.save)); } catch (e) {}
    }
  }
  ```

- Hero coordinates are copied into the save only at battle entry, while party
  snapshots happen only when `persistParties()` is explicitly called:

  ```js
  // src/world.js:118-120
  persistParties() {
    this.save.parties = this.parties.map(p => ({ camp: p.camp, x: p.x, y: p.y, comp: p.comp, home: p.home, waryT: p.waryT || 0 }));
  }

  // src/world.js:382-386
  const save = this.save;
  save.x = this.hero.x; save.y = this.hero.y;
  save.battleCount = (save.battleCount || 0) + 1;
  this.persistParties();
  ```

- `persistRun()` refuses to write after the scene changes to battle. Battle entry
  mutates the in-memory save and then calls `game.startBattle(...)` without a
  storage flush.
- A colliding roaming party is removed before battle:

  ```js
  // src/world.js:689-700
  const idx = this.parties.indexOf(p);
  this.parties.splice(idx, 1);
  this.persistParties();
  // ...
  this.startBattle(p.comp, /* ... */,
    { camp: p.camp, comp: p.comp, home: p.home }, /* ... */);
  ```

- Retreat restores the surviving party, but ordinary defeat has no corresponding
  restoration branch:

  ```js
  // src/world.js:436-450
  } else if (result.retreated) {
    // ... removeDead(partyMeta.comp) and save.parties.push(...)
  } else {
    // defeat applies player penalties only
  }
  ```

- `tests/qa_suite.js:119` forces a standalone defeat without roaming-party
  metadata. `tests/qa_suite.js:285` covers roaming-party victory only. Every
  suite world starts fresh rather than loading `bf_save` (`tests/qa_suite.js:12`).
- Plan 001 provides `npm test`, the Playwright configuration/server, isolated
  browser contexts, error collection, `AGENTS.md`, and `tests/README.md`.
- Production source is intentionally out of scope. Three tests in this plan are
  expected to fail against commit `c07be05`; they must be annotated, not weakened.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Dependency baseline | `npm ci` | exit 0 |
| Browser baseline | `npx playwright install chromium` | exit 0; Chromium present |
| Existing gate | `npm test` | exit 0 before changes; Plan 001 tests pass |
| Focused campaign coverage | `npx playwright test tests/e2e/campaign-persistence.spec.js` | exit 0; passing tests pass and exactly three tests fail as expected |
| Full verification | `npm test` | exit 0; legacy QA plus campaign coverage behave as expected |
| Expected-failure count | `node --input-type=module -e "import fs from 'node:fs'; const s=fs.readFileSync('tests/e2e/campaign-persistence.spec.js','utf8'); const n=(s.match(/test\\.fail\\(/g)||[]).length; console.log(n); if(n!==3) process.exit(1)"` | prints `3`, exit 0 |
| No skipped debt | `rg -n "test\.(skip|fixme)" tests/e2e/campaign-persistence.spec.js` | no matches |
| Patch hygiene | `git diff --check` | exit 0, no output |

## Suggested executor toolkit

- Use the Playwright Test dependency and helpers installed by Plan 001.
- Read Playwright's official
  [`test.fail` annotation documentation](https://playwright.dev/docs/test-annotations)
  before adding known-defect tests. `test.fail` runs the body and requires it to
  fail; `test.fixme` does not run the body and is prohibited here.

## Scope

**In scope** (the only files you should modify or create):

- `tests/e2e/campaign-persistence.spec.js` (create)
- `tests/e2e/test-helpers.js` (extend only if shared helpers are genuinely useful)
- `tests/README.md` (update coverage matrix and known-defect procedure)
- `AGENTS.md` (update the canonical test/expected-failure contract)
- `plans/README.md` (status only)

**Out of scope** (do not touch):

- All `src/**`, production `index.html`, `scripts/**`, and persistence/gameplay
  implementation. This plan records behavior; it does not fix findings 2, 3, 4,
  or 5 from the audit.
- `tests/qa_suite.js`; retain Plan 001's 17 legacy checks unchanged.
- Package versions, Playwright configuration, CI workflow, server port, or
  reporters unless Plan 001 is broken; if so, stop instead of repairing it here.
- Save-schema migration or malformed-save expectations. Those belong to the
  separate save-schema plan because the intended legacy compatibility policy is
  not yet specified.
- Visual/pixel regression, scheduler/visibility tests, multi-browser expansion,
  or performance budget changes.
- Publishing, pushing, or opening a pull request.

## Git workflow

- Branch: `codex/002-campaign-qa`
- Commit with an imperative sentence, for example:
  `Add campaign persistence regression coverage`.
- Do not push or open a PR unless the operator explicitly instructs it.

## Steps

### Step 1: Add deterministic raw-game helpers without entering test-save mode

In `campaign-persistence.spec.js` (or `test-helpers.js` when reused), add small
helpers with explicit responsibilities:

- `openPlayerGame(page)`: navigate to `/`, attach runtime-error collection before
  navigation, wait for `window.__g`, remove only `bf_save` and `bf_save_test` from
  that test's isolated localStorage, set `window.__g.testMode = false`, and assert
  the starting scene is `menu`.
- `startRawWorld(page, { seed, hard })`: set `window.__g.testSeed` and
  `window.__g.hardNext`, then call the raw `startWorld(null)`. Do not call
  `window.game.scenario()`, because that intentionally flips persistence to
  `bf_save_test` and would invalidate real-save assertions.
- `rawStep(page, seconds)`: call `window.__g.update(1 / 60)` in a bounded loop,
  followed by one draw. Cap helper input (for example, 30 seconds) so a typo cannot
  hang CI. Do not call `window.game.step()` for persistence cases.
- `installUniqueParty(page, descriptor)`: replace the world's parties with one
  deterministic party outside all settlement safe zones. Give it a unique camp
  key such as `qa_defeat_party`, a fixed composition, fixed home, and all fields
  expected by `World.update`. Position the hero on that party, clear grace, run
  one raw update, and assert the scene becomes `battle`. A unique camp key makes
  restoration assertions unambiguous even if normal world generation changes.

Every test receives a fresh Playwright browser context by default; do not reuse a
page/context across tests or inspect a developer's normal browser profile.

**Verify**: add one temporary local assertion or the first positive test below,
then run the focused spec. The helper must start a world and enter a battle without
setting `window.__g.testMode` to true and without writing outside that isolated
context.

### Step 2: Add positive save/load and non-victory lifecycle coverage

Add these normal passing tests:

1. **Current-schema player save round-trips through Continue**
   - Start a raw seeded world.
   - Set distinctive gold, HP, hard-mode, stats, troop roster, hero coordinates,
     and party state.
   - For this positive baseline, explicitly synchronize `save.x/save.y` and call
     `persistParties()` before `persistRun()`; it must not depend on the known
     stale-snapshot defect.
   - Reload `/`, press the real `C` key through Playwright keyboard input, wait for
     `sceneName === 'world'`, and assert the fields and party composition survived.

2. **Retreat restores the engaged party minus actual dead enemy types**
   - Engage a unique two-or-more-member party through `World.update` collision.
   - Kill one known enemy via `Battle.damageEnemy(...)` so `deadEnemyTypes` is
     populated through the real damage path.
   - Call `endBattle(false, true)`, raw-step past the 2.6-second end banner, and
     assert exactly one party with the unique key exists and its multiset of types
     equals the original composition minus the killed type.

3. **Hard-mode defeat retains exactly one fallback squire**
   - Start a raw hard world, engage a unique party, set the battle troop array
     empty to represent total troop loss, then kill the hero via
     `Battle.damageFriendly(hero, true, lethalDamage, enemy)` rather than calling
     `endBattle(false)` directly.
   - Raw-step through resolution and assert the world remains hard mode and the
     roster contains exactly one spearman, not the normal-mode floor of two.

4. **Final stronghold victory enters the victory scene and clears the run save**
   - Start a raw seeded world, mark the three non-stronghold camps razed, give the
     stronghold a one-enemy deterministic garrison, clear roaming parties, and
     place the hero in interaction range.
   - Inject `KeyE` through the raw `Input` instance for one update to enter the
     stronghold battle through the real world interaction branch.
   - Force victory only after confirming the battle setup, raw-step through its
     end callback and the following world tick, then assert `sceneName ===
     'victory'`, `finalSave.won === true`, and `bf_save` is absent.

After each test's behavioral assertions, assert there were no page exceptions or
console errors.

**Verify**: run the focused spec. These four tests must pass normally against
`c07be05` plus Plan 001. If one fails because the setup no longer matches source,
stop; do not convert it to an expected failure.

### Step 3: Add three running expected-failure regressions for confirmed defects

Declare three ordinary tests and call `test.fail(true, '<reason>')` inside each
before the failing assertion. Include the audit finding and future fix scope in
the reason. Do not use `test.skip`, `test.fixme`, conditional early returns, or
weakened assertions.

1. **AUDIT-02: autosave captures live hero and roaming-party positions**
   - Start a raw world, move `World.hero` and the unique party to distinctive
     coordinates without manually updating `scene.save`.
   - Call production `Game.persistRun()`.
   - Parse `bf_save` and assert its hero/party coordinates equal the live scene.
   - Current code must fail because it serializes stale `scene.save` values.

2. **AUDIT-05: battle entry persists a coherent transaction**
   - Start a raw world and engage a unique party through collision.
   - While still in battle, compare parsed `bf_save` with
     `window.__g._lastSave`: `x`, `y`, `battleCount`, and normalized party snapshot
     must match.
   - This assertion intentionally avoids choosing a future reload UX (resume
     battle versus reload a checkpoint); it only requires storage to represent the
     same transaction as memory. Current code must fail because `persistRun()` is
     world-only and is not called before `startBattle()`.

3. **AUDIT-03: defeat restores the surviving roaming party**
   - Engage a unique fixed-composition party and kill no enemies.
   - Kill the hero through `Battle.damageFriendly(...)`, raw-step through
     resolution, and assert exactly one party with the unique key and original
     composition exists in the returned world.
   - Current code must fail because only the retreat branch restores a party.

The focused command must exit 0 because these failures are expected. Confirm each
body actually runs and fails for its stated assertion; an expected failure caused
by a setup exception is invalid. Use assertion messages specific enough to tell a
setup failure from the target defect.

**Verify**:

- `npx playwright test tests/e2e/campaign-persistence.spec.js` -> exit 0, four
  normal tests pass and three are reported as expected failures.
- Run the expected-failure count command from "Commands you will need" -> prints
  exactly `3`.
- `rg -n "test\.(skip|fixme)" tests/e2e/campaign-persistence.spec.js` -> no matches.

### Step 4: Document coverage ownership and the expected-failure removal rule

Update `tests/README.md` with a campaign coverage matrix containing all seven new
tests, their layer (browser E2E), and their expected status. For each expected
failure, identify the audit finding and state the exact removal rule: the source
fix and removal of `test.fail` must ship together; if the behavior passes while
still annotated, `npm test` intentionally fails as an unexpected pass.

Document the setup distinction:

- `window.game` is appropriate for deterministic scenario-driver tests and writes
  `bf_save_test` after its first driver call.
- `window.__g` is allowed only inside isolated Playwright contexts for controlled
  persistence/lifecycle setup. It must not be used against a developer's normal
  profile.
- Prefer real input, collision, damage, and scene-transition paths for the
  behavior under assertion; direct mutation is allowed only to create a small,
  deterministic fixture.

Update `AGENTS.md` so future agents must:

- run the focused campaign spec after persistence, battle-result, save, party-AI,
  or stronghold changes
- remove the matching `test.fail` annotation in the same change when fixing
  AUDIT-02, AUDIT-03, or AUDIT-05
- treat an unexpected pass as useful drift, not as a reason to weaken the test

**Verify**: `rg -n "AUDIT-02|AUDIT-03|AUDIT-05|test.fail|campaign-persistence" AGENTS.md tests/README.md`
-> all three findings and the focused command/removal rule are documented.

### Step 5: Run the full gate and inspect scope

Run `npm test`, the exact expected-failure count command, `git diff --check`, and
`git status --short`. Confirm the legacy 17-check suite still passes, all four
positive campaign tests pass, the three known defects fail for their intended
assertions, and no browser runtime errors appear.

**Verify**: `npm test` exits 0; the expected-failure count prints `3`; no
`skip`/`fixme` annotation exists; `git diff --check` exits 0; changed paths are
limited to this plan's in-scope list and the plan status update.

## Test plan

Create `tests/e2e/campaign-persistence.spec.js` with seven tests:

- Passing: current-schema save/Continue round-trip.
- Passing: retreat restores party minus actual typed casualties.
- Passing: hard-mode total defeat restores exactly one squire.
- Passing: stronghold completion enters victory and clears `bf_save`.
- Expected failure: autosave serializes live world coordinates (AUDIT-02).
- Expected failure: battle entry persists a coherent memory/storage transaction
  (AUDIT-05).
- Expected failure: ordinary defeat restores the surviving roaming party
  (AUDIT-03).

Model assertions on Playwright's `expect` API and model simulation setup on the
existing deterministic patterns in `tests/qa_suite.js`, especially pinned world
seeds and raw 1/60-second stepping. Unlike the legacy suite, these tests must use
real page reloads and isolated localStorage.

Verification: focused spec exits 0 with four passes and three expected failures;
the full `npm test` gate exits 0.

## Done criteria

- [ ] Plan 001 is DONE and `npm test` passes before this plan's changes.
- [ ] `campaign-persistence.spec.js` contains exactly seven named tests.
- [ ] Four positive tests pass normally: round-trip, retreat attrition, hard-mode
      recovery, and stronghold completion.
- [ ] Exactly three tests use `test.fail`, mapped one-to-one to AUDIT-02,
      AUDIT-03, and AUDIT-05.
- [ ] Each expected-failure body reaches the target assertion; none fails because
      of fixture setup, timeout, missing globals, or console/page errors.
- [ ] No `test.skip` or `test.fixme` appears in the campaign spec.
- [ ] Real persistence tests use isolated contexts, `bf_save`, and raw `window.__g`
      setup without calling `window.game` driver methods.
- [ ] Hero defeat uses `damageFriendly`, party engagement uses `World.update`
      collision, and stronghold entry uses the interaction/input branch.
- [ ] `tests/README.md` contains the coverage/status matrix and expected-failure
      removal policy.
- [ ] `AGENTS.md` documents the focused command and same-change annotation rule.
- [ ] `npm test` exits 0 and the legacy 17-check suite remains unchanged and green.
- [ ] No production, package, CI, server, or Playwright configuration file changed.
- [ ] `git diff --check` exits 0 and `plans/README.md` status is updated.

## STOP conditions

Stop and report back; do not improvise if:

- Plan 001 is not DONE or its full `npm test` gate is not green.
- Production code at the current-state excerpts has drifted, so a known defect may
  already be fixed or the lifecycle path has changed.
- Any of the four positive tests fails against current behavior.
- An expected-failure test fails before reaching its target assertion.
- Reliable coverage appears to require changing `src/**`, production `index.html`,
  Playwright configuration, package versions, CI, or the Python server.
- A test can pass only by using `window.game` and therefore switching a real-save
  assertion to `bf_save_test`.
- A test requires a real user browser profile or could overwrite non-isolated
  localStorage.
- The intended battle-refresh UX must be chosen to write the transaction test;
  retain the memory/storage coherence assertion and report the UX question rather
  than choosing resume/retry/forfeit semantics.
- The number of expected failures is not exactly three after the implementation.

## Maintenance notes

- `test.fail` is active debt tracking, not a permanent exemption. Playwright runs
  these tests and treats an unexpected pass as failure; remove the annotation when
  the corresponding source fix lands.
- Normalize party compositions as multisets when asserting typed attrition; array
  order is not the gameplay invariant.
- Keep raw-handle fixture setup small. Assertions should target persisted or
  observable outcomes, not incidental private fields.
- Save-schema malformed/legacy fixtures are deliberately deferred until the
  migration policy is planned; do not smuggle them into this plan.
- The hidden-tab scheduler remains untested here because browser throttling needs
  a separate deterministic seam and policy decision.
- Reviewers should scrutinize whether every localStorage operation occurs in a
  fresh Playwright context and whether expected failures fail for the named defect
 rather than for setup drift.
