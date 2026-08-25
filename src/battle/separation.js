// Unit separation: the crowd-physics pass that stops bodies from standing inside each
// other. Two paths on purpose — designed battles keep the exact legacy O(n^2) mutation
// order, and only stress sizes use the spatial broad phase (see tests/README.md), so a
// normal encounter can never change because a bucket boundary moved.
import { HERO } from '../data.js?v=r4c28c87ff1ea';
import { dist2 } from '../engine.js?v=r4c28c87ff1ea';

export function updateSeparationPhase(battle, h) {
  const all = battle._allUnits;
  all.length = 0;
  for (const t of battle.troops) all.push(t);
  for (const e of battle.enemies) all.push(e);
  // Designed battles stay on the exact legacy mutation order. This avoids
  // changing a normal encounter because an earlier push moved a later unit
  // across a bucket boundary; the broad phase is reserved for stress sizes.
  if (all.length <= battle._separationSpatialThreshold) {
    updateLegacySeparation(battle, all, h);
    return;
  }
  let maxUnitRadius = 0;
  for (const unit of all) if (unit.d.radius > maxUnitRadius) maxUnitRadius = unit.d.radius;
  let maxObstacleRadius = 0;
  for (const obstacle of battle.obstacles) if (obstacle.r > maxObstacleRadius) maxObstacleRadius = obstacle.r;
  battle._unitGrid.rebuild(all);
  battle._obstacleGrid.rebuild(battle.obstacles);
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const unitCandidates = battle._unitGrid.queryOrdered(a.x, a.y, a.d.radius + maxUnitRadius + 13);
    for (let k = 0; k < unitCandidates; k++) {
      const b = battle._unitGrid.queryItems[k];
      battle._unitGrid.noteCandidate();
      if (b._spatialOrder <= i) continue;
      battle._unitGrid.stats.pairs++;
      applyUnitSeparation(battle, a, b);
    }
    pushOutOf(battle, a, h, a.d.radius + HERO.radius + 3, 0.9);
    const obstacleCandidates = battle._obstacleGrid.queryOrdered(a.x, a.y, a.d.radius + maxObstacleRadius);
    for (let k = 0; k < obstacleCandidates; k++) {
      const o = battle._obstacleGrid.queryItems[k];
      battle._obstacleGrid.noteCandidate();
      pushOutOf(battle, a, o, a.d.radius + o.r, 1);
    }
  }
  const heroObstacleCandidates = battle._obstacleGrid.queryOrdered(h.x, h.y, HERO.radius + maxObstacleRadius);
  for (let k = 0; k < heroObstacleCandidates; k++) {
    const o = battle._obstacleGrid.queryItems[k];
    battle._obstacleGrid.noteCandidate();
    pushOutOf(battle, h, o, HERO.radius + o.r, 1);
  }
}

export function updateLegacySeparation(battle, all, h) {
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    for (let j = i + 1; j < all.length; j++) applyUnitSeparation(battle, a, all[j]);
    pushOutOf(battle, a, h, a.d.radius + HERO.radius + 3, 0.9);
    for (const o of battle.obstacles) pushOutOf(battle, a, o, a.d.radius + o.r, 1);
  }
  for (const o of battle.obstacles) pushOutOf(battle, h, o, HERO.radius + o.r, 1);
}

export function applyUnitSeparation(battle, a, b) {
  const sameTeam = a.team === b.team;
  const rr = a.d.radius + b.d.radius + (sameTeam ? 13 : 7);
  const d2 = dist2(a.x, a.y, b.x, b.y);
  if (d2 < rr * rr && d2 > 0.01) {
    const d = Math.sqrt(d2), push = (rr - d) / d * (sameTeam ? 0.95 : 0.8);
    const dx = (a.x - b.x) * push, dy = (a.y - b.y) * push;
    a.x += dx; a.y += dy; b.x -= dx; b.y -= dy;
  }
}

// Push `a` clear of a body it must not overlap, moving only `a`: the hero shoves
// troops aside but is not shoved by them, and obstacles never move at all. The
// symmetric unit-vs-unit case stays separate above because both sides give ground.
// `rr` is the sum of radii plus whatever spacing the caller wants kept.
export function pushOutOf(battle, a, b, rr, factor) {
  const d2 = dist2(a.x, a.y, b.x, b.y);
  if (d2 < rr * rr && d2 > 0.01) {
    const d = Math.sqrt(d2), push = (rr - d) / d * factor;
    a.x += (a.x - b.x) * push; a.y += (a.y - b.y) * push;
  }
}

export function getSpatialStats(battle) {
  return {
    targetChecks: battle._enemyGrid.stats.candidateChecks + battle._friendlyGrid.stats.candidateChecks,
    targetCells: battle._enemyGrid.stats.cellVisits + battle._friendlyGrid.stats.cellVisits,
    separationChecks: battle._unitGrid.stats.candidateChecks,
    separationPairs: battle._unitGrid.stats.pairs,
    obstacleChecks: battle._obstacleGrid.stats.candidateChecks,
    orderingItems: battle._spatialCounters.orderingItems,
    rebuilds: battle._enemyGrid.stats.rebuilds + battle._friendlyGrid.stats.rebuilds + battle._unitGrid.stats.rebuilds + battle._obstacleGrid.stats.rebuilds,
  };
}
