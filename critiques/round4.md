# Bannerfall — Round 4 Critique (harsh, as requested)

Judged from live play (headless API + `window.__g`; battle_small hit-count lab, dash/i-frame lab,
AFK-in-scrum survival test, battle_big x3 (hero-active, tactical-orders, pure-charge), HOLD
bodyguard test, full campaign slice recruit → organic intercept → skirmish → camp raid → razed →
re-recruit → ambush chain → solo last stand, river/bridge ride) with screenshots in
`shots/c4_*.jpg`, against `references/thronefall/tf_1,3.jpg` and `references/bannerlord/bl_5.jpg`.

---

## 1. Verdict

**The hero is finally a knight instead of a lawnmower-or-piñata — and the campaign map now
mugs you honestly. What's left is that every battlefield is the same pink field.**

| Bar | R1 | R2 | R3 | R4 | One-line reason |
|---|---|---|---|---|---|
| Thronefall (combat feel, readability, simplicity) | 3 | 5.5 | 6.5 | **7.5 / 10** | Hero combat is fixed for real — 5 hits per bandit, escapable scrums, skill-expressive dashes — but every fight is the same rose arena with the same 3 enemies, hit-stop is subliminal, and the edge-band cosmetic bug survives its third round. |
| Bannerlord (commanding an army in a campaign) | 2.5 | 4 | 6 | **8 / 10** | Fair-band parties exist, hunt, and intercepted me organically three times; badges tell the truth; orders demonstrably change outcomes; the map generated an ambush-mid-chase and a solo last stand I didn't script. |

**Loop continues** (Thronefall bar < 8).

**On the 8+: yes, I would genuinely prefer Bannerfall to Bannerlord for a 5-minute session.**
Bannerlord cannot deliver an interception, a camp raid, and a last stand inside 5 minutes — it
can barely deliver its main menu. Bannerfall now reliably delivers all three, with honest
information on every badge. The warlord fantasy at this time scale is *better served here*.
I would still pick Thronefall over Bannerfall for a 5-minute session: its sound design,
kill-pops, biome variety, and night-assault tension out-polish Bannerfall's fights, which have
perfect bones but identical flesh.

---

## 2. Round-4 claim verification (claim by claim)

| # | R4 claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Swing capped at 3 targets, dmg 22 → participation, ~14 s battles not 7 s collapse | **FIXED** | data.js:77 (`swingDmg: 22, swingMaxTargets: 3`), battle.js:313–329 sorts arc targets by distance and slices 3. Lab: exactly **5 swings** to kill a 110 hp bandit (110→88→66→44→22→0). Battles with the hero riding in ran 11 s (14v11 stomp), 15.2 s, 15.6 s, 18.3 s (camp), 20.6 s (solo), 23.3 s (fair skirmish). The 7-second army-delete is dead. The battle_big stomp still lands at 11 s, under the promised ~14 — but that fight is 15 bodies vs 11, and losses now happen. |
| 2 | 0.5 s dash i-frames + MISS pops + knocked out of scrums | **FIXED** | data.js:78 `iframeTime: 0.5`; live: iframesT decays 0.5→0 post-dash; a strike landing during i-frames produced a `MISS` text particle and **zero damage** (battle.js:189–191). AFK test: standing dead-still inside an 11-enemy scrum = 9 hits over **8.7 s**, each shoving 10–17 px, ending 373 px from pack center — the scrum literally spits you out. R3's hp 100→−18 in 4 s is gone. Dying now requires eating ~9 consecutive telegraphs without touching a key. |
| 3 | Enemies surround instead of stacking | **FIXED** | battle.js:449–452 (per-enemy ring offset via golden-angle jitter); `c4_surround.jpg` shows a ring, not a pillar. Same logic applied to troops (battle.js:371–374). |
| 4 | FOLLOW/HOLD troops defend the hero (enemy within 90 px is engaged) | **FIXED** | battle.js:351 (`nearestEnemy(hero, 90)`), :356, :360. Live: HOLD line, hero parked 100 px away, 4 enemies dragged onto him — troops broke off and killed **all 4 in 4.4 s**; hero lost 10 hp. R3's G4 ("watch your commander die") is dead. |
| 5 | Honest badges (brute=5, knight=2, strength not headcount, hero badge same scale) | **FIXED (with two honesty asterisks)** | world.js:138 (`brute?5:1`), :140 (knight 2, hero base 3), :510 badge prints strength, :553–556 hero badge same scale. Live: a 5-unit brute party wore a **9**; my badge tracked 7→3 (after wipe)→7 (after re-recruit); red coloring at >1.15x correct (`c4_ashford.jpg`: red 9 vs my 7). Asterisks: only two colors (no cream "even" tier R3 asked for), and the hero counts 3 while a piloted hero is demonstrably worth ~a warband — enemy badges are honest, yours undersells you. |
| 6 | Guaranteed fair-band spawn; verified set: player 7 vs 4,9,9,4,7,5,6,8 | **FIXED** | Fresh world reproduced the claimed spawn set **exactly** (str 4,9,9,4,7,5,6,8 vs my 7). world.js:307–314 backfills the 0.7–1.2x band when empty. In practice I was organically intercepted three times: str-9 vs my 9 en route to c1, str-8 vs my 7 *while chasing a weak party*, str-4 vs my 4 after my warband wiped. R3's G2 (empty engagement band) is dead. |
| 7 | Rivers with bridges + 90 terrain blotches | **FIXED** | world.js:71–72: two rivers, three bridges; live scene: 90 blotches + 191 scenery items + dashed roads. `c4_bridge.jpg`: river, bridge plank, mountains, windmill village — the ride between fights finally has geography that shapes routes (bridges funnel you; that's where I got jumped). |

Campaign slice beats: recruit at Ashford ✓ (toast, price panel, gold 80→50), heal ✓ (−10 g),
organic intercept ✓, victory → party removed from map ✓, +35 loot ✓, 6 s grace ✓, troop losses
persist to map ✓, c1 raid → razed ✓ (X mark now legible on ochre, `c4_c1_razed.jpg`), objective
0/3→1/3 ✓, victory banner with numbers ("+30 gold · 4 slain · …", `c4_solo_end.jpg`) ✓.
Chase-the-fleeing-party: gap closed 370→317 in 1.5 s (240 vs 195 — catchable, consistent with
R3's verified 5 s catch), but the catch itself was **preempted by a str-8 ambush** — which is a
better outcome than the test.

## 3. Command value (Test 2 result)

Same battle_big, hero passive in both runs:
- **HOLD line → CHARGE at 156 px gap:** 20.1 s, **0 troops lost**.
- **Pure CHARGE at t=0:** 17.2 s, **3 troops lost**.

Orders now buy lives, visibly and repeatably. Combined with the bodyguard behavior, all three
buttons have a reason to exist. This was the single biggest wish of R2/R3 and it's delivered.

---

## 4. THE one biggest remaining gap

**Every battle is the same rose-pink field. The bones of combat are now excellent; the flesh
never changes.**

Seven fights this session: same biome, same yellow trees, same cosmetic rocks, same 3 enemy
types walking at me in the same opening formation. The obstacles don't block arrows or funnel
charges; the road across the arena is paint. All of the session's drama — ambush-mid-chase,
last stand, bridge mugging — was authored by the *map*, then discarded at the arena door.
Thronefall's fights stay fresh because the battlefield itself (walls, chokepoints, night, mobs)
keeps changing the question; Bannerfall asks the same question seven times.

**Concrete fix:** let the map into the battles. Arena inherits context: fight starts on a
bridge → narrow river-crossing arena with a real chokepoint; ambushed while chasing → enemies
start on two sides; camp raid → tents and stakes that actually block movement (they nearly do
already); forest region → tree cover that slows cavalry and blocks raider arrows. Two extra
arena templates + collision on existing props would multiply perceived variety with systems
already built.

## 5. Ranked remaining gaps

### G1. (Above — arena/context variety.)

### G2. Impact weight still under the Thronefall bar
- Hit-freeze is 45–55 ms (battle.js:184, 329) — functionally subliminal; kill shards are small;
  kills and hits shake almost identically. tf units *burst*.
- **Fix:** ~90 ms freeze on kills only, 1.5x shard count + a 1-frame white flash on the dying
  unit, keep hit shake at 2.5 but push kill shake to 5.

### G3. The troop economy is a shuttle service
- I lost 9 spears across 4 fights and ended at 0; every refill means riding back west to
  Ashford. Troops are interchangeable 15 g pawns — nothing accrues, so losses cost time, not
  feeling. The most boring stretch of the session was the second re-recruit ride.
- **Fix:** survivors gain veterancy (+dmg or +hp after 2 battles, visible chevron); razed camps
  offer one-time "freed captives join you"; Highmere sells knights forward of the front line
  (it already can — R price panel — but you're never there when broke).

### G4. Scrum mush, residual
- Better than R3 (surround rings help), but 6+ units on one target still collapse into a pale
  blob (`c4_big_t5.jpg` center). HP bars overlap into noise.
- **Fix:** widen separation radius when ≥5 units share a target, or cap melee slots per target
  at 4 and make the rest orbit.

### G5. Cosmetic/UX debris, third round running
- **Edge bands STILL alive**: full-width cyan strip on the top arena edge (`c4_big_t5.jpg`),
  navy strips on the left edge in every battle shot. Third consecutive round for this bug.
- Two-color badge (add the cream "even" tier — red/ink alone makes 1.1x read as "safe").
- Hero badge counts the hero as 3; piloted well he's worth 15+. Your own number lies low.
- Any keypress still eats the intro banner (battle.js:246) — R3 bug 6, unaddressed.
- Near-even chasers move 140 vs hero 240: in open field they only "intercept" you when you
  pause or approach. It worked this session, but it's soft — a chaser that can never close is
  a threat display, not a threat. Consider 200–220 chase speed with a stamina falloff.

## 6. What works — don't break it

- **Hero combat.** 5 hits per bandit, capped cleave, lunge-per-swing, dash i-frames with an
  honest MISS receipt, shove-on-hit that makes scrums escapable. The solo last stand at 19 hp
  vs 4 enemies was the best fight the game has produced in four rounds — tense, readable,
  winnable by skill.
- **The bodyguard rule.** Troops peeling off HOLD to save the commander reads as loyalty. It's
  one line of targeting logic and it carries the entire "leading men" fantasy.
- **Honest information.** Badge numbers = weighted strength on both sides of the fight. Trust
  in the UI is the whole reason picking fights is now fun.
- **The fair-band guarantee.** The map always offers a winnable-but-real fight; three organic
  intercepts in one session, one of them *while I was hunting someone weaker* — systems writing
  Bannerlord fiction unprompted.
- **Orders with receipts:** 0 losses tactical vs 3 losses pure-charge, repeatable.
- **Geography.** Rivers, bridges, roads, blotches — routes are now decisions (bridges are
  ambush funnels), and the ride reads like a place instead of ochre void.
- **Zero console errors** all session, again.

## 7. Bugs found this session

1. Cyan/navy edge bands on arena borders — third round (`c4_big_t5.jpg` top, all battle shots left).
2. Intro banner skipped by any keypress, including order spam (battle.js:246) — carried from R3.
3. Near-even "chase" parties (speed 140) cannot physically close on a moving hero (240) — design soft spot, see G5.
4. Hero strength contribution fixed at 3 in `myStrength()` — undersells the piloted hero on your own badge.
5. A str-9 party ignored me standing on top of it (~10 s, d=16–25 px) before engaging — safe-zone edge overlap suspected near Coldwell; the ambush *felt* delayed, not prevented.

## 8. Did I want to keep playing?

**Yes — and for the first time, the fights are part of the reason.** After the campaign slice I
kept playing voluntarily and the game kept answering.

**Most fun moment:** warband wiped at the camp raid, limping east at 19 hp, and the str-4 party
that had been fleeing me all session turned and jumped me — solo, no troops, dash-cancelling
every windup, killing all four by hand. A last stand the game generated, the old build would
have resolved in 4 seconds either direction. Runner-up: getting ambushed by a near-even party
*while I was chasing a weaker one* — predator-to-prey in one second.

**Most boring stretch:** the recruit shuttle — riding back to Ashford twice to rebuy identical
15 g spearmen, then riding the same road east again. Second place: the first three seconds of
every battle, which are always the same walk-toward-each-other.

**The single change that would most raise fun:** let the map into the battles (G1). The
campaign layer is now generating stories; the battlefield throws them away. Bridge fights,
two-sided ambush starts, and camps that fight back would make the seven fights I had feel like
seven different fights instead of one fight seven times.
