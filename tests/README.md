# Browser QA guide

## Harness architecture

`runner.html` supplies the production-required `<canvas id="game">`, imports
`src/main.js`, then imports `qa_suite.js`. The suite retains the historical
`window.runQaSuite()` and `window.__qaResult` globals and prints the result JSON
in `#qa-status`, so it is useful both to a human opening the page and to
Playwright.

`tests/e2e/qa.spec.js` is the exit-code-bearing Playwright layer. It starts the
existing Python server, checks browser/runtime errors, verifies all 25 record
names, and proves that running QA preserves `bf_save` while using
`bf_save_test`.

## World and battle seams

`tests/e2e/world-battle-seams.spec.js` protects the architecture boundary added
for audit finding #8. It wraps one controlled tick and asserts the live order of
World movement/interactions/party/spawn/presentation and Battle command,
hero/troop/enemy/separation/projectile/stalemate/result/presentation phases. It
also proves that constructing a second battle with another biome cannot mutate
the first battle's frozen palette. Keep this test focused on ownership and
ordering; gameplay outcomes belong in `qa.spec.js`, campaign behavior belongs
in `campaign-persistence.spec.js`, and pixel changes belong in the visual suite.

When adding a mechanic, put its state mutation in the phase that owns it. World
ticks move the hero before interactions, then run party AI before spawn/camera
maintenance. Battle ticks resolve projectile landings before the terminal
result check. Do not replace these narrow methods with a generic manager or
shared mutable context object.

## Performance coverage

`tests/e2e/performance.spec.js` is the focused structural performance gate.
Run it with `npm run test:perf` after scheduler, Canvas, battle-loop, or party
navigation changes. It drives fixed steps and seeded scenarios; it does not
use sleeps or machine-specific millisecond assertions. The tests cover
144 Hz scheduler coalescing and hidden-watchdog suppression, world static path
reuse/culling, battle static/scratch reuse and team tags, and seeded party
replan staggering with cached goal visibility. The spatial cases compare
grid nearest-target results with the legacy brute-force answer (including
exact ties), then drive deterministic 400/1000-unit distributions and assert
that candidate work remains a small fraction of the all-pairs count. The
battle index owns fixed 128px buckets and reusable query/heap storage; nearest
queries use cell lower-bound branch-and-bound rather than collecting the whole
arena, and rebuilds happen after a phase moves the indexed collection. Use
`getSpatialStats()` when adding a new broad-phase query. Keep the exact
distance check and source-order tie rule in the narrow phase—cell membership
is only a candidate filter. Battles at or below 128 units retain the legacy
ordered separation loop for exact designed-size behavior; larger stress
fixtures use the spatial pair path and report candidate/pair counters.

The scheduler renders after a fixed update or explicit invalidation only. The
watchdog never renders hidden documents. World caches are reusable `Path2D`
geometry and culling; battle caches are bounded to the arena and must not grow
into a full-map bitmap. Scratch buffers belong to their scene instance, reset
logical lengths, and clear stale references. Unit `team` tags must remain
immutable. Replanning must stay seeded and exact: never trade river/bridge
collision correctness for an approximate cache. Structural budgets are
intentionally fixed (`<10000` world and `<9000` battle `beginPath` calls over
20 draws); never raise or weaken them to make CI green.

## Stance and squad balance

`tests/e2e/stance-balance.spec.js` is the balance harness for Plan 019. Four of its five
tests run in the PR gate. The fifth, the 360-raid policy sweep, is tagged `@sweep`, runs
in the `balance` project only, and reaches CI through the separate `Balance sweep`
workflow — it is a recorded measurement carrying `test.fail()`, so it cannot go red on a
code change, and it costs minutes the gate should not spend. Run it with
`npm run test:balance`. It runs fixed
troop/enemy fixtures once per stance with the hero completely idle, so each number
isolates what the ORDER did rather than what the player did. It asserts that measurements
replay identically, that the wolf and raider fixtures keep their intended right answer
(the only stance properties measured to generalize across seeds), and that every stance
can finish a winnable fight.

It also carries one expected failure recording a confirmed defect: giving no order at all
beats every deliberate order policy. Do not delete that annotation to make the suite look
clean — it is the honest state of the mechanic.

Two harness rules matter and must not be dropped. The pointer is pinned to the canvas
centre and camera shake is zeroed before each run, because an idle hero aims at the
cursor and FOLLOW formation slots hang off hero facing — an uncontrolled mouse silently
rewrites the result. And the live scheduler is replaced while the real fixed-step update
is driven directly, so rAF and watchdog timing cannot contaminate a measurement.

Dominance inside a single-behavior fixture is intended, not a defect: a wolf pack should
have a right answer.

Fixture results are seed-specific AND viewport-specific. Battle outcomes depend on canvas
size, because the fit-to-action camera feeds hero aim, hero facing, and therefore FOLLOW
formation slots. Never assert a balance property from one seed at one canvas size: sweep
seeds, and pin the canvas.

Note that both legacy determinism records drive `Digit2` (CHARGE), which ignores
`slotPos()`. That blind spot hid decorative camera shake leaking into fight outcomes
through `Camera.toWorld`; the harness now replays all three stances for that reason.

## Map legibility, hover, and the pre-battle brief/aftermath (Plan 021)

`tests/e2e/world-hover.spec.js` covers the presentation-only map hover system:
no panel until the pointer actually moves (asserted at boot and after
stepping with the pointer untouched), composition/fighting-weight/intent for
a roaming party, how the hero enters the odds for the warband (Plan 028: he is
120 hit points and no damage, not three spearmen — the panel says so and the
test asserts both the words and a numeric weight), nothing compositional for
an unscouted camp, the true composition for a scouted one, Wolfsjaw reading
unscouted before its camps are razed, and that `state()` after N steps is
byte-identical whether the pointer is parked on a party or on empty ground —
hover cannot touch simulation. Its fixtures read a live position (a roaming
party moves in real time) and act on it inside one `page.evaluate()` call,
since splitting that across two round trips races the live `requestAnimationFrame`
loop.

`tests/e2e/world-screens.spec.js` covers the pre-battle brief and the
post-battle aftermath, both built through the same production
`requestBattle`/`confirmBrief`/`onEnd` path `scenario('world_brief', {kind,
seed})` and `scenario('world_aftermath', {seed, result})` drive (never by
assigning `world.screen` directly): requesting opens the brief without
mutating anything; confirming persists exactly once while still `world`,
after the encounter is already removed from `this.parties`/rolled into
`st.garrison`, then enters battle; withdraw keeps the party present, charged
(`clashT`, `waryT`), and blocks an instant rematch; withdraw is offered only
for a camp/stronghold assault and a caught-fleeing party, never an ambush or
a mutual skirmish; an unscouted stronghold brief shows the enemy as unknown
while an ordinary camp (auto-scouted the instant you are close enough to
assault it) always shows the real composition; the aftermath blocks every
world phase and freezes `grace` while open, decays only after dismissal, and
is suppressed in favor of the victory scene when `save.won`.

Two structural specs extend to cover the modal: `world-battle-seams.spec.js`
asserts the wrapped world phases produce an empty order while a brief blocks
the pipeline, and `performance.spec.js` adds a `<12000` `beginPath` budget
(separate from the existing untouched `<10000` case) for a world frame with
the hover latch on and a brief open. `input-actions.spec.js` compares the
named `withdraw` action against its `KeyX` binding cancelling a brief.

New visual baselines: `world-brief-party.png` (a caught-fleeing-party brief,
withdraw offered), `world-brief-camp-withdraw.png` (a camp assault brief),
`world-aftermath-victory.png`, `world-aftermath-defeat.png`. The existing
menu and all three battle baselines are unchanged — confirmed by inspecting
`npm run test:visual` after the change: the battle intro's `setup.brief`-keyed
trim (dropping the now-thrice-stated `N vs M` line and shortening the intro
banner for a brief-routed fight) only ever applies when `setup.brief` is
true, which `scenario('battle_*')` never sets. The two pre-existing world
baselines (`world-overview.png`, `world-bridge.png`) also needed no update
for the body-count badges or the heavy-unit marker — reviewed with no diff
artifacts generated, same as Plan 020's spawn-tier change before it.

Four legacy records in `tests/qa_suite.js` gained a confirm (and, for the
grace-timer record, also a dismiss) step, since a party clash or a
`WORLD_PRIMARY` press now opens a brief instead of committing straight to
battle: `world_party_battle_decreases_party_count_by_one`,
`world_camp_raid_razes_camp`,
`world_grace_timer_active_after_battle_then_decays`, and
`world_party_break_off_occupies_settlement_and_recapture_restores_service`.
`world_no_party_freezes_at_rivers` — not one of those five — also needed its
success criterion extended: reaching the hero now opens a brief (still scene
`world`) rather than committing to battle, which is equally conclusive proof
a party was not stuck (it demonstrably reached its target), so the record now
accepts an open brief as a third resolution alongside "battle started" and
"moved with purpose". `tests/e2e/campaign-persistence.spec.js`'s
`installUniqueParty` gained the same confirm step, and two of its raw
collision fixtures plus `stance-balance.spec.js`'s camp-raid policy sweep
needed the same treatment to keep exercising real battle entry (the latter's
own numbers are unchanged — the fixture was silently measuring zero runs
before the fix, not a balance change).

## Canvas visual regression

`tests/e2e/visual-regression.spec.js` captures representative, deterministic
Canvas states: a seeded world overview, a road/river/bridge landmark, a
pre-battle brief for a fleeing party and one for a camp assault, a victory and
a defeat aftermath (Plan 021), a small road battle, a large night camp
battle, and a bridge ambush. Milestone 025 adds the regional-conquest
surfaces: a mid-conquest world frame (a Barracks holding's banner, an occupied
settlement with its occupier, the WEAKENED power chip), the WEAKENED and
EXPOSED power chips at the stronghold itself, the three objective battles
(`battle_hold`, `battle_break`, `battle_stronghold` — hold zone, break guards,
stronghold HUD with its reserve wave), and the campaign summary. Each scenario is
created through the existing `window.game.scenario()` API, advanced with the
synchronous fixed-step `window.game.step()`, then frozen before capture so rAF
and watchdog timing cannot affect the image. The test replaces only the page's
live update method after setup, leaving the normal pause overlay out of the
captured scene.

Run the focused suite with:

```text
npm run test:visual
```

Baselines live under `tests/e2e/__screenshots__/visual-regression.spec.js/`.
Playwright uses one platform-neutral path and compares at CSS-pixel scale with
`threshold: 0.20` and `maxDiffPixelRatio: 0.015`: this permits small
Windows/Linux font and antialiasing differences while still rejecting broad
terrain, unit, palette, or layout regressions. The default `npm test` command
discovers this spec and runs it on every pull request. A failure writes `test-results/` `-actual`, `-expected`,
and `-diff` images; inspect all three before deciding whether a change is
intentional.

To intentionally update a baseline, run the focused command with
`--update-snapshots`, inspect every changed PNG, and include the visual reason
in the change description. `--update-snapshots` is not a repair command and
must never be used to hide an unexplained regression. Visual checks supplement
semantic QA; keep both the focused `npm run test:visual` and the full `npm test`
gate green.

## Platform and Steam boundary

`src/platform/platform-contract.js` is the only host-facing contract. The web
adapter owns browser lifecycle and localStorage details; `Game`, `World`,
`Battle`, and `Sfx` must use `SaveRepository` and named actions instead of
touching storage, lifecycle globals, or raw key codes. `SaveRepository` hydrates
campaign/test/settings slots before `window.__g` is exposed, serves synchronous
reads from memory, serializes writes in order, and provides `flush()` for
suspend/desktop quit. Storage errors are observable through the game's concise
save-warning state and never include save contents.

The dependency-free `tests/tooling/platform-contract.test.js` covers semantic
slot mapping, delayed hydration, ordered delayed writes/removals, invalid-save
cleanup, flush/error behavior, lifecycle unsubscribe, and surfaced errors.
`tests/e2e/platform-boundary.spec.js` covers suspend deduplication and the
player-visible storage-failure warning. `tests/e2e/input-actions.spec.js`
compares deterministic keyboard and injected named-action outcomes for movement,
combat commands, pause, mute, and abandon. Future Gamepad/Steam Input tests should inject named actions through
`window.game.action(name, down)` and compare canonical state with the existing
keyboard path; do not add controller polling to simulation tests. The future
Electron shell must implement the same contract through a context-isolated,
Node-disabled preload bridge and must keep atomic save files and Steam Cloud
configuration outside the renderer.

## Randomness domains

Runtime random draws are intentionally split into named streams. `simRng` is
for anything that can affect a campaign or battle result (composition, spawn
positions, AI/navigation timing, cooldowns, and projectile spread). `fxRng` is
for particles and decorative variation only. Camera shake has its own stream.
Use `deriveSeed(seed, RNG_DOMAINS.<name>)` when adding a new stream; never pass a
generic scene RNG to a visual effect. A quick regression is available through
`window.game.effects(false)`: run the same seeded inputs with effects enabled
and disabled and compare the canonical state, not particle counts. Preserve
seed `0` with nullish checks (`??`), not truthiness defaults.

## CI flake policy

Playwright uses zero retries locally. CI permits one retry only to collect
diagnostic trace and report data, while `failOnFlakyTests` makes a test that
passes only after that retry fail the workflow. A retry-dependent pass is
therefore never an accepted result. Verify this policy without launching a
browser with:

```text
npm run test:tooling
```

Use the focused command when diagnosing a failure locally, then rerun the
same test without changing its retry behavior. Do not quarantine a flaky test,
increase retries, or weaken its assertion to make CI green.

## Release cache-token check

The static browser graph is cache-busted with one token derived from the
normalized contents of the reachable src/*.js modules (including canonical
LF line endings). Normalizing the version query values makes the digest
independent of its own token while
still changing it whenever deployable JavaScript changes. The checker follows
the module script in index.html and every static import/export-from edge, so
transitive modules cannot silently retain an older generation.

After changing deployable JavaScript, run:

    npm run release:cache
    npm run test:release

Review the resulting query-token changes in index.html and src/ as part of the
release commit. The updater rewrites only recognized version-query locations
and fails on missing, dynamic, non-relative, or otherwise unsupported module
references. CI runs test:release in check-only mode; it must pass before the
browser suite. The local no-cache server avoids local debugging ambiguity,
while Pages' short response max-age is why all graph edges still need one
consistent token in a deployed release.

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
are treated as version 0, and version-1 through version-3 browser saves are
migrated to the current version 4 shape with documented legacy defaults.
Version-1 roaming parties missing `home` receive the matching canonical camp
coordinate during migration; current-version parties must carry a finite,
valid `home`. Version 3 (Plan 020) added `save.settlements` — one
`{id, occupied}` entry per `WORLD.settlements`, recording whether a party that
broke off from a chase currently occupies it — and an optional party
`occupying` field naming that settlement; pre-version-3 saves never had
either, so migration defaults every settlement to unoccupied. Version 4
(Milestone 025) extends each settlement record with its `owner` and its
permanent `spec` choice, adds the campaign-summary stat counters
(`battlesLost`, `goldEarned`, `goldSpent`, `captures`), and migrates a v3
settlement's implied ownership forward. Unknown future
versions, unknown production IDs (including an unknown settlement `id` or a
non-boolean `occupied`), malformed nested values, impossible HP/max-HP
relationships, and out-of-range numbers are rejected and the active save slot
is cleared before `World` sees the payload. The validator returns a detached
canonical object, so accepted saves are safe for immediate world and battle
construction.

Run the focused schema coverage with:

```text
npx playwright test tests/e2e/save-schema.spec.js
```

The focused schema suite covers v0/v1/v2/v3/v4 migration (including the version-2 ->
3 settlements default and the version-4 -> 5 progression default), current-version
round trips, zero-seed preservation, battle maximum-HP propagation, malformed fixtures
(including malformed settlement entries and a party occupying an unknown settlement), and
save-slot clearing.

Three Plan 029 (v5) properties have their own fixtures, because each is a rule rather than
a shape: a v4 campaign migrates with empty progression and unblooded troops (and its
already-banked captures are re-derived into the perk choices it never had the chance to
make); a pre-v5 shape carrying `perks`, `banner` or a troop `vet` is REJECTED, matching how
a pre-v4 party carrying `raid` is; and a v4 knight army that no longer fits the new slot
arithmetic is GRANDFATHERED — its cap is widened rather than the save refused, because
deleting a legitimate campaign for a rule that postdates it is the worse failure. A
veteran's persisted hit points are bounded by his RANKED maximum, so
`{ type: 'spear', vet: 3, hp: 112 }` must load and `hp: 113` must not. Run it together with campaign coverage after changing
`src/save.js`, `src/world.js`, or `src/battle.js`:

```text
npx playwright test tests/e2e/save-schema.spec.js tests/e2e/campaign-persistence.spec.js
```

Construct fixtures from current `WORLD.camps`, `WORLD.settlements`,
`UNIT_TYPES`, and `ENEMY_TYPES` production values. Do not invent camp,
settlement, or troop/enemy IDs, and keep real-player persistence fixtures in
isolated contexts using `bf_save` and raw `window.__g`; calls through
`window.game` belong to the `bf_save_test` slot.

## Milestone 025: the regional conquest loop

Three suites own the regional model, one per layer, and all three must stay
aligned with `src/region.js` — the single data-driven home for ownership
vocabulary, specializations, the stronghold power ladder, objective tuning and
the raid cadence.

`tests/e2e/region.spec.js` imports `src/region.js` directly in Node (the module
is pure over `(save, definitions)` — no RNG, no DOM) and pins the model itself:
the authored settlement/camp/stronghold shape, the ENTRENCHED/WEAKENED/EXPOSED
ladder with occupied holdings stopping their count, the modifier mapping (wave
removal at two captures, the two-guard floor after camp razing, watchtower
deployment reveal, Exposed garrison thinning), the brief advantage lines being
derived rather than hand-maintained, the four specializations and their
occupation suspension, the one-place objective mapping, the structural
beatable-route guarantee (capturing every settlement alone always crosses
Exposed), and the raid cadence constants.

`tests/e2e/battle-objectives.spec.js` drives the REAL battle tick pipeline over
seeded `window.__g.startBattle` fixtures and owns the objective terminal
contract: hold-zone placement (in-bounds, obstacle-clear, deterministic), the
hold clock running only while a squad holds and no enemy contests, timeout and
elimination victories each resolving through `resolveBattleResult()` exactly
once, defeat and the held escape-edge withdrawal resolving as non-victories,
break-guard placement and determinism, destroying every guard winning with
defenders still standing, elimination winning with guards standing, one ending
when both conditions land in the same tick, Entrenched reserve waves arriving
on schedule with coherent kill accounting, and the `state()` objective panel
surface. Fixture enemies are re-pinned (position AND hp) at every batch
boundary — an archer left shooting at a static fixture can otherwise deplete it
into an accidental elimination victory — and the last guard's death hit-stop
consumes one tick, so result assertions step past it.

`tests/e2e/regional-campaign.spec.js` drives the campaign loop through
production paths (named input actions, full `World.update` ticks,
`requestBattle`/`confirmBrief`, real `endBattle`) on the isolated test slot:
claiming neutral ground (checkpoint, permanent spec choice, capture grace), each
specialization's documented effect and its occupation suspension, the
occupy/reclaim cycle (service suspended then restored, no re-counted capture, no
second spec choice), regional raids (dispatch at held ground, single-flight,
freezing with the world), the Hold-the-ground settlement defense with its
post-victory grace, the three power states materially changing the final
stronghold battle (guards, wave, garrison thinning), and the campaign summary
counters behind the final victory.

Harness rules for the campaign suite: the live rAF scheduler is parked right
after the scenario swap (an uncontrolled tick would scout camps, move parties
and fire the autosave mid-fixture) and every simulation step is an explicit
production tick; settlement/camp coordinates come from the Node-side production
data and are passed into the page, because module imports do not exist on
`window`.

## Legacy check inventory

The 26 deterministic records cover:

1. menu-to-world transition;
2. battle invariants and victory;
3. end-banner timing;
4. hero offence: a swing landing for `HERO.swingDmg` on the aim ray, an enemy
   behind that ray staying untouched, and a dash trampling for `HERO.dashDmg`
   exactly once while granting i-frames;
5. the retreat decision: parking at the escape edge fills nothing, a released
   hold resets the bar, and a sustained 1.3s hold disengages;
6. defeat penalties;
7. volunteer rally floor;
8. victory loot, survivors, and hero regeneration;
9. troop commands and hold positions;
10. squad selection, per-squad orders, and per-squad hold points;
11. recruitment costs, capacity, and refusals;
12. healing refusals and success;
13. army-cap expansion: town-only, priced by `armyCapCost()`, refused when
    short, escalating by a step, raising the recruit ceiling, and persisted;
14. roaming-party victory removal;
15. camp-raid razing (loot only — a raid never changes the warband);
16. post-battle grace decay;
17. roaming-party fighting-weight bounds against `BALANCE.encounterWeightClamp`,
    driven at a 0.0001x and a 100x band (Plan 028 renamed this from the old
    `[2, 24]` strength-point bound; the tolerance is one body, because the
    roller can only stop once the target is crossed);
18. weighted spawn-tier distribution, swept over several seeds, shifting toward
    `strong` as camps are razed (Plan 020; the tier boundaries are derived from
    `BALANCE.partyTiers` since Plan 028 rather than hardcoded, so they follow
    the bands);
19. the spawn timer itself: armed at 30s, a 40s cadence after that, filling to
    `partyCap()` and stopping there, with the roster persisted;
20. break-off-and-raid: occupying a settlement suspends its service, and
    defeating the occupier there restores it (Plan 020);
21. the deadlock floor guarantee, driven at its worst case: nothing beatable on
    the map still yields a winnable target, and the last unclaimed settlement
    is never claimed (Plan 020, the plan's STOP-condition risk);
22. seeded battle determinism;
23. the RNG-domain effects-independence check;
24. the 200-step performance smoke budget;
25. river-pursuit movement without freezing;
26. enemy command symmetry (Plan 027): every enemy type has a squad, all of them
    start on the neutral order, none of them takes an order while the deploy
    window is open (which is also what keeps the 1.5s battle visual baselines out
    of the commander's reach), the squads genuinely diverge once it commands, two
    identical runs produce an identical order sequence, and `bloodlust` collapses
    every enemy squad back to the press so the no-death stall clock's guarantee
    always outranks the commander.

## Visual baselines are captured on Linux, on purpose

`VISUAL_OPTIONS` in `visual-regression.spec.js` pairs a per-pixel threshold with a
1.5% differing-area cap, and its comment explains that as absorbing the way Chromium
rasterizes text and antialiased edges differently across platforms. That reasoning
holds for *rasterization*. It does not hold for a different **font family**, and the
canvas draws every string through `system-ui, sans-serif`, which resolves to whatever
the host has installed.

`menu-campaign-vignette.png` was captured on a host where `system-ui` resolved to a
narrower face than Linux gives. Every Linux Chromium — CI's pinned build and any local
one — produced exactly 23418 differing pixels, 3.0% of the canvas, which is double the
cap. `Browser QA` was red on `main` from the commit that added that snapshot
(`794c4267`, Plan 018) until it was recaptured, eleven consecutive runs, and every one
of those failures looked like a flaky visual test rather than a font mismatch. Nothing
else differed: the ribbon, mountains, castle, road and column were pixel-identical, and
the title ribbon is sized from `measureText`, so even the art shifted with the metrics.

That is why baselines were captured on Linux for as long as the canvas drew through
`system-ui`. Never widen the cap instead: at 1.5% it is what makes a missing landmark or
unit group fail, and the 3% font mismatch was the proof that the cap is set tightly
enough to matter.

### The font is bundled now

The fix that section called for has been applied: `assets/fonts/inter-latin-var.woff2`
(Inter, SIL OFL 1.1, latin subset, variable 400-900) is declared in `index.html` and every
canvas font string reads `Inter, system-ui, sans-serif`. Metrics no longer depend on the
host, and the same baselines pass on Windows and in a Linux container.

Two things that follow from it:

Canvas text does not wait for a webfont. `fillText` and `measureText` fall back silently
until the face loads, and the menu ribbon is sized from `measureText`, so `bootstrap()`
awaits `loadUiFonts()` before the first frame and `settle()` in the visual spec waits on
`document.fonts.check` before capturing. Without those two waits a capture races the
font and lands on the fallback.

The bundled subset is latin. The HUD also draws symbols outside it — the crossed swords,
heart, objective diamond, hammer, eye — and those still come from whatever the host
supplies. They are a few small glyphs, far under the cap, so the baselines stay portable;
if a screen ever fails on symbol drift, replace the glyph with drawn geometry rather than
widening the cap or bundling an emoji font.

### Running the visual suite locally

`npm run test:visual:linux` runs the suite inside CI's rendering environment and
agrees with CI: twenty of twenty pass on a Windows host whose own
`npm run test:visual` fails three. It needs Docker running; the first call
builds a ~3.5GB image from `scripts/visual-linux.Dockerfile`, later calls reuse
it and take about twenty seconds. Extra arguments are forwarded to Playwright
(`npm run test:visual:linux -- -g "campaign summary"`).

The container needs one addition to match CI. The pinned Playwright image ships
no Latin default sans, so `fc-match system-ui` there answers WenQuanYi Zen Hei,
and it fails exactly the three text-heavy baselines a Windows host fails.
Installing `fonts-dejavu-core` — which is what ubuntu-latest resolves
`system-ui` to — makes all twenty pass unmodified.

That narrows the finding above: the baselines are not Linux-specific, they are
DejaVu-specific, and any host resolving `system-ui` to DejaVu Sans reproduces
them. Capture still goes through the `Visual baselines` workflow. The container
matches CI on every baseline committed today, but CI is the environment the
PNGs have to satisfy, so it stays the one that writes them.

## Two battle-input rules the hero records depend on

Both were found by writing those records, and both silently make an input test
vacuous rather than failing it, so keep them in mind when adding one.

A battle opens in `state === 'intro'` and `Battle.update()` runs **no phases at
all** while that banner is up (about 1.1s, or 0.6s once any key is pressed).
Swing and dash inputs are simply not read there, so a record that taps before
stepping past the intro asserts nothing. `hero_swing_and_dash_damage_enemies`
asserts the state transition explicitly for that reason.

A *landed* hit sets `battle.freeze` (hit-stop) and `Battle.update()` returns
early while it runs, which drops the next tick's input on the floor. That is
why the swing helper in that record steps 0.1s after every swing: without it
the "enemy behind the aim ray is not hit" case passes because nothing happened
at all, which is not the same claim.

## Adding coverage

Keep deterministic simulation checks in `qa_suite.js` when they exercise the
existing headless API. Add browser-level launch, persistence, isolation, or
console/error checks under `tests/e2e/`. Preserve one worker because the
performance smoke check is wall-clock sensitive. Add the record name to the
ordered list in `tests/e2e/qa.spec.js` whenever the legacy suite intentionally
changes.

`tests/e2e/terrain-geometry.spec.js` is the focused terrain contract. It starts
a pinned world through the raw debug handle and checks that sampled road points
are queryable, the old invisible settlement chord is not a road, river samples
block away from bridges, bridge centers remain open, and river endpoints reach
the authored map edges. When adding terrain, define the curve once in
`World.buildTerrainGeometry()`; draw and simulation must consume its cached
polyline rather than maintaining independent coordinates.

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
| v3 -> v4 and v4 -> v5 migration, malformed rejection, reload idempotency | browser E2E | pass (`tests/e2e/save-schema.spec.js`) |
| Veterancy earned in a won battle survives the save write and a reload | browser E2E | pass (`tests/e2e/campaign-persistence.spec.js`) |
| The banner ceiling stops veterancy accruing, and raising it lets a man resume | browser E2E | pass (`tests/e2e/campaign-persistence.spec.js`) |
| Perk choice modal, deferral without loss, tier gates, banner gold sink | browser E2E | pass (`tests/e2e/world-screens.spec.js`) |
| Regional model (power ladder, modifiers, specializations, objective mapping) | Node-level E2E | pass (`tests/e2e/region.spec.js`) |
| Objective placement and every terminal battle path | browser E2E | pass (`tests/e2e/battle-objectives.spec.js`) |
| Capture/occupation/reclaim, specialization effects, raids, defenses, power states, summary | browser E2E | pass (`tests/e2e/regional-campaign.spec.js`) |
| AUDIT-02 autosave captures live hero and roaming-party positions | browser E2E | pass (explicit save, timed autosave, reload/Continue) |
| AUDIT-05 battle entry persists a coherent transaction | browser E2E | pass (active-battle checkpoint, schema, removed party, reload/Continue) |
| AUDIT-03 defeat restores the surviving roaming party | browser E2E | pass (survivors return to the encounter location; fully wiped parties stay removed) |

Roaming-party lifecycle invariant: removing a party for a battle is temporary
unless every enemy dies. Retreat and ordinary defeat both restore exactly the
surviving enemy types at the original encounter coordinates, preserving the
party's camp/home identity; camp garrisons use their separate attrition path.
The AUDIT-03 regression and its fully-wiped control cover this invariant. Run
`npx playwright test tests/e2e/campaign-persistence.spec.js` when changing
battle results, party behavior, or recovery/teleport rules. AUDIT-05 is a normal
regression and must stay that way. Do not change an expected failure to
`skip`/`fixme`, weaken its assertion, or leave its annotation after the source
behavior is fixed.

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
