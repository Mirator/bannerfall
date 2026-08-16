# Bannerfall — Round 5 Critique (harsh, as requested)

LOOP EXIT CRITERIA MET

Judged from live play (headless API + `window.__g`): variety sweep across battle_small /
battle_big / battle_bridge vs `references/thronefall/tf_1,3,6.jpg`; bridge funnel test with
position sampling; hand-piloted kill lab with freeze/flash/shake instrumentation; a full fresh
campaign — meadow bridge ambush → c1 camp raid at 3 hp → freed captives → heal/recruit at
Brindle → organic night interception at full gallop → c3 raid → Highmere knights + capacity →
9v18 ASSAULT ON WOLFSJAW HOLD, won. Screenshots in `shots/c5_*.jpg`. Zero console errors.

---

## 1. Verdict

**The seven-fights-one-field problem is dead. Bannerfall now generates a different battlefield
question per fight, kills land with felt weight, and the recruit shuttle is gone. What's left
is polish debt, not design debt.**

| Bar | R1 | R2 | R3 | R4 | R5 | One-line reason |
|---|---|---|---|---|---|---|
| Thronefall (combat feel, readability, simplicity) | 3 | 5.5 | 6.5 | 7.5 | **8 / 10** | Three real biomes, four arena templates with real collision (the bridge actually funnels), 90 ms kill-freeze + white flash + kill-shake that read, and the boring stretch (recruit shuttle) is deleted by freed captives. Docked from higher: small fights end in 4–6 s so individual kills blur, ambush spawns are too close, wolves are "flankers" by speed only, and Thronefall still wins raw density of spectacle. |
| Bannerlord (commanding an army in a campaign) | 2.5 | 4 | 6 | 8 | **8 / 10** | The map still mugs you honestly and now the battles remember where they happened. Interception geometry is real: a str-7 party cut me off *ahead of my path* at full 240 gallop. Held at 8, not raised: the stronghold is assaultable at 1/3 camps while the objective text says otherwise — an honesty crack in a game whose campaign layer is built on honest information. |

**BOTH bars ≥ 8. Loop ends.**

**The remaining-bar statement, explicitly: I would now prefer Bannerfall to Thronefall for a
5-minute session.** In five minutes Thronefall delivers one (beautifully polished) build-day and
night-defense. In my five minutes Bannerfall delivered: an AMBUSHED! interception on a meadow
bridge, a camp raid won at 3 hp with my whole warband dead, two freed captives filling the gap,
a night cut-off ambush by a party that out-thought my movement vector, a knight-buying spree,
and a 9-vs-18 final assault. Thronefall still wins polish-per-second (sound design especially —
which I cannot judge headless and do not score); Bannerfall now wins story-per-second, and at
the 5-minute scale story-per-second is the game. That is the bar R4 set, and it is crossed.

---

## 2. Round-5 claim verification (claim by claim)

| # | R5 claim | Verdict | Evidence |
|---|---|---|---|
| 1 | 3 battle biomes by map region (meadow west / rose midlands / night east) | **VERIFIED** | world.js:170 `biomeAt(x)`: <1150 meadow, <2150 rose, else night. Live: battle at x≈946 → meadow; camp raid at x=1050 → meadow camp (`c5_camp_meadow.jpg`, green field, red tents, pines); interception at x≈2597 → night (`c5_night_ambush.jpg`, indigo wash); Wolfsjaw assault → night (`c5_stronghold.jpg`). Test arenas: rose road (`c5_small_rose.jpg`), night camp (`c5_big_night.jpg`), meadow bridge (`c5_bridge_meadow.jpg`). Three scenes are distinguishable at a glance, like tf_1 vs tf_3 vs tf_6 — sparser than Thronefall's, but the per-level identity question is answered. |
| 2 | Bridge-chokepoint arena near map rivers | **VERIFIED** | The river is a real collision wall (column of r=42 blockers at x=650) with one gap (y≈356–532). CHARGE from the west: all 16 recorded crossings by 5 troops + hero happened at y=386–432 — everyone funneled across the plank, nobody clipped the water. Campaign: battle at x≈946 (within 140 of river x=1000) produced arena=bridge. One soft edge: my night interception collided at x≈2597 after the chase carried us past the 2430±140 margin → road, correct per the rule but the chase can drag fights out of the river zone. |
| 3 | Real two-flank ambushes + 'AMBUSHED!' banner when a chaser catches you | **VERIFIED** | battle.js:97–99 splits ambush spawns east (0.78 W) / west (0.10 W); `c5_bridge_intro.jpg` shows the AMBUSHED! banner with enemies on both flanks mid-frame. Campaign: both chase-collisions produced title 'AMBUSHED!' (world.js:313–314, mood=chase ⇒ ambush). Genuinely pincered — my rear flank was fighting before the east group crossed the bridge. |
| 4 | Wolves: fast fragile flankers, 4th enemy type, fang balloon | **VERIFIED with an asterisk** | data.js:89–92: hp 55 (half a raider), speed 158 (fastest enemy), windup 0.32, fang icon. They appear in world party comps and battles. Asterisk: there is no flanking *steering* — grep confirms no wolf-specific movement AI; "flanker" is emergent from speed + ambush side-spawns. They play as fast fragile bandits, which is still a real fourth verb, but the label oversells. |
| 5 | Impact weight: 90 ms kill freeze (hero kills), bigger shards, white death-flash, heavier shake | **VERIFIED** | battle.js:202 `freeze = max(freeze, 0.09)` hero-only; :190 `flash = 0.1` drawn as pure white body (:820); :198 shards 10 (16 brute); :203 kill shake 6 vs hit shake 2.5 (:347). Lab: 3 hand-piloted kills, instrumented max freeze exactly 90 ms each. `c5_killframe_1/2.jpg`: huge white slash arc + whitened dying body + shard spray. 90 ms ≈ 5–6 frames — this is felt, not subliminal. R4's G2 is closed. |
| 6 | Freed captives join at razed camps (recruit shuttle softened) | **VERIFIED** | world.js:263–271. Live twice: c1 raid ended with ALL troops dead — save showed exactly [spear, archer] after, the two captives; c3 raid: lost 1, gained 2. I never rode back west to rebuy troops the entire session. R4's most boring stretch is deleted, not softened. |
| 7 | Interception geometry: chasers lead their target (near-even 165, strong 185, hero 240) | **VERIFIED — the round's best moment** | world.js:285–289: lead = hero pos + 1.1 s of hero velocity. Live: riding east at full 240, a str-7 party (vs my 8) flipped to chase at d≈394 and positioned itself ON my path AHEAD of me (me at x=2223, y=1699 heading east; it at x=2397, y=1694), collision 1 s later. A 165-speed party caught a 240-speed hero by geometry, not cheating. R4 bug 3 is dead. |
| 8 | Coastline margin instead of edge bands | **VERIFIED** | battle.js:579 ("show coastline, not a band"): beyond the arena bounds there is now water with a navy shoreline. It reads as intentional "battle island" framing in every shot; the raw cyan/navy strips of R2–R4 are gone. Third-round bug finally closed. Mild oddity: an inland midlands field bounded by ocean, but it never reads as a glitch. |
| 9 | Intro banner needs 0.6 s before keys can skip it | **VERIFIED** | Key injected at t=0.4 s: intro stayed. Key at t=0.8 s: skipped, and the skipping press was consumed (no accidental order). R3/R4 bug closed. |

## 3. THE one biggest remaining gap

**Small fights are over before they get to be fights.** Of my six battles this session, three
ended in under 6 seconds (5.7 s, 3.9 s, ~6 s test skirmish). Ambush spawns start close enough
that the rear flank is dying while the AMBUSHED! banner is still fading; a CHARGE order plus a
competent warband resolves anything near-even before the second brute windup. The 90 ms kill
freeze is excellent — and mostly plays as a stutter of seven overlapping freezes in a 4-second
blender. Thronefall's fights breathe: waves arrive, the pressure oscillates, kills punctuate.
Bannerfall's big fights (Wolfsjaw at 13.9 s, camp raid at 9.7 s) have this; the small ones are
speed bumps.

**Concrete fix:** widen ambush spawn distance (0.10/0.78 → 0.04/0.90 of W, or gate enemy
aggro until the banner clears); give small parties a second wave (half spawn 4 s in, from the
flank the survivors came from). Both reuse existing systems.

## 4. Ranked remaining gaps

### G1. (Above — small-fight pacing.)

### G2. The objective text lies about the stronghold gate
- HUD says "Raze camps (x/3) → take Wolfsjaw Hold". I took Wolfsjaw at 2/3 (it was available at
  1/3). Either gate the assault or reword ("Weaken them: raze camps" as optional). This game's
  campaign trust is built on honest UI — badges tell the truth; the objective should too. It
  also lets the whole campaign be rushed in ~4 minutes, flattening the snowball arc.

### G3. Wolves deserve their name
- No flank steering; they're fast bandits with a fang icon. One line in the enemy goal logic
  (bias approach angle toward the target's rear hemisphere, like the troops' golden-angle jit)
  makes the label true and gives archers a real protection problem.

### G4. Scrum blob, residual (R4 G4 carryover)
- `c5_stronghold.jpg` center: 8+ units on one target still merge into a pale mass with
  overlapping HP bars. Cap melee slots per target at 4; extras orbit.

### G5. Small dishonesties and sparseness
- Hero still counts 3 in `myStrength()` while worth a warband piloted (R4 carryover).
- AMBUSHED! banner text is pale-on-grey — low contrast at the one moment it must scream.
- Night biome is a flat indigo wash vs tf_3's layered night (lit windows, torch glow at tents
  would close most of the distance).
- The world's rivers draw road-style dashes on the water (`c5_world_east.jpg`) — reads as a
  road painted over the river.

## 5. What works — don't break it

- **Biome inheritance.** Where you pick the fight decides what the fight looks like. My meadow
  bridge ambush, meadow camp raid, night road ambush and night stronghold assault were four
  different pictures in one session — R4's "one fight seven times" is gone.
- **The bridge is a real chokepoint.** Verified funnel: every unit crossed on the plank. Terrain
  finally asks a question in-battle, not just on the map.
- **Interception geometry.** Getting cut off *ahead of your own velocity vector* by a slower
  party is the most Bannerlord thing this game has done in five rounds. It converts riding into
  a decision (route around the 430 radius, or accept the fight).
- **Freed captives.** The economy now refills at the point of victory instead of taxing you a
  round trip. My c1 raid ended at 0 troops and 3 hp and the game handed me a new warband seed
  on the spot — that's a story beat, not a shuttle.
- **Kill feedback.** 90 ms freeze + white flash + shard spray + shake 6. Hand-killing bandits
  feels like hitting something now.
- **Honest fights at every scale.** 4v5 ambush, 4v5+brute camp at 3 hp, 6v7 night cutoff,
  9v18 finale — every one was in doubt at some point. Zero console errors again.

## 6. Bugs found this session

1. Stronghold assault not gated by the 3-camp objective the HUD advertises (world.js camp raid
   path vs `save.won` — design/text mismatch, see G2).
2. River dash overlay: world rivers render road dashes on the waterline (`c5_world_east.jpg`).
3. Freed-captives toast is easy to miss: fires during the victory-banner Space-mash and expires
   (3 s) before the world is visible again if the player skips fast. Consider queuing it 1 s
   after world re-entry.
4. Chase collisions can slide out of the nearRiver margin so an ambush *at* the river fights on
   a road arena (x≈2597 vs river 2430; margin 140). Use the chaser's mood-flip position, or
   widen the margin for ambushes.

## 7. Five-minute fun test

**Kept playing?** Yes — I finished the campaign without noticing I'd passed five minutes.

**Most fun moment:** the night interception. I was galloping east at full speed, watched the
str-7 party's badge flip to red, watched it stop chasing my *position* and park itself on my
*future*, and hit its line at 240 px/s — AMBUSHED!, indigo field, wolves first. The game
out-rode me with geometry and I respected it.

**Most boring stretch:** honestly, nothing map-side — the shuttle is dead and rides are 3–4 s.
The flattest moments are the sub-6-second skirmishes that resolve themselves under CHARGE
before the ambush drama can land (G1), and the victory-banner Space-mashing between beats.

**Bannerfall vs Thronefall for 5 minutes:** Bannerfall — see Verdict. Caveat repeated for
honesty: audio was unjudgeable headless, and audio is a real part of Thronefall's crown. If the
sound design is mute or thin, dock the comparison accordingly and treat kill/horn/ambush stings
as the highest-value polish left in the codebase.
