# Phase 3 Coherence Audit — Bannerfall

Method: read src/data.js, src/world.js, src/battle.js, src/main.js (engine.js skimmed for helpers) with fresh eyes for rule/fiction mismatches, then verified every suspicion live in-browser via `window.__g`/`window.game` state probes (direct sim manipulation, not guesswork). Evidence below is either a file:line or a live-probe result; both are stated where available.

## Ranked worklist

### 1. World map has zero terrain collision — rivers, mountains, forests, rocks are all paint [Breaks-immersion]
The product owner's river/bridge question is a symptom of a much bigger gap: **nothing** on the campaign map blocks movement except the outer map edge.

- Evidence (code): `World.buildScenery()` (world.js:69-115) builds `mtn`/`tree`/`rock` items and `this.rivers` with bridge points, but `World.update()` (world.js:240-259, the hero movement block) never reads `this.scenery` or `this.rivers` — there is no collision test anywhere in the file.
- Evidence (live): teleported the hero onto a mountain scenery item (`x:2212,y:97,radius:~62`) and drove east for 1 sim-second — hero ended at `x:2422,y:97`, straight through, zero resistance. Separately drove the hero from `x:990` to `x:1440` (through the west river's ~140px band) in 2 sim-seconds in a dead-straight line, no slowdown.
- Bridges (world.js:74-75, 444-453) are drawn but never checked against hero/party position — `nearRiver()` (world.js:178) only chooses a battle-arena label, it doesn't gate crossing.

**Fix:** give rivers real collision (block/deflect hero+party movement across the river polyline except within ~50px of a bridge point) and treat mountains/rocks as circular obstacles with the same push-out math already implemented for battle obstacles (battle.js separation loop, ~line 536). Forests can stay decorative (or get a mild slow) if full collision is too much scope.
**Effort:** M — one distance-to-polyline/circle helper, applied to hero movement and party goal-seeking.

### 2. Banner aura is a floating rule with no in-world grounding [Breaks-immersion] *(seed example, confirmed)*
- Evidence: battle.js:906 comment literally states "banner aura: inside this ring your troops fight harder"; battle.js:411-413 applies a 1.2x/0.75x damage multiplier by distance-to-hero. The only in-scene tell is a faint dashed ring (`globalAlpha 0.14`) — no tutorial text, no VO, no relic/status explaining why standing near a banner makes men hit harder.
**Fix:** cheapest coherent fix is copy + a beat of juice, not a new system — name it ("the banner rallies them"), add one line of menu/tutorial text, and a small visual/audio cue when a unit crosses the ring boundary (enter/leave), so it reads as an effect instead of a hidden stat.
**Effort:** S.

### 3. Camp garrisons retroactively rescale to your CURRENT army — bandits "know" you leveled up [Breaks-immersion]
- Evidence (code): `garrisonStrength()` (world.js:144-146) computes `myStrength() * camp.tier` live, every time the camp is approached or raided; nothing freezes it at first sighting.
- Evidence (live): took the same camp object (`c1`, tier 0.7) — with the player's actual 4-spearman warband it returned garrison strength `5`; after swapping the save's troops to 20 knights (no camp interaction, just save mutation) the same call returned `30`. A camp you scouted on day one silently becomes 6x tougher once you've grown, with no fictional channel (spies, messengers) for the bandits to have noticed.
**Fix:** roll and freeze each camp's garrison the first time it's discovered/approached (persist in `save.camps`), instead of recomputing from live `myStrength()` on every check.
**Effort:** S/M — move the roll to "on first sight," store the result.

### 4. Battle arenas always spawn hero west / enemies east, regardless of real map approach direction [Breaks-immersion] *(seed example, confirmed)*
- Evidence (code): hero always inits at `this.W * 0.28` (battle.js:31), enemies always cluster around `this.W * 0.75` (battle.js:96); `world.js:191` passes no directional data into battle setup.
- Evidence (live): moved the hero to approach camp `c3` from the **south** (hero at `y:1850`, camp at `y:1750`, i.e. below/south of it) and triggered the raid — the resulting battle still placed the hero at `x:350` (west edge) with enemies spawned east, identical to any other approach angle.
**Fix:** derive an approach angle from the actual hero→target vector on the world map and rotate the battle's spawn placement (and the retreat-edge check, currently hardcoded `h.x < 58`) to match it, so "ride back the way you came" is literally true instead of a screen-space coincidence.
**Effort:** M — thread one angle value from world.js into the battle setup and rotate spawn/retreat geometry by it.

### 5. Hero always resurrects at Ashford on defeat, no matter where he fell [Breaks-immersion] *(seed-adjacent, confirmed)*
- Evidence (code): world.js:226 `save.x = WORLD.heroStart.x; save.y = WORLD.heroStart.y;` runs unconditionally in the defeat branch.
- Evidence (live): defeated the hero while at camp `c3` (`x:2500,y:1850`); post-defeat world state showed `heroX:620, heroY:1250` — the exact Ashford/start coordinates, a ~1900px teleport with no cart, ally, or fade-to-travel to explain it.
**Fix:** respawn at the nearest **unrazed settlement** (already have `WORLD.settlements` + `dist2`) instead of always Ashford, with a toast acknowledging it ("carried to the nearest village").
**Effort:** S.

### 6. Biome switches on a hard x-coordinate cutoff — an instant palette flip mid-map [Feels-prototype] *(seed example, confirmed)*
- Evidence (code): `biomeAt(x)` (world.js:177): `x<1150 ? 'meadow' : x<2150 ? 'rose' : 'night'`.
- Evidence (live): `biomeAt(1149) === 'meadow'`, `biomeAt(1151) === 'rose'` — 2 world-units of hero movement instantly recolors the next battle's entire palette, with no map-side landmark, gradient, or weather cue marking the boundary.
**Fix:** move the cutoffs onto the existing river x-positions (~1000, ~2430) so the palette change reads as "you crossed the river into different lands" (cheap, reuses geometry already on the map), or blend the palette over a wide band if more polish is wanted.
**Effort:** S (snap cutoffs to rivers) to M (real gradient blend).

### 7. The 'village' battle arena is dead code — structurally unreachable [Feels-prototype]
This one isn't just a smell, it's a logic bug: a whole arena template (3 houses + a windmill, battle.js:51-56) can never be selected in real play.

- Evidence (code): `arena:'village'` is only requested when `nearSettlement()` is true (radius 110, world.js:151-154). The only caller that leaves `arena` unset — the roaming-party collision battle (world.js:369) — only fires when `engaged` is true (world.js:338), which requires `!heroSafe`, i.e. `!inSafeZone()` (radius 260, world.js:62-67 / `BALANCE.settlementSafeR`). Since 110 < 260, `nearSettlement()===true` always implies `heroSafe===true`, which always implies `engaged===false`. The precondition for requesting 'village' and the precondition for the only call site that could request it are mutually exclusive.
- Evidence (live): placed a 2-bandit party directly on top of the hero (`dist:0`) while standing at Ashford and ran one update tick — scene stayed `'world'`, party count unchanged. No collision battle is even possible at that range near a settlement, confirming the arena can never trigger.
**Fix:** either loosen the safe-zone gate so a band between the two radii (110–260) can still produce a genuine 'village'-tagged ambush, or delete the dead branch if it's not worth wiring up this pass.
**Effort:** S either way.

### 8. Enemy strength badges and camp labels are omniscient meta-numbers with no in-fiction source [Feels-prototype] *(seed example, confirmed)*
- Evidence: camp label `Bandit camp ◆ ~${garrisonStrength}` (world.js:567); party badges show the exact `strength(p.comp)` colored red/black relative to `myStrength()*1.15` (world.js:586-591). The code comment (world.js:141) admits it's a meta HUD number ("Badges show THIS number...so players can judge a raid before taking it") — nothing in the fiction (scout, spyglass, rumor) explains how the rider knows exact enemy composition from a distance.
**Fix:** cheapest fix is a line of flavor text ("your scouts count the tents") rather than a mechanic change; a slightly deeper fix reveals the number only after the hero has lingered near the target for a beat ("scouted" state).
**Effort:** S.

### 9. Freed captives are always exactly 1 spearman + 1 archer, regardless of the camp's actual garrison [Feels-prototype] *(seed example, confirmed)*
- Evidence: world.js:317-321 hardcodes `freed === 0 ? 'spear' : 'archer'`, capped at 2 — independent of whether the razed camp's `comp` array had any human bandits at all (could be all wolves/brutes).
**Fix:** gate captives on the camp having contained at least one human enemy type, and randomize which type frees first instead of a fixed spear→archer order.
**Effort:** S.

### 10. The three villages are functionally and visually identical apart from name/position [Feels-prototype] *(seed example, confirmed)*
- Evidence: `drawSettlement()` (world.js:492-530) draws the same two houses for every non-town settlement; the recruit-menu text (world.js:666-668) is identical for every village (`Q Spearman 15g · E Archer 25g · F Rest & heal 10g`). Nothing distinguishes Brindle from Coldwell from Ashford except coordinates.
**Fix:** give each village one distinguishing trait (a cheaper unit, a unique building silhouette, a small price variance) using data already keyed per-settlement in `WORLD.settlements`.
**Effort:** S/M depending on scope.

### 11. Recruiting is unlimited at every village — no population, no depletion, ever [Feels-prototype] *(seed example, confirmed)*
- Evidence: `recruit()` (world.js:165-174) checks only `armyCap` and `gold` — no per-village manpower tracking exists. A single tiny village can outfit an entire army of knights, endlessly.
**Fix:** a soft per-village recruit counter that depletes on hire and slowly regenerates keeps it simple while making populations feel finite.
**Effort:** M — needs a counter + regen timer threaded through `recruit()` and the HUD prompt.

### 12. Roads are pure decoration — don't connect to camps, no one walks them, no speed/behavior tied to them [Feels-prototype] *(seed example, confirmed)*
- Evidence: roads are drawn only between the four settlements (world.js:456-461; Brindle–Coldwell isn't even connected), and a grep for "road" in world.js shows zero references outside that drawing block — no AI pathing, no speed bonus, no visual difference in how hero/parties cross on vs. off road, and camps aren't linked to the road network at all.
**Fix:** give roads one functional hook — e.g. a small move-speed bonus while on a road (same distance-to-polyline math needed for the river-collision fix above, so it can share code) — turns wallpaper into a real fast-travel incentive.
**Effort:** M.

### 13. "Night" is a location name for a palette, not an actual day/night state [Nitpick] *(seed example, confirmed)*
- Evidence: `BIOMES.night` is keyed to being east of x=2150 (world.js:177), not to elapsed time; the only uses of `this.time` in the file are animation phase offsets (windmill vane, banner wave, campfire flicker) — there is no clock, no time-of-day HUD, nothing that ever changes with real elapsed time.
**Fix:** purely a naming fix — call it something spatial ("Wolfsjaw-lands"/"dusk-marches") so the code/UI doesn't imply a day cycle that was never built. An actual day/night cycle is scope creep for this pass.
**Effort:** S.

### 14. Warband troop types are visually indistinguishable on the world map [Nitpick]
- Evidence: `drawHero()` (world.js:599-613) draws every trailing troop figure identically regardless of `t.type` — spearmen, archers, and knights all look like the same generic blue-caped rider until you actually enter a battle.
**Fix:** reuse the small per-unit icons/palette accents that battle.js already has for its squad balloons, applied to the world-map trailing figures.
**Effort:** S.

### 15. Free 20 HP heal on every victory, and the Wolfsjaw gate is framed as a bald difficulty wall instead of a reason [Nitpick]
- Evidence: `heroHp = min(maxHp, result.heroHp + 20)` fires on every win (world.js:200) with no fictional cause; the lock toast reads "Wolfsjaw Hold is too strong — raze all 3 camps first (n/3)" (world.js:289) — purely mechanical framing, no supply-lines/reinforcement fiction.
**Fix:** copy-only — reframe both as flavor text ("adrenaline of victory" for the heal; "Wolfsjaw won't fall while the camps still feed it — cut the supply lines first" for the gate).
**Effort:** S.

## What already feels MVP-grade

- **Deterministic, seeded camp garrisons** (world.js:296) so retrying a raid isn't a reroll lottery — a real fairness system, not placeholder difficulty (the *rescaling* in finding #3 is the actual issue, not the determinism itself).
- **Adaptive defeat diagnosis** (battle.js:1038-1043) — compares enemy vs. player strength and gives concrete, different advice depending on why you lost.
- **Combat feel**: hit-stop freeze frames, camera shake scaled to hit weight, and a genuinely well-built brute slam telegraph (expanding danger-ring + countdown fill, battle.js ~863-871) that teaches the read instead of just showing a timer number.
- **Retreat/disengage system** that preserves exactly the survivors you rode out with and skips the defeat gold penalty — a real distinct outcome, not "loss with extra steps."
- **Squad command layer** (FOLLOW/CHARGE/HOLD) with genuinely different AI behavior per stance, not a single attack-move dressed up three ways.
- **Party AI intent legible in-world**: chase-when-stronger/flee-when-weaker logic tied to the same strength scale as the badges, with a visible mood tell (flee "!" icon, badge color) rather than opaque dice rolls.
- **State persistence across scene transitions** (`persistParties`, the `onEnd` wiring) — gold, troops, camps, and roaming parties all survive the battle round-trip correctly; nothing silently resets.
- **Stalemate breaker** (`bloodlust`, battle.js:578-583) stops fights from soft-locking into permanent kiting — a deliberate safety net, not a gap that got noticed and shrugged off.

## Counts

Breaks-immersion: 5 · Feels-prototype: 6 · Nitpick: 4 · **Total: 15**
