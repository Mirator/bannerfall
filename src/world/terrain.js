// Campaign-map geometry: the canonical road/river curves, the sampled segment lists every
// collision query reads, the baked static Path2D layer, procedural scenery placement, and
// the navigation-graph goal search.
//
// AGENTS.md pins the single-source rule: a new curve is added HERE, in buildTerrainGeometry,
// so the rendered shape and the sampled polylines used for collision can never disagree.
// The cheap per-tick predicates that read this geometry (blockedAt, onRoad, riverBlockedAt,
// inSafeZone, visible, moveBlocked, riverDistanceAt) stay on World: they run for every unit
// every frame, and they are one-liners that would cost more in delegation than they weigh.
import { WORLD } from '../data.js?v=r795695426ca8';
import { TAU, dist2, distToSegment, makeRng } from '../engine.js?v=r795695426ca8';
import { WORLD_ART, worldRegionAt } from './visual-style.js?v=r795695426ca8';

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
  const sampleCubic = (a, c1, c2, b, maxStep = 24) => {
    const approx = Math.hypot(c1[0] - a[0], c1[1] - a[1]) +
      Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) +
      Math.hypot(b[0] - c2[0], b[1] - c2[1]);
    const n = Math.max(3, Math.ceil(approx / maxStep));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([
        u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0],
        u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1],
      ]);
    }
    return out;
  };
  const join = (pieces) => pieces.reduce((all, piece, i) => all.concat(i ? piece.slice(1) : piece), []);

  // Roads intentionally match the four paths rendered below. The former [0, 3] chord was
  // never drawn and therefore granted an invisible movement bonus; it is intentionally gone.
  const S = WORLD.settlements;
  // Catmull-Rom-derived cubics pass through every authored waypoint. Bridge-adjacent
  // waypoints share almost the same Y so the road meets each north/south river at a
  // believable near-perpendicular angle instead of slicing diagonally across the deck.
  const roadRoute = points => {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)], p1 = points[i];
      const p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      const piece = sampleCubic(p1, c1, c2, p2, 18);
      out.push(...(i ? piece.slice(1) : piece));
    }
    return out;
  };
  const P = p => Array.isArray(p) ? p : [p.x, p.y];
  const stronghold = WORLD.camps.find(c => c.id === 'strong');
  const roadDefinitions = [
    // Ashford → Brindle: a minor farm road sweeps around the western ridge before
    // flattening into the southern bridge.
    { kind: 'minor', from: 'village', to: 'village', points: [P(S[0]), [640, 1280], [700, 1430], [850, 1580], [960, 1645], [1055, 1655], [1165, 1662], [1325, 1718], P(S[1])] },
    // Ashford → Coldwell: a secondary trade road follows the valley and meets the
    // northern bridge almost horizontally.
    { kind: 'secondary', from: 'village', to: 'major', points: [P(S[0]), [650, 1040], [690, 900], [800, 775], [895, 660], [985, 640], [1080, 635], [1215, 600], P(S[2])] },
    // Brindle and Coldwell merge at a geographic junction south-west of Highmere.
    // `renderEndAt` prevents the secondary branch from overdrawing the shared trunk;
    // gameplay still samples the complete canonical route to the landmark.
    { kind: 'secondary', from: 'village', to: 'major', renderEndAt: [1870, 1230], points: [P(S[1]), [1580, 1620], [1695, 1505], [1750, 1370], [1810, 1280], [1870, 1230], [1950, 1195], P(S[3])] },
    // The principal Coldwell road wraps below the western foothill, absorbs the Brindle
    // lane at the junction, and supplies the single shared town approach.
    { kind: 'major', from: 'major', to: 'major', points: [P(S[2]), [1475, 615], [1570, 735], [1640, 900], [1690, 1060], [1760, 1170], [1870, 1230], [1950, 1195], P(S[3])] },
    // Highmere → Wolfsjaw arcs north-east, straightening only for the bridge deck.
    { kind: 'major', from: 'major', to: 'major', points: [P(S[3]), [2160, 1140], [2300, 1130], [2380, 1040], [2410, 900], [2380, 760], [2437, 745], [2545, 742], [2650, 715], [2715, 655], P(stronghold)] },
  ];
  const roads = roadDefinitions.map(def => roadRoute(def.points));

  // Rivers use the same long cubic spline principle as roads, but their authored anchors
  // are fewer and intentionally asymmetric. Every bridge is an anchor, keeping crossing
  // geometry exact while avoiding a repetitive sinusoidal course.
  const rivers = world.rivers.map(r => roadRoute(r.pts));
  const interpolateKeys = (keys, t) => {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1];
    const raw = Math.max(0, Math.min(1, (t - a[0]) / Math.max(0.0001, b[0] - a[0])));
    const u = raw * raw * (3 - 2 * raw);
    return a[1] + (b[1] - a[1]) * u;
  };
  const riverProfiles = rivers.map((line, riverIndex) => {
    const def = world.rivers[riverIndex];
    const arc = new Float64Array(line.length);
    for (let i = 1; i < line.length; i++) {
      arc[i] = arc[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    const bridgeArcs = def.bridges.map(([bx, by]) => {
      let best = 0, bestD = Infinity;
      line.forEach((p, i) => {
        const d = Math.hypot(p[0] - bx, p[1] - by);
        if (d < bestD) { best = i; bestD = d; }
      });
      return arc[best];
    });
    const profiles = line.map((_, i) => {
      const t = arc[i] / arc.at(-1);
      let ratio = interpolateKeys(def.widthKeys, t);
      let bias = interpolateKeys(def.biasKeys, t);
      for (const bridgeArc of bridgeArcs) {
        const d = Math.abs(arc[i] - bridgeArc);
        if (d < WORLD_ART.rivers.transitionLength) {
          const raw = d / WORLD_ART.rivers.transitionLength;
          const u = raw * raw * (3 - 2 * raw);
          ratio += (0.8 - ratio) * (1 - u);
          bias *= u;
        }
      }
      ratio = Math.max(WORLD_ART.rivers.minRatio, Math.min(WORLD_ART.rivers.maxRatio, ratio));
      const width = def.normalWidth * ratio;
      return {
        width, bias,
        left: width * (0.5 + bias),
        right: width * (0.5 - bias),
      };
    });
    return { profiles, arc: Array.from(arc), length: arc.at(-1) };
  });
  return { roads, rivers, roadDefinitions, riverProfiles };
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
  const paths = {
    regions: [], transitions: [], riparian: [], forestFloors: new Path2D(), deadGround: new Path2D(),
    roads: [], rivers: [], sandBanks: [], shallows: [], islands: [],
    fields: new Path2D(), fieldFurrows: new Path2D(),
  };
  for (const region of world.terrainRegions) {
    const path = new Path2D();
    path.moveTo(region.points[0][0], region.points[0][1]);
    for (let i = 1; i < region.points.length; i++) {
      const pt = region.points[i];
      path.lineTo(pt[0], pt[1]);
    }
    path.closePath();
    paths.regions.push({ id: region.id, path });
  }
  for (const points of world.terrainTransitions) {
    const path = new Path2D();
    path.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const mid = [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2];
      path.quadraticCurveTo(points[i][0], points[i][1], mid[0], mid[1]);
    }
    path.lineTo(points.at(-1)[0], points.at(-1)[1]);
    paths.transitions.push(path);
  }
  const forestGroups = new Map();
  for (const it of world.scenery) if (it.family === 'forest') {
    let group = forestGroups.get(it.clusterId);
    if (!group) forestGroups.set(it.clusterId, group = []);
    group.push(it);
  }
  for (const group of forestGroups.values()) {
    const minX = Math.min(...group.map(it => it.x - it.s * 1.8));
    const maxX = Math.max(...group.map(it => it.x + it.s * 1.8));
    const minY = Math.min(...group.map(it => it.y - it.s * 1.2));
    const maxY = Math.max(...group.map(it => it.y + it.s * 1.2));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const rx = Math.max(34, (maxX - minX) / 2), ry = Math.max(24, (maxY - minY) / 2);
    // `ellipse()` continues the current subpath; without this move every forest floor
    // was joined to the previous one by a long chord, producing giant filled wedges.
    paths.forestFloors.moveTo(cx + rx, cy);
    paths.forestFloors.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  }
  for (const camp of WORLD.camps) {
    const rx = camp.stronghold ? 150 : 92, ry = camp.stronghold ? 86 : 58;
    paths.deadGround.moveTo(camp.x + rx, camp.y + 8);
    paths.deadGround.ellipse(camp.x, camp.y + 8, rx, ry, 0, 0, TAU);
  }
  for (const it of world.scenery) if (it.kind === 'field') {
    const tr = (x, y) => [
      it.x + x * Math.cos(it.rot) - y * Math.sin(it.rot),
      it.y + x * Math.sin(it.rot) + y * Math.cos(it.rot),
    ];
    const corners = [tr(-it.w / 2, -it.h / 2), tr(it.w / 2, -it.h / 2), tr(it.w / 2, it.h / 2), tr(-it.w / 2, it.h / 2)];
    paths.fields.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) paths.fields.lineTo(corners[i][0], corners[i][1]);
    paths.fields.closePath();
    for (let y = -it.h / 2 + 14; y < it.h / 2; y += 14) {
      const a = tr(-it.w / 2 + 12, y), b = tr(it.w / 2 - 12, y);
      paths.fieldFurrows.moveTo(a[0], a[1]); paths.fieldFurrows.lineTo(b[0], b[1]);
    }
  }
  for (let roadIndex = 0; roadIndex < world.roadLines.length; roadIndex++) {
    const line = world.roadLines[roadIndex];
    const definition = world.terrain.roadDefinitions[roadIndex];
    const renderEnd = definition.renderEndAt
      ? line.reduce((best, p, i) => Math.hypot(p[0] - definition.renderEndAt[0], p[1] - definition.renderEndAt[1]) < best.d ? { i, d: Math.hypot(p[0] - definition.renderEndAt[0], p[1] - definition.renderEndAt[1]) } : best, { i: line.length - 1, d: Infinity }).i
      : line.length - 1;
    const chunkPoints = Math.max(2, Math.round(WORLD_ART.roads.sectionLength / 18));
    const sections = [];
    for (let start = 0; start < renderEnd; start += chunkPoints) {
      // Overlap one sampled segment so changing widths meet without exposing the
      // shoulder at a sharp butt-cap corner.
      const from = Math.max(0, start - 1);
      const to = Math.min(renderEnd, start + chunkPoints);
      const path = new Path2D(); path.moveTo(line[from][0], line[from][1]);
      for (let i = from + 1; i <= to; i++) path.lineTo(line[i][0], line[i][1]);
      const t = (from + to) / 2 / (line.length - 1);
      const base = WORLD_ART.roads.widths[definition.kind];
      const fromW = WORLD_ART.roads.endpoints[definition.from], toW = WORLD_ART.roads.endpoints[definition.to];
      const fromInfluence = Math.max(0, 1 - t / 0.22) ** 2;
      const toInfluence = Math.max(0, 1 - (1 - t) / 0.22) ** 2;
      const width = base + (fromW - base) * fromInfluence + (toW - base) * toInfluence;
      const mid = line[Math.round((from + to) / 2)];
      sections.push({ path, width, x: mid[0], y: mid[1] });
    }
    paths.roads.push({ sections, ...definition });
  }
  const polygonPath = (left, right) => {
    const path = new Path2D(); path.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) path.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
    path.closePath(); return path;
  };
  for (let ri = 0; ri < world.riverLines.length; ri++) {
    const line = world.riverLines[ri], profile = world.terrain.riverProfiles[ri].profiles;
    const normals = line.map((p, i) => {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
      return [-dy / length, dx / length];
    });
    const boundaries = extra => ({
      left: line.map((p, i) => [p[0] + normals[i][0] * (profile[i].left + extra * (1 + Math.max(0, profile[i].bias))), p[1] + normals[i][1] * (profile[i].left + extra * (1 + Math.max(0, profile[i].bias)))]),
      right: line.map((p, i) => [p[0] - normals[i][0] * (profile[i].right + extra * (1 + Math.max(0, -profile[i].bias))), p[1] - normals[i][1] * (profile[i].right + extra * (1 + Math.max(0, -profile[i].bias)))]),
    });
    const water = boundaries(0), bank = boundaries(WORLD_ART.rivers.bankShadow);
    const ground = boundaries(WORLD_ART.rivers.groundBandExtra);
    paths.riparian.push(polygonPath(ground.left, ground.right));
    const flowHighlight = new Path2D();
    line.forEach((p, i) => {
      const offset = Math.sin(i * 0.19 + ri * 1.7) * 2.2 + profile[i].bias * profile[i].width * 0.08;
      const x = p[0] + normals[i][0] * offset, y = p[1] + normals[i][1] * offset;
      if (i === 0) flowHighlight.moveTo(x, y); else flowHighlight.lineTo(x, y);
    });
    const featureStrip = (feature, bankInset = 0, innerScale = 0.38) => {
      const center = Math.round(feature.t * (line.length - 1));
      const half = Math.max(3, Math.round(feature.span * line.length / 2));
      const from = Math.max(0, center - half), to = Math.min(line.length - 1, center + half);
      const outer = [], inner = [];
      for (let i = from; i <= to; i++) {
        const edge = feature.side > 0 ? water.left[i] : water.right[i];
        const reach = (feature.side > 0 ? profile[i].left : profile[i].right) * innerScale;
        const nx = normals[i][0] * feature.side, ny = normals[i][1] * feature.side;
        const taper = Math.sin(Math.PI * (i - from) / Math.max(1, to - from));
        outer.push([edge[0] - nx * bankInset * taper, edge[1] - ny * bankInset * taper]);
        // Both boundaries meet on the bank at either end, then the inner edge eases
        // toward mid-channel. This creates a tapered shelf instead of a transverse cap.
        inner.push([edge[0] - nx * reach * taper, edge[1] - ny * reach * taper]);
      }
      return polygonPath(outer, inner);
    };
    // Sediment hugs only the inside edge. Keeping the inner boundary close to the bank
    // prevents these authored deposits from reading as cross-river bars or UI blocks.
    const sandBanks = (world.rivers[ri].sandBanks || []).map(feature => {
      const center = Math.round(feature.t * (line.length - 1));
      const half = Math.max(4, Math.round(feature.span * line.length / 2));
      const from = Math.max(0, center - half), to = Math.min(line.length - 1, center + half);
      const edge = feature.side > 0 ? water.left : water.right;
      const path = new Path2D();
      for (let i = from; i <= to; i++) {
        const taper = Math.sin(Math.PI * (i - from) / Math.max(1, to - from));
        const x = edge[i][0] - normals[i][0] * feature.side * taper * 2;
        const y = edge[i][1] - normals[i][1] * feature.side * taper * 2;
        if (i === from) path.moveTo(x, y); else path.lineTo(x, y);
      }
      return path;
    });
    const shallows = (world.rivers[ri].shallows || []).map(feature => ({
      path: featureStrip(feature, 1, 0.52),
      stone: line[Math.round(feature.t * (line.length - 1))],
      normal: normals[Math.round(feature.t * (line.length - 1))],
    }));
    const deepBends = (world.rivers[ri].deepBends || []).map(feature => {
      const t = (feature.from + feature.to) / 2, span = feature.to - feature.from;
      return featureStrip({ t, span, side: feature.side }, 0, 0.42);
    });
    const islands = (world.rivers[ri].islands || []).map(feature => {
      const i = Math.round(feature.t * (line.length - 1));
      const p = line[i], n = normals[i], tangent = [-n[1], n[0]];
      const path = new Path2D();
      path.ellipse(p[0], p[1], feature.length / 2, feature.width, Math.atan2(tangent[1], tangent[0]), 0, TAU);
      return path;
    });
    paths.rivers.push({ water: polygonPath(water.left, water.right), bank: polygonPath(bank.left, bank.right),
      flowHighlight, sandBanks, shallows, deepBends, islands, line, normals, profile, waterBoundaries: water });
  }
  return paths;
}

export function buildScenery(world) {
  const R = makeRng(1234);
  const items = [];
  // two rivers crossing the map, with bridge points (visual landmarks)
  world.rivers = [
    {
      pts: [[960, -80], [760, 260], [985, 640], [980, 1050], [1220, 1380], [1055, 1655], [850, 2240]],
      bridges: [[985, 640], [1055, 1655]], normalWidth: 48,
      widthKeys: [[0, 1], [0.17, 1.3], [0.38, 0.82], [0.58, 1.25], [0.79, 0.88], [1, 1.15]],
      biasKeys: [[0, -0.04], [0.2, 0.13], [0.42, -0.11], [0.65, 0.14], [0.82, -0.08], [1, 0.06]],
      shallows: [{ t: 0.48, span: 0.055, side: -1, kind: 'calm' }],
      sandBanks: [{ t: 0.47, span: 0.09, side: -1 }, { t: 0.69, span: 0.07, side: 1 }],
      deepBends: [{ from: 0.18, to: 0.3, side: -1 }, { from: 0.55, to: 0.66, side: 1 }],
      islands: [],
    },
    {
      pts: [[2470, -80], [2250, 340], [2437, 745], [2600, 1100], [2280, 1500], [2460, 2240]],
      bridges: [[2437, 745]], normalWidth: 50,
      widthKeys: [[0, 0.9], [0.2, 1.28], [0.42, 0.84], [0.67, 1.34], [0.85, 0.88], [1, 1.12]],
      biasKeys: [[0, 0.06], [0.23, -0.14], [0.45, 0.1], [0.68, -0.12], [0.86, 0.08], [1, -0.04]],
      shallows: [], sandBanks: [{ t: 0.64, span: 0.08, side: 1 }],
      deepBends: [{ from: 0.18, to: 0.3, side: 1 }, { from: 0.58, to: 0.72, side: -1 }],
      islands: [{ t: 0.73, length: 58, width: 13 }],
    },
  ];
  // Consume the legacy facet RNG draws so the fixed authored scenery below does not move.
  // Presentation now uses three authored 9–12 point elevation regions instead of those
  // screen-spanning triangular facets. Keeping the draw count preserves all collider cores.
  for (let i = 0; i < 45; i++) {
    const cx = R() * world.W, cy = R() * world.H, s = 20 + R() * 70;
    const pts = [];
    const n = 5 + (R() * 3 | 0);
    for (let j = 0; j < n; j++) {
      const a = j / n * TAU;
      pts.push([cx + Math.cos(a) * s * (0.6 + R() * 0.6), cy + Math.sin(a) * s * (0.4 + R() * 0.45)]);
    }
  }
  world.terrainRegions = [
    { id: 'west', points: [[-40, -40], [1000, -40], [1040, 440], [990, 880], [1055, 1320], [1010, 1760], [1030, 2240], [-40, 2240]] },
    { id: 'center', points: [[1000, -40], [2400, -40], [2460, 440], [2410, 880], [2470, 1320], [2420, 1760], [2440, 2240], [1030, 2240], [1010, 1760], [1055, 1320], [990, 880], [1040, 440]] },
    { id: 'east', points: [[2400, -40], [3240, -40], [3240, 2240], [2440, 2240], [2420, 1760], [2470, 1320], [2410, 880], [2460, 440]] },
  ];
  world.terrainTransitions = [
    [[1000, -40], [1040, 440], [990, 880], [1055, 1320], [1010, 1760], [1030, 2240]],
    [[2400, -40], [2460, 440], [2410, 880], [2470, 1320], [2420, 1760], [2440, 2240]],
  ];
  // Kept as a compatibility alias for diagnostics that predate the presentation contract.
  world.blotches = world.terrainRegions.map(region => region.points);
  // Collider cores were authored against these legacy clearance courses. Visual/collision
  // water may evolve, but candidate rejection stays pinned so a river art pass cannot
  // silently reshuffle mountain, rock, tree, or battlefield-cover RNG downstream.
  const sceneryClearanceRivers = [
    [[950, -40], [900, 400], [1050, 900], [980, 1400], [1120, 1900], [1060, 2240]],
    [[2450, -40], [2380, 500], [2500, 1000], [2350, 1500], [2450, 2240]],
  ];
  // A ridge/forest origin can pass this check while its individual pieces (offset up to
  // ~250px away below) still drift onto the river — see the per-piece recheck in each loop.
  const clearOf = (x, y, r) => {
    for (const s of WORLD.settlements) if (dist2(x, y, s.x, s.y) < (r + 130) ** 2) return false;
    for (const c of WORLD.camps) if (dist2(x, y, c.x, c.y) < (r + 130) ** 2) return false;
    for (const pts of sceneryClearanceRivers) {
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
      items.push({ kind: 'mtn', family: 'foothills', clusterId: `foothills-${i}`,
        regionId: worldRegionAt(mx).id, x: mx, y: my, s: 45 + R() * 55, z: 2 });
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
      items.push({ kind: 'tree', family: 'forest', clusterId: `forest-${i}`,
        regionId: worldRegionAt(tx).id, x: tx, y: ty, s: 14 + R() * 12, z: 1 });
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = 80 + R() * (world.W - 160), y = 80 + R() * (world.H - 160);
    if (!clearOf(x, y, 30)) continue;
    items.push({ kind: 'rock', family: 'rock', clusterId: `rock-${i}`,
      regionId: worldRegionAt(x).id, x, y, s: 14 + R() * 16, rot: R() * TAU,
      // Keep canonical collider/battlefield rocks, but expose only a sparse authored
      // subset on the campaign map so outcrops read as places rather than filler.
      mapVisible: i % 3 !== 1, z: 1 });
  }
  // shrub clumps fill the empty midground between the big scenery pieces
  for (let i = 0; i < 55; i++) {
    const x = 60 + R() * (world.W - 120), y = 60 + R() * (world.H - 120);
    if (!clearOf(x, y, 20)) continue;
    items.push({ kind: 'shrub', family: 'support', clusterId: null,
      regionId: worldRegionAt(x).id, x, y, s: 7 + R() * 6, z: 0 });
  }
  // Shrubs remain in the battlefield contract, but isolated map marks are hidden unless
  // they reinforce an existing forest, ridge or rocky patch.
  for (const it of items) if (it.kind === 'shrub') {
    // Canonical scrub remains available to battlefield sampling, but the map's authored
    // forests/rocks already carry the hierarchy; tiny scrub marks read as filler at zoom 1.
    it.mapVisible = false;
  }
  items.push(
    { kind: 'field', family: 'farmland', clusterId: 'farmland-ashford', regionId: 'west', x: 535, y: 1115, w: 170, h: 88, rot: -0.12, z: -1 },
    { kind: 'field', family: 'farmland', clusterId: 'farmland-ashford', regionId: 'west', x: 805, y: 1245, w: 190, h: 92, rot: 0.18, z: -1 },
    { kind: 'field', family: 'farmland', clusterId: 'farmland-coldwell', regionId: 'center', x: 1280, y: 480, w: 155, h: 78, rot: 0.08, z: -1 },
    // Presentation-only landmark framing. `mapFrame` is intentionally ignored by solids
    // and battlefield sampling, preserving canonical collision and brief geometry.
    { kind: 'mapFrame', visualKind: 'tree', family: 'forest', clusterId: 'frame-brindle', regionId: 'center', x: 1340, y: 1570, s: 24, z: 1 },
    { kind: 'mapFrame', visualKind: 'tree', family: 'forest', clusterId: 'frame-brindle', regionId: 'center', x: 1660, y: 1560, s: 26, z: 1 },
    { kind: 'mapFrame', visualKind: 'mtn', family: 'foothills', clusterId: 'frame-highmere', regionId: 'center', x: 1840, y: 930, s: 82, z: 2 },
    { kind: 'mapFrame', visualKind: 'mtn', family: 'foothills', clusterId: 'frame-highmere', regionId: 'center', x: 2260, y: 920, s: 74, z: 2 },
    { kind: 'mapFrame', visualKind: 'mtn', family: 'foothills', clusterId: 'frame-wolfsjaw', regionId: 'east', x: 2570, y: 320, s: 88, z: 2 },
    { kind: 'mapFrame', visualKind: 'mtn', family: 'foothills', clusterId: 'frame-wolfsjaw', regionId: 'east', x: 3040, y: 330, s: 84, z: 2 },
  );
  items.sort((a, b) => a.z - b.z || a.y - b.y);
  world.visualClusters = new Map();
  for (const it of items) if (it.clusterId && it.kind !== 'field') {
    let cluster = world.visualClusters.get(it.clusterId);
    if (!cluster) world.visualClusters.set(it.clusterId, cluster = { x: 0, y: 0, r: 0, items: [] });
    cluster.items.push(it); cluster.x += it.x; cluster.y += it.y;
  }
  for (const cluster of world.visualClusters.values()) {
    cluster.x /= cluster.items.length; cluster.y /= cluster.items.length;
    cluster.r = Math.max(...cluster.items.map(it =>
      Math.hypot(it.x - cluster.x, it.y - cluster.y) + (it.visualKind === 'mtn' || it.kind === 'mtn' ? WORLD_ART.scale.mountain.max : WORLD_ART.scale.tree.max) * 1.6));
  }
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
