# Bannerfall — Hardcore Playtester Report (Panelist #2)

Persona: Thronefall all-mutators clear, 800+ hrs Bannerlord Realistic. I min-max, I look for the exploit before I look for the fun, and I judge an AI by whether it makes me pay for a mistake.

Played via `window.game` API in an isolated tab, blind (no source read). Real-world clock time visibly kept advancing the sim between my calls (rAF loop doesn't pause for API latency), which itself became a data point — see Exploit list.

## Run Log

| # | Encounter | Army in | Tactic | Result | Hero HP out |
|---|---|---|---|---|---|
| 1 | c1 patrol (wolf/brute/raider x2/raider), FOLLOW default | 4 spear, 120hp | Chased a fleeing kited raider solo, away from own troops | **DEAD** (4/5 kills, no credit) | -6 |
| 2 | c1 patrol remainder (bandit x3 + raider), after respawn | 2 spear, 60hp (post-death penalty) | HOLD from the start, hero never left troop cluster | **WIN**, flawless — hero took 0 chip damage the entire mob phase | 40/120 |
| 3 | c1 camp GARRISON, roll A (2 raider/2 bandit/1 Brute-420) | 2 troops (unhealed carryover), 60hp | HOLD | **DEAD** — troops died in ~15s to Brute's dmg24, hero followed | -7 |
| 4 | c1 camp GARRISON, roll B (2 bandit/**2x Brute-420**/1 raider) | 1 spear + 2 archer (bought), 120hp full heal | HOLD, then dash-retreat | **DEAD** — archers melted once both Brutes closed distance (60→12→3→0hp), dash pushed hero into the enemy cluster against the arena wall, not away | -7 |
| 5 | `battle_bridge` set-piece, "AMBUSHED! 6 vs 5", single bridge, enemies split 2 west-bank / 3 east-bank | 5 troops (3 spear/2 archer), 120hp | Held the bridge mouth, let the east group funnel across one at a time | **WIN**, near-flawless — 5/5 kills, **0 troops lost** | 60/120 |
| 6 | `battle_big` set-piece, 11 enemies incl. Brute, my 14 troops (7 spear/4 archer/3 knight) | 14 troops, 120hp | Tapped CHARGE once. Never touched hero again. | **WIN**, autopilot — 11/11 kills, hero **never moved, never took damage**, lost 3/14 troops | 120/120 |
| 7 | World speedrun probe: fresh reset → sprint N around c1's river, through c2's territory, avoiding both camps' home markers | 4 troops → died to a c2 patrol interception | CHARGE cleared 3/5 fast; committed troops on the Brute (all 4 died); hero solo'd the last Brute+bandit | **DEAD** mid-solo (hero traded ~24hp per ~22 dmg dealt to the Brute — a losing/even trade, not a stomp) | -8 |

**Speedrun verdict:** the overworld is geographically tiny — clean sprint from spawn to the c2/river-crossing zone took under 10 seconds of movement with zero combat, so a no-camps beeline to Wolfsjaw Hold is plausible on paper. In practice I could not complete it inside session: bridges are the only river crossings and camp patrols roam wide enough that a "clean" run is essentially a dice roll on whether a patrol's wander path intersects yours, not a guaranteed skip. I never reached the stronghold gate — five hero deaths on the *first* camp's garrison and a sixth on the speedrun attempt ate the whole session. That is itself the headline finding: **I did not beat the game in ~15 sim-minutes**, and I'm the panelist who's supposed to speedrun it.

## Exploit List (ranked by severity)

### 1. Deathball snowball — CHARGE + critical mass trivializes everything (Severity: game-breaking)
- **Setup:** Get troop count into the low teens with a mixed comp (spear/archer/knight). Tap CHARGE once.
- **Effect:** `battle_big` (14 v 11, including a Brute) resolved with the hero standing motionless at the spawn point, untouched, for the entire fight. No positioning, no target-priority, no dodging — just don't misclick the order key. This is the opposite of Bannerlord Realistic, where numbers alone never save you from bad terrain or a flanking charge. Here, numbers alone are the entire game once you have them.
- **Suggested nerf:** enemy composition/AI should scale with player army size (more archers/brutes focus-firing the hero specifically, or a captain-type enemy that targets the banner), so a 14-troop blob still has a way to lose if the player AFKs the hero.

### 2. Bridge/chokepoint funnel — near-zero-risk clear of "ambush" encounters (Severity: high)
- **Setup:** In any river-split arena, hold position at the bridge mouth on your side instead of advancing.
- **Effect:** A 6-enemy "AMBUSHED! 6 vs 5" scenario, which is explicitly framed as a harder surrounded fight, became a clean 5/5-kill, 0-troops-lost win because the far-bank enemies could only arrive one or two at a time. Thronefall and Bannerlord both use terrain to threaten the player (narrow keeps, river fords under fire); here the same terrain is a pure win-more button with no counterplay shown (no enemy archers volleying the choke, no bridge-breaking option for either side).
- **Suggested nerf:** give the AI's crossing group a ranged unit that stops at the far bank and fires across, or have them wait to mass up before crossing, so holding the choke costs chip damage instead of being free.

### 3. Lone-kiter crossfire trap (this one cuts both ways — see note) (Severity: medium, but the sharpest "punish mistakes" moment I found)
- **Setup:** A raider's `keepAway:150` kites it to the map edge when focused. Chasing it solo, off the troop ball, is the natural instinct.
- **Effect:** The other ranged units left behind get free, unanswered shots on an isolated hero. My very first death went 120→0 HP in well under 15 seconds of sim time this way, hero never re-grouped. This is a genuinely well-designed trap — it reads as "the AI punished my greed" rather than "the AI cheated." I'm listing it as an exploit-adjacent finding rather than a nerf target: **don't fix this, it's the one moment that felt like Bannerlord Realistic.** Flagging it so it survives future rebalancing.

### 4. Attrition asymmetry — patrol kills persist, garrison kills don't (Severity: medium, confusing rather than broken)
- **Setup:** Wandering "patrol" parties (met by walking into them on the overworld) are a genuinely different entity from a camp's "garrison" (met by pressing E at the camp banner).
- **Effect:** Confirmed by direct comparison of `world.save.parties` before/after: killing members of a patrol removes them from the world permanently, even if the hero later dies and the fight is scored `victory:false`. But the garrison fight fully re-rolls composition and HP on every single retry (my two c1-garrison attempts got two different rolls — one single 420hp Brute, one *two* 420hp Brutes) — a failed garrison assault banks zero progress, no matter how much damage you did. A hardcore player will learn this within 20 minutes and start "suicide-scouting" patrols for free permanent progress while treating garrisons as all-or-nothing coin flips. That's an inconsistent design contract the game never states anywhere in the UI.
- **Suggested nerf:** either persist garrison damage too, or telegraph clearly (in the "camps razed 0/3" HUD or an on-approach tooltip) that the garrison fight is winner-take-all with no partial credit.

### 5. Dash-into-the-corner (Severity: low, but embarrassing)
- **Setup:** Dash away from a closing melee pack while already near an arena boundary wall.
- **Effect:** The dash's direction is keyboard-relative, not danger-aware — pressing "away from the pack" while already backed against the wall dashed me a few pixels along the wall, not out of the enemy's reach, and I died the same exchange. i-frames (`iframesT≈0.37s`) are real and confirmed, but they don't save you if the dash vector doesn't actually create distance.
- **Suggested nerf:** none needed mechanically — this is a positioning skill issue — but the arena boundaries should be visually harder to miss (currently a thin teal strip, easy to back into blind mid-fight, see screenshot `hc_battle_c1_start.jpg`).

### 6. Real-time-keeps-ticking (harness artifact, flagged for the dev, not a player-facing exploit)
- **Setup:** The game's simulation clock is not gated behind the `step()` call — it runs on real wall-clock time via its own render loop regardless of whether the test harness calls `step()`.
- **Effect:** For a human on a controller/mouse this is invisible and correct (it's a real-time action game, of course it keeps running). But it means the game **never pauses**, not even to check a map or recruit menu — I did not find a pause button, and standing at the Ashford recruit prompt did not stop nearby patrols from wandering into me. For a genre that wants a Bannerlord-style "manage your warband" layer, the total absence of a pause/plan moment is a real design gap, not just a testing quirk.

## Skill Ceiling Assessment

Yes and no, and the split is stark:
- **Low army count (0–5 troops): real skill ceiling.** The difference between my death #1 (chase the kiter, die in 15s) and win #2 (HOLD, let troops tank, mop up) was 100% my decision-making, not gear. HOLD vs FOLLOW vs CHARGE genuinely changes outcomes here. This is the game's best moment.
- **Mid army with Brutes present: punishing, and rightly so.** Two 420hp Brutes with dmg24 and an AOE slam is a real check on positioning — respect the windup (0.95s) or eat 20% of your max HP. This is Bannerlord-Realistic-adjacent in feel.
- **High army count (12+): skill ceiling collapses to zero.** One command tap wins the fight with the hero as a spectator. Thronefall's night waves keep escalating pressure even at full build; Bannerlord's Realistic never lets troop count alone save a bad flank. Bannerfall, at least at the troop counts I reached, does let raw numbers substitute entirely for skill.

Does the AI punish mistakes? Individually engaging as an isolated hero versus a cluster of ranged units — yes, hard, fast, convincingly. Does the overall *system* (economy, respawn, garrison RNG) punish mistakes in a way that teaches you something? Partially — losing costs gold/troops and forces a market trip, which is a fair loop — but the garrison-reroll-with-zero-credit mechanic (#4 above) makes some losses feel arbitrary rather than instructive, which is the opposite of what a hardcore player wants from failure.

## Difficulty Verdict: unfair, specifically at the first camp's garrison

Camps razed 0/3, starting troops 4, starting gold 80. The very first camp's garrison fight can roll **two** 420hp/dmg24 Brutes alongside two bandits and a raider — 1,145 total enemy HP with the two hardest-hitting units doubled — against a starting kit that can afford at best 3 troops after a heal. I died to this specific garrison roll twice in a row with two different (both full-HP) reinforced loadouts. This is not "hard, learn the pattern" difficulty, it's "the RNG camp-guard roll can just be worse than the one that killed you last time, with zero carried progress." A fair curve would either fix garrison composition (so you can learn and adapt) or scale it to camps-razed-so-far rather than rolling blind on camp #1.

The overworld and set-piece arenas (`battle_bridge`, `battle_big`) are, by contrast, comfortably fair-to-generous once you understand HOLD/CHARGE — arguably too generous at the high end (see Exploit #1).

## Bar Scores (veteran lens, 1–10)

**Thronefall bar (combat readable at a glance, tight controls, polish):** **5/10**
Palette and HUD read cleanly (flat ochre world map, dark-indigo night battle, HP bars only when damaged, D-icon loot markers — this genuinely nails the reference screenshots' grammar). But the promised 3-command simplicity is undercut by two things Thronefall never has: (a) command state silently reverts to FOLLOW mid-fight (I had to re-issue HOLD/CHARGE more than once without any input from me causing it), and (b) there's no hit-stop, no visible kill-pop, no screen-shake I could detect from the state dumps or screenshots — the "juice" that makes Thronefall's combat feel percussive wasn't evident here.

**Bannerlord bar (commanding troops feels weighty, warband-grows fantasy):** **3/10**
The three-order system (Follow/Charge/Hold) is a decent skeleton, but troops move as an undifferentiated blob with no formation shape, no banner-carrying, no cavalry-momentum feel even for "knight" units. The campaign-map "grow your warband" loop exists (village recruit costs, army cap 12) but the reward for growing it is that the game stops requiring your attention (Exploit #1) rather than opening up bigger tactical decisions the way Bannerlord's formations and troop-tiers do.

## Direct Comparison: would I pick this over Thronefall or Bannerlord for a 5-minute session?

**Over Thronefall: no.** Thronefall's 5-minute loop is tighter, its readability is total, and its difficulty ramp (night waves) is honest about scaling. Bannerfall's best 5 minutes (the bridge hold, the HOLD-command mob clear) are Thronefall-shaped good ideas, but the same 5 minutes are just as likely to be me dying twice to a rerolled double-Brute garrison for no narrative or mechanical reason.

**Over Bannerlord: no, not close.** Bannerlord's 5 minutes always has a formation, a flank, a horse charge with real momentum. Bannerfall's "big battle" test proved that at scale the game plays itself — that's the one thing Bannerlord, even at its most numbers-advantaged, never does.

**Bottom line:** promising skeleton (HOLD/CHARGE/FOLLOW + chokepoint terrain + attrition economy are all real, defensible systems), but right now it loses to both reference games specifically at a 5-minute grain: too punishing and RNG-swingy at the low end, too autopilot at the high end, with nothing to fill the middle where the actual "skill ceiling" a hardcore player wants would live.
