# Codebase audit — 2026-08-20

> **Status:** findings #2, #4, #5 and #7 are fixed (see "Resolved" at the bottom), along with
> a release-cache integrity bug found while fixing them. #1, #3, #6, #8, #9, #10 are open.

Scope: `src/` (5,940 LOC), `tests/` (~2,800), `scripts/`. Four parallel Sonnet auditors
(dead code, SOLID, DRY, file length). Every finding below was spot-checked against the
source; claims that did not survive verification are not listed.

## Headline

The codebase is in better shape than the file sizes suggest. There is essentially **no
dead code** (27 LOC total), no committed build artifacts, no hidden global state, and the
platform/persistence/RNG boundaries described in AGENTS.md are actually honored rather
than aspirational. The two real problems are **two 1,850-LOC scene files** and a cluster
of **duplicated game-balance judgments** in the newest code (Plan 021's `world-screens.js`),
which never wired into the shared helpers the rest of `src/` uses.

Ranked by what will actually cost time on the next feature:

| # | Finding | Where | Effort |
|---|---------|-------|--------|
| 1 | `World.updateParties` — 199-LOC god function; every AI plan bolts another branch on | `world.js:1102-1300` | M |
| 2 | Odds threshold (`1.15`/`0.85`) + wording duplicated in 4 places, no test ties them | `world.js:1713`, `world.js:1819`, `world-screens.js:106`, `world-screens.js:183` | S |
| 3 | `battle.js` 1898 LOC / `world.js` 1847 LOC — split plan below | — | L |
| 4 | `rollComp` vs `rollGarrison`: same weighted roll, independently tuned thresholds | `world.js:499-511` vs `609-626` | S |
| 5 | `world-screens.js` bypasses `PAL` (18 hardcoded hex literals) and `clamp` | `world-screens.js:158-339` | S |
| 6 | Label dicts hand-copied in parallel to `data.js`'s own `.name` fields | `data.js:60-95`, `battle.js:14`, `world-screens.js:10-13` | S |
| 7 | Army-cap upgrade cost formula duplicated between charge site and HUD string | `world.js:981` and `world.js:1811` | XS |
| 8 | E2E boot/`assertNoRuntimeErrors` boilerplate re-implemented in 6+ specs | `tests/e2e/*.spec.js`; `test-helpers.js` is 10 LOC | S |
| 9 | 4 near-identical circle-repulsion routines | `battle.js:968-1004` | S |
| 10 | `startBattle`'s 120-LOC inline `onEnd` outcome closure | `world.js:710-828` | M |

## Dead code — 27 LOC

Confirmed dead, safe to delete: **`scripts/crop_tmp.py`** (27 LOC). Zero references
repo-wide; hardcodes crop boxes against `shots/p4v24_*.png` files that no longer exist.

Cosmetic: `migrateSave` (`save.js:238`) is exported but only called internally — drop the
`export`. `engine.js:72` stores `unsubscribeDeactivate` that is never invoked (singletons
have no teardown path); `platform.lifecycle.onResume` is contract-only with no production
consumer — both are intentional-looking loose ends, not cruft. Leave them.

Explicitly checked clean: every `export` in `src/` has a real importer; every `ACTIONS`
key, `UNIT_TYPES`/`ENEMY_TYPES`/`WORLD`/`BALANCE` field has a consumer; no `if(false)`
guards or debug leftovers (the only `console.*` are real error-recovery paths in
`main.js`); `git status --ignored` shows nothing tracked that should be ignored.
`updateLegacySeparation` looks like a legacy path but is the documented, tested
small-battle branch — keep it.

## SOLID

**SRP.** `Battle`'s phase split (`updateHeroPhase`/`updateTroopPhase`/`updateEnemyPhase`/…)
is a genuinely good decomposition. `World` has the same structure on paper but
`updateParties` is 4x every sibling phase — it is mood FSM + interception math + nav
caching + obstacle steering + river collision + stuck recovery + battle trigger in one
function. That is finding #1 and the only true god function in the repo.

The other long functions are all *rendering* (`drawHud` 207, `draw` 179/133, `figure` 129,
`drawProps` 111, `drawSettlement` 99). Canvas 2D is verbose per-shape; splitting `figure()`
into ten 12-line helpers buys nothing. Low priority — move them for file size (below),
not for SRP.

**OCP.** Type-branch chains exist (`e.type === 'wolf'` at `battle.js:777`, the brute/wolf
draw switch at `1605`, the `killedBy` map at `442`). With a stable 3+4 roster and AGENTS.md
treating new unit types as a design-review event, a handler-map table is over-engineering.
**Leave as-is.** The real OCP cost is #4, the duplicated composition roller — that is a
silent balance-divergence risk, not a hypothetical.

**LSP.** No inheritance, so this reduces to structural consistency. Real issue: roaming-party
objects are hand-constructed in four places (`world.js:162`, `world.js:529`, `save.js:114`,
`main.js:707/730`) with no shared factory, and only `save.js` validates. The party shape has
gained a field per plan (`waryT`, `clashT`, `occupying`, `_navGoalVisibility`) — a missed
literal produces a subtly wrong party that fails downstream, not at construction.

**ISP.** Nothing to report. Imports are narrow named exports throughout.

**DIP.** Strong. `localStorage` appears only in `platform/web-platform.js`; everything goes
through `SaveRepository`/`platform.storage`/`platform.lifecycle`. The one leak is
`battle.js:229` — the constructor calls `document.createElement('canvas')` to bake a static
prop layer, so `Battle` cannot be built without a DOM. That is a deliberate perf trade and
all tests run in real Chromium anyway. **Flag, don't chase.**

Simulation calling into `sfx`/`camera`/`particles` is pervasive but is the opposite
direction from the leak AGENTS.md warns about, and is normal for this genre. Not a finding.

## Files worth splitting

Both big files expose exactly `update(dt)` and `draw(ctx)` externally (`main.js:251,269`),
and no test imports them directly — tests go through `window.game`/`window.__g`. So internal
methods can become exported functions taking the instance as first arg
(`updateTroopPhase(this, dt, h)`), matching the convention `battle/spatial-index.js` and
`persistence/save-repository.js` already establish: `src/<domain>/` directory, composition,
explicit dependencies, no mixins.

`src/battle.js` → `battle/constants.js` (~55), `battle/combat.js` (~220),
`battle/ai-phases.js` (~276), `battle/separation.js` (~106), `battle/render-units.js` (~308),
`battle/render-scene.js` (~333), `battle/hud.js` (~207); core drops to ~400.

`src/world.js` → `world/terrain.js` (~294), `world/party-economy.js` (~162),
`world/settlement-interactions.js` (~152), `world/battle-transition.js` (~248),
`world/render-scene.js` (~319), `world/render-actors.js` (~191); core drops to ~470.

Extracting constants **first** is what prevents an import cycle: without it, `ai-phases.js`
needs `BRACE_SPEED` from `battle.js` while `battle.js` needs `updateTroopPhase` back. With
no bundler that cycle is a real hazard.

**Sequence** (cheapest/safest first):

1. `battle/render-units.js` + `render-scene.js` + `hud.js` + `constants.js` → 1898 → ~1170. Verify `npm run test:visual`, `npm run test:qa`, `npm test`.
2. `world/render-scene.js` + `render-actors.js` → 1847 → ~1350. Verify `npm run test:visual`, `npm test`.
3. `battle/separation.js` → verify `npm run test:perf`.
4. `battle/combat.js` + `ai-phases.js` → verify `stance-balance.spec.js`, `test:qa`.
5. `world/terrain.js`, `party-economy.js`, `settlement-interactions.js`.
6. `world/battle-transition.js` **last and alone** — this is Plan 021's modal machinery with
   the most AGENTS.md invariants (descriptor deferral, `persistRun()` ordering,
   occupied-settlement clearing, `pendingAftermath`). Re-verify that section line by line.

After every step: `npm run release:cache` → review diff → `npm run test:release` → `npm test`.
The `?v=<hash>` import token is a forcing function here, not a landmine — CI fails loudly on
a stale token before Playwright even runs. New files must live under `src/`, be referenced
relatively, and end in `.js` (`check-release-cache.mjs` enforces this).

**Stop point:** steps 1-3 alone take battle.js to ~950 and world.js to ~1350 at near-zero
behavioral risk. If the game is near feature-complete, stopping there is defensible.

Files that are **fine as-is**: `main.js` (779), `engine.js` (485), `world-screens.js` (362),
`save.js` (256), all e2e specs (Playwright isolates by file), `scripts/build_progress.py`.
`tests/qa_suite.js` (814) should *not* be split casually — AGENTS.md pins it to 22 named
legacy records.

## What was checked and found not to be a problem

`roundedPath` vs `rrect` (different needs: cached Path2D vs immediate draw). `save.js` vs
`persistence/save-repository.js` (repository correctly delegates all validation to
`parseSave` — no duplication). World obstacle-nudge vs battle separation math (frame-scaled
steering vs instant positional resolution — superficial similarity only). RNG domain
separation, palette freezing, and the `window.__g` test API are all clean and deliberate.

## Suggested order of work

Do #2, #4, #5, #7 in one small commit — they are ~1 hour total, all in the newest code, and
each is a live divergence risk with no test pinning the copies together. Then #8 (mechanical,
test-only). Then split steps 1-3. Leave #1 and #10 until the next AI/outcome feature actually
touches them — refactoring them speculatively risks the AGENTS.md ordering guarantees for no
present gain.

---

## Resolved — 2026-08-20

### Release-cache integrity bug (found while fixing #5, not in the original audit)

`src/world-screens.js` was **invisible to `scripts/check-release-cache.mjs`**. `world.js`
imports it with a multi-line `import {
 … 
} from './world-screens.js'`, and
`FROM_IMPORT_RE` used `[^;
]*?` for the gap before `from` — a pattern that cannot span
newlines. Consequences: the file's content was never hashed, so **editing it did not bump
the release token** (defeating Plan 012's cache-busting guarantee for the entire Plan 021
UI layer), and its own three import refs were never validated, which is why they sat on a
stale `r4873a112c73f` while the rest of the graph was on `rcba1d144dd28` — and
`test:release` passed anyway.

Fix: the gap now excludes `;` (what actually bounds an import statement) rather than `
`.
The graph went from **11 modules / 21 refs to 12 modules / 25 refs**, and the token moved to
`r3129cfc38fd8`. Any future multi-line import is now covered too.

### #2 — one odds vocabulary

`data.js` gains `ODDS_WORDS` + `oddsWord(enemyStr, mine)`, with the bands as
`BALANCE.oddsStronger` / `BALANCE.oddsFavored`. All four sites call it: the party pill and
its badge colour (`world.js` drawParty — `stronger` is now derived from the word, not a
second threshold), the camp prompt (`world.js` drawHud), and the hover panel and pre-battle
brief (`world-screens.js`). The brief's outmatched colouring compares against
`ODDS_WORDS.outmatched` instead of re-typing the string.

### #4 — one composition roller

`data.js` gains `rollComposition(target, R, weights, bruteCap)`; the two weight tables sit
side by side in `BALANCE.compRolls` (`party` / `garrison`). `World.rollComp` and
`World.rollGarrison` are now one line each and keep their own distinct weights and brute
cap — the numbers are unchanged, they are just visible together.

Verified bit-identical: 160,000 comparisons (4,000 seeds × 8 targets × party + 4 brute
caps) against verbatim copies of the pre-refactor loops, zero mismatches. Both loops drew
exactly one `R()` per body, so seeded determinism is preserved.

### #5 — `world-screens.js` uses the shared palette and clamp

All 18 hardcoded hex literals replaced with `P.cream` / `P.ink` / `P.hero` / `P.enemy` /
`P.good` via `const P = PAL.world`. `PAL.world` gains `good: '#7CE06B'` for the victory
headline (the same green as the battle HP bar, now named for the world scene rather than
borrowed from `PAL.battle.hp`). The hover panel's inline `Math.max/Math.min` nesting now
uses the imported `clamp`; the upper bound is wrapped in `Math.max(6, …)` so a panel wider
than the viewport still pins to the left/top edge exactly as before.

Also swept the strays: `main.js` ×2 and `world.js:1515` now use the palette token, and
`battle.js`'s `shade(P.cream.startsWith('#') ? P.cream : '#F2E3C1', 0.8)` drops an
always-true guard. **Left alone deliberately:** the three `rgba(…)` dim-backdrop literals
(converting them needs a hex→rgba helper, which is a real change rather than a cleanup)
and `battle.js:1484`'s `opts.tip || '#F2E3C1'` — that fallback is the *world* cream inside
the battle scene, so pointing it at `P.cream` (`#EFE6CE`) would shift pixels.

### #7 — one army-cap price

`World.armyCapCost()` reads `BALANCE.armyCapCostBase` / `armyCapCostStep`; the charge site
and the town prompt's price tag both call it, so the displayed price is the price paid.

### Verification

`npm run test:tooling` 7/7, `npx playwright test` **76/76**, `node scripts/check-release-cache.mjs`
verified at `r3129cfc38fd8`. The 10 visual-regression snapshots (world overview, both briefs,
victory/defeat aftermath, three battle compositions) passing is the load-bearing evidence
that the palette-token substitution is pixel-identical; `stance-balance.spec.js` and
`campaign-persistence.spec.js` cover the seeded-composition refactor.
