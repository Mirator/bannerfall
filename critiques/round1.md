# Bannerfall — Round 1 Critique (harsh, as requested)

Judged from live play (headless API, ~10 battles/world sessions) and captured screenshots in
`shots/critic_*.jpg`, against `references/thronefall/tf_1,3,6,8.jpg` and `references/bannerlord/bl_2,5.jpg`.

---

## 1. Verdict

**Would a Thronefall/Bannerlord lover prefer this for 5 minutes? No. They'd close it in two.**

| Bar | Score | One-line reason |
|---|---|---|
| Thronefall (combat feel, readability, simplicity) | **3 / 10** | Palette is right, but the fight itself is a mush of overlapping micro-blobs on an empty plane, with no telegraphs and battles you often *cannot see*. |
| Bannerlord (commanding an army in a campaign) | **2.5 / 10** | "Big battle" is 9v7. Charge means your army walks off-screen and the fight resolves without you. The warband is a number badge, not a band. |

Loop continues (both bars < 8).

---

## 2. Biggest gap (the ONE fix)

**You cannot see the battle.** The camera is welded to the hero, the arena is a vast empty
plane, and units are ~15px tall. In `critic_big_melee.jpg` I pressed CHARGE and then watched an
*empty rose field* while 4 of 7 kills happened past the right screen edge. In
`critic_big_victory_banner.jpg` the surviving army is a smudge cut off in the top-right corner
behind the VICTORY band. On top of that, dead navy out-of-bounds bands eat 20–40% of the frame
(`critic_ashford_near.jpg`, `critic_big_intro.jpg`) — even the world map leaks a dead band on the
left edge (`critic_small_kill1.jpg`).

Compare tf_1/tf_3: every Thronefall shot frames the *action* — squads, hero, and target are all
in frame, and the units are 3–4× larger relative to the screen.

**Concrete fix:** fit-to-action camera (frame the bounding box of hero + all living units, clamp
to arena so out-of-bounds is never visible), shrink the arena to ~half, and scale units up ~2x.
Everything else in this critique is invisible to the player until this lands.

---

## 3. Ranked remaining gaps

### G1. Combat has no moment-to-moment feel — it's contact soup
- **Reference:** Thronefall (REFERENCE.md): big readable telegraphs, hit-stop, kill-pops into
  shards, knockback, screen shake. tf_3: every damaged unit has a thin HP bar; projectiles arc.
- **Ours:** In the solo fight (`critic_solo_enemies_near.jpg`) two bandits simply *stand inside
  the hero sprite* and HP silently melts 120→24. No windup pose, no attack flash, no knockback,
  no separation — units stack on the exact same pixel. The hero swing arc exists
  (`critic_small_arc1.jpg`, `critic_solo_swing.jpg`) but it's a ~20%-opacity cream fan on rose —
  nearly invisible. I never once saw a kill-pop I could point at. Fights end in 5–10 seconds.
- **Fix:** enemy windup = raised-weapon pose + flashing outline for 0.4s before damage; melee
  applies knockback + 60ms hit-stop; kills burst into 4–6 palette shards; radial separation force
  so units never overlap; double the swing-arc contrast (ink outline, cream fill).

### G2. Enemy readability fails the at-a-glance test
- **Reference:** tf_1: *every* squad carries a black icon balloon — unit type readable across the
  map. tf_3 night: enemies read white/red vs pale-blue defenders, instantly.
- **Ours:** allies get balloons (D, sword), enemies get nothing — they're small white blobs with a
  dark cap and a thin red chest band (`critic_small_approach.jpg`). At real size, ally pale-blue
  vs enemy white is a squint test. The red windup(?)/HP bar over enemies is ambiguous.
- **Fix:** give enemies their own balloon style (red balloon, skull/axe icon) or recolor them
  fully red/crimson; reserve white for nothing.

### G3. World map is an ambush death-spiral, not a snowball
- **Reference:** Bannerlord bar (REFERENCE.md): pick fights you can win, chase/flee by relative
  strength, warband grows.
- **Ours:** Five forced battles in ~3 minutes of riding. Bandits chase relentlessly; I was
  ambushed *while standing in the recruit menu*, lost the recruits I'd just bought, then got
  ambushed solo at 0 troops. Weaker parties (2 vs my 3) never fled. Party count sat at 8 the
  entire session despite ~5 wins — no visible map progress. Net troops after 3 minutes of play:
  started 2, ended 1. The snowball never starts.
- **Fix:** weaker parties flee (visible run-away vector); chase only when party strength ≥ 1.5×
  yours; ambush cooldown (~20s immunity after a battle and while in a village radius); defeated
  parties stay dead until camps respawn them (visible spawn from camp), so clearing feels real.

### G4. Zero army fantasy
- **Reference:** bl_5: hundreds of troops as a mass with cavalry momentum; bl_2: banners on the
  horizon, formations. Even scaled to a minigame this must read as *a mass that moves together*.
- **Ours:** cap is 8 troops; "battle_big" is 9v7 (`critic_big_intro.jpg` — a playground scuffle).
  No formations — troops drift as individuals. No banners on troops. On the world map the warband
  is one hero sprite with a number badge; recruiting 3 men changes a digit, not the picture.
- **Fix:** raise cap to 20–30 (they're cheap flat sprites); FOLLOW/HOLD arrange troops in a
  wedge/line formation behind the hero flag; give squads a mini-banner; on the world map render
  2–5 trailing figures behind the hero proportional to warband size.

### G5. Battle arenas are context-free nothing-fields
- **Reference:** tf_6/tf_8: dense sculpted scenery — rivers, bridges, windmills, walls, forests —
  and the fight location *is* the level. tf_1: hard-edged long polygonal shadows, one light.
- **Ours:** every battle (village ambush, camp fight, open road) is the identical empty rose
  plane with 3 rocks, 3 yellow trees, and ambiguous darker polygons that read as holes in the
  ground (`critic_fight5_mid.jpg`). Shadows are soft ellipses, not hard polygons. The hero
  stands *on top of* a tree sprite (`critic_camp_battle.jpg`) — no collision, wrong z-sort.
- **Fix:** 3 arena templates (village: houses+windmill edge; camp: tents+campfire+palisade;
  road: dashed road running through) with 4–5× current prop density; hard polygonal drop shadows;
  y-sort sprites and add prop collision.

### G6. Battle outcomes are illegible in the campaign flow
- **Reference:** Thronefall's loop punctuates every wave; Bannerlord's post-battle screen is the
  reward beat.
- **Ours:** world-encounter battles snap back to the map the instant the last enemy dies — twice I
  was back on the map before my scripted screenshot fired. The scenario VICTORY banner exists
  (`critic_big_victory_banner.jpg`, "+45 gold · 7 slain" — good!) but appears to be skipped or
  near-instant for world battles. Worse: my solo fight ended with the hero teleported back to
  spawn at 60/120 HP and +gold — I *still* don't know if I won or died. Losing your whole warband
  produces no message at all.
- **Fix:** always hold the end banner ~1.5s (victory AND defeat variants: "DEFEATED — you limp
  back to Ashford"); show troops lost, not just gold gained.

### G7. Menu ships with a z-order bug
- `critic_menu.jpg`: the controls text renders *behind* the mountain silhouettes — the WASD/LMB
  line and command-key line are unreadable. First impression is a broken screen. Draw text last.

---

## 4. What already works — don't break it

- **Palette discipline is genuinely on-bar:** ochre/navy/cream world, rose/ink battle. Matches
  tf_1's discipline. Keep it.
- **HUD minimalism:** corner gold/troops/HP, one objective line, the 1 FOLLOW / 2 CHARGE / 3 HOLD
  bar with active highlight — correct and Thronefall-clean.
- **Recruit loop:** village panel ("Q Spearman 15g · E Archer 25g · F Rest & heal 10g"), toast
  ("Spearman joined your warband"), gold/cap accounting — all functional and readable.
- **Command state machine:** 1/2/3 respond instantly and troops commit decisively.
- **Nice touches:** hero dust trail on dash, archer arrow trails, allied squad balloons, the
  "BANDIT SKIRMISH 3 vs 5" intro band, the VICTORY banner content.
- **Stability:** zero console errors across the whole session; test API solid.

## Bugs hit this session
1. Menu controls text hidden behind mountain art (z-order).
2. Out-of-bounds dead bands visible in battle (up to ~40% of frame) and on the world map's left edge.
3. Units stack/overlap on the same pixel (no separation); enemies overlap the hero sprite.
4. Hero renders on top of trees; no prop collision or y-sorting.
5. World battles skip/flash the end banner; ambiguous defeat-respawn (teleport to spawn, half HP, no message).
6. Bandit party count never decreases (8 constant) despite ~5 party defeats.
7. Ambush can trigger while the recruit panel is open, eating the recruits just purchased.
