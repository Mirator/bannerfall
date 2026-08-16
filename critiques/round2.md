# Bannerfall — Round 2 Critique (harsh, as requested)

Judged from live play (headless API: full campaign slice with recruit → camp raid → defeat →
scenario battles; ~10 sessions) with screenshots in `shots/c2_*.jpg`, against
`references/thronefall/tf_1,3,6,8.jpg` and `references/bannerlord/bl_2,5.jpg`.

---

## 1. Verdict

**Round 1's "you cannot see the battle" is dead. Now you can see the battle — and it's over
before you finish reading the intro band.**

| Bar | Round 1 | Round 2 | One-line reason |
|---|---|---|---|
| Thronefall (combat feel, readability, simplicity) | 3 / 10 | **5.5 / 10** | Readability is genuinely close to bar now; but every fight resolves in 1–6 seconds of blob-contact, so there is no *feel* to have. |
| Bannerlord (commanding an army in a campaign) | 2.5 / 10 | **4 / 10** | The warband finally looks and persists like a warband — but the world never fights back, weak parties are uncatchable, and defeat is a silent mugging. |

Loop continues (both bars < 8).

---

## 2. Round-1 fix verification (claim by claim)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Fit-to-action camera + island arena, no dead void | **PARTIALLY FIXED** | Battle camera is excellent — hero, troops, and enemies stayed in frame through entire fights (`c2_big_charge1/2`, `c2_dash`). But the **world map camera is unclamped**: at the SW corner ~45% of the frame is dead navy void (`c2_chase_weak4`), north edge shows a giant band (`c2_field_intro2`), and battles still leak thin navy+cyan strips on the left edge (`c2_big_intro`). |
| 2 | 40% bigger units | **FIXED** | Units clearly read at a glance now (`c2_small_intro` vs round 1). |
| 3 | Crimson enemies + enemy balloons | **FIXED** | Enemies are full crimson with red icon balloons on leaders (D3, club icons — `c2_ord_charge`). Instant friend/foe read. |
| 4 | '!' windup telegraphs + brute danger circles | **FIXED (visually), broken (numerically)** | '!' bubbles appear before attacks (`c2_camp2_heroin`, `c2_ord_charge`); brute slam circle is huge and readable (`c2_camp_charge`, `c2_big_charge2`). But the slam **one-shots a 120 HP hero** (120→dead inside 0.12s of game time) — see Bugs. |
| 5 | Unit/hero separation + surround | **PARTIALLY FIXED** | Enemies now surround the hero in a ring instead of standing inside his sprite (`c2_defeat_banner`). But allied FOLLOW clusters and melee scrums still overlap into a single mush blob (`c2_ord_follow`, `c2_big_charge2`). |
| 6 | Campaign party persistence + real flee/chase + safe zones + post-battle grace | **PARTIALLY FIXED / OVERCORRECTED** | Persistence: real — parties 10→8 after razing c1, defeated parties stay gone. Flee: real — the "2" party ran with a "!" marker and kept distance through a 4-step chase (`c2_chase_weak` → `c2_chase_weak4`) until it escaped entirely. But **nothing ever attacked me all session** (round 1: 5 forced battles in 3 min; round 2: zero ambushes in ~10 min), and I failed to intercept ANY roaming party in 8 attempts — they evade or hop away (`c2_field_try3–6`). Grace/safe zones: unverifiable, since no ambushes exist at all anymore. |
| 7 | Army cap 12 + start 4 + pennants + map entourage | **FIXED** | HUD 4/12 at start, 6/12 after recruiting (`c2_recruited`); white pennant flags on troops (`c2_camp2_heroin`); hero flag + trailing figures + strength badge on map (`c2_world_start`). |
| 8 | Arena templates (road/camp/village) | **PARTIALLY FIXED** | Road template confirmed (`c2_small_intro`), camp template with tents confirmed (`c2_camp_intro`, `c2_big_intro`). But density is still ~10 props on a bare plane — nowhere near tf_6/tf_8 — the "palisade" reads as scattered apostrophes, and **camp c2's battle loaded the road arena** (template/context mismatch). Village template never seen (no village battle can occur — see gap G2). |
| 9 | 2.6s end banners with loss reporting | **HALF FIXED** | VICTORY banner exists, holds ~2.6s wall-clock, and reports "+25 gold · 3 slain · no losses" (`c2_small_arc2`) — good. **DEFEAT has no banner at all**: one 0.05s step after hero death you are on the world map (`c2_defeat_banner` → `c2_defeat_banner2`), having silently lost 40 gold, 3 troops, and half your HP. Round 1's exact complaint ("I still don't know if I won or died") stands for the defeat path. |
| 10 | Menu z-order fix | **FIXED** | Controls text now on a navy panel above the mountains (`c2_menu`). |

---

## 3. The ONE new biggest gap

**There is no fight — battles are over in 1–6 seconds of contact soup.**

The 4v3 small battle resolved in ~1.2 game-seconds (`c2_small_arc`: I clicked once and it was
over). The camp raid: 4 of 5 enemies dead within ~2 s of pressing CHARGE (`c2_camp_charge`).
The 15v11 big battle: 8 kills by t≈3 s, done by ~5 s. Units die in 1–2 hits, everyone converges
into one blob, and the fight resolves faster than a player can issue a second order. All the
new readability — telegraphs, balloons, danger circles, the lovely swing arc — decorates a coin
flip that's finished before the CHARGE! text fades. Thronefall fights are dances measured in
tens of seconds; Bannerlord battles are stories. This is a car crash.

**Concrete fix:** target 20–40 s battles. Triple unit HP (2 hits → 5–8 hits to kill), put
attack cooldowns at ~0.8–1.2 s with the '!' windup filling the gap, add 60 ms hit-stop and
knockback per hit so each exchange registers, and slow charge convergence so lines meet and
grind instead of teleport-blending. Everything already built (orders, telegraphs, camera) only
starts mattering once fights last long enough to command.

---

## 4. Ranked remaining gaps

### G1. (The ONE gap above — combat pacing/TTK.)

### G2. The world never fights back — the campaign is now inert
- Round 1 was an ambush death-spiral; this build overcorrected to a pacifist sandbox. Nothing
  attacked me in an entire session; every party ≤ my strength flees (uncatchably — `c2_chase_weak4`)
  or evades interception (8 failed attempts, `c2_field_try3–6`). The only obtainable battles are
  the 4 static camp buttons. Field battles — the heart of the Bannerlord fantasy — are unreachable.
- **Fix:** parties at 0.8–1.3× your strength should engage you; fleeing parties move at ~0.85×
  hero speed so chases succeed and cost time; parties defending a camp radius should intercept
  raiders; keep ambush grace and village safety, but they need to be *tested against actual ambushes*.

### G3. Defeat is a silent mugging
- Hero dies → instant world map, -40 gold, -3 troops, half HP, zero messaging (`c2_defeat_banner2`).
- **Fix:** DEFEAT banner, same 2.6 s hold as victory: "DEFEATED — 3 troops lost · 40 gold taken —
  you limp back to Ashford."

### G4. Brute slam is an execution, not a punishment
- 120 HP hero deleted from full inside the circle (state log: hp 120 → dead in 0.12 s). A
  telegraph you can only respect, never survive, teaches nothing — it just ends the run.
- **Fix:** cap slam at ~40–50 damage + heavy knockback. Thronefall telegraphs hurt; they don't execute.

### G5. Scrum mush — units still overlap in clusters
- FOLLOW blob and melee scrums render troops on top of each other (`c2_ord_follow`); individual
  soldiers vanish into a pale smear at exactly the moment you care most.
- **Fix:** separation radius ≥ sprite width; cap attackers per target (~4–6); give FOLLOW/HOLD
  actual formation slots (line behind the hero flag) — this also buys the "moves as a mass" fantasy.

### G6. Arenas remain sparse and context-loose
- Road and camp templates exist but carry ~10 props on a bare rose plane vs tf_6/tf_8's dense
  sculpted scenes; the palisade is disconnected dashes; camp c2's battle loaded the road arena.
- **Fix:** 4–5× prop density, join palisade segments into a wall, bind template choice to the
  encounter source, hard-edged polygonal shadows.

### G7. Camera clamp on the world map
- Up to ~45% dead navy void at map corners (`c2_chase_weak4`); thin navy/cyan strips on battle left edge.
- **Fix:** clamp world camera to map bounds (same treatment the battle camera got); clip the island border stroke.

---

## 5. What works — don't break it

- **Battle camera:** fit-to-action framing kept the whole fight visible all session. Round 1's #1 sin, gone.
- **Readability stack:** crimson enemies, red enemy balloons, ally balloons + pennants, '!'
  windups, brute danger circle, thick cream swing arc (`c2_small_arc`), kill shards. This is
  Thronefall-grade at-a-glance grammar now.
- **Juice:** CHARGE! screen text, dash dust trail (`c2_dash`), hero target ring when swarmed.
- **Victory banner** with "+gold · slain · no losses" reporting.
- **Campaign persistence:** camps stay razed (X marks on map), parties stay dead, objective
  counter advances (0/3 → 1/3), gold/troop accounting correct through recruit → raid → defeat.
- **Map presentation:** hero flag + entourage + strength badges on all parties; villages/castle labeled.
- **Menu** is clean; **zero console errors** across the whole session.

## 6. Bugs found this session

1. **No defeat banner** — instant scene snap with silent penalties (`c2_defeat_banner2`).
2. **Brute slam one-shots** the 120 HP hero from full health.
3. **World camera unclamped** — huge dead-void bands at map edges/corners (`c2_chase_weak4`, `c2_field_intro2`).
4. **Camp c2 battle used the road arena** while c1 used the camp arena — template/context mismatch.
5. Thin navy + cyan vertical strips on the battle arena's left edge (`c2_big_intro`).
6. Roaming parties occasionally hop/teleport large distances between frames (the "5" party crossing a mountain range, `c2_field_try6`).
7. `scenario('battle_big'/'battle_small')` resets campaign progress (test-harness quirk — worth knowing, not player-facing).
8. End banner runs on wall-clock while battle sim runs on stepped time — fine for players, but it makes headless timing verification lie (cost this review two false readings).
