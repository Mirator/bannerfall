# Test coverage analysis — 2026-08-22

Measured, not estimated. Every number below comes from V8 range coverage collected
while the real suites ran; the raw per-test records and the aggregation scripts are
reproducible from the method section.

## Headline

`src/` is at **96.6% line coverage (4490 / 4648)** from the 86-test Playwright gate.
The 12 `node --test` tooling tests add **zero** additional covered lines — every line
they reach is already reached in the browser.

158 lines are never executed by any test. They are not spread evenly: they cluster in
seven places, and three of those clusters are player-facing behaviour rather than
defensive plumbing.

| file | % | missed |
| --- | --- | --- |
| `src/platform/web-platform.js` | 84.9 | 8 |
| `src/world/settlement-interactions.js` | 85.2 | 16 |
| `src/platform/platform-contract.js` | 86.7 | 2 |
| `src/battle/ai-phases.js` | 93.2 | 14 |
| `src/persistence/save-repository.js` | 93.2 | 4 |
| `src/main.js` | 94.1 | 37 |
| `src/battle/hud.js` | 94.3 | 9 |
| `src/battle/combat.js` | 94.8 | 5 |
| `src/battle/separation.js` | 95.4 | 3 |
| `src/world.js` | 95.5 | 24 |
| `src/world/battle-transition.js` | 96.2 | 6 |
| `src/engine.js` | 97.0 | 11 |
| `src/battle/render-units.js` | 97.5 | 6 |
| `src/world/render-scene.js` | 97.6 | 6 |
| `src/battle/spatial-index.js` | 98.3 | 2 |
| `src/world/render-actors.js` | 98.6 | 2 |
| `src/world-screens.js` | 99.3 | 2 |
| `src/save.js` | 99.5 | 1 |
| `battle.js`, `data.js`, `input-actions.js`, `battle/constants.js`, `battle/render-scene.js`, `world/terrain.js` | 100.0 | 0 |

## Before any of that: CI on `main` is red right now

`npm run test:release` fails at `main` (`c2b3e55`), on a clean clone, with no local
changes:

```
release cache check failed: index.html uses ra209d001f5a8, expected rc29d87ba530c
```

Bisected: it broke at `36f9e6a` "Drop the captives-join-the-warband reward from camp
raids", which edited `src/world/settlement-interactions.js` and
`src/world/battle-transition.js` without running `npm run release:cache`. `e3a8014`
and everything before it verify clean.

`.github/workflows/qa.yml` runs `Verify release cache tokens` **before** `Run browser
QA`, so every push and every pull request against `main` fails at that step and never
reaches the test suite. This is the checker doing exactly the job Plan 012 built it
for — the omission it is designed to catch is the omission that happened — but nobody
has run it since.

The fix is one command, `npm run release:cache`, producing a token-only diff (21
files, 69 replacements, no content change). It is not applied here: this branch
carries a documentation-only commit, and rewriting every module reference inside it
would bury the analysis in noise. It does mean any pull request from this branch will
show the same red release-check until the token bump lands, on `main` or ahead of it.

## Finding 1 — the hero's offence has never been exercised

`ACTIONS.DASH` is bound to `Space` and `ShiftLeft` (`src/input-actions.js:17`) and
advertised to the player on the settings panel (`src/main.js:437`). No test in the
repository presses either key: `grep -rn "dash" tests/` returns nothing. The whole
verb is dark — `src/battle/ai-phases.js:81-86` (activation, i-frames, cooldown,
`_trampled` reset, dash velocity, `sfx.dash()`) and `:28,31-34,37` (the dash-active
trample loop and its `damageEnemy` call). `src/engine.js:309` (`sfx.dash()`) is dark
for the same reason.

The swing is worse than it looks. `tests/qa_suite.js:85` does tap `KeyJ` once — with
the comment "hero helps fight so the run reliably converges" — but
`src/battle/ai-phases.js:72-73`, the body of the loop over targets inside the swing
arc, never executes. The tap has never landed on anything. Every line that applies
hero melee damage and knockback is unexecuted, and so is the MISS feedback path
(`src/battle/combat.js:40-41` plus its renderer `src/engine.js:183,234-238` — the
floating-text particle kind exists solely for it).

This is a coherent blind spot, not a coincidence: the audit already recorded that "an
idle hero wins the ordinary roaming-party fight, contributing 0 of 625 damage", and
`stance-balance.spec.js` deliberately keeps the hero idle so each number isolates the
order. Nothing then covers the hero acting. Two consequences worth naming: the
`_trampled` bookkeeping (set in one phase, cleared in another) has no regression net,
and `HERO.dashDmg`/`swingDmg`/`dashSpeed`/`iframeTime` can be edited to any value
without a single test noticing.

Cheapest close: one QA record that spawns a fixture enemy inside the swing arc,
asserts its HP drops by `HERO.swingDmg`, then dashes through a second one and asserts
the trample damage plus the i-frame window. Both are direct-API drives, no timing.

## Finding 2 — army-cap expansion is entirely untested

`src/world/settlement-interactions.js:72-76` (the `EXPAND_ARMY` branch: cost check,
gold spend, `armyCap += 2`, and the refusal message) and its pricing helper
`src/world.js:439-440` (`armyCapCost()`) never run. The prompt line that advertises it
to the player, `src/world/render-actors.js:164`, never renders either.

The QA inventory has `economy_recruit_cost_cap_and_gold_refusals` and
`economy_heal_refusals_and_success_path`, so recruiting and healing are covered on
both the success and the refusal path. The third town service was never given the
same treatment, and it is the one that mutates a persisted campaign field
(`save.armyCap`) which the recruit cap then reads. Close it by extending the existing
economy record with a T press at a town: assert gold spent, `armyCap` up by two, the
refusal at insufficient gold, and that the new cap survives a save round-trip.

## Finding 3 — Plan 020's occupation legibility layer is mostly unverified

`progress.md` records for Plan 020 step 7: "reviewed the world visual baselines — both
passed against the existing screenshots with no diff artifacts generated, so nothing
needed updating." That is true and also uninformative — no baseline contains an
occupied or threatened settlement, so the new drawing code could not have changed any
of them.

With `campaign-persistence.spec.js` passing, the `OCCUPIED` chip
(`src/world/render-scene.js:298-306`) does now execute. The threatened-settlement
pulse ring (`:309-314`) does not — it has never been drawn in any test. Neither
marker has a visual baseline, so both are protected by nothing but the line reaching
a canvas call.

Related and still dark: `src/world.js:364`, the compass-fallback arm of
`occupierPost()` (added in review specifically so the occupier stops covering the
settlement's name chip — the fallback itself is untested), and `src/world.js:397-400`,
the branch of `enforceBeatableFloor()` that rewrites an existing party at the party
cap. `world_floor_guarantee_prevents_unwinnable_deadlock` drives the add-a-party
branch only, and the rewrite branch is the one whose predecessor was found silently
turning a scouted 14-strength band into a 4.

## Finding 4 — the natural party spawn timer never fires

`src/world.js:793-795,800-803` — `spawnT` reset, live-camp pick off `simRng()`,
`spawnParty()`, the spawn ring, `persistParties()` — is unexecuted. Every party in
every test arrives through a fixture or a direct `spawnParty()` call.

So the tier-weighting record proves what `spawnParty()` produces, and nothing proves
the campaign ever calls it, at the cap it claims, at the cadence it claims. The
timer, `partyCap()` and `liveCamps()` are shared with `enforceBeatableFloor()` (that
sharing was itself a review fix), and a change to any of them is invisible to the
gate. A single record that advances world time with the hero riding and asserts party
count rising to `partyCap()` and no further would cover the timer, the cap and the
persistence call at once.

## Finding 5 — in-battle retreat completes in no test

`src/battle/combat.js:126-127` (the retreat hold reaching 1.3s and calling
`endBattle(false, true)`) and the HUD banner that counts it down
(`src/battle/hud.js:103-107`) never execute.

Note this is *in-battle* retreat, distinct from the world-side withdraw that
`world-screens.spec.js` covers well, and distinct from the retreat *outcome* that
`campaign-persistence.spec.js` covers by calling `endBattle` directly. What is
missing is the only path a player can actually take to reach that outcome: holding a
direction for 1.3s. The threshold could be changed, or the hold could stop being
interruptible, without any test failing.

The disengage bookkeeping itself (`src/world/battle-transition.js:116-120`) *is*
covered, by that direct `endBattle` call. Two of its neighbours are not:
`:100-101`, stripping the dead from a camp garrison after a failed or abandoned
raid, and `:111`, the victory-with-losses toast.

## Finding 6 — every failure path in the platform boundary is dark

The boundary is the newest architectural seam and it is the least covered code in the
repository.

- `src/platform/platform-contract.js:11,16` — both `throw` branches of
  `assertPlatform()`. `tests/tooling/platform-contract.test.js` contains no
  `assert.throws` at all: it builds a *valid* fake platform and asserts the happy
  path. A contract assertion whose rejections are never asserted does not constrain a
  future desktop adapter, which is the entire reason it exists.
- `src/platform/web-platform.js:9-11,46,50,54` — `storageError()` and all three
  `catch` clauses around `localStorage`. A quota-exceeded write or a private-mode
  read (both routine in a browser) takes a path nothing has ever run.
- `src/platform/web-platform.js:27-28` — the `resume` notification.
  Deactivate/suspend are covered; the wake-up is not.
- `src/persistence/save-repository.js:37-42` — corrupt settings JSON: the recovery
  that removes the bad blob and falls back to defaults.
- `src/main.js:69-70` — the guard that refuses to save non-finite campaign
  coordinates. This one is a deliberate integrity check against exactly the class of
  bug (`Camera.toWorld` shake leakage) the audit already found once.

All five are cheap to cover from the node side with an injected fake platform that
throws — no browser needed.

## Finding 7 — top-level crash recovery and the pause screen

- `src/main.js:551-553` and `:572-574` — the `catch` in the game loop and in the
  watchdog loop: log, reset the accumulator, drop to the menu. The safety net under
  every scene has never been tripped in a test.
- `src/main.js:298-311` — `drawPause()`, the whole pause overlay including the
  "closing the tab is safe" reassurance. Never drawn, no visual baseline.
- `src/main.js:501-503` (the HARD CAMPAIGN badge) and `:518-519` ("Press ENTER for a
  new campaign", the no-save menu state) — two menu states that render in no test,
  though `menu.spec.js` covers hard mode's *behaviour* and `bootFresh()` exists.
- `src/main.js:191-192` — menu navigation *upwards*. Only the downward wrap is
  covered.
- `src/engine.js:74-77` — the `mousemove` handler that maps client coordinates into
  canvas space. Seven `world-hover.spec.js` tests pass without it: they drive hover
  synthetically. Given that this repo has already shipped one viewport- and
  cursor-dependent battle outcome (the `Camera.toWorld()` shake defect), the untested
  edge is the DOM→canvas mapping itself.

## Smaller gaps, listed for completeness

- `src/world/settlement-interactions.js:115-123` — the remnant absorption when the
  third camp falls ("bandit remnants withdraw into Wolfsjaw and man its walls"), and
  `:138-139`, the refusal to assault the stronghold early.
- `src/battle/separation.js:46-48` — hero-vs-obstacle push through the spatial
  obstacle grid; only the legacy path runs.
- `src/battle/spatial-index.js:52-53` — the collect-all-items fallback.
- `src/battle/hud.js:173-175` (the `N vs M` intro count) and `:208` (the
  "they were stronger" defeat advice).
- `src/battle/combat.js:80` (clearing `selectedSquad` when a squad is wiped — a review
  fix, uncovered) and `:110` (`sfx.horn(131)`).
- `src/battle/render-units.js:157-158,304-307`, `src/world/render-actors.js:98`,
  `src/world-screens.js:357-358` (the word-wrap continuation), `src/save.js:193`,
  `src/world.js:298,620,691-694,720-722,729` (party unwedging, second-axis river
  slide, wander reset), `src/main.js:22,158-159,162,256,676-677,838`.

## An unrelated robustness defect found while measuring

`index.html` ships no favicon and no `<link rel="icon">`. Chromium therefore requests
`/favicon.ico`, `scripts/serve.py` answers 404, and *this* Chromium build reports that
404 through `console.error`. `collectRuntimeErrors()` (`tests/e2e/test-helpers.js:12`)
treats any console error as a failure, so all 12 `campaign-persistence.spec.js` tests
and one `menu.spec.js` test failed inside `openPlayerGame()` before their bodies ran.

This was reproduced on Chromium 1194, the build available in this sandbox; the pinned
1234 could not be installed here, so whether it reports the 404 the same way is
untested. The repository's own history is the only evidence either way — the suite has
been recorded green on CI, so the pinned build evidently does not surface it. Either
way the gate is one browser-version bump away from 13 red tests with a cause nobody
would look for in a persistence suite. Two one-line fixes, either is enough: add
`<link rel="icon" href="data:,">` to `index.html`, or have `collectRuntimeErrors()`
ignore resource-load 404s. Adding the link is the better one — it also stops the 404
for real players.

## Structural note: which specs carry unique coverage

Lines reached by exactly one spec file, i.e. what is lost outright if that spec stops
running:

| spec | lines reached | reached by this spec alone |
| --- | --- | --- |
| `qa.spec.js` | 5603 | 158 |
| `world-hover.spec.js` | 2853 | 101 |
| `performance.spec.js` | 3967 | 71 |
| `menu.spec.js` | 2674 | 38 |
| `campaign-persistence.spec.js` | 4495 | 26 |
| `input-actions.spec.js` | 4187 | 24 |
| `save-schema.spec.js` | 3672 | 23 |
| `visual-regression.spec.js` | 4770 | 6 |
| `platform-boundary.spec.js` | 2481 | 5 |
| `world-freeze.spec.js` | 3061 | 4 |
| `stance-balance.spec.js` | 4512 | 1 |
| `terrain-geometry.spec.js` | 2450 | 0 |
| `world-battle-seams.spec.js` | 4010 | 0 |
| `world-screens.spec.js` | 4286 | 0 |

Read this as a dependency map, **not** as a value ranking. A zero means the spec
asserts properties of code other specs also execute — which is exactly the job of
`world-battle-seams.spec.js` (phase ordering by name), `terrain-geometry.spec.js`
(single-source geometry) and `world-screens.spec.js` (modal pre-emption). Those
assertions are invisible to line coverage by design, and deleting them would lose
real protection while moving no number here.

The one thing the table does clearly say: `qa.spec.js` is a genuine single point of
dependence. Two Playwright tests carry `tests/qa_suite.js`, its whole record inventory,
and 158 lines no other spec touches.

A note on cost, because the first draft of this document got it wrong. Instrumented
runs of the full suite took 2.6 minutes and the specs timed individually under that same
instrumentation put `stance-balance.spec.js` at 62s, which read as ~40% of the gate. V8
coverage collection is what most of that was: uninstrumented, the whole suite is **60s**,
and `stance-balance.spec.js` is 13.1s of it — against 12.1s for `qa.spec.js`, 9.5s for
`campaign-persistence.spec.js`, 8.7s for `visual-regression.spec.js` and under 5s for
the rest, each including ~2-3s of server and browser startup. So the slowest spec adds
one unique line for roughly a sixth of the gate, not two fifths. Worth knowing, not
worth acting on.

## Documentation drift found on the way

- `progress.md` states `npm test` passes "54/54". It was 86 tests when this was
  measured, and 89 after the follow-up below (85 of 86 passed here; the one failure is
  the environment's Chromium, see below).
- `tests/README.md` contradicted itself on the record count: line 12 said "all 22
  record names" while line 327 said "The 21 deterministic records". 21 was right —
  `EXPECTED_QA_NAMES` in `qa.spec.js` held 21 entries. `36f9e6a`, the same commit that
  broke the release token, dropped a record and updated only one of the two numbers.
  (An earlier draft of this document repeated the stale 22 as if verified; it was not.)

## Method, and what to distrust in it

- Coverage is Chromium V8 range coverage, captured per test via
  `page.coverage.startJSCoverage({ resetOnNavigation: false })` in a temporary `page`
  fixture, then folded to line level: a line counts as covered if any non-whitespace
  byte of it is in a range with `count > 0`. V8 nesting is respected (a `count: 0`
  child range overrides its covering parent), which is the step that separates a real
  96.6% from the meaningless 100% a naive union produces.
- Denominator excludes blank lines, comment-only lines, and lines that are nothing but
  a closing brace. It is line coverage, so it is *optimistic* about branches: a line
  carrying both a condition and its consequent (`if (x) { ... }` on one line, common in
  this codebase) counts as covered when the condition alone runs. Read the percentages
  as an upper bound.
- The tooling suite was measured separately with `NODE_V8_COVERAGE` and merged.
- All instrumentation was temporary and has been reverted; nothing in this commit
  changes `src/` or `tests/`. `npm run test:tooling` passes 12/12 on the reverted
  tree; `npm run test:release` fails for the pre-existing reason above; `npm test`
  cannot be run to CI's standard here (see the browser caveat below).
- Environment caveat: the Playwright CDN is unreachable from this sandbox, so the
  pinned Chromium build could not be installed and the run used the pre-installed
  Chromium (1194 rather than 1234) via a temporary config. One test failed for that
  reason — `visual-regression.spec.js` "title menu campaign vignette remains visually
  stable", a pixel diff against a baseline rendered by a different browser build. It
  is not evidence of a regression, and it should not be treated as one without a
  re-run on the pinned build.
- Coverage from the 13 favicon-related failures in the first pass was discarded; the
  numbers above come from the second pass, where the favicon 404 was stubbed at the
  fixture and 85 of 86 tests passed.

## Follow-up: findings 1, 2, 4, 5 and 6 now have tests

Written after this analysis, in the same branch: four QA records and five boundary
tests. The QA record inventory goes 21 -> 25, `node --test` goes 12 -> 14, and the
Playwright count goes 86 -> 89 (the four new records live inside `qa.spec.js`'s existing
two tests, so they add coverage without adding Playwright tests).

| finding | test | covers |
| --- | --- | --- |
| 1 | `hero_swing_and_dash_damage_enemies` | swing damage on the aim ray, the arc rejecting an enemy behind it, dash activation, i-frames, trample-once-per-dash |
| 2 | `economy_army_cap_expansion_and_refusals` | `armyCapCost()`, the priced refusal, +2 cap, cost escalation, the raised recruit ceiling, the persisted snapshot, town-only |
| 4 | `world_party_spawn_timer_fills_the_map_to_its_cap` | the 30s arm, the 40s cadence, filling to `partyCap()` and stopping, `persistParties()` |
| 5 | `battle_retreat_hold_disengages` | the 3s gate, held-input-only, release resets the bar, 1.3s completes, return to world |
| 6 | `assertPlatform rejects every host shape the boundary forbids` | both `throw` branches, every missing slot and lifecycle method, and the frozen return |
| 6 | `settings survive both stored shapes and recover from a corrupt blob` | the JSON settings shape and the corrupt-blob recovery |
| 6 | `the web adapter names the failed operation and its semantic slot` | `storageError()` and all three `localStorage` catch clauses |
| 6 | `backgrounding suspends once and returning to the tab resumes once` | the `resume` notification and its de-duplication |
| 6 | `a non-finite campaign coordinate is refused rather than persisted` | `main.js:69-70`, for both a hero and a party coordinate |

Every one of them was mutation-tested — the production line each asserts on was broken
on purpose and the test was confirmed to fail, then restored. That is not ceremony
here: two of these would have passed vacuously without it. The "enemy behind the aim
ray is not hit" case passed at first because the preceding landed hit had set
`battle.freeze`, and `Battle.update()` returns early during hit-stop, so the next
tick's input was dropped and *no swing happened at all*. The intro banner does the same
thing for the first ~1.1s of every battle. Both are now documented in
`tests/README.md` and asserted explicitly rather than assumed.

Re-measured the same way afterwards: **97.9% (4550/4648)**, up from 96.6%, with the
unexecuted count down from 158 lines to 98. Four files went to 100% — `battle/ai-phases.js`,
`persistence/save-repository.js`, `platform/platform-contract.js` and
`platform/web-platform.js`, the last three being the whole platform boundary that was
previously the least covered code in the repository. `world.js` went 95.5 -> 97.7 and
`battle/hud.js` 94.3 -> 97.5.

What is left, for whoever picks this up next: the stronghold gating and remnant
absorption (`world/settlement-interactions.js:115-123,138-139`), the pause overlay and
the two crash-recovery handlers (`main.js:298-311,551-553,572-574`), the `mousemove`
coordinate mapping and the floating-text particle (`engine.js:74-77,183,234-238`),
finding 3's markers (`world/render-scene.js:309-314` and `world.js:364,397-400`), the
spatial obstacle-push and collect-all paths (`battle/separation.js:46-48`,
`battle/spatial-index.js:52-53`), and the projectile MISS branch
(`battle/combat.js:40-41`).

Finding 3 is deliberately left: the occupied/threatened markers need a new visual
baseline, and a baseline generated in this sandbox would be wrong — the pinned Chromium
is unavailable here, which is exactly what makes the existing menu-vignette snapshot
fail. That one wants a run on CI's browser.

Verification: `npm run test:tooling` 14/14, and 88 of 89 Playwright tests on the
substitute Chromium — the single failure being the pre-existing menu-vignette pixel
diff, which is the browser mismatch described in the method section and not one of
these tests. One further caveat, which is also not about the new tests. The
favicon 404 described above fails 13 unrelated tests on this browser build, so the full
run was done with a `favicon.ico` present in the repo root. That file is **not**
committed, and it is a candidate fix worth considering on its own: a root `favicon.ico`
removes the 404 for players and for every future browser build, without touching
`index.html` and therefore without moving the release token.
