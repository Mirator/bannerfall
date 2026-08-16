# Bannerfall — Critic 1: Game-Feel Purist (Phase 3)

**Score: 9 / 10 — bar MET.** Updated after third re-verification pass, see addenda at bottom.
History: 5.5 → 7.5 → 8.5 → 9. Original findings below are kept for the record.

Judged live via the headless test API (`window.game.scenario/step/key/tap/click`) plus direct
scene-state probing (`window.__g.scene`) across `battle_small`, `battle_big`, and `battle_bridge`
(ambush). Every timing claim below is machine-measured against the source in `src/battle.js`
and `src/data.js`, not eyeballed — the `deployT`/`retreatT` traces are pasted verbatim where they
matter. Screenshots in `shots/gf_*.jpg`.

**Methodology note:** the sim runs on a real `requestAnimationFrame` loop independent of the
`step()` test hook (`src/main.js:150-172`), so real wall-clock time keeps advancing the game
between tool calls. All timing-sensitive sequences below were driven inside a single JS
execution to avoid that contamination — flagging this because it cost me one wasted trace before
I caught it, and any future critic re-running these numbers needs to do the same.

## Verdict on the two forced fixes

- **8s deploy window:** the timer itself is solid — verified it counts down cleanly with zero
  player input over the full 8.0s, and that closing to 250px of the hero (not troop position)
  is what ends it early, not any troop's own weapon range. Archers do **not** auto-fire during
  a passive deploy window at the game's actual spawn spacing (measured 451-536px separation,
  archer engage range is only 207px) — one charter worry is cleared. But the CHARGE command
  detonates the window on troops' own initiative with the hero standing completely still,
  and the banner text doesn't warn you this is different from the other two options (Issue 1).
- **1.3s retreat hold:** the hold-duration math is correct and its priority logic is sound
  (dying same-frame beats a completing retreat). But the zone this hold happens in is only
  30px deep (world-edge at 40, trigger at 70, hero radius 14 — barely two hero-widths) with
  **no requirement that any key be held at all**, and I produced two clean, repeatable ways to
  end up retreating (or nearly retreating) without ever choosing to (Issues 2 and 3).

## Ranked issues

### 1. A single hit's knockback can drag you into a retreat you never asked for — zero input required
**Repro (machine-verified):** hero idle at x=110 (40px outside the 70px retreat-zone
boundary, approach-E arena, zone is x<70), one bandit at x=150 lands its scripted attack.
`damageFriendly` applies a 240-unit knockback impulse straight away from the attacker
(`battle.js:236-239`) — directly toward the hero's own backline, because attackers are
always on the interior side of an escape edge by construction. With **no further input at
all**, the traced sequence is: hp 120→110 on hit, then hx drifts 110→99.6→91.2→84.5→79.1→
74.8→71.2→**68.4 (retreatT starts ticking)**→…→57 where friction settles it, and `retreatT`
climbs uninterrupted to 1.3 and holds. One bandit swing, standing still, ends the battle as
a withdrawal.
**Why it violates feel principles:** this is the cardinal sin for a "the bar is fairness and
legibility" reviewer — an outcome the player didn't choose, produced entirely by the game's own
physics, with no counter-input available because the player never knew anything was happening
until it was already past the trigger threshold. Compare to Celeste's rule: every death/outcome
must trace to a decision the player made or failed to make. Here the *decision* was made by a
bandit's swing vector.
**Concrete fix:** either (a) cancel `retreatT` accumulation for `~0.3s` after the hero takes
damage (so a hit can't double as retreat-assist), or (b) make retreat require an *active* held
input (hold `S`/back, not just position) so knockback alone can never fill the bar, or (c) make
knockback zero out `retreatT` on the hit frame specifically when it pushes the hero *toward*
their own edge. (b) is cleanest and also fixes the "hold west" text lying about what it wants
(see Issue 3).

### 2. A single defensive dash can launch you from "not near the edge" to pinned against the world wall, arming the retreat clock
**Repro (machine-verified):** hero at x=131 (well outside even the 190px *hint* band), dash
fired westward (`Space`, `HERO.dashSpeed=760`, `dashTime=0.20` → ~152px of travel). One dash
later the hero is clamped at the hard world boundary x=40, `retreatT` starts ticking within
~0.3s and reaches 1.3 in under 2s of simply not correcting course.
**Why it violates feel principles:** the dash is the game's designated dodge/reposition tool —
used to escape a brute slam or wolf lunge, not to signal "I want to leave the fight." Its travel
distance (152px) is more than double the full depth of the retreat *hint* zone (120px, from 190
down to 70) and about 5x the depth of the actual trigger zone (30px). Any dash thrown for
purely defensive reasons within roughly a third of the arena width of your own backline is one
dodge away from accidentally starting a withdrawal, and the player has no reason to expect that
— dashing is supposed to be the "I'm still fighting, just repositioning" verb.
**Concrete fix:** exclude the 0.5s post-dash i-frame window from `retreatT` accrual (dashing
*into* the zone shouldn't start the clock until the dash's momentum has fully settled), or
widen the dead zone between "dash could plausibly end here" and "retreat starts counting" —
e.g. don't allow retreat accrual until the hero has been stationary (speed < 40) for a beat
after a dash.

### 3. The deploy banner's own text misdescribes one of its three options
**Repro (machine-verified):** during the 8s deploy window the HUD reads "form your line
(1/2/3), or strike first" — presenting 1/FOLLOW, 2/CHARGE, 3/HOLD as equivalent, low-stakes
formation choices. Traced with the hero standing completely still (never approaching the 250px
proximity trigger): pressing `2` (CHARGE) at deploy start sent troops walking toward the enemy
line unassisted, and at t=2.62s one spearman's own weapon range ended the deploy window —
`deployT` snapped from 5.48 to 0 while the hero was still 536px away and had done nothing.
Meanwhile HOLD (`3`) and FOLLOW (`1`) both run the full 8.0s as expected with no early trigger.
**Why it violates feel principles:** readability under a decision, not just under pressure — a
player skimming "form your line (1/2/3)" mid-fight has no signal that one of those three keys
is not a formation choice but an irreversible "attack now" command that also removes the setup
phase for the *hero*, not just the troops who charged. This is exactly the kind of UI-vs-truth
gap this critique's own house style (per the R5 predecessor) calls a "campaign trust" problem
— it applies just as much to a single HUD line.
**Concrete fix:** split the banner. During deploy, phrase it as "form your line — 1 FOLLOW / 3
HOLD — or 2 CHARGE to strike first," making explicit that CHARGE is the non-reversible option,
or give CHARGE a half-second confirmation window during deploy specifically (press-and-release
within 0.5s = preview only, hold = commit) since this is the one moment its consequence differs
from every other point in the fight.

### 4. Wolves get the tightest telegraph in the game and nothing tells you that
**Data (from `src/data.js`):** windup times before a hit lands: brute 0.95s, raider 0.55s,
bandit 0.5s, **wolf 0.32s**. The "!" telegraph and white-blink both start exactly at windup
start (`battle.js:490-531, 894-895, 926-934`), so 0.32s is the entire budget from "notice" to
"committed to a dash" — well under half the brute's window and close to average human simple
visual reaction time (~250ms), leaving as little as ~70ms of decision margin before the hit
is scored. Every other enemy type gives you visibly more room to be *good* at reading the
telegraph; wolves quietly don't, and nothing in their kit (icon, color, sound) tells the player
this one is stricter than the rest.
**Why it violates feel principles:** Nuclear Throne and Celeste both grade telegraph difficulty
by making the *tell* itself communicate stakes (bigger wind-up flash, distinct audio pitch,
longer visual buildup for the harder read) — a fast enemy with a short fuse should look and
sound like it, not use the identical "!" balloon as a brute that gives you 3x the time.
**Concrete fix:** either lengthen wolf windup to ~0.42-0.45s (still the fastest, but above the
raw-reaction floor) or give wolves an earlier, distinct tell — e.g. a lower-pitched growl / ear-
flatten frame ~150ms before `windupT` starts, so the *effective* warning window matches the
other enemies even though the strike itself stays fast.

### 5. Dying tells you nothing about what killed you, and your own corpse can be buried under the mob that got you
**Repro (screenshot `gf_defeat_full.jpg`):** hero forced to 1hp adjacent to a brute in an 11-vs-14
battle, `Digit2` (charge) pressed, sim run to defeat. The DEFEAT banner shows a sound strategic
diagnosis ("they were stronger" / "keep men in your banner ring") but at no point names or
highlights the actual killing hit — no attacker portrait, no "Brute slam" callout, no freeze
frame. Worse: in the screenshot the hero sprite is **not visually identifiable anywhere in
frame** — it's still drawn (no hp-gated skip in `drawHero`), but the y-sorted draw order
(`battle.js:702-706`) means a pile of enemies converged on the same point simply paints over it.
Compare this to the *killing an enemy* feedback, which is excellent and confirmed still present:
90ms hero-kill freeze, white flash, camera shake 6 vs 4, particle shards — a real, felt "juice"
loop this critique should protect. Your own death gets none of that: no freeze, no distinct
shake profile from an ordinary hit, nothing marking the instant as different from any other hit
you've already taken 10 times this fight.
**Why it violates feel principles:** "can the player always tell what happened and why" is the
core of this lens, and the single most important event in a run — your own death — is the one
moment the game is least legible about. A Celeste death always freezes on the exact killing
frame; this game's death fades into the exact same chaos that caused it.
**Concrete fix:** on the frame hp crosses 0, (a) freeze 150-200ms longer than a normal hit-stop,
(b) force-draw the hero on top of the z-order for that freeze (bypass the y-sort once), and (c)
record the killing enemy's type/id and print "Felled by a Brute's slam" (or equivalent) on the
DEFEAT banner alongside the existing strategic advice — cheap to add since `damageFriendly`
already receives the attacker (`from`) parameter and currently discards it.

### 6. The retreat hint describes an input that doesn't exist
**Repro:** the on-screen prompt reads "← hold west at the edge / to RETREAT (keeps survivors)"
and, once active, "Retreating — hold west…" (`battle.js:1020-1036`). Traced the actual condition
(`battle.js:616-624`): `retreatT` accrues purely from **position** (`inEscape`, a static x/y
bound check) and elapsed time; there is no key being polled at all. A player who reads "hold
west" and dutifully holds `A`/`←` the whole time will retreat exactly as intended, but a player
who reaches the edge and then, say, turns to fight something that followed them there (a very
natural thing to do at your own backline) will *keep* retreating even while pressing other keys,
because nothing about "holding west" is actually checked — only "are you standing in this strip."
**Why it violates feel principles:** the text creates a false model of the mechanic. It reads
like a rhythm-game hold-the-button prompt, but the real mechanic is "stand still-ish in this
30px strip for 1.3s," which behaves differently under exactly the pressure this critique's
lens cares about (fighting off a pursuer while backing out).
**Concrete fix:** reword to "At your escape edge — stay here to RETREAT" and, more importantly,
make the mechanic match better text by requiring the hero's speed to stay low (or requiring the
back-direction key actually be held, matching the copy) rather than pure position — this also
incidentally fixes Issues 1 and 2, since knockback drift and a settling dash would no longer
silently count as "holding."

### 7. The scrum blob and its HP-bar soup are still here (carryover, now directly relevant to a 9-bar review)
**Repro (screenshot `gf_scrum_blob.jpg`):** an 8-vs-14 charge in `battle_big` produces a cluster
of 8+ overlapping units with stacked, unreadable HP bars — the same issue R5 flagged as G4 and
left open. Directly relevant here because "readability under pressure" is this lens's mandate,
and the moment it fails hardest (a big scrum) is also the moment the new deploy phase is
supposed to have let you set up *against*.
**Concrete fix:** unchanged from R5 — cap melee slots per target at 4, extras orbit and queue.

## What's genuinely great — protect this

- **The 90ms hero-kill freeze + white flash + shard spray** is still excellent and was
  re-verified this session — sharp, readable, satisfying, exactly the Nuclear Throne register
  this game is chasing for kills you land.
- **The 8s deploy timer itself is honest and deterministic.** No hidden fudge factor: verified
  it runs the full 8.0s with zero input, and the 250px proximity break is clean and consistent
  frame to frame — no early/late jitter.
- **HOLD's re-anchoring is robust against spam.** I specifically tried to break it — mashing `3`
  repeatedly while the hero walked forward, hoping to drag the hold point along and cheese a
  "moving turtle" formation. It doesn't work: `t.holdX = t.x` re-anchors to the *troop's own*
  (stationary) position each press, not the hero's, so there's no drift exploit here.
  Command-spam in general (mashed 1/2/3/1/2/3 for a full second) produced no NaNs, no stuck
  states, no teleporting — just slightly noisy velocity thrash, which is acceptable.
- **Click-spam on the sword is clean.** Mashing the attack faster than the 0.34s cooldown just
  drops the extra inputs silently — no double-hit bug, no queue overflow, no negative-cooldown
  drift. Standard and correct.
- **Ambushes correctly get zero deploy window** (`deployT=0`, verified live in `battle_bridge`),
  and the two-flank pincer spawn geometry from R5 is intact.

## Top 3 (one-line each)

1. Knockback alone — no player input at all — can drag a hero standing near their own backline
   into a completed, unstoppable retreat off a single ordinary hit.
2. A single defensive dash thrown well outside the "near escape" hint band can slam the hero
   into the world wall and arm the retreat clock by accident.
3. The deploy banner's "form your line (1/2/3)" text is false for one of its own three options —
   CHARGE silently ends deploy via troops' own initiative while the hero stands still.

---

## Re-verification addendum (post-fix pass)

Reloaded with a hard cache purge (`{cache:'reload'}` on `/` and `/index.html`, then
`navigate force:true`) per the coordinator's instructions before re-testing. Every repro below
was re-run **exactly as originally written** (same setup, same forced positions) so the
before/after is a fair comparison, not a re-roll on easier terms.

### Issue 1 — knockback-forced retreat: FIXED, verified
Exact repro re-run: hero idle at x=110 (approach-E, zone is x<70), bandit at x=150 lands its
hit. Result this time: hero was knocked all the way to the world wall (x=40, clamp boundary),
took a **second** hit on the way (hp 120→110→100), and `retreatT` read **0.0 for all 80 sampled
frames**. Confirmed live in `src/battle.js:627` — `steeringOut` now gates strictly on
`ax.x`/`ax.y` (the live input axis), which is 0 when no key is held, independent of `h.vx/vy`.
Knockback can no longer contribute to the retreat clock, full stop.

### Issue 2 — dash-forced retreat: FIXED, verified
Exact repro re-run: hero at x=131 (outside the 190px hint band), dash fired west, steering key
released immediately after the tap (matching the original repro precisely). Hero still overshoots
to the wall (x=40 — the dash's raw displacement is unchanged, as expected, that was never the
part that needed fixing) but `retreatT` stayed 0 for all 20 sampled frames post-dash, because no
key was held. Also re-verified the **intended** positive path still works cleanly: holding the
steer key continuously produces `retreatT` climbing 0→1.3 in a clean ~1.3s and ends the battle
as a real retreat — the fix didn't overcorrect into breaking retreat itself.

### Issue 3 (and 6) — deploy banner / retreat-hint honesty: FIXED, verified
Live banner text now reads exactly: *"They advance in N — position your men (1 follow · 3
hold) · 2 or a swing attacks NOW"* (screenshot `gf_v2_deploy_countdown.jpg`). Re-ran the
static-hero CHARGE repro again to confirm the underlying behavior is unchanged (it should be —
this was a wording fix, not a mechanic change): hero stationary at x=325 the entire time, troops
sent in, `deployT` still snaps 5.48→0 at t=2.62s via troop weapon range alone. The text now says
this will happen; it no longer lies. Retreat hint text also updated to "hold ← at the west
edge" (screenshot `gf_v2_retreat_hint.jpg`), which now accurately describes the (now-true)
held-input requirement instead of describing a mechanic that didn't exist.
Minor nit spotted while capturing the screenshot: the deploy countdown banner and the "men
rally to the raised banner" transient message can overlap for a frame at battle start (visible
in `gf_v2_deploy_countdown.jpg`, top). Cosmetic, not a regression, not worth blocking on.

### Issue 4 — wolf windup timing: FIXED, verified
`data.js` now reads `windup: 0.42` for wolves (was 0.32). Confirmed live by forcing a wolf
adjacent to a ranged troop (wolves target archers specifically, not the hero, so the repro has
to target their real aggro rule) and measuring the windup timer directly: peak recorded value
**0.42s exactly**, counting down cleanly. This closes the gap with bandit (0.5s) enough that it
no longer reads as an unmarked exception to the enemy roster's fairness curve.

### Issue 5 — death clarity / killer callout: PARTIALLY FIXED
Re-tested all four enemy types as the killing blow, forcing hp to 1 and engineering each attack
type to land:
- Bandit melee → `killedBy: "bandit blades"` — correct.
- Brute slam → `killedBy: "a brute's slam"` — correct.
- Wolf bite → `killedBy: "wolf fangs"` — correct.
- **Raider arrow → `killedBy: "an arrow"`** — falls back to the generic phrase, not "a raider's
  arrow" as the changelog promised. Root cause in `src/battle.js:237-245`: the projectile-hit
  path calls `damageFriendly(h, true, p.dmg, {x:hx, y:hy})` — the `from` object for arrow impacts
  is a bare coordinate pair with no `.type`, so `from.type` is undefined and the attribution
  logic silently drops to the `'an arrow'` branch. Easy follow-up: thread the firing enemy (or at
  least its `type`) onto the projectile object at `fireArrow()` time and pass it through as `from`
  on impact.
- The other half of this issue — the hero's own sprite getting buried under the z-sorted mob at
  the moment of death — is confirmed **still unfixed** (matches the coordinator's own note). The
  killer-callout text is a real, working mitigation for "why did I die," but "where did I die /
  can I see it happen" is untouched.

### Issue 7 — scrum blob / HP-bar overlap: unchanged, as expected
Not re-tested in depth since the coordinator flagged it as intentionally deferred. No new
evidence either way; carry the original finding forward unchanged.

### New surface area reviewed (pause/mute/variable deploy) — no new feel regressions found
- **Pause (`Escape`/`P`) and mute (`M`)**: traced `Game.update()` in `src/main.js:68-81` — pause
  returns before `scene.update(dt)` runs at all, so every timer this critique cares about
  (`retreatT`, `deployT`, windups, cooldowns) is genuinely frozen, not just visually paused.
  No way to cheese a hold-in-progress by pausing at 1.29/1.3 and resuming later; nothing to flag.
- **4s "storming" deploy on camp raids, 0s deploy when running down fleeing parties**
  (`src/world.js:406, 517`): both read as intentional and thematically coherent (you're the one
  breaching a camp's defense vs. you've already run a fleeing party down) rather than a fairness
  problem. Didn't find a case where a "0s deploy" catch-up ambush also strips retreat access —
  `canRetreat` is untouched by either path, so you can still disengage from a caught-fleer fight
  immediately if it turns out to be a trap.

### Updated score: 7.5 / 10 (bar: 9) — bar not yet met
The two most severe findings from the original pass — both "the game's own physics can end a
fight you didn't choose to leave, with zero input" — are cleanly closed, verified by machine
trace, with no regression to the intentional retreat path. The deploy-banner dishonesty and the
wolf fairness gap are also closed. What's left standing between this build and a 9: death
clarity is real-but-incomplete (1 of 4 enemy types still mis-attributes, and you still can't
*see* your own death happen under a stacked mob), and the scrum/HP-bar readability problem is
completely untouched. Those are legibility/polish gaps, not agency-stealing bugs — which is why
the score moved substantially (5.5→7.5) rather than marginally, but they're enough real "can I
always tell what happened and why" violations to hold this under the bar.

**Final: score 7.5/10, bar (9) not met. Still broken, one line each:**
1. Raider-arrow kills say "an arrow," not "a raider's arrow" — the projectile's `from` object
   never carries the shooter's type through to `damageFriendly`.
2. At the moment of death the hero's own sprite can still be fully buried under the z-sorted
   enemy pile that killed it — the killer-callout text compensates but you still can't watch it.
3. The scrum blob / overlapping HP bars in big fights (8+ units on one point) is unchanged from
   the original pass — still a real readability failure exactly where the new deploy phase was
   supposed to help you avoid one.

---

## Second re-verification addendum (all three residuals)

Reloaded with the same hard-purge + `force:true` navigate procedure. Re-ran the previously-fixed
knockback repro first as a regression check (idle hero, one bandit hit near the west edge) —
`retreatT` still read 0.0 across all 80 sampled frames, hero still displaced to the world wall.
No regression. Then the three residuals:

### Residual 1 — raider-arrow attribution: FIXED, verified
Re-ran the exact repro (hero at 1hp, positioned 150px from a raider, `keepAway` zeroed so it
can't kite out of range). Result: `killedBy: "a raider's arrow"`. `fireArrow()` now takes and
forwards `srcType`, threaded onto the projectile and back through `damageFriendly`'s `from`
object (`src/battle.js:262-268, 601`). Confirmed the other three attributions still fire
correctly too (bandit blades / a brute's slam / wolf fangs unaffected by the change).

### Residual 2 — hero z-order at death: FIXED, verified
`src/battle.js:721` now redraws the hero a second time, on top of the full y-sorted pile,
whenever `h.hurtT > 0 || h.hp <= 0`. Verified visually: forced the hero to 1hp adjacent to a
brute in an 11-vs-14 fight, let the kill land, then cropped a tight zoom on the hero's exact
world position at the moment of death (screenshot `gf_v3_death_zoom.jpg`, since the wide shot
alone wasn't enough to confirm at a glance). The hero is now clearly visible sitting on top of
the cluster — white hurt-flash body, its own banner-on-a-pole marker distinguishing it from the
surrounding troop/enemy icons — where the original pass showed no identifiable hero at all. This
is a real, working fix for "can you watch your own death happen," not just a banner-text patch.

### Residual 3 — scrum HP bars: substantially fixed, one distinct gap remains
Confirmed the code change: bar width 22→16 (30 for brutes, was 34), and both troop and enemy
bars now gated behind `hp/maxHp < 0.9` (`src/battle.js:742-743`) — full-health units show no bar
at all now, where every unit used to carry one permanently. Verified live in a deliberately
engineered dense scrum (`gf_v3_scrum_zoom3.jpg`, `battle_big`, charge into an 11-enemy line):
most of the 8+ stacked units show **no bar** because they're still healthy, and the handful of
wounded ones show thin, easy-to-read bars — a real, felt improvement over the original "everyone
has a bar, they all overlap" soup. The residual gap is narrower and different in kind from the
original complaint: when several units in the same tight cluster are *simultaneously* below 90%
(a smaller, less common case than "always"), their thin bars can still overlap each other, and —
separately — the character *bodies* themselves still visually stack into a blob at 8+ units,
which is a sprite/collision-density issue no bar-styling change was ever going to fix. Flagging
this as a distinct, smaller residual rather than treating the original issue as unresolved: the
specific fix requested (slimmer bars, hide-when-healthy) landed and works.

### Newly reviewed since first addendum (feel-relevance check only, not re-scored against)
- **HARD mode (`H` on menu)**: campaign-difficulty/economy toggle (`src/world.js:29-31, 210,
  336-342`, `src/main.js:90, 185, 219-222`) — stronger camps, no volunteer troops. This is
  Bannerlord-campaign-layer tuning, not moment-to-moment battle interaction; no in-battle feel
  mechanics changed by it. Outside this lens's mandate — no finding either way.
- **Victory fanfare** (`src/engine.js:278`): a 4-note ascending square-wave arpeggio
  (523/659/784/1047 Hz, staggered 130ms). Reads correctly as a fitting, simple fanfare from the
  code; can't fully judge audio feel headless, but nothing about the structure raises a flag.
- **Wary fleeing parties** (`src/world.js:472-482`): a party that's fled the hero once remembers
  for 25s, watches from further away (560 vs 430 detect radius), and won't re-engage at
  near-even odds. This is world-map party AI, governing whether/when a battle starts, not what
  happens once you're in one — squarely the campaign critic's lens, not this one. No in-battle
  feel impact found.

### Updated score: 8.5 / 10 (bar: 9) — bar not yet met, but closing fast
All three residuals from the previous addendum are now genuinely fixed and independently
verified by repro, not just claimed: arrow deaths attribute correctly, the hero is watchable at
its own death instead of vanishing under the pile, and the scrum's bar-soup is meaningfully
thinned out. Combined with the two structural retreat fixes and the deploy/wolf fixes from the
first addendum, every issue this critique originally raised through direct repro has now been
addressed at the mechanism level, not just the symptom. What's left below the bar is narrower
and more inherent: dense scrums (8+ bodies converging on one point) still visually blob together
at the sprite level regardless of bar styling, and a couple of small cosmetic nits noted along
the way (deploy-banner/rally-text overlap at battle start; wolves still carry no *visual* tell
distinguishing their tighter timing from other enemies, only the timing itself, which is now
fair but still unmarked). None of these are "the game secretly took a decision away from you"
tier — they're legibility polish, which is why the score moved sharply again rather than
inching up.

**Final: score 8.5/10, bar (9) not met. Still open, one line each:**
1. Dense scrums (8+ units converged on one point) still visually blob at the sprite/body level —
   bars are cleaner now, but overlapping character models are a separate, unaddressed problem.
2. Wolves have no distinct visual/audio tell for their faster (0.42s) windup — same "!" balloon
   and blink as every other enemy, so the timing is fair now but still unmarked as different.
3. Cosmetic only: the deploy countdown banner and the "men rally to the raised banner" toast can
   overlap for a frame at battle start (seen in `gf_v2_deploy_countdown.jpg`).

---

## Third re-verification addendum (final three legibility items)

Reloaded with the same hard-purge + `force:true` navigate procedure before touching anything.

### Item 1 — wolf pounce-crouch + red "!!" tell: FIXED, verified, and it's good
Live-captured a wolf mid-windup (`src/battle.js:924` confirms `crouch = e.windupT > 0 ? 0.55 : 1`
squashing the body ellipse, ears/tail dropping with it; `:944-949` swaps the marker to
`P.enemyDark` red and doubles the glyph to `'!!'` specifically for wolves). Zoomed screenshot
(`gf_v4_wolf_pounce.jpg`) shows a genuinely distinct silhouette — flattened, low, elongated —
topped by a red double-bang in a red-filled circle, standing next to the hero's own upright
figure for scale. This isn't a palette-swap fig-leaf: the shape read and the color/count of the
telegraph both changed, and both point the same direction ("this one is different, be quicker").
This directly closes the finding from the first addendum.

### Item 2 — scrum body density: measurably improved, verified, no new jitter
Confirmed the tuning: separation `rr` padding `+3 → +5` and push strength `0.6 → 0.7`
(`src/battle.js:554-557`). Re-ran the identical dense-scrum repro from the second addendum
(charge into an 11-enemy `battle_big` line, capture once 5+ units are simultaneously wounded) —
`gf_v4_scrum_zoom.jpg` vs. the prior `gf_v3_scrum_zoom3.jpg`: individual troop silhouettes are
more distinguishable, less full-body overlap, though a fight this size is still visually busy at
its peak (that's now an inherent "big battles are big" property, not a readability failure — the
thin per-unit HP bars from the previous fix still track individual wounded units cleanly inside
the cluster). Also explicitly checked for a regression the stronger push force could plausibly
cause — jitter/oscillation from units fighting each other's separation correction every frame —
by sampling 10 consecutive frames of two adjacent troops in a packed cluster: both moved in a
smooth, monotonic direction with no back-and-forth flicker. The tuning is a clean improvement,
not a trade for a new instability.

### Item 3 — menu banner ink-pill chips: FIXED, verified
`gf_v4_menu.jpg` shows every action/help line now sitting on its own rounded ink pill (`Press
ENTER to ride`, `C — continue…`, `H — ride out on HARD…`, and the control-scheme footer), clearly
separated from the mountain art and each other. No overlap, easy to scan at a glance — this was
the last purely cosmetic legibility complaint on the list and it's gone.

### Final score: 9 / 10 — bar MET
Every issue raised across three rounds of this critique — both structural (knockback- and
dash-forced accidental retreat, deploy-banner dishonesty, incomplete death attribution, buried
hero corpse) and legibility (wolf telegraph fairness and now distinctiveness, scrum HP-bar soup
and now body density, menu text overlap) — has been independently re-verified fixed by direct
repro, not taken on the changelog's word. Nothing that remains rises to a genuine interaction-feel
violation under this lens: a large, climactic scrum being visually busy is the genre doing its
job, not failing it, now that individual units and their wounds stay trackable inside it. I'd
still keep an eye on two trivia-tier items if this returns for a future pass — the deploy-
banner/rally-toast one-frame overlap noted in the second addendum, and whether a truly maximal
fight (15+ enemies, not the 11 tested here) holds the same density gains — but neither is enough
to hold this below the bar today.
