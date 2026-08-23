// Per-actor decision and movement for one tick: the hero, the troop line under its squad
// stance, the enemy line, and the stalemate breaker. This is the gameplay-feel layer —
// stance trade-offs, target choice, charge exposure, wolves hunting the backline — kept
// apart from the tick orchestration in battle.js that fixes the order they run in.
//
// Every call back into the scene goes through the instance (battle.nearestEnemy,
// battle.damageEnemy, battle.slotPos, ...) so the ordered seams stay patchable by
// tests/e2e/world-battle-seams.spec.js and nothing here needs a second import edge.
import { HERO } from '../data.js?v=rbe1f74f09262';
import { clamp, lerp, angLerp, dist2, len } from '../engine.js?v=rbe1f74f09262';
import { ACTIONS } from '../input-actions.js?v=rbe1f74f09262';
import {
  BRACE_SPEED, BRACE_BONUS, BOW_SPREAD, BOW_SPREAD_BRACED, CHARGE_RECOVER, STALL_NO_DEATH,
  LOOKAHEAD, TANGENT_MARGIN, STEER_MAX_ACTIVE, STEER_COOLDOWN, BLIND_ADVANCE_T,
  BLIND_SIDESTEP_MAX_ACTIVE, BLIND_SIDESTEP_COOLDOWN,
} from './constants.js?v=rbe1f74f09262';

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
// Deterministic (no RNG) and allocation-free: uses the existing `_obstacleGrid` broad phase
// and its own reusable `queryItems` buffer, consumed synchronously.
function steerAroundObstacle(battle, unit, dt, ux, uy, ur, dirX, dirY, goalDist) {
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
  let bestT = Infinity, bestObstacle = null, bestEffR = 0;
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
  const bestOx = bestObstacle.x - ux, bestOy = bestObstacle.y - uy;
  const D = Math.sqrt(bestOx * bestOx + bestOy * bestOy);
  if (D <= bestEffR) return false; // degenerate guard, should not happen given the check above
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
  const theta = Math.asin(clamp(bestEffR / D, -1, 1));
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
    if (battle.deployT > 0) { battle.deployT = 0; battle.commandFlash = { text: 'FIRST BLOOD!', t: 0.9 }; battle.game.sfx.horn(155); }
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
    inArc.sort((a, b) => a[0] - b[0]);
    const targets = inArc.slice(0, HERO.swingMaxTargets);
    for (const [, e] of targets) {
      battle.damageEnemy(e, HERO.swingDmg, Math.cos(aimA) * 60, Math.sin(aimA) * 60, 'hero');
      e.vx += Math.cos(aimA) * 160; e.vy += Math.sin(aimA) * 160;
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
    // exposure is refreshed while charging and decays after the order changes
    const squadStanceNow = battle.squadStance(t);
    if (squadStanceNow === 'charge') t.exposedT = CHARGE_RECOVER;
    else if (t.exposedT > 0) t.exposedT = Math.max(0, t.exposedT - dt);

    // troops always defend the commander: any enemy near the hero is fair game
    const heroThreat = battle.nearestEnemy(battle.hero.x, battle.hero.y, 90);
    const stance = squadStanceNow;
    if (stance === 'charge') {
      engage = t.d.ranged ? pickRangedEnemy(battle, t, t.x, t.y, 1e9, dt) : battle.nearestEnemy(t.x, t.y);
    } else if (stance === 'hold') {
      const maxR = t.d.ranged ? t.d.range : 140;
      engage = t.d.ranged ? pickRangedEnemy(battle, t, t.x, t.y, maxR, dt) : battle.nearestEnemy(t.x, t.y, maxR);
      if (!engage && heroThreat && dist2(t.x, t.y, battle.hero.x, battle.hero.y) < 260 * 260) engage = heroThreat;
      if (!engage) goal = { x: t.holdX, y: t.holdY };
    } else { // follow
      const maxR = t.d.ranged ? t.d.range * 0.9 : 150;
      engage = t.d.ranged ? pickRangedEnemy(battle, t, t.x, t.y, maxR, dt) : battle.nearestEnemy(t.x, t.y, maxR);
      if (!engage && heroThreat) engage = heroThreat;
      if (!engage) goal = battle.slotPos(t);
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
        // closing at speed (wolves sprint at 158, a brute commits at 55). This is what makes
        // HOLD the answer to a pack instead of a strictly slower FOLLOW.
        const closingFast = stance === 'hold' && !t.d.ranged &&
          len(engage.vx, engage.vy) > BRACE_SPEED;
        const dmg = t.d.dmg * (closingFast ? BRACE_BONUS : 1);
        if (t.d.ranged) {
          // Phase 5: the firing gate lives here, not inside fireArrow — checked BEFORE the
          // cooldown is consumed, so a blind archer does not silently burn a shot into a
          // hillside every time its cooldown comes up.
          if (battle.hasLineOfSight(t.x, t.y - 12, engage.x, engage.y)) {
            if (battle.deployT > 0) { battle.deployT = 0; battle.commandFlash = { text: 'FIRST BLOOD!', t: 0.9 }; battle.game.sfx.horn(155); }
            t.cd = t.d.cooldown;
            // Archers standing still shoot straighter than archers walking.
            const spread = stance === 'hold' ? BOW_SPREAD_BRACED : BOW_SPREAD;
            battle.fireArrow(t.x, t.y - 12, engage.x, engage.y, true, dmg, t.d.projSpeed, null, spread);
            t.blindT = 0;
          }
        } else {
          if (battle.deployT > 0) { battle.deployT = 0; battle.commandFlash = { text: 'FIRST BLOOD!', t: 0.9 }; battle.game.sfx.horn(155); }
          t.cd = t.d.cooldown;
          t.lunge = 1;
          battle.damageEnemy(engage, dmg,
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
        const sp = t.d.speed * (stance === 'charge' ? 1.15 : 1) * clamp(d / 40, 0.5, 1.6) *
          battle.terrainSpeedAt(t.x, t.y);
        t.vx = lerp(t.vx, dirX * sp, 1 - Math.exp(-8 * dt));
        t.vy = lerp(t.vy, dirY * sp, 1 - Math.exp(-8 * dt));
        if (!engage) t.facing = angLerp(t.facing, Math.atan2(dirY, dirX), 1 - Math.exp(-6 * dt));
      } else { t.vx *= 0.8; t.vy *= 0.8; }
    } else if (!engage) { t.vx *= 0.85; t.vy *= 0.85; }
    else { t.vx *= 0.9; t.vy *= 0.9; }

    t.x += t.vx * dt; t.y += t.vy * dt;
    t.x = clamp(t.x, 30, battle.W - 30); t.y = clamp(t.y, 30, battle.H - 30);
    if (len(t.vx, t.vy) > 30) { t.bob += dt * 10; if (battle.fxRng() < dt * 3) battle.particles.dust(t.x, t.y + 5, P.groundShade, 1, battle.fxRng); }
  }

}

export function updateEnemyPhase(battle, dt, h) {
  const P = battle.palette;
  // ---- deploy window: enemies hold their line until the horn, the player sets up freely.
  // First blood (yours), closing to melee reach, or the timer ends it.
  if (battle.deployT > 0) {
    battle.deployT -= dt;
    battle.lastAction = battle.time; // no stalemate clock during forming-up
    battle.lastDeath = battle.time;
    const ne = battle.nearestEnemy(h.x, h.y, 250);
    if (ne) battle.deployT = 0; // riding into their line starts the fight on the spot
    if (battle.deployT <= 0) {
      battle.game.sfx.horn(155);
      battle.commandFlash = { text: 'THEY ADVANCE!', t: 1.0 };
    }
    for (const e of battle.enemies) {
      e.vx *= 0.85; e.vy *= 0.85;
      e.facing = angLerp(e.facing, Math.atan2(h.y - e.y, h.x - e.x), 1 - Math.exp(-3 * dt));
    }
  } else
  // ---- enemies
  for (const e of battle.enemies) {
    e.cd -= dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.lunge > 0) e.lunge -= dt * 5;
    // wolves earn their name: they hunt the backline (nearest ranged troop)
    let tgt;
    if (e.type === 'wolf') {
      const best = battle.nearestFriendlyRanged(e.x, e.y, 460);
      tgt = best ? { obj: best, isHero: false } : battle.nearestFriendly(e.x, e.y);
    } else if (e.d.ranged) {
      // Phase 5: a ranged enemy (raider) prefers a target it can see; see pickRangedFriendly.
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
          battle.fireArrow(e.x, e.y - 10, to.x, to.y, false, e.d.dmg, e.d.projSpeed, e.type);
          e.blindT = 0; // the shot only ever gets this far because LOS gated windup entry below
        } else {
          e.lunge = 1;
          if (d < e.d.range + 16) {
            battle.damageFriendly(to, tgt.isHero, e.d.dmg, e);
            if (!tgt.isHero) { to.vx += Math.cos(e.facing) * 85; to.vy += Math.sin(e.facing) * 85; }
          }
        }
        e.cd = e.d.cooldown;
      }
    } else {
      const speedMul = battle.bloodlust ? 1.3 : 1;
      // Phase 4a: sampled once per enemy per tick at its current position, reused for both
      // the approach and keep-away branches below — terrain costs the same to cross either
      // direction.
      const terrainMul = battle.terrainSpeedAt(e.x, e.y);
      const wantR = e.d.ranged ? e.d.range * 0.85 : e.d.range + 6;
      // Phase 5, mandatory fallback: see the matching comment in updateTroopPhase. A raider
      // blind for more than 1.5s stops kiting at range and advances instead, until a shot
      // (below) proves LOS is back and clears blindT.
      const blind = e.d.ranged && e.blindT > BLIND_ADVANCE_T;
      if (e.d.ranged && d < e.d.keepAway && !battle.bloodlust && !blind) {
        const a = Math.atan2(e.y - to.y, e.x - to.x);
        e.vx = lerp(e.vx, Math.cos(a) * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
        e.vy = lerp(e.vy, Math.sin(a) * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
      } else if (d > wantR || blind) {
        let gx = to.x, gy = to.y;
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
        }
        e.vx = lerp(e.vx, gdx * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
        e.vy = lerp(e.vy, gdy * (e.d.speed * speedMul * terrainMul), 1 - Math.exp(-6 * dt));
      } else { e.vx *= 0.85; e.vy *= 0.85; }
      // Phase 5: the firing gate for a ranged enemy lives here, at windup ENTRY, not inside
      // fireArrow — a raider that cannot see its target never starts the telegraph, so its
      // cooldown effectively never advances and it keeps taking the movement branch above
      // (including the blind-advance fallback) instead of freezing through a repeated
      // windup-then-nothing loop every tick.
      if (e.cd <= 0 && d < (e.d.ranged ? e.d.range : wantR + 8) &&
          (!e.d.ranged || battle.hasLineOfSight(e.x, e.y - 10, to.x, to.y))) {
        e.windupT = e.d.windup; // telegraph
      }
    }
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.x = clamp(e.x, 30, battle.W - 30); e.y = clamp(e.y, 30, battle.H - 30);
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
}
