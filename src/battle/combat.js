// What a hit does and how a fight ends: damage application on both sides, arrow spawning,
// and the win/loss/retreat resolution. Separated from the AI phases that decide to swing
// and from the tick loop that orders them.
import { BALANCE } from '../data.js?v=rf0428fde8b3b';
import { len } from '../engine.js?v=rf0428fde8b3b';
import { BOW_SPREAD, CHARGE_EXPOSURE } from './constants.js?v=rf0428fde8b3b';
import { objectiveVictory } from './objectives.js?v=rf0428fde8b3b';

export function damageEnemy(battle, e, dmg, kx, ky, source) {
  const P = battle.palette;
  battle.lastAction = battle.time;
  // Plan 027: charge exposure applies to the enemy on exactly the same terms as the troop
  // path below — a squad the enemy commander sent forward is running with its shields down
  // too. This is what makes committing a decision with a price rather than a free tempo
  // gain, and it is the player's reward for punishing a charge instead of meeting it.
  // The enemy always pays the CONSTANT: `battle.chargeExposure` is the player's, and the
  // Warhorn perk must not also make the enemy's charges safer.
  if (battle.enemyStance(e) === 'charge' || (e.exposedT || 0) > 0) dmg *= CHARGE_EXPOSURE;
  e.hp -= dmg;
  e.flash = 0.12;
  e.vx += kx; e.vy += ky;
  // impact must be VISIBLE in a still frame: more sparks, longer-lived, plus debris
  battle.particles.spark(e.x, e.y - 10, P.cream, 6, battle.fxRng);
  battle.particles.dust(e.x - kx * 0.03, e.y + 4, '#B4A08C', 2, battle.fxRng); // fixed tan: survives night tint
  battle.game.sfx.hit();
  if (e.hp <= 0) {
    battle.kills++;
    battle.deadEnemyTypes.push(e.type);
    const idx = battle.enemies.indexOf(e);
    if (idx >= 0) {
      battle.enemies.splice(idx, 1);
      battle._enemyGrid.rebuild(battle.enemies);
    }
    battle.lastDeath = battle.time;
    battle.particles.shards(e.x, e.y, e.type === 'brute' ? P.enemyDark : P.enemy, e.type === 'brute' ? 16 : 10, battle.fxRng);
    battle.particles.dust(e.x, e.y, P.groundShade, 5, battle.fxRng);
    battle.particles.ring(e.x, e.y, e.type === 'brute' ? 44 : 30, '#FFFFFF', 0.3, 4);
    battle.game.sfx.kill();
    if (source === 'hero') battle.freeze = Math.max(battle.freeze, 0.09);
    battle.game.camera.shake(source === 'hero' ? 6 : 4, 0.18);
  }
}

export function damageFriendly(battle, f, isHero, dmg, from) {
  const P = battle.palette;
  battle.lastAction = battle.time;
  if (isHero && f.iframesT > 0) {
    battle.particles.text(f.x, f.y - 40, 'MISS', P.cream, 13);
    return;
  }
  // A charging squad is running with shields down: the speed is paid for in blood.
  // Hero damage is deliberately untouched - the hero has no stance. Exposure lingers for
  // CHARGE_RECOVER seconds after the order changes, because reading the live stance let a
  // player tap HOLD for one tick mid-swing and take a charge's speed for none of its cost
  // (measured strictly better on both time and losses).
  // Plan 029: `battle.chargeExposure` is CHARGE_EXPOSURE unless the Warhorn perk has
  // lowered it, and a squad inside the Warlord rally window has its shields back up for
  // the rally's duration — the two perks that make a charge cost less, both conditional
  // on the player having ordered or pressed something.
  if (!isHero && (f.rallyT || 0) <= 0 &&
      (battle.squadStance(f) === 'charge' || (f.exposedT || 0) > 0)) dmg *= battle.chargeExposure;
  f.hp -= dmg;
  if (isHero) {
    f.hurtT = 0.25;
    battle.game.sfx.hurt();
    battle.game.camera.shake(7, 0.3);
    battle.particles.spark(f.x, f.y - 12, P.enemy, 5, battle.fxRng);
    // shoved out of the scrum — being surrounded is escapable, standing still is a choice
    if (from) {
      const a = Math.atan2(f.y - from.y, f.x - from.x);
      f.vx += Math.cos(a) * 240; f.vy += Math.sin(a) * 240;
    }
    if (f.hp <= 0) {
      // death clarity: name the killer on the defeat banner
      battle.killedBy = from && from.type
        ? (from.type === 'brute' ? "a brute's slam" : from.type === 'wolf' ? 'wolf fangs' : from.type === 'raider' ? "a raider's arrow" : 'bandit blades')
        : from ? 'an arrow' : 'his wounds';
      battle.endBattle(false);
    }
  } else {
    f.flash = 0.12;
    battle.particles.spark(f.x, f.y - 10, P.enemy, 5, battle.fxRng);
    battle.particles.dust(f.x, f.y + 4, P.groundShade, 2, battle.fxRng);
    if (f.hp <= 0) {
      const idx = battle.troops.indexOf(f);
      if (idx >= 0) {
        battle.troops.splice(idx, 1);
        battle._friendlyGrid.rebuild(battle.troops);
      }
      battle.lastDeath = battle.time;
      // losing the last man of the selected squad hands command back to the whole warband
      if (battle.selectedSquad && !battle.troops.some(t => t.type === battle.selectedSquad)) {
        battle.selectedSquad = null;
      }
      battle.particles.shards(f.x, f.y, P.friend, 7, battle.fxRng);
      battle.particles.ring(f.x, f.y, 18, P.friend, 0.3, 2);
      battle.game.sfx.kill();
      battle.assignSlots();
    }
  }
}

export function fireArrow(battle, sx, sy, tx, ty, friendly, dmg, speed, srcType, spread = BOW_SPREAD, bonusVs = null) {
  const d = Math.max(1, len(tx - sx, ty - sy));
  // slight inaccuracy
  const off = (battle.simRng() - 0.5) * d * spread;
  const a = Math.atan2(ty - sy, tx - sx) + Math.PI / 2;
  tx += Math.cos(a) * off; ty += Math.sin(a) * off;
  // Plan 029: `bonusVs` rides along and is resolved at the landing (see
  // arrowDamageAgainst), never folded into `dmg` here — an arrow hits whoever is nearest
  // where it lands, not necessarily the body it was aimed at.
  battle.projectiles.push({ sx, sy, tx, ty, t: 0, T: d / speed, friendly, dmg, srcType, bonusVs });
  battle.game.sfx.bow();
}

// The damage one landed arrow actually does to the body it found. The declared per-type
// counter in UNIT_TYPES is the source; `battle.bruteBonus` lets the Bodkin Points perk
// deepen the archer's without the unit table needing to know perks exist.
export function arrowDamageAgainst(battle, projectile, targetType) {
  const table = projectile.bonusVs;
  if (!table || !targetType) return projectile.dmg;
  const declared = table[targetType];
  if (declared == null) return projectile.dmg;
  const mul = targetType === 'brute' && battle.bruteBonus != null ? battle.bruteBonus : declared;
  return projectile.dmg * mul;
}

export function endBattle(battle, victory, retreated) {
  if (battle.state === 'end') return;
  battle.state = 'end';
  battle.stateT = 0;
  battle.victory = victory;
  battle.retreated = !!retreated;
  if (victory) {
    battle.loot = BALANCE.lootBase + battle.totalEnemies * BALANCE.lootPerEnemy;
    battle.game.sfx.victory();
  } else if (retreated) {
    battle.game.sfx.horn(131);
  } else {
    battle.game.sfx.defeat();
    battle.game.camera.shake(10, 0.5);
  }
}

export function resolveBattleResult(battle, dt, h, ax) {
  // Milestone 025 Slice C: objective victories resolve HERE — the single terminal
  // decision point owns every ending. Hold completes its timer; Break has felled
  // every guard. Elimination (below) remains a valid parallel win for both.
  if (!battle.onEndFired && objectiveVictory(battle)) battle.endBattle(true);
  if (battle.enemies.length === 0) battle.endBattle(true);
  if (h.hp <= 0) battle.endBattle(false); // standing check — never rely only on the damage path
  // Retreat is a held INPUT decision; knockback, dashes, and drift never fill the bar.
  const inEscape = battle.approach === 'E' ? h.x < 70 : battle.approach === 'W' ? h.x > battle.W - 70
    : battle.approach === 'S' ? h.y < 70 : h.y > battle.H - 70;
  const steeringOut = battle.approach === 'E' ? ax.x < -0.3 : battle.approach === 'W' ? ax.x > 0.3
    : battle.approach === 'S' ? ax.y < -0.3 : ax.y > 0.3;
  if (battle.setup.canRetreat !== false && inEscape && steeringOut && battle.time > 3) {
    battle.retreatT = (battle.retreatT || 0) + dt;
    if (battle.retreatT >= 1.3) battle.endBattle(false, true);
  } else {
    battle.retreatT = 0;
  }
}
