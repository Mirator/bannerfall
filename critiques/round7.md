# Round 7 critique

Scored fresh against Thronefall (tf_1, tf_5) and Wool at the Gates (wg_1) calibration images.
Screenshots: p4v8_menu, p4v8_world, p4v8_battle_small, p4v8_battle_bridge, p4v8_battle_mid,
p4v8_battle_late.

## 1. Scores (pass = 9.0)

| | Round 6 | Round 7 |
|---|---|---|
| DESIGN  | 7.0 | **7.5** |
| GRAPHICS | 6.0 | **6.5** |
| UI | 6.5 | **7.5** |

Real progress, still short of ship. The round-6 list was genuinely shipped and it shows
(axe glyph, alert culling, HP unification, kill particles). GRAPHICS is held back by a defect
that appears for the first time at the exact scale the Wool-at-the-Gates bar is judged on: mass
combat.

## 2. Ranked defects (max 8)

1. **Mass-battle units melt into a "sheep/cloud" blob, not a clump of soldiers.**
   Screenshots: `p4v8_battle_mid.png`, `p4v8_battle_late.png` (Warband 14, the largest fight in
   the set). Zoomed crop shows overlapping cream shoulder-pauldrons fusing into one scalloped
   white fringe with weapon-lines poking out like legs — it reads as a sheep or a cloud, not a
   war-band. This is the *specific* failure mode Wool at the Gates' own reference notes warn
   about ("enemies read as a mass, but with genuine silhouette tiering, not one uniform blob") —
   and it's exactly what's happening to our own units at 10+ pop density. Single units (battle_small,
   battle_bridge) read perfectly; it's only the clump that fails.
   **Fix:** enforce a minimum on-screen separation between unit anchor points before render
   (simple grid/Poisson-disc relaxation on the squad's target positions, ~1.1x sprite radius) so
   pauldron circles never touch; and/or give each unit a 1–2px darker outline stroke on the
   cream shoulder-circle so overlaps still show a seam instead of fusing into one shape.

2. **Tilled fields and the new palisade planks now share one visual language — the "furrow"
   fix didn't actually disambiguate from timber.** Screenshot: `p4v8_world.png` (stripes flanking
   Ashford). Round 6 asked for "irregular angled furrow strips in two earth tones" but what
   renders is raised rectangular plank shapes with a drop shadow — the same raised-log-with-shadow
   language as the new palisade fence. At a glance it reads as a stacked lumber pile, not a field.
   **Fix:** draw fields as a flat ground-plane fill (no shadow, no raised rectangle) inside an
   irregular plot polygon, with thin 2–3px darker furrow lines *inside* the flat shape — a texture,
   not an object.

3. **A second saturated-red UI element reopens the "red = one thing" rule from round 6.**
   Screenshots: `p4v8_battle_mid.png`, `p4v8_battle_late.png` — a thin red ring (reads as an
   elite/aggro/target indicator) sits around the enemy commander, in the same red as the
   hood-pennant that round 6 explicitly narrowed to "enemy" identity. Two red signals on screen
   again means the eye has to relearn what red means mid-fight.
   **Fix:** recolor the ring to the cream/white family already used for the dust-ring/kill-shard
   particles, or a distinct desaturated gold — keep red exclusively on the hood pennant.

4. **Round-6's tent-recolor and palisade-plank claims are untested by this screenshot set.**
   None of the six shots is an actual camp-assault battle (arena backdrop with tents) — all six
   are open-field warband fights. The world-map "Bandit camp" glyph (a separate sprite, ink-navy
   body + red pennant, `p4v8_world.png`) is fine per the round-6 rule, but it isn't the asset that
   was supposedly fixed. This is a pipeline/coverage gap, not a confirmed defect.
   **Fix:** add a `battle_camp` scenario to the headless screenshot script so the camp-arena
   tent/palisade art actually gets checked every round instead of asserted from memory.

5. **Initiative bar reuses HP-bar green, adding a fourth unrelated meaning to the same color.**
   Screenshots: `p4v8_battle_bridge.png`, `p4v8_battle_mid.png` — the FOLLOW/CHARGE/HOLD momentum
   bar is bright green, identical to the just-unified HP fill. Minor, but it's the same
   one-meaning-per-color principle the team just applied to red; green now means both "this unit
   is alive" and "your initiative is high."
   **Fix:** shift the initiative meter to blue or gold, leave green exclusively on HP.

6. **Overworld camp/keep silhouettes are close cousins.** Screenshot: `p4v8_world.png` — the
   bandit-camp tent icon and the player's own keep/flag icon are both a triangular roof over a
   navy rectangle at this zoom; only the text label and pennant color separate them. Low severity
   since the label is always present, but worth a distinct roofline (canvas ridge-tent vs.
   turreted keep) if the map ever gets busier with more camp types.

7. **Floating tooltip callouts have no anchor/pointer to what they describe.** Screenshot:
   `p4v8_world.png` ("Your scouts count the tents…") — a disconnected pill floating mid-map.
   Low severity, informational text only, not a combat-readability issue.

## 3. Single highest-leverage change

**Fix the mass-battle clump silhouette (#1).** Everything else this round is a one-line color
swap or a texture redraw; this is the one defect that fails a stated bar (Wool at the Gates mass
readability) in the screenshot that's supposed to be the strongest proof point (the 14-warband
late-game fight). Shipping polish elsewhere while the biggest battle in the build reads as a
sheep herd is the wrong trade.

## 4. Honestly at or above the reference bar

- **Menu (`p4v8_menu.png`):** flat ochre ground, hard poster-shadow title lettering, sparse
  copy — directly matches Thronefall's palette/shadow discipline (tf_1/tf_5).
- **World map (`p4v8_world.png`):** navy cream-tipped mountains, restrained resource pills,
  dashed route line — the "nearly nothing" HUD bar is genuinely met here.
- **Single-unit combat frames (`p4v8_battle_small.png`, `p4v8_battle_bridge.png`):** clean
  capsule-body silhouette, unmistakable weapon line, and the kill-moment shard/ring particle
  burst is real and reads instantly — Thronefall's "pop-on-kill" bar, met.
- **Axe/pick glyph:** now unambiguously a haft + wedge blade at both zoomed and native scale —
  the round-6 fix landed as claimed.
- **Alert '!' culling:** confirmed sparse across a long unit chain in the late-game screenshot —
  no repeated clutter, the round-6 fix landed as claimed.
- **HP bar unification:** confirmed bright green fill on both ally and enemy bars — the round-6
  fix landed as claimed.
