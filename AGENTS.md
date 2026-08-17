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
npm test
```

`npm test` is the required full gate before and after gameplay or test changes.
Use `npm run test:headed` when a visible Chromium session is useful for
debugging. Playwright starts the server automatically for test commands.

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

Any save-field change must deliberately increment or migrate the schema in
`src/save.js`, update both fresh-save defaults and validation, and add legacy,
current, and malformed fixtures. Preserve `bf_save`/`bf_save_test` isolation.
Run `npx playwright test tests/e2e/save-schema.spec.js` and
`npx playwright test tests/e2e/campaign-persistence.spec.js` in addition to
the required `npm test` gate.

The campaign spec has AUDIT-02 as a normal passing regression. AUDIT-03 and
AUDIT-05 remain active `test.fail` annotations. When fixing one of those
defects, remove its matching annotation in the same change. An unexpected pass
is useful drift that signals the test debt is ready to retire; never weaken the
assertion or add a skip to make the gate green.
