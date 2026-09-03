// Battle tuning constants and the squad vocabulary, shared by the scene core, the HUD and
// (from step 4 on) the AI phases. Extracted FIRST and depending on nothing but data.js:
// with no bundler an import cycle is a real hazard, and this module is what prevents one
// between battle.js and the phase/render modules that need these values.
import { PAL, UNIT_TYPES, ENEMY_TYPES } from '../data.js?v=rc5d65ad8e17b';

export const BASE = Object.freeze(Object.assign({}, PAL.battle));

// One squad per unit type, in HUD order. Derived from the unit table so a new unit
// type can never exist without a squad to command it.
export const SQUAD_TYPES = Object.freeze(Object.keys(UNIT_TYPES));
// Exported so world-screens.js (Plan 021) can label the player's roster on the brief
// screen with the exact same strings instead of duplicating them.
export const SQUAD_LABELS = Object.freeze({ spear: 'SPEARS', archer: 'BOWS', knight: 'HORSE' });

// Plan 027: the enemy's squads mirror the player's exactly — one per ENEMY_TYPES key,
// membership derived from type, never assigned. Same three stance names, same
// brace/steady-aim/charge-exposure mechanics. A new enemy type cannot exist without a
// squad for the commander to address, for the same reason SQUAD_TYPES above holds.
export const ENEMY_SQUAD_TYPES = Object.freeze(Object.keys(ENEMY_TYPES));

// Stance trade-offs. A braced melee line hits harder against anything that CAME IN AT A
// RUSH, and a standing bow line shoots tighter than a walking one. See plans/019 for the
// original mechanic and plans/029 for the rebuild.
//
// ---- Why the brace reads a latch and not a speed (plans/029, measured)
// Until Plan 029 the test was `len(target.vx, target.vy) > BRACE_SPEED` evaluated at the
// instant of the swing, and it essentially never fired. Measured over 24 fights on two
// fixtures (critiques/progression-baseline.md), sampling every enemy inside a holding
// melee troop's strike reach: the MEDIAN closing speed is NEGATIVE for every body on both
// fixtures — by the time anything is in spear reach it has braked to wind up its own blow
// and separation is pushing it back out. The bonus fired on 0.1% of bandit contacts, 0% of
// brute contacts and 2.5-6.1% of wolf contacts. That is not a threshold that needs
// lowering; it is the wrong instant.
//
// Latching the fastest speed seen in the last second does not fix it either, and that was
// measured before it was designed in: the latched peak clusters around 72-79 for EVERY
// body, brutes (base speed 55) included, because the `+= cos * 85` knockback impulse every
// landed hit applies is larger than most bodies' locomotion. A rule keyed anywhere in that
// band would mean "I hit it, therefore it charged me".
//
// So the latch is on COMMANDED LOCOMOTION WHILE APPROACHING A HOSTILE — the speed the AI's
// movement branch is steering toward, set only when the unit actually has an approach goal.
// Knockback cannot enter it, because knockback is not a commanded speed.
//
// ---- What counts as a rush: two clauses, because bodies have different natural speeds
//   * at or above BRACE_SPEED — an inherently fast body. 130 sits above every walking body
//     in the game (bandit 92, raider 82, brute 55, spear 105, archer 95) and below the two
//     that are cavalry in all but name: the wolf (158) and the knight (175).
//   * or above BRACE_CHARGE_MUL times its OWN walking speed — a body that was ORDERED
//     forward. `charge` is x1.15 and bloodlust x1.3, so both qualify and a walk never does.
// Terrain multipliers are deliberately excluded from the comparison: a bandit strolling
// down a road (92 x 1.14 = 105) is not charging anybody.
//
// The rule is one predicate used by BOTH sides, which is Plan 027's symmetry requirement.
// It therefore catches, for the player's braced line: wolves always, and bandits, raiders
// and brutes once the enemy commander orders `commit` or the stall clock arms bloodlust.
// And for the enemy's: the player's knights always, and his spears and bows only under a
// CHARGE order — so charging into a set line is a real trade rather than a free tempo gain.
export const BRACE_SPEED = 130;
export const BRACE_CHARGE_MUL = 1.10;
// How long a rush is remembered after the body stops. Long enough that a spearman's 1.05s
// cooldown still lands the receiving blow on the man who ran at him; short enough that a
// body standing in the scrum trading hits stops counting as a charge after the first
// exchange. It is the receiving blow that is braced, never a permanent buff — which is
// also why a hit-and-run wolf keeps earning it and a brute in a grind does not.
export const BRACE_MEMORY = 1.6;
export const BRACE_BONUS = 1.8;
// Plan 032 added the second half of the rule: the bonus pays only against a rush that comes
// in through the braced body's OWN front arc (FRONT_ARC below — the same cone the flank
// multiplier reads). A line cannot set itself against something that arrives behind it.
// Because a body squares up on whatever it is fighting inside about a fifth of a second,
// what this gate actually costs the brace is the FIRST blow against a rusher that closed
// from behind while the man was still turned on somebody else — which is exactly the blow a
// set line has not earned.

// ---------------------------------------------------------------- Plan 032: facing and flanks
// Every body has carried a `facing` since the first battle build, and until this plan NOTHING
// in the damage arithmetic read it. Contact resolved identically from every direction, so an
// idle blob and a formed line took the same hits, and Plan 027's flanking muster changed only
// where the enemy walked, never what the walk was worth. That is the mechanical reason four
// plans in a row measured pressing nothing as a competitive policy.
//
// FRONT_ARC is the half-angle of the cone a body is actually facing; a MELEE blow landing
// outside it is a flank and is multiplied by FLANK_BONUS. +/-110 degrees leaves a 140-degree
// rear wedge rather than splitting the body in half, and that width is deliberate: a unit
// turns onto its target at 1 - exp(-8 dt) (troops) or 1 - exp(-6 dt) (enemies), so it is
// square to whatever it CHOSE to fight almost immediately. The arc therefore does not price
// "which way is he pointing", it prices "he is already committed to somebody else" — the
// second man onto a body, and the man who arrives while it is winding up on someone behind
// him. A narrower cone would fire on nearly every contact in a scrum and stop meaning
// anything; a wider one would only fire on a literal back-stab and stop firing at all.
//
// 1.35 is deliberately the same number as CHARGE_EXPOSURE. Both are "your formation is open
// and it costs you", they are the two positional prices in the game, and pricing them
// differently would be a claim neither measurement supports.
//
// MELEE ONLY. Three exclusions, each an answer to "from where did this land":
//   * An ARROW resolves against whoever is nearest WHERE IT FALLS, hundreds of milliseconds
//     after it was loosed and after the target has turned. There is no honest incoming
//     direction at that instant, and the bow line already buys its identity on a different
//     axis (steady aim, and the declared bonusVs counter).
//   * A brute's SLAM is an AoE ring centred on the brute; the bodies inside it have no
//     incoming direction either. The slam is already excluded from BRACE_BONUS for the same
//     reason, and a 1.35x slam is a lethality change, which is what the phase-4 audit
//     measured and rejected.
//   * The HERO is outside the rule in BOTH directions, which is what keeps it symmetric
//     rather than merely applied to both teams. His facing comes from the cursor through
//     Camera.toWorld, so making his back a damage multiplier would put fight outcomes back
//     under the mouse — the defect `battle outcomes are independent of canvas size and cursor
//     position` exists to catch. He also has no stance, which is why damageFriendly already
//     exempts him from charge exposure.
//
// Both sides read these two constants directly, per Plan 027's symmetry rule, and no perk
// moves either one — deliberately: the flank is geometry, and a perk that made the player's
// own back safer would be the flat aura Plan 029's perk rule forbids.
//
// Measured on the 120-raid camp-raid sweep in stance-balance.spec.js, against PRE-033 main
// (the deployment phase landed while this slice was in flight), idle / chargeAll / split
// win %: 69 / 68 / 45 before, 68 / 68 / 48 after. Idle did NOT rise, which was the failure
// mode this slice was watching for — both sides surround, and a camp garrison outnumbers
// the warband, so the extra second-man-on-a-defender blows land on the player at least as
// often as on the enemy. 1.60 was probed then and REJECTED: it flipped the sweep's (then
// expected-failure) assertion on one point of idle erosion while commanding was unchanged
// between the two values — the constant had to earn its value, not the assertion. Combined
// with Plan 033 (troops deploy formed and hold by default), the sweep reads 51 / 59 / 38,
// twice, digit for digit: the post-033 guard (best deliberate policy beats idle) holds with
// the arcs live, and split — the mixed-order policy — is where the flank pays the most.
//
// Two accepted properties of the shipped rule, priced here so a retune reads them:
//   * The multipliers STACK: a braced blow on a charging body reached from behind is
//     bonus x FLANK_BONUS x CHARGE_EXPOSURE = 1.8 x 1.35 x 1.35 ~ 3.28x — the most
//     punishing single blow in the game. Moving either 1.35 moves that ceiling.
//   * updateTroopPhase runs before updateEnemyPhase, so a troop's facing is one lerp step
//     fresher when the enemy tests it than an enemy's is when a troop tests it — a small
//     fixed asymmetry inside the frame, bounded by one tick's 6-12.5% turn.
export const FRONT_ARC = 110 * Math.PI / 180;
export const FLANK_BONUS = 1.35;
// How far from the hero the Warlord perk's dash rally reaches (plans/029). Wider than the
// hero's own swing (86) because a rally is an order, not a blow, and narrower than the
// FOLLOW formation's own spread so it rewards riding INTO the line rather than past it.
export const RALLY_R = 240;
export const BOW_SPREAD = 0.12;
export const BOW_SPREAD_BRACED = 0.05;
// Men running at the enemy have their shields down and their formation open. This is what
// CHARGE pays for its speed, and the reason ordering everyone to charge is not free.
export const CHARGE_EXPOSURE = 1.35;
// How long shields stay down after a charge order is rescinded.
export const CHARGE_RECOVER = 1.1;
// A fight in which nobody has died for this long is not a battle, it is a grind.
export const STALL_NO_DEATH = 14;
// The arena margin every body is clamped inside. Named by Plan 040 because it is now read
// by the steering as well as by the clamp: a heading that pushes into this boundary is
// absorbed whole by the clamp, so a body freezes at full speed and never re-decides — see
// slideAlongArenaEdge below and the measurement in critiques/orders-comparison.md.
export const ARENA_EDGE = 30;
// What each order costs or buys, per squad kind — shown on the squad's own HUD row so the
// trade-off is legible during the fight. FOLLOW is deliberately absent: it is the neutral
// order and has nothing to advertise.
export const STANCE_NOTES = Object.freeze({
  hold: { melee: 'braced', ranged: 'steady aim' },
  charge: { melee: 'shields down', ranged: 'bows down' },
});

// ---------------------------------------------------------------- Plan 027: enemy command
// The enemy commander re-reads the field this often. Two properties fix this number and
// neither is negotiable without re-checking the other:
//   * It is the delay before the FIRST decision, and the nine battle visual baselines
//     settle at 1.5s. Eight sit paused in the Plan 033 deployment phase at that point
//     (no phase runs at all until CONFIRM); `battle_bridge` is an ambush with no
//     deployment phase and reaches 0.4s of live fight after its 1.1s intro. 0.8s is
//     provably outside every captured frame.
//   * It is the reaction latency the player feels. Faster reads as clairvoyance, slower
//     reads as the enemy not noticing.
export const CMD_TICK = 0.8;
// How far from the player's centre of mass, on the enemy's own side, the force musters.
// It must sit OUTSIDE everything the player can reach without deciding to: past melee's
// FOLLOW engage radius (150) and past bow range (archer.range * 0.9 = 207). Measured the
// hard way — at 150 the "muster" walked the whole enemy line into the middle of the
// player's blob and stood it still there, and the fixture resolved FASTER than baseline
// (16.8s against 37.4s) because a stationary clump inside a warband is the easiest thing
// on the field to kill.
export const CMD_STANDOFF = 340;
// Lateral spread of the anchor from battle to battle, drawn from the ENEMY_COMMAND stream
// so the same fixture does not form up on the identical spot every seed.
export const CMD_ANCHOR_JITTER = 190;
// The commander pulls its anchor toward real Plan 024 cover (`battle.blockers`: hills,
// woods, houses) when there is any this close, by this fraction of the distance. A
// briefless template fight has few or no blockers and simply keeps the un-pulled anchor.
export const CMD_COVER_R = 420;
export const CMD_COVER_PULL = 0.45;
// Formation geometry for a held enemy line. Only the men with spears muster — see the
// `hold` branch in ai-phases.js for why a bow and a wolf do not — so the rank gap
// separates the bandit wall from the brutes behind it, and the row/col gaps space the men
// inside a rank.
export const CMD_RANK_GAP = 95;
export const CMD_ROW_GAP = 34;
export const CMD_COL_GAP = 46;
// Mean distance of the player's troops from their own centroid. Below BLOB the warband is
// one undifferentiated lump, so the assault forms up off its flank where a blob has no
// frontage; above it the warband is strung out and the assault forms frontally, straight
// through the thin part. The reaction lives in WHERE the line forms, which is what flanking
// physically is — not in a per-unit swerve, which was measured to make a lone raider orbit
// a static warband indefinitely (see plans/027's Implementation findings).
// Binary on purpose: the two assaults issue identical orders and differ only in where the
// force musters, so a third middle band would need a third muster placement to mean
// anything, and there is no third thing a commander wants to do about a line's width.
export const BLOB_SPREAD = 190;
// How far off the direct approach axis a flanking muster point sits, in radians.
export const CMD_FLANK_ANGLE = 1.15;
// The commander commits everything once the player's warband is down to this fraction of
// its starting size: there is nothing left to manoeuvre against, and a charge into a broken
// line cannot be punished. Scaled by the per-battle nerve draw.
export const CMD_BLOOD_FRAC = 0.45;
// Per-battle nerve, drawn once from the ENEMY_COMMAND stream: multiplies the fraction above
// so one garrison commits earlier than another and a fixture does not play out the same way
// at every seed.
export const CMD_NERVE_MIN = 0.8;
export const CMD_NERVE_SPAN = 0.5;
// The whole point of the muster: an enemy force that arrives TOGETHER instead of in the
// order its unit speeds happen to deliver it. Un-commanded, a wolf at 158 reaches the
// player's line eleven seconds before a brute at 55 and both die alone; that staggered
// arrival is why "kill everything" resolved itself from either side. The commander holds
// the assault until this fraction of its men are within CMD_SLOT_TOL of their slots, or
// until CMD_FORM_MAX seconds have passed, whichever comes first.
export const CMD_FORMED_FRAC = 0.7;
export const CMD_SLOT_TOL = 90;
// Deliberately under STALL_NO_DEATH (14): the assault must always arrive before the stall
// clock has to force it, so the clock stays a guarantee rather than a scheduler.
export const CMD_FORM_MAX = 6;
// A stalking wolf holds this far from its target and refuses to close. It commits on its
// own — no order needed — against a target under WOLF_COMMIT_HP of its health, or one
// this much further from the warband's centroid than the warband's own mean spread.
//
// PLAN 040 MOVED THIS FROM 250 TO 180, and the arithmetic is the whole argument. A
// stalking wolf backs off under `0.9 R` and stands its ground out to `1.25 R`
// (updateEnemyPhase in ai-phases.js), so the band it occupies is [0.9R, 1.25R]. At 250
// that band is 225-312 px and an archer's range is 230 (UNIT_TYPES.archer): most of the
// pack sat outside the only weapon the player owns that could answer it. Nothing the
// warband fields except the knight (175) and the hero (315) can catch a body moving at
// 158, so a HOLD line against a pack did nothing at all until the no-death stall clock
// (STALL_NO_DEATH, 14 s) forced `bloodlust` — fourteen seconds of standing still followed
// by a scripted "THEY CLOSE IN!". Measured on the `wolves` fixture, HOLD resolved at 14.8 s,
// which is that clock and not a fight.
//
// For the WHOLE stand band to sit inside archer range: 1.25 R <= 230, so R <= 184. At 180
// a stalker backs off under 162 and stands between 162 and 225 — still outside a braced
// spearman's 140 reach, and now inside the bow's 230. That is the trade the audit asked
// for: a pack stays something melee cannot solve, and HOLD (which is also what arms steady
// aim) becomes its answer.
export const WOLF_STALK_R = 180;
export const WOLF_COMMIT_HP = 0.5;
// Hit and run. A stalking wolf that lands a bite breaks off for this long before coming
// back in, instead of standing in the scrum until a spearman kills it. This is what makes
// a 55 hp skirmisher a skirmisher rather than the cheapest thing on the field to kill, and
// it is the mechanical reason a pack is dangerous to a stationary commander: nothing the
// player owns except the knight (175) and the hero himself (315) can catch a wolf at 158.
//
// It applies ONLY while the pack's squad is on `hold`. Under `commit` — bloodlust, or a
// broken warband — wolves charge and stay charged, so the no-death stall clock's guarantee
// that a kiting fight always closes is never weakened by this.
export const WOLF_RECOIL_T = 1.35;
export const WOLF_ISOLATION_MUL = 1.7;
export const WOLF_ISOLATION_PAD = 70;
// Movement multiplier for a charging squad, on both sides. The player's troops already
// carry a hardcoded 1.15 in updateTroopPhase; the enemy reads this name, and the value is
// the same because the mechanic is the same.
export const CHARGE_SPEED_MUL = 1.15;

// ---------------------------------------------------------------- Plan 033: deployment
// The paused pre-battle placement phase. The player's deployment ground is everything on
// his side of the field up to DEPLOY_NO_MANS short of the midline along the approach axis;
// the enemy's is the mirror. 220 leaves a 440-wide no-man's land between two ENGAGE_GAP
// (820) spawn lines, so each side has ~190 of forward room plus everything behind it.
export const DEPLOY_NO_MANS = 220;
// Mouse pick radius for dragging a body during deployment, in world units. Wider than any
// unit radius (max 18) so a click near a man grabs him without pixel-hunting.
export const DEPLOY_PICK_R = 30;
// CONFIRM arms this long after the phase opens. The deployment screen appears on the tick
// the intro banner closes, and the intro itself is shortened by any keypress — so a held or
// buffered E from map travel could otherwise start the fight before the player ever saw the
// phase. Same arm-before-commit rule the spec/perk modals follow (CHOICE_ARM_T).
export const DEPLOY_ARM_T = 0.35;

// Battlefield size (Plan 024 Phase 1). 2x each side -> 4x area.
export const FIELD = Object.freeze({ W: 2500, H: 1760 });
// Opening distance is NOT derived from field size. At 2x field the old fractional spawn
// (0.49 * W) would put 1225 units between the lines — a spearman (105) closing on a bandit
// (92) walks 6.2s before anything happens. 820 keeps the approach march readable (~4.2s)
// while the extra field becomes flanking depth, not dead walking.
export const ENGAGE_GAP = 820;
export const FLANK_GAP = 1180;      // ambush pincer, spawned behind you

// Phase 4c: local obstacle avoidance (tangent steering). A unit casts a ray of this length,
// toward its current goal, before committing to a heading; an intersecting obstacle rotates
// the heading onto the nearer tangent of that obstacle's (radius-inflated) circle instead of
// walking straight into it and grinding against `pushOutOf` (separation.js) with no re-route.
// 170 was chosen empirically: long enough that a unit reacts before its collider overlaps the
// obstacle at typical unit speeds (82-175), short enough that it does not "see" past the next
// few paces and route scenically around anything on the field — a wider lookahead measurably
// lengthened fight duration in testing (units detouring around obstacles nowhere near their
// real path) for no reduction in stalled unit-steps. This is local avoidance only, not a
// planner: it will not escape a deep concave trap (see plans/024 Phase 4 risk note).
export const LOOKAHEAD = 170;
// Extra clearance added to an obstacle's inflated radius when picking the tangent aim point,
// so a steered unit does not graze the collider edge and immediately re-trigger pushOutOf.
export const TANGENT_MARGIN = 6;
// A unit steering continuously (against one obstacle or a handoff between nearby ones) for
// longer than this gives up and falls back to its raw heading (plus pushOutOf) for
// STEER_COOLDOWN seconds. Found necessary by measurement, not anticipated up front: a MOVING
// goal (a kiting raider, a routed troop) can keep regenerating a valid deflection every tick,
// which reads as an indefinite stall/orbit rather than a one-time detour around a static
// obstacle. This bound trades a brief, honest bump-and-shove through the obstacle for a fight
// that is guaranteed to keep making progress instead of one that can stall forever.
export const STEER_MAX_ACTIVE = 1.5;
export const STEER_COOLDOWN = 0.8;

// Phase 3: movement-cost multipliers for battle.zones, applied by terrainSpeedAt() (Phase
// 4a — not yet wired into ai-phases.js, this phase only populates the zones). A road speeds
// you up, wading a ford costs the most (no structure, you are in the water), woods slow the
// most of the "solid ground" zones since a blocker line-of-sight-cover kind should also read
// as a small tactical cost to walk through, scrub barely more than open ground.
export const ROAD_SPEED = 1.14;
export const WOOD_SPEED = 0.80;
export const SCRUB_SPEED = 0.92;
export const FORD_SPEED = 0.68;

// Phase 5: a ranged unit (archer or raider) that has gone this long without a line of sight
// to its target gives up holding position/keepAway and advances on it instead, until a shot
// actually lands. Mandatory per the plan — without it, a ranged unit parked behind a hill or
// in a wood does nothing for the rest of the fight. 1.5s is long enough that ordinary
// momentary occlusion (a unit crossing the sightline) does not trigger it, short enough that
// it reads as "give up and close the distance" rather than "stand still a while longer".
export const BLIND_ADVANCE_T = 1.5;

// Task 1 corrective pass (plans/024): the original "advance" fallback walked a blind ranged
// unit STRAIGHT at its target, which walks it INTO whatever is occluding the shot and keeps
// it blind for the whole traverse — a wood's LOS-blocker radius can span up to ~311 units.
// The fix sidesteps tangentially around the actual blocker sitting on the sightline instead
// (see `blindSidestepHeading` in ai-phases.js), reusing steerAroundObstacle's tangent-around-
// a-circle math. Like that mechanism, a moving target can keep regenerating a valid deflection
// indefinitely, so this needs the same bounded give-up: after MAX_ACTIVE seconds of continuous
// sidestepping, fall back to the pre-fix straight-at-target goal for COOLDOWN seconds before
// retrying. The window is wider than steerAroundObstacle's own (1.5s/0.8s): a physical
// obstacle is a local nudge, but clearing a wide LOS blocker is a longer detour, so giving up
// as quickly would thrash between the two behaviours instead of ever completing one.
export const BLIND_SIDESTEP_MAX_ACTIVE = 3.0;
export const BLIND_SIDESTEP_COOLDOWN = 1.0;
