// Plan 024 Phase 3 — builds the battlefield's terrain: collision obstacles, drawn props,
// movement-cost zones, line-of-sight blockers, river crossings and the river's own collision
// segments. Called exactly once from the `Battle` constructor, in place of the old inline
// terrain block.
//
// Two paths, both real:
//   - WITH a Brief (`field` is the object `sampleBattlefield()` produced — see
//     src/world/battlefield-brief.js): terrain is built from the actual patch of campaign
//     map the fight is happening on. This is the whole point of Plan 024.
//   - WITHOUT one (`field` is undefined): `window.game.scenario('battle_small'|'battle_big'|
//     'battle_bridge')` builds a `Battle` directly and carries no `setup.field` at all — see
//     src/main.js. This is a normal, supported case, not a degraded one: the three visual
//     baselines and most of the QA suite run through exactly this path, so it falls back to
//     the original arena-template behaviour (`road`/`village`/`bridge`/`camp` at fixed
//     positions), with the camp/village dressing re-centred toward where the fight actually
//     happens instead of the old absolute W/H fractions (see `fallbackAnchor` below).
//
// RNG discipline: anything that produces an obstacle or a zone is gameplay-affecting, so new
// terrain draws from `RNG_DOMAINS.BATTLE_TERRAIN` (derived from the battle seed), never from
// `simRng` (would perturb the existing draw order every other simRng consumer depends on) and
// never from `fxRng` (decoration only). The pre-existing area-scaled rock/tree scatter below
// keeps using `simRng` exactly as it did before this phase — it is not new, and its draw count
// and order are unchanged, so it does not shift anything downstream.
import { TAU, dist2, clamp, distToSegment, makeRng, deriveSeed, RNG_DOMAINS } from '../engine.js?v=r47a9e4eb3305';
import { ENGAGE_GAP, ROAD_SPEED, WOOD_SPEED, SCRUB_SPEED, FORD_SPEED } from './constants.js?v=r47a9e4eb3305';

// See the corridor-safety comment above the hill loop in buildFromBrief for the measurement
// behind these two numbers.
const HILL_CORRIDOR_MARGIN = 260;
const HILL_SAFE_R = 150;

// Plan 024 Task 1 corrective pass. Enlarging a wood's radius (`WOOD_R_MULT`,
// battlefield-brief.js) to get meaningful LOS coverage on the engagement corridor also
// inflates the two colliding trees' own radius (`t.r = w.r * (0.28..0.5)` below), because
// they are sized as a fraction of the SAME w.r used for the zone/blocker/visual footprint.
// Measured directly: at WOOD_R_MULT=4 (already well short of the radius needed for 55-70%
// corridor coverage) a colliding tree reaches r~110-240 depending on world tree size — the
// same magnitude as the r>=200 hill that this plan already found "never resolves inside 120s"
// (see the hill corridor-safety note above). Confirmed: the `riverside` and `deep country`
// brief-derived fixtures stopped resolving inside 150s at WOOD_R_MULT>=4 with near-zero
// measured LOS block rate — i.e. the stall was the oversized TREE COLLIDER, not the LOS rule.
// Capped here, independent of the LOS-coverage radius, for the same reason ROCK_R_CAP lives
// in the sampler and HILL_SAFE_R lives here: how big the two hard colliders are allowed to
// get is a placement/tolerance concern, not "how far should cover reach". 60 sits close to
// the pre-Phase-3 generic obstacle ceiling (`24 + simRng()*16` maxes at 40) with a little
// headroom for a tree reading larger than a rock, while staying far under the ~195-200
// stall boundary this plan already established.
const TREE_COLLIDER_CAP = 60;

export function buildTerrain(battle, field) {
  const W = battle.W, H = battle.H;
  const simRng = battle.simRng, fxRng = battle.fxRng;
  const terrainRng = makeRng(deriveSeed(battle.setup.seed ?? 1, RNG_DOMAINS.BATTLE_TERRAIN));

  battle.arena = battle.setup.arena || 'road';
  battle.obstacles = [];
  battle.props = [];      // non-colliding dressing drawn under units
  battle.zones = [];      // movement-cost circles/strips (Phase 4a reads these)
  battle.blockers = [];   // LOS occluders only: hills, woods, houses (Phase 5 reads these)
  battle.crossings = [];  // river waypoints for the AI (Phase 4b reads these)
  battle.riverSegs = [];  // flat segment list, same encoding as world.riverSegs
  // Reused output for crossingWaypoint() (Phase 4b) — one scratch entry per instance,
  // written and read synchronously within the same call, same pattern as _steerScratch
  // (battle.js). The caller aliases this directly as its per-tick `goal`; it is never held
  // across ticks, so sharing one object across every unit's query in a frame is safe.
  battle._crossingScratch = { x: 0, y: 0 };

  // Ground clutter that has nothing to do with the Brief: unchanged from pre-Phase-3
  // behaviour, same simRng draw count in the same order, so it never was and still isn't
  // a source of QA churn for a fight that adds no other Brief-derived terrain.
  const area = W * H;
  const obstacleCount = Math.round(area / 68_000);
  for (let i = 0; i < obstacleCount; i++) {
    battle.obstacles.push({
      kind: simRng() < 0.45 ? 'rock' : 'tree',
      x: 140 + simRng() * (W - 280), y: 120 + simRng() * (H - 240),
      r: 24 + simRng() * 16, rot: fxRng() * TAU,
    });
  }

  if (field) buildFromBrief(battle, field, terrainRng, fxRng);
  else buildFromTemplate(battle, terrainRng, fxRng);

  addGroundDetail(battle, fxRng);
}

// ---------------------------------------------------------------- Phase 6b: detail pass
//
// Six new decoration-only prop kinds (render-scene.js's drawProps): log/stump/boulder/bones
// scattered everywhere as generic ground interest (this function), plus reeds along river
// banks and crops near a settlement (placed alongside the terrain that motivates them, in
// buildFromBrief/buildFromTemplate below). All six draw from `fxRng` — decoration only, never
// `simRng` or the terrain stream, and none of them push an obstacle, zone, or blocker.
function addGroundDetail(battle, fxRng) {
  const W = battle.W, H = battle.H, area = W * H;
  const logCount = Math.round(area / 500_000);
  for (let i = 0; i < logCount; i++) {
    battle.props.push({
      kind: 'log', x: 100 + fxRng() * (W - 200), y: 100 + fxRng() * (H - 200),
      s: 14 + fxRng() * 8, rot: fxRng() * TAU,
    });
  }
  const stumpCount = Math.round(area / 450_000);
  for (let i = 0; i < stumpCount; i++) {
    battle.props.push({ kind: 'stump', x: 100 + fxRng() * (W - 200), y: 100 + fxRng() * (H - 200), s: 12 + fxRng() * 6 });
  }
  const boulderCount = Math.round(area / 600_000);
  for (let i = 0; i < boulderCount; i++) {
    battle.props.push({
      kind: 'boulder', x: 100 + fxRng() * (W - 200), y: 100 + fxRng() * (H - 200),
      s: 20 + fxRng() * 14, rot: fxRng() * TAU,
    });
  }
  const boneCount = Math.round(area / 700_000);
  for (let i = 0; i < boneCount; i++) {
    battle.props.push({
      kind: 'bones', x: 100 + fxRng() * (W - 200), y: 100 + fxRng() * (H - 200),
      s: 8 + fxRng() * 5, rot: fxRng() < 0.5 ? -1 : 1,
    });
  }
}

// Reed clusters along a river bank, offset to either side of the polyline by roughly the
// visible channel's half-width. Purely decorative — never touches battle.zones/obstacles.
function scatterReeds(battle, pts, width, fxRng) {
  const bank = width * 0.5 + 12;
  for (let i = 1; i < pts.length; i += 2) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal, either bank
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    for (const side of [-1, 1]) {
      if (fxRng() < 0.4) continue; // sparse, not a solid hedge
      const jitter = (fxRng() - 0.5) * 30;
      battle.props.push({
        kind: 'reeds',
        x: mx + nx * side * (bank + jitter), y: my + ny * side * (bank + jitter),
        s: 14 + fxRng() * 8, rot: (fxRng() - 0.5) * 2,
      });
    }
  }
}

// A loose patch of crop-row props near a settlement anchor, kept outside the house
// footprint (placeVillage's houses sit within ~190 of `cx,cy` — see its `at()` helper).
function scatterCrops(battle, cx, cy, fxRng) {
  const n = 7 + Math.floor(fxRng() * 4);
  for (let i = 0; i < n; i++) {
    const a = fxRng() * TAU, r = 220 + fxRng() * 160;
    battle.props.push({
      kind: 'crops', x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
      s: 10 + fxRng() * 4, rot: (fxRng() - 0.5) * 2,
    });
  }
}

// ---------------------------------------------------------------- Phase 4a: terrain speed
//
// Product of every zone whose shape contains (x, y), clamped to [0.55, 1.2] so no stack of
// overlapping zones (e.g. a ford inside a wood, which cannot currently happen but is not
// structurally forbidden) can push movement to a standstill or a sprint. Bbox-reject first:
// measured zone counts are 10-15 per brief-derived fight (plans/024's measurement table), so a
// linear scan is cheap and a spatial index would be pure overhead. Briefless template fights
// carry zero zones, so this loop is a single length check and returns 1 immediately.
export function terrainSpeedAt(battle, x, y) {
  const zones = battle.zones;
  if (zones.length === 0) return 1;
  let mul = 1;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (z.pts) {
      // Polyline strip (road). bbox is computed once, lazily, and cached on the zone object
      // itself — cheap because there are only ever one or two road strips per fight.
      if (z._minX === undefined) computeStripBBox(z);
      const half = z.width * 0.5;
      if (x < z._minX - half || x > z._maxX + half || y < z._minY - half || y > z._maxY + half) continue;
      if (distToPolyline(x, y, z.pts) <= half) mul *= z.mul;
    } else {
      // Circle (wood, scrub, ford).
      if (x < z.x - z.r || x > z.x + z.r || y < z.y - z.r || y > z.y + z.r) continue;
      if (dist2(x, y, z.x, z.y) <= z.r * z.r) mul *= z.mul;
    }
  }
  return clamp(mul, 0.55, 1.2);
}

function computeStripBBox(z) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [px, py] of z.pts) {
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  z._minX = minX; z._maxX = maxX; z._minY = minY; z._maxY = maxY;
}

function distToPolyline(x, y, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- Phase 4b: crossing waypoint
//
// If the straight line from (x, y) to (tx, ty) would cross a river, movement needs an
// intermediate goal (the nearest crossing) instead of walking straight into the river-obstacle
// chain and grinding along it (the pre-4b behaviour that made the riverside fight take ~2x as
// long as every other terrain type — plans/024's measurement table). Returns the shared
// `battle._crossingScratch` object, never a fresh allocation: the caller uses it synchronously
// as this tick's goal and never holds a reference past that.
export function crossingWaypoint(battle, x, y, tx, ty) {
  const segs = battle.riverSegs;
  if (segs.length === 0) return null; // most fights: no river at all, cheapest possible exit
  const crossings = battle.crossings;
  // Degenerate cases: the unit is already standing in a crossing, or its target is — a unit
  // wading a ford or crossing a bridge should resume steering at its real goal, not loop back
  // onto the crossing centre it is already occupying (or about to arrive at anyway).
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i];
    if (dist2(x, y, c.x, c.y) < c.w * c.w) return null;
    if (dist2(tx, ty, c.x, c.y) < c.w * c.w) return null;
  }
  const minX = Math.min(x, tx), maxX = Math.max(x, tx);
  const minY = Math.min(y, ty), maxY = Math.max(y, ty);
  let crosses = false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (maxX < s[4] || minX > s[5] || maxY < s[6] || minY > s[7]) continue;
    if (segmentsIntersect(x, y, tx, ty, s[0], s[1], s[2], s[3])) { crosses = true; break; }
  }
  if (!crosses) return null; // same side already, or the goal never actually reaches the bank
  let best = null, bestD2 = Infinity;
  for (let i = 0; i < crossings.length; i++) {
    const c = crossings[i];
    const d2 = dist2(x, y, c.x, c.y);
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  if (best === null) return null; // no crossings but riverSegs present should not happen; guard anyway
  battle._crossingScratch.x = best.x;
  battle._crossingScratch.y = best.y;
  return battle._crossingScratch;
}

function ccw(ax, ay, bx, by, cx, cy) {
  return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = ccw(cx, cy, dx, dy, ax, ay), d2 = ccw(cx, cy, dx, dy, bx, by);
  const d3 = ccw(ax, ay, bx, by, cx, cy), d4 = ccw(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ---------------------------------------------------------------- Phase 5: line of sight
//
// Segment-vs-circle test against `battle.blockers` — hills, woods at 0.8x radius, and
// village houses only (buildFromBrief/placeVillage above); rocks and scrub never push a
// blocker, per Phase 3's mapping rules. Bbox-reject each blocker against the sight line's own
// bounding box before the real distance-to-segment test: measured blocker counts are 9-14 per
// brief-derived fight (plans/024's measurement table), so a linear scan is cheap, but this
// runs once per ranged unit's target-visibility check per tick, so the cheap reject matters.
// Briefless template fights carry zero blockers, so this is a single length check returning
// `true` immediately — the three visual baselines (battle_small/big/bridge) never call the
// real loop. Boolean result, no allocation: there is nothing to hand back to the caller.
export function hasLineOfSight(battle, sx, sy, tx, ty) {
  const blockers = battle.blockers;
  if (blockers.length === 0) return true;
  const minX = Math.min(sx, tx), maxX = Math.max(sx, tx);
  const minY = Math.min(sy, ty), maxY = Math.max(sy, ty);
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    if (maxX < b.x - b.r || minX > b.x + b.r || maxY < b.y - b.r || minY > b.y + b.r) continue;
    if (distToSegment(b.x, b.y, sx, sy, tx, ty) < b.r) return false;
  }
  return true;
}

// ---------------------------------------------------------------- shared helpers

function clampToField(pt, W, H, margin = 220) {
  return {
    x: Math.min(W - margin, Math.max(margin, pt.x)),
    y: Math.min(H - margin, Math.max(margin, pt.y)),
  };
}

// Camp/village clusters are authored once, in a local frame (`fwd` = the approach axis,
// `side` = perpendicular to it), then placed at whatever anchor the caller picked. This is
// what lets the exact same layout code serve a Brief-supplied real-world position (Phase 3's
// job) and the briefless template's re-centred fallback position (still required — see the
// module doc comment) without duplicating the cluster shape.
function placeCamp(battle, cx, cy, fwd, side, rng, fxRng) {
  const at = (dCoef, sCoef, d = 1) => ({
    x: cx + fwd.x * dCoef * 140 * d + side.x * sCoef * 140 * d,
    y: cy + fwd.y * dCoef * 140 * d + side.y * sCoef * 140 * d,
  });
  const tentSpots = [[-0.4, -0.9], [0.15, 0], [-0.25, 0.9]];
  for (const [dCoef, sCoef] of tentSpots) {
    const p = at(dCoef, sCoef);
    const s = 28 + rng() * 8;
    battle.props.push({ kind: 'tent', x: p.x, y: p.y, s });
    battle.obstacles.push({ kind: 'none', x: p.x, y: p.y, r: s * 0.9 });
  }
  battle.props.push({ kind: 'fire', x: cx, y: cy, s: 10 });
  for (let i = 0; i < 6; i++) {
    const p = at(-1.15, -0.75 + i * 0.3);
    battle.props.push({ kind: 'stake', x: p.x, y: p.y, s: 10 });
  }
  // palisade run BEHIND the tents (further from the fight along `fwd`), jittered per
  // plank so it reads hand-placed. Real colliders now — it never blocked before — with a
  // gate gap so the camp is not a sealed box the player's own troops cannot route through.
  const GATE_INDEX = 3;
  for (let i = 0; i < 7; i++) {
    const base = at(1.6, -0.9 + i * 0.3);
    const px = base.x + (fxRng() - 0.5) * 14, py = base.y + (fxRng() - 0.5) * 14;
    battle.props.push({ kind: 'plank', x: px, y: py, s: 11 + fxRng() * 5 });
    if (i === GATE_INDEX) continue; // the gate: no collider here
    battle.obstacles.push({ kind: 'none', x: px, y: py, r: 13 });
  }
}

function placeVillage(battle, cx, cy, fwd, side) {
  const at = (dCoef, sCoef) => ({
    x: cx + fwd.x * dCoef * 190 + side.x * sCoef * 190,
    y: cy + fwd.y * dCoef * 190 + side.y * sCoef * 190,
  });
  const houseSpots = [[-0.3, -0.9, 56, 40], [-0.75, -0.25, 46, 34], [-0.1, 0.9, 50, 36]];
  for (const [dCoef, sCoef, w, hh] of houseSpots) {
    const p = at(dCoef, sCoef);
    battle.props.push({ kind: 'house', x: p.x, y: p.y, w, h: hh });
    battle.obstacles.push({ kind: 'none', x: p.x, y: p.y - 10, r: w * 0.6 });
    battle.blockers.push({ x: p.x, y: p.y - hh * 0.4, r: w * 0.6 });
  }
  const mill = at(-0.95, -0.85);
  battle.props.push({ kind: 'mill', x: mill.x, y: mill.y, s: 30 });
}

// Where the fallback camp goes when there is no Brief camp position (briefless templates,
// and the rare edge case of a Brief with no nearby camp but an explicit arena:'camp'): a bit
// beyond the enemy line along the approach axis. ENGAGE_GAP-relative, not a raw W fraction,
// so it lands near the actual fight regardless of field size — this is the fix for the
// "stranded camp" bug (plans/024's "Known transient, resolved in Phase 3" note): the old
// 0.72-0.94*W fractions put it ~1800px from a fight that happens in the middle of a
// 2500-wide field.
function fallbackCampAnchor(battle, fwd) {
  const cx0 = battle.W / 2, cy0 = battle.H / 2;
  const ecx = cx0 + battle.adx * ENGAGE_GAP / 2, ecy = cy0 + battle.ady * ENGAGE_GAP / 2;
  return clampToField({ x: ecx + fwd.x * ENGAGE_GAP * 0.4, y: ecy + fwd.y * ENGAGE_GAP * 0.4 }, battle.W, battle.H);
}

// Same idea for the village: to one side of where the hero actually rides in, not a fixed
// west-side W fraction that happened to land near the old, smaller field's hero spawn.
function fallbackVillageAnchor(battle, fwd, side) {
  const h = battle.hero;
  return clampToField({
    x: h.x - fwd.x * ENGAGE_GAP * 0.15 + side.x * ENGAGE_GAP * 0.45,
    y: h.y - fwd.y * ENGAGE_GAP * 0.15 + side.y * ENGAGE_GAP * 0.45,
  }, battle.W, battle.H);
}

// ---------------------------------------------------------------- briefless (template) path

function buildFromTemplate(battle, terrainRng, fxRng) {
  const W = battle.W, H = battle.H;
  const fwd = { x: battle.adx, y: battle.ady }, side = { x: -battle.ady, y: battle.adx };

  if (battle.arena === 'camp') {
    const anchor = fallbackCampAnchor(battle, fwd);
    placeCamp(battle, anchor.x, anchor.y, fwd, side, terrainRng, fxRng);
  } else if (battle.arena === 'village') {
    const anchor = fallbackVillageAnchor(battle, fwd, side);
    placeVillage(battle, anchor.x, anchor.y, fwd, side);
    scatterCrops(battle, anchor.x, anchor.y, fxRng);
  } else if (battle.arena === 'bridge') {
    // Legacy chokepoint arena: no Brief river to build a real one from, so this keeps the
    // exact behaviour Phase 4c's tangent-steering fix was measured against (plans/024's
    // "Where this deviates" section: 22.7% stalled, 22.6s, victory).
    battle.props.push({ kind: 'river' });
    const bx = W * 0.52, by = H * 0.5;
    battle.bridge = { x: bx, y: by, w: 120, h: 96 };
    for (let y = -40; y < H + 40; y += 44) {
      if (Math.abs(y - by) < battle.bridge.h / 2 + 20) continue; // gap at the bridge
      battle.obstacles.push({ kind: 'none', x: bx, y, r: 42 });
    }
  } else {
    // road: a cream dashed track through the middle
    battle.props.push({ kind: 'road' });
    battle.props.push({ kind: 'stone', x: W * 0.42, y: H * 0.44, s: 8 });
    battle.props.push({ kind: 'stone', x: W * 0.6, y: H * 0.62, s: 7 });
    for (let i = 0; i < 5; i++) battle.props.push({ kind: 'plank', x: W * (0.30 + i * 0.045), y: H * 0.30, s: 9 });
    battle.props.push({ kind: 'stone', x: W * 0.25, y: H * 0.52, s: 10 });
  }
}

// ---------------------------------------------------------------- Brief-derived path

function toSegments(pointLists) {
  // Same 8-field encoding as world.riverSegs (src/world/terrain.js linesToSegments): local,
  // not imported — the battle scene must never import world.js or its siblings, only the
  // Brief `sampleBattlefield()` produces (AGENTS.md).
  const segs = [];
  for (const pts of pointLists) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      segs.push([ax, ay, bx, by, Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)]);
    }
  }
  return segs;
}

// Unit tangent of whichever river polyline passes nearest (x, y), used to orient the
// ford/bridge prop across the actual flow direction instead of assuming a fixed axis.
function riverTangentAt(pointLists, x, y) {
  let best = Infinity, tx = 1, ty = 0;
  for (const pts of pointLists) {
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      let t = ((x - ax) * dx + (y - ay) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, py = ay + dy * t;
      const d2 = (px - x) * (px - x) + (py - y) * (py - y);
      if (d2 < best) {
        best = d2;
        const L = Math.hypot(dx, dy) || 1;
        tx = dx / L; ty = dy / L;
      }
    }
  }
  return { x: tx, y: ty };
}

// A chain of `kind:'none'` obstacle circles along the river polyline (r = half the visible
// channel width, stepped at r*0.9 so consecutive circles overlap into a solid wall), skipping
// any circle within `crossing.w` of a crossing so the crossing stays genuinely passable.
// This generalises the old fixed bridge-wall (battle.js, pre-Phase-3) to a real sampled curve.
function buildRiverChain(battle, pts, r, crossings) {
  const step = r * 0.9;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(segLen / step));
    for (let j = (i > 1 ? 1 : 0); j <= n; j++) {
      const t = j / n;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (crossings.some(c => dist2(x, y, c.x, c.y) < c.w * c.w)) continue;
      battle.obstacles.push({ kind: 'none', x, y, r });
    }
  }
}

function buildFromBrief(battle, field, terrainRng, fxRng) {
  const fwd = { x: battle.adx, y: battle.ady }, side = { x: -battle.ady, y: battle.adx };
  const riverPtLists = field.rivers.map(r => r.pts);

  // ---- Rivers + crossings --------------------------------------------------------------
  for (const river of field.rivers) {
    buildRiverChain(battle, river.pts, river.width * 0.5, field.crossings);
    battle.props.push({ kind: 'riverPoly', pts: river.pts, width: river.width });
    scatterReeds(battle, river.pts, river.width, fxRng);
  }
  battle.riverSegs = toSegments(riverPtLists);
  for (const c of field.crossings) {
    battle.crossings.push({ x: c.x, y: c.y, w: c.w, kind: c.kind });
    const t = riverTangentAt(riverPtLists, c.x, c.y);
    battle.props.push({ kind: c.kind === 'bridge' ? 'bridgeSpan' : 'ford', x: c.x, y: c.y, w: c.w, tx: t.x, ty: t.y });
    if (c.kind === 'ford') {
      // Wading a ford costs speed; a built bridge does not.
      battle.zones.push({ kind: 'ford', x: c.x, y: c.y, r: c.w * 0.55, mul: FORD_SPEED });
    }
  }

  // ---- Roads ------------------------------------------------------------------------------
  for (const road of field.roads) {
    battle.zones.push({ kind: 'road', pts: road.pts, width: road.width, mul: ROAD_SPEED });
    battle.props.push({ kind: 'roadPoly', pts: road.pts, width: road.width });
  }

  // ---- Hills: obstacle + blocker, same circle --------------------------------------------
  //
  // Corridor safety cap (Plan 024 corrective pass). Unlike a rock's size, a hill's size is
  // legitimate landform variety (`mtn -> r = s*0.72*S` reaches 288 at s=100) and stays
  // uncapped everywhere it does not interfere with pathing — the "wooded highland" and "deep
  // country" fixtures both carry hills up to r~266 with no ill effect (plans/024's
  // measurement table). The failure is specifically a large circle sitting on the straight
  // corridor between the two forces: with a synthetic hill on that corridor, r<=195 always
  // resolved (25-64s) but r>=200 never resolved inside a 120s cap, dead centre AND offset —
  // tangent steering (LOOKAHEAD=170) cannot route two whole armies around a circle that wide
  // relative to the corridor. The exact boundary was not perfectly monotonic under lateral
  // offset (r=200 stalled, r=220 didn't, in one probe), so the corridor half-width below is
  // kept generous and the capped radius (150) is kept well clear of the 195/200 boundary
  // rather than tuned to it.
  const enemyCx = battle.W / 2 + battle.adx * ENGAGE_GAP / 2, enemyCy = battle.H / 2 + battle.ady * ENGAGE_GAP / 2;
  for (const h of field.hills) {
    let r = h.r;
    const dCorridor = distToSegment(h.x, h.y, battle.hero.x, battle.hero.y, enemyCx, enemyCy);
    if (dCorridor - r < HILL_CORRIDOR_MARGIN) r = Math.min(r, HILL_SAFE_R);
    battle.obstacles.push({ kind: 'hill', x: h.x, y: h.y, r });
    battle.blockers.push({ x: h.x, y: h.y, r });
  }

  // ---- Woods: zone + blocker (0.8x radius) + 4-8 tree props, only the 2 largest collide --
  for (const w of field.woods) {
    battle.zones.push({ kind: 'wood', x: w.x, y: w.y, r: w.r, mul: WOOD_SPEED });
    battle.blockers.push({ x: w.x, y: w.y, r: w.r * 0.8 });
    const n = 4 + Math.floor(terrainRng() * 5); // 4-8
    const trees = [];
    for (let i = 0; i < n; i++) {
      const a = terrainRng() * TAU, rr = terrainRng() * w.r * 0.8;
      trees.push({
        x: w.x + Math.cos(a) * rr, y: w.y + Math.sin(a) * rr,
        r: w.r * (0.28 + terrainRng() * 0.22),
      });
    }
    trees.sort((a, b) => b.r - a.r);
    trees.forEach((t, i) => {
      if (i < 2) battle.obstacles.push({ kind: 'tree', x: t.x, y: t.y, r: Math.min(t.r, TREE_COLLIDER_CAP), rot: fxRng() * TAU });
      else battle.props.push({ kind: 'tree', x: t.x, y: t.y, r: t.r });
    });
  }

  // ---- Rocks: obstacle only, no blocker (a boulder is not arrow cover here) --------------
  for (const rk of field.rocks) {
    battle.obstacles.push({ kind: 'rock', x: rk.x, y: rk.y, r: rk.r, rot: rk.rot || 0 });
  }

  // ---- Scrub: zone + prop, no obstacle, no blocker ---------------------------------------
  for (const sc of field.scrub) {
    battle.zones.push({ kind: 'scrub', x: sc.x, y: sc.y, r: sc.r, mul: SCRUB_SPEED });
    battle.props.push({ kind: 'scrub', x: sc.x, y: sc.y, r: sc.r });
  }

  // ---- Settlement: village houses/mill around the brief's real position ------------------
  if (field.settlement) {
    placeVillage(battle, field.settlement.x, field.settlement.y, fwd, side);
    scatterCrops(battle, field.settlement.x, field.settlement.y, fxRng);
  }

  // ---- Camp: the brief's real position, or the fallback if arena:'camp' names one anyway -
  if (field.camp || battle.arena === 'camp') {
    const pos = field.camp || fallbackCampAnchor(battle, fwd);
    placeCamp(battle, pos.x, pos.y, fwd, side, terrainRng, fxRng);
  }
}
