// Campaign-map geometry: the canonical road/river curves, the sampled segment lists every
// collision query reads, the baked static Path2D layer, procedural scenery placement, and
// the navigation-graph goal search.
//
// AGENTS.md pins the single-source rule: a new curve is added HERE, in buildTerrainGeometry,
// so the rendered shape and the sampled polylines used for collision can never disagree.
// The cheap per-tick predicates that read this geometry (blockedAt, onRoad, riverBlockedAt,
// inSafeZone, visible, moveBlocked, riverDistanceAt) stay on World: they run for every unit
// every frame, and they are one-liners that would cost more in delegation than they weigh.
import { WORLD } from '../data.js?v=r06a7e18cad00';
import { TAU, dist2, distToSegment, makeRng } from '../engine.js?v=r06a7e18cad00';

// Build the only terrain representation used by draw(), collision and movement bonuses.
// A maximum chord length keeps the polyline's geometric error well below the 28px road
// bonus and 22px river collision bands while keeping construction outside hot paths.
export function buildTerrainGeometry(world) {
  const sampleQuadratic = (a, control, b, maxStep = 24) => {
    const approx = Math.hypot(control[0] - a[0], control[1] - a[1]) +
      Math.hypot(b[0] - control[0], b[1] - control[1]);
    const n = Math.max(2, Math.ceil(approx / maxStep));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([
        u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
      ]);
    }
    return out;
  };
  const join = (pieces) => pieces.reduce((all, piece, i) => all.concat(i ? piece.slice(1) : piece), []);

  // Roads intentionally match the four paths rendered below. The former [0, 3] chord was
  // never drawn and therefore granted an invisible movement bonus; it is intentionally gone.
  const S = WORLD.settlements;
  const roadDefs = [
    [S[0], S[1], 60, 40], [S[0], S[2], 60, 40],
    [S[1], S[3], -60, 40], [S[2], S[3], -60, 40],
  ];
  const roads = roadDefs.map(([a, b, ox, oy]) => sampleQuadratic(
    [a.x, a.y], [(a.x + b.x) / 2 + (a.y < b.y ? ox : -ox), (a.y + b.y) / 2 + oy], [b.x, b.y]
  ));

  // Each river anchor is a control point. Consecutive quadratic pieces end at the midpoint
  // between controls, and the final piece explicitly reaches the final anchor. This keeps
  // the existing hand-authored course while making both map-edge endpoints canonical.
  // Each piece must START where the previous one actually ended (a midpoint) — starting
  // it back at the raw anchor instead double-backs the curve at every interior point.
  const rivers = world.rivers.map(r => {
    const pts = r.pts;
    const pieces = [];
    let start = pts[0];
    for (let i = 0; i < pts.length - 2; i++) {
      const end = [(pts[i + 1][0] + pts[i + 2][0]) / 2, (pts[i + 1][1] + pts[i + 2][1]) / 2];
      pieces.push(sampleQuadratic(start, pts[i + 1], end));
      start = end;
    }
    const last = pts.length - 1;
    pieces.push(sampleQuadratic(start, pts[last], pts[last]));
    return join(pieces);
  });
  return { roads, rivers };
}

export function linesToSegments(world, lines) {
  const segments = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      segments.push([a[0], a[1], b[0], b[1], Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
    }
  }
  return segments;
}

export function buildStaticPaths(world) {
  const paths = { blotches: new Path2D(), light: new Path2D(), shade: new Path2D(), roads: new Path2D(), rivers: [] };
  for (const b of world.blotches) {
    paths.blotches.moveTo(b[0][0], b[0][1]);
    for (const pt of b) paths.blotches.lineTo(pt[0], pt[1]);
    paths.blotches.closePath();
  }
  paths.light.moveTo(world.W * 0.10, -40); paths.light.lineTo(world.W * 0.45, -40);
  paths.light.lineTo(world.W * 0.90, world.H + 40); paths.light.lineTo(world.W * 0.55, world.H + 40); paths.light.closePath();
  paths.shade.moveTo(world.W + 40, -40); paths.shade.lineTo(world.W - 900, -40); paths.shade.lineTo(world.W + 40, 800); paths.shade.closePath();
  paths.shade.moveTo(-40, world.H + 40); paths.shade.lineTo(900, world.H + 40); paths.shade.lineTo(-40, world.H - 800); paths.shade.closePath();
  for (const line of world.roadLines) {
    paths.roads.moveTo(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) paths.roads.lineTo(line[i][0], line[i][1]);
  }
  for (const line of world.riverLines) {
    const path = new Path2D();
    path.moveTo(line[0][0], line[0][1]);
    for (let i = 1; i < line.length; i++) path.lineTo(line[i][0], line[i][1]);
    paths.rivers.push(path);
  }
  return paths;
}

export function buildScenery(world) {
  const R = makeRng(1234);
  const items = [];
  // two rivers crossing the map, with bridge points (visual landmarks)
  world.rivers = [
    { pts: [[950, -40], [900, 400], [1050, 900], [980, 1400], [1120, 1900], [1060, 2240]], bridges: [[985, 640], [1055, 1655]] },
    { pts: [[2450, -40], [2380, 500], [2500, 1000], [2350, 1500], [2450, 2240]], bridges: [[2437, 745]] },
  ];
  // scattered ground blotches so the ride reads as terrain, not void
  world.blotches = [];
  for (let i = 0; i < 45; i++) {
    const cx = R() * world.W, cy = R() * world.H, s = 20 + R() * 70;
    const pts = [];
    const n = 5 + (R() * 3 | 0);
    for (let j = 0; j < n; j++) {
      const a = j / n * TAU;
      pts.push([cx + Math.cos(a) * s * (0.6 + R() * 0.6), cy + Math.sin(a) * s * (0.4 + R() * 0.45)]);
    }
    world.blotches.push(pts);
  }
  // A ridge/forest origin can pass this check while its individual pieces (offset up to
  // ~250px away below) still drift onto the river — see the per-piece recheck in each loop.
  const clearOf = (x, y, r) => {
    for (const s of WORLD.settlements) if (dist2(x, y, s.x, s.y) < (r + 130) ** 2) return false;
    for (const c of WORLD.camps) if (dist2(x, y, c.x, c.y) < (r + 130) ** 2) return false;
    for (const riv of world.rivers) {
      const pts = riv.pts;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < r + 40) return false;
      }
    }
    return true;
  };
  // mountain ridges
  for (let i = 0; i < 26; i++) {
    const x = 100 + R() * (world.W - 200), y = 100 + R() * (world.H - 200);
    if (!clearOf(x, y, 80)) continue;
    const n = 2 + (R() * 3 | 0);
    for (let j = 0; j < n; j++) {
      const mx = x + j * 70 * (R() < 0.5 ? 1 : -1) + R() * 40, my = y + (R() - 0.5) * 60;
      if (!clearOf(mx, my, 60)) continue;
      items.push({ kind: 'mtn', x: mx, y: my, s: 45 + R() * 55, z: 2 });
    }
  }
  // forests
  for (let i = 0; i < 40; i++) {
    const x = 80 + R() * (world.W - 160), y = 80 + R() * (world.H - 160);
    if (!clearOf(x, y, 40)) continue;
    const n = 2 + (R() * 4 | 0);
    for (let j = 0; j < n; j++) {
      const tx = x + (R() - 0.5) * 110, ty = y + (R() - 0.5) * 90;
      if (!clearOf(tx, ty, 20)) continue;
      items.push({ kind: 'tree', x: tx, y: ty, s: 14 + R() * 12, z: 1 });
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = 80 + R() * (world.W - 160), y = 80 + R() * (world.H - 160);
    if (!clearOf(x, y, 30)) continue;
    items.push({ kind: 'rock', x, y, s: 14 + R() * 16, rot: R() * TAU, z: 1 });
  }
  // shrub clumps fill the empty midground between the big scenery pieces
  for (let i = 0; i < 55; i++) {
    const x = 60 + R() * (world.W - 120), y = 60 + R() * (world.H - 120);
    if (!clearOf(x, y, 20)) continue;
    items.push({ kind: 'shrub', x, y, s: 7 + R() * 6, z: 0 });
  }
  items.sort((a, b) => a.y - b.y);
  return items;
}

// straight line traversable? finely sampled with a conservative margin over the OPEN
// corridor — endpoints are excluded (they are positions entities legally occupy, which
// may sit inside the planner's padded margin), and exclusion makes visibility symmetric:
// lineClear(A,B) === lineClear(B,A) by construction
export function lineClear(world, x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.max(1, Math.ceil(d / 14));
  for (let i = 1; i <= n - 1; i++) {
    if (world.blockedAtPad(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, 8)) return false;
  }
  return true;
}

// next waypoint toward `goal` from (x,y): direct if visible, else Dijkstra over the nav graph
export function pathGoal(world, x, y, goal, party = null) {
  if (world.lineClear(x, y, goal.x, goal.y)) return goal;
  const N = world.navNodes.length;
  const scratch = world._navScratch;
  const start = scratch.start;
  const toGoal = party ? party._navGoalVisibility : scratch.toGoal;
  const goalChanged = !party || !Number.isFinite(party._navGoalX) ||
    Math.hypot(party._navGoalX - goal.x, party._navGoalY - goal.y) > 140;
  if (goalChanged) {
    for (let i = 0; i < N; i++) {
      toGoal[i] = world.lineClear(world.navNodes[i].x, world.navNodes[i].y, goal.x, goal.y)
        ? Math.hypot(goal.x - world.navNodes[i].x, goal.y - world.navNodes[i].y) : Infinity;
    }
    if (party) { party._navGoalX = goal.x; party._navGoalY = goal.y; }
  }
  for (let i = 0; i < N; i++) {
    start[i] = world.lineClear(x, y, world.navNodes[i].x, world.navNodes[i].y)
      ? Math.hypot(x - world.navNodes[i].x, y - world.navNodes[i].y) : Infinity;
  }
  // Dijkstra from the virtual start over ≤9 nodes
  const dist = scratch.dist, first = scratch.first, done = scratch.done;
  for (let i = 0; i < N; i++) { dist[i] = start[i]; first[i] = start[i] < Infinity ? i : -1; done[i] = 0; }
  for (let iter = 0; iter < N; iter++) {
    let u = -1, ud = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = 1;
    for (const [v, w] of world.navEdges[u]) {
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; first[v] = first[u]; }
    }
  }
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (dist[i] + toGoal[i] < bd) { bd = dist[i] + toGoal[i]; best = i; }
  }
  return best >= 0 ? world.navNodes[first[best]] : null;
}
