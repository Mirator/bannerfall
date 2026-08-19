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
npm run release:cache
npm run test:release
npm test
```

`npm test` is the required full gate before and after gameplay or test changes.
`npm run test:tooling` is the dependency-free contract check for Playwright and
CI configuration; run it before browser tests when changing test tooling.
The release:cache command computes and applies the deterministic
content-derived query token to the deployable module graph. Run it after
changing any file under src/, review the token-only import changes, then run
test:release to verify that every static module edge in index.html and its
transitive imports uses the same token. The checker is Node-built-in only; it
does not add a runtime dependency or build step. CI runs the checker without
updating files, so a source change that omits the updater fails before browser
tests. The Pages response cache may retain an individual asset for its short
max-age, but graph-wide matching prevents a browser from combining
incompatible module generations.
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

Simulation ownership: `World.update()` is the ordered campaign pipeline.
`updateWorldScreens()` (Plan 021) runs FIRST and returns `true` whenever a
world-scene modal — the pre-battle brief or the post-battle aftermath — is
open, pre-empting every phase below it for that tick, the same pre-empt idiom
`updateCampInteraction()` already uses. It must never fall through in the same
tick a screen opens, or that tick's opening keypress is still in `pressed` and
instantly resolves the screen it just opened. After the gate: hero
movement/terrain runs first, settlement and scouting interactions run second,
camp assault input runs third, roaming-party AI owns navigation and encounter
handoff, then party spawning and camera/effects maintenance finish the tick.
Keep campaign arrays (`parties`, `save.troops`, `save.camps`) and their timers in
those world phases; do not add a second map snapshot boundary.

A world-scene modal genuinely pauses the campaign, not just visually covers
it: gating the pipeline on `updateWorldScreens()` freezes `grace` for free
(it only decays inside `updateParties()`, which never runs while a screen is
open), and `World.isBlocking()` — `true` whenever `this.screen` is set — lets
`main.js` gate `stats.playT` accrual the same way, so leaving a screen open
cannot inflate reported campaign time. Both freezes are deliberate and
covered by tests, not incidental side effects to "fix".

`Battle.update()` owns the ordered fight pipeline. `updateSceneState()` handles
intro/end gates, `updateActivePhases()` runs live commands, hero, troop/enemy,
separation, and stalemate work, `updateProjectilePhase()` resolves landings,
and `resolveBattleResult()` is the single terminal/retreat decision point.
Keep future mechanics in the narrow phase that owns their state and preserve
projectile-before-result ordering. Battle palette data is frozen and owned by
each `Battle` instance; never mutate `PAL.battle` or introduce module-global
palette state. These seams are intentionally methods, not generic managers or
an ECS, so adding a cross-phase context object requires a new design review.

Battle orders are per-squad. One squad exists per `UNIT_TYPES` key and membership is
derived from a troop's type, never assigned, so `save.troops` stays `{type, hp}` and
squad state costs no save-schema version. `Battle.squads` owns per-squad stance;
`updateTroopPhase()` reads it through `squadStance(t)` and must not read a global command.
Hold anchors are still per-troop (`holdX`/`holdY`) plus one global `holdPoint`; the
`squads[type].holdX/holdY` fields are written but not yet read, so do not rely on them. `Battle.command` remains the all-squads aggregate (`'mixed'` when squads
diverge) because the legacy QA record and the input-action contract assert on it; keep
that mirror intact. Selection (`selectedSquad`) is input/presentation state and stays out
of the save. Stance trade-offs live in named constants at the top of `src/battle.js`
(brace bonus, bow spread, charge exposure, no-death stall) — tune those, not scattered
literals, and re-run `tests/e2e/stance-balance.spec.js`.

`Camera.toWorld()` is a simulation input: it feeds hero aim, hero facing, and therefore
FOLLOW formation slots. It must never include the shake offset that `apply()` adds at
render time. Presentation may read simulation state; simulation must not read
presentation. A shake term there let a decorative RNG stream change fight outcomes.

The world map's hover panel (Plan 021) is presentation-only state
(`World.pointerBootX/Y`, `pointerEverMoved`, `hoverTarget`), written and read
only in `World.draw()`. Its boot-safe latch compares the pointer's current,
persistent `input.mouse.x/y` against their value at `World` construction
rather than the transient `input.mouse.moved` flag: `Input.endFrame()` clears
`moved` at the end of every `Game.update()` call, and a render only ever
happens after at least one `update()` in the same tick, so `moved` is already
false again by the time `draw()` would read it in the ordinary case of one
update per rendered frame. The coordinate comparison sidesteps that ordering
entirely while staying just as boot-safe, since the default pointer sits on
the hero token (canvas centre) at construction.

Canvas visual QA lives in `tests/e2e/visual-regression.spec.js` and runs in CI
on every pull request as part of `npm test`; use `npm run test:visual` for the
focused suite. It uses seeded scenarios,
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
the existing 22 named legacy records and their result shape. Do not weaken an
assertion, raise a performance budget, or ignore page/console errors to obtain
green CI.

Randomness domains are explicit: `simRng` may affect gameplay state, `fxRng`
may only affect particles/decorative variation, and camera shake uses its own
stream. Derive new streams with `deriveSeed(seed, RNG_DOMAINS.<name>)`; never
share a generic gameplay RNG with presentation code. Validate changes with
`window.game.effects(false)` and the QA record
`rng_domains_keep_simulation_independent_of_effects`. Use `??` for seed
defaults so the valid seed `0` remains deterministic.

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

Plan 021 splits that transition into a request and a commit. `World.startBattle()`
keeps committing immediately and unconditionally — legacy QA records and
`window.__g` call it directly and assert `battle` on the next line, so its
signature and behavior stay put. Every map-initiated fight instead reaches it
through `World.requestBattle(descriptor)`, which opens the pre-battle brief
(a world-scene modal; `sceneName` stays `world`) and defers the encounter
removal, `battleCount` increment, and `persistRun()` to `confirmBrief()`. The
descriptor holds everything the eventual `startBattle()` call needs — comp
snapshot, title/subtitle/arena/approach/deploy, `canWithdraw`, and either a
live `party` reference (index resolved at confirm, bailing cleanly if it is
no longer present) or a `campId` (whose garrison, if unscouted, is rolled only
at confirm — never at request — so backing out never reveals it for free).
Cancelling charges the party the same way a spooked flee already does
(`clashT = BALANCE.battleGrace`, `waryT = 25`) and leaves every camp/save field
untouched. The aftermath modal that follows battle end rides on
`game.pendingAftermath`, consumed and cleared in the next `World`'s
constructor beside the existing toast replay — never on `save`, so no schema
change and a refresh mid-aftermath simply loses the screen. It is skipped
when `save.won`: the final victory screen already is that fight's aftermath.

Roaming-party lifecycle: removing a party for an encounter is temporary unless
all enemies die. Both retreat and ordinary defeat restore the surviving enemy
types at the original encounter coordinates with the original camp/home
identity; camp garrisons remain on their separate attrition path. Keep the
AUDIT-03 campaign regression and its fully-wiped control passing when changing
battle-result or party-restoration code.

Settlement-occupation lifecycle (Plan 020): a party that holds `chase` mood
against the hero for `BALANCE.raidBreakOffT` seconds without ever clashing
gives up the hunt and beelines for the nearest settlement that is not already
**claimed** — see `World.isSettlementClaimed()`, which counts a settlement as
claimed once some party occupies it (`p.occupying`) or is already travelling
to raid it (`p.raid`). A break-off is refused unless at least two settlements
are unclaimed, so claiming one always leaves at least one behind; this is the
structural half of the deadlock floor guarantee. On arrival (`dist2` under
`BALANCE.raidArrivalR`) the party sets `save.settlements[id].occupied = true`,
parks in place, and is exempt from the `BALANCE.settlementSafeR` sanctuary
block in the party-clash check — an occupier must always be attackable where
it sits, or the player has no recapture path. `updateSettlementInteractions()`
refuses recruiting/healing/army-cap expansion at an occupied settlement and
says so. Winning the battle against the occupier clears `occupied` via the
same `onWinExtra` hook camp raids use; retreat/defeat restore the occupying
party in place (still occupying) through `partyMeta.occupying`, except the
edge case where the party is fully wiped without a formal victory, which also
clears the settlement rather than leaving a phantom occupation with nobody to
fight. The other, probabilistic half of the deadlock floor guarantee is
`World.enforceBeatableFloor()`, run once per world tick: if no live party
(including one occupying a settlement) sits at or under
`BALANCE.beatablePartyRatio`, it downgrades the single weakest live party to
an even-tier composition. It is an emergency correction, not a routine
crutch — the weighted spawn tiers below keep something beatable on the map
in ordinary play. Cover both mechanisms with the same "drive the worst case,
not the happy path" test discipline; see the deadlock test in `tests/qa_suite.js`.

Roaming-party spawn strength (Plan 020): `World.spawnParty()` no longer
guarantees a party in a flat fair band. It draws a weighted tier
(`BALANCE.partyTiers.weak/even/strong`) whose weights shift toward `strong` as
non-stronghold camps are razed, so the curve rises across a run instead of
tracking the player forever. An explicit `band` argument still overrides the
draw (used by QA to probe the `[2,24]` strength clamp directly); never assert
a tier-distribution property from a single seed — sweep several.

Any save-field change must deliberately increment or migrate the schema in
`src/save.js`, update both fresh-save defaults and validation, and add legacy,
current, and malformed fixtures. The current save schema is version 3;
unversioned (v0), version-1, and version-2 saves migrate deterministically,
including deriving a missing legacy roaming-party `home` from its canonical
camp and defaulting `save.settlements` to every settlement unoccupied. Current
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

## Steam-ready platform boundary

Game code must use the capability object created by `src/platform/` and the
initialized `SaveRepository` in `src/persistence/`. Direct `localStorage`,
filesystem, IPC, Electron, Steamworks, and lifecycle-global access do not belong
in `Game`, `World`, `Battle`, `Sfx`, or the simulation phases. The web adapter
maps semantic slots (`campaign`, `testCampaign`, `settings`) to browser storage;
the future desktop adapter will map the same contract to atomic per-user files
and a native quit handshake. Repository reads are hydrated before Game exists;
the fixed loop only uses its synchronous in-memory cache, while writes are ordered,
flushable, and observable on error. Real and test campaign slots remain isolated.
There are no synchronous storage escape hatches or adapter rereads from Game;
browser fixtures must seed storage before bootstrap/reload.

Gameplay consumes named actions from `src/input-actions.js` through `Input`; it
must not inspect raw key-code sets. New controller or Steam Input support feeds
that action layer and keeps device glyphs/UI separate from simulation. The
existing Canvas, WebAudio, native-module, deterministic RNG, and World/Battle
phase boundaries remain unchanged. Steamworks APIs belong behind a future
desktop adapter and may consume domain outcomes, but never run inside update
phases or save migrations.

Before any desktop release, add the shell/preload security boundary, atomic
files/backups and Steam Cloud paths, controller/glyph QA, fullscreen and
multi-monitor QA, signed builds, crash-safe quit/flush, overlay tests, and Steam
Deck validation. Run `npm run release:cache` and `npm run test:release` after
every `src/` edit.
