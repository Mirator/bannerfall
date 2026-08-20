// Per-actor decision and movement for one tick: the hero, the troop line under its squad
// stance, the enemy line, and the stalemate breaker. This is the gameplay-feel layer —
// stance trade-offs, target choice, charge exposure, wolves hunting the backline — kept
// apart from the tick orchestration in battle.js that fixes the order they run in.
//
// Every call back into the scene goes through the instance (battle.nearestEnemy,
// battle.damageEnemy, battle.slotPos, ...) so the ordered seams stay patchable by
// tests/e2e/world-battle-seams.spec.js and nothing here needs a second import edge.
import { HERO } from '../data.js?v=ra209d001f5a8';
import { clamp, lerp, angLerp, dist2, len } from '../engine.js?v=ra209d001f5a8';
import { ACTIONS } from '../input-actions.js?v=ra209d001f5a8';
import {
  BRACE_SPEED, BRACE_BONUS, BOW_SPREAD, BOW_SPREAD_BRACED, CHARGE_RECOVER, STALL_NO_DEATH,
} from './constants.js?v=ra209d001f5a8';

export function updateHeroPhase(battle, dt, inp, h, ax) {
  const P = battle.palette;
  const sfx = battle.game.sfx;
  // ---- hero movement
  const dashing = h.dashT > 0;
  if (!dashing) {
    h.vx += ax.x * HERO.accel * dt;
    h.vy += ax.y * HERO.accel * dt;
    const sp = len(h.vx, h.vy), max = HERO.speed;
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
      engage = battle.nearestEnemy(t.x, t.y);
    } else if (stance === 'hold') {
      engage = battle.nearestEnemy(t.x, t.y, t.d.ranged ? t.d.range : 140);
      if (!engage && heroThreat && dist2(t.x, t.y, battle.hero.x, battle.hero.y) < 260 * 260) engage = heroThreat;
      if (!engage) goal = { x: t.holdX, y: t.holdY };
    } else { // follow
      engage = battle.nearestEnemy(t.x, t.y, t.d.ranged ? t.d.range * 0.9 : 150);
      if (!engage && heroThreat) engage = heroThreat;
      if (!engage) goal = battle.slotPos(t);
    }

    if (engage) {
      const d = Math.sqrt(dist2(t.x, t.y, engage.x, engage.y));
      const wantR = t.d.ranged ? t.d.range * 0.8 : t.d.range + engage.d.radius - 6;
      if (t.d.ranged && stance === 'hold') {
        goal = null; // archers on hold stand ground
      } else if (d > wantR) {
        // surround: each unit approaches its own point on the target's circle
        if (!t.d.ranged && d < wantR * 3.5) {
          if (t.jit == null) t.jit = (battle.troops.indexOf(t) * 2.399);
          goal = { x: engage.x + Math.cos(t.jit) * wantR * 0.9, y: engage.y + Math.sin(t.jit) * wantR * 0.9 };
        } else {
          // approach IN FORMATION: hold your lateral slot while closing, so a charge
          // reads as a wedge bearing down — not a swarm converging on one point
          const aa = Math.atan2(engage.y - t.y, engage.x - t.x);
          const side = (t.slot.col - (t.slot.rowCount - 1) / 2) * 26;
          const rowBack = t.slot.row * 24;
          goal = {
            x: engage.x - Math.cos(aa) * rowBack + Math.cos(aa + Math.PI / 2) * side,
            y: engage.y - Math.sin(aa) * rowBack + Math.sin(aa + Math.PI / 2) * side,
          };
        }
      } else if (t.d.ranged && d < t.d.keepAway) {
        goal = { x: t.x + (t.x - engage.x), y: t.y + (t.y - engage.y) };
      }
      t.facing = angLerp(t.facing, Math.atan2(engage.y - t.y, engage.x - t.x), 1 - Math.exp(-8 * dt));
      // A charge forfeits the bow line: archers ordered forward are running with their
      // bows down, so CHARGE trades the ranged screen for speed instead of keeping both.
      const advancingBow = t.d.ranged && stance === 'charge' && d > wantR;
      if (t.cd <= 0 && !advancingBow && d < (t.d.ranged ? t.d.range : t.d.range + engage.d.radius + 4)) {
        if (battle.deployT > 0) { battle.deployT = 0; battle.commandFlash = { text: 'FIRST BLOOD!', t: 0.9 }; battle.game.sfx.horn(155); }
        t.cd = t.d.cooldown;
        // A set line receives a charge: melee holding position hit harder against anything
        // closing at speed (wolves sprint at 158, a brute commits at 55). This is what makes
        // HOLD the answer to a pack instead of a strictly slower FOLLOW.
        const closingFast = stance === 'hold' && !t.d.ranged &&
          len(engage.vx, engage.vy) > BRACE_SPEED;
        const dmg = t.d.dmg * (closingFast ? BRACE_BONUS : 1);
        if (t.d.ranged) {
          // Archers standing still shoot straighter than archers walking.
          const spread = stance === 'hold' ? BOW_SPREAD_BRACED : BOW_SPREAD;
          battle.fireArrow(t.x, t.y - 12, engage.x, engage.y, true, dmg, t.d.projSpeed, null, spread);
        } else {
          t.lunge = 1;
          battle.damageEnemy(engage, dmg,
            Math.cos(t.facing) * 85, Math.sin(t.facing) * 85, 'troop');
        }
      }
    }

    if (goal) {
      const dx = goal.x - t.x, dy = goal.y - t.y, d = len(dx, dy);
      if (d > 6) {
        const sp = t.d.speed * (stance === 'charge' ? 1.15 : 1) * clamp(d / 40, 0.5, 1.6);
        t.vx = lerp(t.vx, dx / d * sp, 1 - Math.exp(-8 * dt));
        t.vy = lerp(t.vy, dy / d * sp, 1 - Math.exp(-8 * dt));
        if (!engage) t.facing = angLerp(t.facing, Math.atan2(dy, dx), 1 - Math.exp(-6 * dt));
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
      const wantR = e.d.ranged ? e.d.range * 0.85 : e.d.range + 6;
      if (e.d.ranged && d < e.d.keepAway && !battle.bloodlust) {
        const a = Math.atan2(e.y - to.y, e.x - to.x);
        e.vx = lerp(e.vx, Math.cos(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
        e.vy = lerp(e.vy, Math.sin(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
      } else if (d > wantR) {
        let gx = to.x, gy = to.y;
        if (!e.d.ranged && d < wantR * 3.5) { // surround instead of stacking
          if (e.jit == null) e.jit = battle.enemies.indexOf(e) * 2.399;
          gx += Math.cos(e.jit) * wantR * 0.7; gy += Math.sin(e.jit) * wantR * 0.7;
        }
        const a = Math.atan2(gy - e.y, gx - e.x);
        e.vx = lerp(e.vx, Math.cos(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
        e.vy = lerp(e.vy, Math.sin(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
      } else { e.vx *= 0.85; e.vy *= 0.85; }
      if (e.cd <= 0 && d < (e.d.ranged ? e.d.range : wantR + 8)) {
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
