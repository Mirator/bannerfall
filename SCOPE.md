# Bannerfall — current scope

A snapshot of what the game is today: playable scope, technical shape, QA
gates, and CI/CD. `AGENTS.md` remains the engineering contract; this file
describes the product surface those rules protect. Last reviewed against the
tree at Plan 025.

## What it is

A minimalist real-time strategy game in the spirit of Thronefall — flat
colors, hard-edged shadows, tiny chunky armies — played in the browser.
Deployed as a static site at https://mirator.github.io/bannerfall/.

There is **no build step and no runtime dependency**: `index.html` loads
`src/main.js` directly as native ES modules. npm exists only for dev/QA
tooling (Playwright); nothing from `node_modules` ships or runs.

## Gameplay scope

### Campaign world (`src/world.js`, `src/world/`)

- One continuous overworld map with procedurally sampled terrain: rivers,
  bridges, roads (movement bonus), scenery, settlements and enemy camps.
- A hero on horseback: riding, gallop SFX/dust/bob gated on real speed,
  terrain speed modifiers, camera follow.
- Roaming enemy parties with seeded navigation and moods (`wary`, `chase`,
  clash): ambushes, run-downs, mutual clashes, and a raid break-off where a
  party that never closes gives up and occupies an unclaimed settlement.
- Settlement interactions at towns: recruit, heal, expand army cap — all
  refused while a settlement is occupied by an enemy party.
- Regional conquest (Milestone 025): one region with four settlements and the
  Wolfsjaw stronghold. Neutral ground is claimed peacefully — a paid row of the
  site menu, not a free ride-past (Plan 038: `BALANCE.claimCost`, more in total
  than the starting purse); captured ground gets a one-time, permanent specialization
  (Barracks, Archery, Market, Watchtower) whose benefit suspends while the
  settlement is occupied and resumes when it is won back.
- The stronghold's power ladder (ENTRENCHED/WEAKENED/EXPOSED) is derived from
  held settlements and razed linked camps and materially changes the final
  assault: fewer defensive guards per razed camp, the reserve wave removed at
  two captures, and an Exposed hold that starts thinned and deploys visibly
  when a Watchtower is held. Exposed also requires at least one razed linked
  camp (Plan 038): supply lines are what leave a hold exposed. Razing the last
  linked camp makes the surviving bands fall back on the hold and man its walls,
  bounded by the same stage-priced target its garrison is rolled against; the
  bands it has no room for stay out on the March.
- Regional pressure: Wolfsjaw dispatches one raid at a time at held ground
  (grace after captures and after successful defenses); a raid landing near
  the hero opens a Hold-the-ground defense battle, otherwise it occupies the
  settlement until driven out.
- Economy: gold from loot paid per enemy body TYPE, army cap expansion, the
  banner, and paid claims. Encounters are sized off how far the campaign has
  come rather than off the warband (Plan 038: `World.encounterBase()`), so
  spending gold buys a real advantage instead of raising both sides of the next
  fight; weighted spawn tiers still shift toward stronger parties as camps are
  razed, and an emergency beatable-floor correction guarantees a winnable fight
  always exists.
- Win condition: weaken and storm Wolfsjaw. The victory screen summarizes the
  whole campaign from the final save (time, battles, captures, razing,
  treasury, specializations). Losing fights restores surviving enemies;
  defeat costs gold.
- Time only flows while the hero rides (`World.timeFlowing()`, Plan 023):
  standing still freezes grace, spawns, timers, raids, particles and the
  ambient clock; interaction screens and clash resolution still work.

### Battles (`src/battle.js`, `src/battle/`)

- Real-time field battles entered via a pre-battle brief modal (approach
  direction, composition, withdraw option) with a post-battle aftermath
  screen; cancelling a brief charges the party like a spooked flee.
- Per-squad orders: one squad per unit type (spear, archer, knight; enemies
  add brutes/wolves-class types), each with its own stance (`hold`/`charge`)
  and hold anchor; the aggregate command mirrors `'mixed'` when squads
  diverge.
- Stance trade-offs are tuned constants: brace bonus vs fast closers, bow
  spread walking vs braced, charge exposure, no-death stall guard
  (`src/battle/constants.js`).
- Battlefield terrain derived from the campaign map via the serializable
  Brief (`src/world/battlefield-brief.js` → `src/battle/terrain.js`):
  world north = battle north, uniform 4x scale, no rotation. Rivers/fords,
  hills, woods, houses block movement and/or arrows under an explicit LOS
  blocker policy (hills, woods, houses only).
- Projectiles with flight and landing phase, spatial-index separation,
  stalemate resolution, single terminal decision point
  (`resolveBattleResult()`).
- Field objectives (Milestone 025): settlement fights are Hold-the-ground (a
  zone your troops must stand in, paused while an enemy contests it); camp and
  stronghold assaults are Break-the-position (2-3 destructible guards, count
  reduced by razed camps). Eliminating every enemy remains a parallel win;
  every ending resolves exactly once through `resolveBattleResult()`.
- Stronghold assaults may carry an Entrenched reserve wave that arrives on a
  timer, rolled deterministically at brief confirm.

### Persistence

- Versioned save schema in `src/save.js`, currently **v4**, with
  deterministic migrations from unversioned/v1/v2/v3 saves and validation that
  rejects malformed data before simulation. v4 adds per-settlement ownership
  and specialization records and the campaign-summary stat counters
  (`battlesLost`, `goldEarned`, `goldSpent`, `captures`).
- Explicit `persistRun()` checkpoints plus timed autosave; live map state
  reaches the save only through `World.syncLiveStateToSave()`.
- Real (`bf_save`) and test (`bf_save_test`) slots are isolated; anything
  through `window.game` writes only the test slot.

### Platform boundary

- All storage/platform access goes through `src/platform/` +
  `src/persistence/` (capability object + hydrated `SaveRepository`). The
  web adapter maps semantic slots to browser storage today; the same
  contract is reserved for a future Steam desktop adapter
  (`docs/adr/001-steam-desktop-host.md`).
- Input goes through named actions (`src/input-actions.js`); gameplay never
  inspects raw key codes, so controller/Steam Input can feed the same layer
  later.

## Technical shape

| Path | Role |
| --- | --- |
| `index.html` | entry point, loads `src/main.js` |
| `src/engine.js`, `src/main.js` | fixed-timestep scheduler, scene switching, input |
| `src/world.js`, `src/world/` | campaign tick pipeline, party AI, terrain, rendering |
| `src/battle.js`, `src/battle/` | battle phases, combat, separation, objectives, HUD, rendering |
| `src/region.js` | regional conquest model: ownership, specializations, stronghold power, objective tuning, raid cadence (pure data) |
| `src/save.js` | versioned schema + migration boundary (v4) |
| `src/platform/`, `src/persistence/` | capability/storage adapters (Steam-ready seam) |
| `src/data.js` | unit stats and balance tuning |
| `scripts/serve.py` | local no-cache server on `127.0.0.1:8474` |

Key invariants: simulation never reads presentation (no shake in
`Camera.toWorld()`), RNG domains are separate (`simRng` gameplay, `fxRng`
decorative, shake has its own stream, all derived via `deriveSeed`), terrain
geometry has one source (`World.buildTerrainGeometry()`), and structural
Canvas performance budgets are machine-independent and never raised to get
green CI.

## Commands

```text
npm ci                          # once per checkout (Node 22+)
npx playwright install chromium
python scripts/serve.py         # http://localhost:8474/

npm test                        # REQUIRED full gate around any change
npm run test:qa                 # legacy 25-record deterministic suite
npm run test:perf               # scheduler/render/loop/party-nav budgets
npm run test:visual             # canvas visual baselines
npm run test:tooling            # dependency-free Playwright/CI config contract
npm run release:cache           # rewrite content-derived cache tokens after src/ edits
npm run test:release            # verify every module edge carries the same token
npm run test:headed             # visible Chromium for debugging
```

Focused suites owed beyond `npm test`: save-schema for any persisted-field
change, campaign-persistence for persistence/result changes,
stance-balance for stance constants, region for the `src/region.js` model,
battle-objectives for objective/terminal-path changes, regional-campaign for
the capture/raid/defense loop, visual-regression for production
visuals.

## CI/CD

### CI — GitHub Actions (`.github/workflows/qa.yml`)

"Browser QA" runs on every push and pull request targeting `main` (plus
manual dispatch), on `ubuntu-latest`, 15-minute timeout:

1. Checkout, Node 22 with npm cache.
2. `npm ci` + `npx playwright install --with-deps chromium`.
3. `npm run test:tooling` — config contract before any browser work.
4. `npm run test:release` — verifies the content-derived cache-token graph;
   a `src/` change whose import tokens were not refreshed fails here before
   browser tests.
5. `npm test` — the full Playwright suite (QA records, persistence,
   schemas, stances, seams, freeze, hover, briefs, terrain, performance,
   visual baselines). Fails on any page exception or console error.
6. On failure, the Playwright report is uploaded as an artifact.

The checker behind steps 4–5 is Node-builtins-only: it adds no runtime
dependency and no build step.

### CD — GitHub Pages

Deployment is the project's GitHub Pages site serving `main`
(https://mirator.github.io/bannerfall/) — the shipped artifact is the repo
itself. There is deliberately no bundling/packaging pipeline; instead,
`npm run release:cache` stamps every static module edge in `index.html` and
its transitive imports with one deterministic content-derived query token,
and `test:release` enforces graph-wide agreement so a cached Pages response
can never mix incompatible module generations in one session.

### Release posture

- Every merge to `main` is shippable: CI green means the exact tree served
  by Pages passed QA.
- Visual baselines are platform-neutral with documented small raster
  tolerance; `system-ui` rasterizes differently per OS, so baselines are
  captured only in CI's exact environment — dispatch the `Visual baselines`
  workflow (`.github/workflows/visual-baselines.yml`), review the artifact,
  and commit only the intentionally changed or new PNGs.
- Desktop/Steam release is out of current scope and gated on the ADR-001
  checklist (shell/preload security, atomic files + Steam Cloud paths,
  controller/glyph QA, signed builds, overlay and Steam Deck validation).

## Deliberately out of scope today

- No bundler, transpiler, framework, or runtime package dependency.
- No resumable in-progress battles: world→battle transitions write a map
  checkpoint only; mid-battle resume would need a versioned schema design.
- No multiplayer, no accounts, no server backend.
- No direct platform APIs outside the adapter layer.
