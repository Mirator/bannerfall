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
