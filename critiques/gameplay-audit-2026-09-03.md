# Gameplay audit — 2026-09-03 (second pass)

Scope: the same six dimensions as `critiques/gameplay-audit-2026-09-02.md`, re-run
against HEAD `de819e0` after Plans 037, 038, 039 and 040 slices 1-2 shipped. Six parallel
Opus auditors (campaign loop, battle, UX, presentation, breadth and process, headless
playtest), each told to re-verify the previous findings in its dimension from CURRENT
source and then look for new ones. Every claim below marked verified was re-checked by
hand against the tree before writing; claims that did not survive are omitted or marked
inferred. Read-only: no source was changed.

## Headline

Four plans in two days closed the campaign economy's worst rules: encounters are priced
off campaign stage, a claim costs gold, EXPOSED needs a razed camp, loot pays per body,
a wiped warband musters back to four and gets a beatable fight, HOLD holds, and the bow
line can reach a stalking pack. The campaign harness exists and is the best work in the
batch. Nothing outside the simulation moved: every UX, presentation and breadth finding
from the first pass is verbatim where it was.

Three things the plans shipped are not what their text says, and one process defect is
unambiguous:

- **A total wipe reports "YOUR LOSSES: none."** `src/world/battle-transition.js:178`
  aliases `save.troops = result.survivors || []`, then `:191-193` pushes the Plan 039
  volunteers into that same array, and `:219` maps `result.survivors` afterwards. The
  muster erases the casualties it exists to compensate for. Observed in the playtest with
  start 4, end 0, losses shown as none. Verified.
- **Slice 2's "structural contract" test guards the wrong constant.**
  `tests/e2e/stance-balance.spec.js:468-471` asserts the wolf stand band stays outside
  `UNIT_TYPES.spear.range`, which is 30. The property the comment describes is the 140 px
  hold reach, a literal at `src/battle/ai-phases.js:449` that lives in no constants file.
  `WOLF_STALK_R` can fall to about 34 before the test notices. Verified.
- **The garrison-freeze comment overclaims.** `src/world.js:582-585` says quantising the
  seed on stage "closes the audit's finding 12". `st.garrison` is still written once on
  first sight (`settlement-interactions.js:136`) and never re-rolled, so a camp scouted at
  stage 0 fights at stage-0 weight for the whole run. Verified.
- **59 `scripts/zz-*` scratch files are tracked, 7 MB in `scripts/`.** `.gitignore` covers
  `tests/e2e/zz-*.spec.js` but not `scripts/zz-*`. Two days added about 60,000 lines of
  committed JSON against about 160 lines of non-comment code. Verified.

## Status of the 2026-09-02 findings

| # | Finding | Status | Evidence at HEAD |
| --- | --- | --- | --- |
| 1 | Encounters priced off `myStrength()` | FIXED | `encounterBase()` `world.js:615-620`; floor, odds and mood keep `myStrength()` |
| 2 | Free claim, two-minute strategic layer | PARTLY | Claim 60/100 g (`data.js:619`), EXPOSED needs one razed camp (`region.js:158`), no grace on a claim (`world.js:1057`). Pacing unchanged: a whole campaign is 52-150 s of flowing clock |
| 3 | Copy pushes the worse route | PARTLY | Raiding now measurably better; toast at `battle-transition.js:159-161` unchanged; `partyCap()` still 0 with no live camps (`world.js:563-566`) |
| 4 | `partyCap()` empties the map | PARTLY | Survivors stay on the map and Wolfsjaw dispatches at neutral ground; camp spawns and income still stop |
| 5 | Wipe death spiral | PARTLY | Muster to `distress.musterTo` and `inDistress()` floor relief; the 25-gold floor is untouched and `farmer` still ends 12/12 runs at exactly 25 g |
| 6 | Dead `ENEMY_TYPES.gold` | FIXED | `lootFor()` `data.js:372`; gold per weight span 2.4x to 1.4x |
| 7 | No campaign measurement | FIXED | `tests/e2e/campaign-harness.js`, `campaign-arc.spec.js`, four critique files |
| 8 | Arrows do not lead, 16 px landing | OPEN | `combat.js:100-111`, `battle.js:732,736,739` |
| 9 | HOLD abandons anchor in camp raids | FIXED | `ai-phases.js:449,478,485`; playtest drift 1-7 px in a field fight, 6-40 px in a raid, one man 458 px |
| 10 | No roster counters | OPEN | Duel table unchanged: knight loses nothing, spear 2x gold value, archer last on both axes |
| 11 | No squad move order | OPEN | Plan 040 slice 4 unstarted |
| 12 | Hero unpriced and uncatchable | OPEN | `HERO_POWER = { dps: 0 }` `data.js:350` |
| 13 | Commander doctrines collapse | OPEN | `flank` and `break` byte-identical, `enemy-command.js:51-52` |
| 14 | Terrain never a position | OPEN | `terrain.js:166-186` returns a speed multiplier only |
| 15 | Wolves stalk outside bow range | PARTLY | `WOLF_STALK_R = 180`, band 162-225 inside 230; the guarding test is vacuous (above) |
| 16 | No hit-time tell for the 3.28x stack | OPEN | |
| 17-23 | Onboarding, DPR, R confirm, Escape stacking, settings, rebinding, hold-to-attack, world chevrons, modal hover, brief arm guard, silent river | ALL OPEN | Diff of `main.js`, `hud.js`, `render-actors.js`, `world-screens.js` since `0efc26e` is cache tokens plus one comment |
| 24-28 | Interpolation, walk/death animation, scene transition, map and palette, audio | ALL OPEN | Presentation files changed only in cache tokens |
| — | Banners drawn under units | NOT REPRODUCED | `battle/render-scene.js:330` draws the HUD last; treat the first pass as mis-scoped |
| — | Sweep fixture saturated at idle 94 / chargeAll 100 | FIXED | Plan 039 re-based it: `HELD = 4`, `stance-balance.spec.js:387` |
| — | Save version doc drift v4 vs code | OPEN | `CLAUDE.md:46`, `SCOPE.md:100,102,130` still v4 |
| — | Breadth blockers (fixed map seed, frozen `REGION`/`WORLD`, no region id in save, one-bit difficulty, no controller, no localization, no achievements, Steam shell at zero, no store assets) | ALL OPEN | `terrain.js:322` `makeRng(1234)`; `region.js:26`; `SAVE_VERSION = 5` with no region field |

## New findings

### Tier 1 — campaign rules that still undercut the game

1. **A campaign is 2-6 minutes long.** Measured on the shipped harness: `claimRush` 52 s
   and one battle, `campRaider` 150 s and 4.7 battles (`scripts/zz-campaign-p39final.json`).
   The harness teleports between legs, so real play is longer, but the playtest's held-key
   rides spent 93 percent of a minute jammed against a river, so real play is not longer
   for good reasons. Every other campaign finding is downstream of this. **L**
2. **Late-stage recovery is arithmetically unreachable.** `encounterStage.corrMin = 0.6`
   floors the correction, so a wiped 1.48-weight warband at stage 7 meets a 6.58 base:
   every generated force sits at ratio 3.3-6.6. Distress relief guarantees exactly one
   beatable party; the raid at base times 1.1 and the storm at base times 1.5 are out of
   reach. Verified arithmetic. **M**
3. **The beatable floor is not structural.** `trimToBeatable` never trims below one body
   (`world.js:546`) and `rollComposition`'s `bruteFits` checks only the target
   (`data.js:707`), so a comp that opens with a brute trims to `['brute']` at weight 3.07
   against a 1.33 cap. Frequency inferred, not measured. **S**
4. **Save and reload cancels every raid.** `raidCdT` lives on `game.pendingRaidCdT`
   (`world.js:151`) and is not in the save schema, so each reload restarts the 110 s first
   delay. The regional raid landed in zero of 48 harness runs. The playtest did see one
   land at 106 s under `keepAwake`, so the mechanic works when the clock is allowed to run;
   it is the cadence against a 52-150 s campaign and the reload reset that keep it dead in
   practice. Verified. **M**
5. **Criterion 3's `test.fail` hides regressions.** `campaign-arc.spec.js:178` fires only
   if the property reaches 12/12; it swallows 0/12, a harness throw, and the `continue` at
   `:184`. Assert the count instead. **S**
6. **Nothing to buy at the end.** `campRaider` finishes with 139 g unspent and total
   campaign income of 294-392 g; `bannerCosts[1] = 400` is unreachable. **S**
7. **The floor's fallback branch still prices off `myStrength()`** (`world.js:536`), the
   exact defect Plan 038 removed elsewhere. Harmless today, wrong by construction. **S**
8. **Razing re-homes parties to `'strong'`, which `campParties()` excludes**, so the live
   count can exceed `partyCap()`. Playtest: 3 to 8 parties in three idle minutes. **S**
9. Still open from the first pass with one-line fixes: Coldwell's unconditional free heal
   (`settlement-interactions.js:39`), WEAKENED has no modifier (`region.js:206-222`),
   `rollGarrison` skips `encounterWeightClamp` (`world.js:591`). **S each**

### Tier 2 — battle

10. **The sweep guard now rests on a defect.** After slice 1 the margin is idle 68 vs
    chargeAll 76, and idle carries 23 unresolved raids of 120 against chargeAll's 3.
    Unresolved counts as a loss. `critiques/orders-comparison.md:139` records that
    resolving the stalls takes idle to about 87 and chargeAll to about 78, which flips the
    project's one hard balance guard. Fix the metric (report unresolved separately) before
    the next balance slice. **S**
11. **About 19 percent of un-ordered camp raids never resolve, and there is no in-game
    time limit.** `holdLine` unresolved rose 18 to 25 of 120, idle 14 to 23. The 90-95 s
    figures are test budgets; a real player's only exit is the retreat edge. Cause per the
    comparison file: sticky tangent hysteresis in `steerAroundObstacle` against a static
    goal. **M**
12. **Slice 1 landed before slice 4 and left HOLD dominated in Break fights.** `objReach =
    140` means a held line can only break a guard it was parked beside, and the order that
    would park it there is unshipped. Inferred from logic; no sweep column exists. **M**
13. **HOLD has no protect-the-lord instinct.** Playtest: braced spears watched two bandits
    kill the idle hero 100 px away, then the aftermath read DEFEAT with all five men alive
    and no reason line. **S**
14. **A Break objective won by elimination leaves the HUD reading "2 guards standing"
    with both bars full.** Guards are also still not colliders (`objectives.js:79`). **S**
15. Open from the first pass: arrows, roster counters, hero pricing, doctrines, terrain
    as position, hit-time tells, odds word spanning 40 win points. No morale, no rout, no
    partial withdrawal; a body fights at full effect until it is spliced out.

### Tier 3 — UX and copy

16. **The stronghold chip's denominator lies.** It renders `points/maxPoints` with
    `maxPoints = 7` (`region.js:208`) while EXPOSED needs 4 points plus one razed camp
    (`:158`). A player at four captures and no raze reads "4/7" at WEAKENED and is told
    nothing about the missing input. **S**
17. **Stale copy.** "Raid the camps to stop the raids" fires on every victory with no
    toast of its own, including after all camps are razed (`battle-transition.js:159-161`).
    The recovery mechanic is announced ("N volunteers rally") but never explained. **S**
18. **Text overflow.** The aftermath panel reserves height by a 62-char estimate
    (`world-screens.js:812`) but wraps by measured width (`:864`), so the 125-char remnant
    note can overprint the Continue button. Map toasts clamp the box, not the text
    (`render-actors.js:215-219`). A toast raised on the last riding tick never decays
    because `msgT` only runs while time flows (`world.js:703`). **S total**
19. **The hero jams on terrain indefinitely.** Playtest: 57 of 60 s blocked in one seed,
    42 of 45 in another, once 30 px below a visible bridge. `moveBlocked` damps velocity
    to 0.2 per tick (`world.js:411-417`), which also drops speed under `worldWakeSpeed`,
    so the campaign clock freezes and the wordless freeze wash is the only cue. **S/M**
20. **The victory screen is a dead end**: CONFIRM only, save already cleared, the prompt
    blinks itself invisible a third of the time, music null. **S**
21. **The storm brief says "unknown — unscouted" and offers Confirm.** A first-run player
    walks into a 30 s wipe with no odds word. **S**
22. **The deployment camera does not frame the enemy**; the line is asked to form against
    an off-screen force. **S**
23. Open from the first pass: no onboarding at all (controls string at `main.js:729`
    still omits E and X), no DPR, R wipes the save with no confirm, Escape stacks pause
    over modals, settings is one toggle while three volume buses go unused, frozen
    bindings, no world minimap or chevrons, brief lacks the arm guard.

### Tier 4 — presentation (unchanged code, new measurements)

24. **Actor contrast fails.** WCAG luminance ratios from `data.js` and `visual-style.js`:
    enemy on rose ground 1.12:1, hero on the world map 1.43:1, friend and hero on meadow
    under 1.6:1. Readability is carried by the ink outline alone. Pure data fix, moves
    baselines. **S**
25. **Squads are indistinguishable at gameplay zoom.** Spear and archer share `radius:
    10`; 14 units render as one pale mass in `battle-big-night-camp.png`. **M**
26. **No easing anywhere.** Zero hits for any easing helper in `src/`; every panel, toast
    and bar appears instantly. **S/M**
27. **Particles are uncapped and lopsided**: 17 ring, 11 dust, 4 spark emitters;
    `arrowTrail` is declared and never emitted. **S**
28. **Boot is a blank navy flash** until fonts load (`main.js:1411-1432`). **S**
29. Open from the first pass: no interpolation, slide-and-pop units, hard-cut transition,
    flat map and alpha wedges, skirmish palette on the finale, bare and silent victory
    screen, mono audio with two beds and no ambience.

### Tier 5 — breadth and process

30. **Every breadth blocker is open**, and every commit since the first audit was Tier 1-2
    quality work in the order that audit recommended. Two of four plans shipped with an
    acceptance criterion known unmet and recorded.
31. **Prose to code is about 15:1.** Since `5bcd88c`: about 160 lines of non-comment code,
    339 comment lines, 2,335 lines of plan, progress and critique prose, 60,449 lines of
    committed scratch JSON. `AGENTS.md` is 1,005 lines and `progress.md` 1,446, each
    growing about 150 lines per plan. The v4 doc drift flagged in the first pass is still
    there, which is the symptom.
32. **Good news the first pass under-rated.** `region.js` is pure over `(save,
    definitions)`, `encounterBase()` is a single pricing point, `runSeed` is already
    persisted and validated, and the named-action layer exists. Seeded terrain is S, a
    second region is M rather than L-XL, and difficulty modifiers are S behind one save v6
    bump.

## What the playtest said improved

Claims are real purchases with legible prices and refusals. The wipe spiral is closed in
practice: a hopeless storm costs 24 g and returns the starting warband with two 0.7-ratio
parties in reach. HOLD holds. The regional raid rides out and lands with toasts at both
ends. The deployment phase and the storm brief read as finished screens. Camp raids read
as progress ("Camp razed 1/3", ENTRENCHED to WEAKENED). Zero console errors or warnings
across three sessions and four seeds.

## Recommended order

1. **One hour of hygiene.** Gitignore and untrack `scripts/zz-*`; fix v4 to v5 in
   `CLAUDE.md` and `SCOPE.md`; fix the wipe-losses aliasing; re-assert the wolf contract
   against a named `HOLD_REACH` constant; correct the garrison comment; make criterion 3
   assert a count.
2. **Fix the instrument before the next balance slice.** Report unresolved raids
   separately from losses in the sweep (finding 10), then fix the convergence stall (11).
3. **Campaign rules with one-line fixes**: `corrMin` scaled by distress or a two-party
   floor (2), the lone-brute trim (3), persist `raidCdT` and rescale the cadence (4),
   `partyCap` floor (8), banner price (6), free heal, WEAKENED, garrison clamp (9).
4. **Finish Plan 040**: arrows (8), then the move order (11), which also un-dominates HOLD
   in Break fights (12).
5. **The shell**: HUD denominator (16), copy and overflow (17, 18), river jam (19), DPR,
   R confirm, Escape, first-ride prompts, volume sliders, victory exit.
6. **Presentation**: contrast (24), easing (26), interpolation, transition, silhouettes.
7. **Then breadth**: seeded terrain, second region plus modifiers behind save v6,
   controller, Steam shell.


# Refresh — 2026-09-03, after Plan 041

Re-verified against `main` after the nine Plan 041 branches merged (`plans/041-top-ten-audit-fixes.md`):
two Opus verifiers read the current source for every finding above, and a third played the
merged build headless on its own port (screenshots under the session scratchpad, `playtest3/`).
Every status below was checked in code by hand before writing.

## Status of the 2026-09-03 findings after Plan 041

| # | Finding | Now | Evidence |
| --- | --- | --- | --- |
| 1 | Campaign is 2-6 minutes | OPEN | nothing touched pacing |
| 2 | `corrMin` 0.6 makes late recovery unreachable | OPEN | `src/data.js` encounterStage unchanged |
| 3 | Lone brute survives the beatable trim | FIXED | `trimToBeatable` replaces the last body from a frozen `heaviestLightBody` table; no `simRng` draw |
| 4 | Save/reload cancels every raid | OPEN | `raidCdT` still lives on `game.pendingRaidCdT`, not in `save.js` |
| 5 | Criterion 3 `test.fail` hides regressions | FIXED | `campaign-arc.spec.js` asserts `held >= 11` |
| 6 | Nothing to buy at the end | OPEN | `bannerCosts` unchanged |
| 7 | Floor fallback priced off `myStrength()` | FIXED | `encounterBase() * evenBand()` |
| 8 | Re-homed parties escape `partyCap()`; cap 0 with no camps | FIXED | per-home caps, floor 2, stronghold as spawn source |
| 9 | Free heal, WEAKENED cosmetic, garrison clamp | clamp FIXED; heal and WEAKENED OPEN | `rollGarrison` clamps; `settlement-interactions.js:38`, `region.js` states unchanged |
| 10 | Sweep guard rests on stalls counted as losses | OPEN | `raidSweep` unchanged |
| 11 | ~19% of un-ordered raids never resolve | OPEN, and worse than measured (below) | `steerAroundObstacle` untouched |
| 12 | HOLD dominated in Break fights until the move order lands | OPEN | `objReach = holdReach`; Plan 040 slice 4 unshipped |
| 13 | HOLD has no protect-the-lord instinct; defeat gave no reason | PARTLY | reason line shipped; `heroThreat` radius still 90 px |
| 14 | Break HUD lied on elimination; guards not colliders | text FIXED; colliders OPEN | `resolvedBy` set once in `resolveBattleResult`; panel text at `state === 'end'` |
| 16 | Stronghold chip denominator 7 | FIXED, new nit | reads `x/4` with a hint; the hint counts to the next rung while the fraction counts to the top |
| 17 | Stale copy, recovery unexplained | FIXED | toast gated on `liveCamps()`; distress line only when `inDistress()` |
| 18 | Aftermath overprint, toast overflow, stuck `msgT` | PARTLY | panel height from the same wrap; `msgT` decays; map toasts still clamp the box not the text |
| 19 | Hero jams on rivers | FIXED for the clock, PARTLY for progress | 598/600 live ticks and 695 px travelled, but 164 px net: the rider skates along the bank |
| 20 | Victory screen dead end | FIXED, new nit | two steady rows and an Escape exit; the first row's key hint is clipped by a banner pole |
| 21 | Storm brief offers Confirm with odds unknown | OPEN | `world-screens.js` brief model unchanged |
| 22 | Deploy camera ignores the enemy | FIXED | both sides and the frontier in frame on every deploy |
| 23 | No onboarding, no DPR, R wipes save, Escape stacks pause, one-toggle settings, frozen bindings, no world chevrons, brief unarmed | DPR FIXED; R, Escape and controls text FIXED; the rest OPEN | `main.js` view/scale, `abandonArmT`, `QUIT_TO_MENU`, `isBlocking()` gate |
| 24-29 | Presentation (contrast, silhouettes, easing, particles, boot, interpolation, transition, audio) | ALL OPEN; 25 worse | deploy framing draws the same units smaller in six re-recorded baselines |
| 30-32 | Breadth blockers; prose-to-code ratio; scratch files | breadth OPEN; ratio now ~1:1 code to comment with tests at 3:1; 27 scratch files untracked, `.gitignore` covers new ones | `git ls-files scripts \| grep -c zz-` = 32 |

## New findings from the refresh

1. **A field fight under chargeAll can deadlock forever.** Observed on seeds 3, 7, 11 and 21
   through the production brief: 95, 128 and 300 s runs all ended in `fight` with zero
   casualties and the lines pinned 54-55 px apart, while HOLD or no order won the identical
   fixture in 32 s. The sampled battlefield carries two woods of radius about 320-360 directly
   between the lines. This is the signature Plan 035 recorded at world (1600, 900) and excluded
   from its probe, so it is most likely pre-existing rather than introduced here, but that was
   not bisected. The camp raid on HOLD in the same session also hit the 95 s cap. There is no
   in-game time limit; the only exit is the retreat edge. **Highest-impact open item.**
2. **The re-recorded defeat baseline shows a defeat that cannot happen.** A real non-retreat
   defeat only comes from hero death (`result.heroHp = max(1, hp)`), so "Your line broke" is
   reachable only through the externally ended `world_aftermath` fixture, which is what the
   baseline captures: reason line, no losses, hero at 60. Real play shows "Your lord fell".
3. **The break panel's bars contradict its text**: "Position taken — garrison destroyed" sits
   above two full guard bars dimmed to 0.45 alpha, an alpha-only state.
4. **The river cue is gated on the freeze wash by design**, so a rider skating along a bank
   with the clock flowing sees no line; it appears only when every heading is blocked. Judged
   a contract, not a defect (the slide is the feedback), and the text got an ink plate.
5. **An audio warning fires on every scene switch**: "music bed could not start — The play()
   request was interrupted by a call to pause()", six times in one session. It is
   `console.warn`, so no gate catches it; CLAUDE.md's rule names `console.error` only.
6. **Copy collisions**: the map toast overlaps the stronghold objective panel at 1280 px and
   truncates to "C…"; the SETTINGS controls block and the pause armed line are unclamped;
   the new objective-resolution strings and chip hint fit by luck with no `fitText`.
7. **`moveBlocked` now deflects instead of damping**, so pinned-seed hero trajectories differ
   from every campaign measurement recorded before Plan 041 even though the `simRng` stream is
   untouched. Re-baseline the campaign harness before quoting a before/after across it.
8. **The DPR fix wraps `ctx.setTransform` on the live context.** It works and is documented;
   the minimap and battle tile offscreen buffers still bake at CSS pixels.

## Recommended order, revised

1. Bisect and fix the chargeAll deadlock (new 1) together with the sweep metric (10) and the
   convergence stall (11); they are one problem measured three ways.
2. Persist `raidCdT` and rescale the cadence (4); scale `corrMin` by distress (2); honest
   defeat reason and one re-record (new 2); guard bars follow `resolvedBy` (new 3).
3. Finish Plan 040: arrows lead, squad move order.
4. Shell: first-ride prompts, storm-brief odds (21), brief arm guard, volume sliders, world
   chevrons, the copy collisions (new 6), the audio warning (new 5).
5. Presentation: contrast, silhouettes (now more urgent at deploy zoom), easing, interpolation.
6. Then breadth.
