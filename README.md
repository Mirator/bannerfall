# Bannerfall

A minimalist real-time strategy game in the spirit of Thronefall — flat colors, hard-edged shadows, tiny chunky armies — playable directly in the browser. No build step, no dependencies: plain HTML5 canvas and ES modules.

**▶ Play it here: https://mirator.github.io/bannerfall/**

## Run locally

Any static file server works (ES modules require http://, not file://):

```
python scripts/serve.py
```

then open http://localhost:8474/.

## Development and QA

Development requires Node.js 22+ and Python 3. The shipped game remains a
static HTML5 canvas application with native ES modules: npm packages are
development-only QA tooling, and there is still no build step or runtime
dependency.

For a fresh checkout, install the locked development packages and the local
Chromium browser once:

```
npm ci
npx playwright install chromium
```

Run `npm test` before submitting gameplay or test changes. It starts and stops
the existing Python server on port 8474 automatically, runs the browser suite,
and returns a nonzero exit code for a failed QA record, page exception, or
browser console error. `npm run test:qa` runs the focused legacy 17-check suite;
`npm run test:headed` opens Chromium for local debugging. See `AGENTS.md` for
the agent contract and `tests/README.md` for test architecture and extension
rules.

### Save compatibility

`src/save.js` is the canonical versioned save schema and migration boundary.
It migrates the unversioned legacy format and versions 1 and 2, writes current
saves as version 3, and rejects malformed or unsupported future data before it
reaches the world simulation. Keep the field-level contract in that module; see
`tests/README.md` for valid fixture construction and the focused schema test
command.

## Structure

- `index.html` — entry point
- `src/` — game code (engine, world map, battles, data)
- `tests/runner.html` — human-readable browser QA runner
- `tests/qa_suite.js` — deterministic 17-check regression suite
- `tests/e2e/` — Playwright launch, isolation, and reporting tests
- `scripts/` — local dev helpers (static server, screenshot server)
- `critiques/` — design critique notes from the build process
