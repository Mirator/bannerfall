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

Use isolated Playwright contexts for persistence tests. Clear only the test
origin's storage as part of setup. Calls through `window.game` write
`bf_save_test`; real-player persistence setup must avoid that API and may use
the controlled raw `window.__g` handle with production `persistRun()`. Never
read, modify, or depend on a user's real browser profile.

Expected failures are reserved for already-confirmed defects. Use Playwright
`test.fail` with a finding/plan reference, never `skip` or `fixme`; remove the
annotation in the same change that fixes the defect. Do not suppress console
errors, weaken assertions, or raise performance budgets to make CI green.

## Troubleshooting

If Chromium is missing, run `npx playwright install chromium` locally; CI uses
`npx playwright install --with-deps chromium`. If port 8474 is busy, stop the
other process or run the existing `python scripts/serve.py` instance only when
it serves this checkout; local Playwright reuses an existing server, while CI
starts a fresh one.

The focused commands are `npm run test:qa` for the two browser tests around the
legacy suite and `npm test` for the complete gate. Use `npm run test:headed` to
inspect the runner visually.
