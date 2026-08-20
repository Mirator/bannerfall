# Plan 022: Split the two scene god-files into `src/battle/` and `src/world/`

> Written as a record, not a forward plan: this was executed in one pass from
> audit finding #3 in `critiques/codebase-audit-2026-08-20.md`. Kept in `plans/`
> because it is a structural change to the two largest files in the repo and the
> next executor needs to know what the new seams are and why they exist.

## Status

- **Priority**: Medium (maintainability, no player-facing change)
- **Effort**: L
- **Risk**: MEDIUM — mechanical moves, but the world→battle transition carries
  the Plan 021 invariants
- **Depends on**: Plans 001-021 (DONE)
- **Category**: architecture / maintainability
- **Planned at**: commit `97a7bf1`, 2026-08-20
- **Status**: DONE

## Why this mattered

`src/battle.js` (1898 LOC) and `src/world.js` (1847 LOC) were each roughly 10x
the size of every module that had already been extracted (`battle/spatial-index.js`,
`persistence/save-repository.js`, `platform/*`). Both mixed construction,
simulation, AI, and three kinds of rendering in one class, so every plan since 019
had to thread its change through a file no one could hold in their head.

## What changed

| File | Before | After |
|------|--------|-------|
| `src/battle.js` | 1898 | 584 |
| `src/world.js` | 1847 | 828 |

New modules — `battle/{constants,combat,ai-phases,separation,render-units,render-scene,hud}.js`
and `world/{terrain,settlement-interactions,battle-transition,render-scene,render-actors}.js`.

Extracted functions take the scene instance as their first argument
(`drawScene(world, ctx)`), matching the composition style `spatial-index.js` and
`save-repository.js` already used. No prototype mixins, no new cross-phase context
object (AGENTS.md requires a design review for that, and none was needed).

## The two rules that made it safe

1. **`constants.js` first, depending on nothing but `data.js`.** Without it,
   `ai-phases.js` would need `BRACE_SPEED` from `battle.js` while `battle.js`
   needed `updateTroopPhase` back — a genuine import cycle, and there is no
   bundler to hide one.

2. **Anything reachable from outside stays an instance method that delegates.**
   `world-battle-seams.spec.js` patches the ordered phases *by name* to assert
   their sequence; `performance.spec.js` calls `updateSeparationPhase` and
   `getSpatialStats` off the instance; the campaign suites call `endBattle` and
   `damageEnemy`. Replacing a delegator with a direct module call would silently
   disable those assertions rather than fail them.

## Where this deviates from the audit's proposed grouping

The audit proposed a `world/party-economy.js` and a wider `world/terrain.js`. Both
were trimmed after measuring the actual call graph:

- **Party economy was not extracted.** Its 15 methods have 18 inbound call sites
  and most are one-liners (`strength`, `myStrength`, `liveCamps`, `partyCap`,
  `armyCapCost`). Moving them would have cost ~13 delegators to relocate ~113
  lines — more forwarding boilerplate than body, plus an extra hop on paths the
  party AI runs every tick.
- **Terrain kept its hot predicates.** `buildTerrainGeometry`, `buildStaticPaths`,
  `buildScenery`, `linesToSegments`, `lineClear` and `pathGoal` moved (the
  construction and navigation work). `blockedAt`, `onRoad`, `riverBlockedAt`,
  `inSafeZone`, `visible`, `moveBlocked` and `riverDistanceAt` stayed: they run for
  every unit every frame and are 3-7 lines each.
- **`battle/combat.js` is narrower than proposed.** It holds damage, arrow
  spawning and result resolution. The targeting/stance/command helpers
  (`nearest*`, `slotPos`, `assignSlots`, `issueCommand`, `cycleSquad`,
  `aggregateStance`, `squadStance`, `mannedSquads`) stayed in the core for the same
  delegator-overhead reason.

The general rule applied: extract a cluster when the body moved substantially
exceeds the forwarding it costs. `updateParties` (198 LOC, audit finding #1) and
`startBattle`'s outcome closure (finding #10) were left alone — both are open
findings about internal structure, not file placement, and are better done by
whoever next changes that behaviour.

## Verification

`npm run test:tooling` 12/12, `npx playwright test` 76/76 (including all 10 canvas
snapshots), `npm run test:release` clean. Run after every step, not just at the end;
the release token must be refreshed with `npm run release:cache` on each move
because the module graph itself changes.

## What to watch when extending this

- A new file under `src/` only joins the release graph once something imports it —
  and it must be imported with a relative path ending in `.js`. `test:release`
  fails loudly otherwise.
- Extracted functions must never reference bare `this`. One call site
  (`hoverTargetAt(this, ...)` in the world draw path) survived the mechanical
  rewrite of `this.` and threw at runtime; the world-hover suite caught it.
- Keep the "delegating seams" block at the end of each scene class contiguous and
  commented, so the next reader can see the whole public surface in one place.
