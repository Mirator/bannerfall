# Bannerfall — Automated QA Regression Suite

Suite: `tests/qa_suite.js` (self-contained, paste-into-`javascript_tool` block; also
exposes `window.runQaSuite()` for re-running against a live `window.game`).

Run method: navigate to `http://localhost:8474`, paste the file contents into the
page, read `window.__qaResult`. Confirmed stable across two independent fresh-page
runs after fixing the two suite bugs described below.

## Final result: 15 / 15 passed

| # | Test | Result | Key detail |
|---|------|--------|------------|
| 1 | `menu_to_world_on_enter` | PASS | Enter transitions menu→world |
| 2 | `battle_flow_invariants_and_victory` | PASS | kills+enemies==total, troops≤start, hp≤max held for 55 ticks; victory→world |
| 2b | `battle_end_banner_holds_at_least_2s` | PASS | banner held 2.70s (gate is `stateT > 2.6`, battle.js:273) |
| 3 | `defeat_penalties_via_world_battle` | PASS | gold 100→70 (30% loss), troops 5→3, respawn (620,1250) |
| 4 | `victory_loot_and_survivors_via_world_battle` | PASS | loot 30 for 4 enemies, survivors=3, heroHp 60→80 |
| 5 | `command_system_and_hold_positions` | PASS | Digit1/2/3 → follow/charge/hold; hold positions captured |
| 6 | `economy_recruit_cost_cap_and_gold_refusals` | PASS | exact cost deduction, cap refusal, gold-short refusal, interactive-path parity |
| 7 | `economy_heal_refusals_and_success_path` | PASS | full-HP refusal, gold-short refusal, success path incl. troop-hp reset |
| 8 | `world_party_battle_decreases_party_count_by_one` | PASS | 8→7 |
| 9 | `world_camp_raid_razes_camp_and_grants_captives` | PASS | razed=true, gold +95, captives 4→6 |
| 9b | `world_camp_raid_captives_capped_at_army_cap` | PASS | stays at 4 when already at cap |
| 10 | `world_grace_timer_active_after_battle_then_decays` | PASS | 5.62s → 2.62s → -0.02s (decays to 0 by 7s) |
| 11 | `world_party_strength_stays_in_2_24_band` | PASS | 25 spawns across 5 bands, all within [2,24] |
| 12 | `determinism_battle_small_seed_reproducible` | PASS | two runs: kills=0, hero=(361,535) — bit-identical |
| 13 | `perf_smoke_200_half_second_steps` | PASS | 200×step(0.5) (100 sim-sec) in ~330-370ms |

No test is currently red. Two tests *were* red during development; both are analyzed
below because the debugging process itself surfaced real findings.

## Failures encountered while building the suite (both fixed — analysis kept for the record)

### A. `command_system_and_hold_positions` — suite bug, not a game bug

**Symptom:** Digit2 during the very first run reported `command=follow` instead of
`charge`.

**Cause:** `Battle.update()` (`src/battle.js:264-269`) early-returns while
`this.state === 'intro'`, and intro lasts until `stateT > 1.1` (or `stateT > 0.6`
with any input already pressed). The original test sent Digit1/2/3 immediately
after `scenario('battle_small')`, before intro ended, so all three commands were
silently dropped and `command` stayed at its default `'follow'`.

**Fix:** the test now polls `state().battle.state` (exposed by `main.js`'s test API)
and steps in 0.1s increments until it's no longer `'intro'` before sending any
command taps. This is a real, source-confirmed game behavior (input gating during
intro), not a bug — the suite just didn't account for it originally.

### B. `world_grace_timer_active_after_battle_then_decays` — suite bug, not a game bug

**Symptom:** intermittently (~1/3 of runs) failed with `Cannot read properties of
undefined (reading 'toFixed')`, at different points in the test across runs.

**Root cause (confirmed via an instrumented rerun):** the original test parked the
hero at the exact coordinates of the party it just fought and then called
`step(3)` + `step(4)` (7 more sim-seconds) while reading `World.grace`. A fresh
world spawns ~8 roaming parties; once grace naturally expires (~5.6s in, since part
of the 6s window is consumed by the forced end-banner flush itself), any *other*
party that had wandered close enough is free to collide with the still-parked hero
and start a **second** battle mid-observation (`world.js:284`,
`engaged = grace <= 0 && !heroSafe && !inSafeZone(p.x,p.y)`). At that point
`G.scene` is a `Battle` instance, which has no `.grace` field, so the read comes
back `undefined`. This is the party-engagement system working exactly as designed
— the test simply didn't isolate the hero from further contact while sampling the
decay curve.

**Fix:** after confirming the return to world, the hero is retreated into a
settlement's safe zone (`inSafeZone`, radius 260, `data.js` `BALANCE.settlementSafeR`)
before the rest of the decay is sampled, which blocks all party engagement
regardless of grace. The suite also now defensively type-checks `grace` before
calling `.toFixed`, so any future corruption fails with a clear message instead of
a crash.

## Real game bug found (independent of the two suite bugs above)

**`src/main.js:148-169` — the headless watchdog never updates `lastTick`, so it can
end up permanently re-driving the game loop, decoupled from real time.**

```js
let acc = 0, last = performance.now(), lastTick = 0;

function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  lastTick = now;               // only rAF's frame() ever sets this
  ...
}
requestAnimationFrame(frame);

setInterval(() => {
  const now = performance.now();
  if (now - lastTick > 300) {   // true immediately if frame() never ran
    last = now;                 // <-- sets `last`, but NOT `lastTick`
    game.update(DT);
    game.draw();
  }
}, 50);
```

`lastTick` starts at `0`. If `requestAnimationFrame` is ever throttled or never
establishes itself (backgrounded tab, headless/non-compositing context — plausible
for exactly the kind of automation this test API is built for), the watchdog's own
`now - lastTick > 300` check stays true forever, because the watchdog branch never
resets `lastTick` — only `frame()` does. The intended behavior is "nudge the sim
once if a frame was missed"; the actual behavior, once triggered, is an unbounded
~20Hz background simulation that keeps running indefinitely and can silently
advance `World`/`Battle` state between explicit test-API calls, with no way for a
test to detect or gate it. **Fix:** set `lastTick = now;` inside the watchdog branch
too. This wasn't the direct cause of failure B above (that was reproduced as a pure
logic issue within one synchronous script), but it is a real, source-confirmed
determinism hazard for exactly this kind of headless regression testing and is
worth fixing regardless.

## Minor discrepancy (design note, not a bug)

`world.js:196`: `save.troops = save.troops.filter((t, i) => i % 2 === 0);` keeps
`ceil(n/2)` troops on defeat, not `floor(n/2)`. For even troop counts this is
exactly half (matches the intent described in the design); for odd counts the
player keeps one more than a literal "half" (e.g. 5 troops → 3 survive, not 2).
Confirmed intentional-looking (rounds in the player's favor) rather than a bug, but
worth flagging since "half troops" as a spec description is only exact for even
counts.

## Coverage gaps not automated

- **Visual/pixel regression** — `game.shot()` (canvas `toDataURL`) exists but this
  suite does no image diffing; HUD text, banners, telegraph icons, and biome
  palettes are entirely unverified.
- **Real WASD/mouse-driven hero movement** — every test here drives the hero via
  direct `__g` teleportation or discrete `tap()` calls; continuous-hold `key()`
  input (`Input.keys`/`axis()`), dash i-frames, dash-trample damage, and
  obstacle/hero collision response are untested.
- **`battle_bridge` scenario** (river chokepoint + two-flank ambush spawn) is
  defined in `main.js` but never exercised.
- **Full campaign progression to the stronghold and the victory scene**
  (`game.startVictory`, `drawVictory`) — razing all 3 camps + Wolfsjaw Hold is out
  of scope for a fast regression suite; `startVictory`/`victoryT` transition is
  untested.
- **Formation/slot assignment correctness** (`assignSlots`, `slotPos`) and
  fine-grained separation/collision physics are relied upon implicitly but not
  directly asserted.
- **The watchdog race itself** (see above) is not something this suite can turn
  into a clean deterministic regression test, since it depends on whether rAF is
  being throttled by the host environment — flagged as a blind spot rather than
  left silently uncovered.

## Verdict: is the game's testability good?

**API surface: good, with one real gap.** `window.game` covers exactly the right
surface for a fast-timestep regression suite — `scenario()` for canned setups,
`step()`/`tap()`/`key()`/`mouse()`/`click()` for input, `state()` for a clean
read-only snapshot, and `window.__g` as an escape hatch straight into live
`Battle`/`World` instances for setup and assertions that `state()` doesn't cover
(this suite leaned on `__g` heavily: forcing `endBattle()`, teleporting the hero,
calling `recruit()`/`spawnParty()` directly). The one real gap: balance constants
(`UNIT_TYPES`, `ENEMY_TYPES`, `BALANCE`, `WORLD`) live in ES module scope and are
never exposed on `window`, so a black-box suite has to hardcode mirrors of costs,
loot formula, defeat penalty, grace duration, etc. (see the `COST`/`HEAL_COST`/
`LOOT_BASE`/... constants at the top of `qa_suite.js`) — those mirrors will silently
go stale if `data.js` balance numbers change. A `window.__g.balance` (or similar)
readout would close this gap cheaply.

**Determinism: good for the thing that matters most, with one caveat.** Per-battle
combat is properly seeded (`makeRng(setup.seed)` in `Battle`'s constructor) and the
determinism test confirms bit-identical kills/hero-position across two full
`battle_small` runs. World party generation is also fully deterministic
(`makeRng(777)` reseeded fresh in every `World` constructor). The caveat:
`game.shakeRng` (`main.js:22`, `makeRng(99)`) is created once for the whole session
and never reseeded per scenario, so camera-shake offsets are not reproducible
run-to-run relative to prior session history — harmless for logic assertions (shake
never feeds back into simulation state) but would matter for anyone trying to do
deterministic screenshot/pixel-diff replays. Combined with the watchdog bug above,
determinism is solid *as long as the harness only ever advances time through the
test API* — but the API doesn't currently guarantee that's the only clock driving
the sim.

**Bottom line:** testable and pleasant to write against — a same-day suite got
solid coverage of the state machine, battle invariants, economy, and world
mechanics without needing screenshots or timing hacks. Fix the watchdog
`lastTick` bug and expose balance constants for read access, and this would be a
genuinely strong headless-testing story.
