// Per-actor decision and movement for one tick: the hero, the troop line under its squad
// stance, the enemy line, and the stalemate breaker. This is the gameplay-feel layer —
// stance trade-offs, target choice, charge exposure, wolves hunting the backline — kept
// apart from the tick orchestration in battle.js that fixes the order they run in.
//
// Every call back into the scene goes through the instance (battle.nearestEnemy,
// battle.damageEnemy, battle.slotPos, ...) so the ordered seams stay patchable by
// tests/e2e/world-battle-seams.spec.js and nothing here needs a second import edge.
import { HERO } from '../data.js?v=r0254bc45c5c3';
import { clamp, lerp, angLerp, dist2, len } from '../engine.js?v=r0254bc45c5c3';
import { ACTIONS } from '../input-actions.js?v=r0254bc45c5c3';
import {
  BRACE_SPEED, BRACE_BONUS, BRACE_CHARGE_MUL, BRACE_MEMORY,
  BOW_SPREAD, BOW_SPREAD_BRACED, CHARGE_RECOVER, HOLD_REACH_MELEE, STALL_NO_DEATH, STALL_TERMINAL, ARENA_EDGE,
  LOOKAHEAD, TANGENT_MARGIN, STEER_MAX_ACTIVE, STEER_COOLDOWN, BLIND_ADVANCE_T,
  BLIND_SIDESTEP_MAX_ACTIVE, BLIND_SIDESTEP_COOLDOWN,
  CHARGE_SPEED_MUL, WOLF_STALK_R, WOLF_COMMIT_HP, WOLF_RECOIL_T, RALLY_R,
  FRONT_ARC, FLANK_BONUS,
} from './constants.js?v=r0254bc45c5c3';
import { enemyAnchorFor, isIsolated, mustersInLine } from './enemy-command.js?v=r0254bc45c5c3';

// ---------------------------------------------------------------- Plan 029: the rush latch
// The single predicate both sides' brace reads, and the single place it is written.
//
// `commanded` is the speed the movement branch is steering this body toward BEFORE terrain
// scaling — terrain is excluded on purpose, so a bandit strolling down a road (92 x 1.14)
// is not mistaken for a charge. A body counts as rushing when that speed is at or above
// BRACE_SPEED (inherently fast: wolf 158, knight 175) or above BRACE_CHARGE_MUL times its
// own walk (ordered forward: charge x1.15, bloodlust x1.3).
//
// Called ONLY from the branch that is actually closing on a hostile, never from a retreat,
// a kite or a recoil: "rushing" means running AT someone. The memory decays everywhere else
// so a body that stops charging stops being braced against a moment later.
function markRush(unit, commanded) {
  if (commanded >= BRACE_SPEED || commanded > unit.d.speed * BRACE_CHARGE_MUL) {
    unit.rushT = BRACE_MEMORY;
  }
}
function decayRush(unit, dt) {
  if (unit.rushT > 0) unit.rushT = Math.max(0, unit.rushT - dt);
}

// ---------------------------------------------------------------- Plan 032: the flank arc
// One predicate, both sides, read off the `facing` every body already carries. Expressed as a
// dot product against cos(FRONT_ARC) rather than an angle difference: it is the same test
// without an atan2 or a wrap-around, and it runs on every landed melee blow.
const FRONT_ARC_COS = Math.cos(FRONT_ARC);
// Is the point (x, y) inside `body`'s front cone? Callers pass whichever body's LOOK matters
// to their rule — the defender for the flank multiplier, the bracing striker for the brace
// gate — so the parameter is named for the geometry, not for a combat role.
function inFrontArc(body, x, y) {
  const dx = x - body.x, dy = y - body.y;
  const d = len(dx, dy);
  if (d <= 0) return true; // exactly co-located: there is no direction to be behind
  return (Math.cos(body.facing) * dx + Math.sin(body.facing) * dy) / d >= FRONT_ARC_COS;
}
// What a MELEE blow from (x, y) is worth against this defender. See the FRONT_ARC block in
// constants.js for why arrows, the brute's slam and the hero are all outside the rule, and
// why both sides read FLANK_BONUS — the constant — rather than anything a perk can move.
// The hero exemption lives HERE, not at call sites: his facing comes from the cursor
// through Camera.toWorld, and a call site that forgot a ternary would put fight outcomes
// back under the mouse — the defect `battle outcomes are independent of canvas size and
// cursor position` exists to catch.
function flankMul(battle, defender, x, y) {
  if (defender === battle.hero) return 1;
  return inFrontArc(defender, x, y) ? 1 : FLANK_BONUS;
}

// What a set line is entitled to against this body, right now — ONE function for both
// sides (Plan 027's symmetry rule): the two real differences are parameters, not a second
// implementation. `rushed` defaults to the troop latch; the enemy site passes its own
// hero-velocity clause. `bonus` defaults to the player's perk-adjusted value; the enemy
// site passes the CONSTANT, never the player's Set Spears value.
// Plan 032: only a rush that came in through the bracing body's own front arc counts — a
// line cannot brace against what reaches it from behind. In practice the striker has
// usually lerped onto its target well before its cooldown lets the blow land, so this gate
// prices only the fast target-switch: the blow that lands within a few ticks of a >110°
// turn. That narrowness is accepted — the gate exists so the claim "braced" is never paid
// against a body the striker is not actually set toward at the moment of the swing.
function braceMul(battle, unit, target, rushed = (target.rushT || 0) > 0, bonus = battle.braceBonus) {
  if (!rushed) return 1;
  return inFrontArc(unit, target.x, target.y) ? bonus : 1;
}
// Plan 029: a declared per-type counter (UNIT_TYPES[x].bonusVs), not a special case on a
// type name. `battle.bruteBonus` lets the Bodkin Points perk deepen the archer's without
// the unit table having to know perks exist.
//
// It pays only under STEADY AIM — the squad on HOLD. That gate was added after
// measurement, not before: shipped unconditionally, the counter raised the camp-raid IDLE
// win rate from 70.8% to 78.3%, undoing Plan 028's entire gain on that fixture. Camp
// garrisons are the brute-heavy fights, so an always-on anti-brute bonus is a large real
// power gain handed to a player who gives no orders — which is exactly the "the game plays
// itself" defect the phase-4 audit named and this plan's own perk rule forbids. Behind
// steady aim it is the same role, bought with a decision: a bow line that stands still has
// time to pick the gap in the armour.
function bonusVersus(battle, attacker, targetType, steady) {
  if (!steady) return 1;
  const table = attacker.d.bonusVs;
  if (!table || !targetType) return 1;
  const declared = table[targetType];
  if (declared == null) return 1;
  return targetType === 'brute' && battle.bruteBonus != null ? battle.bruteBonus : declared;
}

// Phase 4c: local obstacle avoidance ("tangent steering"). Casts a ray of length LOOKAHEAD
// from (ux,uy) along the unit's desired heading (dirX,dirY, already a unit vector) toward its
// goal, clipped to the remaining distance `goalDist`. If that ray would clip an obstacle
// circle (inflated by the unit's own radius `ur`), the heading is rotated onto whichever
// tangent of that circle is the shorter turn and the result is written into the battle's
// reused `_steerScratch` (never a fresh object). Returns false — leaving the caller's original
// heading untouched — when there is nothing to steer around, including the deliberate case
// where the unit already overlaps the obstacle: that overlap is `pushOutOf`'s job
// (separation.js), and steering here would fight it instead of letting it resolve.
//
// `unit` carries a one-frame-lazy `_steerObstacle`/`_steerSign` pair (same lazy-field pattern
// as the existing `t.jit`/`e.jit` surround offset) so the chosen tangent side is sticky for as
// long as the SAME obstacle keeps intersecting the ray. Without that, a target that is itself
// moving (a kiting raider, a routed troop) sweeps the raw goal heading back and forth across
// the obstacle's bisector, and recomputing the "shorter turn" fresh every frame flips sides
// every tick — the unit fights itself and never actually clears the obstacle. This was found
// by measurement, not anticipated: `stance-balance.spec.js`'s FOLLOW-vs-raiders fixture
// stopped resolving within its 90s budget until this hysteresis was added.
// Deterministic (no RNG): the usual single-obstacle path allocates nothing; a contact
// detour retains one envelope per unit. Uses the existing `_obstacleGrid` broad phase
// and its own reusable `queryItems` buffer, consumed synchronously.
// Plan 040: a heading that pushes into the arena wall is not a heading. Both movement
// tails clamp position to [ARENA_EDGE, W-ARENA_EDGE], so an outward component is absorbed
// entirely and the body stands still at full commanded speed, re-deriving the same dead
// heading every tick. Measured on a held-line camp raid: the last surviving brute sat at
// (1278, 1110) — exactly `W - ARENA_EDGE` — for thirty-plus seconds with a speed of 71
// while its target stood 536 px WEST of it, so the fight could not resolve inside the 95 s
// window. Zeroing the outward component makes a body slide along the wall instead, which
// is what anything walking into a fence does, and the remaining component is renormalised
// so sliding happens at full speed rather than at a fraction of it.
//
// Writes into the caller's own scratch pair and returns whether it changed anything.
function slideAlongArenaEdge(battle, x, y, dirX, dirY, out) {
  let dx = dirX, dy = dirY;
  if ((x <= ARENA_EDGE && dx < 0) || (x >= battle.W - ARENA_EDGE && dx > 0)) dx = 0;
  if ((y <= ARENA_EDGE && dy < 0) || (y >= battle.H - ARENA_EDGE && dy > 0)) dy = 0;
  if (dx === dirX && dy === dirY) return false;
  const l = len(dx, dy);
  out.x = l > 0 ? dx / l : 0;
  out.y = l > 0 ? dy / l : 0;
  return true;
}

// Keep a detour around simultaneous contacts stable until the direct segment is
// clear. Re-selecting one circle each tick otherwise walks back into the same pocket.
function steerContactCluster(battle, unit, dt, ux, uy, dirX, dirY, goalDist, revalidate = true) {
  const c = unit._steerCluster;
  c.t += dt; c.progressT += dt;
  // A detour can meet another part of the same physical barrier. Expand its
  // envelope on contact without reversing the committed side or resetting its budget.
  const ur = unit.d.radius, grid = battle._obstacleGrid;
  const count = revalidate ? grid.query(ux, uy, battle._maxObstacleR + ur + TANGENT_MARGIN) : 0;
  for (let i = 0; i < count; i++) {
    const o = grid.queryItems[i], r = o.r + ur + TANGENT_MARGIN;
    if (dist2(ux, uy, o.x, o.y) > r * r) continue;
    const dx = o.x - c.x, dy = o.y - c.y, d = len(dx, dy);
    if (d + r <= c.r) continue;
    if (d + c.r <= r) { c.x = o.x; c.y = o.y; c.r = r; }
    else {
      const radius = (c.r + d + r) / 2, shift = (radius - c.r) / d;
      c.x += dx * shift; c.y += dy * shift; c.r = radius;
    }
  }
  // A new obstacle can block the escape. Replan after the existing steering
  // window without a body's worth of travel, rather than retaining a stale envelope.
  // Moving-target detours also expire after a full circumference at the slowest
  // terrain speed, plus the ordinary steering window; no permanent orbit is allowed.
  const expired = c.t > Math.PI * 2 * c.r / (unit.d.speed * 0.55) + STEER_MAX_ACTIVE;
  const stuck = c.progressT >= STEER_MAX_ACTIVE && dist2(ux, uy, c.px, c.py) < unit.d.radius ** 2;
  if (expired || stuck) {
    unit._steerCluster = null; unit._steerCooldownT = STEER_COOLDOWN;
    return false;
  }
  if (c.progressT >= STEER_MAX_ACTIVE) { c.progressT = 0; c.px = ux; c.py = uy; }
  const dx = c.x - ux, dy = c.y - uy, d = len(dx, dy);
  const gx = ux + dirX * goalDist - c.x, gy = uy + dirY * goalDist - c.y;
  // A moving target can enter the envelope; release instead of circling a goal
  // that this detour can no longer expose (ordinary per-obstacle steering resumes).
  if (gx * gx + gy * gy < c.r * c.r) { unit._steerCluster = null; return false; }
  const projection = clamp(dx * dirX + dy * dirY, 0, goalDist);
  const px = dx - dirX * projection, py = dy - dirY * projection;
  if (d >= c.r && px * px + py * py >= c.r * c.r) {
    unit._steerCluster = null;
    return false;
  }
  // First back out of the enclosing footprint. A tangent while inside it can
  // still penetrate either constituent collider and get cancelled by separation.
  if (d < c.r) {
    battle._steerScratch.x = d > 0 ? -dx / d : -dirX;
    battle._steerScratch.y = d > 0 ? -dy / d : -dirY;
  } else {
    const a = Math.atan2(dy, dx) + c.sign * Math.asin(clamp(c.r / d, -1, 1));
    battle._steerScratch.x = Math.cos(a); battle._steerScratch.y = Math.sin(a);
  }
  return true;
}

function steerAroundObstacle(battle, unit, dt, ux, uy, ur, dirX, dirY, goalDist) {
  // Plan 045: a fight that has stalled past STALL_TERMINAL stops routing around terrain
  // entirely — see updateStalematePhase. Any retained detour is dropped with it, or the
  // envelope this unit committed to would outlive the state that justified it.
  if (battle.closing) { unit._steerCluster = null; unit._steerObstacle = null; unit._steerActiveT = 0; return false; }
  if (unit._steerCluster && steerContactCluster(battle, unit, dt, ux, uy, dirX, dirY, goalDist)) return true;
  // A unit deflected for too long without a break gives up on steering for a short cooldown,
  // falling back to its raw heading (and `pushOutOf`) instead. This bounds the worst case:
  // measurement found a goal that is ITSELF moving (a kiting raider, a routed troop) can keep
  // regenerating a valid deflection tick after tick — sometimes against the same obstacle,
  // sometimes handed off between two nearby ones — which read as an indefinite stall/orbit
  // rather than a one-time detour. Bailing out converts that into a bounded nuisance instead
  // of a fight that never resolves.
  if (unit._steerCooldownT > 0) { unit._steerCooldownT -= dt; return false; }
  const rayLen = goalDist < LOOKAHEAD ? goalDist : LOOKAHEAD;
  if (rayLen <= 0) return false;
  const grid = battle._obstacleGrid;
  const count = grid.query(ux, uy, rayLen + battle._maxObstacleR + ur + TANGENT_MARGIN);
  const items = grid.queryItems;
  let bestOx = 0, bestOy = 0, bestEffR = 0;
  // Enclose only simultaneous nearby contacts, not the entire obstacle field.
  // The midpoint of their bounds plus the furthest inflated radius covers every
  // constituent circle. It is retained per unit until the desired segment clears.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, contacts = 0;
  for (let i = 0; i < count; i++) {
    const o = items[i], contactR = o.r + ur + TANGENT_MARGIN;
    if (dist2(ux, uy, o.x, o.y) > contactR * contactR) continue;
    minX = Math.min(minX, o.x); maxX = Math.max(maxX, o.x);
    minY = Math.min(minY, o.y); maxY = Math.max(maxY, o.y); contacts++;
  }
  // Nearby circles are not by themselves a trap. Wait for commanded movement
  // to fail to move a body's width over the existing steering window, so passing
  // beside a wall or walking away keeps the ordinary heading unchanged.
  let contactStalled = false;
  if (contacts > 1) {
    if (!(unit._contactStallT > 0) || dist2(ux, uy, unit._contactStallX, unit._contactStallY) >= ur * ur) {
      unit._contactStallT = dt; unit._contactStallX = ux; unit._contactStallY = uy;
    } else unit._contactStallT += dt;
    contactStalled = unit._contactStallT >= STEER_MAX_ACTIVE;
  } else unit._contactStallT = 0;
  if (contactStalled) {
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    bestOx = cx - ux; bestOy = cy - uy; bestEffR = 0;
    for (let i = 0; i < count; i++) {
      const o = items[i], contactR = o.r + ur + TANGENT_MARGIN;
      if (dist2(ux, uy, o.x, o.y) <= contactR * contactR)
        bestEffR = Math.max(bestEffR, Math.hypot(o.x - cx, o.y - cy) + contactR);
    }
  }
  const D = Math.sqrt(bestOx * bestOx + bestOy * bestOy);
  if (contactStalled && D > 0.01) {
    unit._contactStallT = 0;
    const tangent = computeTangentHeading(Math.atan2(bestOy, bestOx), Math.asin(clamp(bestEffR / D, -1, 1)),
      null, null, null, dirX, dirY);
    unit._steerCluster = { x: ux + bestOx, y: uy + bestOy, r: bestEffR, sign: tangent.sign,
      t: 0, progressT: 0, px: ux, py: uy };
    // The fresh envelope already covers these contacts; preserve the caller's query buffer.
    if (steerContactCluster(battle, unit, dt, ux, uy, dirX, dirY, goalDist, false)) return true;
  }

  let bestT = Infinity, bestObstacle = null;
  for (let i = 0; i < count; i++) {
    const o = items[i];
    const ox = o.x - ux, oy = o.y - uy;
    const t = ox * dirX + oy * dirY; // projection of the obstacle centre onto the ray
    if (t <= 0 || t > rayLen) continue; // behind the unit, or beyond the goal/lookahead
    const distToObstacle2 = ox * ox + oy * oy;
    const effR = o.r + ur + TANGENT_MARGIN;
    if (distToObstacle2 <= effR * effR) continue; // already overlapping — let pushOutOf resolve it
    const perp2 = distToObstacle2 - t * t;
    if (perp2 >= effR * effR) continue; // ray passes clear of the inflated circle
    if (t < bestT) { bestT = t; bestObstacle = o; bestEffR = effR; }
  }
  if (bestObstacle === null) { unit._steerObstacle = null; unit._steerActiveT = 0; return false; }
  bestOx = bestObstacle.x - ux; bestOy = bestObstacle.y - uy;
  const distance = Math.sqrt(bestOx * bestOx + bestOy * bestOy);
  if (distance <= bestEffR) return false; // degenerate guard, should not happen given the check above
  unit._steerActiveT = (unit._steerActiveT || 0) + dt;
  if (unit._steerActiveT > STEER_MAX_ACTIVE) {
    // Give up steering for a cooldown: fall back to the raw heading (and pushOutOf) so a
    // sustained deflection cannot become a permanent stall.
    unit._steerCooldownT = STEER_COOLDOWN;
    unit._steerActiveT = 0;
    unit._steerObstacle = null;
    return false;
  }
  const alpha = Math.atan2(bestOy, bestOx);
  const theta = Math.asin(clamp(bestEffR / distance, -1, 1));
  const tang = computeTangentHeading(alpha, theta, unit._steerObstacle, bestObstacle, unit._steerSign, dirX, dirY);
  unit._steerObstacle = bestObstacle;
  unit._steerSign = tang.sign;
  battle._steerScratch.x = tang.x;
  battle._steerScratch.y = tang.y;
  return true;
}

function angDiff(a, b) {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

// Shared by steerAroundObstacle (physical obstacles) and blindSidestepHeading (LOS blockers,
// below): picks which tangent of a circle at angle `alpha` (half-angle `theta`) to aim for,
// sticking to whichever side was already committed to for the SAME obstacle so a moving
// goal/target does not sweep the heading across the bisector and flip sides every tick (the
// hysteresis bug found and fixed for steerAroundObstacle in Phase 4c — see its module doc
// comment). `prevObstacle`/`prevSign` are the caller's own lazy per-unit fields; this function
// never touches unit state itself, so the two callers can keep independent hysteresis (a
// unit can be mid-detour around a physical obstacle AND mid-sidestep around an LOS blocker
// without either one clobbering the other's committed side).
function computeTangentHeading(alpha, theta, prevObstacle, obstacle, prevSign, dirX, dirY) {
  let sign;
  if (prevObstacle === obstacle && prevSign != null) {
    sign = prevSign;
  } else {
    const heading = Math.atan2(dirY, dirX);
    const d1 = angDiff(alpha - theta, heading), d2 = angDiff(alpha + theta, heading);
    sign = Math.abs(d1) <= Math.abs(d2) ? -1 : 1;
  }
  const chosen = sign < 0 ? alpha - theta : alpha + theta;
  return { x: Math.cos(chosen), y: Math.sin(chosen), sign };
}

// Task 1 corrective pass (plans/024): the mandatory blind-ranged fallback (see
// BLIND_ADVANCE_T's use below) used to walk the unit STRAIGHT at its target, which walks it
// INTO whatever is occluding the shot and keeps it blind for the entire traverse — a wood's
// LOS-blocker radius can span up to ~311 units, so `blindT` was measured climbing to
// 10-120 s against its 1.5 s gate at larger wood sizes, and fights stopped resolving.
//
// This finds the actual blocker sitting on the straight sightline to the target (nearest to
// the unit first, matching steerAroundObstacle's own ray-scan convention) and reuses
// `computeTangentHeading` to aim the unit around THAT circle specifically, by the shortest
// tangent, instead of through it. It deliberately searches `battle.blockers`, not
// `battle._obstacleGrid`: a wood's LOS-blocker circle has no matching physical obstacle (only
// its two largest trees get colliders — see terrain.js), so the physical steering above would
// never react to it at all.
//
// Bounded the same way as steerAroundObstacle, for the same reason: a target that is itself
// moving can keep regenerating a valid deflection indefinitely, which would otherwise read as
// an orbit rather than a one-time detour. On give-up this returns null and the caller falls
// back to the pre-fix straight-at-target goal for BLIND_SIDESTEP_COOLDOWN seconds — worse
// locally, but it guarantees the unit eventually walks PAST the blocker (bounding `blindT`)
// instead of circling it forever.
function blindSidestepHeading(unit, ux, uy, dirX, dirY, segLen, dt, blockers) {
  if (unit._blindCooldownT > 0) { unit._blindCooldownT -= dt; return null; }
  if (segLen <= 0) return null;
  let bestT = Infinity, bestBlocker = null;
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    const ox = b.x - ux, oy = b.y - uy;
    const t = ox * dirX + oy * dirY; // projection of the blocker centre onto the sightline
    if (t <= 0 || t > segLen) continue; // behind the unit, or beyond the target
    const perp2 = (ox * ox + oy * oy) - t * t;
    if (perp2 >= b.r * b.r) continue; // sightline passes clear of this blocker
    if (t < bestT) { bestT = t; bestBlocker = b; }
  }
  if (bestBlocker === null) { unit._blindObstacle = null; unit._blindActiveT = 0; return null; }
  const bx = bestBlocker.x - ux, by = bestBlocker.y - uy;
  const D = Math.sqrt(bx * bx + by * by);
  const effR = bestBlocker.r + TANGENT_MARGIN;
  if (D <= effR) return null; // standing inside the blocker's own footprint — degenerate
  unit._blindActiveT = (unit._blindActiveT || 0) + dt;
  if (unit._blindActiveT > BLIND_SIDESTEP_MAX_ACTIVE) {
    unit._blindCooldownT = BLIND_SIDESTEP_COOLDOWN;
    unit._blindActiveT = 0;
    unit._blindObstacle = null;
    return null;
  }
  const alpha = Math.atan2(by, bx);
  const theta = Math.asin(clamp(effR / D, -1, 1));
  const tang = computeTangentHeading(alpha, theta, unit._blindObstacle, bestBlocker, unit._blindSign, dirX, dirY);
  unit._blindObstacle = bestBlocker;
  unit._blindSign = tang.sign;
  return tang;
}

// Phase 5: target selection for ranged units. A ranged unit prefers a target it can actually
// see; only when NOTHING in range is visible does it fall back to the plain nearest-overall
// search every unit used before this phase (identical result to `battle.nearestEnemy` /
// `battle.nearestFriendly` in that case). `dt` is accumulated onto `unit.blindT` exactly when
// that fallback is the one that finds something — i.e. there IS a target, the unit just can't
// see it right now — never when there is genuinely nothing in range to be blind about.
// Reaches `battle._enemyGrid` directly rather than through a delegating method: ai-phases.js
// already does this for `_obstacleGrid` in steerAroundObstacle above, and this predicate is
// specific to ranged targeting, not a general query another module needs.
function pickRangedEnemy(battle, unit, x, y, maxR, dt) {
  const seen = battle._enemyGrid.nearest(x, y, maxR, en => battle.hasLineOfSight(x, y, en.x, en.y));
  if (seen) return seen;
  const any = battle._enemyGrid.nearest(x, y, maxR);
  if (any) unit.blindT += dt;
  return any;
}

// Same idea for a ranged enemy (raiders) picking among the hero and troops. Mirrors
// `battle.nearestFriendly`'s hero-vs-troop merge (the hero is not in `_friendlyGrid`, so it is
// passed in as the grid's `initial` candidate) but restricts both to visible candidates first.
function pickRangedFriendly(battle, unit, x, y, dt) {
  const hero = battle.hero;
  const heroVisible = battle.hasLineOfSight(x, y, hero.x, hero.y);
  const heroDistance = dist2(x, y, hero.x, hero.y);
  const seenTroop = battle._friendlyGrid.nearest(
    x, y, 1e9, t => battle.hasLineOfSight(x, y, t.x, t.y),
    heroVisible ? hero : null, heroVisible ? heroDistance : Infinity, -1);
  if (seenTroop) {
    return seenTroop === hero ? { obj: hero, isHero: true } : { obj: seenTroop, isHero: false };
  }
  const any = battle.nearestFriendly(x, y);
  if (any) unit.blindT += dt;
  return any;
}

export function updateHeroPhase(battle, dt, inp, h, ax) {
  const P = battle.palette;
  const sfx = battle.game.sfx;
  // ---- hero movement
  const dashing = h.dashT > 0;
  if (!dashing) {
    h.vx += ax.x * HERO.accel * dt;
    h.vy += ax.y * HERO.accel * dt;
    // Phase 4a: terrain caps top speed, not acceleration — the horse still responds to
    // input at the same rate, it just cannot carry as much speed through a wood or a ford.
    // Scaling the ceiling instead of damping velocity directly keeps this reading as
    // terrain drag rather than input lag.
    const sp = len(h.vx, h.vy), max = HERO.speed * battle.terrainSpeedAt(h.x, h.y);
    if (sp > max) { h.vx *= max / sp; h.vy *= max / sp; }
    if (!ax.any) { h.vx *= Math.max(0, 1 - HERO.friction * dt); h.vy *= Math.max(0, 1 - HERO.friction * dt); }
  } else {
    h.dashT -= dt;
    // trample — snapshot the list: damageEnemy() splices battle.enemies on a kill, and
    // iterating the live array would skip whichever enemy slides into the vacated index
    for (const e of [...battle.enemies]) {
      if (dist2(h.x, h.y, e.x, e.y) < 30 * 30 && !e._trampled) {
        e._trampled = true;
        battle.damageEnemy(e, HERO.dashDmg, h.vx * 0.4 * dt * 60, h.vy * 0.4 * dt * 60, 'hero');
      }
    }
    battle.particles.dust(h.x, h.y + 6, P.cream, 2, battle.fxRng);
  }
  h.x += h.vx * dt; h.y += h.vy * dt;
  h.x = clamp(h.x, 40, battle.W - 40); h.y = clamp(h.y, 40, battle.H - 40);
  const mw = battle.game.camera.toWorld(inp.mouse.x, inp.mouse.y);
  const moving = len(h.vx, h.vy) > 40;
  const aimA = Math.atan2(mw.y - h.y, mw.x - h.x);
  h.facing = angLerp(h.facing, moving ? Math.atan2(h.vy, h.vx) : aimA, 1 - Math.exp(-10 * dt));
  if (moving) h.travelFacing = angLerp(h.travelFacing, Math.atan2(h.vy, h.vx), 1 - Math.exp(-10 * dt));
  if (moving) { h.bob += dt * 11; sfx.gallop(); if (battle.fxRng() < dt * 14) battle.particles.dust(h.x - h.vx * 0.04, h.y + 8 - h.vy * 0.04, P.cream, 1, battle.fxRng); }
  if (h.hurtT > 0) h.hurtT -= dt;
  if (h.iframesT > 0) h.iframesT -= dt;

  // ---- hero attack
  if (h.swingT > 0) h.swingT -= dt;
  if ((inp.mouse.clicked || inp.pressedAction(ACTIONS.ATTACK)) && h.swingT <= 0) {
    h.swingT = HERO.swingCd;
    sfx.swing();
    battle.particles.slash(h.x, h.y - 6, aimA, HERO.swingRange, HERO.swingArc, P.cream);
    // small lunge
    h.vx += Math.cos(aimA) * 90; h.vy += Math.sin(aimA) * 90;
    // collect targets in the arc, hit only the nearest few — the hero is a knight, not a lawnmower
    const inArc = [];
    for (const e of battle.enemies) {
      const d = Math.sqrt(dist2(h.x, h.y, e.x, e.y));
      if (d < HERO.swingRange + e.d.radius) {
        let da = Math.atan2(e.y - h.y, e.x - h.x) - aimA;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) < HERO.swingArc / 2 + 0.25) inArc.push([d, e]);
      }
    }
    // Break-the-position: the commander's blade works on defensive guards too —
    // otherwise a lone hero could not finish an objective the milestone promises.
    for (const o of battle.objectiveTargets || []) {
      if (o.dead) continue;
      const d = Math.sqrt(dist2(h.x, h.y, o.x, o.y));
      if (d < HERO.swingRange + o.r) {
        let da = Math.atan2(o.y - h.y, o.x - h.x) - aimA;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) < HERO.swingArc / 2 + 0.25) inArc.push([d, o, true]);
      }
    }
    inArc.sort((a, b) => a[0] - b[0]);
    const targets = inArc.slice(0, HERO.swingMaxTargets);
    for (const [, t, isObjective] of targets) {
      if (isObjective) {
        battle.damageObjective(t, HERO.swingDmg);
      } else {
        battle.damageEnemy(t, HERO.swingDmg, Math.cos(aimA) * 60, Math.sin(aimA) * 60, 'hero');
        t.vx += Math.cos(aimA) * 160; t.vy += Math.sin(aimA) * 160;
      }
    }
    if (targets.length > 0) { battle.freeze = Math.max(battle.freeze, 0.045); battle.game.camera.shake(2.5, 0.12); }
  }

  // ---- hero dash
  if (h.dashCdT > 0) h.dashCdT -= dt;
  if (inp.pressedAction(ACTIONS.DASH) && h.dashCdT <= 0) {
    h.dashT = HERO.dashTime; h.dashCdT = HERO.dashCd; h.iframesT = HERO.iframeTime;
    for (const e of battle.enemies) e._trampled = false;
    const a = ax.any ? Math.atan2(ax.y, ax.x) : aimA;
    h.vx = Math.cos(a) * HERO.dashSpeed; h.vy = Math.sin(a) * HERO.dashSpeed;
    sfx.dash();
    battle.particles.ring(h.x, h.y, 26, P.cream, 0.3, 3);
    // Plan 029, the Warlord perk. The rally is granted at the START of the dash, to the
    // troops already around the commander — the one perk that makes the hero's own input
    // matter to the warband rather than only to the man in front of him. It buys two
    // things for RALLY_R seconds: shields up (damageFriendly skips charge exposure) and
    // charge speed whatever the squad's order. `battle.rally` is 0 unless the perk is
    // taken, so this loop costs one comparison in every other campaign.
    if (battle.rally > 0) {
      let rallied = 0;
      for (const t of battle.troops) {
        if (dist2(t.x, t.y, h.x, h.y) > RALLY_R * RALLY_R) continue;
        t.rallyT = battle.rally;
        rallied++;
      }
      if (rallied > 0) {
        battle.commandFlash = { text: 'RALLY!', t: 0.8 };
        battle.game.sfx.horn(196);
      }
    }
  }

}

export function updateTroopPhase(battle, dt, h) {
  const P = battle.palette;
  // ---- troops
  for (const t of battle.troops) {
    t.cd -= dt;
    if (t.flash > 0) t.flash -= dt;
    if (t.lunge > 0) t.lunge -= dt * 5;
    let goal = null, engage = null;
    // Exposure is refreshed while charging and decays after the order changes.
    // `battle.chargeRecover` is CHARGE_RECOVER unless the Quick Release perk has zeroed
    // it: charging itself still costs (damageFriendly reads the live stance), so what the
    // perk removes is only the LINGER after the order is taken back.
    // Plan 029: `t.rallyT` is the Warlord perk's dash rally — see damageFriendly and the
    // movement tail below for the two things it buys.
    const squadStanceNow = battle.squadStance(t);
    if (t.rallyT > 0) t.rallyT = Math.max(0, t.rallyT - dt);
    if (squadStanceNow === 'charge') t.exposedT = battle.chargeRecover;
    else if (t.exposedT > 0) t.exposedT = Math.max(0, t.exposedT - dt);
    decayRush(t, dt);

    // troops always defend the commander: any enemy near the hero is fair game
    const heroThreat = battle.nearestEnemy(battle.hero.x, battle.hero.y, 90);
    const stance = squadStanceNow;
    // How far a HELD body reaches for anything at all: its own range if it shoots,
    // HOLD_REACH_MELEE (one spear-line's worth of ground) if it does not. Hoisted because
    // the Break-the-position block below has to honour the same reach — see Plan 040
    // there. The melee half is a named constant so the wolf-stand-band contract in
    // stance-balance.spec.js can assert against the reach a held line actually covers
    // instead of against UNIT_TYPES.spear.range, which is a different number entirely.
    const holdReach = t.d.ranged ? t.d.range : HOLD_REACH_MELEE;
    if (stance === 'charge') {
      engage = t.d.ranged ? pickRangedEnemy(battle, t, t.x, t.y, 1e9, dt) : battle.nearestEnemy(t.x, t.y);
    } else if (stance === 'hold') {
      engage = t.d.ranged ? pickRangedEnemy(battle, t, t.x, t.y, holdReach, dt) : battle.nearestEnemy(t.x, t.y, holdReach);
      if (!engage && heroThreat && dist2(t.x, t.y, battle.hero.x, battle.hero.y) < 260 * 260) engage = heroThreat;
      if (!engage) goal = { x: t.holdX, y: t.holdY };
      } else { // follow
        const maxR = t.d.ranged ? t.d.range * 0.9 : 150;
        engage = t.d.ranged ? pickRangedEnemy(battle, t, t.x, t.y, maxR, dt) : battle.nearestEnemy(t.x, t.y, maxR);
        if (!engage && heroThreat) engage = heroThreat;
        if (!engage) goal = battle.slotPos(t);
      }

      // Milestone 025 Slice C: Break-the-position. A squad with no raider in reach
      // goes to work on the nearest standing defensive guard — destroying the
      // position is a win even while defenders survive, so the guards must be
      // attackable by everyone.
      // PLAN 040: "by everyone" never meant "from anywhere". This block ran for every
      // stance, so a HELD line took the nearest guard as its target however far away it
      // was, and the `d > wantR` branch below then replaced the hold anchor with a
      // formation goal on it — a braced spear line walked across the field (measured at
      // 1793 px of drift), which is the one thing HOLD promises it will not do. A held body
      // may take a guard only inside the same reach its stance already uses for hostiles;
      // outside it the hold anchor stands. `charge` and `follow` are untouched and still go
      // to work on the nearest guard from anywhere, so the position stays attackable by
      // anyone ORDERED to attack it, and elimination remains a parallel win for a line
      // that never does.
      if (!engage && battle.objectiveTargets && battle.objectiveTargets.length) {
        const objReach = stance === 'hold' ? holdReach : Infinity;
        let best = null, bd = Infinity;
        for (const o of battle.objectiveTargets) {
          if (o.dead) continue;
          const dd = dist2(t.x, t.y, o.x, o.y);
          if (dd < bd) { bd = dd; best = o; }
        }
        if (best && bd > objReach * objReach) best = null;
        if (best) {
          // Reused stand-in (battle.js), not a fresh object per troop per tick: vx/vy/
          // isObjective are fixed at construction (a guard is a structure and does not
          // move), only position, target and radius change per use.
          const eng = battle._objectiveEngageScratch;
          eng.x = best.x; eng.y = best.y;
          eng.objRef = best;
          eng.d.radius = best.r;
          engage = eng;
        }
      }

    if (engage) {
      const d = Math.sqrt(dist2(t.x, t.y, engage.x, engage.y));
      const wantR = t.d.ranged ? t.d.range * 0.8 : t.d.range + engage.d.radius - 6;
      // Phase 5, mandatory fallback: a ranged unit blind for more than 1.5s stops holding
      // its line (HOLD's stand-ground, or keeping keepAway distance) and advances on its
      // target at normal speed instead, so it walks itself out from behind whatever is
      // blocking it rather than standing idle for the rest of the fight. Cleared the moment
      // a shot actually lands (below), which is the only proof LOS is back.
      const blind = t.d.ranged && t.blindT > BLIND_ADVANCE_T;
      if (t.d.ranged && stance === 'hold' && !blind) {
        goal = null; // archers on hold stand ground
      } else if (d > wantR || blind) {
        // surround: each unit approaches its own point on the target's circle
        let formationGoal;
        if (!t.d.ranged && d < wantR * 3.5) {
          if (t.jit == null) t.jit = (battle.troops.indexOf(t) * 2.399);
          formationGoal = { x: engage.x + Math.cos(t.jit) * wantR * 0.9, y: engage.y + Math.sin(t.jit) * wantR * 0.9 };
        } else {
          // approach IN FORMATION: hold your lateral slot while closing, so a charge
          // reads as a wedge bearing down — not a swarm converging on one point
          const aa = Math.atan2(engage.y - t.y, engage.x - t.x);
          const side = (t.slot.col - (t.slot.rowCount - 1) / 2) * 26;
          const rowBack = t.slot.row * 24;
          formationGoal = {
            x: engage.x - Math.cos(aa) * rowBack + Math.cos(aa + Math.PI / 2) * side,
            y: engage.y - Math.sin(aa) * rowBack + Math.sin(aa + Math.PI / 2) * side,
          };
        }
        if (blind) {
          // Task 1 corrective pass: sidestep around whatever occludes the shot instead of
          // walking into it. `formationGoal` above stays the give-up fallback so a bounded
          // sidestep failure still produces the pre-fix behaviour rather than no goal at all.
          const bdx = engage.x - t.x, bdy = engage.y - t.y, blen = len(bdx, bdy);
          const bdirX = blen > 0 ? bdx / blen : 1, bdirY = blen > 0 ? bdy / blen : 0;
          const heading = blindSidestepHeading(t, t.x, t.y, bdirX, bdirY, blen, dt, battle.blockers);
          goal = heading ? { x: t.x + heading.x * LOOKAHEAD, y: t.y + heading.y * LOOKAHEAD } : formationGoal;
        } else {
          goal = formationGoal;
        }
      } else if (t.d.ranged && d < t.d.keepAway) {
        goal = { x: t.x + (t.x - engage.x), y: t.y + (t.y - engage.y) };
      }
      t.facing = angLerp(t.facing, Math.atan2(engage.y - t.y, engage.x - t.x), 1 - Math.exp(-8 * dt));
      // A charge forfeits the bow line: archers ordered forward are running with their
      // bows down, so CHARGE trades the ranged screen for speed instead of keeping both.
      const advancingBow = t.d.ranged && stance === 'charge' && d > wantR;
      if (t.cd <= 0 && !advancingBow && d < (t.d.ranged ? t.d.range : t.d.range + engage.d.radius + 4)) {
        // A set line receives a charge: melee holding position hit harder against anything
        // that CAME IN AT A RUSH. Plan 029 rebuilt this — the old form read the target's
        // velocity at the instant of the swing, and measured, a body inside spear reach has
        // already braked (median closing speed NEGATIVE for every type), so it fired on
        // 0-6% of contacts. It reads the latched rush memory now; see markRush and the
        // BRACE_SPEED block in constants.js for the whole measurement.
        //
        // Two multipliers here — the body's rank (a veteran hits harder) and the brace (an
        // order) — because they are both known at the moment of the swing. The third, the
        // declared per-type counter, is applied where the blow LANDS: immediately below for
        // a melee strike, and at the arrow's landing for a shot, since an arrow resolves
        // against whoever is nearest where it falls rather than the body it was aimed at.
        const braced = stance === 'hold' && !t.d.ranged ? braceMul(battle, t, engage) : 1;
        const dmg = t.d.dmg * (t.vetMul || 1) * braced;
        if (engage.isObjective) {
          // Guards are structures: arrows and blades chip them directly (a palisade
          // has no hit-flash target for a projectile's proximity check, so ranged
          // damage lands on the shot rather than simulating one).
          t.cd = t.d.cooldown;
          t.lunge = t.d.ranged ? 0 : 1;
          battle.damageObjective(engage.objRef, dmg);
        } else if (t.d.ranged) {
          // Phase 5: the firing gate lives here, not inside fireArrow — checked BEFORE the
          // cooldown is consumed, so a blind archer does not silently burn a shot into a
          // hillside every time its cooldown comes up.
          if (battle.hasLineOfSight(t.x, t.y - 12, engage.x, engage.y)) {
            t.cd = t.d.cooldown;
            // Archers standing still shoot straighter than archers walking. Plan 029: the
            // Steady Hands perk tightens the braced grouping further; `battle.bowSpreadBraced`
            // is BOW_SPREAD_BRACED unless it has been taken.
            const spread = stance === 'hold' ? battle.bowSpreadBraced : BOW_SPREAD;
            // The counter rides on the arrow only when it was loosed from a SET line — see
            // bonusVersus for the measurement that put that gate here.
            battle.fireArrow(t.x, t.y - 12, engage.x, engage.y, true, dmg, t.d.projSpeed, null, spread,
              stance === 'hold' ? t.d.bonusVs : null);
            t.blindT = 0;
          }
        } else {
          t.cd = t.d.cooldown;
          t.lunge = 1;
          // Plan 032: the fourth multiplier, and the only one that is pure geometry — a blade
          // arriving outside the body's own front arc. Melee only, and applied at the moment
          // the blow lands rather than when it was decided, because that is when the two
          // facings are real.
          battle.damageEnemy(engage,
            dmg * bonusVersus(battle, t, engage.type, stance === 'hold') * flankMul(battle, engage, t.x, t.y),
            Math.cos(t.facing) * 85, Math.sin(t.facing) * 85, 'troop');
        }
      }
    }

    if (goal) {
      // Phase 4b: resolve the river-crossing waypoint BEFORE steering, so tangent steering
      // (4c) avoids obstacles on the way to the crossing rather than fighting it — a unit
      // whose goal is already the crossing centre has nothing left to disagree about.
      const wp = battle.crossingWaypoint(t.x, t.y, goal.x, goal.y);
      if (wp) goal = wp;
      const dx = goal.x - t.x, dy = goal.y - t.y, d = len(dx, dy);
      if (d > 6) {
        let dirX = dx / d, dirY = dy / d;
        if (steerAroundObstacle(battle, t, dt, t.x, t.y, t.d.radius, dirX, dirY, d)) {
          dirX = battle._steerScratch.x; dirY = battle._steerScratch.y;
        }
        // Phase 4a: terrain zones (road/wood/scrub/ford) scale movement speed.
        // `battle.chargeSpeedMul` was a hardcoded 1.15 here before Plan 029; it reads the
        // shared constant now (the enemy path already did) so the Hammer and Anvil perk can
        // raise BOTH sides' understanding of what a charge is from one place, and a rallied
        // squad (Warlord) moves at charge speed for the rally's duration whatever its order.
        const rushing = stance === 'charge' || t.rallyT > 0;
        const commanded = t.d.speed * (rushing ? battle.chargeSpeedMul : 1);
        // The rush latch: set only here, and only while actually CLOSING on the hostile —
        // the heading guard mirrors the enemy side's (updateEnemyPhase), because a kiting
        // archer runs at charge speed AWAY from its target and latching him hands a set
        // line the brace bonus against a body in full retreat, which is exactly what
        // markRush's contract ("never from a retreat, a kite or a recoil") forbids.
        // Walking back to a hold anchor is likewise not a charge. Terrain is applied
        // after the latch, never inside it.
        if (engage && dirX * (engage.x - t.x) + dirY * (engage.y - t.y) > 0) markRush(t, commanded);
        const sp = commanded * clamp(d / 40, 0.5, 1.6) * battle.terrainSpeedAt(t.x, t.y);
        t.vx = lerp(t.vx, dirX * sp, 1 - Math.exp(-8 * dt));
        t.vy = lerp(t.vy, dirY * sp, 1 - Math.exp(-8 * dt));
        if (!engage) t.facing = angLerp(t.facing, Math.atan2(dirY, dirX), 1 - Math.exp(-6 * dt));
      } else { t.vx *= 0.8; t.vy *= 0.8; }
    } else if (!engage) { t.vx *= 0.85; t.vy *= 0.85; }
    else { t.vx *= 0.9; t.vy *= 0.9; }

    t.x += t.vx * dt; t.y += t.vy * dt;
    t.x = clamp(t.x, ARENA_EDGE, battle.W - ARENA_EDGE); t.y = clamp(t.y, ARENA_EDGE, battle.H - ARENA_EDGE);
    if (len(t.vx, t.vy) > 30) { t.bob += dt * 10; if (battle.fxRng() < dt * 3) battle.particles.dust(t.x, t.y + 5, P.groundShade, 1, battle.fxRng); }
  }

}

export function updateEnemyPhase(battle, dt, h) {
  const P = battle.palette;
  // ---- enemies (the pre-033 deploy window's frozen block is gone: the deployment phase
  // pauses the whole tick pipeline in battle.js, so this phase simply does not run there)
  for (const e of battle.enemies) {
    e.cd -= dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.lunge > 0) e.lunge -= dt * 5;
    // Plan 027: the order this man's squad is under, set by the enemy commander. 'follow'
    // is the default and is byte-identical to the pre-027 AI, so every difference below is
    // attributable to an order somebody actually gave.
    const stance = battle.enemyStance(e);
    // Charge exposure, mirroring the troop path exactly: men running at the enemy have
    // their shields down, and it lingers CHARGE_RECOVER seconds after the order changes so
    // a one-tick order flick cannot buy the speed for none of the cost.
    // The enemy keeps the battle CONSTANT rather than the perk-modified value: a perk is
    // the player's, and letting one shorten the enemy's own recovery would be a gift.
    if (stance === 'charge') e.exposedT = CHARGE_RECOVER;
    else if (e.exposedT > 0) e.exposedT = Math.max(0, e.exposedT - dt);
    decayRush(e, dt);
    // wolves earn their name: they hunt the backline (nearest ranged troop)
    let tgt;
    if (e.type === 'wolf') {
      const best = battle.nearestFriendlyRanged(e.x, e.y, 460);
      tgt = best ? { obj: best, isHero: false } : battle.nearestFriendly(e.x, e.y);
    } else if (e.d.ranged) {
      // Phase 5: a ranged enemy (raider) prefers a target it can see; see pickRangedFriendly.
      // Plan 027 deliberately did NOT change this. Making raiders prefer the player's bow
      // line — the obvious "smarter" choice, since archers are the softest thing that can
      // hurt a formed-up enemy — was measured and is a NET LOSS for the enemy: it walks a
      // 85 hp raider across the field and through the player's spears to reach a 60 hp
      // archer. Camp-raid idle win rate rose from 75% to 81.7% on that change alone.
      tgt = pickRangedFriendly(battle, e, e.x, e.y, dt);
    } else {
      tgt = battle.nearestFriendly(e.x, e.y);
    }
    const to = tgt.obj;
    const d = Math.sqrt(dist2(e.x, e.y, to.x, to.y));
    e.facing = angLerp(e.facing, Math.atan2(to.y - e.y, to.x - e.x), 1 - Math.exp(-6 * dt));

    if (e.windupT > 0) {
      e.windupT -= dt;
      e.vx *= 0.8; e.vy *= 0.8;
      if (e.windupT <= 0) {
        // strike lands
        if (e.d.slamR) {
          battle.game.sfx.brute();
          battle.game.camera.shake(9, 0.35);
          battle.particles.ring(e.x, e.y, e.d.slamR, P.enemy, 0.4, 5);
          battle.particles.dust(e.x, e.y, P.groundShade, 10, battle.fxRng);
          if (dist2(e.x, e.y, battle.hero.x, battle.hero.y) < e.d.slamR * e.d.slamR) battle.damageFriendly(battle.hero, true, e.d.dmg, e);
          for (const t of [...battle.troops]) if (dist2(e.x, e.y, t.x, t.y) < e.d.slamR * e.d.slamR) battle.damageFriendly(t, false, e.d.dmg);
        } else if (e.d.ranged) {
          // Steady aim, the same trade the player's bow line gets on HOLD: a raider that
          // shoots from a set position groups tighter than one walking.
          const spread = stance === 'hold' ? BOW_SPREAD_BRACED : BOW_SPREAD;
          battle.fireArrow(e.x, e.y - 10, to.x, to.y, false, e.d.dmg, e.d.projSpeed, e.type, spread);
          e.blindT = 0; // the shot only ever gets this far because LOS gated windup entry below
        } else {
          e.lunge = 1;
          if (d < e.d.range + 16) {
            // A set line receives a charge, mirroring the player's brace on exactly the
            // same latch (Plan 029) — for TROOPS. The HERO keeps the pre-029 live-velocity
            // read: nothing ever writes rushT on him (he takes no orders), and he is the
            // one body for which the instant read measured reliably — at speed 315 / dash
            // 760 he is moving faster than BRACE_SPEED whenever he is moving at all, with
            // none of the braked-in-reach problem the troop measurement found. Dropping
            // him from the predicate entirely (as the first rebuild did) silently deleted
            // the 1.8x a holding line has always dealt a hero riding into it.
            // Deliberately NOT extended to a slam: BRACE_BONUS on an AoE is a different
            // mechanic from bracing against one man, and a 1.8x brute slam is a lethality
            // change, which is exactly what the audit measured and rejected. The enemy
            // uses the CONSTANT bonus, never the player's Set Spears perk value.
            // Plan 032: the same braceMul as the player's line (one function, both sides),
            // with the enemy's two differences passed as arguments — its own rush read
            // (latch OR the hero's live velocity) and the CONSTANT bonus.
            const braced = stance === 'hold'
              ? braceMul(battle, e, to,
                  (to.rushT || 0) > 0 || (tgt.isHero && len(to.vx, to.vy) > BRACE_SPEED), BRACE_BONUS)
              : 1;
            // And the flank multiplier, mirroring the troop path; flankMul itself exempts
            // the hero (his facing is the cursor, and fight outcomes must not read it).
            battle.damageFriendly(to, tgt.isHero, e.d.dmg * braced * flankMul(battle, to, e.x, e.y), e);
            if (!tgt.isHero) { to.vx += Math.cos(e.facing) * 85; to.vy += Math.sin(e.facing) * 85; }
            // Hit and run: a stalking wolf that has bitten breaks off rather than staying
            // in reach of the spear line. Only ever set while its squad is holding, so a
            // committed (bloodlust) pack never recoils and the stall guarantee is intact.
            if (e.type === 'wolf' && stance === 'hold') e.recoilT = WOLF_RECOIL_T;
          }
        }
        e.cd = e.d.cooldown;
      }
    } else {
      // Charge speed and bloodlust speed are taken as a MAXIMUM, never multiplied: 1.3
      // times 1.15 is not "faster", it is a different unit.
      const chargeMul = stance === 'charge' ? CHARGE_SPEED_MUL : 1;
      const speedMul = battle.bloodlust ? Math.max(1.3, chargeMul) : chargeMul;
      // Phase 4a: sampled once per enemy per tick at its current position, reused for both
      // the approach and keep-away branches below — terrain costs the same to cross either
      // direction.
      const terrainMul = battle.terrainSpeedAt(e.x, e.y);
      const wantR = e.d.ranged ? e.d.range * 0.85 : e.d.range + 6;
      // Phase 5, mandatory fallback: see the matching comment in updateTroopPhase. A raider
      // blind for more than 1.5s stops kiting at range and advances instead, until a shot
      // (below) proves LOS is back and clears blindT.
      const blind = e.d.ranged && e.blindT > BLIND_ADVANCE_T;

      // ---- Plan 027: the stance picks the goal. Everything below the block is the shared
      // movement tail, unchanged. `follow` leaves all three of these at their pre-027
      // values, so that path is identical to what shipped before.
      // `hasGoal` plus two scalars rather than an object: this runs per enemy per tick and
      // the module allocates nothing else on that path.
      let hasGoal = false, goalX = 0, goalY = 0;
      let standGround = false;  // brake in place this tick
      let kiteAllowed = true;   // whether the ranged keep-away rule below may fire
      if (stance === 'hold' && e.recoilT > 0) {
        // Breaking off after a bite: run, do not brake, and do not stop to trade.
        e.recoilT -= dt;
        kiteAllowed = false;
        hasGoal = true; goalX = e.x + (e.x - to.x); goalY = e.y + (e.y - to.y);
      } else if (stance === 'hold') {
        // HOLD means something different to each archetype, and deliberately so — the
        // player's own HOLD already means "brace" to a spearman and "steady aim" to an
        // archer. The shared part is that nobody on HOLD walks into a fight they were not
        // sent to.
        if (e.type === 'wolf') {
          kiteAllowed = false;
          const commits = to.hp <= (to.maxHp || 1) * WOLF_COMMIT_HP || isIsolated(battle, to);
          if (!commits) {
            // Stalking: keep the pack at distance and refuse the trade until the target is
            // wounded or has strayed off the warband. A wolf that stands in a line is just
            // a slow bandit with a quarter of the hit points.
            if (d < WOLF_STALK_R * 0.9) { hasGoal = true; goalX = e.x + (e.x - to.x); goalY = e.y + (e.y - to.y); }
            else if (d <= WOLF_STALK_R * 1.25) standGround = true;
          }
        } else if (!mustersInLine(e)) {
          // A bow does not muster (see mustersInLine): it is already where it needs to be,
          // at its own working range. Movement stays exactly what it was — kite in, stand
          // in the band, close when out of range — and what HOLD buys it is the tighter
          // grouping at the moment of the shot (BOW_SPREAD_BRACED, applied where the arrow
          // is loosed).
        } else if (d <= wantR + 8) {
          kiteAllowed = false;
          standGround = true; // something is already in reach — fight where you stand
        } else {
          kiteAllowed = false;
          const anchor = enemyAnchorFor(battle, e, battle._enemyAnchorScratch);
          if (dist2(e.x, e.y, anchor.x, anchor.y) < 24 * 24) standGround = true;
          else { hasGoal = true; goalX = anchor.x; goalY = anchor.y; }
        }
      } else if (stance === 'charge') {
        // Committing means closing: a charging bow does not back off. It gets no swerve of
        // its own — a per-unit arc was measured to leave a lone raider orbiting a static
        // warband for the whole 90s budget, because a constant rotation applied to a
        // constantly re-read bearing never resolves against a target that does not move.
        // Flanking is where the force MUSTERS, decided once by the commander.
        kiteAllowed = false;
      }
      // The Phase-5 blindness guarantee outranks every order: a ranged unit that cannot see
      // its target must always end up walking out from behind whatever is occluding it,
      // whatever the commander said. Without this, a raider ordered to hold behind a wood
      // stands there for the rest of the fight.
      if (blind) { standGround = false; hasGoal = false; }

      if (kiteAllowed && e.d.ranged && d < e.d.keepAway && !battle.bloodlust && !blind) {
        const a = Math.atan2(e.y - to.y, e.x - to.x);
        e.vx = lerp(e.vx, Math.cos(a) * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
        e.vy = lerp(e.vy, Math.sin(a) * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
      } else if (standGround) {
        e.vx *= 0.85; e.vy *= 0.85;
      } else if (hasGoal || d > wantR || blind) {
        let gx, gy;
        if (hasGoal) { gx = goalX; gy = goalY; }
        else {
          gx = to.x; gy = to.y;
          if (!e.d.ranged && d < wantR * 3.5) { // surround instead of stacking
            if (e.jit == null) e.jit = battle.enemies.indexOf(e) * 2.399;
            gx += Math.cos(e.jit) * wantR * 0.7; gy += Math.sin(e.jit) * wantR * 0.7;
          }
          if (blind) {
            // Task 1 corrective pass: sidestep around whatever occludes the shot instead of
            // walking into it. On a bounded sidestep give-up, gx/gy keep the pre-fix
            // straight-at-target goal already set above.
            const bdx = to.x - e.x, bdy = to.y - e.y, blen = len(bdx, bdy);
            const bdirX = blen > 0 ? bdx / blen : 1, bdirY = blen > 0 ? bdy / blen : 0;
            const heading = blindSidestepHeading(e, e.x, e.y, bdirX, bdirY, blen, dt, battle.blockers);
            if (heading) { gx = e.x + heading.x * LOOKAHEAD; gy = e.y + heading.y * LOOKAHEAD; }
          }
        }
        // Milestone 025 Slice C: enemies prioritize contesting a Hold objective —
        // while outside the marked ground their goal blends toward it, so the
        // defender's clock genuinely pauses instead of running itself out unopposed.
        const zo = battle.objective;
        if (zo && zo.kind === 'hold' && Math.sqrt(dist2(e.x, e.y, zo.x, zo.y)) > zo.r * 0.9) {
          gx = gx * 0.5 + zo.x * 0.5; gy = gy * 0.5 + zo.y * 0.5;
        }
        // Phase 4b: resolve the crossing waypoint before steering, same ordering as troops.
        const wp = battle.crossingWaypoint(e.x, e.y, gx, gy);
        if (wp) { gx = wp.x; gy = wp.y; }
        let gdx = gx - e.x, gdy = gy - e.y;
        const gd = len(gdx, gdy);
        if (gd > 0) {
          gdx /= gd; gdy /= gd;
          if (steerAroundObstacle(battle, e, dt, e.x, e.y, e.d.radius, gdx, gdy, gd)) {
            gdx = battle._steerScratch.x; gdy = battle._steerScratch.y;
          }
          // After steering, never into the wall (Plan 040). Applied last, because a
          // deflection is exactly what tends to point a body outward.
          if (slideAlongArenaEdge(battle, e.x, e.y, gdx, gdy, battle._steerScratch)) {
            gdx = battle._steerScratch.x; gdy = battle._steerScratch.y;
          }
        }
        // Plan 029, the rush latch. Only this branch can set it — the kite branch above is
        // moving AWAY and standGround is not moving at all — and only when the heading
        // actually points at the target, so a stalking wolf backing off or a recoiling one
        // breaking away does not count as charging the man it just bit. Terrain is excluded
        // from the commanded speed: crossing a road is not a charge.
        if (gd > 0 && gdx * (to.x - e.x) + gdy * (to.y - e.y) > 0) markRush(e, e.d.speed * speedMul);
        e.vx = lerp(e.vx, gdx * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
        e.vy = lerp(e.vy, gdy * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
      } else { e.vx *= 0.85; e.vy *= 0.85; }
      // Phase 5: the firing gate for a ranged enemy lives here, at windup ENTRY, not inside
      // fireArrow — a raider that cannot see its target never starts the telegraph, so its
      // cooldown effectively never advances and it keeps taking the movement branch above
      // (including the blind-advance fallback) instead of freezing through a repeated
      // windup-then-nothing loop every tick.
      // Plan 027 mirrors "a charge forfeits the bow line": a raider ordered forward is
      // running with its bow down until it is inside its working range.
      const advancingBow = e.d.ranged && stance === 'charge' && d > wantR;
      if (e.cd <= 0 && !advancingBow && d < (e.d.ranged ? e.d.range : wantR + 8) &&
          (!e.d.ranged || battle.hasLineOfSight(e.x, e.y - 10, to.x, to.y))) {
        e.windupT = e.d.windup; // telegraph
      }
    }
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.x = clamp(e.x, ARENA_EDGE, battle.W - ARENA_EDGE); e.y = clamp(e.y, ARENA_EDGE, battle.H - ARENA_EDGE);
    if (len(e.vx, e.vy) > 25) e.bob += dt * 9;
  }

}

export function updateStalematePhase(battle) {
  const P = battle.palette;
  // Survivors stop kiting and close in after 10s without blood — or after STALL_NO_DEATH
  // seconds in which nobody actually died. The second clock matters because kiting
  // raiders keep landing hits, so `lastAction` never goes stale even while the fight
  // makes no progress at all: melee on FOLLOW hold formation and never close, and the
  // whole battle grinds past the 90s mark. Damage is not progress; bodies are.
  const stalled = battle.time - battle.lastAction > 10 ||
    battle.time - battle.lastDeath > STALL_NO_DEATH;
  if (!battle.bloodlust && stalled && battle.enemies.length > 0) {
    battle.bloodlust = true;
    battle.commandFlash = { text: 'THEY CLOSE IN!', t: 1.1 };
    battle.game.sfx.horn(110);
    for (const e of battle.enemies) battle.particles.ring(e.x, e.y, 26, P.enemy, 0.5, 3);
  }

  // Plan 045: the terminal measure, because `bloodlust` above is a one-shot flag and until
  // now it was the last thing the loop did about a stall. If the survivors have closed in and
  // STILL nobody has died for STALL_TERMINAL seconds, the two sides cannot reach each other
  // and no amount of further simulation will change that — measured at 541 seconds without a
  // body on camp raid seed 7 / c1, one brute orbiting a 185px steering envelope.
  //
  // What this does NOT do is decide the fight. Handing the win to whoever has more bodies
  // left would invent a scoring rule the game does not otherwise have, and would pay out a
  // victory nobody earned. It removes the thing in the way instead: while `closing` holds,
  // obstacle steering is skipped (steerAroundObstacle's first line) and the obstacle
  // push-out is skipped (separation.js), so every body walks straight at what it is fighting
  // through terrain if it has to, and the fight resolves itself by combat as it should have.
  // Unit-vs-unit separation is untouched — bodies still have to meet to swing.
  //
  // A CLOCK, NOT A LATCH: one death clears it, and the ordinary steering resumes on the next
  // tick. A fight that is producing bodies is progressing, however slowly, and slow is not
  // the thing this guards against — camp raid seed 7 / c2 legitimately takes 131 s.
  const wasClosing = battle.closing;
  battle.closing = battle.enemies.length > 0 && battle.troops.length + 1 > 0 &&
    battle.time - battle.lastDeath > STALL_TERMINAL;
  if (battle.closing && !wasClosing) {
    battle.commandFlash = { text: 'NO QUARTER!', t: 1.1 };
    battle.game.sfx.horn(96);
  }
}
