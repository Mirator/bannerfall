# Bannerfall — Exploratory QA Report (Manual Tester)

Tested build at `http://localhost:8474`, in an isolated tab, via `window.game` / `window.__g` test API plus manual play. Charter items covered below; console was monitored throughout — **zero console errors or exceptions were logged across the entire session**, including every forced edge case (0-HP battles, 0-troop battles, engineered simultaneous death/victory, rapid input spam, boundary clamps). That is a genuinely strong result for a from-scratch canvas game.

All screenshots are in `shots/`, prefixed `qam_`.

---

## Bug list (ranked by severity)

### 1. [Major] Army-cap upgrade price shown to the player does not match the price charged
**Where:** `src/world.js` — HUD prompt (`drawHud`) vs. the actual charge in `update()`.

The HUD prompt at a town computes the displayed cost as:
```
40 + (this.save.armyCap - 8) * 20
```
but the code that actually deducts gold uses:
```
40 + (this.save.armyCap - BALANCE.armyCapBase) * 20   // armyCapBase = 12
```
The `8` is a stale/hardcoded number that doesn't match `BALANCE.armyCapBase` (12). Every upgrade is actually **80 gold cheaper** than what's displayed, consistently, at every tier.

**Repro:**
1. `window.game.scenario('world')`, teleport hero to Highmere (2050, 1150).
2. Note the town prompt: "T +2 army cap **120g**" (at starting cap 12).
3. Press T.

**Expected:** Gold drops by 120 (matching the displayed price), or the display matches whatever is actually charged.
**Actual:** Gold drops by only **40**. Confirmed again at the next tier: displayed "160g", actually charged **80g**. The gap is a constant 80g at every level.

**Evidence:** `shots/qam_town_precap.jpg` (shows the "120g" prompt); verified numerically via `__g.scene.save.gold` deltas.

**Impact:** This is a straight-up broken economy display — the player is told a price and charged a different one every single time they use a core progression system. Trivializes army-cap scaling economically (effectively ~33-50% cheaper than intended) and is a basic UI/logic desync a release build shouldn't ship with.

---

### 2. [Major] No standing "is the hero dead" check — death is only detected reactively inside `damageFriendly()` (requires debug handle to reach)
**Where:** `src/battle.js`, `Battle.update()`.

The only place `endBattle(false)` is ever called for the hero is inside `damageFriendly()`, triggered synchronously when hero HP is reduced below 0 by a specific hit. There is no per-frame safeguard checking `hero.hp <= 0` independently.

Normal play can't currently produce a battle that starts with `heroHp <= 0` (defeat clamps to 50% max HP, victory clamps the reported HP to `Math.max(1, hp)`), so this is **not reachable through the shipped gameplay loop today**. I forced it via `__g` to probe the architecture:

**Repro (requires debug handle):**
```js
window.__g.startBattle({ troops:[{type:'spear'}], enemies:[{type:'bandit'}], heroHp: 0, ... });
```
Then run the fight for several seconds without the hero taking any further hit.

**Expected:** A hero that enters or reaches 0 HP is dead; the battle should end in defeat.
**Actual:** The battle runs indefinitely in `state: 'fight'` with `hero.hp === 0`, HP bar rendering as an "empty but alive" bar, no defeat trigger, forever (verified 3+ simulated seconds with no change).

**Impact:** Flagging because it's a real robustness gap in the death-detection architecture, not because of any known live path to reach it. If any future feature (environmental hazard, DOT, scripted damage) sets HP outside of `damageFriendly()`, it will silently produce an undead hero with no way to lose. Recommend a defensive `if (hero.hp <= 0) endBattle(false)` at the top of the fight-state update as cheap insurance.

---

### 3. [Minor/Cosmetic] Squad-count balloon badge doesn't scale for double-digit troop counts
**Where:** `src/engine.js`, `balloon()`.

The little count badge on a squad's map/battle balloon is a fixed radius-6.5 circle with a 9px font, clearly sized for single digits (1-9).

**Repro:** Field 12 spearmen in one battle (`troops: Array(12).fill({type:'spear'})`) and look at the spearman balloon over the formation.

**Expected:** The count number stays legible inside its badge regardless of squad size.
**Actual:** "12" visibly overflows the circle — digits extend past the badge's edge.

**Evidence:** `shots/qam_balloon_12badge.jpg`.

---

### 4. [Minor/Cosmetic] World toast message box is sized using a stale canvas font (measured width doesn't match the rendered font)
**Where:** `src/world.js`, `drawHud()`, the toast block.

```js
ctx.fillStyle = P.ink;
const tw = ctx.measureText(this.msg).width + 50;   // <-- font not set yet here
rrect(ctx, ...); ctx.fill();
ctx.fillStyle = P.cream;
ctx.font = '700 14px system-ui, sans-serif';        // <-- font is set AFTER measuring
ctx.fillText(this.msg, ...);
```
`measureText` runs against whatever font the previous HUD element left active (typically `600 13px` from the settlement/camp context-prompt block, sometimes `700 15px` if no prompt is showing) instead of the `700 14px` the text is actually drawn in.

**Measured impact:** For the message "3 freed captives join your warband", the leaked-font measurement is 203.9px vs. the real rendered width of 228.1px — a **24px undercount**. The fixed +50 padding mostly hides this for short strings, but longer toasts (e.g. the "freed captives" message, which is exactly the kind of message that fires after a camp raid) will visibly crowd or clip against the box edges. Also means box width is inconsistent for the *same* message depending on whether the player happens to be standing near a settlement/camp when it fires (different residual font state).

**Evidence:** Directly measured via `ctx.measureText` with both font states; `shots/qam_toast_msg.jpg` shows a shorter message where the effect is only mild.

---

### 5. [Minor — design/architecture, likely invisible to players] World's RNG stream resets to a fixed seed on every single battle return
**Where:** `src/world.js`, `World` constructor: `this.rng = makeRng(777);`

A **new** `World` object (with a fresh `makeRng(777)`) is constructed every time `game.startWorld(save)` runs — which happens after **every** battle, not just a brand-new game. This `this.rng` instance drives party wander-direction rolls and camp `spawnParty` composition rolls for the rest of that world session.

**Repro (verified via `__g`):** Constructing two `World` scenes back-to-back with identical `save` payloads produces **byte-identical** sequences of `rng()` draws afterward (confirmed to 6 decimal places over 5 draws). This proves the "randomness" governing spawns/wandering after any battle is a pure function of (a) the fixed seed 777 and (b) how many `rng()` calls the constructor itself consumes for that particular save state (camp-razed pattern, etc.) — not an evolving session-wide stream.

**Impact:** Doesn't crash or corrupt state, and a casual player is unlikely to consciously notice it. But it means the campaign layer's randomness "reshuffles from scratch" every time you return from a fight, rather than continuing to evolve — two playthroughs that raze camps in the same order will see the same subsequent spawn-composition/wander pattern after each return. Worth a deliberate call on whether this is intended (e.g. for reproducibility) or an oversight (rng should probably be seeded once at campaign start and persisted/threaded through, the way `save.parties` already is).

---

### 6. [Cosmetic, very minor] Top-left HUD panel can sit directly over the hero sprite at the map's top-left corner
When the hero is near world-map coordinate (60,60), the fixed-position gold/army/HP panel visually overlaps the hero and warband sprites underneath it (HUD is drawn last, in screen space, on top of everything).

**Evidence:** `shots/qam_world_corner.jpg`.

**Impact:** Very minor — only affects the one corner of a 3200×2200 map, no gameplay impact, but worth a glance (e.g. a small safe-margin nudge on the HUD panel, or letting the player see a sliver of themselves peek out).

---

## Things I tried to break and could NOT break (verified passes, listed since the charter asked for these explicitly)

- **Economy:** exact-gold purchase (15g for 15g spearman) succeeds and zeroes gold correctly; 1-gold-short purchase correctly rejected with "Not enough gold"; recruiting at exact army cap correctly rejected with "Army is at capacity"; healing at full HP correctly rejected ("Already rested"); healing with insufficient gold correctly rejected; holding Q down (simulated held-key, not just tap-spam) recruits only once thanks to proper edge-triggered `keydown`/`e.repeat` filtering — no recruit-spam exploit; razing a camp while exactly at army cap correctly caps freed captives at the army limit (no overflow).
- **Battle:** movement/attack/commands are fully inert during the intro banner (pressing Charge during intro is silently dropped, command stays "follow"; the same key press does not "carry over" once fight starts) and during the end banner (movement/attack/command all no-op while the victory/defeat card is up); spam-clicking the sword swing every single frame is correctly throttled to the real `0.34s` cooldown (measured clean 0.4s gaps under continuous per-frame click injection, isolated from troop-attack noise); dashing repeatedly into all 4 arena corners never escapes the `[40, W-40] x [40, H-40]` bounds and never "explodes"/launches the hero; dashing directly at the river wall away from the bridge is correctly blocked (hero stops ~50px short, consistent with the obstacle wall), while dashing at the actual bridge gap crosses cleanly to the far bank; winning with 0 troops resolves correctly (proper `onEnd` result, 0 survivors, no crash); assaulting the 10-size stronghold with 0 troops correctly spins up an 18-enemy battle with no crash, and losing it resolves defeat correctly even with an empty troop list (gold floor, troop-halving filter, 50% HP, respawn position all correct with zero troops); engineering a same-frame "last enemy dies + hero simultaneously takes lethal damage" (via injected projectile + a killing sword swing on the same tick) resolves deterministically to **defeat**, with no double-trigger, no crash, and no double-loot-award — hero death correctly takes priority over the simultaneous kill.
- **World:** hero movement clamps correctly at all 4 map borders and all 4 corners, no void/escape, no camera glitch; the 6-second post-battle ambush grace correctly prevents engagement from an adjacent overwhelming party for the full window and correctly allows the ambush the instant grace expires; razing all 3 non-stronghold camps leaves the spawner correctly running off the surviving stronghold alone, properly capped at `2 + aliveCamps*2`; rapidly oscillating the hero in and out of a village's recruit radius while spamming the recruit key 40 times in a row causes no crash, no double-charge, and correctly stops recruiting the instant army cap is hit.
- **Transitions:** menu → world → battle → world → victory → menu → world again leaves **zero stale state** — a fresh run after victory correctly resets gold (80), troops (4 spearmen), army cap (12), all camps unrazed, and hero position to the map start; verified with gold/troops/cap deliberately corrupted to arbitrary values beforehand to make sure the reset wasn't accidentally reusing the old save.
- **Determinism:** the battle simulation itself is fully deterministic — running the identical scripted input sequence (same seed, same charge command, same dash timing) twice against `battle_big` produces byte-identical kills/positions/HP/state down to floating-point precision. (World-layer determinism has the caveat in Bug #5 above.)
- **Rendering:** 99999 gold in the top-left HUD panel does not overflow its box; the "island in the sea" camera coastline reveal at wide zoom (visible as a thin colored strip at extreme screen edges in some shots) is intentional per the code's own comment ("show coastline, not a band") and is correctly proportioned, not a leak/artifact.

---

## Stability verdict

**Battle bar: 8/10** for a Thronefall-quality release bar. The core combat loop is rock-solid: deterministic, no crashes under real abuse (0 troops, 0 HP, injected simultaneity, spam-clicking, corner-dashing, forced obstacle collisions), input is correctly locked out during banners, and cooldowns hold up under frame-perfect spam. The only real deduction is the balloon-badge overflow at 12+ troops (cosmetic) and the theoretical death-detection gap (#2) that's currently unreachable but architecturally fragile.

**World/campaign bar: 6/10**. Functionally very solid (grace, safe zones, spawner throttling, cap enforcement, reset-on-new-game all check out under adversarial testing), but it loses points for the **economy display bug (#1)** — a core, constantly-used progression price is wrong every single time you look at it, which is the kind of bug a player would notice and complain about on day one — plus the toast font-measurement bug (#4) and the RNG-reseed architecture issue (#5), which together suggest the world layer hasn't had the same level of scrutiny as the battle layer.

**Overall: would not ship as-is.** Bug #1 alone (mismatched displayed vs. charged price on a core economy screen) should block release; it's a one-line fix (`- 8` → `- BALANCE.armyCapBase`) but it's the kind of thing that erodes trust in every other number the game shows you.

---

## Bug counts by severity
- Major: 2 (#1 army-cap price mismatch, #2 no standing death check)
- Minor: 2 (#4 toast font mismatch, #5 world RNG reseed)
- Cosmetic: 2 (#3 balloon badge overflow, #6 HUD/hero corner overlap)
