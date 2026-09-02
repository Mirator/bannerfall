# Gameplay audit — 2026-09-02

Scope: what separates the current build from an "AA" indie RTS (Thronefall, Bad North,
Kingdom Two Crowns tier). Six parallel Opus auditors, one per dimension: campaign loop and
economy, battle feel and tactics, UX and onboarding, presentation and audio, content breadth,
and a headless Playwright playtest of the live build. Every finding listed below was either
verified against source (`file:line`) or measured in the running game; claims that did not
survive a spot-check are omitted. Read-only: no source was changed for this audit.

## Headline

The engineering is above hobby level and the content is a vertical slice. Clean seams, pure
data modules, deterministic RNG domains, a real platform contract, zero console noise across
a full playtest. But: one fixed map (`makeRng(1234)` in `src/world/terrain.js:322`), one
region frozen as "exactly one" (`src/region.js:22`), three player unit types, two music
tracks, a settings screen with one toggle, and roughly 1.5-3 hours of content.

Plans 027-036 were almost entirely balance and legibility passes on that same slice. Five of
them chased one `test.fail` annotation. That work raised the *quality* axis; the AA gap is
now overwhelmingly on the *breadth*, *shell*, and *motion* axes, plus a handful of campaign
rules that undercut the game's own economy.

## Tier 1 — rules that break the game's own promise

1. **Every encounter is priced off `myStrength()`, so gold buys no advantage.**
   `spawnParty` targets `mine * band` (`src/world.js:441`), garrisons `mine * tier`
   (`:553`), the regional raid `mine * 1.1` (`:1170`), the reserve wave `0.8 * mine`.
   Measured: camp c1 sits at ratio 0.71 whether player weight is 4.6 or 12.6. The 400g cap
   ladder, the 550g banner, and every recruit raise both sides equally. On top of that the
   party band shifts from mean 1.15 to 1.44 as camps fall (`rollPartyBand`, `:409`), so the
   power curve is inverted: the player pays for harder fights. Fix: price encounters off
   campaign stage (razed, captured, elapsed) with a capped correction on player weight. **L**

2. **The strategic layer can be finished in ~2 minutes with no combat.** `claim` is free
   and unconditional on any neutral settlement (`src/world/site-menu.js:113-119`). Four
   claims give EXPOSED, remove the reserve wave (`src/region.js:193`), grant 4 perk points
   and four specialization bonuses. The raid timer starts at 110 flowing seconds and freezes
   while parked. Fix: a claim must cost something, and EXPOSED should gate on razed camps. **M**

3. **The copy pushes the strictly worse path.** Toasts say "Raid the camps" but razing all
   three sets `partyCap()` to 0 (`src/world.js:530`), absorbs remaining parties into the
   Wolfsjaw garrison, and kills gold income, while capture-only is better on every axis. **M**

4. **Wipe is a death spiral by design.** Defeat floors gold at 25 and backfills to two
   spearmen (`src/world/battle-transition.js:176,186`); the guaranteed "beatable" fight is
   ratio 1.30, which `src/data.js:439` itself records as a 27.9% win. Fix: adaptive floor
   after consecutive losses, free muster at a held settlement. **M**

5. **`ENEMY_TYPES.gold` is dead data.** Loot is `lootBase + bodies * lootPerEnemy`
   (`src/battle/combat.js:135`); the per-type field (`src/data.js:119-131`) has no reader.
   Gold per fighting weight: wolf 10.8, bandit 6.6, raider 5.1, brute 1.6, so fleeing
   wolf-heavy weak parties are the dominant risk-free farm. One-line fix. **S**

6. **Camp garrisons freeze at first passive scout** (`settlement-interactions.js:132-142`),
   priced off `mine` at that instant. Exploring early locks all camps at starter weight. **M**

7. **No campaign-level measurement exists.** The battle sweep runs 6930 probes; nothing
   measures time-to-victory, gold curve, or fight count. Estimated: full build 50-75 min,
   minimal victory 5-10 min. Fix: a headless N-seed campaign harness. **M**, highest
   process leverage.

## Tier 2 — battle: agency is capped by the input surface

8. **Arrows do not lead and connect only within 16px of a pre-fixed landing point**
   (`src/battle.js:728-742`). Flight time at range 230 is 0.68s; a closing bandit moves
   62px in that window. The bow line whiffs on anything moving. **M**

9. **HOLD does not hold in Break-the-position fights.** The objective-engage block at
   `src/battle/ai-phases.js:442` runs regardless of stance, and the `d > wantR` branch
   then overwrites the hold anchor. Consistent with 30/120 unresolved `holdLine` raids in
   `critiques/progression-comparison.md`. **S**

10. **No rock-paper-scissors.** Knight wins every duel (worst ratio 1.00 vs brute); spear is
    best per slot and 2x best per gold; archer is last on both and its 2.0x anti-brute
    bonus on HOLD computes to 11.8 dps, equal to a plain spearman. **L** to fix properly.

11. **No move-squad-to-point order.** Repositioning is FOLLOW, ride, HOLD. The deployment
    drag code already exists; a per-squad drag order reusing `holdX/holdY` is the single
    biggest agency unlock. Measured now: charge 23.7s / hero 120 HP vs idle 47.7s / 39 HP,
    so orders matter, but nothing on screen says so. **M**

12. **Hero is uncatchable and unpriced.** 64.7 single-target dps, speed 315 vs top enemy
    158, dash i-frames, `HERO_POWER = { dps: 0 }`. Playtest: a "they outmatch you" brief
    ended 5-0 in 13.5s with the hero unscratched. Either price the hero or cost the swing. **M**

13. **Enemy commander has five doctrine names and two behaviours** (`enemy-command.js`);
    `flank` and `break` issue identical orders; no retreat, no re-form. **L**

14. **Terrain is friction, never a position.** Hills are walls plus LOS blockers, woods are
    mud. Nothing rewards standing anywhere. Give hills a defender bonus. **M**

15. **Wolves stalk at 250, archer range is 230** (`ai-phases.js:733-742`), so a pack is
    unkillable until the 14s stall clock fires. Drop `WOLF_STALK_R` under 230. **S**

16. The damage model stacks to 3.28x (brace 1.8, flank 1.35, exposure 1.35) with no
    on-screen tell beyond the words "braced"/"shields down". **S**

## Tier 3 — the shell around the simulation

17. **No onboarding of any kind.** Zero hits for tutorial/hint/firstRun in `src/`. The one
    controls string (`src/main.js:747`) omits E, the only map verb. Playtest: dropped on the
    map with a win condition and no verbs. **S/M**

18. **No `devicePixelRatio` handling** (`src/main.js:38-50`). Every hairline and 11px HUD
    label is upscaled on any scaled or Retina display. Loudest "not shipped" tell. **S**

19. **R on the pause screen deletes the only save with no confirm** (`src/main.js:303`),
    and there is no quit-to-menu that keeps the campaign. **S**

20. **Escape stacks the pause overlay on top of an open modal** instead of closing it;
    PAUSE is handled before `scene.update` (`src/main.js:288-291`). **S**

21. **Settings is one mute toggle** while `setMusicVolume`/`setSfxVolume` and three buses
    already exist (`src/audio.js:182-190`) and are called only by a test. No fullscreen,
    scale, shake toggle, rebinding, colorblind, save slots. **M**

22. **Mouse is mandatory, no rebinding, no gamepad.** Bindings read the frozen
    `DEFAULT_BINDINGS` directly (`src/engine.js:109,113`). Blocks Steam Deck outright. **M**

23. Hold-to-attack missing (edge-triggered only, `ai-phases.js:330`); campaign map has no
    minimap or off-screen threat chevrons while battles have both; modals are click-only
    with no hover state; the brief modal lacks the `CHOICE_ARM_T` guard the spec/perk
    modals have; riding into a river gives 14s of silent zero progress (playtest). **S each**

## Tier 4 — motion and moment

24. **No interpolation between fixed steps** (`src/main.js:874-901`); at 120/144Hz roughly
    half of rAF callbacks hold the previous frame. **M**

25. **Units slide and pop out of existence.** Sine bob on a capsule, no walk cycle, no
    anticipation on player swings, death is an array splice plus particles. **M**

26. **World to battle is a hard cut.** `battle-transition.js` contains no drawing. **M**

27. World map is ~60% flat orange; battle ground has screen-spanning translucent polygons
    that read as alpha bugs (`battle/render-scene.js:153-172`); the stronghold finale
    renders on the same rose palette as a skirmish; the victory screen is a stat table on
    navy with the music set to null. In-world VICTORY/SKIRMISH banners draw under units. **S-M each**

28. **Audio: 17 SFX, 2 beds, mono, no panning, no distance, no intensity layers, no
    ambience, no infantry footsteps.** Stereo pan plus distance gain is the cheapest
    perceptual win. **S-M each**

## Tier 5 — breadth and shipping surface

| Feature | Today | AA bar | Gap |
| --- | --- | --- | --- |
| Maps / regions | 1 fixed map, 1 region | 8-10 levels or procedural | Critical |
| Difficulty | 1 boolean (x1.25 garrisons) | stackable modifiers | High |
| Player units | 3 types | per-level loadouts or upgrade trees | High |
| Enemy roster | 4 types, no bosses | distinct archetypes, escalation | High |
| Controller | none | full pad, Deck verified | Critical for Steam |
| Localization | none, inline literals | 8-12 languages | High |
| Achievements / stats | victory summary only | Steam table minimum | High |
| Steam host | ADR-001 accepted, zero implementation | shipping build | Critical |
| Store assets | none | capsule, trailer, page | Critical |

Structural blockers verified: `REGION` and `WORLD` are frozen singletons with hardcoded ids,
the save carries no region identity, terrain is authored against `S[0..3]` with a literal
seed. "Add a second region" is L to XL today.

## Doc drift

`CLAUDE.md:46` and `SCOPE.md:86,116` say save v4; `src/save.js:31` is `SAVE_VERSION = 5`.

## Recommended order

1. Campaign harness (7), then fix scaling (1), price the claim (2), wire loot gold (5).
2. Arrows lead (8), HOLD holds (9), squad move order (11), wolf stalk radius (15).
3. DPR (18), confirm on R (19), Escape closes modals (20), first-ride prompt (17),
   volume sliders (21).
4. Interpolation (24), scene transition (26), walk/death (25), stereo audio (28).
5. Only then breadth: seeded terrain, second region, difficulty modifiers, controller.

## Already reads AA

Menu vignette, hover panels, modal copy, odds vocabulary, spec/perk immediate-vs-ongoing
split, objective chip, hitstop and telegraphs, audio bus plumbing, zero console errors.
