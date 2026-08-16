# Bannerfall — Round 3 Critique (harsh, as requested)

Judged from live play (headless API + raw `window.__g` handle; 6 sessions: timed big battle x3,
full campaign slice recruit → chase → skirmish → camp raid → razed check, near-even field wipe,
organic defeat, hunt/outrun test, edge tests) with screenshots in `shots/c3_*.jpg`, against
`references/thronefall/tf_1,3,6.jpg` and `references/bannerlord/bl_2,5.jpg`.

---

## 1. Verdict

**The world finally fights back — and the moment you personally join a fight, the fight stops
being the game the builder tuned.**

| Bar | R1 | R2 | R3 | One-line reason |
|---|---|---|---|---|
| Thronefall (combat feel, readability, simplicity) | 3 | 5.5 | **6.5 / 10** | Auto-resolve battles now run a genuine 15–20 s with real losses and the readability stack holds — but the hero is either a 7-second army-deleter or a corpse, and HOLD makes your own men watch you die. |
| Bannerlord (commanding an army in a campaign) | 2.5 | 4 | **6 / 10** | Chases succeed in ~5 s, strong parties hunt you, I got genuinely pincered fleeing one stack into another — but nothing near-even ever intercepts you on the route you actually travel, and the strength badge lies about who wins. |

Loop continues (both bars < 8).

---

## 2. Round-2 fix verification (claim by claim)

| # | R2 claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Combat pacing rebuild: ~16–18 s auto-resolve with real losses | **FIXED — for auto-resolve only** | battle_big, CHARGE, hero withdrawn: 11 enemies down in ~17 s of fighting, 2 troops lost, banner "+65 gold · 11 slain · 2 of your men fell" (`c3_auto_end`). Camp raid with light hero help: ~17.5 s, 2 losses. **But** battle_big with the hero riding in: 8 of 11 enemies dead in the first 2 s, over in ~7 s, zero losses (`c3_big_t2`). The tuned pacing only exists when the player doesn't play. |
| 2 | Knockback on every melee hit | **HALF FIXED** | `damageEnemy` takes kx/ky and hero/troop hits shove enemies (battle.js:170–173, 311, 369). `damageFriendly` (battle.js:188) has **no knockback parameter at all** — enemies hitting your troops or hero produce zero shove. One-directional. |
| 3 | Parties engage at 0.75–1.3x, flee catchably at 195 vs 240, chase at 168 | **FIXED in code, EMPTY in practice** | Logic verified at world.js:246–249 and live: a 0.88x party engaged me on contact; a 2.0x stack chased and I outran it (d 354→687) before a *second* hunter pincered me — great drama. But on the scripted Ashford→c1 route, **every** nearby party was 0.2–0.5x my strength → all fled; zero intercepts on the natural early path. The engagement band exists; the early-map population never sits in it. |
| 4 | Party sizes scale with warband | **UNVERIFIED / DOUBTFUL** | Party comps come from camp size + RNG (world.js:226–227, spawnParty); ratios I sampled ranged 0.2–2.0 regardless of my strength going 10→8→6. Nothing observably scales *with* me. |
| 5 | Defeat banner (verified working) | **FIXED** | "DEFEAT — Your warband scatters — you limp back west, poorer and fewer", full 2.6 s hold, captured twice (`c3_hold_t10`, `c3_even_end`). R2's silent mugging is dead. But the banner is qualitative: gold −46 and troops resurrected up to a floor of 3 are never stated anywhere. |
| 6 | World map camera clamp | **FIXED** | No dead-void corners found this session; hero centered at map edges (`c3_razed_visible`, `c3_c1_razed`). |
| 7 | Brute slam no longer one-shots | **FIXED** | Brute dmg 24 (data.js:70). Standing next to a brute pack: 120→110→100→70→23→dead over ~5.6 s — a beating, not an execution (R2: dead in 0.12 s). |

Campaign slice beats: recruit at Ashford ✓ (7/12, toast, price panel), chase-catch fleeing party
in ~5 s ✓, field skirmish ~10.5 s ✓, party count 9→8 ✓, camp raid arena is a camp this time ✓,
razed X marks ✓ (faint groundShade-on-ochre — nearly invisible, `c3_razed_visible`), objective
0/3→1/3 ✓. Failed beat: **no interception en route** (see G2).

---

## 3. THE one biggest remaining gap

**Player participation breaks the battle in both directions — the best way to play Bannerfall is
to leave the battlefield.**

Ride into the enemy line swinging (swingDmg 30, cd 0.34 s, 86 px range, 126° cone = ~90 DPS to
*everything* in an arc) and a tuned 17-second battle collapses to 7 seconds with zero losses
(`c3_big_t2`: Slain 8/11 at t=2). Stop moving inside the scrum and 8 bandits delete your 120 HP
in ~4 s (run 2: hp 100→−18 in 4 s). There is no middle: you are a lawnmower or a piñata. My
best, cleanest, most legible battle of the whole session was the one where I rode the hero to
the arena edge and watched. When the optimal strategy in a game about *leading men from the
front* is to not be present, both reference fantasies — Thronefall's dance and Bannerlord's
warlord — are inverted.

**Concrete fix:** cap swing at 2–3 targets per swing (or swingDmg 30→14) and narrow the cone to
~90°; give the hero 0.3 s of post-dash i-frames and knockback-on-being-hit so the scrum is
survivable in motion; make enemies prefer engaged troops over the hero unless the hero attacks
them. Target: hero presence speeds a 17 s battle to ~12 s, not 7, and dying requires a mistake,
not proximity.

---

## 4. Ranked remaining gaps

### G1. (The ONE gap above — hero combat role.)

### G2. The engagement band is real but unpopulated where you actually are
- Ashford→c1, 7-troop warband: every party within reach was ratio 0.2–0.5 → all flee. The
  "near-even party intercepts you en route" moment cannot happen in the early game; I only got
  intercepted after teleporting next to a 0.88x party via `__g`.
- **Fix:** guarantee ≥1 roaming party per region spawns inside 0.7–1.2x of *current* player
  strength (recompute on spawn); camp parties within ~500 px of their camp should intercept a
  raider approaching it.

### G3. The strength badge lies — and it cost me my whole warband
- Badge shows **headcount**, colored red only above 1.15x *weighted* strength (world.js:441–447).
  A 5-man ink-badge party ("weaker, safe") wiped my 5 troops + hero losing ONE unit, because a
  brute counts ~3 in strength and ~10 in reality (`c3_even_*`: tr 5→0 in 8.5 s, my kills: 1).
- **Fix:** badge number = weighted strength; three colors (ink weaker / cream even / red
  stronger); weight brutes honestly in `strength()`.

### G4. HOLD is a suicide order
- HOLD with enemies inbound: 14 troops held formation, killed nothing, and watched 11 enemies
  beat the hero to death 40 px away (10 s log, 0 kills, hero 120→−6, `c3_hold_t10`). Isolated
  test confirms troops on HOLD *do* defend themselves when directly attacked (`c3_hold_iso`) —
  they just won't defend *you*.
- **Fix:** on HOLD, troops engage anything attacking the hero or crossing the hold line within
  ~130 px. An order that means "ignore your dying commander" will never be pressed twice.

### G5. Defeat math is still hidden
- Banner says "poorer and fewer"; reality: −30% gold, troops silently *resurrected* to a floor
  of 3, teleport to start. Numbers appear nowhere; the troop floor reads as a bug even though
  it's mercy.
- **Fix:** banner line 2: "−46 gold · 5 men lost · 3 survivors regroup at Ashford."

### G6. Holdover cosmetics from R2, still unaddressed
- **Cyan edge bands**: fat teal strip eats ~10% of the camp arena's left edge (`c3_c1_battle_intro`),
  thin strips both edges on road arenas (`c3_hold_iso`). Worse than R2's "thin strips" report.
- **Scrum mush**: melee still collapses into overlapping pale blobs (`c3_big_t2` top-left).
- **Arena density**: camp = 2 tents + fire + 6 stakes on a bare plane; nowhere near tf_6.
- **Razed X marks** are groundShade-on-ochre — functionally invisible unless you know to look.

---

## 5. What works — don't break it

- **The world hunts.** Strong parties chase, weak ones flee catchably (caught one in 5 s of
  riding), and fleeing a 2.0x stack into a second hunter's arms produced the session's best
  story. This is the first round where the campaign map generated drama by itself.
- **Auto-resolve pacing**: 15–20 s, casualties on both sides, orders have time to matter.
- **Defeat banner + victory banner with numbers** (victory's, anyway).
- **Full campaign loop**: recruit → chase → raid → razed mark → 1/3 objective → defeat →
  respawn, all persistent, zero console errors all session.
- **Readability stack** (crimson foes, balloons, '!' windups, brute circle, HP bars) held up in
  every fight; brute slam is now a survivable, teachable punishment.
- **World camera clamp** — fixed cleanly.

## 6. Bugs found this session

1. **Enemies do not knock back friendlies** — `damageFriendly` has no knockback path (battle.js:188).
2. **Cyan band** on camp arena left edge (~130 px wide, `c3_c1_battle_intro`); thin cyan strips on road arenas.
3. **HOLD troops ignore the hero being killed adjacent** (design bug, see G4).
4. **Troop resurrection to 3 after total wipe** — uncommunicated; reads as a bug.
5. Badge headcount vs weighted-strength color mismatch (G3).
6. Any keypress skips the intro banner (battle.js:237) — spamming orders at battle start silently
   eats the "8 vs 5" read. Minor, but it fights the telegraphing.
7. Hero world-map HP persists into battles (entered at 65/120 twice) with no heal prompt on the
   map HUD beyond the village panel — fine mechanically, but nothing warns you you're at half HP
   until you're in the intro. Cosmetic/UX.

## 7. NEW THIS ROUND — did I want to keep playing?

**After 5 minutes: yes, on the map; no, in the fights.** The campaign layer finally has pull —
I wanted one more chase, one more camp.

**Most fun moment:** fleeing the 2.0x stack west at full gallop, watching the gap grow 354→687,
and slamming straight into a second hunting party I hadn't seen. An honest ambush, generated by
systems, that felt authored. That is the Bannerlord fantasy, twelve pixels tall.

**Most boring stretch:** the fights I was personally in. Either I mowed the line down before my
second click mattered (battle_big, 7 s) or I watched my hp tick down in a blob I couldn't read
myself out of. The second most boring stretch: the long empty ochre ride between Ashford and
anything — the map drama is all parties; the terrain itself offers nothing to decide between
two routes.
