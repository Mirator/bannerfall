Original prompt: Make an gameplay audit and suggest 5 things how the gameplay could be improved. Both polishing current features and new features

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
