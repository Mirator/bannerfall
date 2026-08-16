# Bannerfall — Phase 2 RE-CHECK (Game Designer + Hardcore Veteran, combined pass)

Re-scoring after the builder round. Played live via `window.game` / `window.__g` in an
isolated tab (`http://localhost:8474`). All battle outcomes below are read directly off
live scene state (`b.hero.hp`, `b.troops.length`, `b.enemies`, `save.gold`, `save.camps`,
etc.), not inferred from screenshots. Where I set up a scenario directly through
`window.__g` (positioning the hero, forcing `save.gold`, forcing troop rosters, killing
specific units to test survivor bookkeeping) it's flagged inline as **[setup]**. One
harness quirk bit two of my scripts mid-session: the sim clock keeps running in real
wall-clock time between tool calls (rAF/watchdog never pause for API latency, confirmed
independently by both prior panelists), so a couple of my multi-call scripts drifted into
an unintended battle or an unintended defeat while I was composing the next call. Once I
collapsed each test into a single atomic script this stopped being a problem — noted here
because it's a real property of the game, not just a test artifact: **the game never
pauses, including at menus/prompts**, which was already flagged pre-fix and remains true.

---

## Claim-by-claim verification

### 1. Wolfsjaw gated behind 3 razed camps — **FIXED**
Live: teleported hero to Wolfsjaw Hold at 0/3 razed, pressed E → no battle starts.
`msg: "Wolfsjaw Hold is too strong — raze all 3 camps first (0/3)"`. Screenshot
`shots/rc_gate_locked2.jpg` shows **three independent, consistent** honest readouts at
once: top-right HUD ("Raze the bandit camps (0/3) to unlock Wolfsjaw"), the camp-prompt
card ("Wolfsjaw Hold — enemy stronghold / Locked: raze all 3 camps first (0/3)"), and the
toast. Razed all 3 camps in a live playthrough (see campaign run below) and the same gate
correctly opened at 3/3 and the assault started. No way to bypass found. This closes the
single biggest structural hole from the prior pass outright.

### 2. Defeat: real survivors, 25g floor, rally-to-2 — **FIXED**
Three isolated **[setup]** tests, all matching the code:
- 5 troops in, manually killed 3 in-battle, forced hero death → `save.troops` came back
  as exactly the 2 that were actually still alive (their real hp, not a recomputed
  half-count of the pre-battle roster). Gold 20 → floored to **25**, not `20*0.7=14`.
- 2 troops in, killed all of them, forced hero death → `save.troops` came back as
  **2 fresh spearmen** with the message *"Ashford volunteers rally to your banner — ride
  again"*. Gold again floored to 25.
- A win-condition side effect I hadn't asked for but is worth noting: because the floor
  is unconditional on every defeat (not cumulative), the specific casual-playtester death
  spiral from the prior round (9 gold, 10g heal cost, "soft-locked") is now **structurally
  impossible** — gold cannot drop below 25 as a result of losing, and a 10g heal is always
  affordable afterward.

### 3. Retreat (ride off west edge) — **FIXED**
Live, twice: once from a party ambush (4 enemies, 2 killed mid-fight, hero rode to
`x<58` after `time>3`) → `WITHDRAWN`-equivalent path taken (`result.retreated`), survivors
kept at their live hp (`82/82` from `100/100` after a few seconds of combat), **gold
unchanged**, and the fled party re-spawned on the map with only the survivors of the
original comp (`comp.slice(kills)` — 3 killed of 4 → 1 `wolf` remained on the map).
Once more from a **camp** fight (arena `'camp'`, not just party ambushes) with the same
result: camp stayed `razed: false` (so it's re-attackable later, and — per claim 4 — will
roll the *same* garrison again if warband strength is unchanged), troops and gold
untouched. `canRetreat` defaults true everywhere I checked (camps included); I found no
arena where it was disabled.
One implementation nitpick, not a functional break: the "party persists minus its dead"
uses `partyMeta.comp.slice(result.kills)` — an index slice into the *original* comp array
by kill-count, not an actually-tracked list of which specific units died. If a raider dies
third and a bandit dies first, the reconstructed remaining party can show the wrong unit
*type* surviving even though the *count* is always correct. Cosmetic in practice (I only
noticed by comparing type lists), but "the enemy party persists minus its dead" is
slightly stronger phrasing than what's actually implemented.

### 4. Deterministic, scaled camp garrisons — **FIXED (retry lottery), PARTIALLY ADDRESSES intent (scaling)**
- **Retry determinism, verified 3×:** same camp (c1), same warband (4 spearmen, `mine=7`)
  → **identical** enemy comp all three times (`bandit×6, raider×1`). The veteran's
  "garrison reroll is a coin-flip with zero credit" complaint (Exploit #4 in the prior
  report) is gone — this is now a learnable, repeatable puzzle, exactly what was asked
  for.
- **Scaling + brute cap, verified across 3 strength bands at the same camp:**
  `mine=7` → 0 brutes (bruteCap 0 below 8) · `mine=11` → 1 brute (cap 1, 8–11) ·
  `mine=17` → 2 brutes (cap 2, 12+). The specific unfair spike the veteran hit twice in a
  row last round — **two 420hp brutes rolled at camp #1 with a 4-troop starting
  warband** — is now **structurally impossible**: at game start `mine=7 < 8`, so `bruteCap
  = 0` and camp #1 cannot roll a single brute, let alone two. This is a real, verified fix
  to the single worst "unfair, not hard" complaint in the veteran's report.
- **What this does *not* fix (see Veteran section below): the deathball/CHARGE-AFK
  exploit.** Scaling the garrison's *strength number* up alongside the player's own
  strength does not, by itself, introduce anything that punishes an idle hero — it just
  makes both sides bigger proportionally. I confirmed this trivializes every *mid-game*
  camp exactly as before; only the endgame stronghold (fixed high roster: 2 brutes
  regardless of scaling, larger absolute body count) turned out to have real teeth. Full
  data in the Veteran run log below.

### 5. Trust bugs — **FIXED (2 of 2 tested)**
- **Upgrade price honesty:** live-purchased a `T` army-cap upgrade at `armyCap=12`,
  charged exactly 40g, matching the displayed `40 + (armyCap-12)*20` formula exactly (both
  the HUD string and the charge use the same `BALANCE.armyCapBase` reference now, not the
  old hardcoded `-8`).
- **Standing hero-death check:** set `hero.hp = 0` directly, bypassing `damageFriendly()`
  entirely, during the battle's `'intro'` state — correctly *not* caught yet (intro state
  returns before the check, as designed), then advanced into `'fight'` state and it was
  caught on the very next tick, ending the battle in defeat. The redundant "never rely
  only on the damage path" check at `battle.js:556` genuinely works as a backstop.
- **World RNG evolves across battles:** confirmed in code (`makeRng(777 +
  battleCount*7919)`); not independently re-verified with a side-by-side comparison this
  round, lower priority given the other two are load-bearing trust issues and both
  checked out.
- **Watchdog:** the specific line QA flagged (`lastTick` never reset inside the
  `setInterval` branch) is still, literally, unchanged in `main.js`. But the surrounding
  fix — replacing the old single `game.update(DT)` per watchdog tick with a real
  accumulator (`acc += (now-last)/1000`, capped, drained in a `while` loop) — resolves the
  actual hazard QA cared about (sim time silently decoupling from wall time / running at a
  wrong fixed rate). Since `last` (not `lastTick`) is the variable that gates how much sim
  time gets added, and it's correctly updated in both the `frame()` and watchdog paths,
  the practical "state silently advances at the wrong rate between explicit test-API
  calls" risk is gone even though the exact line suggested wasn't touched. Grading this as
  fixed-in-substance; flagging the unchanged line as a paper-cut for whoever touches this
  next.

### 6. Party-vs-camp messaging — **REGRESSION FOUND, not fully fixed**
The **camp-approach prompt** is genuinely improved and honest: `"Bandit camp / E Raid the
camp (counts toward the 3)"` reads clearly and matches claim 6 as stated.
But the **post-victory toast is broken for camp fights**, confirmed twice live:
- Won camp c1 with 1 troop lost → on-screen message: *"Victory — 1 men lost. Camps still
  stand: raid the tents to stop the raids."* The camp **was** razed (`c1.razed: true`
  confirmed in `save.camps` the same instant), 2 freed captives joined, gold paid out —
  but the player is told camps still stand and to go raid tents, i.e. exactly the opposite
  of what just happened.
- Repeated at c2 with 1 troop lost → **identical wrong message**, confirming it's
  systematic, not a one-off.
- Root cause (read in `world.js:191-226`): the generic *party*-victory toast
  (`"Camps still stand..."`) is set unconditionally whenever `result.lost > 0`, regardless
  of whether the fight was a camp or a wandering-party skirmish. The camp-specific
  "N freed captives join your warband" message is set via `this.say(...)` *inside*
  `onWinExtra`, which runs on the **old** World instance a line **before**
  `game.startWorld(save)` throws that instance away and builds a new one — so the freed-
  captives message is silently discarded and never reaches the screen. Worse: when a camp
  is won with **zero** troop losses, `save.toast` is set to `null` (per the ternary), so
  the player gets **no message at all** — not "camp razed," not "captives freed," nothing
  — for a major campaign milestone.
This is a real regression relative to what claim 6 states was shipped: the exact
scenario claim 6 says was fixed (party-vs-camp confusion) still produces wrong or absent
feedback at the moment it matters most — actually clearing a camp.

---

## Veteran run log (persona: Thronefall all-mutators, 800h Bannerlord Realistic)

| # | Test | Setup | Result |
|---|---|---|---|
| 1 | Retry c1 ×3, same warband (`mine=7`) | live | Identical comp all 3× (`bandit×6, raider×1`) — lottery gone |
| 2 | Scaling sweep at c1 | **[setup]** troop rosters forced | `mine=7→0 brutes`, `mine=11→1 brute`, `mine=17→2 brutes` (cap) — matches design |
| 3 | 14-troop deathball (7 spear/4 archer/3 knight) vs c3 garrison scaled to match (`mine=20`, 16 enemies incl. 1 brute) | **[setup]** `save.gold=500`, forced roster | Tapped CHARGE once, hero never touched again. **Hero finished at 120/120 hp, untouched. Lost 1 of 14 troops.** Autopilot still wins, still nearly for free. |
| 4 | Full gated campaign, played "for real" (active hero, HOLD near troop cluster, aimed swings) from default start (4 spear, 80g) | live | c1 (7 enemies, 0 brutes): **won, ~14.5 sim-s, 0 troops lost, hero untouched.** c2 (9 enemies, 0 brutes rolled): **won, ~14.5 sim-s, 1 troop lost.** c3 (10 enemies): **won, ~18.1 sim-s, 1 troop lost.** Recruited to 12/12 (8 basic + 4 knight, `mine=19`) at Highmere. |
| 5 | Wolfsjaw assault, `mine=19`, garrison = 21 enemies incl. **2 brutes** (target str 29) — **active** play (HOLD + hero fights nearest threat) | live, direct continuation of #4 | **Narrow WIN.** All 12 troops died over the fight. Hero dropped to **5/120 hp** before the last enemy fell at ~26 sim-s. This is the single tensest, most Bannerlord-Realistic-feeling moment I found in either pass. |
| 6 | Same Wolfsjaw assault, same `mine=19`, same 21-enemy/2-brute garrison — CHARGE + **hero fully idle** | **[setup]** rebuilt identical roster fresh | **DEFEAT.** All 12 troops died by ~sim-s 12; the idle hero was then worn down from 111hp to 0 over the next ~12s by the 8 remaining enemies (incl. both brutes) and died. |
| 7 | Post-defeat state after test 6 | live | Camps stayed razed (permanent progress not lost), gold floored (350, above the 25 floor so untouched), troops rallied to 2, stronghold itself still standing (retryable) — the "never a dead end" promise held even at the final boss. |

**Total active-play time for the whole gated campaign (3 camps + stronghold), sim-clock
only:** ≈ 14.5 + 14.5 + 18.1 + 26 ≈ **73 seconds** of actual combat, plus travel/recruit
menu time in between. A real player's first clean clear is realistically in the 5–10
minute range depending on navigation — in the right neighborhood for the "5-minute
session" grain the veteran persona judges by, and, critically, **it is beatable, and the
climax is genuinely hard** rather than a formality.

**The core finding, stated plainly:** the deterministic-scaled garrison system fixes the
*unfairness* the veteran hit (RNG double-brute at camp #1, zero-credit rerolls) but does
**not** fix the *game-breaking* exploit the veteran flagged as severity-1 last round
(CHARGE + AFK hero deletes any fight once troop count is moderate). Tests #3 and #6 use
the exact same "mine" strength (~19-20) and comparably-scaled opposition; the only
difference is the *garrison's absolute composition* (c3's scaled comp tops out with 1
brute among mostly str-1 chaff; Wolfsjaw's is a fixed roster with 2 brutes and a much
larger body count that the deterministic-scaling formula still under-delivers relative
to). The practical result: **every camp fight from the start of the game up through the
gate itself is still an "tap CHARGE once and walk away" fight once your roster crosses
roughly 10-12 troops** — which, per the campaign run above, happens by the time you've
cleared camp #2. Only the one fight that was *always* going to be hard (a hand-placed
2-brute, 21-enemy roster, independent of the scaling formula) actually respects the
"numbers alone never save you" principle. That's roughly 25 seconds of real challenge
guarding the exit of a campaign whose middle 45+ seconds plays itself.

---

## Designer lens: real outs for a losing player? Is the casual death spiral still possible?

- **Retreat mid-fight:** yes, verified live, from both party fights and camp fights. A
  player who realizes CHARGE has gone wrong now has an actual choice besides "fight to the
  death" — this directly answers Finding #3 from the prior designer pass ("no disengage
  option... creates unfair spikes").
- **Rally after defeat:** yes, verified live (0 survivors → 2 fresh spearmen, "never a dead
  end" message), and it held even after losing the *final boss fight*, not just early
  skirmishes.
- **The specific casual-playtester death spiral (9 gold, can't afford a 10g heal, stuck)
  is now structurally prevented** by the unconditional 25g floor on every defeat — that
  exact bottleneck cannot recur.
- **What's not fixed and could still produce a version of the casual player's confusion:**
  the "camps razed 0/3 never moved" complaint was about conflating wandering *parties*
  with fixed *camps* — the camp-approach prompt is clearer now, but nothing was done to
  visually distinguish a roaming party icon from a camp icon on the world map itself, and
  (per the regression above) winning a camp fight with losses now actively tells the
  player camps still stand, which would reproduce exactly this confusion for a new
  player, just relocated from the counter to the post-victory toast.

---

## Regressions introduced by this round's fixes

1. **Camp-victory toast is wrong when troops are lost** — tells the player "camps still
   stand," moments after a camp was razed. Confirmed twice live (c1 and c2). This
   directly undercuts claim 6.
2. **Camp-victory toast is silent (no message at all) when no troops are lost** — the
   "N freed captives join" message is set on a scene object that gets discarded before it
   ever renders. A major beat (clearing a camp cleanly) now produces zero player-facing
   feedback.
3. **Minor:** retreated-party "kills tracking" is an index slice, not a real per-unit
   record — reconstructed remaining-party composition can show the wrong surviving unit
   *type* (count is always right).

---

## Re-scored: Designer lens

| Bar | Prior | Now | Justification |
|---|---|---|---|
| **Thronefall** (combat feel, readability, simplicity) | 7 | **8** | Finding #3 ("no disengage + unsignposted comp variance creates unfair spikes") is verifiably closed — retreat exists and works from every fight type tested, and the double-brute spike at camp #1 is now structurally impossible rather than a 15-25% roll. That was the biggest live unfairness in the prior pass. Held back from higher: no command-legibility HUD nudge was added (Finding #4, untouched), no combat-juice pass, and the toast regression actively *hurts* moment-to-moment feedback clarity, which is core to this bar. |
| **Bannerlord** (commanding an army in a campaign) | 6 | **8** | All three headline asks are now real and independently verified live: the climax has a real lock (Finding #1, closed), defeat has real teeth without being a dead end (Finding #2, closed), and a losing fight can be walked away from (Finding #3, closed). The campaign now has an actual arc: raze camps (fair, learnable, scaling-appropriate fights) → gate opens → a genuinely hard, nearly-lost final assault. Held back from higher by two things found this pass: the camp-victory toast regression undercuts the "campaign is honestly communicating your progress" promise that these very fixes were meant to deliver, and the deathball exploit (see Veteran section) means the "growing warband" fantasy still resolves into "the game stops requiring your attention" for most of the campaign's actual runtime — only the very end pushes back. |

**Designer verdict on the panel bar (both ≥8):** **met, narrowly.** For a 5-minute
session I would now pick Bannerfall over Bannerlord's structural promise specifically
(gate/defeat/retreat are all real and testable, which they weren't last round) — that's a
clear yes. Against Thronefall it's closer: Thronefall's polish and juice are still ahead,
but Bannerfall's structural fairness fix (no more surprise double-brute blenders) closes
enough of the gap that I'd call it a even trade for a short session, not a clear loss.
I'd flag the toast regression as something that should be fixed before treating this
score as durable — it's a two-line ordering bug, not a redesign, but it directly
undermines the specific claim it sits under.

## Re-scored: Veteran lens

| Bar | Prior | Now | Justification |
|---|---|---|---|
| **Thronefall** (readable at a glance, tight controls, polish) | 5 | **6** | The single worst "unfair, not hard" complaint (double-brute RNG spike, zero-credit reroll) is gone, verified by direct retry. That's a real, meaningful improvement to fairness-as-readability. But the thing that most damaged this bar last round — high-army-count play collapsing the skill ceiling to zero — is **unchanged** for the entire mid-game (test #3: 14 troops, CHARGE, hero never moves, wins untouched against a garrison deliberately scaled to match). A bar about "tight controls, polish" can't score much higher while the dominant strategy for 80% of the game is "press one button, watch." |
| **Bannerlord** (commanding troops feels weighty, warband-grows fantasy) | 3 | **5** | Real, verified progress: a gated climax, consequential-but-recoverable defeat, a disengage option, and — new information this pass — a final battle that is genuinely hard and respects "numbers don't save you" (test #5/#6: same roster, same garrison, active play barely wins at 5/120 hp while AFK play loses outright). That's the first fight in either pass that felt like actual Bannerlord Realistic. But it is *one* fight. Every camp before it, including the one right before the gate (test #3, `mine=20` vs a 16-enemy/1-brute scaled garrison), is still won by a single CHARGE tap and an idle hero. The core severity-1 exploit from the prior report is fixed at the finish line and nowhere else, so the "growing your warband opens bigger tactical decisions" promise is still broken for the large majority of playtime. |

**Veteran verdict on the panel bar (both ≥8):** **not met, not close.** For a 5-minute
session I would still pick both reference games over Bannerfall. **Over Thronefall:**
no — Thronefall's difficulty ramp never lets numbers alone win a fight, and Bannerfall's
mid-game still does, repeatedly. **Over Bannerlord:** no — Bannerlord never gives you a
fight, at any army size, that plays itself; Bannerfall does, for every camp except the
last one. The honest read: this round fixed the exploit-adjacent *unfairness* (RNG
garrison spikes) the veteran complained about, and fixed it well, but did not touch the
exploit-proper *triviality* (deathball autopilot) that was rated the more severe problem
to begin with. If the same "hero must matter or the fight is a formality" design that
Wolfsjaw Hold now has were pushed back onto camps c1-c3 (even partially — one captain-type
enemy per garrison that specifically hunts the hero, say), this score moves quickly. As
shipped, it's a genuinely harder, fairer on-ramp to one real fight.

---

## Remaining top 3 gaps

1. **The deathball/CHARGE-AFK exploit still trivializes the entire midgame.** This was
   the veteran's #1 severity-1 finding last round and is essentially untouched: a
   moderate-sized mixed roster (~14 troops) still deletes any camp-strength garrison,
   deterministically scaled or not, with the hero standing motionless and untouched. Only
   the hand-placed, non-formula-scaled Wolfsjaw roster (2 brutes, large fixed body count)
   currently pushes back. Fix ideas from the prior report (enemy AI that specifically
   targets the banner/hero once army size crosses a threshold, or a captain-type unit)
   remain unimplemented.
2. **Camp-victory messaging regression.** The toast shown after clearing a camp is either
   actively wrong ("camps still stand" right after one was razed, when troops were lost)
   or completely silent (when no troops were lost). This is a two-line ordering bug in
   `world.js` (the freed-captives `this.say()` call needs to run *before* — or be folded
   into — `save.toast`, not on the old scene instance after it), but it directly
   undermines the specific claim ("party-vs-camp messaging clarified") it was meant to
   close, and reintroduces a version of the casual playtester's "did that even count?"
   confusion.
3. **Command legibility, combat juice, and the win-screen recap are all still exactly
   where they were last round.** None of these were in scope for this fix pass, so this
   isn't a regression, but they remain real, previously-identified gaps (Designer Findings
   #4 and #5 from the prior report) that keep the Thronefall bar from moving further, and
   they're cheap relative to their payoff (a HUD nudge the first time troops take
   uncontested losses; a stat block — camps razed, peak troop count, battles fought — on
   the victory screen).

---

## Screenshots referenced

- `shots/rc_gate_locked2.jpg` — triple-redundant honest gate messaging at 0/3 razed
  (HUD objective line, camp prompt, toast all agree).
