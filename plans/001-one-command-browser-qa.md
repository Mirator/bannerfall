# Plan 001: Add a one-command browser QA gate and document it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat c07be05..HEAD -- .gitignore README.md AGENTS.md package.json package-lock.json playwright.config.js tests/runner.html tests/qa_suite.js tests/README.md tests/e2e/qa.spec.js tests/e2e/test-helpers.js .github/workflows/qa.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. On a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests, dx, docs
- **Planned at**: commit `c07be05`, 2026-08-17

## Why this matters

The repository has a useful 17-check browser QA suite, but it can only be run by
opening a browser, pasting the entire file into a JavaScript tool, and manually
reading an object. There is no repeatable exit code for local work or CI, and the
suite mirrors production balance constants that can silently drift. This plan
adds a development-only Playwright gate while preserving the product's defining
constraint: the shipped game remains static HTML, Canvas, and native ES modules
with no runtime package or build step.

The documentation is part of the deliverable. A developer should be able to
clone the repository and find the canonical commands in `README.md`; an agent
should find the test contract and persistence-test cautions in `AGENTS.md`; a
test author should find harness architecture and extension rules in
`tests/README.md`.

## Current state

- `index.html` is the production entry point and loads only `src/main.js`:

  ```html
  <!-- index.html:13-14 -->
  <canvas id="game"></canvas>
  <script type="module" src="src/main.js?v=r10"></script>
  ```

- `tests/qa_suite.js` is a browser-global suite. Its only launch instruction is
  manual paste, and it mirrors values from `src/data.js`:

  ```js
  // tests/qa_suite.js:3-6
  // Paste this whole file as one block into javascript_tool.
  // ... It defines window.runQaSuite ... and also runs it once immediately.

  // tests/qa_suite.js:48-55
  const COST = { spear: 15, archer: 25, knight: 60 };
  const HEAL_COST = 10;
  const DEFEAT_GOLD_LOSS = 0.3;
  const LOOT_BASE = 10, LOOT_PER_ENEMY = 5;
  const HERO_START = { x: 620, y: 1250 };
  ```

- The suite catches each check's exception, records `{name, ok, detail}`, and
  exposes a rerunnable result:

  ```js
  // tests/qa_suite.js:38-44, 494-501
  function record(name, fn) {
    try {
      const detail = fn();
      results.push({ name, ok: true, detail: detail || 'ok' });
    } catch (e) {
      results.push({ name, ok: false, detail: (e && e.message) || String(e) });
    }
  }
  window.runQaSuite = function () {
    window.__qaResult = runQaSuiteImpl();
    return window.__qaResult;
  };
  window.__qaResult = runQaSuiteImpl();
  ```

- There are exactly 17 current `record(...)` checks. The audit executed them in
  Chromium through an in-memory loader: 17 passed, 0 failed, and no console or
  page errors were emitted. Preserve those test names and behaviors during the
  runner conversion.
- `scripts/serve.py` is the existing no-cache server and listens on
  `127.0.0.1:8474`. Reuse it through Playwright's `webServer` configuration; do
  not add a second checked-in server.
- `README.md:15` incorrectly tells developers to open port 8000. Correct it to
  `http://localhost:8474/` while documenting QA.
- No package manifest, lockfile, CI workflow, `AGENTS.md`, or automated test
  command exists today.
- Repository conventions: JavaScript uses ES modules, semicolons, two-space
  indentation, and single quotes. HTML is intentionally minimal. Recent commits
  use imperative sentence messages, for example: `Fix critical/high/medium audit
  findings across save persistence, battle sim, and QA tooling`.

## Target design

Implement the following exact boundary:

1. `package.json` contains development tooling only: `private: true`,
   `type: "module"`, a Node `>=22` engine, and `@playwright/test` as the sole
   development dependency. Generate and commit `package-lock.json`; never
   hand-edit the lockfile.
2. `npm test` is the canonical full gate. `npm run test:qa` runs only the legacy
   17-check wrapper. `npm run test:headed` is an optional local debugging command.
3. Playwright runs one Chromium worker against the existing Python server on
   port 8474. Use `webServer.url`, `baseURL`, `reuseExistingServer: !process.env.CI`,
   `forbidOnly` in CI, trace retention on failure, and a noninteractive reporter.
4. `tests/runner.html` supplies the required `<canvas id="game">`, imports
   `../src/main.js`, then imports `./qa_suite.js` as an ES module. It exposes the
   existing `window.__qaResult` and prints JSON into a `<pre id="qa-status">` so
   a human can diagnose it by opening the page.
5. `tests/qa_suite.js` imports `UNIT_TYPES`, `WORLD`, and `BALANCE` directly from
   `src/data.js` and derives every mirrored cost, position, loot, grace, capacity,
   and defeat constant. Preserve `window.runQaSuite` and `window.__qaResult` so
   historical tools and future browser debugging still work.
6. Playwright treats any failed QA record, browser `pageerror`, or console
   `error` as a test failure with readable details. It also verifies that running
   QA leaves an existing real-player `bf_save` value byte-for-byte unchanged;
   test API calls must use `bf_save_test` as intended by `src/main.js`.
7. GitHub Actions installs Node, runs `npm ci`, installs Chromium with Linux
   dependencies, runs `npm test`, and uploads the Playwright report on failure.

The Playwright design follows its official documentation for the
[`webServer` option](https://playwright.dev/docs/test-webserver),
[browser installation](https://playwright.dev/docs/browsers), and
[GitHub Actions setup](https://playwright.dev/docs/ci-intro).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Baseline syntax | `node --check src/main.js; node --check src/engine.js; node --check src/data.js; node --check src/world.js; node --check src/battle.js; node --check tests/qa_suite.js` | exit 0, no output |
| Install locked packages | `npm ci` | exit 0; only development packages installed |
| Install local browser once | `npx playwright install chromium` | exit 0; Chromium install confirmed or already present |
| Focused legacy QA | `npm run test:qa` | exit 0; 17/17 QA records pass and no runtime errors are reported |
| Full verification | `npm test` | exit 0; all Playwright tests pass |
| Patch hygiene | `git diff --check` | exit 0, no output |

Do not add a lint or formatting tool in this plan. The repository has no existing
lint/format contract, and doing so would broaden the change beyond QA execution.

## Suggested executor toolkit

- Use Playwright Test for browser execution. Follow the current official
  `webServer`, browser-install, and CI documentation linked above rather than
  inventing a custom background-process manager.
- If browser installation is blocked by a network/proxy policy, stop and report
  the exact command and error. Do not substitute a globally installed browser or
  commit browser binaries.

## Scope

**In scope** (the only files you should modify or create):

- `package.json` (create)
- `package-lock.json` (generate and commit)
- `playwright.config.js` (create)
- `.gitignore`
- `tests/runner.html` (create)
- `tests/qa_suite.js`
- `tests/e2e/qa.spec.js` (create)
- `tests/e2e/test-helpers.js` (create)
- `.github/workflows/qa.yml` (create)
- `README.md`
- `AGENTS.md` (create)
- `tests/README.md` (create)
- `plans/README.md` (status only)

**Out of scope** (do not touch):

- `src/**` and production `index.html`; this plan must not change gameplay,
  persistence, rendering, input, or the deployed entry point.
- `scripts/serve.py`; reuse its current port and behavior.
- Adding or deleting QA cases. Adapting constants/imports is allowed, but the
  same 17 named records must remain.
- Fixing stale autosaves, battle checkpoints, party-defeat behavior, save-schema
  validation, scheduler behavior, or performance findings.
- Runtime dependencies, bundlers, transpilers, or a production build step.
- Publishing, pushing, or opening a pull request.

## Git workflow

- Branch: `codex/001-browser-qa`
- Commit logical units with imperative sentence messages. Suggested commits:
  `Add automated browser QA runner`, then `Document the QA workflow`.
- Do not push or open a PR unless the operator explicitly instructs it.

## Steps

### Step 1: Establish the npm/Playwright development boundary

Create `package.json` with no `dependencies` block and with these scripts:

- `test`: `playwright test`
- `test:qa`: run only `tests/e2e/qa.spec.js`
- `test:headed`: `playwright test --headed`
- `serve`: `python scripts/serve.py`

Set `private: true`, `type: "module"`, and `engines.node` to `>=22`. Add
`@playwright/test` with `npm install --save-dev @playwright/test`, letting npm
generate `package-lock.json`. Add `node_modules/`, `test-results/`,
`playwright-report/`, and `blob-report/` to `.gitignore`; do not ignore the
lockfile, config, tests, or workflow.

Create `playwright.config.js` with:

- `testDir: './tests/e2e'`
- one Chromium project
- one worker, including locally, because the legacy suite has a wall-clock
  performance smoke check and should not compete with parallel workers
- a 30-second test timeout and 5-second assertion timeout
- `forbidOnly: !!process.env.CI`
- `retries: process.env.CI ? 1 : 0`
- `use.baseURL: 'http://127.0.0.1:8474'`, viewport 1280×720, headless mode,
  and `trace: 'retain-on-failure'`
- `webServer.command: 'python scripts/serve.py'`, matching URL,
  `reuseExistingServer: !process.env.CI`, and a 15-second startup timeout
- a concise line reporter plus an HTML report that never opens automatically

**Verify**: `npm ci` -> exit 0. Then `npx playwright test --list` -> exit 0 and
lists no tests yet (or only the test created later if steps were committed
together); it must not start or modify the production game.

### Step 2: Convert the legacy suite into an importable browser module

Create `tests/runner.html` with the production-required canvas and a small status
panel. Its module script must `await import('../src/main.js')`, then
`await import('./qa_suite.js')`, then render `window.__qaResult` as formatted JSON
in `#qa-status`. On import failure, write the error message to the status panel
and rethrow so Playwright receives a `pageerror`.

Refactor `tests/qa_suite.js` to import production values from
`../src/data.js`. Derive:

- costs from `UNIT_TYPES`
- healing, defeat, loot, grace, and capacity values from `BALANCE`
- Ashford, camp `c1`, camp `c2`, and hero-start coordinates from `WORLD`

Fail immediately with a descriptive error if expected IDs (`ashford`, `c1`,
`c2`) are absent. Do not silently fall back to copied coordinates. Preserve all
17 `record(...)` calls, `window.runQaSuite()`, immediate execution, result shape,
and deterministic seeds. Remove the obsolete paste-tool and mirrored-constant
instructions.

**Verify**: `node --check tests/qa_suite.js` -> exit 0. Then
`rg -n "const COST|const HEAL_COST|const DEFEAT_GOLD_LOSS|const LOOT_BASE|const HERO_START" tests/qa_suite.js`
must show definitions derived from imported production objects, not numeric
literals copied from `src/data.js`.

### Step 3: Add an exit-code-bearing Playwright specification

Create `tests/e2e/test-helpers.js` with a small reusable runtime-error collector:

- subscribe to `page.on('pageerror')`
- subscribe to console messages and retain type `error`
- return the collected strings so each test can assert the list is empty after
  its behavioral assertions

Create `tests/e2e/qa.spec.js` with two isolated tests:

1. **Legacy suite passes**: attach error collection before navigation, open
   `/tests/runner.html`, wait until `window.__qaResult` exists, read it, and assert
   that every result is successful. Compare the ordered record names against the
   current 17-name list so accidental test deletion cannot still report green.
   Include failed record names/details in the assertion message.
2. **QA preserves the player save**: open `/`, start a genuine player world
   without calling `window.game`, write a distinctive valid value through the
   production `persistRun()` path, retain the raw `bf_save` string, navigate to
   `/tests/runner.html`, wait for 17/17, and assert the raw `bf_save` string is
   byte-for-byte unchanged. Also assert `bf_save_test` exists, proving the test
   slot was used.

Do not suppress console/page errors globally. The test must fail and print them.
Do not raise the existing 8-second performance budget merely to make CI green;
investigate a real regression or document runner overhead if that check fails.

**Verify**: `npm run test:qa` -> exit 0, two Playwright tests pass, the embedded
suite reports exactly 17 passed and 0 failed, and no runtime errors are printed.

### Step 4: Document the workflow for humans and agents

Update `README.md`:

- correct the local URL to `http://localhost:8474/`
- preserve the statement that the shipped game has no build step/runtime
  dependencies
- add a "Development and QA" section listing Node 22+ and Python 3 prerequisites
- document first setup: `npm ci`, then `npx playwright install chromium`
- document `npm test` as the required gate and `npm run test:headed` for debugging
- explain that Playwright starts/stops the existing Python server automatically
  and returns nonzero on QA or browser runtime failures

Create root `AGENTS.md` with:

- project architecture and the zero-runtime-dependency constraint
- canonical setup, serve, focused QA, and full-test commands
- a rule to run `npm test` before and after gameplay/test changes
- deterministic test conventions (`makeRng`, pinned world seeds, fixed timestep)
- the save-slot distinction: any `window.game` driver call marks test mode and
  writes `bf_save_test`; real persistence E2E tests must use isolated Playwright
  contexts and the raw `window.__g` handle only for controlled setup
- a prohibition on weakening assertions/performance budgets or ignoring console
  errors to obtain green CI
- a pointer to `tests/README.md`

Create `tests/README.md` with:

- how `runner.html`, `qa_suite.js`, and Playwright fit together
- the list/purpose of the 17 legacy checks
- how to add a test and where browser-level tests belong
- test isolation and localStorage rules
- expected-failure policy reserved for already-confirmed defects: use
  Playwright `test.fail`, never `skip`/`fixme`, include a finding/plan reference,
  and remove the annotation in the same change that fixes the defect
- troubleshooting for missing Chromium and a busy port 8474

**Verify**: `rg -n "npm test|test:qa|bf_save_test|tests/README" README.md AGENTS.md tests/README.md`
-> each concept is present in the appropriate documentation. Also run
`rg -n "localhost:8000" README.md AGENTS.md tests/README.md` -> no matches.

### Step 5: Add CI using the same command as local development

Create `.github/workflows/qa.yml`, triggered on pushes and pull requests to
`main` plus manual dispatch. Use Ubuntu, a 15-minute job timeout, Node 22, and:

1. `actions/checkout`
2. `actions/setup-node` with npm caching
3. `npm ci`
4. `npx playwright install --with-deps chromium`
5. `npm test`
6. upload `playwright-report/` on failure/non-cancellation

Use current supported action majors from the official Playwright CI example. Do
not duplicate test commands in shell scripts; CI must call the same `npm test`
developers use.

**Verify**: parse the workflow locally with an available YAML parser if one
already exists; do not install a separate parser. Regardless, run
`rg -n "npm ci|playwright install --with-deps chromium|npm test" .github/workflows/qa.yml`
-> each command appears exactly once and in that order.

### Step 6: Run the complete gate from a clean dependency install

Remove only the ignored `node_modules/` directory if a clean-install check is
needed, then run the locked workflow. Do not delete user files or any broad
directory. Run:

1. `npm ci`
2. `npx playwright install chromium`
3. `npm test`
4. `git diff --check`
5. `git status --short`

Review `git status --short`: every changed path must be in this plan's in-scope
list. Ensure no Playwright report, test result, browser binary, screenshot, or
localStorage artifact is tracked.

**Verify**: `npm test` exits 0 with two Playwright tests passing; `git diff --check`
exits 0; `git status --short` lists only in-scope files plus the plan status
update.

## Test plan

- Preserve the 17 legacy deterministic checks in `tests/qa_suite.js` and execute
  them from `tests/e2e/qa.spec.js`.
- Add a runner-integrity assertion over the exact current record names.
- Fail on browser page exceptions and console errors.
- Add a save-slot isolation test proving `bf_save` is untouched and
  `bf_save_test` is used.
- Use the existing `tests/qa_suite.js` record/result style as the behavioral
  source of truth; Playwright is a launch, isolation, and reporting layer rather
  than a rewrite of those checks.
- Verification: `npm run test:qa` and `npm test` both exit 0.

## Done criteria

- [ ] `package.json` has no runtime dependencies; `package-lock.json` is committed.
- [ ] `npm ci` exits 0 on Node 22+.
- [ ] `npx playwright install chromium` exits 0.
- [ ] `npm run test:qa` exits 0 and reports all 17 legacy records passing.
- [ ] The Playwright spec fails if any QA record, page exception, or console error
      is injected.
- [ ] The QA run demonstrably preserves a pre-existing `bf_save` and uses
      `bf_save_test`.
- [ ] `npm test` exits 0 from a clean install.
- [ ] README local URL is 8474 and setup/test commands are accurate.
- [ ] `AGENTS.md` and `tests/README.md` document commands, test architecture,
      deterministic conventions, save-slot isolation, and expected failures.
- [ ] GitHub Actions invokes `npm ci`, installs Chromium, and invokes `npm test`.
- [ ] No production source, production entry point, or Python server file changed.
- [ ] `git diff --check` exits 0 and no generated artifacts are tracked.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back; do not improvise if:

- Any current legacy record fails before or after the import-only conversion.
- The live suite contains a different number or set of record names than the 17
  found at commit `c07be05`.
- Running the suite requires modifying `src/**`, production `index.html`, or
  `scripts/serve.py`.
- The proposed test page cannot import `src/main.js` before `qa_suite.js` without
  a production code change.
- `npm ci` or Chromium installation fails twice after checking the documented
  Node version and ordinary network/proxy configuration.
- The test needs access to a non-isolated real browser profile or real user save.
- The performance smoke check only passes after raising its budget or disabling
  rendering.
- CI requires secrets, deployment permissions, or changes outside the in-scope
  workflow.

## Maintenance notes

- Updating `@playwright/test` may require rerunning `npx playwright install
  chromium`; the lockfile and CI browser install must move together.
- Keep one worker unless the performance smoke check is split into a dedicated
  serial project with an equivalent regression guarantee.
- `window.game` is intentionally not a neutral read/write API: driver calls switch
  persistence to `bf_save_test`. Persistence tests must understand this before
  selecting their setup surface.
- If production constants move, update the ES-module imports, not copied values.
- A reviewer should verify that Playwright remains development-only and GitHub
  Pages can still serve `index.html` directly with no build output.
- Plan 002 extends the runner with campaign persistence and non-victory lifecycle
 tests. Do not preemptively add those cases here.
