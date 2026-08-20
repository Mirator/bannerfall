# Plan 023: The world map is alive only while you ride

## Status

- **Priority**: P0 (core world-map mechanic)
- **Effort**: M
- **Risk**: MEDIUM-HIGH — touches the ordered `World.update()` pipeline; broke 7
  existing specs across 5 files plus 2 legacy QA records, all listed below
- **Depends on**: Plans 001-022 (DONE)
- **Category**: gameplay / world simulation
- **Planned at**: commit `1560fd7`, 2026-08-20
- **Status**: DONE

## Why this mattered

The campaign map simulated continuously: parties chased, camps ticked down spawn timers,
raids advanced and the ambient clock animated rivers and windmills whether or not the
player was doing anything. Idling was dead time you were punished for.

Now the map behaves like a held breath — **when the hero is not moving, time is stale.**
Stopping becomes a deliberate tactical pause: you stop to read the board, and the board
stops with you.

Three product decisions were settled up front and are not open questions:

1. **Freeze scope: everything, visuals included.** Parties, every timer, particles, the
   camera, and the ambient presentation clock `world.time`.
2. **Stop trigger: realized hero speed, with coast-down.** The world stays alive through
   the hero's momentum. The hero must never freeze mid-slide.
3. **Feedback: a subtle visual cue** — light desaturation plus vignette, fading in over
   ~0.3 s.

## What was built

**`src/data.js`** — three `BALANCE` constants. `worldWakeSpeed: 40` is deliberately the
same 40 px/s that already gated bob, dust and the gallop SFX, so one number decides "is
the horse moving" for both presentation and the campaign clock and they cannot drift
apart. `worldFreezeFadeInT: 0.30` / `worldFreezeFadeOutT: 0.12` — asymmetric on purpose:
the cue creeps in, but resuming a ride must feel instant.

**`src/world.js`**

- `timeFlowing()` / `isTimeFrozen()` — one-liner predicates beside `isBlocking()`.
- `updateHeroMovement()` publishes `this.heroSpeed` at the END of the phase: post-clamp,
  post-coast-damp. Deliberately NOT the pre-clamp `sp`, which is a candidate speed that
  lags a tick on coast; `sp` keeps owning bob/dust/SFX timing so their feel is unchanged.
  It also snaps velocity to an exact zero below 8 px/s — the damping is asymptotic, so
  without that the hero creeps sub-pixel forever, `heroSpeed` never reaches 0, and the
  4 s autosave rewrites a slightly different `hero.x` during what the player sees as a
  held still frame. 8 px/s (a fifth of `worldWakeSpeed`) rather than ~0 so the frame
  settles in ~0.3 s instead of ~1 s.
- `updateWorldClock(dt)` — new phase owning `time`, `msgT` and `staleT`. **The single
  exception to no-`dt`-while-frozen**: `staleT` is the cue explaining the freeze, so it
  must advance on exactly the ticks when nothing else does.
- `tryClash(p, dh, engaged)` — the encounter seam, extracted verbatim so the live and
  frozen paths share exactly one copy of the rule that starts a fight.
- `updateParties(dt, frozen = false)` — `frozen` runs `tryClash` and nothing else. The
  default is load-bearing: `tests/qa_suite.js` calls this method directly off the instance.
- `clampCamera()` — split out of `updateCameraAndEffects` so `main.js`'s `resize()` can
  repair the map-edge clamp during a freeze, when camera follow is not running.
- Rewritten `update()`; `this.time += dt` moved BELOW the modal gate, so an open brief now
  freezes the ambient clock too — which is what "a modal genuinely pauses the campaign"
  always implied.

**`src/world/render-scene.js`** — `drawFreezeCue()`. Two full-viewport `fillRect`s (a
`'saturation'` wash at `0.28 * staleT`, then a cached radial vignette at `staleT`), drawn
over the map and particles but under the cloud vignette, HUD, hover panel and any modal.
No `beginPath`, so it costs nothing against the structural Canvas budget.

**`src/main.js`** — `state().world` gains `time`, `speed`, `flowing`; `stats.playT` gates
on `isBlocking() || isTimeFrozen()`; `resize()` calls `clampCamera()`; and
`window.game.keepAwake()` is exposed as a test-API seam (see below).

## What runs while frozen, and why

| Phase | Frozen | Why |
|---|---|---|
| `updateWorldScreens` | runs (pre-empts) | Modal must stay usable; a clash always leaves you stopped |
| `updateHeroMovement` | **runs** | Owns the coast-down that DECIDES the freeze |
| `updateWorldClock` | **runs** | The single `dt` exception — advances the cue |
| `updateSettlementInteractions` | **runs** | No `dt`; standing still is how you recruit, heal and scout |
| `updateCampInteraction` | **runs** | No `dt`; `KeyE` at a camp must work stopped |
| victory check | **runs** | `save.won` is set during the battle, so the returning World's first tick is always frozen — gating it hangs a won campaign |
| `enforceBeatableFloor` | skipped | Consumes `simRng`, can spawn a visible party |
| `updateParties` | **reduced** | `tryClash` only — no timers, AI, movement or `grace` |
| `updatePartySpawns` | skipped | `spawnT` must hold |
| `updateCameraAndEffects` | skipped | Camera and particles are part of the freeze-frame |

## Deliberate consequences

- **A stopped hero is untouchable by a party that has not yet closed.** This is the
  mechanic, not an oversight: it is symmetric (you cannot reach them either) and
  self-limiting (razing camps, recruiting and reaching Wolfsjaw all require riding). The
  clash exemption is the ONLY guard. Do not add a proximity softener — it would void the
  core promise. If playtesting says the exploit is too strong, the lever is a future
  "stopping in the open invites an ambush" mechanic, not a hedge on this gate.
- **A frozen tick consumes zero `simRng`/`fxRng` draws.** Campaign randomness is now
  independent of how long the player stood still — a determinism win, and the decisive
  argument against the tempting "pass `dt = 0` to every phase" alternative, which would
  preserve call order but still burn RNG in the wander re-pick and could spawn a party out
  of `enforceBeatableFloor`.
- **Initiative is whatever the last live tick decided.** `p.mood` (ambush vs
  run-them-down vs mutual) is computed in the skipped AI section. Correct in play, because
  a real clash always happens while riding or coasting — but it means a fixture that
  injects a party onto a never-moved hero needs one awake tick (see `keepAwake` below).
- Stopping after a battle **banks** your `grace` ambush immunity. Desirable.
- A toast fired the instant before you stop is pinned until you move. Intended.
- The camera settles ≤8 px off-centre in the direction of travel (the residual coast that
  the frozen `cam.follow` no longer tracks). Non-accumulating.
- `stats.playT` becomes "time ridden" rather than "time played". Accepted: under this
  mechanic any definition drifts, and matching the existing modal rule keeps one rule
  instead of two. The autosave is deliberately not gated.

## Testing

`window.game.keepAwake(on)` is the new test-API seam: a treadmill that makes the movement
phase report a riding speed without travelling, so `hero.vx/vy` stay 0 and `hero.x/y`
never move. Scoped to the current scene instance, so re-apply after any `scenario()`.
Fixtures that deliberately park the hero use it; fixtures where the movement phase is
itself the subject hold a real input instead.

Existing coverage updated:

| Spec | Change |
|---|---|
| `world-battle-seams.spec.js` | Test 1 now rides for real before wrapping (the movement phase is in the asserted order); `updateWorldClock` added to all three tests; the modal test also asserts the ambient clock froze. **New third test** pins the frozen phase list — the freeze contract in one line. |
| `world-screens.spec.js` | Two fixtures take `keepAwake` (a hand-built party needing initiative; the post-dismissal `grace` decay, which now has two freezes stacked on it). |
| `input-actions.spec.js` | Withdraw fixture takes `keepAwake`. |
| `performance.spec.js` | Replan-staggering test takes `keepAwake` — all counts unchanged. |
| `qa_suite.js` | `world_grace_timer_active_after_battle_then_decays` and `world_no_party_freezes_at_rivers` take `keepAwake` (both park the hero on purpose). |
| `visual-regression.spec.js` | `world-bridge` fixture `steps` 0.25 → 0.5 so `staleT` has settled, making the baseline insensitive to the fade constant. |
| `world_brief` / `world_aftermath` scenarios | Apply `keepAwake` internally for their single setup tick, so every consumer keeps working unchanged. |

New `tests/e2e/world-freeze.spec.js` — nine tests: every clock holds; zero RNG consumed;
riding revives the world and the coast keeps it alive past the key release; the cue fades
in and clears; an in-range clash still resolves frozen; a distant party cannot reach a
stopped hero (the untouchable property, asserted so it cannot be quietly undone); town
and camp interaction still work frozen; `playT` does not accrue; a modal freezes the
ambient clock.

Two baselines re-captured, `world-overview.png` and `world-bridge.png`. Every changed
pixel was inspected and traces to one of three intended causes: the cue itself, ambient
animation held at phase ~0 (windmill vanes, river dashes, tree sway, banner wave), and
parties not having moved. `world-brief-*`, `world-aftermath-*`, `menu-*` and all
`battle-*` baselines were confirmed unchanged.

## Where this deviates from the plan as written

- **`staleT` was pulled back out of `state()`.** It accumulates every frozen tick, so
  exposing it made `state()` sensitive to elapsed frames and broke `world-hover.spec.js`'s
  byte-identical comparison between a hovered and an un-hovered read. It stays a
  presentation value read off `__g.scene`, alongside `grace`, `spawnT` and `msgT`.
- **The cue was toned down after inspecting the rendered frame.** At the first values
  (0.55 wash / 0.85 vignette) 33% of pixels changed: the ground went brown-grey, corners
  near-black, and the red "they outmatch you" pill and party marker lost their colour
  coding. Retuned to 0.28 / 0.34, which reads as "held" while leaving gameplay-critical
  colour intact — 2% of pixels.
- **The velocity snap threshold went from ~1 px/s to 8 px/s.** At 1 px/s the hero kept
  creeping for ~0.7 s after the freeze began; 8 px/s settles the frame in ~0.3 s, costs
  0.13 px of coast, and is still far below `worldWakeSpeed`.
- **Four more specs broke than predicted** — the three withdraw/brief fixtures and
  `world-hover`. The withdraw ones all trace to the same root cause the plan had not
  spotted: `p.mood` is computed in the skipped AI section, so a frozen tick clashes
  without classifying initiative. Fixed at the source by having the `world_brief` and
  `world_aftermath` scenarios keep the world awake for their setup tick.
