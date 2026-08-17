# Bannerfall agent guide

## Architecture boundary

Bannerfall is a static HTML5 canvas game using native ES modules. `index.html`
loads `src/main.js` directly; there is no production build step and no runtime
package dependency. `scripts/serve.py` is the local no-cache server and listens
on `127.0.0.1:8474`.

## Canonical commands

From the repository root:

```text
npm ci
npx playwright install chromium
python scripts/serve.py
npm run test:qa
npm run test:perf
npm run test:tooling
npm test
```

`npm test` is the required full gate before and after gameplay or test changes.
`npm run test:tooling` is the dependency-free contract check for Playwright and
CI configuration; run it before browser tests when changing test tooling.
Use `npm run test:headed` when a visible Chromium session is useful for
debugging. Playwright starts the server automatically for test commands.

Performance QA: run `npm run test:perf` after scheduler, Canvas rendering,
battle-loop, or party-navigation changes. The fixed-timestep scheduler may
skip a render only when no simulation update or explicit invalidation occurred;
resize, boot, scene changes, and visible UI changes invalidate the frame. The
watchdog must never draw while `document.hidden`, and direct test API calls
remain synchronous. Static world geometry uses bounded `Path2D` caches plus
camera culling; battle static props use an arena-sized layer. Never introduce
a full-map bitmap. Scratch arrays/entries are instance-owned, clear logical
lengths, and null stale references when shrinking. Battle units carry immutable
`team` tags for constant-time separation classification. Party replans use
seeded staggering and exact river collision/visibility; do not approximate or
quantize collision answers. World roads and rivers are single-source cached
sampled polylines: add a curve only through `World.buildTerrainGeometry()` so
rendering, collision, navigation, and movement bonuses cannot diverge.
Structural Canvas budgets are machine-independent
and must never be raised or bypassed to obtain green CI.

Canvas visual QA lives in `tests/e2e/visual-regression.spec.js` and runs in CI
on every pull request via `npm run test:visual`. It uses seeded scenarios,
explicit fixed steps, and a frozen page-side update hook; do not add wall-clock sleeps or
change production visuals solely to make a screenshot pass. Baselines are
platform-neutral and intentionally tolerate only the documented small raster
difference (`threshold: 0.20`, `maxDiffPixelRatio: 0.015`). Review actual,
expected, and diff PNGs before using `--update-snapshots`; never update a
baseline to conceal an unexplained regression. See `tests/README.md` for the
five covered world/battle states and the baseline workflow.

After persistence, battle-result, save, party-AI, or stronghold changes, also
run the focused campaign coverage:

```text
npx playwright test tests/e2e/campaign-persistence.spec.js
```

## Deterministic QA conventions

Keep browser checks deterministic: use the suite's `makeRng` conventions,
pinned world seeds, and fixed timesteps rather than wall-clock sleeps. Preserve
the existing 17 named legacy records and their result shape. Do not weaken an
assertion, raise a performance budget, or ignore page/console errors to obtain
green CI.

## Save-slot isolation

Any call through `window.game` marks the page as test mode and writes
`bf_save_test`. It must never overwrite a real player's `bf_save`. Real
persistence E2E tests use isolated Playwright contexts and may use the raw
`window.__g` handle only for controlled setup such as starting a genuine world
and calling production `persistRun()`. They must not use `window.game` for that
real-player setup.

See `tests/README.md` for the harness architecture, test placement, isolation
rules, and expected-failure policy.

`World.syncLiveStateToSave()` is the only map snapshot boundary. It copies live
hero and roaming-party coordinates into the canonical `World.save` immediately
before `persistRun()` serializes a non-victory world. Add new live campaign
fields there when they must survive refresh; deliberately transient movement,
presentation, and input state stays out of the save. Persistence tests must
cover both explicit `persistRun()` and the timed autosave boundary, followed by
a reload/Continue assertion.

Every world-to-battle transition must finish all map-side mutations, including
encounter removal and battle-count updates, then call `Game.persistRun()` once
while the scene is still `world`, before switching to `battle`. This writes a
coherent map checkpoint; it does not serialize or resume an in-progress battle.
Adding resumable battles or pending encounters requires an explicit versioned
save-schema design, migration, and dedicated coverage rather than expanding
this checkpoint casually.

Roaming-party lifecycle: removing a party for an encounter is temporary unless
all enemies die. Both retreat and ordinary defeat restore the surviving enemy
types at the original encounter coordinates with the original camp/home
identity; camp garrisons remain on their separate attrition path. Keep the
AUDIT-03 campaign regression and its fully-wiped control passing when changing
battle-result or party-restoration code.

Any save-field change must deliberately increment or migrate the schema in
`src/save.js`, update both fresh-save defaults and validation, and add legacy,
current, and malformed fixtures. The current save schema is version 2;
unversioned (v0) and version-1 saves migrate deterministically, including
deriving a missing legacy roaming-party `home` from its canonical camp. Current
version parties must have a finite valid `home`, and accepted saves must be
safe for immediate world/battle construction. Preserve `bf_save`/`bf_save_test`
isolation.
Run `npx playwright test tests/e2e/save-schema.spec.js` and
`npx playwright test tests/e2e/campaign-persistence.spec.js` in addition to
the required `npm test` gate.

The campaign spec has AUDIT-02 and AUDIT-05 as normal passing regressions.
AUDIT-03 is the only remaining active `test.fail` annotation. When fixing that
defect, remove its matching annotation in the same change. An unexpected pass
is useful drift that signals the test debt is ready to retire; never weaken the
assertion or add a skip to make the gate green.
