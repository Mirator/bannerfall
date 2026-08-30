Original prompt: Make an gameplay audit and suggest 5 things how the gameplay could be improved. Both polishing current features and new features

## Organic terrain follow-up (2026-08-24)

- [x] Reworked canonical roads as gentle cubic S-curves with narrower muted-beige trunks
  and wider cached settlement approaches; destinations render over their endpoints.
- [x] Reworked rivers into softly banked variable-width sections with more lateral meander
  and a small shallow island, retaining canonical render/collision geometry.
- [x] Replaced 45 ground speckles with three large elevation planes; map scenery now shows
  shrubs only when they reinforce forests/ridges/rock patches, rocks render as outcrops,
  and three broad farmland plots establish a recognizable agricultural district.
- [x] Gameplay captures inspected at `shots/map-upgrade/organic-terrain-final/shot-0.png`
  and `shots/map-upgrade/organic-terrain-bridge.png`; canonical road/bridge integration is visible.
- [x] Terrain geometry contract passed; performance gate passed 8/8; release token
  `r4640771f4310` verified and `git diff --check` clean.

## Campaign-map graphics upgrade (2026-08-24)

User request: make the campaign map visually comparable to the attached warm low-poly
wireframe, with an independent subagent quality review after every implementation loop.

- [x] Captured the pre-change map at rest and in motion under
  `shots/map-upgrade/before-world` and `shots/map-upgrade/before-moving`.
- [x] Loop 1 implementation: faceted ground, broader saturated rivers, solid cream road
  ribbons, visual-only mountain/tree clusters, larger settlements/camps, brighter village
  walls and blue roofs, and a hierarchical objective card.
- [ ] Run the required Playwright action loop, inspect the result, and fix regressions.
- [ ] Obtain loop-1 subagent visual-quality review against the reference.

### Loop 1 review

- [x] Independent review: not yet on par. Largest gaps were landmark detail/scale,
  terrain density, dimensionality, river/road finish, and landmark-vs-hero hierarchy.
- [x] Loop 2 implementation: richer multi-building villages and keep details, larger POIs,
  dark destination plates, crimson camp plates, larger faceted rocks, and a clean river
  facet without road-like current dashes.
- [ ] Capture and inspect loop 2, then obtain the required independent review.

### Loop 2 review

- [x] Independent review: another loop warranted; composition/density, landmark fidelity,
  and unified material depth remained the dominant gaps.
- [x] Loop 3 implementation: slim map bounds, single-ribbon roads with terrain shadow,
  larger ridge silhouettes, five-pine decorative scrub stands, stronger landmark shadows,
  settlement-specific roof palettes, doors/windows, and a chapel tower.
- [ ] Capture and inspect loop 3, run final quality review and full verification.

### Loop 3 review and verification

- [x] Independent review: comparable overall art direction and acceptable for delivery;
  no visual defect was considered blocking.
- [x] Full gate exposed one real regression: the five-pine scrub stands measured 12,640
  `beginPath` calls against the hard <12,000 modal-world budget.
- [x] Consolidated each stand to three larger pines to retain visual mass with fewer paths.
- [x] The first correction measured 12,080 (80 over budget); removed one redundant
  flanking peak per ridge to restore headroom without flattening the main silhouette.
- [x] Final performance gate: 8/8 passed; required gameplay client capture visually inspected
  at `shots/map-upgrade/final2/shot-0.png`, state JSON reports a live world with no modal.
- [x] Final optimization review: PASS; the path-budget correction caused no material visual
  degradation and retained the loop-3 reference parity.
- [x] All 126 non-visual-baseline Playwright tests passed after the final source change.
- [ ] Production world visual baselines intentionally need recapture through the repository's
  `Visual baselines` CI workflow; do not generate them on Windows. The local menu/victory
  text-only baseline drift is the already-documented Windows `system-ui` mismatch.

## Current task

- [x] Measured the phase-4 gameplay audit against the running build (`critiques/phase4/gameplay-audit.md`).
- [x] Tested and rejected the enemy-tuning fixes for "the game plays itself" (`critiques/phase4/self-playing-fix-options.md`).
- [x] Wrote plans 019 (squad orders) and 020 (uneven encounters) and indexed them.
- [x] Implemented plan 019 on branch `codex/squad-orders-slice` (shipped as optional depth).
- [x] Implemented plan 020 on branch `codex/uneven-encounters-slice`.

## Findings

- An idle hero wins the ordinary roaming-party fight with zero casualties, contributing 0 of 625 damage.
- Enemy damage x2, focus-fire, pincer spawns, staggered waves, and even a fully passive troop AI all failed to change that: the encounter is generated favorable (`world.js` guarantees a 0.7-1.2x band) and "kill everything" resolves itself from either side.
- Enemy damage x3 loses the fight only by killing the idle hero while the army loses 2 men: lethality, not decisions.

## Plan 019 implementation

- Branch: `codex/squad-orders-slice`
- Plan: `plans/019-squad-orders-and-stance-tradeoffs.md`
- [x] Step 1: recorded the stance baseline in `tests/e2e/stance-balance.spec.js` before tuning anything.
- [x] Step 2: routed troop AI through per-squad state with a byte-identical measurement (verified inert).
- [x] Step 3: added `SQUAD_CYCLE` (`Tab`) and per-squad orders; `Battle.command` kept as the all-squads aggregate so both legacy contracts pass unweakened.
- [x] Step 4: landed the stance trade-offs (brace, steady aim, charge exposure) and fixed the FOLLOW-vs-raiders grind.
- [x] Step 5: rebuilt the HUD as three squad rows; inspected `shots/plan019/hud-split.png` and `hud-all.png`.
- [x] Step 6: added QA record `squad_selection_and_independent_squad_orders` (inventory now 18).
- [x] Step 7: updated three battle baselines; changes confined to 33,803 px of HUD plus 1,176 px correcting pre-existing staleness.
- [x] Step 8: documented squad/stance ownership and the `toWorld` simulation-input rule.
- [x] Step 9: `npm run test:release` verified; `npm test` passed 50/50.

## Review pass (two subagents) and defect fixes

- A code critic and a casual-player playtest both ran against the slice; their findings overturned the acceptance evidence.
- Premise measured FALSE: over 15 organic camp raids, pressing no order wins 80% (4.3 lost), charging everything 67% (4.9), and the split the spec had certified as best 40% (6.2). Squads now ship as optional depth, not a core mechanic.
- Retracted the unsupported `split beats every uniform order` criterion (held 1/10 seeds independently, 0/5 in my own sweep) and a vacuous test that passed with the feature reverted. Both replaced by an expected failure recording the real camp-raid numbers.
- Retracted the false `AGENTS.md` claim that per-squad hold anchors were in use, and the overstated `tests/README.md` harness description.
- Fixed viewport- and cursor-dependent battle outcomes: formation now hangs off `hero.travelFacing`, not aim. Verified identical across four canvas sizes and three cursor positions, and locked by a regression test.
- Fixed: orders lost to a wiped squad, hold banner never drawing under split orders, `aggregateStance()` counting empty squads, orders swallowed during the intro banner, `Tab` advertised while inert, deploy-banner text overflow, the `CHARGE_EXPOSURE` flicker dodge, `squadStance()` returning `'mixed'`, and defeat advice pointing at the weaker order.
- Added a `brute` fixture and corrected the false brute-counter claim for bracing (nothing but a wolf reaches `BRACE_SPEED`).
- Added `testIgnore: '**/zz-*.spec.js'` — my own instruction to a subagent had put scratch specs inside `testDir`, making `npm test` unreproducible.
- Final: `npm test` 50/50, `npm run test:tooling` 7/7, release token `rada68ae0c75b` verified. Screenshots: `shots/plan019/hud-one-squad.png`, `shots/plan019/hud-split-fixed.png`.
- Plan 020 remains BLOCKED: it needs battles that require a player, which this slice deliberately did not attempt.

## Defects found and fixed along the way

- `Camera.toWorld()` included the shake offset, so decorative shake reached hero facing and FOLLOW formation slots: identical seeded battles measured 45.7s, 30.0s, 45.4s, and 90s. Both legacy determinism records drive CHARGE, which ignores `slotPos()`, so the coverage blind spot matched the defect exactly.
- `bloodlust` only watched for damage, so kiting raiders kept a dead-end fight alive past 90s. A no-death stall clock closes it.
- Two battle baselines had carried an orphaned text region since `2050497` (~0.13%, under the 1.5% diff tolerance), so CI stayed green on a stale baseline.

## Plan 020 implementation

- Branch: `codex/uneven-encounters-slice` (based on `main` at `86c9e08`, after Plan 019 merged).
- Plan: `plans/020-uneven-encounters-with-a-price.md`. The repository owner retired the
  design-opinion STOP (Plan 019 shipping as optional depth) and directed the plan to
  proceed; the deadlock STOP stayed fully active throughout.
- [x] Step 1: landed `SAVE_VERSION` 3 (`save.settlements`, party `occupying`) behind green
  `save-schema.spec.js`/`campaign-persistence.spec.js` before touching any gameplay code.
- [x] Step 2: replaced the flat `0.6 + R()*0.9` fair-band guarantee in `spawnParty()` with
  weighted weak/even/strong tiers (`BALANCE.partyTiers`) whose weights shift toward
  `strong` as camps are razed; added `world_party_spawn_tiers_weighted_toward_strong`,
  swept over 5 seeds.
- [x] Step 3: added break-off-and-raid inside the existing `World.updateParties()` phase —
  a sustained, uncaught `chase` (`BALANCE.raidBreakOffT` = 20s) makes a party give up on
  the hero and beeline for the nearest unclaimed settlement.
- [x] Step 4: occupying a settlement suspends recruiting/healing/army-cap expansion there
  and says so; winning the battle against the occupier restores it.
- [x] Step 5: added the legibility layer — an explicit `⚠` marker on the party badge at any
  visible distance (not just the close-range odds pill), a break-off toast naming the
  settlement, and occupied/threatened map markers on the settlement itself.
- [x] Step 6: implemented the floor guarantee as two independent mechanisms:
  `isSettlementClaimed()` refuses a break-off unless it leaves at least one settlement
  fully unclaimed, and `enforceBeatableFloor()` downgrades the weakest live party whenever
  nothing on the map is beatable. Covered by `world_floor_guarantee_prevents_unwinnable_deadlock`,
  which drives the worst case (three settlements occupied, everything overwhelming) rather
  than asserting the happy path.
- [x] Step 7: reviewed the world visual baselines — both passed against the existing
  screenshots with no diff artifacts generated, so nothing needed updating.
- [x] Step 8: documented the occupation lifecycle in `AGENTS.md` next to the roaming-party
  lifecycle rules, and the new records/fixtures in `tests/README.md` (record inventory
  18 -> 22, including the previously-undercounted `rng_domains` check).
- [x] Step 9: `npm run release:cache` reviewed as a token-only diff (`src/battle.js` untouched
  in content); full verification block green; `npm test` 54/54.

### Implementation findings (see the plan's own section for the full list)

- Tier weights: `weak = 0.40 - 0.30*razed/3`, `even = 0.35` constant, `strong` = the
  remainder — a straight-line interpolation, not a tuned curve.
- The composition-building loop never overshoots its target (a brute is only added when
  the remaining strength already covers it), so a spawned party's strength is always
  exactly its rolled target — useful for reasoning about the tier-classification test.
- A pre-existing edge case (a fully-wiped roaming party on retreat/defeat, not a formal
  victory) needed an explicit fix so an occupied settlement can't get stuck occupied with
  no occupier left to fight.
- No STOP condition was hit; the sanctuary exemption for occupiers is a single added
  boolean in the existing `canClash` check, with no weakening of the safe zone otherwise.

## Plan 020 review fixes

- Verified the Sonnet implementation independently: tiers swept over 10 seeds span 0.43-2.14 with all three bands present and the curve rising 1.13 -> 1.54 as camps fall; break-off, occupation, service suspension, safe-zone exemption and recapture all drive end to end; the deadlock invariant holds with three settlements occupied and a break-off refused the last free one.
- Fixed: `enforceBeatableFloor()` silently rewrote a scouted party (a lone 14-strength band became a 4). It now adds an even-tier party and only rewrites an existing one at the party cap, sharing `partyCap()`/`liveCamps()` with the spawn timer.
- Fixed: an occupying party covered its settlement's name chip. Arrival snaps to `occupierPost()`, 64px north of centre with compass fallbacks.
- `npm test` 54/54, `test:tooling` 7/7, release token verified, `git diff --check` clean.

## Test coverage analysis and the gaps it closed

- Branch: `claude/test-coverage-analysis-cemi4p`. Report:
  `critiques/test-coverage-analysis-2026-08-22.md`.
- Measured, not estimated: V8 range coverage per test (a temporary `page`-fixture
  wrapper, reverted) plus `NODE_V8_COVERAGE` for the tooling suite, folded to line
  level with V8's nesting rule honored — a `count: 0` child overrides its covering
  parent. Without that step the naive union reports a meaningless 100%.
- `src/` was at 96.6% (4490/4648 statement-ish lines). The 158 unexecuted lines
  clustered rather than scattered; the tooling suite added no lines the browser
  did not already reach.
- Closed five of the seven clusters with four QA records and four boundary tests
  (record inventory 21 -> 25, `node --test` 12 -> 14, Playwright 86 -> 89):
  - `hero_swing_and_dash_damage_enemies` — the hero's whole offensive kit was dark.
    DASH appeared in no test at all, and the single `KeyJ` tap in
    `battle_flow_invariants_and_victory` had never landed on a target, so no line
    that applies hero damage had ever run.
  - `battle_retreat_hold_disengages` — the 1.3s held escape decision. The outcome
    was covered by a direct `endBattle` call; the only path a player can take to it
    was not.
  - `economy_army_cap_expansion_and_refusals` — the third town service had neither
    a success nor a refusal record, while recruit and heal each had both.
  - `world_party_spawn_timer_fills_the_map_to_its_cap` — every other party record
    places parties by fixture, so `updatePartySpawns()` had never run.
  - Platform boundary: both `assertPlatform` rejections (the tooling suite had no
    `assert.throws` at all), the web adapter's three `localStorage` catch clauses,
    the `resume` notification, corrupt-settings recovery, and `persistRun()`'s
    non-finite-coordinate guard.
- Re-measured after: 97.9% (4550/4648), unexecuted lines 158 -> 98.
  `battle/ai-phases.js`, `persistence/save-repository.js`,
  `platform/platform-contract.js` and `platform/web-platform.js` all reached 100%.
- Every new test was mutation-tested: the production line it asserts on was broken
  deliberately, the failure confirmed, then restored. Two would otherwise have been
  vacuous — see the two battle-input rules now documented in `tests/README.md`
  (the intro banner runs no phases; a landed hit's hit-stop drops the next tick's
  input).
- Left open, deliberately: the Plan 020 occupied/threatened settlement markers
  (finding 3) need a new visual baseline, which must be generated on CI's pinned
  Chromium rather than in a sandbox that cannot install it.

### Two defects found while measuring, both since fixed

- `npm run test:release` failed at `main` (`c2b3e55`), broken at `36f9e6a` by a src
  edit that skipped `npm run release:cache`. CI runs that check before the browser
  suite, so every push and PR failed before any test ran. Fixed by running the
  updater: a token-only diff across 21 files and 69 references, now verifying
  `rc29d87ba530c`.
- `index.html` ships no favicon. Chromium requests `/favicon.ico`, `serve.py`
  answers 404, and some browser builds report that through `console.error` — which
  `collectRuntimeErrors()` treats as a failure, taking out all 12
  `campaign-persistence` tests and one `menu` test. Reproduced on Chromium 1194;
  the pinned 1234 could not be installed in that sandbox, and since the suite has
  been recorded green on CI it evidently does not report the 404 the same way.
  Fixed with an actual icon rather than by teaching `collectRuntimeErrors()` to
  ignore 404s, which would have silenced the only check that noticed:
  `favicon.ico` (16/32/48) generated from the ASCII pixel map in
  `scripts/make-favicon.py`, plus a relative `<link rel="icon">` in `index.html`
  — relative because a project Pages site is served from a subpath, where the
  browser's implicit /favicon.ico request goes to the domain root and misses.
  Note that `index.html` is filtered out of the release-token hash, so that edit
  does not move the token. A root `favicon.ico` fixes it without touching `index.html`,
  and therefore without moving the release token.

### The third defect: CI was red before any of this

- `Browser QA` had been failing on `main` since `794c4267` ("Merge Plan 018 menu
  vignette") — eleven consecutive runs, 2026-08-17 to 2026-08-22 — on
  `visual-regression.spec.js` "title menu campaign vignette remains visually stable".
- Not flaky and not a browser-version artifact: **23418 differing pixels, ratio 0.03**,
  byte-identical on CI's pinned Chromium, on both retries, on `main` at `e3a8014`
  before this branch existed, and on a local Linux Chromium here.
- Cause: the baseline was captured on a host where `system-ui` resolved to a narrower
  face. The diff image is nothing but doubled text — "MuteMute", "SelectSelect", a
  title whose letters overlap at two different widths. Art was pixel-identical, and
  the title ribbon is sized from `measureText`, so it shifted with the metrics too.
  3.0% against a 1.5% cap.
- Fixed by recapturing that one baseline on Linux, the platform CI runs. The cap was
  NOT touched: at 1.5% it is what makes a missing landmark fail, and this mismatch is
  the evidence it is tight enough to matter. `tests/README.md` now says baselines are
  Linux-captured and why, and names the durable fix (bundle a font instead of drawing
  through `system-ui`) for whoever wants a genuinely portable text baseline.

## Plan 025 implementation (the first region)

- Branch: `milestone-025-regional-conquest`, merged as PR #4 after a fully green
  147-test CI run. Plan: `plans/025-regional-conquest.md`.
- Shipped the regional conquest loop: `src/region.js` (pure model — ownership,
  four specializations, the ENTRENCHED/WEAKENED/EXPOSED power ladder, objective
  tuning, raid cadence), save schema v4 (settlement `owner`/`spec`, four summary
  stat counters, deterministic v3 migration), claim/capture through
  `winSettlement`/`claimSettlement`, occupation that suspends service until a
  Hold-the-ground retake restores it, single-flight regional raids with
  capture/defense grace and the Plan 023 freeze extended to them, battle
  objectives (`src/battle/objectives.js`) resolved exactly once through
  `resolveBattleResult()`, and the campaign summary behind the Wolfsjaw victory.
- Measured finding fixed during review: the stronghold brief's prose said
  "2 defensive guards remain" after camps fell but the fight still built 3 — the
  objective now carries the modded guard count, so prose and fight cannot diverge
  (pinned by `region.spec.js` and `battle-objectives.spec.js`).
- New coverage: `region.spec.js` (10 Node-level model tests),
  `battle-objectives.spec.js` (12 terminal-path tests),
  `regional-campaign.spec.js` (8 production-path campaign tests); save-schema and
  campaign-persistence updated to v4; seven new visual baselines plus a
  regenerated camp-brief baseline.
- Baseline rule made operational: baselines are captured ONLY in CI's exact
  environment (a Windows recapture fails CI at ~3% on text-heavy screens; a
  Docker Linux capture also drifted from the GH runner's font set). Added
  `.github/workflows/visual-baselines.yml` (PR #5) — dispatch, review the
  artifact, commit only intended PNGs. The 1.5% cap was not touched; the new
  stronghold power chip is ~1.3% of the frame, so any tolerance high enough to
  absorb cross-platform font noise would hide exactly the surfaces the milestone
  added.
- Final: `npm test` 146/146 on CI (143/146 locally — the three local failures are
  the documented Windows font ghosting on text-heavy baselines), `test:perf` 8/8,
  `test:tooling` 14/14, release token `r47a9e4eb3305` verified.

## World map visual cohesion pass (2026-08-24)

- Added `src/world/visual-style.js` as the dependency-free presentation contract for
  world palette, asset scales, shadow roles, route/water widths, landmark clearance,
  cluster sizes, regional identity, and HUD-safe rectangles.
- Replaced overlapping screen-spanning terrain facets with three contiguous authored
  8–12-point elevation countries. Added cached riparian ground, forest floors,
  farmland, dead camp ground, variable-width river sections, road approaches, and
  presentation-only landmark framing without changing collider cores or saved IDs.
- World scenery now carries non-persisted `family`, `clusterId`, and `regionId`
  metadata. Isolated shrubs are suppressed; rendered forests, foothills and rocks are
  composed at cluster level and culled through one cluster bound.
- Simplified map markers to one hero ring/body badge and one danger-colored enemy body
  badge. Centralized the resource/objective HUD geometry and reduced the objective
  panel to a compact three-line 56px card.
- Added `world-visual-contract.spec.js`, extended `terrain-geometry.spec.js`, and added
  `scripts/capture-world-cohesion.mjs` for the 11-frame landmark/state/aspect matrix.
- Screenshot loops: `shots/map-cohesion/slice1`, `slice2`, and `slice3`; final named
  frames in `shots/map-cohesion/final`. All capture passes reported no page or console
  errors. The 1600x900 matrix exposed and drove removal of diagonal region overlaps.
- Focused results so far: visual/geometry 8/8, battlefield compatibility 16/16,
  performance 8/8. The first performance run found over-expanded tree clusters
  (13,460 beginPath calls); cluster-level companion rendering reduced it below the
  unchanged structural budget on the second run.
## World-map cohesion final correction loop (2026-08-24)

- Fixed the connected-ellipse `Path2D` fill defect that produced large terrain wedges.
- Added the canonical Highmere → eastern bridge → Wolfsjaw road while retaining the existing gameplay endpoints and crossings.
- Carried sampled river widths through world collision, battlefield briefs, battle collision, reeds, and battle rendering.
- Preserved the legacy deterministic collider/battlefield scenery cores (`mtn/tree/rock/shrub = 47/104/26/49`).
- Suppressed isolated shrubs and reduced map-visible rock patches without removing canonical battlefield inputs.
- Added a smoothly docked hero presentation token at interaction coordinates so landmarks and player state remain separately readable.
- Added a restrained screen-edge veil so large non-interactive silhouettes crop as intentional framing.
- Fresh 11-frame capture matrix completed with no page or console errors.
- Corrected review round: gameplay readability approved all Definition of Done items; architecture/performance approved with only low-priority test debt. Art-direction medium findings were corrected and require a fresh three-reviewer pass.
- Fixed toast sizing state leakage by assigning the standardized font before measurement.
- Shared `heroPresentationPosition()` between rendering and hover hit-testing; the docked visible token now owns the hover affordance while simulation coordinates remain unchanged.
- Cached the four camera-edge gradients per viewport size.
- Final gates: focused visual/geometry/battlefield/hover 31/31, performance 8/8, tooling 14/14, release graph `r725c36fae042`, and full suite 143 functional passes. The 10 expected stale visual baselines remain for the required pinned-Linux workflow; no local baselines were updated.
- Final capture matrix: 11 frames, moving/frozen/occupied/raid states across 960×540, 1280×720, and 1600×900, with no page or console errors.
- Final independent verification: art direction, gameplay readability, and architecture/performance all mark every Definition of Done item passing; no high- or medium-severity findings remain.
## Road geography two-loop pass (2026-08-24)

- User requested at least two implementation loops with an independent critic between them.
- Loop 1: replaced generic endpoint cubics with authored Catmull-Rom routes, aligned road
  tangents to all three bridges, introduced minor/secondary/major width classes, and muted
  road color/shadow. Focused geometry and performance gates passed.
- Loop 1 critic found four medium issues: Highmere hub-and-spoke composition, HUD/edge
  cutoffs, visually compressed width classes, and Ashford's false camp connection.
- Loop 2: merged Brindle/Coldwell at a shared Highmere junction, routed the eastern road
  outside the rendered foothill envelope, swept Ashford lanes around field edges, cached
  tapered 72-unit road sections, added road-only HUD/edge fading, and reduced shoulder weight.
- Added geometry assertions for road classes, <10° bridge approach angles, and >90-unit
  clearance from authored foothill centers. Focused geometry and performance gates pass;
  final loop-2 screenshots have no console/page errors.
- Final loop-2 critic: PASS, no high/medium findings; all four loop-1 medium issues resolved.
- Final verification: battlefield/map focused 24/24, tooling 14/14, performance 8/8,
  release graph `rc4efe354644c` verified, full suite
  143 functional passes. Ten intentionally stale visual baselines remain for pinned-Linux CI.

## River geography pass (2026-08-24)

- Reauthored both canonical river splines with fewer, longer asymmetric bends while preserving every bridge anchor.
- Added arc-length width profiles (75–140%) with 150-unit bridge transitions and asymmetric left/right banks used by rendering and collision.
- Replaced stacked stroked ribbons with cached filled bank/water polygons, one interrupted low-contrast flow band, outside-bend depth, selected bank-hugging sand, one calm shallow, and one eastern island.
- Narrowed water at crossings and sized bridge decks from the sampled river width; added abutment shadows and restrained foam contacts.
- Updated battlefield sampling to carry the pointwise canonical widths and updated geometry contracts.
- Visual loop 1 exposed panel-like sediment and a still-pipeline silhouette; critic marked both high impact. Loop 2 converted sediment to bank lines, reduced riparian/deep contrast, and strengthened authored lateral bends. Final Ashford and Coldwell frames show a clear geographic bend and aligned bridge crossing.

## World camera clamp at scene entry, and a local visual gate (2026-08-24)

- `startWorld()` centred the camera on the hero without clamping, and the map-edge clamp
  only runs on the camera-follow path, which is frozen until the hero rides. On a display
  wider than 1240px the opening frame showed ground west of the map border — 660px of it
  at 2560px wide — and the first moving tick clamped and moved the camera 635px in one
  frame. Clamped once at scene entry; measured at 1600x900 the camera now starts at 775
  and the first three movement ticks move it by 0.
- `clampCamera()` also centres on the map when the viewport exceeds it. Above that size the
  two limits cross over and `clamp(v, lo, hi)` with `lo > hi` returns `lo`, pinning the view
  to one edge and showing the out-of-bounds strip on the other.
- The three text-heavy visual baselines that fail on a Windows host also fail in the pinned
  Playwright image: `fc-match system-ui` there answers WenQuanYi Zen Hei, which ships no
  Latin default sans. Installing `fonts-dejavu-core` makes all twenty pass unmodified, so
  the baselines are DejaVu-specific rather than Linux-specific.
- `npm run test:visual:linux` runs the suite in that container.
- Bundled the UI font rather than living with the split. `assets/fonts/inter-latin-var.woff2`
  (Inter, SIL OFL 1.1, latin subset, variable 400-900, 47KB) is declared in `index.html`,
  and all 85 canvas font strings now read `Inter, system-ui, sans-serif`. `bootstrap()`
  awaits the face before the first frame and the visual spec waits on `document.fonts.check`
  before capturing, because canvas text falls back silently while a webfont loads and the
  menu ribbon is sized from `measureText`.
- Three baselines were recaptured in the container: the menu vignette, the camp-withdraw
  brief and the campaign summary. The other seventeen still match within the unchanged 1.5%
  cap and were left alone. The recaptured set then passed 20/20 on Windows, which is the
  portability the bundle was for.
- Residual: the HUD's symbol glyphs (crossed swords, heart, objective diamond, hammer, eye)
  are outside the latin subset and still resolve per host. They are small enough to stay
  under the cap.

## CI split and the last wall-clock waits (2026-08-24)

- The 360-raid stance sweep is the most expensive test in the repository and carries
  `test.fail()`, so it records a margin and cannot go red on a code change. Tagged it
  `@sweep` and split the config into two projects: `chromium` (152 tests, what `npm test`
  and Browser QA run) and `balance` (the sweep alone, `npm run test:balance`). It reaches
  CI through a separate `Balance sweep` workflow that runs beside Browser QA on the same
  events, so the gate's verdict no longer waits on it. The annotation is unchanged.
- Added a `concurrency` group with `cancel-in-progress` to Browser QA. A second push to a
  branch made the first run's verdict irrelevant; it was still being paid for and still
  had to be waited out.
- Replaced the suite's only two wall-clock sleeps, `waitForTimeout(50)` in `qa.spec.js`,
  with `drainRuntimeErrors()`. The sleep was not merely slow, it was unsound in the
  direction that matters: a sleep shorter than protocol delivery latency reports an empty
  error list and passes with the error still in flight. A round trip through the page
  delivers everything the page emitted before it.

## Audit pass: nine defects found by reading, fixed (2026-08-24)

- A settlement's permanent specialization could be lost for good. `drawSpecPanel` offers
  "X decide later" and `dismissSpecChoice` promised "G at the gates reopens it", but no
  reopen path existed: the CLAIM handler only ran while `owner === 'neutral'`, so G on
  owned land did nothing. `queueSpecChoice` also overwrote its single pointer, and the
  `game.pendingSpecChoice` handoff the constructor reads was never written by anything, so
  a choice queued from a battle's `onWinExtra` died with the World that raised it. G at the
  gates now reopens an owned, unspecialized settlement's choice; `queueSpecChoice` writes
  the Game pointer; `openSpecChoice` names the id `chooseSpec` will commit, so the reopen
  path cannot commit a stale id or none. No schema field was added — the pending state was
  already derivable from `owner`/`spec` on `save.settlements`.
- The headless watchdog dereferenced `game` and `platform` before `bootstrap()` created
  them. `frame()` has guarded this since it was written; the `setInterval` beside it did
  not. Inside the window `await saves.initialize()` opens, `game.update(DT)` threw, the
  catch called `game.enterMenu()` which threw the same error out of the callback, and the
  cycle repeated every 50ms. Guarded, and the recovery call is now itself contained.
- `Camera.update` normalised its decay against a hardcoded 0.25 rather than the duration
  the shake was given, so every shake longer than that overshot: the brute slam peaked at
  12.6 against a requested 9, defeat at 20.0 against 10. `shakeDur` carries the real span
  under the same strongest/longest-wins rule; shakes at or under 0.25 are unchanged, which
  is every remaining call site. All twenty visual baselines still match.
- `SaveRepository.flush()` never cleared `lastError`, so one transient storage failure made
  every later flush reject and pinned main.js's "Save failed" warning for the session even
  though writes were landing. `#enqueue` now records the outcome of the most recently
  settled operation instead of latching the first failure.
- Off-screen chevrons had no reserved rectangle for the objective chip added in Milestone
  025, so they clamped over the hold timer and the guard pips in every objective fight —
  which is every camp raid, defense, retake and the finale. Reserved, gated on
  `battle.objective` so elimination fights place chevrons exactly as before.
- `buildParties` accepted `raid`/`raidKind` on a pre-v4 save while the migration comment
  claimed the legacy flag refused them. It refuses them now, the way `buildSettlements`
  already refused `owner`/`spec`, so a legacy shape cannot smuggle in raid state and break
  the documented rule that a migrated campaign never opens under raid pressure.
- The linked-camp count 3 was hardcoded in three places; all three read
  `REGION.linkedCamps.length` now. The Break-the-position fallback allocated a stand-in
  object plus a nested `d` per troop per tick for the whole approach march; it reuses one
  scratch object per battle, the pattern `_steerScratch` and `_crossingScratch` already set.
- Not fixed, recorded: orders still lose to giving none (`@sweep` measures idle 73% against
  62% for the best deliberate policy), which needs a measured balance pass rather than an
  edit; and the `pushOutOf` pin between two nearby rocks noted in `battlefield-brief.js`.

## Plan 026: the first real audio pass (2026-08-26)

- Audio moved out of `engine.js` into `src/audio.js` and stopped being a synthesiser.
  `Sfx` was 90 lines of oscillators and filtered noise — a square-wave coin, a sawtooth
  horn, four `setTimeout` beeps for victory — and there was no music. It is now backed by
  22 files in `assets/audio/`, 3.6 MB total, every one CC0 or public domain with no
  attribution requirement. `assets/audio/SOURCES.md` records source and licence per file.
- Twelve one-shots come from Kenney's CC0 Impact Sounds / RPG Audio / UI Audio packs. The
  two music beds are RandomMind's CC0 "Medieval: Exploration" (campaign and menu) and
  "Medieval: Battle", from OpenGameArt. Three war horns, the bow release, two hoof falls
  and the victory/defeat stingers are synthesised by `scripts/build-audio.py`: no CC0 pack
  surveyed had a war horn or a bowstring that fitted. That script is the whole pipeline —
  decode, trim, peak-normalise, encode, synthesise — and runs only when assets are
  rebuilt; it is not a build step and adds no runtime dependency.
- No gameplay code changed. Every public method name (`hit`, `swing`, `horn(freq)`, …) is
  the same, so `src/battle/` and `src/world/` are untouched apart from the release token.
  `uiMove`/`uiSelect` are new and wired into the menu, which navigated in silence before.
  `horn(freq)` still honours its pitch — 98 Hz is the stronghold answering, 294 Hz is
  picking a squad — by choosing the nearest of three samples and detuning by playback
  rate, clamped to 0.7x-1.45x so it never stops sounding like the same instrument.
- All SFX files are peak-normalised to the same -3 dBFS, so the relative mix lives in the
  gain table in `src/audio.js` rather than being baked invisibly into 20 files. Sample and
  pitch variation draw from the module's own `AUDIO_FX` stream, the domain the removed
  noise generator used; audio is presentation and never touches `simRng`.
- Music streams through an `HTMLAudioElement` into a `MediaElementAudioSourceNode`, not
  `decodeAudioData`. Measured: the 233-second campaign bed decodes to roughly 330 MB of
  resident float PCM, an order of magnitude more memory than the rest of the game. The
  one-shots stay decoded buffers — ten seconds of audio between them, and a one-shot that
  waits on the network has already missed its frame.
- The integration risk was never the mix, it was `console.error`: an autoplay violation or
  a 404 fails every spec that calls `collectRuntimeErrors`. The context is built lazily on
  the first sound request, `resume()` is attempted one at a time and always with a
  rejection handler, and no bed starts unless the context is actually `running`.
  `tests/e2e/audio.spec.js` drives that gate explicitly by suspending the context, because
  Playwright relaxes the autoplay policy and the suspended state never happens by accident
  there. It also proves every manifest file returns 200 and that all eleven horn pitches
  the game passes find a clip.
- Left for later, recorded rather than hidden: volume settings are not persisted (the gain
  nodes and setters exist, nothing writes them to `settings`); the battle bed has no
  adaptive intensity layers; one-shots have no positional pan; menu and world share a bed
  and the victory summary has none; and neither source track is a gapless loop, so the
  seam is the composer's fade-out meeting the fade-in rather than a true join.

## Plan 027 — enemy command symmetry (stopped on its own condition)

- The enemy has squads now. One per `ENEMY_TYPES` key, membership derived from type exactly
  as the player's is, the same three stance names, and the same mechanics behind them: brace,
  steady aim, charge exposure, formation slots. The commander lives in
  `src/battle/enemy-command.js`, is rebuilt from the battle seed rather than persisted, and
  draws from its own `RNG_DOMAINS.ENEMY_COMMAND` stream so it cannot shift the sequence the
  rest of the fight consumes. No save-schema change, no new dependency, no budget moved, no
  visual baseline touched.
- The plan's premise is not met and is claimed nowhere. Over the same 120 organic camp raids
  the shipped `@sweep` test measures, an idle hero won 75.0% before and wins 77.5% after —
  inside this harness's own documented noise at that sample size. On the standard roaming
  encounter he still wins 95.8% of 24 seeds. The first STOP condition in the plan says to
  stop and report when the idle win rate does not fall, so that is what happened. The
  `test.fail` annotation stays.
- What did move is the gap between commanding and not commanding. Charging everything went
  from 65.0% to 77.5% over the same 120 raids while idle barely moved, so the best deliberate
  policy went from ten points behind pressing nothing to level with it. A formed-up enemy
  that assaults on its own timing can be hit while it does so; the pre-027 converging swarm
  punished a charge because it was already coming from every angle. A tie is not a win and
  the assertion is a strict inequality, so nothing was flipped.
- Inattention costs more men. On the roaming fixture an idle hero lost 0.46 troops per fight
  before and loses 1.58 now, a 3.4x increase, for twelve percent more clock. Duration did not
  balloon: camp raids went 46.3s to 47.8s, and every deliberate policy got faster or held.
  The one number moving the wrong way is idle raids unresolved inside the harness's 95s
  budget, 7 of 120 to 12 of 120; `split` and `holdLine` both improved (32 to 20, 30 to 28).
- Four behaviours that read as obviously smarter are measured net losses FOR THE ENEMY, and
  were removed rather than shipped. Concentration of fire on the wounded man already in
  reach: 75% to 81.7% idle win rate, and 80.8% with hysteresis so it cannot churn. Raiders
  preferring the player's bow line: another six points, because it walks an 85 hp raider
  through four spearmen to reach a 60 hp archer. Head-hunting a stationary commander: 100% on
  the roaming fixture, because an idle hero sits inside his own formation and everything sent
  at him dies crossing it. Charge exposure ordered under bloodlust: 75% to 89%, a straight
  35% damage gift for the rest of every long fight. The common cause is one sentence — in
  this engine a second an enemy spends not attacking is damage it does not deal.
- A per-unit flanking swerve does not converge and was replaced by moving the muster point
  instead. A constant rotation applied to a constantly re-read bearing orbits a target that
  does not move: one raider circled a static warband at a fixed 497 units for the whole 90s
  budget. The muster point also has to sit outside everything the player can reach without
  deciding to — at a 150 standoff the muster walked the enemy line into the middle of the
  player's blob and stood it still there, and the fixture resolved in 16.8s against a 37.4s
  baseline.
- The control that makes all of the above readable: with the commander forced off and every
  enemy squad left on `follow`, both fixtures replay the pre-027 numbers digit for digit.
  `follow` is byte-identical to the old AI on purpose, and it is worth re-running that
  control before trusting any future measurement in this area.
- The audit's central claim now holds from both directions. `self-playing-fix-options.md`
  showed no enemy STAT change fixes the self-playing problem; this shows no enemy BEHAVIOUR
  change does either, for the same reason. The encounter generator's 0.7-1.2x fair band
  counts bodies, and on the real combat scale the roaming fixture is about 71 dps and 750
  hit points against 46 and 610. The two levers left standing are the two this slice kept
  out of scope on purpose: change the win condition, or change the encounter generator. The
  commander is a prerequisite for the second rather than a substitute for it.


## Plan 028 - rebase the encounter generator on measured combat power

- The map balanced on a headcount. `enemyStrength`/`playerStrength` counted bodies: a brute
  5, everything else 1, a knight 2, the hero 3. Measured over 2544 seeded headless battles,
  a brute is worth 3.19 spearmen, a wolf 0.52, a bandit 0.80, and an idle hero about half of
  one. Both surviving levers from the phase-4 audit pointed here, so this slice replaced the
  number rather than tuning anything that reads it.
- Fighting weight is now sqrt(total damage per second x total hit points), normalised so one
  spearman is 1.0. That product is the Lanchester square law, which is what a fight between
  two lines that each shoot at whoever is nearest obeys; the square root makes it scale
  linearly with force size, so it drops straight into the tier bands, the odds thresholds
  and the badges. An enemy's cadence is cooldown PLUS windup, because it telegraphs the blow
  and only starts its cooldown once the strike lands - every earlier piece of arithmetic in
  this line of work divided by cooldown alone and overstated a bandit by 38%.
- The per-type corrections were fitted, not reasoned out, and two came back opposite to the
  reasoning that motivated them. A raider is worth 1.65x its raw damage-times-durability
  figure and a brute 1.90x; both were expected to be worth less, on the grounds that a slow
  brute arrives late and a kiting raider spends its time not attacking. The naive product
  alone calls 87.4% of decisive matchups, which is what headcount already manages. The
  corrections are the whole difference between "no better" and 93.9%.
- It took two measurement grids, and finding out why cost a full round of fitting. 1776
  battles over hand-built enemy ladders are what separate one body's worth from another's -
  a grid of average mixes cannot tell a wolf from a raider. But fitted on those alone, the
  metric put the 50% crossing at 1.12 rather than 1.00 on compositions the generator
  actually rolls. A second grid of 768 battles drawn through the shipped roller fixed that.
  The archer is the clearest case: 0.86 against pure ladders, 1.30 against rolled mixes,
  because a pure wolf pack sends every body at the bow line and eats it, which the ladders
  are full of and real play is not.
- The hero enters the metric as 120 hit points and no damage at all. That is deliberate: the
  generator sizes every fight against a commander who gives no orders and never swings, and
  everything the player does with the sword is his margin over the odds the map showed him.
  The warband hover panel says so in words, because a number that leaves out the player's
  own sword has to.
- Calibration, measured rather than assumed. Over 216 generator-drawn even-tier fights an
  idle hero wins 49.1%, against 58.9% before, and the band delivers 0.99-1.17 of real power
  where it used to deliver 0.73-1.29. The weak tier stays a foothold at 85.2% and the strong
  tier is 0% of 144. A fresh campaign sees weak 33 / even 27 / strong 28 on the map at start
  across 20 seeds, and 0 of those 20 open with nothing at or under the beatable ratio.
- Two of the brief's premises did not survive the measurement and are reported rather than
  worked around. The roaming fixture the audits quote as the standard even encounter is a
  0.57 power ratio - a weak fight, and headcount agreed at 7 against 12, so an idle hero
  winning 95.8% of it was never evidence about the generator. And the camp ladder was
  already close to honest: its authored 0.7/0.9/1.1 tiers delivered about 0.66/0.89/1.06 of
  real power before, so camp raids moved 77.5% to 70.8% and no further.
- What was actually wrong was the variance, and its cause was the hero counting three
  points. He is 43% of a starting warband's declared strength and 21% of a late one's, so
  the same tier meant very different fights at different points in a run: the old even band
  gave a fresh warband a 1.29 ratio at its top, which an idle hero lost every time, and a
  mid warband a 1.14, which it won more often than not. The new band spans 0.18 of ratio
  across three rosters instead of 0.56.
- A second, hidden bias had the same shape. The composition roller stopped on the body that
  crossed the target, and one body is 7% of a late warband's weight and 18% of a starting
  one's - so a fresh campaign was quietly served harder fights than the band it drew. It now
  stops on whichever side of the target is closer, which took a fresh warband's realised
  ratio at a 1.10 draw from 1.20 to 1.08 and the pooled even-band idle win rate from 38% to
  49.1%.
- The beatable-party floor was genuinely broken by the rebase and the worst-case record
  caught it. A comp aimed anywhere inside the even band could overshoot the beatable ratio
  by one body and leave nothing on the map the player could beat, which is the deadlock the
  floor exists to prevent. `trimToBeatable()` makes the guarantee structural rather than
  probabilistic: pop bodies until the party is provably under the ratio, never below one
  body, consuming no simRng draws. `isSettlementClaimed()` needed no change - it counts
  occupiers and compares no forces.
- The `@sweep` annotation stays, and it is now a measured loss rather than a tie. Resolved
  at 360 raids per policy: idle 71.7% +/- 2.4, chargeAll 66.4% +/- 2.5, holdLine 36.4%,
  split 35.6%. Paired seed by seed and camp by camp, charging won 40 raids that pressing
  nothing lost and lost 59 that it won - a margin of -5.3 +/- 2.8 points against commanding.
  Plan 019 measured -10, Plan 027 closed it to 0.0, this puts it at -5.3. Smaller draws of
  the same fixture landed at -2.5 and +3.0, which is exactly why it was resolved at three
  times the sample size before anything was flipped.
- Why commanding still loses is visible in one column. Idle leaves 41 of 360 raids
  unfinished inside the harness budget and chargeAll leaves 20, nine seconds faster.
  Charging buys tempo with a 1.35x damage penalty, and a warband on FOLLOW does not need the
  tempo. Harder encounters made that trade worse rather than better, because the penalty
  scales with the incoming damage.
- Four Plan 020 records changed semantics and each preserved its intent; one of them got
  stronger. The tier-distribution record's `assert(other === 0, 'a spawned party landed
  outside all three declared tiers')` was vacuous - the old classifier always returned one
  of three names, so the bucket could never fill. It now counts a draw that falls in a gap
  between the declared bands, which is what the assertion always claimed to check.
- No save-schema change, no new runtime dependency, no performance budget touched, and no
  visual baseline moved. The brief and hover panels genuinely changed their text and two
  baselines' party fixtures changed body count, but all 20 comparisons passed inside the
  suite's existing tolerance with no diff artifacts, so nothing was recaptured and nothing
  was left stale.

## Plan 029 - unit identity, and something to build between fights

Two halves of one slice, in that order because progression multiplies whatever a unit is
worth: ranking up three interchangeable bodies is three times nothing. Baselines measured on
`7de3bb5` before any src edit (`critiques/progression-baseline.md`); before/after in
`critiques/progression-comparison.md`.

- The brace was not a weak mechanic, it was a dead one. Sampling every enemy inside a holding
  spearman's strike reach over 24 fights: the MEDIAN closing speed is NEGATIVE for every enemy
  type on both fixtures, because by the time anything is in reach it has braked to wind up its
  own blow and separation is pushing it back out. The bonus fired on 0.1% of bandit contacts
  and 0% of brute contacts. Plan 019 had already had to retract a brute-counter claim over this
  and the constants file called it a wolf counter; measured, it was a wolf counter about one
  contact in fifty.
- The obvious repair was measured before it was designed in, and it fails too. Latching the
  fastest speed seen in the last second gives a median latched peak of 73 for bandits, 75 for
  wolves and 72.9 for brutes - whose base speed is 55. That is not locomotion, it is the
  `+= cos * 85` knockback impulse every landed hit applies. A rule keyed anywhere in the 40-90
  band would have meant "I hit it, therefore it charged me".
- What shipped instead latches COMMANDED locomotion while approaching a hostile, before terrain
  scaling, with two clauses: at or above BRACE_SPEED (130 - a wolf at 158 or a knight at 175) or
  above 1.10x its own walk (a body ordered forward: charge 1.15, bloodlust 1.3). One predicate,
  both sides, per Plan 027's symmetry rule. It now fires on 24-35% of wolf contacts against
  2.5-6.1% before, and on 2.6% of brute contacts against 0%.
- Spear and archer stopped sharing a damage number, which was the audit's literal complaint.
  Spear is 12 at cadence 1.05 and owns the brace; archer is 13 at cadence 2.2 with a declared
  `bonusVs: { brute: 2.0 }`. A knight costs two places in the column, through one `armySlots()`
  that every cap read goes through - the recruit refusal, the HUD, the save validator and the
  specialization's troop grant.
- This slice introduced an AFK-farm regression and the sweep caught it. The first complete build
  measured idle camp raids at 78.3% against the 70.8% baseline, undoing Plan 028's whole gain on
  that fixture. The cause was the archer's counter shipped unconditionally: camp garrisons are
  the brute-heavy fights, so a free doubling against brutes is a large real power gain handed to
  a player pressing nothing. Gating it behind steady aim returned the number to 70.8% digit for
  digit over the same 120 raids. It is also the better design and is this plan's own perk rule
  applied to unit identity - the archer keeps the role and buys it with an order.
- Progression is one integer per troop and two fields per save. `vet` counts battles WON and
  walked out of; rank is derived and never stored. Nine perks in three tiers, each of which
  amplifies an order, removes an order's cost, or rewards a pressed input - never a flat aura,
  which would reward exactly the behaviour Plans 027 and 028 spent two slices measuring as
  already too strong. Perk POINTS are derived from razed camps plus captures rather than
  counted, so the award is idempotent across a reload, a defeat and a re-entry. The banner is
  the gold sink and buys a CEILING on rank rather than a bonus.
- SAVE_VERSION 4 -> 5. A single `legacy` boolean could not survive a second version: v4 is a
  legacy shape now and legitimately carries the ownership and raid fields v3 must be refused
  for, so `buildV1` takes the declared version and derives legacy/preV4/preV5. The v4 army-cap
  migration grandfathers rather than refuses - twelve knights inside a cap of twelve is the
  audit's own "solved" army and 24 places under the new arithmetic, and deleting a legitimate
  campaign for a rule that postdates it is the worse failure.
- The Drillyard perk would have written saves the validator refused. Found by reading: the perk
  shifts every rank threshold, so a body legitimately reaches rank 2 at `vet` 6, while the
  validator computed its hit-point bound at shift 0 and would have capped it at the Veteran
  maximum. Whatever grants a rank must bound it. It has a fixture now.
- The power metric was re-fitted, because Plan 028 documents that retuning UNIT_TYPES
  invalidates it. 2328 fresh battles, same method: 89.7% of decisive matchups called correctly
  against headcount's 84.6%, 93.5% against 85.8% on the ladders, and a tie on rolled
  compositions (82.0 against 82.3) which is stated rather than hidden. The fit had to be run
  twice - the first was measured against the ungated archer and priced the brute at 1.74 instead
  of 2.00.
- A harness bug looked exactly like a balance finding and nearly went in the report as one. The
  tier calibration's first veteran run showed a Champion-heavy warband winning 16.7% of even
  fights against an unblooded one's 66.7%. `zz-tier-calibrate.mjs` was building its battle
  roster with `troops.map(t => ({ type: t.type }))` and dropping `vet`, so every veteran roster
  was SIZED as veterans and FIELDED as recruits. Corrected, a blooded mid warband delivers 55.6%
  where the same eight bodies unblooded deliver 55.5%.
- Veterancy is priced right at mid progression and over-credited at the top: vetLate wins 72.2%
  of its even fights against unblooded late's 44.4%. The square law credits per-body quality
  linearly and a real fight rewards fewer-tougher bodies superlinearly. Fitting the rank credit
  against a ranked-roster grid is the correct fix and is the top follow-up; at 12 seeds a cell
  the data cannot support inventing an exponent, and doing so is the mistake three previous
  plans declined to make.
- HOLD stopped being a trap. Over 120 organic camp raids it went from 35.0% to 51.7% and split
  from 36.7% to 45.0%, while idle went 70.8% to 69.2%. The best deliberate policy is now 0.9
  points behind pressing nothing where Plan 028 measured 5.3. The `@sweep` annotation STAYS: one
  point behind is behind, the assertion is a strict inequality, and a margin inside the harness's
  own run-to-run drift is exactly what Plan 019 had to retract. Fourth attempt, closest yet.
- Gold matters through the whole opening now. Over 6 campaign openings of 14 fights each under a
  spend-what-you-have policy, mean earned 918 g against mean spent 863 g, gold held never runs
  away, and the first banner stage is only reached around fight 10-14 - where the audit found
  gold "stops being a resource after about four fights". The caveat is honest: the army-cap
  upgrade is what keeps the curve binding, not the banner, and a player who stops expanding the
  column will bank gold.
- Two visual baselines are stale and were deliberately left so: `world-brief-party.png` (3%) and
  `world-brief-camp-withdraw.png` (4%). The brief panel legitimately grew two roster lines
  (veterans, perks) and 40px of height. Baselines are captured only through the pinned-Linux CI
  workflow, so they are listed rather than recaptured, and the 1.5% cap was not touched.

## Plan 030 - one menu behind every map interaction

- The campaign map has one verb. `E` next to a village, a town, a bandit camp or the
  stronghold opens a site menu; every service is a row in it. `RECRUIT_SPEAR`,
  `RECRUIT_KNIGHT`, `HEAL`, `EXPAND_ARMY`, `CLAIM` and `UPGRADE_BANNER` were deleted from
  `input-actions.js` rather than left bound, which also cleared `KeyR`'s collision with
  `ABANDON_RUN`.
- The five-line prompt panel is now a one-line chip: `Village of Ashford · E`. The bottom
  HUD safe band dropped 120px to 64px with it, so hover is no longer suppressed over map the
  HUD stopped covering, and `WORLD_ART.hud.contextW` was deleted.
- The menu is a `world.screen` of kind `'site'`, on the machinery the brief, aftermath,
  specialization and perk screens already share. That is what buys the "a world modal
  genuinely pauses the campaign" contract without inventing a second pause. `site-menu.js`
  owns the model and the dispatch; the rules stay in `recruit()`, `restAndHeal()`,
  `expandArmy()`, `upgradeBanner()` and `claimSettlement()`, so a row's price tag and its
  charge read the same number and a refused row still commits so that method's own refusal
  is what the player sees.
- Committing a row rebuilds the model from the save instead of patching it, so a second
  spearman is one more ENTER and the purse in the header cannot go stale. Claim and
  choose-a-calling close the menu before calling in, because `queueSpecChoice()` and
  `offerPerkChoice()` both no-op while a screen is open and would otherwise have swallowed
  the prompt the claim earns.
- An occupied settlement's menu has zero rows. The suspension is structural now rather than
  a refusal per key, and both `qa_suite.js` and `campaign-persistence.spec.js` assert it that
  way. The stronghold's storm row is offered at every power state, which is what the code
  already allowed - only the old prompt text hid it below three razed camps.
- Found while doing it: every world modal's vertical text placement was a hidden dependency
  on `drawHud()` leaking `ctx.textBaseline = 'middle'` and never resetting it. The new chip
  resets it properly, which shifted all four panels 8px and failed
  `world-brief-camp-withdraw.png`. Fixed by declaring the baseline in each panel, not by
  removing the reset. The baselines are unchanged.
- No existing baseline was recaptured. Two were added - `world-site-town.png` and
  `world-site-camp.png` - through the pinned-Linux workflow. The chip and the missing
  scouting toast both sit under the modal scrim in every affected frame and stayed inside the
  1.5% cap.
- Accepted: an open menu freezes the clash seam that still runs under a stopped hero, so a
  party cannot reach you while you shop. Every other world modal already behaves this way; a
  bespoke half-pause for this one screen would be worse than the exploit it leaves.

## Plan 031 - one key, one modal language, no blind permanent choices

- `E` confirms as well as opens (`CONFIRM: ['Enter', 'KeyE']`). Enter stays bound - it costs
  nothing and three tests drive it through the real keydown listener. This makes
  `WORLD_PRIMARY` a strict subset of `CONFIRM`, the only pair in the binding table not
  separated by scene, so it rests entirely on `updateWorldScreens()` returning true whenever
  a screen is open. AGENTS.md now says so.
- Verified rather than assumed: one keydown is one edge (`endFrame()` runs per fixed step,
  `e.repeat` is filtered), a held key does nothing past its first tick, and the battle
  intro's early-out is unreachable through the brief path - `pressed` is cleared before
  Battle first ticks, and for a brief-routed fight `introDur` equals the clause's own 0.6
  threshold, so it is dead code there.
- The trap that made the arm mandatory: clearing an aftermath with CONFIRM opens the spec or
  perk modal on the SAME tick. A player mashing after a fight landed press 2 about 125ms
  later on a permanent choice and took option 0 blind. `CHOICE_ARM_T` (0.4s) rides on the
  model, so a screen replacing another gets a fresh arm for free. Navigation stays live and
  disarms on the first move; while armed the hint reads "read it first..." rather than
  printing a key that does nothing.
- Five panels collapsed onto four primitives. `drawSpecPanel` and `drawPerkPanel` were 79%
  byte-identical - 41 of ~52 lines, every difference a string or a constant. `drawModalRow`
  is pixel-exact: its two baselines round to the same integers at every row height in use
  (64 -> 26/48, 52 -> 21/39). `rowBlock` also closed a latent TypeError - both choice panels
  indexed `rects[rects.length - 1]` unguarded.
- Two panels could clip and two reserved space they never used. `drawPerkPanel` had NO height
  clamp and five perks is a normal mid-campaign state; `drawSpecPanel` was unclamped too and
  survived only by having exactly four options. The brief reserved a fixed 460px base and left
  ~175px of dead air on every camp raid; the aftermath reserved 440px for as little as 200 of
  content. All four now size to what they report.
- `fitText` guards the two real overflows: the brief's perk line runs past the panel edge once
  five perks are held, and the perk panel's longest detail row nearly does. Both draw copy
  that lives in progression.js and region.js, so the panels defend themselves.
- Information the player needed and did not get: defeat takes 30% of your gold and never said
  so (now `Lost: -N gold`); the aftermath never mentioned the veterancy it had just awarded;
  the perk panel never drew the `earned`/`spent` its own model computed; the brief never
  showed hero HP, with the HUD's heart chip at 28% under the scrim.
- Feel: every world modal was mute. `uiMove`/`uiSelect` ship, are CC0-documented, and were
  wired only into the main menu - now on navigation, commit, dismiss and menu-open.
  `Sfx.play()` drops a one-shot with no AudioContext, so no autoplay violation. Added a
  selected-row marker in the gutter the rows already reserved, a drop shadow offset along the
  game's light direction (an offset rrect, not ctx.shadowBlur), a header rule with diamond
  caps, and a DECIDE LATER button on the two panels whose only clickable thing was previously
  an irreversible commit.
- Correction: Plan 030 left a comment claiming visual baselines pinned the spec and perk
  panels. False - there were none, and no scenario could open either. `world_choice` and two
  baselines were added first, as the prerequisite for touching those painters.
- Accepted: mashing E at a settlement still buys repeatedly. The purse updates live and the
  notice names each purchase; arming the site menu would dull the interaction it exists to
  make fast, and the outcome is neither permanent nor hidden. The brief is unarmed for the
  same reason - it opens because the player chose a row and it offers withdraw.
- Four baselines recaptured (both briefs, both aftermaths) plus two new choice ones, all
  through the pinned-Linux workflow. The two site baselines were NOT recaptured: the marker,
  rule and shadow landed inside the 1.5% cap and they still pass unmodified.


## Map name plates: text jammed to the top edge (2026-08-30)

Reported as "the titles get regularly broken", with three screenshots of Ashford.
"Regularly" was the diagnosis: the breakage toggles with where the hero is standing.

`drawSettlement` and `drawCamp` in `src/world/render-scene.js` set `ctx.font` and
`ctx.textAlign` but never `ctx.textBaseline` - they inherited it. The landmark
interaction chip in `render-actors.js` ends its frame on `'alphabetic'` and the resource
chip ends on `'middle'`, and canvas text state survives the frame, so the plate that a
settlement drew was filled with whatever the PREVIOUS frame's HUD had left. Measured at
Ashford, 1280x720, camera pinned: plate rows 404-428 both times; the name occupied rows
405-417 with the hero parked on the village (1px above, 11px below) and rows 410-422 with
the hero away (6 and 6). Same frame, same code, two different-looking titles.

Fixed by declaring the baseline and centring every map chip on the plate it just drew:
settlement name, OCCUPIED, Wolfsjaw Hold, the hold's power word, and the bandit-camp
chip. The stronghold power and OCCUPIED chips were 3px low even in the good state; they
are centred now too.

Second defect found in the same block: the specialization glyph was drawn centred on
`s.x + nw / 2 - 9`, which is exactly the right edge of the centred name, so a player-held
town with a specialization painted the glyph over its own last letter. The glyph is now
measured before the plate and the plate is widened to hold it.

Guarded by `map name plates centre their text regardless of the inherited canvas
baseline` in `world-visual-contract.spec.js`: it renders the same pinned frame under five
inherited baselines and asserts the plate and text pixel rows are identical, then asserts
the name is centred within 3px. Verified to fail on the pre-fix renderer. A single-frame
visual baseline cannot catch this class of bug - it only ever records one of the two
states.

## Plan 033: the deployment phase (2026-08-30)

The timed deploy window is gone. A non-ambush battle now hands over from the intro to a
paused `deploy` state: no phases run, no clock advances, and the fight starts on an armed
CONFIRM (Enter/E, `DEPLOY_ARM_T` 0.35s). The player places his men (hero included) by
dragging them inside his deployment ground — his side of the field up to `DEPLOY_NO_MANS`
(220) short of the midline — and squad orders still land during the phase. On confirm,
every troop's hold anchor is set where he was placed and squads still on the neutral
`follow` are promoted to HOLD, so the placement survives the first fight tick instead of
being walked back to formation slots. Squads explicitly ordered during the phase keep
their order.

The enemy deploys too: a battle with the phase spawns its force already formed (melee
ranks by the Plan 027 RANK table, raiders behind, wolves on the wings) via
`placeEnemyDeployment` in `src/battle/enemy-command.js` — pure eslot geometry, no RNG, so
the simRng draw order is untouched. Ambush and caught-fleeing fights (`deploy: 0`) keep
the legacy scatter and skip the phase entirely; `battle_bridge` is unchanged. Because the
force starts formed, the commander's first `form` doctrine is a short march to the muster
rather than a scatter walking to slots and standing.

Deleted with the window: the frozen-enemies block at the top of `updateEnemyPhase`, the
four FIRST BLOOD early-outs, the countdown HUD (replaced by the FORM YOUR LINE panel),
and `deployT`/`deployMax`. Five qa_suite records were updated to the new mechanic (the
three battle-flow records take the production Enter path; record 26 re-reads its silence
clause against the paused state; the brace-latch fixture forces `state='fight'` like the
e2e fixtures). The eight non-ambush battle visual baselines change by design — the 1.5s
settle frame now shows the paused deployment screen — and are recaptured through the
Visual baselines workflow.

Measured after landing: npm test 181/181 with the recaptured baselines
(battle_bridge unchanged — the scatter-path control). The 360-raid sweep now
crosses the deployment phase through the real CONFIRM press; the first fix
reused the fixture's cumulative clock for the arm wait and test.fail reported
green in 2.0s on a thrown guard — re-fixed with a dedicated arm clock. Honest
numbers (120 raids/policy): idle 67 (was 69.2), chargeAll 52 (was 68), split 35
(was 45). The orders-vs-idle finding stands, margin widened to fifteen points
against commanding: a held line at spawn auto-battles as well as a following
one, and charging a pre-formed enemy is far worse than charging a scatter. The
test.fail annotation stays; the positional slice (plans/032) is what aims at it.
