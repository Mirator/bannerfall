# Bannerfall — Phase 2 FINAL RE-CHECK (Hardcore Veteran, solo pass)

Persona: Thronefall all-mutators, 800h Bannerlord Realistic. History with this build:
TF 5 / BL 3 (deathball autopilot + garrison reroll lottery) → TF 6 / BL 5 ("garrisons
fixed, gate landed, but CHARGE+AFK deathball still plays 80% of the game"). Bar for this
pass: both scores ≥8, judged as "would I pick Bannerfall over Thronefall / Bannerlord for
a 5-minute session."

Played live via `window.game` / `window.__g` in my own isolated tab
(`http://localhost:8474`). Every number below is read directly off live scene/save state
(`b.hero.hp`, `save.troops.length`, `save.camps`, etc.), not inferred. Session was
interrupted once by a harness process restart mid-run; the dev server and browser came
back cleanly (confirmed via `preview_logs` + reload) and I re-ran every test that mattered
for the verdict in the fresh session — nothing below is carried over unverified from
before the restart. Where I directly poked scene state for setup (teleporting the hero
between camps, forcing an identical pre-battle save for an A/B comparison) it's flagged
**[setup]**; all combat itself was played through the real input API (`key`/`tap`/`mouse`),
not scripted outcomes.

---

## Claim-by-claim verification

### 1. Banner aura (+20%/240px, −25%/420px) — VERIFIED, and it's a bigger deal than the claim states

Code confirms the exact formula (`battle.js:405`): `inspire = dh2 < 240² ? 1.2 : dh2 > 420² ? 0.75 : 1.0`,
applied to every troop attack's damage. The ring is drawn faint and rotating at r=240
(`battle.js:895`), readable but not obtrusive.

**AFK test, default battle-start spacing (hero spawns 587px from the enemy cluster — past
the 420px penalty line by construction):**

| Scenario | Setup | Result |
|---|---|---|
| 14 troops (7 spear/4 archer/3 knight) vs 11 enemies (incl. 1 brute), CHARGE tapped once, then zero input for the rest of the fight | `battle_big` scenario, live | **Won**, but in 65s and lost 4 of 14 troops. Hero — never touched — still took real damage climbing from 120 to 39hp from enemies that reached it once troops thinned out. |
| Same fight, hero actively ridden alongside the charge, swinging, staying near the banner | live | **Won in 11.1s, 0 troops lost**, hero ended at 87/120. |
| **6× faster, 4 fewer dead troops, healthier hero — for a fight that AFK still "won."** |

**Early-game camps (the actual mid-game content, not a synthetic stress test) — this is
the real finding: AFK now loses outright at realistic troop counts.** Fresh campaign,
hero teleported to each camp and given exactly one CHARGE tap, then untouched:

- **c1 (4 troops vs 7 enemies): DEFEAT.** Full trace: all 4 troops died one at a time
  between t=14s and t=23s (the fight was outside the aura's buff radius the whole time,
  so troops did 25% *less* damage than a repositioned player would get). The 3 surviving
  enemies then walked over and grieved the idle hero from 90hp to 0 by t≈30s, with the
  hero never once moving. Troops rallied to 2, gold floored 80→56.
- **c2 (2 troops vs 6, post-rally): DEFEAT again.** Gold 56→39.
- **c3 (2 troops vs 7): DEFEAT again.** Gold 39→27.

Compare to the same three camps played **actively** in one clean run: c1 won in 14–22.5s
(0–2 lost, +2 freed each time), c2 in 15–17s (0–1 lost), c3 in 16–18s (0–1 lost), army
grew from 4 to 10–11 troops through captures and recruiting, never dipping below the 25g
floor.

**Wolfsjaw, the finale, at two different roster sizes:** at mine-strength 10 (10 troops,
no knights), identical deterministic 12-enemy garrison (2 brutes) both times: **active
won in 15.8s** (hero dipped to a real 54/120hp — genuine tension), **AFK lost in 35s**
(troops rallied to 2, gold 295→207). At mine-strength 20 (11 troops incl. 6 knights,
scaled garrison rolled 18 enemies incl. 3 brutes), even my scripted "always attack
nearest enemy" active bot **lost outright** (hero died, gold floored to 25) — a naive
"stay aggressive" strategy isn't enough at the top end; something closer to real tactics
(kiting brutes, HOLD to form a chokepoint, disengaging to heal) is required.

**Verdict on claim 1:** true, and understated. The brief's own numbers ("~2 troops/22s
AFK vs 0 losses/14s active") describe a fight AFK still wins. What I found is stronger:
**at the actual early-game troop counts a real player has when they first reach camps
1–3, AFK now loses the fight outright**, not just slower-and-bloodier. The severity-1
complaint from my last two passes — "CHARGE+AFK deathball plays 80% of the game" — is no
longer true for the early/mid game. It resurfaces at the very top of the strength curve
(mine=20, Wolfsjaw), but there it resurfaces as "even active-but-unskilled play can lose,"
which is a different and much better problem to have.

### 2. Wolves hunt the backline (nearest ranged troop) — VERIFIED

Code (`battle.js:440-447`): wolves specifically scan for the nearest *ranged* troop
(falling back to nearest-any only if no archers exist), instead of the generic
nearest-friendly-of-any-type every other enemy type uses.

Controlled test **[setup]**: placed one wolf at (500,500), two spearmen adjacent at
20–40px (well within their own 140px engage range — they *should* be the "obviously
closest" target by any generic AI), and one archer 400px away. Command set to HOLD so
troops wouldn't chase pre-emptively. Result: the wolf **ignored both adjacent spearmen
entirely** and beelined 400px past them toward the distant archer, closed the distance,
landed an 8dmg bite (archer 60hp→52hp) before the pursuing spearmen caught up and killed
it. This is exactly the claimed behavior, not just a bandit/raider mixing in — confirmed
with a deliberately adversarial placement that would have failed under any "nearest
overall" logic.

### 3. Camp-victory toast fixed — VERIFIED, all three states

The regression from my prior recheck ("camps still stand" shown right after a camp was
razed, or total silence on a clean win) is gone. Live, in order, on a single fresh
campaign run:
- c1 razed: `"Camp razed (1/3)! 2 freed captives join your warband."`
- c2 razed: `"Camp razed (2/3)! 2 freed captives join your warband."`
- c3 razed: `"Camp razed (3/3)! 2 freed captives join your warband. Wolfsjaw Hold is unlocked!"`

All three are honest, all three appear (no more silent zero-loss wins), and the 3/3
unlock notice fires correctly. This was a two-line ordering bug last time; it's clean now.

### Console errors

None. `read_console_messages` with `onlyErrors` returned empty after the full campaign +
Wolfsjaw run.

---

## Where's the skill expression now (protocol 3)

- **Aura positioning**: real and load-bearing, not cosmetic. The difference between
  "hero within 240px" and "hero at default battle-start distance (587px, past the 420px
  penalty)" is the difference between a camp *winning cleanly* and a camp *losing
  outright* at early-game troop counts. That's the single biggest change in this build.
- **Retreat**: re-verified still functional (rode west past x<58 mid-fight, scene exited
  to world cleanly, no gold loss) — not regressed by the aura/wolf changes.
- **Order switching**: CHARGE is what I used throughout for speed; HOLD matters
  specifically for archers (stands ground instead of closing distance, per
  `battle.js:390`) which combined with the wolf-hunts-archers change gives HOLD a real
  tactical reason to exist now (archers who hold position and get protected vs. archers
  who wander and get run down) — I didn't have time to A/B this specifically but the code
  path is there and consistent with the design intent.
- **Dash i-frames**: used automatically by my bot at Wolfsjaw (3 dashes triggered under
  hp<35%+surrounded) — didn't save the mine=20 run, but that's appropriate: a defensive
  dash isn't a full answer to being tactically outmatched, it's one tool among several.
- **Tactical skill vs. mere "being active"**: the mine=20 Wolfsjaw loss is the most
  interesting new data point. A player who is "active" but not tactically sound (always
  charges the nearest enemy, never regroups, never lets troops form a line) can still
  lose the finale even with a numerically dominant army. That's a real skill ceiling, not
  just an attendance check.

---

## Re-scored: Veteran lens

| Bar | Prior (recheck) | Now | Justification |
|---|---|---|---|
| **Thronefall** (readable at a glance, tight controls, polish) | 6 | **8** | The thing that kept this bar capped — full-game autopilot trivializing 80% of playtime — is verifiably gone for the early/mid game: a realistic 4-troop camp-1 fight now **loses** on CHARGE-and-walk-away, and even the 14-troop synthetic stress test that still "won" AFK did so 6× slower and bloodier than active play. Fairness (last round's fix) plus now-real stakes for inattention closes the last big complaint about this bar. Held at 8, not 9+: no combat-juice pass, no HUD nudge for uncontested losses, no win-screen recap — all previously flagged, all still untouched, and those are what separate "good" from "great" on this specific bar. |
| **Bannerlord** (commanding troops feels weighty, warband-grows fantasy) | 5 | **8** | This is the real turnaround. Last round's core complaint was structural: numbers alone won every camp before the very last fight. That's no longer true — the aura's positioning requirement means early camps punish autopilot with actual defeats, not just attrition, and the finale now punishes *unskilled* active play too (mine=20 loss to a naive charge-everything bot), not only AFK play. The warband-growth fantasy finally has teeth across most of the campaign, not just the last 25 seconds of it. Held at 8, not higher: I only pressure-tested with one bot strategy at the high end — a genuinely tactical player (kiting, HOLD-chokepoints, retreat-to-heal cycles) would likely do better than my script did, so I can't yet certify the top-end difficulty curve is *well-tuned* rather than just *hard*; and the mid-game's "aura positioning" skill is the only tactical lever I found real teeth in — HOLD/FOLLOW/CHARGE switching and terrain use remain underexplored by the game itself (no fight so far has forced a chokepoint or an order-switch to win). |

**Bar (both ≥8): MET.**

**For a 5-minute session, would I now pick Bannerfall over Thronefall?** Yes, narrowly.
Thronefall is still tighter and more polished at the ten-minute mark, but Bannerfall no
longer has an obvious "solved" strategy for the length of a short session, which is what
actually matters for a quick sit-down. **Over Bannerlord?** Also yes, specifically for a
short session — Bannerlord's promise ("the warband you build determines the fights you
can win, and numbers alone don't always save you") is now genuinely present here in a
5-minute arc: raze three camps that punish inattention, then a finale that punishes both
inattention *and* unskilled attention. That's the shape of a good short session; full
Bannerlord doesn't compress into 5 minutes at all, so for *this specific* comparison
(short session, not "which game is deeper over 100 hours") Bannerfall wins the matchup.

**If either score needed one more point:** it wouldn't — bar is met. But if I had to name
the single next thing worth doing: give the mid-game camps (not just Wolfsjaw) at least
one enemy per garrison that behaves like the wolf-archer-hunter — i.e., extend "the enemy
AI specifically punishes a specific tactical mistake" beyond backline-hunting wolves and
beyond Wolfsjaw's brute count, so HOLD/chokepoint play has a reason to exist in camps 1-3
too, not just at the very end.
