// Milestone 025 Slice C — the battle-objective framework.
//
// One interface, three objectives. `buildObjective` turns the serializable
// descriptor that rode in on setup (assembled world-side by
// world/region.js + battle-transition.js) into the battle's runtime state;
// `updateObjectivePhase` advances it once per tick; and EVERY terminal decision
// still belongs to resolveBattleResult() in combat.js — this module computes
// status, it never ends a fight.
//
// Placement rules from the milestone:
//   * Hold zones sit on the defender's ground (the hero's spawn area, which the
//     constructor's obstacle filter already keeps clear) — traversable by
//     construction, never overlapping impassable terrain.
//   * Break targets spawn on the enemy side, pushed out of physical obstacles with
//     a deterministic scan (no RNG: the same seed builds the same positions).
//
// Determinism/boundary notes: this module reads only simulation state (positions,
// terrain arrays), consumes NO RNG, and never reads camera/HUD/render state.
import { clamp } from '../engine.js?v=ra9c0449dbe2f';

// Build the runtime objective from the plain descriptor, or null for the classic
// elimination fight. Called from the Battle constructor AFTER buildTerrain so the
// placement scans can see the real obstacle field.
export function buildObjective(battle) {
  const d = battle.setup.objective;
  if (!d || d.kind === 'elimination' || d.kind == null) {
    battle.objective = null;
    battle.objectiveTargets = [];
    return;
  }
  if (d.kind === 'hold') {
    const radius = d.radius || 170;
    const duration = d.duration || 35;
    // The marked ground is where the defenders stand: the hero's start position,
    // nudged toward the field centre so the ring does not clip the map edge.
    const x = clamp(battle.hero.x + battle.adx * 40, radius + 30, battle.W - radius - 30);
    const y = clamp(battle.hero.y + battle.ady * 40, radius + 30, battle.H - radius - 30);
    battle.objective = {
      kind: 'hold', x, y, r: radius, duration,
      progress: 0,
      held: false,       // at least one combat-capable squad member inside…
      contested: false,  // …and no enemy inside — otherwise the clock pauses
      everHeld: false,
    };
    battle.objectiveTargets = [];
    return;
  }
  if (d.kind === 'break') {
    const guards = Math.max(1, d.guards || 2);
    const hp = d.hp || 260;
    const r = d.radius || 30;
    // Lateral spread across the enemy line, perpendicular to the approach axis.
    const ecx = battle.W / 2 + battle.adx * 410;   // mirrors ENGAGE_GAP/2 + margin
    const ecy = battle.H / 2 + battle.ady * 410;
    const perpX = -battle.ady, perpY = battle.adx;
    const offsets = guards === 1 ? [0] :
      guards === 2 ? [-180, 180] : [-210, 0, 210];
    const targets = [];
    for (let i = 0; i < offsets.length; i++) {
      let x = ecx + perpX * offsets[i];
      let y = ecy + perpY * offsets[i];
      x = clamp(x, r + 40, battle.W - r - 40);
      y = clamp(y, r + 40, battle.H - r - 40);
      // Push out of physical obstacles: walk along +perp, then −perp, then away from
      // the field centre — a bounded deterministic scan, no RNG anywhere.
      const clearOf = (px, py) => battle.obstacles.every(o =>
        o.kind === 'none' || (o.x - px) ** 2 + (o.y - py) ** 2 > (o.r + r + 24) ** 2);
      if (!clearOf(x, y)) {
        let placed = false;
        for (const dir of [1, -1]) {
          for (let step = 60; step <= 420 && !placed; step += 60) {
            const nx = clamp(ecx + perpX * (offsets[i] + dir * step), r + 40, battle.W - r - 40);
            const ny = clamp(ecy + perpY * (offsets[i] + dir * step), r + 40, battle.H - r - 40);
            if (clearOf(nx, ny)) { x = nx; y = ny; placed = true; }
          }
        }
        if (!placed) { x = ecx; y = ecy; } // last resort: the cleared enemy muster point
      }
      targets.push({ x, y, r, hp, maxHp: hp, dead: false, flash: 0 });
    }
    battle.objective = { kind: 'break', targets };
    battle.objectiveTargets = targets;
    return;
  }
  // Unknown descriptor kinds degrade to elimination rather than inventing state.
  battle.objective = null;
  battle.objectiveTargets = [];
}

// Per-tick objective advance. Ordered after separation/projectiles and BEFORE
// resolveBattleResult, so the resolution always sees this tick's status.
export function updateObjectivePhase(battle, dt) {
  // Stronghold reinforcement waves (Entrenched holds): arrive on schedule at the
  // enemy edge, behind their line. Spawning bumps totalEnemies so kill accounting
  // and the loot formula stay coherent.
  if (battle.pendingWaves && battle.pendingWaves.length) {
    const due = battle.pendingWaves.filter(w => battle.time >= w.at);
    if (due.length) {
      battle.pendingWaves = battle.pendingWaves.filter(w => battle.time < w.at);
      for (const wave of due) {
        wave.comp.forEach((type, i) => {
          const a = (i / Math.max(1, wave.comp.length)) * Math.PI * 2;
          const ex = clamp(battle.W / 2 + battle.adx * (battle.W * 0.42) +
            Math.cos(a) * 120, 50, battle.W - 50);
          const ey = clamp(battle.H / 2 + battle.ady * (battle.H * 0.42) +
            Math.sin(a) * 100, 50, battle.H - 50);
          battle.spawnEnemy(type, ex, ey);
        });
        battle.totalEnemies += wave.comp.length;
        // Plan 027: reinforcements need a place in the line, or they would all default to
        // the same slot and stack on the anchor when the commander orders a hold. Rebuilt
        // once per wave, never per spawn — per spawn would be quadratic in the constructor.
        battle.assignEnemySlots();
        battle.commandFlash = { text: 'REINFORCEMENTS!', t: 1.2 };
        battle.game.sfx.horn(98);
      }
    }
  }

  const o = battle.objective;
  if (!o) return;
  if (o.kind === 'hold') {
    // Combat-capable squad members inside the marked ground; the commander himself
    // does not count — the milestone says SQUADS hold ground.
    const heldBy = battle.troops.filter(t => distTo(t, o) < o.r);
    const enemyIn = battle.enemies.some(e => distTo(e, o) < o.r);
    o.held = heldBy.length > 0 && !enemyIn;
    o.contested = enemyIn;
    o.holders = heldBy.length;
    if (o.held) o.everHeld = true;
    // The timer pauses while contested or empty — exactly one rule, both directions.
    if (o.held && !enemyIn) o.progress += dt;
    return;
  }
  // break: structures only decay through damageObjective(); keep flash timers alive.
  for (const t of battle.objectiveTargets) {
    if (t.flash > 0) t.flash -= dt;
  }
}

function distTo(u, o) {
  return Math.sqrt((u.x - o.x) ** 2 + (u.y - o.y) ** 2);
}

// Damage entry point for Break targets — reached as an instance method off the
// scene (battle.damageObjective) from ai-phases.js, mirroring damageEnemy/damageFriendly.
export function damageObjective(battle, target, dmg) {
  const P = battle.palette;
  if (target.dead) return;
  battle.lastAction = battle.time;
  target.hp -= dmg;
  target.flash = 0.12;
  battle.particles.spark(target.x, target.y - 14, P.cream, 5, battle.fxRng);
  battle.game.sfx.hit();
  if (target.hp <= 0) {
    target.dead = true;
    battle.lastDeath = battle.time;
    battle.particles.shards(target.x, target.y, P.enemyDark, 18, battle.fxRng);
    battle.particles.dust(target.x, target.y, P.groundShade, 8, battle.fxRng);
    battle.particles.ring(target.x, target.y, 56, '#FFFFFF', 0.4, 5);
    battle.game.sfx.kill();
    battle.game.camera.shake(7, 0.3);
    battle.freeze = Math.max(battle.freeze, 0.07);
  }
}

// Terminal checks — CALLED FROM resolveBattleResult() only. Returns true when the
// objective itself just decided the fight; endBattle stays combat.js's job.
export function objectiveVictory(battle) {
  const o = battle.objective;
  if (!o) return false;
  if (o.kind === 'hold') return o.progress >= o.duration;
  if (o.kind === 'break') return battle.objectiveTargets.every(t => t.dead);
  return false;
}
