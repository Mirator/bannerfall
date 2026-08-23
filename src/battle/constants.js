// Battle tuning constants and the squad vocabulary, shared by the scene core, the HUD and
// (from step 4 on) the AI phases. Extracted FIRST and depending on nothing but data.js:
// with no bundler an import cycle is a real hazard, and this module is what prevents one
// between battle.js and the phase/render modules that need these values.
import { PAL, UNIT_TYPES } from '../data.js?v=rbe1f74f09262';

export const BASE = Object.freeze(Object.assign({}, PAL.battle));

// One squad per unit type, in HUD order. Derived from the unit table so a new unit
// type can never exist without a squad to command it.
export const SQUAD_TYPES = Object.freeze(Object.keys(UNIT_TYPES));
// Exported so world-screens.js (Plan 021) can label the player's roster on the brief
// screen with the exact same strings instead of duplicating them.
export const SQUAD_LABELS = Object.freeze({ spear: 'SPEARS', archer: 'BOWS', knight: 'HORSE' });

// Stance trade-offs. A braced melee line hits harder against anything closing faster than
// BRACE_SPEED, and a standing bow line shoots tighter than a walking one. See plans/019 for
// measured effects.
//
// BRACE_SPEED only ever catches wolves (158). Bandits are 92, raiders 82 and brutes 55, so
// nothing else in the roster can trigger it: this is a wolf counter, not a general
// anti-charge rule. HOLD does still beat CHARGE against brutes, but through slam avoidance
// and charge exposure rather than bracing. Do not describe it as a brute counter.
export const BRACE_SPEED = 120;
export const BRACE_BONUS = 1.8;
export const BOW_SPREAD = 0.12;
export const BOW_SPREAD_BRACED = 0.05;
// Men running at the enemy have their shields down and their formation open. This is what
// CHARGE pays for its speed, and the reason ordering everyone to charge is not free.
export const CHARGE_EXPOSURE = 1.35;
// How long shields stay down after a charge order is rescinded.
export const CHARGE_RECOVER = 1.1;
// A fight in which nobody has died for this long is not a battle, it is a grind.
export const STALL_NO_DEATH = 14;
// What each order costs or buys, per squad kind — shown on the squad's own HUD row so the
// trade-off is legible during the fight. FOLLOW is deliberately absent: it is the neutral
// order and has nothing to advertise.
export const STANCE_NOTES = Object.freeze({
  hold: { melee: 'braced', ranged: 'steady aim' },
  charge: { melee: 'shields down', ranged: 'bows down' },
});

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
