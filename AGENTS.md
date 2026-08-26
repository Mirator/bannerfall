# Bannerfall agent guide

This is the canonical engineering contract for Bannerfall. `CLAUDE.md` is the
short orientation and defers to this file; `tests/README.md` owns the test
harness architecture, fixture construction and placement rules. Read the section
that covers a subsystem before changing it — most rules here exist because a
specific defect or measurement put them there.

## Contents

- [Architecture boundary](#architecture-boundary)
- [Commands and gates](#commands-and-gates)
- [Module layout and seams](#module-layout-and-seams)
- [World simulation](#world-simulation)
- [Battle simulation](#battle-simulation)
- [Simulation must not read presentation](#simulation-must-not-read-presentation)
- [Performance budgets](#performance-budgets)
- [Determinism and RNG domains](#determinism-and-rng-domains)
- [Visual regression](#visual-regression)
- [Audio](#audio)
- [Save schema and persistence](#save-schema-and-persistence)
- [Campaign lifecycle](#campaign-lifecycle)
- [Expected failures and test debt](#expected-failures-and-test-debt)
- [Steam-ready platform boundary](#steam-ready-platform-boundary)

## Architecture boundary

Bannerfall is a static HTML5 canvas game using native ES modules. `index.html`
loads `src/main.js` directly; there is no production build step and no runtime
package dependency. `scripts/serve.py` is the local no-cache server and listens
on `127.0.0.1:8474`.

## Commands and gates

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

Which focused coverage a change owes, beyond the required `npm test` gate:

| Change | Also run |
| --- | --- |
| anything under `src/` | `npm run release:cache`, then `npm run test:release` |
| scheduler, Canvas rendering, battle loop, party navigation | `npm run test:perf` |
| any persisted field, migration or validation | `npx playwright test tests/e2e/save-schema.spec.js` |
| persistence, battle result, save, party AI, strongholds | `npx playwright test tests/e2e/campaign-persistence.spec.js` |
| stance constants in `src/battle/constants.js` | `npx playwright test tests/e2e/stance-balance.spec.js` |
| the regional model in `src/region.js` | `npx playwright test tests/e2e/region.spec.js` |
| battle objectives (`src/battle/objectives.js`, terminal paths) | `npx playwright test tests/e2e/battle-objectives.spec.js` |
| capture/claim, specialization, raids, defenses, stronghold power | `npx playwright test tests/e2e/regional-campaign.spec.js` |
| `src/audio.js`, anything under `assets/audio/` | `npx playwright test tests/e2e/audio.spec.js` |
| production visuals | `npm run test:visual` |
| Playwright or CI configuration | `npm run test:tooling` |

## Module layout and seams

Scene module layout: the two scene classes are split across `src/battle/` and
`src/world/`. `battle.js` keeps construction, the ordered tick pipeline and the
small targeting/stance helpers; `battle/{constants,combat,ai-phases,separation,
render-units,render-scene,hud}.js` hold the rest. `world.js` keeps construction,
the tick pipeline, party AI and the cheap per-tick terrain predicates;
`world/{terrain,settlement-interactions,battle-transition,render-scene,
render-actors}.js` hold the rest. Extracted functions take the scene instance as
their first argument (`drawScene(world, ctx)`), the pattern `battle/spatial-index.js`
and `persistence/save-repository.js` already use — composition with explicit
dependencies, not prototype mixins.

`constants.js` depends on nothing but `data.js` ON PURPOSE: with no bundler an
import cycle is a real hazard, and every phase/render module reads its tuning
values, so it must never import back from a scene.

Anything a test or another module reaches stays an instance METHOD that delegates
to its module (see the "delegating seams" block at the end of each scene class).
That is not decoration: `world-battle-seams.spec.js` patches the ordered phases BY
NAME to assert their sequence, `performance.spec.js` drives
`updateSeparationPhase`/`getSpatialStats` straight off the instance, and the
campaign suites call `endBattle`/`damageEnemy`. Replacing a delegator with a direct
module call silently disables those tests. `updateWorldClock` and `tryClash` join
that list under Plan 023: `world-battle-seams.spec.js` patches `updateWorldClock`
by name in all three of its world tests, and `updateParties(dt, frozen = false)`
carries that default specifically because `tests/qa_suite.js` calls the method
directly off the instance. Hot per-tick one-liners (`blockedAt`,
`onRoad`, `strength`, `myStrength`, `isBlocking`) deliberately stay in the scene
class rather than being moved out behind a delegator that would cost more than the
body it forwards to.

## World simulation

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
cannot inflate reported campaign time. `World.isTimeFrozen()` is its Plan 023
companion and gates `stats.playT` identically, so neither an open modal nor a
stopped map can inflate reported campaign time; the 4-second autosave is
deliberately NOT gated, because a save write is durability rather than simulation
and while frozen it rewrites identical bytes. All three freezes (modal,
stopped-hero, and the `playT` gate) are deliberate and covered by tests, not
incidental side effects to "fix".

Plan 023: the campaign world is alive ONLY while the hero rides.
`World.timeFlowing()` — realized hero speed at or above `BALANCE.worldWakeSpeed`
(the same 40 px/s that already gates bob, dust and the gallop SFX) — is the whole
rule, and `updateHeroMovement()` publishes that speed as `heroSpeed` at the END of
the phase: post-clamp and post-coast-damp, deliberately NOT the pre-clamp `sp` the
bob/dust/SFX gate uses (`sp` lags a tick on coast). The freeze gate therefore sits
AFTER the movement phase, and the movement phase always runs, so the horse coasts
to a stop instead of freezing mid-slide. While time is frozen the only phases that
run are the ones taking no `dt` — settlement and camp interaction, which are the
player pressing a key at a town or a camp and must NEVER be gated, since standing
still is how you recruit, heal, scout and press an assault — plus the terminal
victory transition (`save.won` is set during the battle, so the returning World's
first tick is always a frozen one and gating it would hang a won campaign), plus
`updateParties(dt, true)`, which runs the `tryClash()` encounter seam and nothing
else so that letting go of the keys cannot shake off a party that has already
closed to clash range. Everything else holds: `grace`, `spawnT`,
`waryT`/`chaseT`/`clashT`, `msgT`, particles, the camera, and the ambient
presentation clock `world.time` that drives the river current, windmill vanes,
tree sway, campfire, threatened-settlement pulse and hero banner. A frozen tick
consumes NO `simRng` or `fxRng` draws at all, so campaign randomness is
independent of how long the player stood still — do not add a phase that breaks
that. Initiative (`p.mood`, which decides ambush vs run-them-down vs mutual) is
whatever the last live tick decided; that is correct in play, because a real clash
always happens while riding or coasting.

`updateWorldClock()` is the SINGLE documented exception to the
no-`dt`-while-frozen rule: it advances `staleT`, the 0..1 strength of the
desaturation/vignette cue that tells the player why nothing else is moving, so it
must advance on exactly the ticks when nothing else does. It is advanced in
`update()` and never in `draw()` — `draw()` runs zero or many times per tick.
`render-scene.js`'s `drawFreezeCue()` READS `staleT` and never writes it, draws
under the HUD, and suppresses itself under a modal. Keep the wash light: the world
layer beneath it carries gameplay-critical colour coding (the red "they outmatch
you" pill, the party marker), and a heavy desaturation strips that signal. The cue
also draws with effects disabled, on purpose — it is information, not decoration.
`staleT` is deliberately NOT in `state()`: it accumulates every frozen tick, so
exposing it would make `state()` sensitive to elapsed frames and break
`world-hover.spec.js`'s byte-identical comparison.

A stopped hero being untouchable by a party that has not yet closed is the
MECHANIC, not a bug — it is symmetric (the player cannot reach them either) and
self-limiting (every objective needs riding). The clash exemption above is the only
guard; a proximity-based "stay alive near a chaser" softener would void the
mechanic's core promise. `world-freeze.spec.js` asserts it so it cannot be quietly
undone.

Fixtures that deliberately PARK the hero and still need the world to simulate use
`window.game.keepAwake(true)` — a treadmill that makes the movement phase report a
riding speed without travelling, so `hero.vx/vy` stay 0 and `hero.x/y` never move.
It is scoped to the current scene instance, so re-apply it after any `scenario()`.
The `world_brief` and `world_aftermath` scenarios apply it internally for their
single setup tick, so every consumer of those keeps working unchanged.

## Battle simulation

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
`updateTroopPhase()` reads it through `squadStance(t)` and must not read a global
command. Hold anchors exist at two levels and both are live: troop movement steers to
the per-troop `holdX`/`holdY` in `updateTroopPhase()`, while `squads[type].holdX/holdY`
is the anchor each squad's hold banner is drawn from in `battle/render-scene.js`. The
banner used to be gated on the aggregate `command`, which is never `'hold'` under a
split order, so the affordance disappeared exactly when squads were used independently;
keep it per-squad. `Battle.command` remains the all-squads aggregate (`'mixed'` when
squads diverge) because the legacy QA record and the input-action contract assert on it;
keep that mirror intact. Selection (`selectedSquad`) is input/presentation state and
stays out of the save. Stance trade-offs live in named constants in
`src/battle/constants.js` (brace bonus, bow spread, charge exposure, no-death stall) —
tune those, not scattered literals, and re-run `tests/e2e/stance-balance.spec.js`. The
phases that read them are in `src/battle/ai-phases.js`.

Battle objectives (Milestone 025): a battle may carry a descriptor-built runtime
objective — `hold` (a zone the player's troops must stand in, paused while an enemy
contests it) or `break` (2-3 destructible guards; the count for a stronghold comes
from the stronghold modifiers, so razed camps really remove guards). Elimination is
always a parallel win. Objective state lives in `src/battle/objectives.js`;
`updateObjectivePhase()` sits between stalemate and result so
`resolveBattleResult()` — the single terminal decision point — judges every ending,
and `endBattle()`'s own state guard makes redundant condition checks no-ops. Tune
durations, guard counts and target HP in `OBJECTIVES` in `src/region.js`, not in
the battle code, and re-run `tests/e2e/battle-objectives.spec.js`.

## Simulation must not read presentation

`Camera.toWorld()` is a simulation input: it feeds hero aim, hero facing, and therefore
FOLLOW formation slots. It must never include the shake offset that `apply()` adds at
render time. Presentation may read simulation state; simulation must not read
presentation. A shake term there let a decorative RNG stream change fight outcomes.

The world map's hover panel (Plan 021) is presentation-only state
(`World.pointerBootX/Y`, `pointerEverMoved`, `hoverTarget`), written and read
only on the draw path — `World.draw()` delegates to `drawScene()` in
`src/world/render-scene.js`, which is the single place that touches it. Its boot-safe latch compares the pointer's current,
persistent `input.mouse.x/y` against their value at `World` construction
rather than the transient `input.mouse.moved` flag: `Input.endFrame()` clears
`moved` at the end of every `Game.update()` call, and a render only ever
happens after at least one `update()` in the same tick, so `moved` is already
false again by the time `draw()` would read it in the ordinary case of one
update per rendered frame. The coordinate comparison sidesteps that ordering
entirely while staying just as boot-safe, since the default pointer sits on
the hero token (canvas centre) at construction.

## Performance budgets

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
sampled polylines: add a curve only through `World.buildTerrainGeometry()`
(implemented in `src/world/terrain.js`) so rendering, collision, navigation, and
movement bonuses cannot diverge.
Structural Canvas budgets are machine-independent
and must never be raised or bypassed to obtain green CI.

## Determinism and RNG domains

Keep browser checks deterministic: use the suite's `makeRng` conventions,
pinned world seeds, and fixed timesteps rather than wall-clock sleeps. Preserve
the existing 25 named legacy records and their result shape. Do not weaken an
assertion, raise a performance budget, or ignore page/console errors to obtain
green CI.

Randomness domains are explicit: `simRng` may affect gameplay state, `fxRng`
may only affect particles/decorative variation, and camera shake uses its own
stream. Derive new streams with `deriveSeed(seed, RNG_DOMAINS.<name>)`; never
share a generic gameplay RNG with presentation code. Validate changes with
`window.game.effects(false)` and the QA record
`rng_domains_keep_simulation_independent_of_effects`. Use `??` for seed
defaults so the valid seed `0` remains deterministic.

## Visual regression

Canvas visual QA lives in `tests/e2e/visual-regression.spec.js` and runs in CI
on every pull request as part of `npm test`; use `npm run test:visual` for the
focused suite. It uses seeded scenarios,
explicit fixed steps, and a frozen page-side update hook; do not add wall-clock sleeps or
change production visuals solely to make a screenshot pass. Baselines are
platform-neutral and intentionally tolerate only the documented small raster
difference (`threshold: 0.20`, `maxDiffPixelRatio: 0.015`). Review actual,
expected, and diff PNGs before using `--update-snapshots`; never update a
baseline to conceal an unexplained regression. Baselines are portable since the
UI font was bundled: `assets/fonts/inter-latin-var.woff2` is named ahead of
`system-ui` in every canvas font string, so glyph metrics no longer depend on
the host and the same PNGs pass on Windows and on Linux. `npm run test:visual`
is therefore a real local gate; `npm run test:visual:linux` runs the same suite
in a container that matches CI's font resolution when a difference needs to be
attributed. Anything drawn outside the bundled latin subset — the HUD's
symbol glyphs — still comes from the host, so keep such glyphs few and small.
Recapture through `--update-snapshots`, review the PNGs, and never through
`--update-snapshots=all`.
When a change legitimately alters visuals, dispatch the
`Visual baselines` workflow (`.github/workflows/visual-baselines.yml`), review
the artifact, and commit only the intentionally changed or new PNGs. See
`tests/README.md` for the covered world/battle states and the baseline
workflow.

## Audio

Audio lives in `src/audio.js` (Plan 026) and imports `engine.js` for its RNG helpers.
`engine.js` must NEVER import or re-export it back: with no bundler an import cycle is a
real hazard, and this is the one place the dependency is easy to reverse by accident.

Audio is PRESENTATION. Sample choice and pitch jitter draw from the module's own
`RNG_DOMAINS.AUDIO_FX` stream; nothing here may read or advance `simRng`, and no
simulation phase may read audio state.

The integration hazard is `console.error`, not the mix. `collectRuntimeErrors` fails any
spec that sees one, and three audio mistakes produce one:

- **Autoplay.** The `AudioContext` is built lazily on the first sound request, never at
  boot. `resume()` is attempted one at a time and always carries a rejection handler (an
  un-caught rejection is a page error). `applyTrack()` refuses to start a bed unless the
  context is actually `running`, and re-runs when the resume lands. The gesture comes from
  `attachUnlock(window)`, called once from `bootstrap()`.
- **Missing files.** Every name in the `SFX`/`MUSIC` manifests must exist under
  `assets/audio/`; a 404 is a console error in Chromium. `tests/e2e/audio.spec.js` fetches
  the whole manifest and asserts 200. URLs resolve against `import.meta.url`, not the
  document, because the game is also served from a project-Pages subpath.
- **Unhandled rejections** from `fetch`/`decodeAudioData`/`element.play()`. Every one is
  caught and downgraded to `console.warn`: a host that cannot serve a clip loses the clip,
  it does not fail the page.

Music STREAMS through an `HTMLAudioElement` and a `MediaElementAudioSourceNode`; it is not
run through `decodeAudioData`. Measured: the 233-second campaign bed decodes to roughly
330 MB of resident float PCM. Do not "simplify" it into a looping `AudioBufferSourceNode`.
One-shots stay decoded buffers — about ten seconds of audio in total, and a one-shot that
waits on the network has already missed its frame.

Every SFX file is peak-normalised to −3 dBFS by `scripts/build-audio.py`, so all relative
mix balance is in the `SFX` gain table in code. Tune levels there, not by re-rendering a
file. `horn(freq)` takes a real pitch because its call sites mean one; it picks the
nearest of three samples and detunes within 0.7×–1.45×.

Assets are CC0 or public domain, with no attribution requirement, and every file's source
and licence is recorded in `assets/audio/SOURCES.md`. Do not add a clip whose licence you
cannot verify is attribution-free — that record is what makes a Steam release checkable.
`scripts/build-audio.py` is the reproducible pipeline and needs python, numpy and ffmpeg;
it runs only when assets are rebuilt and is not a build step.

Playwright launches Chromium with the autoplay policy relaxed, so a context reaches
`running` immediately there and the suspended state a real browser starts in never occurs
by accident. `audio.spec.js` therefore suspends the context deliberately to exercise the
gate; keep that test honest rather than relying on the harness's leniency.

## Save schema and persistence

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
current, and malformed fixtures. The current save schema is version 4;
unversioned (v0), version-1, version-2, and version-3 saves migrate
deterministically, including deriving a missing legacy roaming-party `home`
from its canonical camp and defaulting `save.settlements` to every settlement
unoccupied and neutral (v0-v2) or carrying its v3 owner forward (v3). Current
version parties must have a finite valid `home`, settlement records must carry
their `owner` (and `spec` once chosen — the choice is permanent for the run),
and accepted saves must be safe for immediate world/battle construction.
Preserve `bf_save`/`bf_save_test` isolation.
Run `npx playwright test tests/e2e/save-schema.spec.js` and
`npx playwright test tests/e2e/campaign-persistence.spec.js` in addition to
the required `npm test` gate.

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

## Campaign lifecycle

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

Regional conquest (Milestone 025): the campaign's spine is now one region with
a named stronghold (Wolfsjaw). `src/region.js` is the single data-driven home
for the ownership vocabulary (`neutral`/`player` + `occupied`), the four
settlement specializations, the stronghold power ladder
(ENTRENCHED/WEAKENED/EXPOSED from held settlements + razed linked camps), the
objective tuning, and the raid cadence constants — it is pure over
`(save, definitions)`, imports nothing but `data.js`, and the world, battle and
UI layers all read it. Do not restate its tables as scattered literals
elsewhere; the brief's advantage prose is DERIVED from the modifier bundle, and
the stronghold objective's guard count must be the modded count so the prose
and the fight can never disagree.

All ownership mutations go through `World.winSettlement()` (battle capture or
reclaim) or `World.claimSettlement()` (peaceful `G` claim of neutral ground) so
the checkpoint, the `stats.captures` counter and the spec-choice queue cannot
drift between call sites. A captured settlement's specialization choice is
one-time and permanent for the run; an occupied holding SUSPENDS its benefit
(`isSpecActive`) but keeps the choice readable, and winning it back restores
service without re-counting a capture or re-opening the choice.

Regional raids (Slice D): the stronghold dispatches one raid at a time
(`updateRegionalPressure`, single-flight) at a player-held settlement, with
grace after captures (`RAID.graceAfterCaptureT`) and after a successful
defense (`RAID.graceAfterDefenseT`). The phase runs only on live ticks, so
standing still freezes raids with everything else — the Plan 023 freeze rule
extends here, including that a frozen tick consumes no RNG draws. A raid that
reaches held ground while the hero is within `RAID.defenseR` opens a
Hold-the-ground defense brief; otherwise it occupies, with the Plan 020
occupation semantics. An interrupted raid resumes after a retreat or defeat
(its `raid`/`raidKind` ride in `partyMeta`). The win condition is storming the
stronghold itself; the campaign summary behind that victory is built purely
from the final save (`buildSummaryModel`).

## Expected failures and test debt

The campaign spec has AUDIT-02, AUDIT-03 and AUDIT-05 as normal passing
regressions. The one active `test.fail` annotation in the suite is `deliberate
orders beat giving no order at all` in `tests/e2e/stance-balance.spec.js`, which
records the measured finding that Plan 019's premise is not met: over organic camp
raids, pressing no order wins more often than any deliberate squad order. Remove
that annotation only when commanding actually beats not commanding, and remove it
in the same change that makes it true. An unexpected pass is useful drift that
signals the test debt is ready to retire; never weaken the assertion or add a skip
to make the gate green. Expected failures are always `test.fail` with a plan or
finding reference — never `skip` or `fixme`.

That sweep is also the most expensive test in the repository, so it is tagged
`@sweep` and split out of the `chromium` project the PR gate runs. `npm test`
no longer runs it; `Balance sweep` (`.github/workflows/balance-sweep.yml`) and
`npm run test:balance` do, and both keep the `test.fail` annotation. Splitting
it out is not permission to stop reading it: check that run whenever a change
touches stance behaviour, squad orders or battle balance.

## Battlefield terrain (Plan 024)

The battlefield is 2500x1760 (`FIELD` in `src/battle/constants.js`), 4x the pre-024 area, and
carries real campaign-map terrain instead of four hardcoded arena templates. The contract
that makes this possible without the battle scene ever importing `world.js`:

**The Brief.** `sampleBattlefield(world, approach, seed, fieldW, fieldH)`
(`src/world/battlefield-brief.js`) is a pure, read-only function over `world` — it draws only
from already-sampled geometry (`world.riverLines`/`roadLines`/`scenery`, `world.rivers[i].bridges`)
plus a local RNG derived from `RNG_DOMAINS.BATTLE_TERRAIN` for ford-position jitter only, never
from `world`'s own `simRng`/`fxRng` streams. `src/world/battle-transition.js` attaches its
result to `setup.field` when starting a battle. `src/battle/terrain.js`'s
`buildTerrain(battle, field)` is the only consumer: the Brief is the *entire* world-to-battle
terrain contract, a plain serializable object of already-battlefield-space coordinates — the
battle side does zero world maths. Do not add a second path that reaches into `world.js` from
battle code; extend the Brief shape instead.

**World north is battle north.** `setup.approach` is a compass letter already derived from
world `dx/dy`, and `Battle` already places the enemy along that same compass. World ->
battlefield is therefore a uniform scale (`WORLD_TO_FIELD = 4`) plus a translate — **no
rotation, ever.** A river running north-south to your east on the map lands running
north-south to your east on the field, for free. If a future change needs the field rotated
relative to the map, that breaks this property and needs its own design review, not a quiet
patch inside `sampleBattlefield`.

**The briefless (template) path must keep working.** `window.game.scenario('battle_small'|
'battle_big'|'battle_bridge')` builds a `Battle` with no `setup.field` at all —
`buildTerrain` falls back to the original `road`/`village`/`bridge`/`camp` arena templates
(re-centred toward the actual fight via an `ENGAGE_GAP`-relative anchor rather than the old
absolute `W`/`H` fractions). This is not a degraded case: it is what the three legacy visual
baselines and most of `qa_suite.js` exercise, and `terrainSpeedAt`/`hasLineOfSight`/
`crossingWaypoint` all degenerate to cheap early-outs (empty zones/blockers/riverSegs) on it,
so it must stay a normal, correct, zero-terrain battle rather than something that needs a
Brief to behave.

**The tiled static layer.** A single `W+128 x H+128` prop canvas at this field size is
~19.8 MB — the same league as the full-map bitmap `AGENTS.md` already bans. The static layer
is instead a 2x2 grid of <=1400x1000 canvases, each with its own translate, blitting only the
tiles that intersect the camera frustum. Do not go back to one arena-sized canvas as the field
grows further; extend the tile grid instead.

**LOS blocker policy: hills, woods and houses only — never rocks, scrub, or individual
trees.** `battle.blockers` (consumed by `hasLineOfSight`) exists purely so a ranged unit can
be denied a shot by real terrain cover. A wood contributes ONE blocker circle at 0.8x its
zone radius, not one per tree (only its two largest trees get a physical collider, and even
those are never blockers) — this is deliberate: a wood should read as cover without also
being an impassable maze. Rocks and scrub never push a blocker at all; a boulder is not arrow
cover in this game and giving every pebble line-of-sight weight would make archery
unplayable. If a future terrain kind needs to block arrows, add it to this same short list
deliberately — do not let a generic "everything solid blocks LOS" rule creep back in.

**Obstacle-size caps, and why they exist.** Two caps were added after measurement, not
review, because an oversized circle on the direct path between the two forces does not just
slow a fight down — past a threshold it can stall it forever, and tangent steering (the
battle's only obstacle-avoidance mechanism; see `src/battle/ai-phases.js`) cannot route two
whole armies around something wide relative to the corridor between them:

- `ROCK_R_CAP = 70` in `battlefield-brief.js`. The raw mapping from world rock size would
  otherwise produce a boulder as large as a small hill; capped so a rock stays legibly a
  rock, not a landform.
- `HILL_SAFE_R = 150`, applied only within `HILL_CORRIDOR_MARGIN = 260` of the hero-to-enemy
  corridor, in `battle/terrain.js`. A hill's *size* is legitimate landform variety (up to
  r=288 off-corridor, which resolves fine) — only a hill sitting near the actual fight line
  needs shrinking, so this is a proximity cap, not a size cap.
- `TREE_COLLIDER_CAP = 60` in `battle/terrain.js`, independent of the above: a wood's two
  colliding trees are sized as a fraction of the same radius used for its LOS footprint, so
  enlarging wood cover for gameplay reasons can inflate a tree collider into hill-stall
  territory too, and needs its own cap.

Do not raise `WOOD_R_MULT` (wood LOS-cover radius) without re-measuring all four canonical
brief-derived fixtures (riverside `1150,1000`, wooded highland `300,1500`,
bridge+settlement `985,640`, deep country `1700,2100`, world seed 7, approach `'E'`, brief
seed 12345) for both a fight-resolution stall and the blind-archer fallback's `blindT`
climbing unbounded — see Plan 024's Retrospective for the two independent ways this broke
past 4.0x, and why LOS corridor coverage was shipped at 38% rather than the original 55-70%
target.

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
