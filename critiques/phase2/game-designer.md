# Bannerfall — Design Review (Phase 2, Game Designer pass)

Judged purely on design fundamentals: loop structure, pacing curve, economy/balance,
decision depth, onboarding, motivation arc — not polish, not bugs-for-bugs'-sake.
Played live via the headless API (`window.game`, `window.__g`) plus a full read of
`src/data.js`, `src/world.js`, `src/battle.js`, `src/main.js`. Screenshots in
`shots/gd_*.jpg`. I deliberately played part of this session *passively* (letting
commands and the world run without hand-piloting every swing) specifically to see
what the systems do without a skilled player propping them up — that's where most of
these findings came from.

---

## Scores (design lens)

| Bar | Score | One-line reason |
|---|---|---|
| Thronefall (combat feel, readability, simplicity) | **7 / 10** | Palette/HUD discipline is genuinely good and the three orders are functionally distinct in code, not skins — but enemy-comp variance (a "small" camp can roll two 420-hp brutes) and the melee scrum turn some fights into unfair, unreadable blenders rather than Thronefall's clean, telegraphed rhythm. |
| Bannerlord (commanding an army in a campaign) | **6 / 10** | The map-layer decisions that exist (biome choice, interception geometry, spearman→knight slot economy) are real and good. But the three things that make Bannerlord's risk fantasy *mean* something — a gated climax, consequential defeat, and the ability to disengage a losing fight — are each either missing or hollow. Verified live: I walked from the start tile straight to Wolfsjaw Hold with a 2-troop starter warband and the game let me start "ASSAULT ON WOLFSJAW HOLD" at 0/3 camps razed. |

Both land below the round-5 pass score. That's a deliberate lens difference, not a
disagreement about facts: round 5 verified that features *work as coded*; this pass
asks whether the *structure* they sit in makes decisions matter. A functioning gate
that isn't a gate, and a defeat state that isn't a defeat, are correctness successes
and design failures at the same time.

---

## Session arc log (what actually happened, in order)

1. **0:00 – Menu.** Full-screen title, honest tagline ("Raise a warband. Raze the
   camps. Take Wolfsjaw Hold"), and a control-legend card. This is told, not taught —
   more on this below.
2. **0:00–0:04 sim-s.** Pressed forward twice off the start tile and was already in a
   battle (`gd_battle1_intro.jpg`) — a wandering party collided with me before I'd
   made a single real decision. Meadow/bridge arena, 4 v 5, readable Thronefall-style
   palette.
3. **~0:21.** Won that fight passively (didn't hand-pilot the hero at all) — but lost
   2 of 4 troops to do it. Gold 80→115. This is the game working as intended: troops
   cost real casualties even in a "won" fight.
4. **~0:25–0:37.** Moved two seconds and walked into a *second*, unrelated party
   ambush at 2-troops-remaining strength. Lost that warband down to 0 troops, hero to
   20 hp, dashed away — the encounter resolved as a **defeat** (see Finding 2). Gold
   115→81 (exactly the coded 30% loss), respawned at the start tile, hero at 60/120 hp.
5. **~1:00.** Recruited at Ashford (3 spear + 1 archer, healed to full) — the economy
   loop itself reads clearly: Q/E/F prices are posted, gold visibly drains, HUD
   updates instantly.
6. **~1:10.** Rode to camp c1, triggered "RAID THE CAMP — 5 vs 5"
   (`gd_camp1_intro.jpg`) — a proper camp vista (tents visible at distance), not an
   instant clash. Issued CHARGE and stood still to see what troops-alone do: **12
   seconds in, 3 of 4 troops were dead for 2 kills** — troops without hero support
   lose fights they should win.
7. **~1:22–1:36.** Hero (still full HP, hadn't taken a hit) walked in solo against
   the last 3 enemies — which turned out to be **two brutes** (a "size 3" early camp
   rolling 2×420-hp bosses is possible per the `R() < 0.15/0.25` brute-chance roll).
   Hand-piloted swings, hero dropped 120→12 hp without landing a further kill, then
   died. Second **defeat**, gold 11, troops rebuilt to 2 (not from actual battle
   survivors — see Finding 2), respawned at start again.
8. **~1:40.** Live-verified the stronghold gate: warped the hero to Wolfsjaw Hold
   (0/3 camps razed, 2 weak troops) and pressed E. Result: `ASSAULT ON WOLFSJAW HOLD`,
   `AMBUSHED! 3 v 8`, immediately (`gd_stronghold_skip_test.jpg`). No check against
   `razed` count exists in `world.js` — this is not a fluke, it's how the code is
   written (confirmed by reading `nearCamp`/`KeyE` handling, `world.js:250-274`).

Total: ~8 in-game engagements' worth of signal packed into a short, rough session —
which is itself informative. A smooth, skilled playthrough (like round 5's) glides
past the seams; a clumsier one falls straight through them.

---

## Top 5 findings, ranked by design impact

### 1. The climax has no lock — the entire campaign arc is optional fiction
**What:** `world.js` handles the stronghold exactly like any other camp: `E` near it
starts the fight regardless of `razed` count on c1/c2/c3. HUD reads "Take Wolfsjaw
Hold · camps razed 0/3" the whole time, implying a requirement that isn't enforced.
**Why it matters:** This is the single biggest structural problem for the Bannerlord
bar specifically. "Start alone → snowball → assault the stronghold" is the growth
fantasy the brief asks us to judge against. If the assault is available turn one,
there is no arc — the 3-camp progression is set dressing, and a player who doesn't
already know the "intended" pacing (most players) can stumble into the final fight
under-leveled and either bounce off it confused or trivialize the whole game by
rushing it. Either way the mid-game (recruiting, biome variety, interception) never
gets to matter because nothing forces the player through it.
**Fix:** Gate `E` on the stronghold behind `razed camps >= 2` (leave one raze-able
optionally), and make the HUD text match whichever number is chosen exactly ("2/3
camps razed — Wolfsjaw is undefended enough to strike" vs. current always-visible
"Take Wolfsjaw Hold").

### 2. Defeat doesn't cost anything that a five-minute fight can't undo
**What:** Death → `save.gold *= 0.7`, `save.troops` keeps every-other-index of the
**pre-battle** troop list (not actual survivors — even a total wipeout during the
fight still returns troops on defeat), hero heals to 50%, teleport to start tile.
There is no captivity, no game over, no lasting map consequence — the enemy party
that beat you is simply removed from the world either way.
**Why it matters:** Bannerlord's tension comes from losses being expensive and
sometimes irreversible (troops die for real, you can be captured, a lost battle can
cost a settlement). Here, losing and winning both end with "the threat is gone, you
have some troops, go again." I hit two defeats in this session and neither one
changed how I played — there was no fear response, just a shrug and a re-recruit.
That flattens every risk decision on the map (which fight to pick, whether to
retreat, whether to push the last enemy) because the downside is uniformly mild.
**Fix:** Make the troops you keep on defeat actually be the in-battle survivors (not
a recompute from the pre-battle roster — currently more forgiving than a *win*
would be for that same battle). Consider a real cost: temporarily locked settlement,
a captured troop needing gold to ransom back, or losing the run's current biome
foothold. Even one of these would make "should I fight this" a real question again.

### 3. No disengage option, paired with unsignposted comp variance, creates unfair spikes
**What:** `battle.js` only exits via `enemies.length === 0` (victory) or
`hero.hp <= 0` (defeat) — there is no retreat/flee. Enemy comp rolls independently
per slot (`R() < 0.15` brute chance for regular camps), so a nominally "easy" size-3
camp can roll two brutes (`gd_camp1_solo.jpg`: 340/320 hp brutes vs. a solo hero) with
zero warning beyond the pre-fight troop-count banner.
**Why it matters:** Combined with #2, this is a strange risk profile: you are locked
into every fight you start (high commitment, Bannerlord-appropriate), but losing
barely matters (low stakes, not Bannerlord-appropriate) — so the lock-in produces
frustration (an unwinnable draw you can't leave) without producing the payoff that
would justify it (real stakes for winning through). A player who reads "5 vs 5" and
commits has no way to know the composition skews brute-heavy until they're already
losing troops to find out.
**Fix:** Either let the player disengage (run off the arena edge into a "fled" state
with a cost between victory and defeat), or telegraph composition before commit —
the world map already shows party-strength badges; extend that same read (brute/
archer/wolf icon counts) onto the intro banner.

### 4. Command depth is real in code but illegible without a hero physically fighting
**What:** Verified in `battle.js:363-419` — FOLLOW keeps troops in formation near the
hero and engages only nearby threats; CHARGE sends troops at the nearest enemy
anywhere on the arena; HOLD roots troops at a point and only engages within melee/
ranged range (archers don't even reposition). These are three genuinely different
behaviors, not a relabeled single AI. But when I left CHARGE running with the hero
standing still, troops lost 3 of 4 in ~12 seconds for 2 kills against an equal-sized
camp — the game does not make it legible that the hero's presence
(`heroThreat`/`nearestEnemy` radius 90–260) is doing real work, so a new player who
treats orders as "set and forget" will watch a winnable fight go badly and not know
why.
**Why it matters:** This is the single best system in the game for the Bannerlord
"commanding an army" bar, and it's currently invisible. The onboarding card lists the
three keys but never explains *when* to use which, or that the hero is a combatant,
not a camera.
**Fix:** Either buff unsupported troop performance so orders alone can win fair
fights (safety net for new players), or add one HUD/tutorial beat the first time
troops are taking losses without the hero nearby ("Your warband needs you — ride in").

### 5. The win screen doesn't sell the thing the whole game built toward
**What:** `main.js:122-138` — victory is one static screen: "WOLFSJAW HAS FALLEN",
one line of flavor text, gold amassed, press Enter. No recap of the run (camps
razed order, peak warband size, battles fought, troops lost/recruited, time played).
**Why it matters:** The Bannerlord growth fantasy is retrospective — the pleasure of
"look how far the warband came from 4 starter troops." A single gold number doesn't
capture that arc, and it's a cheap thing to build relative to its narrative payoff,
especially since the campaign layer already tracks every one of these numbers in
`save`.
**Fix:** A short stat block on the victory screen — camps razed, peak troop count,
knights recruited, battles won/lost — turns the ending into a payoff instead of a
stop.

---

## What already works — do not break

- **Biome inheritance and arena identity.** Meadow bridge vs. meadow camp
  (`gd_battle1_intro.jpg` vs. `gd_camp1_intro.jpg`) read as different places, not the
  same fight recolored. This is real design work and should survive any of the
  fixes above.
- **The three troop orders are functionally distinct, verified in code**, not
  re-skinned single AI (see Finding 4) — the ingredient list for good command depth
  is present, it just needs a legibility pass, not a redesign.
- **Posted, honest economy prices.** Q/E/R/F/T costs are shown on-screen at the
  point of decision (`Spearman 15g · Archer 25g · Knight 60g`, `+2 army cap 40g+`) —
  no hidden math, and my own session's spearman-vs-knight slot-value comparison
  checks out as a real, if under-explained, progression: cheap bodies early
  (gold-scarce, cap loose) give way to knights once the 12-slot cap — not gold — is
  the binding constraint (a knight gives ~70% more HP and ~66% more DPS per *slot*
  than a spearman, for 4x the gold). That's a legitimate curve; it's currently just
  invisible to the player.
- **Freed captives at razed (non-stronghold) camps.** Refilling the roster at the
  point of victory instead of a shuttle back to a village is good pacing and should
  not be removed even if defeat consequences get heavier.
- **The onboarding tagline is honest about the *shape* of the loop** ("raise a
  warband, raze camps, take the hold") even though the game currently doesn't
  enforce that shape (Finding 1) — fix the enforcement, keep the promise.

---

## Note on onboarding specifically

The menu tells rather than shows: a control-legend card lists WASD/mouse/orders
before the player has touched anything, which is more Bannerlord-manual than
Thronefall-silent. For a prototype this is a defensible shortcut, but it means the
game is not yet testing whether its own systems teach themselves — worth revisiting
once Finding 4 (troop-order legibility) is addressed, since a HUD nudge at the right
moment could replace some of the up-front text dump entirely.
