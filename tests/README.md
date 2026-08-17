# Browser QA guide

## Harness architecture

`runner.html` supplies the production-required `<canvas id="game">`, imports
`src/main.js`, then imports `qa_suite.js`. The suite retains the historical
`window.runQaSuite()` and `window.__qaResult` globals and prints the result JSON
in `#qa-status`, so it is useful both to a human opening the page and to
Playwright.

`tests/e2e/qa.spec.js` is the exit-code-bearing Playwright layer. It starts the
existing Python server, checks browser/runtime errors, verifies all 17 record
names, and proves that running QA preserves `bf_save` while using
`bf_save_test`.

## World and battle seams

`tests/e2e/world-battle-seams.spec.js` protects the architecture boundary added
for audit finding #8. It wraps one controlled tick and asserts the live order of
World movement/interactions/party/spawn/presentation and Battle command,
hero/troop/enemy/separation/projectile/stalemate/result/presentation phases. It
also proves that constructing a second battle with another biome cannot mutate
the first battle's frozen palette. Keep this test focused on ownership and
ordering; gameplay outcomes belong in `qa.spec.js`, campaign behavior belongs
in `campaign-persistence.spec.js`, and pixel changes belong in the visual suite.

When adding a mechanic, put its state mutation in the phase that owns it. World
ticks move the hero before interactions, then run party AI before spawn/camera
maintenance. Battle ticks resolve projectile landings before the terminal
result check. Do not replace these narrow methods with a generic manager or
shared mutable context object.

## Performance coverage

`tests/e2e/performance.spec.js` is the focused structural performance gate.
Run it with `npm run test:perf` after scheduler, Canvas, battle-loop, or party
navigation changes. It drives fixed steps and seeded scenarios; it does not
use sleeps or machine-specific millisecond assertions. The four tests cover
144 Hz scheduler coalescing and hidden-watchdog suppression, world static path
reuse/culling, battle static/scratch reuse and team tags, and seeded party
replan staggering with cached goal visibility.

The scheduler renders after a fixed update or explicit invalidation only. The
watchdog never renders hidden documents. World caches are reusable `Path2D`
geometry and culling; battle caches are bounded to the arena and must not grow
into a full-map bitmap. Scratch buffers belong to their scene instance, reset
logical lengths, and clear stale references. Unit `team` tags must remain
immutable. Replanning must stay seeded and exact: never trade river/bridge
collision correctness for an approximate cache. Structural budgets are
intentionally fixed (`<10000` world and `<9000` battle `beginPath` calls over
20 draws); never raise or weaken them to make CI green.

## Canvas visual regression

`tests/e2e/visual-regression.spec.js` captures five representative, deterministic
Canvas states: a seeded world overview, a road/river/bridge landmark, a small
road battle, a large night camp battle, and a bridge ambush. Each scenario is
created through the existing `window.game.scenario()` API, advanced with the
synchronous fixed-step `window.game.step()`, then frozen before capture so rAF
and watchdog timing cannot affect the image. The test replaces only the page's
live update method after setup, leaving the normal pause overlay out of the
captured scene.

Run the focused suite with:

```text
npm run test:visual
```

Baselines live under `tests/e2e/__screenshots__/visual-regression.spec.js/`.
Playwright uses one platform-neutral path and compares at CSS-pixel scale with
`threshold: 0.20` and `maxDiffPixelRatio: 0.015`: this permits small
Windows/Linux font and antialiasing differences while still rejecting broad
terrain, unit, palette, or layout regressions. The default `npm test` command
discovers this spec and runs it on every pull request. A failure writes `test-results/` `-actual`, `-expected`,
and `-diff` images; inspect all three before deciding whether a change is
intentional.

To intentionally update a baseline, run the focused command with
`--update-snapshots`, inspect every changed PNG, and include the visual reason
in the change description. `--update-snapshots` is not a repair command and
must never be used to hide an unexplained regression. Visual checks supplement
semantic QA; keep both the focused `npm run test:visual` and the full `npm test`
gate green.

## Randomness domains

Runtime random draws are intentionally split into named streams. `simRng` is
for anything that can affect a campaign or battle result (composition, spawn
positions, AI/navigation timing, cooldowns, and projectile spread). `fxRng` is
for particles and decorative variation only. Camera shake has its own stream.
Use `deriveSeed(seed, RNG_DOMAINS.<name>)` when adding a new stream; never pass a
generic scene RNG to a visual effect. A quick regression is available through
`window.game.effects(false)`: run the same seeded inputs with effects enabled
and disabled and compare the canonical state, not particle counts. Preserve
seed `0` with nullish checks (`??`), not truthiness defaults.

## CI flake policy

Playwright uses zero retries locally. CI permits one retry only to collect
diagnostic trace and report data, while `failOnFlakyTests` makes a test that
passes only after that retry fail the workflow. A retry-dependent pass is
therefore never an accepted result. Verify this policy without launching a
browser with:

```text
npm run test:tooling
```

Use the focused command when diagnosing a failure locally, then rerun the
same test without changing its retry behavior. Do not quarantine a flaky test,
increase retries, or weaken its assertion to make CI green.

## Release cache-token check

The static browser graph is cache-busted with one token derived from the
normalized contents of the reachable src/*.js modules (including canonical
LF line endings). Normalizing the version query values makes the digest
independent of its own token while
still changing it whenever deployable JavaScript changes. The checker follows
the module script in index.html and every static import/export-from edge, so
transitive modules cannot silently retain an older generation.

After changing deployable JavaScript, run:

    npm run release:cache
    npm run test:release

Review the resulting query-token changes in index.html and src/ as part of the
release commit. The updater rewrites only recognized version-query locations
and fails on missing, dynamic, non-relative, or otherwise unsupported module
references. CI runs test:release in check-only mode; it must pass before the
browser suite. The local no-cache server avoids local debugging ambiguity,
while Pages' short response max-age is why all graph edges still need one
consistent token in a deployed release.

`tests/e2e/campaign-persistence.spec.js` owns real-player campaign transition
coverage. It uses a fresh Playwright context per test, the raw `window.__g`
handle for controlled setup, real scene/input/damage paths, and the isolated
`bf_save` slot. Run it directly while changing persistence, battle results,
party behavior, or the stronghold flow:

```text
npx playwright test tests/e2e/campaign-persistence.spec.js
```

## Save schema and migration

`src/save.js` is the authoritative save boundary. Unversioned browser saves
are treated as version 0 and version-1 browser saves are migrated to the
current version 2 shape with documented legacy defaults. Version-1 roaming
parties missing `home` receive the matching canonical camp coordinate during
migration; current-version parties must carry a finite, valid `home`. Unknown
future versions, unknown production IDs, malformed nested values, impossible
HP/max-HP relationships, and out-of-range numbers are rejected and the active
save slot is cleared before `World` sees the payload. The validator returns a
detached canonical object, so accepted saves are safe for immediate world and
battle construction.

Run the focused schema coverage with:

```text
npx playwright test tests/e2e/save-schema.spec.js
```

The focused schema suite covers v0/v1 migration, current-version round trips,
zero-seed preservation, battle maximum-HP propagation, malformed fixtures, and
save-slot clearing. Run it together with campaign coverage after changing
`src/save.js`, `src/world.js`, or `src/battle.js`:

```text
npx playwright test tests/e2e/save-schema.spec.js tests/e2e/campaign-persistence.spec.js
```

Construct fixtures from current `WORLD.camps`, `UNIT_TYPES`, and
`ENEMY_TYPES` production values. Do not invent camp or troop/enemy IDs, and
keep real-player persistence fixtures in isolated contexts using `bf_save`
and raw `window.__g`; calls through `window.game` belong to the `bf_save_test`
slot.

## Legacy check inventory

The 17 deterministic records cover:

1. menu-to-world transition;
2. battle invariants and victory;
3. end-banner timing;
4. defeat penalties;
5. volunteer rally floor;
6. victory loot, survivors, and hero regeneration;
7. troop commands and hold positions;
8. recruitment costs, capacity, and refusals;
9. healing refusals and success;
10. roaming-party victory removal;
11. camp-raid razing and captives;
12. captive capacity limits;
13. post-battle grace decay;
14. roaming-party strength bounds;
15. seeded battle determinism;
16. the 200-step performance smoke budget;
17. river-pursuit movement without freezing.

## Adding coverage

Keep deterministic simulation checks in `qa_suite.js` when they exercise the
existing headless API. Add browser-level launch, persistence, isolation, or
console/error checks under `tests/e2e/`. Preserve one worker because the
performance smoke check is wall-clock sensitive. Add the record name to the
ordered list in `tests/e2e/qa.spec.js` whenever the legacy suite intentionally
changes.

`tests/e2e/terrain-geometry.spec.js` is the focused terrain contract. It starts
a pinned world through the raw debug handle and checks that sampled road points
are queryable, the old invisible settlement chord is not a road, river samples
block away from bridges, bridge centers remain open, and river endpoints reach
the authored map edges. When adding terrain, define the curve once in
`World.buildTerrainGeometry()`; draw and simulation must consume its cached
polyline rather than maintaining independent coordinates.

`World.syncLiveStateToSave()` is the single map snapshot boundary. New live
campaign fields must be copied there if they should survive a refresh, or stay
deliberately transient if they are presentation/input state. Persistence
coverage should exercise both explicit `persistRun()` and the deterministic
four-second timed autosave, then reload and Continue to verify restoration.

Every world-to-battle transition is a map-side transaction: finish encounter
removal, coordinate, and battle-count mutations, call `Game.persistRun()` once
while the scene is still `world`, and only then switch to `battle`. The saved
value is a coherent map checkpoint, not serialized battle state; reload/Continue
therefore returns to the map rather than resuming an in-progress fight. A future
pending-encounter or resumable-battle feature needs an explicit versioned schema
design, migration, and dedicated tests instead of being added to this snapshot
casually.

Use isolated Playwright contexts for persistence tests. Clear only the test
origin's storage as part of setup. Calls through `window.game` write
`bf_save_test`; real-player persistence setup must avoid that API and may use
the controlled raw `window.__g` handle with production `persistRun()`. Never
read, modify, or depend on a user's real browser profile.

Expected failures are reserved for already-confirmed defects. Use Playwright
`test.fail` with a finding/plan reference, never `skip` or `fixme`; remove the
annotation in the same change that fixes the defect. Do not suppress console
errors, weaken assertions, or raise performance budgets to make CI green.

## Campaign coverage matrix

| Test | Layer | Expected status |
|------|-------|-----------------|
| Current-schema player save round-trips through Continue | browser E2E | pass |
| Retreat restores the engaged party minus actual dead enemy types | browser E2E | pass |
| Hard-mode defeat retains exactly one fallback squire | browser E2E | pass |
| Final stronghold victory enters the victory scene and clears the run save | browser E2E | pass |
| AUDIT-02 autosave captures live hero and roaming-party positions | browser E2E | pass (explicit save, timed autosave, reload/Continue) |
| AUDIT-05 battle entry persists a coherent transaction | browser E2E | pass (active-battle checkpoint, schema, removed party, reload/Continue) |
| AUDIT-03 defeat restores the surviving roaming party | browser E2E | pass (survivors return to the encounter location; fully wiped parties stay removed) |

Roaming-party lifecycle invariant: removing a party for a battle is temporary
unless every enemy dies. Retreat and ordinary defeat both restore exactly the
surviving enemy types at the original encounter coordinates, preserving the
party's camp/home identity; camp garrisons use their separate attrition path.
The AUDIT-03 regression and its fully-wiped control cover this invariant. Run
`npx playwright test tests/e2e/campaign-persistence.spec.js` when changing
battle results, party behavior, or recovery/teleport rules. AUDIT-05 is a normal
regression and must stay that way. Do not change an expected failure to
`skip`/`fixme`, weaken its assertion, or leave its annotation after the source
behavior is fixed.

The setup distinction is intentional: `window.game` is appropriate for
deterministic scenario-driver checks and writes `bf_save_test` after its first
driver call. Real persistence/lifecycle tests may use `window.__g` only inside
their isolated Playwright context, and must never touch a developer's normal
browser profile. Prefer real keyboard input, world collision, damage, and
scene-transition paths for the behavior under assertion; direct mutation is
limited to small deterministic fixtures such as a unique roaming party.

## Troubleshooting

If Chromium is missing, run `npx playwright install chromium` locally; CI uses
`npx playwright install --with-deps chromium`. If port 8474 is busy, stop the
other process or run the existing `python scripts/serve.py` instance only when
it serves this checkout; local Playwright reuses an existing server, while CI
starts a fresh one.

The focused commands are `npm run test:qa` for the two browser tests around the
legacy suite and `npm test` for the complete gate. Use `npm run test:headed` to
inspect the runner visually.
