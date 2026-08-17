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
are treated as version 0 and migrated to the current version 1 shape with
documented legacy defaults. Unknown future versions, unknown production IDs,
malformed nested values, and out-of-range numbers are rejected and the active
save slot is cleared before `World` sees the payload.

Run the focused schema coverage with:

```text
npx playwright test tests/e2e/save-schema.spec.js
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
| AUDIT-03 defeat restores the surviving roaming party | browser E2E | expected failure until ordinary defeat restores the party |

AUDIT-03 is the only remaining active expected failure for a confirmed defect.
Its body runs on every `npm test`; Playwright treats a future pass as an
unexpected pass. The production fix and removal of its `test.fail` annotation
must ship in the same change. AUDIT-05 is now a normal regression and must stay
that way. Do not change an expected failure to `skip`/`fixme`, weaken its
assertion, or leave its annotation after the source behavior is fixed.

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
