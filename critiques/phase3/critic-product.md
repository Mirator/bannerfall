# Shipping-Bar Product Critic — Phase 3

**Lens:** would a stranger who paid $5 for this on itch.io feel they got a finished small game?
**Bar:** 9/10. **Original score: 4/10 → Round 2: 8/10 → Round 3 (final): 9/10 — bar met.**

See the **RE-VERIFICATION ADDENDUM** at the bottom of this file for the current pass. The original findings below are kept for the record; several are now resolved and marked as such in the addendum.

Methodology: read `src/main.js`, `src/world.js`, `src/battle.js`, `src/engine.js`, `src/data.js` in full for the product-shell logic (not the sim), then verified every claim live against the running build at localhost:8474 via the headless test API (`window.game`, `window.__g`) — menu, a live battle, forced pause-key presses, a forced defeat, and a simulated full-campaign victory (state manipulated directly through `__g.scene.save`, noted below as a speed-grind, not organic play). Screenshots: `shots/ship_menu.jpg`, `shots/ship_world.jpg`, `shots/ship_victory.jpg`, `shots/ship_defeat.jpg`.

The sim (combat feel, terrain, AI) is not this critic's concern and may well be good. The **shell around it is not done.** This currently reads as a tech demo of a combat/campaign system, not a packaged product. A player who paid for it would reasonably feel shorted on basic conveniences they get free in almost every other $5 title on itch.io.

---

## Ranked gaps

### 1. There is no pause. At all.
Tested live: mid-battle, `Escape` and `KeyP` were pressed and the sim kept running (`state` stayed `"fight"`, timers kept advancing) — confirmed both by code (no keybind for either exists anywhere in `src/`, grepped) and by direct test. There is also no pause in the world/campaign scene (also tested — `Escape`, `KeyR`, `KeyM` all no-op).
**Why a paying player cares:** this is table-stakes for any real-time game shipped anywhere, let alone one explicitly benchmarked against Thronefall (which pauses). A phone call, a door, alt-tabbing to check something — the player either eats the consequence mid-fight or quits the tab.
**Smallest shippable fix:** `Escape` sets a `paused` flag that gates `scene.update()` (not the intro/menu/victory state machines) and draws a translucent overlay with Resume / Quit-to-menu. A few hours of work, not a redesign.

### 2. No save, no warning, no acknowledgement that nothing is saved
Grepped the entire codebase: zero occurrences of `localStorage`, `sessionStorage`, or `beforeunload`. The campaign `save` object lives only in JS memory. A refresh, crash, or accidental tab close during what is likely a 20–40 minute run (see #6) erases everything — silently, with no confirm dialog and no in-game copy anywhere ("progress isn't saved") to set expectations.
**Why a paying player cares:** losing a half-hour campaign to a stray F5 with zero warning reads as broken, not "roguelite by design" — nothing in the game *says* runs are meant to be disposable, and the soft-defeat design (see "already ship-grade") signals the opposite: that persistence matters.
**Smallest shippable fix:** either (a) periodic `localStorage` snapshot of `save` + restore-on-load, or at minimum (b) a `beforeunload` confirm and a menu-screen line disclosing there's no save.

### 3. Zero run variety — literally the same campaign every time
Read `src/data.js` (`WORLD.settlements`, `WORLD.camps` are hand-placed constants) and `src/world.js` (`buildScenery()` uses `makeRng(1234)` — a fixed seed independent of the run; `rollGarrison()` seeds off camp position + player strength, not run identity). Rivers, mountains, forests, camp positions/tiers, settlement specialties are all identical on every single playthrough. There is no difficulty selector on the menu (confirmed — menu only offers "Press ENTER to ride," screenshot `ship_menu.jpg`) and no NG+ hook after victory.
**Why a paying player cares:** the charter's own question — "what pulls a second playthrough?" — has no answer right now. Beat it once, and the only thing different on run 2 is your own memorized knowledge of where Ashford and Coldwell are.
**Smallest shippable fix:** seed `buildScenery`/camp placement/garrison rolls off a per-run seed (e.g., `Date.now()` at `startWorld(null)`), or at minimum expose a difficulty multiplier at the menu.

### 4. No audio mute or volume control anywhere
Grepped for `mute`/`volume`/`KeyM` across `src/` — zero hits. `Sfx` (`engine.js`) hard-codes `master.gain.value = 0.35` the instant the AudioContext initializes (first click/Enter) and offers no toggle. It's a synth-generated soundscape that fires constantly (swing/hit/kill/hurt/gallop/coin/horn), always on.
**Why a paying player cares:** "can I turn this off" is one of the most common day-one itch.io review complaints when it's missing, especially for synth SFX rather than mixed music. A player in a shared space or who simply dislikes the sound has no in-game recourse short of OS-level mute.
**Smallest shippable fix:** one keybind/icon that sets `sfx.master.gain.value = 0` and back; a menu or corner icon, not a full options panel.

### 5. Victory screen is not a worthy payoff
Live screenshot (`ship_victory.jpg`) confirms: solid ink background, "WOLFSJAW HAS FALLEN," one line of flavor text, and exactly one number — gold amassed. No time played, no battles fought, no men lost, no camps razed, no kill tally. Two-thirds of the screen is empty. Worse: I grepped the save object for any of this data (`totalKills`, `totalLost`, `elapsed`) and **it isn't even being tracked** — `battleCount` is the only cumulative stat kept across the campaign, so this isn't a rendering gap, it's a missing-instrumentation gap.
**Why a paying player cares:** this is the entire reason they played — the moment the campaign was building toward. A single number on a black screen undersells everything that happened in the preceding 30 minutes; it reads unfinished, not restrained.
**Smallest shippable fix:** accumulate kills/losses/battle count on `save` as battles resolve (the per-battle `result` object already has `kills` and `lost` — just sum them), then render 3–4 lines on the victory screen alongside the existing gold line.

### 6. Death/end-of-battle screen is a forced, unskippable ~2.6s wait, every single battle
Tested live: forced a hero-death via `damageFriendly`, confirmed `state` holds at `'end'` and does not transition back to `world` until `stateT > 2.6` regardless of input — `Enter`/click do nothing during this window (unlike the intro state, which does accept early input at 0.6s). Given a campaign of 3 camps (sizes 3/4/5) plus a 10-strong stronghold plus roaming-party skirmishes, this is likely dozens of forced 2.6s pauses per run with zero interactivity.
**Why a paying player cares:** small friction, multiplied by a lot of battles, adds up to real minutes of the player just staring at a banner they've already read, unable to speed it along even by clicking (contrast: the battle-intro state *does* let input skip ahead).
**Smallest shippable fix:** let `Enter`/click collapse the end-state early after a minimal readability floor (~0.8–1s), same pattern already used for the intro state.

### 7. No in-run way to quit/restart short of a destructive reload
Confirmed live: `Escape`, `KeyR`, `KeyM` are all no-ops in the world scene. Combined with gap #2 (no save) and #7, a player who wants to abandon a run and start clean must reload the tab, with no confirmation and no warning that everything is lost.
**Why a paying player cares:** "I want to start over" is a normal request mid-strategy-game, especially once a run goes badly (recruits are dead, gold is low). Right now that requires leaving the game via the browser chrome, not the game itself.
**Smallest shippable fix:** roll into the same pause overlay from #1 — a "Quit to menu" button that calls `startWorld(null)`.

### 8. Menu/shell reads as a placeholder screen, not a product front door
Screenshot `ship_menu.jpg` shows the complete menu: title, one-line pitch, "Press ENTER to ride," and a 3-line control strip. That's it — no credits, no version/build number, no settings entry point of any kind (because there's nothing to configure — see #4), no dedicated "how to play" beyond those 3 lines. It's a fine *title card*; it is not a *main menu*.
**Why a paying player cares:** it's the first and last thing every player sees, and right now it undersells that a real, complete campaign sits behind it. It also has literally nowhere to put the fixes from #3/#4/#7 once they exist, which will make this compound if untouched.
**Smallest shippable fix:** doesn't need much — a corner mute icon and maybe one more line of controls would already close most of the gap; this item mostly tracks that #1/#4/#7 currently have no home to live in.

---

## What's already ship-grade

- **The full-reset-on-new-run flow is clean and verified.** Live test: forced `save.won = true`, hit the victory screen, pressed Enter twice (victory → menu → world). Resulting state: `gold: 80, troops: 4, camps: [all razed:false], parties: 8` — i.e. every one of gold/troops/camps/scouting/parties is back to defaults. When a "new game" does happen, it is genuinely new.
- **The soft-defeat design is coherent, not broken.** Losing a battle doesn't end the run — surviving troops carry the hero to the nearest village at a gold/HP cost (`world.js` lines ~301–318). This is a deliberate Bannerlord-style choice (persistent campaign, not permadeath roguelite) and works as designed; the charter's "die → retry" framing doesn't map cleanly onto this game, and that's fine — but it makes the *lack* of a real pause/quit/save shell more conspicuous, not less, since a punishing-but-forgiving defeat implies the campaign state is meant to matter.
- **Visual/HUD readability in the world scene is solid** (`ship_world.jpg`, `ship_defeat.jpg`): gold/army/HP readout, a clear single-line objective banner, flat Thronefall-adjacent art that reads at a glance. This part of the shell is genuinely close to done.
- **Menu accepts both Enter and click** to start — no keyboard-only trap.

---

## Session-length caveat

I could not obtain a real measured session length — I sped through victory via direct state injection rather than organic play (noted above), and the codebase itself tracks no elapsed-time or battle-count telemetry beyond `battleCount`. Structurally (4 camps sized 3/4/5/10, roaming-party encounters, travel/recruiting stops across a 3200×2200 map), a full campaign plausibly runs 25–45+ minutes for a first-time player, which may run long for the "fits a lunch break" bar the charter sets — but this is inference from code shape, not evidence, and is itself a gap: nobody, including this critic, actually knows the real number because nothing measures it.

---

## RE-VERIFICATION ADDENDUM (bar 9/10, prior score 4/10)

Reloaded the build (`{cache:'reload'}` purge on `/` and `/index.html`, then `navigate force:true`) and re-read `src/main.js` and `src/world.js` in full before testing live. All five claimed changes were exercised against the running build, not just read in source. New score: **8/10.** Bar not fully met, but the loud "this reads like a tech demo" problems from the first pass are gone.

### 1. Pause — FIXED, verified
Live test: entered a battle, let it reach `state:'fight'`, pressed `Escape` → `game.__g.paused` flips true, drew a full pause overlay (screenshot `shots/ship2_pause_overlay.jpg`): dimmed screen, "PAUSED," and correct hint text for resume/mute/abandon. Then stepped the sim 2 full seconds while paused — hero position, kill count, and battle `state` were byte-identical before and after, confirming the sim is genuinely frozen, not just hidden. `Escape` resumes correctly (`paused` flips back to false). This exceeds the ask — one overlay covers pause, mute, and abandon-run together.

### 2. Mute — FIXED, verified
`M` toggled `sfx.muted` true, wrote `bf_mute:"1"` to `localStorage`, and rendered a "🔇 muted" chip in the bottom-right corner on every scene (screenshot `shots/ship2_muted_indicator.jpg`). Reloaded the tab (full navigate, not a soft reset) and confirmed `sfx.muted` came back `true` on boot with no further input — persistence across sessions is real, not just in-memory.

### 3. Save/continue — FIXED in mechanism; real-page-reload demo was confounded by a test-environment artifact worth flagging
Confirmed via direct round-trip: wrote a distinctive save (unique gold, troop comp, camp-razed flags, x/y, and a stats block) through the real `persistRun()`, then reconstructed a fresh `World` purely from the persisted JSON via `loadRun()`'s path — gold, troops, camps, position, stats, and `runSeed` all matched exactly. The menu correctly shows "C — continue your saved campaign" only when a save exists, and only when it exists (screenshot `shots/ship2_menu_continue.jpg`); pressing `C` resumes it. Victory calls `clearRun()` (verified `bf_save` was `null` immediately post-victory) and pause's `R` (abandon run) also clears it and returns to menu (verified live).
Caveat: I could not get a clean **actual browser-refresh** demonstration, because this harness has several sibling critic tabs open on the same `localhost:8474` origin simultaneously, and every one of them is an independent live `Game` loop that autosaves to the same shared `bf_save` localStorage key every 4 seconds while on the map. Twice, my distinctive marker was overwritten by a sibling tab's autosave in the ~1–2s window between my write and my reload-check. This is not a defect in Bannerfall's own logic (proven by the in-tab round-trip above) — but it does expose a real, if narrow, product risk: **the save key isn't scoped per-tab/session, so two tabs of the same origin (or an OS-restored background tab) silently stomp each other's campaign** with no conflict warning. Low real-world frequency for a single-player itch.io page, but worth a one-line mention, not a scoring blocker.

### 4. Victory screen — FIXED, verified
Forced a win with populated stats (`won:11, kills:63, lost:4, playT:1385`) and screenshotted the result (`shots/ship2_victory_stats.jpg`): "Campaign time 23:05 · Battles won 11 · Foes slain 63 · Men lost 4 · Gold amassed 342," plus "Press ENTER for a new campaign." This directly answers gap #5 from the original pass (the save object now genuinely accumulates `stats.won/kills/lost/playT` across battles in `world.js`, not just cosmetic). Minor residual nitpick: the bottom half of the screen is still empty and there's no visual fanfare — but the substantive ask (data, not decoration) is met.

### 5. Run variety — FIXED, verified
Compared two fresh campaigns started back-to-back (`clearRun()` + `startWorld(null)`, mirroring a real menu Enter): `runSeed` differed (566484965 vs 996632183), and calling the real `rollGarrison()` for camp `c1` in each produced different compositions, and the initial roaming-party spawns differed in both count and composition. The charter's specific ask — "scout c1 in each, compare garrisons" — is satisfied: a second playthrough now meets a different bandit camp, not a re-run of the same fight.

### Not changed (per coordinator, judged accordingly)
No difficulty modes, no credits screen, map/settlement layout is still fixed/authored (only garrisons and parties vary), window-resize behavior unverified either pass (harness limitation — canvas doesn't track viewport resize in this browser pane), and "how to play" is still just the 3-line menu card (now 4 lines, including ESC pause and M mute). These are real, but were explicitly out of scope for this hardening pass and are minor relative to what got fixed.

### Score rationale (round 2)
The five items that got fixed were exactly the ones that made the original pass feel like a tech demo rather than a product: you couldn't pause, couldn't mute, couldn't safely close the tab, got nothing for finishing, and had zero reason to play again. All five are now genuinely working, not just cosmetically present — verified through direct manipulation of the running build, not just source reading. What's left (difficulty choice, credits, deeper how-to-play, the multi-tab save-key edge case, victory-screen visual sparseness) is real but secondary polish, not "this doesn't work" territory. That's the gap between 8 and the 9 bar.

---

## ROUND 3 RE-VERIFICATION (bar 9/10, prior score 8/10) — final

Reloaded again (`{cache:'reload'}` on `/` and `/index.html`, then `navigate force:true`) and re-read the updated `src/main.js` and `src/world.js` in full before testing. All claims verified live, not just by source reading.

### 1. HARD mode — FIXED, verified precisely
Pressed `KeyH` at the menu: `save.hard` came back `true`, and it correctly starts a fresh run (`clearRun()` fires first, same as Enter). Screenshot `shots/ship3_menu_hard_line.jpg` confirms the on-screen prompt "H — ride out on HARD (stronger camps, no volunteers)."

**Garrison math, isolated properly:** rather than trust two separately-seeded runs (which would confound the hard multiplier with normal per-run RNG variance), I pinned `save.runSeed` to the same value and toggled only `save.hard` on one live `World` instance, then called the real `rollGarrison()` for both `c1` and the Wolfsjaw stronghold at an identical warband strength (`myStrength() = 7` both times):
- `c1`: normal garrison strength **5** → hard **6** (target formula: `round(mine·tier)` = `round(4.9)=5` vs `round(4.9·1.25)=6` — exact match to the claimed +25%).
- Stronghold: normal **12** → hard **13** (formula gives `round(10.5)=12` vs `round(10.5·1.25)≈13`, but here the `max(camp.size+2, …)` floor of 12 compresses the visible bump at this particular warband strength — a real but minor nuance: the stronghold's difficulty floor means HARD's relative bite is smaller for a still-modest warband than for the early camps. Not a defect, just worth knowing).

**Defeat consequence, verified end-to-end through the real battle→world defeat path** (not the test-scenario shortcut): forced a loss with zero surviving troops in a HARD-mode campaign — result: `save.troops` came back as exactly `[{type:'spear'}]` (one squire) with the message *"Carried to Ashford — only your squire remains. HARD lands breed no volunteers."* Ran the identical scenario in a NORMAL campaign: `save.troops` came back padded to **2** spears with *"village volunteers rally to your banner."* The two modes diverge exactly as specified.

**Victory badge**: forced a HARD-mode win — screenshot `shots/ship3_hard_victory.jpg` shows "— A HARD CAMPAIGN —" in accent color directly under the title, stats intact underneath it.

Combined with round-2's confirmed per-run seed variance, normal/hard × seeded garrisons is now a real, verified variety axis, not just a cosmetic label.

### 2. Victory fanfare — FIXED, verified
Same screenshot (`ship3_hard_victory.jpg`): seven captured banners now line the bottom third of the screen (previously empty space), copy is fuller ("The realm is yours. The bards will sing of it."), and all the round-2 stats (time/battles/kills/losses/gold) are still present and correct. Confirmed the sway is real motion, not a static image: read `victoryT` at two points 0.3s apart and recomputed the banner's `sin()` offset — it changed between frames, matching the animation in the source (`sway = Math.sin(victoryT*2+i)*4`).

### 3. Tab-scoped save — acknowledged, not re-scored
Per the coordinator: deliberately not built, single-slot save is the accepted norm for a game this size. Judged accordingly — not held against the score. (The underlying behavior from round 2 — same-tab round-trip fidelity, clearRun on victory/abandon — is unchanged and still holds.)

### 4. How-to-play — unchanged, one new observation
Still just the menu card; it now lists `ESC pause · M mute` in the control panel, which is the right call (round 2's gap was "no mention of these controls exist," and now there is one). One genuine, concrete polish bug found in the process: **the stacked menu hint lines increasingly collide with the mountain-silhouette artwork behind them.** Both `shots/ship2_menu_continue.jpg` and `shots/ship3_menu_hard_line.jpg` show "C — continue…" and now "H — ride out on HARD…" rendered partly behind/through a mountain peak, visibly harder to read than the title or the Enter prompt above them. This is the one remaining item I'd flag as an actual bug rather than a scope decision — cheap to fix (nudge the mountain peaks or the text block a few px, or draw the hint lines on their own ink card like the controls panel already does).

### Final score: 9/10 — bar met
What closed the gap from 8→9: HARD mode is a real, correctly-scaled difficulty axis (verified with the math, not just the label) that gives the seeded-run system in round 2 an actual point — "normal/hard × seeded garrisons" is now a genuine reason to play twice, and it changes the risk profile of losing (squire-only recovery is meaningfully harsher, verified live). The victory screen went from "one number on a black screen" to a proper payoff with fanfare, full stats, and a badge that acknowledges how you played. Neither is decoration — both were tested end-to-end against the running build and behave exactly as specified.
What keeps this from a clean 10, and would be the first things I'd hand back on a next pass: the menu-hint/mountain text-collision bug (concrete, screenshotted twice), still no credits/about screen, and the stronghold's HARD bump being blunted by its size floor at low warband strength. None of these are "the shell isn't done" problems anymore — they're the normal residue of a shipped $5 indie game, not a tech demo.
