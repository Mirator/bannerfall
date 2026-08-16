# Phase-3 MVP Verification — Bannerfall

Method: fresh browser tab against `http://localhost:8474`, every claim probed live via `window.game`/`window.__g` (direct sim manipulation), not read off the source alone. Screenshots saved under `shots/mvp_*.jpg`. QA suite run twice (before and after the manual-probe session) via `/tests/qa_suite.js`.

**QA suite: 15/15 passed, both runs. No console errors observed.**

## Per-claim verification

### 1. Rivers/mountains/roads real, parties reach you, chase across a river — PARTIAL (core mechanic fixed, real regression found)
- **Hero collision: FIXED, verified.** Drove hero straight at a mountain (`solids[0]`, x:2212.8 r:44.5) — stopped clean at the boundary (`x:2138` vs solid edge), no clip-through. Drove hero across a clean river segment with no bridge nearby — stopped at `x:916` (river starts ~950), never crossed. Same test at a bridge point (`985,640`) — hero crossed cleanly (`x:1706` after driving through), confirming bridges are the real chokepoint.
- **Road speed: FIXED, verified exactly.** Pinned hero position (to hold `onRoad()` constant while velocity converges) at an on-road point vs an off-road point: measured terminal speed **276 on-road vs 240 off-road — ratio 1.15, exactly +15%.**
- **REGRESSION — roaming parties get permanently stuck at rivers.** Placed an isolated `chase`-mood party on the west bank of the central river with the hero visible 300px away across the water (no settlement safe-zone involved, position verified clean of any solid). The party correctly entered `mood:'chase'`, advanced ~30px toward the river, then **sat completely motionless for 120 simulated seconds** — `blockedAt` at its own resting spot returns `false` (it isn't stuck ON a solid, it's stuck AT the collision boundary with zero recovery). Reading `world.js:453`, the "unstick and re-pick a goal" logic only fires for `mood !== 'chase'` **and** only rewrites `p.wander` — but chase/flee parties don't use `p.wander` as their goal, so the exception never actually reroutes them. There is no bridge-seeking pathfinding for parties at all: the only reason the same party eventually closed distance to 41px was that I moved the hero to stand almost exactly on the bridge tile, making the straight-line intercept vector coincidentally pass through it. The fleeing case (weaker party, `mood:'flee'`) shows the identical symptom — 24+ seconds frozen at the exact same river.
  - **Practical effect on the "chase across a river" question:** from the *player's* side, crossing a bridge to escape works great (hero pathing is manual and correctly bridge-gated). But from the *world's* side, an enemy party chasing you across a river doesn't route to the nearest bridge — it just walks into the water and stops, indefinitely, looking broken rather than intelligent. It also means a player can trivially and permanently shed any pursuer by running to an unbridged riverbank, which undercuts the fantasy more than it should for something billed as "chase."
  - This is exactly the kind of regression the audit's harness brief was worried about ("parties stuck against rivers forever (watch party movement 30s+)") and it reproduces cleanly.

### 2. Scouting freeze — FIXED, verified
- Unscouted camp: `garrisonStrength()` returns `null` at 650px and at 350px (just outside 340). Approaching to 300px rolled and froze the garrison, fired the toast `"Your scouts count the tents — the camp holds ~5 bandits"`, and persisted `save.camps[].garrison`.
- Mutated `save.troops` to 20 knights afterward (no camp interaction) — `garrisonStrength()` still returned `5`, unchanged. Confirms the "bandits don't magically reinforce" fix holds under direct save mutation, not just normal play.

### 3. Wolfsjaw musters only when the 3rd camp falls — FIXED, verified
- Forced wins on c1 then c2 via `startBattle`/`endBattle(true)`: `save.camps.find(c=>c.id==='strong').garrison` stayed `undefined` after both.
- Forced win on c3 (the 3rd): `strong.garrison` populated (12-unit remnant force) and the toast read exactly `"Camp razed (3/3)! 2 freed captives join your warband. The bandit remnants rally at Wolfsjaw — storm it!"`.

### 4. Directional battles — FIXED, verified in two directions
- Approached camp c3 from the **south** (hero y > camp y): resulting battle had `approach:'N'`, hero placed toward the south edge (y:669 of H:880), `retreatDir:'south'`, enemies clustered north (avg y:202). Coherent: you rode up from the south, enemies are ahead to the north, retreat takes you back south.
- Approached camp c2 from the **east** (hero x > camp x): `approach:'W'`, hero placed on the east side (x:925 of W:1250), `retreatDir:'east'`, enemies clustered west (avg x:313). Also coherent.
- This replaces the old hardcoded hero-west/enemies-east layout the audit flagged (battle.js now derives `adx/ady` from `setup.approach`, which `world.js` computes from the real hero→target vector via `approachTo()`).

### 5. Defeat → nearest settlement — FIXED, verified far from Ashford
- Raided c3 (2500,1750, far corner), forced a loss. Hero landed at `(2050,1230)` — Highmere/"keep", the nearest settlement to c3, not Ashford — with toast `"Your men carry you to Highmere — the survivors regroup"`.
- Also tested from the extreme map corner (3140,2160): still resolved correctly to Highmere with the same named toast, no odd out-of-bounds placement.

### 6. Banner aura self-label — FIXED, verified visually
- Screenshot (`mvp_banner_aura.jpg`) shows the dashed ring plus fading text **"⚑ men rally to the raised banner"** during the opening seconds of the fight (`battle.js:923` gates it on `this.time < 7`).

### 7. Settlement specialties — FIXED, verified live and visually
- Ashford: spear cost 100→88 (**12g**, confirmed). Brindle: archer cost 100→80 (**20g**, confirmed). Coldwell: heal left gold at 100 (**free**) with toast `"The hot springs of Coldwell mend every wound — free of charge"`.
- Screenshot at Brindle (`mvp_brindle_prompt.jpg`) shows the on-screen prompt itself carries both the flavor and the price: *"Village of Brindle — woodland hunters, keen eyes / Q Spearman 15g · E Archer 20g · F Rest & heal 10g"*.

### 8. Biome cutoffs snapped to rivers — FIXED, verified
- `biomeAt(1029)==='meadow'`, `biomeAt(1031)==='rose'`, `biomeAt(2429)==='rose'`, `biomeAt(2431)==='night'`. Cutoffs now sit at 1030/2430, inside the actual river bands (~900–1050 and ~2350–2500), matching the audit's suggested fix instead of the old arbitrary 1150/2150.

### 9. Captive scaling + village-outskirt ambush — FIXED, verified both halves
- Captives: all-wolf garrison (0 humans) → 0 captives freed. 2-human garrison → 1 captive. 6-human garrison → 2 captives (capped). Toast correctly omits the captive line when 0 are freed.
- Village ambush: placed hero+party at 180px from Ashford (inside the 130–260 "outskirts" band, outside the true 110px safe radius) with grace expired — battle triggered with `arena:'village'`. Screenshot (`mvp_village_arena.jpg`) confirms the previously-dead-code village arena (3 houses + windmill) actually renders in a real triggered fight.

### 10. Party strength comparison text — FIXED, verified visually
- Screenshot (`mvp_party_compare.jpg`) shows a party with strength 10 vs. hero strength 7 rendering **"⚠ 10 vs your 7"** in red/warning color at 420px range, matching `world.js:698-702` exactly.

### 11. Distinct world-map warband figures — FIXED (code-confirmed, partially visually confirmed)
- Code draws spearmen with a line glyph, archers with a bow-arc glyph, and knights as a visibly larger figure with a gold (hero-colored) head marker vs. ink-colored for others (`world.js:711-728`). A zoomed screenshot (`mvp_warband_zoom.jpg`) clearly shows the bow-arc archer glyph distinct from the plain spear figure; the knight/spear distinction is smaller and reads best at closer zoom than the default camera — legible but subtle at normal play distance.

## Regression hunt summary

- **Confirmed regression:** roaming parties (chase and flee moods) have no river/bridge-aware pathfinding and get permanently stuck at river banks — reproduced with 120s of continuous simulation with zero recovery. This is a direct side effect of the new terrain-collision system (finding #1) not having AI-side handling to match the player-side handling.
- **No hero-trap found:** scanned the full solid layout on a 40px grid for fully-enclosed walkable pockets (all 8 neighbors blocked) — zero found. Hero mountain/rock collision uses the same axis-separated slide as before, confirmed smooth (no jitter/oscillation) in the direct drive-in test.
- **Retreat edge:** verified reachable and directionally consistent for two tested approach directions (N, W); formulas are symmetric across N/S/E/W so no asymmetry bug expected for the untested pair.
- **Camp raid from a bridge tile:** camps always pass an explicit `arena:'camp'` regardless of position — not affected by nearby rivers. A roaming-party collision forced to happen exactly on a bridge tile correctly resolved to `arena:'bridge'`, not a mismatched arena.
- **Defeat near map edge:** tested from the literal far corner (3140,2160) — resolved cleanly to the nearest settlement, no glitch.
- **Scouting toast spam:** camps are far enough apart (all >800px, scout radius only 340px) that overlapping scout triggers can't occur; not reproducible with the current map layout.
- **QA suite:** 15/15 both before and after the full manual-probe session; no state corruption from repeated `scenario('world')` resets.

## The 4 known-unshipped audit items — do they still block MVP feel?

- **#11 Recruit depletion (still unlimited):** `recruit()` still only checks `armyCap`/gold, no per-village counter. Minor — doesn't block the loop, just means villages don't feel finite. Feels-prototype tier, not a blocker.
- **#13 "Night" as a location name, not a real day/night cycle:** still unfixed, `BIOMES.night` keyed purely to map position. Purely cosmetic/naming; doesn't block anything, would only matter if a player expected a real day/night system.
- **#15 Victory auto-heal fiction:** the +20 HP-on-win still fires with zero explanation everywhere *except* Coldwell (which now has a real, explained free-heal mechanic per claim 7). The generic post-battle regen is still an unexplained number. Nitpick, doesn't block.
- **#12 Road network gaps:** re-checked live — `roadSegs` now has 5 entries (up from 4) and roads are functionally real (claim 1's +15% speed), but the specific gap the audit called out is **still present**: settlement pairs are `[ashford-brindle, ashford-coldwell, brindle-keep, coldwell-keep, ashford-keep]` — **Brindle and Coldwell are still not directly connected** (only reachable via Highmere or Ashford). Minor, doesn't block — every settlement is still road-reachable, just not by the shortest visual path.

None of these four block the MVP feel on their own. They're all consistent with "small remaining polish," not "missing core system."

## Overall MVP verdict

**Score: 7/10** (bar was ≥8 — falls just short)

A 10-minute session now reads as a small, coherent world with real rules: terrain has teeth, camps have a memory (frozen garrisons, no retroactive rescaling), villages have a reason to visit each one, defeat and victory both have a legible in-fiction consequence, and fights orient themselves to how you actually rode in. That is a genuine, substantial jump from the "prototype with painted-on fiction" the phase-3 audit described — all 11 claimed fixes were verified live and hold up, including under adversarial probing (save mutation, forced defeats far from home, direction-flipped approaches).

What keeps it from clearing the ≥8 bar: the new terrain collision system, while excellent from the hero's side, exposed a real and easily-reproduced AI gap — chasing/fleeing parties freeze at river banks with no way to find a bridge, which will be visible to any player within the first few minutes near either river (both rivers run most of the map's height, and starting parties patrol near them). It reads as "enemy AI broke" rather than "world has rules," which is the opposite of what this pass was for. Combined with four small still-unshipped polish items (unlimited recruiting, the "night" misnomer, the unexplained default heal, the Brindle–Coldwell road gap), the session is very close but not quite a finished-feeling small game yet.

**Top remaining gap:** give roaming parties bridge-aware pathfinding (or at minimum, an "unstick" fallback for chase/flee moods identical to the one wandering parties already have at `world.js:453`) so a river-crossing chase doesn't end with the enemy silently giving up at the water's edge.

---

## Re-verification addendum (post bridge-routing fix)

Coordinator reported a fix: parties in any mood now probe 42px ahead along their goal vector, and if that point is river-blocked, retarget to whichever bridge minimizes `dist(party→bridge) + dist(bridge→goal)` (`world.js:445-458`), reverting to the direct goal once within 66px of the chosen bridge. Re-verified live in a freshly reloaded tab (force-navigate, QA suite re-run: **still 15/15**).

**(a) Original frozen-chase repro — PARTIAL FIX, not fully resolved.**
Re-ran the exact original scenario (isolated chase party at `(700,800)` west bank, weak-vs-strong hero at `(1050,800)` east bank, same y for both, no settlement/solid interference). Result: the party now correctly retargets to the bridge and closes most of the distance in ~2s — a real improvement over the old "never moves" behavior. But it then **stops permanently at `(985,760)`** and stays there for the full 300 simulated seconds I let it run. Root cause traced live: `blockedAt()`'s river-block radius (22px around the polyline) and its bridge-exemption radius (62px around the bridge point) don't form a continuous funnel at every approach angle — probing y=760 down to y=600 in 10px steps at x=985 shows a **blocked band from y≈710 to y≈750** sitting between the party's resting spot (y=760, clear) and the bridge's tolerance zone (y≤702, clear). The party is 120px from the bridge (outside the 66px "stop redirecting" gate, so it keeps aiming at the bridge every frame) but the very next step toward it is still blocked, so `moveBlocked` just decays velocity to ~0 and it freezes again — a narrower version of the original bug, not a full fix.

**Confirmed this is angle-dependent, not universal:** re-tested the coordinator's own configuration (party `x:1150`, hero `x:880`, **both at y:640**, i.e. level with the bridge at `985,640`) — party crossed cleanly in **2.2s** and caught the hero (battle triggered at t:2.8s). So the fix works correctly whenever the party's approach is roughly aligned with the bridge's own y/x-level (which is the common case — most spawn/patrol positions end up reasonably close to a bridge's transverse position), and only fails in the specific case where the party needs to travel through the ~40-60px blocked annulus that still exists between the river's raw collision radius and the bridge's exemption radius at an off-axis approach. This is meaningfully better than before (previously 100% of off-bridge-axis crossings failed permanently; now only a narrower band of approach angles does) but it is not the complete fix the coordinator described — the exact scenario I originally flagged still ends in a permanent freeze.

**(b) Flee across a river + bridge chokepoint — CONFIRMED WORKING.**
- Weak party (1 bandit) vs. strong hero (10 knights), party positioned between hero and the bridge, both level with it (y:640): fleeing correctly routed away from the hero, across the bridge, and off into open ground on the far bank in ~1s, successfully escaping (mood dropped back to wandering once out of engagement range).
- Re-ran with the hero actively pursuing (scripted WASD input) instead of stationary: hero closed the gap and **caught the fleeing party right at the bridge** — battle triggered at t:1.5s with `arena:'bridge'`, `approach:'E'`. That is exactly the "natural chokepoint moment" asked about, and it reads correctly in a live playthrough, not just in theory.
- Also tested giving the party a 3s head start before the hero moved: the party escaped fully across and beyond into open ground; the hero's own crossing was fine (bridges work perfectly for the player, as established in the original claim-1 verification) — the pursuit-script's own hero drifted off-axis afterward chasing the escaped party's wandering y-coordinate, which is an artifact of my naive test script, not a game bug.

### Re-score

**New score: 8/10** — bar (≥8) **met**, narrowly.

**One-line reason:** the bridge-routing fix converts what was a universal, guaranteed-to-break-in-the-first-few-minutes regression into a much narrower edge case that only reproduces at specific off-axis approach angles, and the intended "chase/flee across a river with a real bridge chokepoint" fantasy now plays out correctly in the common/aligned case — which is enough to cross the bar, but not enough to call the underlying issue fully closed.

**Still broken:** the original repro (party and hero level with each other but offset ~120-160px from the bridge's own transverse position) still ends in a permanent freeze at the edge of a blocked band between the river's raw collision radius and the bridge's exemption radius — confirmed frozen for a full 300 simulated seconds with zero recovery. It's rarer and less likely to be hit than before, but it is not eliminated. A player who happens to be pursued along a line that passes 60-150px to the side of a bridge will still watch the pursuing party stall out at the water's edge. Tightening or removing the gap between the two collision radii (e.g., a continuous distance-based falloff instead of two disjoint circles) would close this for good.
