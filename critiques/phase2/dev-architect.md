# Bannerfall — Development Architect Review

Reviewer: Development Architect (code architecture, correctness, performance, extensibility)
Scope: index.html, src/main.js, src/engine.js, src/data.js, src/battle.js, src/world.js (~2400 LOC)

## Scorecard

| Dimension       | Score | Justification |
|-----------------|:-----:|----------------|
| Structure       | 5/10  | Clean top-level module split (engine/data/battle/world/main), but `Battle.update`/`draw` (~300 lines each) and `World.update`/`draw` fuse input, AI, physics, persistence and rendering with no layering — every new feature means editing the same giant functions. |
| Correctness     | 6/10  | No runtime errors observed even under 300v300 stress; RNG and input edge-triggering are sound in isolation. Docked for a stale hero-position save field, a World RNG that silently reseeds every map re-entry, and a fixed-timestep loop with no recovery path once sim cost exceeds its catch-up budget. |
| Performance     | 7/10  | Comfortably fast at the game's actual designed scale (≤40v40): ~1.2ms average sim step. Scales quadratically as expected and the ceiling is measurable and predictable, not scary — but there's zero mitigation (spatial hashing, broad-phase) if unit counts ever grow, and periodic multi-hundred-ms spikes appear even at moderate stress. |
| Extensibility   | 5/10  | Data tables (`UNIT_TYPES`/`ENEMY_TYPES`/`BALANCE`) make numeric tuning and even a same-shaped new unit fairly cheap. Everything else — arenas, persistence, multi-battle scenarios — runs into hardcoded string-keyed if/else chains or missing infrastructure (no save system exists at all). |

## Stress-test numbers (this session, tabId tab-2, http://localhost:8474)

Built via `window.__g.startBattle(...)` with matched troop/enemy counts (mixed spear/bandit/brute), then measured wall-clock time of `window.game.step(1/60)` (one fixed-timestep tick + one `draw()` call) over 200–300 samples after 80 warm-up steps.

| Total units (troops+enemies) | avg ms/step | p50 | p95 | max |
|---|---|---|---|---|
| 80 (40v40 — the requested case) | 1.22 | 0.60 | 6.90 | 10.1 |
| 120 (60v60) | 2.88 | 1.10 | 6.20 | 226.9 |
| 200 | 3.67 | 2.0 | 6.80 | 201.1 |
| 300 | 4.66 | 3.5 | 8.40 | 66.3 |
| 400 | 8.03 | 5.7 | 10.9 | 231.5 |
| **600** | **16.7** | **11.6** | **19.9** | **271.0** |

Findings:
- At the requested 80-unit stress case, sim cost is trivial (~1.2ms avg, well under the 16.6ms/frame budget) — the "40 vs 40" ambush/siege scenario the game actually ships with is nowhere near the performance ceiling.
- Average cost crosses the 60fps frame budget (16.6ms) between roughly 400 and 600 total units — consistent with the O(n²) separation loop plus the O(n) `nearestEnemy`/`nearestFriendly` scans called per-unit-per-frame (effectively O(n²) again). This matches expectations for the naive all-pairs approach in battle.js.
- Outlier spikes (200–270ms, i.e. multiple whole seconds' worth of frame budget) appear even at only 120–400 units, well before the average crosses budget. These look like GC pauses from per-frame allocation (`Particles.add` does `Object.assign({t:0}, p)` per particle; `draws` array and per-unit temp objects are rebuilt every frame in `Battle.draw`/`update`). A single 270ms stall is a visible, felt hitch even if the average frame rate looks fine.
- Console: zero errors at any tested scale (40v40 through 300v300), including after battles ran to natural conclusion or were left mid-fight.

## Top 5 ranked technical risks

**1. O(n²) target-search + separation cost has no mitigation, and the game's own design (bigger sieges, "Bannerlord-grade campaign") is the thing most likely to demand more units.**
`src/battle.js:172-187` (`nearestEnemy`/`nearestFriendly`, called once per troop and once per enemy every frame → O(n²)) and `src/battle.js:489-518` (explicit all-pairs separation loop, also O(n²)). Fine today (40v40 measured at 1.2ms), but the moment the campaign wants a 60-vs-60 siege set-piece — a very natural "double the features" ask for a Bannerlord-grade bar — the frame budget is gone (measured 16.7ms avg at 600 units) with no spatial partitioning to fall back on.
*Remedy: grid/spatial-hash for neighbor queries before scaling unit counts up; the current code has no seam to add one without touching every call site.*

**2. Fixed-timestep loop has no recovery once sim cost exceeds its catch-up allowance — it degrades to permanent slow motion, silently.**
`src/main.js:150-158`: `while (acc >= DT && n++ < 5) { game.update(DT); acc -= DT; }` caps catch-up at 5 sub-steps (~83ms) per rendered frame but never discards excess `acc`. If real per-frame cost (sim + draw + browser overhead) sustains above ~83ms — plausible during the 200-270ms GC spikes measured above, or in any future larger battle — `acc` grows monotonically and is never reclaimed. The game doesn't crash or visibly "spiral," it just falls further behind wall-clock time forever with no telemetry surfacing it. Combined with risk #1, a big future battle is exactly the scenario that triggers this.
*Remedy: clamp/discard stale accumulator past a threshold (accept a hitch instead of permanent drift), and log/instrument when the cap is hit.*

**3. `World`'s RNG stream is reseeded to the same seed (777) every time a `World` is reconstructed, undermining the appearance of randomness across a play session.**
`src/world.js:10`: `this.rng = makeRng(777);` runs unconditionally in the constructor, and `game.startWorld(save)` constructs a brand-new `World` after every single battle (`src/world.js:200`, `src/main.js:29-34`). Because `this.rng` (not the scenery-only `buildScenery` RNG) drives party wander-target picks, dust-particle timing, and camp resupply rolls (`world.js:117,223,254-256,332-333`), the exact same pseudo-random sequence starts replaying from index 0 every time the player returns from a fight. Persisted state (`save.parties`, `save.camps`) hides the worst of it, but any "randomness" that fires soon after a battle — the first wander decision, the first camp respawn roll — will be identical run to run. This is a correctness/design smell, not a crash, but it directly contradicts a claimed "seed/RNG determinism" design goal being read as "believable variety": the RNG isn't part of the save, so it isn't actually continuous campaign state.
*Remedy: persist RNG state (or at least a running seed/counter) in `save`, or keep one `World.rng` instance alive across battle transitions instead of rebuilding `World` from scratch.*

**4. The shared mutable module-level palette (`Object.assign(P, ...)`) is a global-state landmine for any multi-scene or concurrent-rendering feature.**
`src/battle.js:5-6,19`: `const P = PAL.battle` aliases the *same object* every `Battle` instance mutates in place via `Object.assign(P, BASE, BIOMES[biome])`. This works only because the engine guarantees exactly one active scene at a time. It is the single piece of code most likely to break the moment the game "doubles in features" toward anything Bannerlord asks for by nature (minimap battle preview, simultaneous skirmishes, replay/spectator mode, or even just a paused "peek at the next fight" UI) — any second live reference to battle colors will silently corrupt the first. It's also fragile today: nothing stops a future contributor from capturing `PAL.battle` by reference elsewhere and being surprised it mutates.
*Remedy: make `P` per-instance (computed biome palette stored on `this.pal` in the constructor, passed to draw helpers) instead of a module-level singleton.*

**5. There is no persistence layer at all, and the one piece of state that would need it (hero position) is only synced at battle boundaries.**
Confirmed zero `localStorage`/`JSON.stringify` usage anywhere in `src/`. Campaign progress lives purely in the in-memory `save` object and is lost on refresh — acceptable for a jam-scale build, but the panel is judging against a "Bannerlord-grade campaign" bar, where session persistence is table stakes. Worse, `save.x`/`save.y` (`src/world.js:175`) is only written inside `startBattle()`, not continuously during `World.update()` — so a naive "autosave every N seconds" feature (the obvious first fix) would persist a stale hero position and rubberband the player back to their last fight's location on reload.
*Remedy: sync `save.x/save.y` every frame (or on interval) before adding any save/load feature, not after.*

## What is genuinely well-built

- **Deterministic RNG (mulberry32) and the headless test API** (`window.__g`, `window.game.step/tap/click/scenario`, `src/main.js:171-242`) are a real asset — this is a thoughtful, self-contained test harness that lets exactly this kind of automated stress review happen without a human clicking through a browser. Rare to see in a zero-dependency jam project.
- **Fixed-timestep decoupling from rendering** is the right call for gameplay determinism, and the watchdog `setInterval` fallback for throttled/background tabs is a pragmatic touch (modulo risk #2 above).
- **Data-driven unit/enemy definitions** (`data.js` `UNIT_TYPES`/`ENEMY_TYPES`/`BALANCE`) cleanly separate tuning numbers from logic — adding a new unit's stats, or rebalancing the whole game, doesn't require touching simulation code.
- **The camera "fit-to-action" auto-zoom** (`Battle.updateCamera`) and the **attack-telegraph system** (`windup` field driving both AI timing and the flashing "!" bubble / danger-zone rendering) show real design-code integration — the Thronefall-style readability goal is achieved through data (not one-off hacks), which is exactly the pattern that scales.
- **Reusable flat-shaded drawing primitives** (`shadow`, `tree`, `rock`, `mountain`, `rrect`, `balloon` in engine.js) are shared cleanly between `battle.js` and `world.js`, keeping the "zero dependency, consistent art style" promise without duplicating drawing code.
