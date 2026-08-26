# CLAUDE.md

Guidance for Claude Code when working in this repository.

`AGENTS.md` is the canonical engineering contract. This file is the short
orientation; when the two disagree, `AGENTS.md` wins. Read the relevant
`AGENTS.md` section before touching the subsystem it covers.

## What this is

Bannerfall is a static HTML5 canvas RTS served as native ES modules.
`index.html` loads `src/main.js` directly. **There is no build step and no
runtime dependency** — the only npm package is Playwright, used for QA. Do not
introduce a bundler, a transpiler, or a runtime import from `node_modules`.

## Commands

```text
npm ci                      # once per checkout
npx playwright install chromium
python scripts/serve.py     # local no-cache server on 127.0.0.1:8474

npm test                    # REQUIRED full gate before and after any change
npm run test:balance        # the @sweep balance measurement, its own CI check
npm run test:qa             # legacy named-record suite
npm run test:perf           # after scheduler/render/battle-loop/party-nav work
npm run test:visual         # canvas baselines
npm run test:visual:linux   # same suite in CI's font environment (needs Docker)
npm run test:tooling        # dependency-free config contract check
npm run release:cache       # rewrite cache tokens after ANY src/ edit
npm run test:release        # verify the token graph (CI runs this, no --update)
```

Playwright starts and stops the server itself. `npm run release:cache` followed
by `npm run test:release` is mandatory after every `src/` edit — CI fails
otherwise.

## Layout

| Path | Contents |
| --- | --- |
| `src/engine.js`, `src/main.js` | fixed-timestep loop, scene switching, input |
| `src/world.js`, `src/world/` | campaign map: tick pipeline, party AI, terrain, rendering |
| `src/battle.js`, `src/battle/` | fight scene: ordered phases, combat, separation, objectives, HUD |
| `src/region.js` | regional conquest model (ownership, specializations, stronghold power, raid cadence) — pure data, single source |
| `src/save.js` | versioned save schema and migration boundary (currently v4) |
| `src/audio.js` | `Sfx`: sample-backed one-shots, two streamed music beds, master/music/sfx buses |
| `assets/audio/` | the shipped clips; `SOURCES.md` records CC0 provenance per file |
| `src/platform/`, `src/persistence/` | capability + storage adapters (Steam-ready boundary) |
| `src/input-actions.js` | named action layer; gameplay never reads raw key codes |
| `src/data.js` | balance and unit tuning |
| `tests/e2e/` | Playwright suites — see `tests/README.md` |
| `tests/qa_suite.js` | deterministic legacy record suite |
| `plans/NNN-*.md` | one design plan per shipped slice |
| `critiques/`, `progress.md` | audit notes and running work log |

Scene classes are split by composition, not mixins: extracted functions take the
scene instance first (`drawScene(world, ctx)`). Anything a test or another module
reaches stays an instance **method** delegating to its module — the "delegating
seams" block at the end of each scene class. Tests patch those seams by name, so
replacing a delegator with a direct module call silently disables coverage.

## Rules that are easy to break

- **Never** weaken an assertion, raise a performance budget, skip a test, or
  update a visual baseline to get green CI. Structural Canvas budgets are
  machine-independent by design.
- **Simulation must not read presentation.** `Camera.toWorld()` feeds hero aim
  and formation slots, so it must never include the render-time shake offset.
- **RNG domains are separate.** `simRng` affects gameplay, `fxRng` only
  particles, camera shake has its own stream. Derive with
  `deriveSeed(seed, RNG_DOMAINS.<name>)`. Use `??` for seed defaults so seed `0`
  stays valid.
- **Save changes are schema changes.** Any new persisted field means a bump or
  migration in `src/save.js`, updated defaults and validation, and legacy +
  current + malformed fixtures. `World.syncLiveStateToSave()` is the only map
  snapshot boundary. Keep `bf_save` / `bf_save_test` isolated: anything touching
  `window.game` writes the test slot.
- **No direct platform access.** `localStorage`, filesystem, IPC, Electron and
  Steamworks calls belong in `src/platform/` and `src/persistence/`, never in
  `Game`, `World`, `Battle`, `Sfx`, or a simulation phase.
- **Determinism over sleeps.** Pinned seeds, fixed timesteps, the suite's
  `makeRng` conventions. No wall-clock waits in tests.
- **Terrain has one source.** Add a road or river only through
  `World.buildTerrainGeometry()` in `src/world/terrain.js`, or rendering,
  collision and navigation will diverge.
- **Audio must not `console.error`.** No sound before a user gesture, no music
  started on a suspended `AudioContext`, and every file named in `src/audio.js`'s
  manifest must exist — an autoplay violation or a 404 fails every spec that calls
  `collectRuntimeErrors`. New clips are CC0-only and are recorded in
  `assets/audio/SOURCES.md`. See `AGENTS.md`'s Audio section.

## Mechanics that look like bugs but are not

- The campaign world runs **only while the hero rides** (`World.timeFlowing()`,
  Plan 023). A stopped hero is untouchable by a party that has not yet closed to
  clash range. That is the mechanic; `world-freeze.spec.js` guards it. Fixtures
  that need a parked hero to still simulate use `window.game.keepAwake(true)`.
  The same freeze stops regional raids and the watchtower scouting phase —
  they run only on live ticks and consume no RNG while frozen.
- A world-scene modal genuinely pauses the campaign, and `stats.playT` is gated
  on both the modal and the frozen clock so neither can inflate reported time.
- `deliberate orders beat giving no order at all` in
  `tests/e2e/stance-balance.spec.js` is the one active `test.fail` annotation: it
  records the measured finding that squad orders do not beat pressing nothing.
  Remove it only when commanding actually wins, never to tidy the suite. It is
  tagged `@sweep` and excluded from the `chromium` project, so `npm test` does
  not run it; it runs as its own `Balance sweep` check and via
  `npm run test:balance`. Use
  `test.fail` with a plan or finding reference for expected failures — never
  `skip` or `fixme`.

## Working conventions

Non-trivial slices get a numbered plan in `plans/` and an entry in
`progress.md`. Follow the existing prose style in those files: plain statements
of what was measured, not adjectives.
