// Campaign world — the Bannerlord bar: settlements, roaming parties, army snowball.
import { PAL, WORLD, UNIT_TYPES, ENEMY_TYPES, HERO, BALANCE, enemyStrength, playerStrength } from './data.js?v=r4a9430492e50';
import { TAU, clamp, lerp, angLerp, dist2, len, makeRng, deriveSeed, RNG_DOMAINS, distToSegment, Particles, shadow, shade, tree, mountain, rrect, rock } from './engine.js?v=r4a9430492e50';
import { SAVE_VERSION } from './save.js?v=r4a9430492e50';
import { ACTIONS } from './input-actions.js?v=r4a9430492e50';
import {
  hoverTargetAt, drawHoverPanel, isOverHud,
  buildBriefModel, drawBriefPanel,
  buildAftermathModel, drawAftermathPanel,
} from './world-screens.js?v=r4873a112c73f';

const P = PAL.world;

export class World {
  constructor(game, save) {
    this.game = game;
    this.simRng = null;
    this.fxRng = null;
    this.particles = new Particles(() => this.game.effectsEnabled);
    this.W = WORLD.w; this.H = WORLD.h;
    this.time = 0;
    this.msg = null; this.msgT = 0;
    // Plan 021: presentation-only hover state. Written and read only in draw() —
    // AGENTS.md: "simulation must not read presentation." pointerEverMoved is a latch,
    // not `input.mouse.moved` itself: `moved` is cleared by endFrame() (engine.js) at
    // the end of EVERY Game.update() call, and Game.draw() always runs after at least
    // one update() in the same tick whenever a render actually happens — so by the time
    // draw() can read it, `moved` has already gone false again for the ordinary case of
    // one update per rendered frame. `mouse.x`/`mouse.y` are not reset by endFrame(),
    // only `moved`/`clicked` are, so the latch instead remembers the pointer's position
    // at construction time and fires once the CURRENT position differs from it — this
    // is unaffected by the update/draw ordering and still boot-safe, since the default
    // pointer sits on the hero token (canvas centre) at construction.
    this.pointerBootX = game.input.mouse.x;
    this.pointerBootY = game.input.mouse.y;
    this.pointerEverMoved = false;
    this.hoverTarget = null;
    // world-scene modals (Plan 021 Slice B): the pre-battle brief and the aftermath.
    // sceneName stays 'world' for both — see requestBattle()/updateWorldScreens().
    this.screen = null;
    this.pending = null;

    // persistent campaign state (survives battles)
    this.save = save || {
      version: SAVE_VERSION,
      gold: BALANCE.startGold,
      heroHp: HERO.hp, heroMaxHp: HERO.hp,
      troops: Array.from({ length: BALANCE.startTroops }, () => ({ type: 'spear' })),
      armyCap: BALANCE.armyCapBase,
      camps: WORLD.camps.map(c => ({ id: c.id, razed: false })),
      settlements: WORLD.settlements.map(s => ({ id: s.id, occupied: false })),
      won: false,
      x: WORLD.heroStart.x, y: WORLD.heroStart.y,
      parties: null,
      // each campaign rolls its own seed: garrisons, party comps and spawns differ per run —
      // unless a test pinned one via scenario('world', {seed}) for reproducible test worlds
      // OS/browser entropy chooses a fresh campaign seed; all in-run draws use
      // the derived simulation/presentation domains below.
      runSeed: game.testSeed != null ? game.testSeed : (Math.random() * 1e9) | 0,
      stats: { won: 0, kills: 0, lost: 0, playT: 0 },
      hard: !!game.hardNext,
      battleCount: 0,
    };
    game.hardNext = false;
    game.testSeed = null;

    this.hero = { x: this.save.x, y: this.save.y, vx: 0, vy: 0, facing: 0, bob: 0 };
    this.grace = save ? BALANCE.battleGrace : 0;   // ambush immunity after a battle
    // world randomness evolves across the campaign AND differs per run
    const campaignSeed = ((this.save.runSeed ?? 777) + (this.save.battleCount ?? 0) * 7919) >>> 0;
    this.simRng = makeRng(deriveSeed(campaignSeed, RNG_DOMAINS.WORLD_SIM));
    this.fxRng = makeRng(deriveSeed(campaignSeed, RNG_DOMAINS.WORLD_FX));
    if (this.save.toast) { this.say(this.save.toast, 3.5); this.save.toast = null; }
    // Plan 021 design decision 9: the aftermath payload rides on game.pendingAftermath,
    // never on `save` — a refresh mid-aftermath loses the screen, which is correct (the
    // checkpoint is a map snapshot, not a battle). Consumed and cleared exactly once,
    // beside the toast replay above, and only when this world is not the victory ending
    // (a won stronghold raid's aftermath IS the victory screen — see updateCampInteraction/
    // startVictory ordering in update()).
    if (game.pendingAftermath && !this.save.won) {
      this.screen = buildAftermathModel(game.pendingAftermath);
    }
    game.pendingAftermath = null;

    // scenery uses a fixed authored seed: it is static map input, not a campaign
    // stream, so changing effects can never perturb collision geometry.
    this.scenery = this.buildScenery();
    // Terrain is defined once as sampled polylines. Rendering and simulation both consume
    // these cached points, so a curve can never be visible in one system but absent in the
    // other. The segment arrays below are a derived query representation, not a second map.
    this.terrain = this.buildTerrainGeometry();
    this.riverLines = this.terrain.rivers;
    this.roadLines = this.terrain.roads;
    this.riverSegs = this.linesToSegments(this.riverLines);
    this.riverBands = this.riverLines.map(line => {
      const raw = this.linesToSegments([line]);
      const segs = new Float64Array(raw.length * 8);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      raw.forEach((s, i) => {
        const o = i * 8;
        for (let j = 0; j < 8; j++) segs[o + j] = s[j];
        if (s[4] < minX) minX = s[4]; if (s[5] > maxX) maxX = s[5];
        if (s[6] < minY) minY = s[6]; if (s[7] > maxY) maxY = s[7];
      });
      return { minX, maxX, minY, maxY, segs };
    });
    this.bridgePts = [];
    for (const r of this.rivers) {
      for (const b of r.bridges) this.bridgePts.push(b);
    }
    this.roadSegs = this.linesToSegments(this.roadLines);
    this._staticPaths = this.buildStaticPaths();
    this.solids = this.scenery.filter(it => it.kind === 'mtn' || it.kind === 'rock')
      .map(it => ({ x: it.x, y: it.y - (it.kind === 'mtn' ? it.s * 0.25 : 0), r: it.kind === 'mtn' ? it.s * 0.72 : it.s * 1.1 }))
      // bridge mouths must be open: no solid may sit within reach of a crossing
      .filter(o => this.bridgePts.every(([bx, by]) => dist2(o.x, o.y, bx, by) > (150 + o.r) * (150 + o.r)));
    // navigation graph: each bridge contributes two staging nodes (one per bank, set
    // perpendicular to its river) plus the bridge center; parties route through it with
    // line-of-sight Dijkstra — no more straight-line-only pursuit grinding on banks
    this.navNodes = [];
    for (const [bx, by] of this.bridgePts) {
      let best = null, bd = Infinity;
      for (const [ax, ay, cx, cy] of this.riverSegs) {
        const d = distToSegment(bx, by, ax, ay, cx, cy);
        if (d < bd) { bd = d; best = [ax, ay, cx, cy]; }
      }
      const [ax, ay, cx, cy] = best;
      const dl = Math.hypot(cx - ax, cy - ay) || 1;
      const nx = -(cy - ay) / dl, ny = (cx - ax) / dl;
      this.navNodes.push({ x: bx, y: by });
      // two staging rings per side: near (for the final approach) and far (visible from
      // most of the bank, so paths never have to skim along the river's blocked band)
      for (const s of [1, -1]) {
        for (const r of [110, 260]) {
          const wx = bx + nx * s * r, wy = by + ny * s * r;
          if (wx > 40 && wx < this.W - 40 && wy > 40 && wy < this.H - 40 && !this.blockedAt(wx, wy)) {
            this.navNodes.push({ x: wx, y: wy });
          }
        }
      }
    }
    // precompute node-to-node visibility
    const N = this.navNodes.length;
    this.navEdges = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (this.lineClear(this.navNodes[i].x, this.navNodes[i].y, this.navNodes[j].x, this.navNodes[j].y)) {
          const w = Math.hypot(this.navNodes[i].x - this.navNodes[j].x, this.navNodes[i].y - this.navNodes[j].y);
          this.navEdges[i].push([j, w]); this.navEdges[j].push([i, w]);
        }
      }
    }
    this._navScratch = {
      start: new Float64Array(N), toGoal: new Float64Array(N), dist: new Float64Array(N),
      first: new Int32Array(N), done: new Uint8Array(N),
    };

    // roaming parties: restore persisted ones, or spawn the initial set
    this.parties = [];
    if (this.save.parties) {
      for (const p of this.save.parties) {
        this.parties.push({
          camp: p.camp, x: p.x, y: p.y, vx: 0, vy: 0, facing: 0, bob: this.fxRng() * TAU,
          comp: p.comp, home: p.home, wander: null, wanderT: 0, waryT: p.waryT || 0,
          clashT: p.clashT || 0, occupying: p.occupying || null, raid: null,
          navT: this.simRng() * 0.3, navGoal: null, navFor: null,
          _navGoalVisibility: new Float64Array(N), _navGoalX: NaN, _navGoalY: NaN,
        });
      }
    } else {
      for (const c of WORLD.camps) {
        const st = this.save.camps.find(s => s.id === c.id);
        if (st.razed || c.stronghold) continue; // the Hold garrisons its walls; it doesn't raid — its camps do
        const n = 1 + (this.simRng() * 2 | 0);
        for (let i = 0; i < n; i++) this.spawnParty(c);
      }
    }
    this.spawnT = 30;
    this.persistParties();
  }

  persistParties() {
    this.save.parties = this.parties.map(p => {
      const rec = { camp: p.camp, x: p.x, y: p.y, comp: p.comp, home: p.home, waryT: p.waryT || 0, clashT: p.clashT || 0 };
      if (p.occupying) rec.occupying = p.occupying;
      return rec;
    });
  }

  syncLiveStateToSave() {
    this.save.x = this.hero.x;
    this.save.y = this.hero.y;
    this.persistParties();
    return this.save;
  }

  inSafeZone(x, y) {
    for (const s of WORLD.settlements) {
      if (dist2(x, y, s.x, s.y) < BALANCE.settlementSafeR * BALANCE.settlementSafeR) return true;
    }
    return false;
  }

  // Terrain rules: rivers block except within reach of a bridge; mountains and rocks are solid.
  // The bridge exemption (95) must overlap the river-block band (22) with margin from every
  // approach angle, or a dead pocket forms where units freeze against the bank.
  blockedAt(x, y) {
    let nearBridge = false;
    for (const [bx, by] of this.bridgePts) {
      if (dist2(x, y, bx, by) < 95 * 95) { nearBridge = true; break; }
    }
    if (!nearBridge) {
      if (this.riverDistanceAt(x, y, 22) < 22) return true;
    }
    for (const o of this.solids) {
      if (dist2(x, y, o.x, o.y) < o.r * o.r) return true;
    }
    return false;
  }
  onRoad(x, y) {
    for (const [ax, ay, bx, by] of this.roadSegs) {
      if (distToSegment(x, y, ax, ay, bx, by) < 28) return true;
    }
    return false;
  }

  // Build the only terrain representation used by draw(), collision and movement bonuses.
  // A maximum chord length keeps the polyline's geometric error well below the 28px road
  // bonus and 22px river collision bands while keeping construction outside hot paths.
  buildTerrainGeometry() {
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
    const rivers = this.rivers.map(r => {
      const pts = r.pts;
      const pieces = [];
      for (let i = 0; i < pts.length - 2; i++) {
        const end = [(pts[i + 1][0] + pts[i + 2][0]) / 2, (pts[i + 1][1] + pts[i + 2][1]) / 2];
        pieces.push(sampleQuadratic(pts[i], pts[i + 1], end));
      }
      const last = pts.length - 1;
      pieces.push(sampleQuadratic(
        [(pts[last - 1][0] + pts[last][0]) / 2, (pts[last - 1][1] + pts[last][1]) / 2],
        pts[last], pts[last]
      ));
      return join(pieces);
    });
    return { roads, rivers };
  }

  linesToSegments(lines) {
    const segments = [];
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        segments.push([a[0], a[1], b[0], b[1], Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]);
      }
    }
    return segments;
  }
  riverDistanceAt(x, y, pad = 0) {
    let best = Infinity;
    for (const band of this.riverBands) {
      if (x < band.minX - pad || x > band.maxX + pad || y < band.minY - pad || y > band.maxY + pad) continue;
      for (let o = 0; o < band.segs.length; o += 8) {
        const ax = band.segs[o], ay = band.segs[o + 1], bx = band.segs[o + 2], by = band.segs[o + 3];
        const minX = band.segs[o + 4], maxX = band.segs[o + 5], minY = band.segs[o + 6], maxY = band.segs[o + 7];
        if (x < minX - pad || x > maxX + pad || y < minY - pad || y > maxY + pad) continue;
        const d = distToSegment(x, y, ax, ay, bx, by);
        if (d < best) best = d;
      }
    }
    return best;
  }
  // River-only collision for AI parties: rivers block everyone, but bandits know the goat
  // paths through the mountains (soft-steered around them instead of hard-blocked) — this
  // keeps the coherent river/bridge rule while making AI freezes structurally impossible.
  riverBlockedAt(x, y, pad) {
    let nearBridge = false;
    for (const [bx, by] of this.bridgePts) {
      if (dist2(x, y, bx, by) < 95 * 95) { nearBridge = true; break; }
    }
    if (!nearBridge) {
      if (this.riverDistanceAt(x, y, 22 + (pad || 0)) < 22 + (pad || 0)) return true;
    }
    return false;
  }
  blockedAtPad(x, y, pad) {
    return this.riverBlockedAt(x, y, pad);
  }
  // straight line traversable? finely sampled with a conservative margin over the OPEN
  // corridor — endpoints are excluded (they are positions entities legally occupy, which
  // may sit inside the planner's padded margin), and exclusion makes visibility symmetric:
  // lineClear(A,B) === lineClear(B,A) by construction
  lineClear(x1, y1, x2, y2) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.ceil(d / 14));
    for (let i = 1; i <= n - 1; i++) {
      if (this.blockedAtPad(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, 8)) return false;
    }
    return true;
  }
  // next waypoint toward `goal` from (x,y): direct if visible, else Dijkstra over the nav graph
  pathGoal(x, y, goal, party = null) {
    if (this.lineClear(x, y, goal.x, goal.y)) return goal;
    const N = this.navNodes.length;
    const scratch = this._navScratch;
    const start = scratch.start;
    const toGoal = party ? party._navGoalVisibility : scratch.toGoal;
    const goalChanged = !party || !Number.isFinite(party._navGoalX) ||
      Math.hypot(party._navGoalX - goal.x, party._navGoalY - goal.y) > 140;
    if (goalChanged) {
      for (let i = 0; i < N; i++) {
        toGoal[i] = this.lineClear(this.navNodes[i].x, this.navNodes[i].y, goal.x, goal.y)
          ? Math.hypot(goal.x - this.navNodes[i].x, goal.y - this.navNodes[i].y) : Infinity;
      }
      if (party) { party._navGoalX = goal.x; party._navGoalY = goal.y; }
    }
    for (let i = 0; i < N; i++) {
      start[i] = this.lineClear(x, y, this.navNodes[i].x, this.navNodes[i].y)
        ? Math.hypot(x - this.navNodes[i].x, y - this.navNodes[i].y) : Infinity;
    }
    // Dijkstra from the virtual start over ≤9 nodes
    const dist = scratch.dist, first = scratch.first, done = scratch.done;
    for (let i = 0; i < N; i++) { dist[i] = start[i]; first[i] = start[i] < Infinity ? i : -1; done[i] = 0; }
    for (let iter = 0; iter < N; iter++) {
      let u = -1, ud = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const [v, w] of this.navEdges[u]) {
        if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; first[v] = first[u]; }
      }
    }
    let best = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      if (dist[i] + toGoal[i] < bd) { bd = dist[i] + toGoal[i]; best = i; }
    }
    return best >= 0 ? this.navNodes[first[best]] : null;
  }

  buildStaticPaths() {
    const paths = { blotches: new Path2D(), light: new Path2D(), shade: new Path2D(), roads: new Path2D(), rivers: [] };
    for (const b of this.blotches) {
      paths.blotches.moveTo(b[0][0], b[0][1]);
      for (const pt of b) paths.blotches.lineTo(pt[0], pt[1]);
      paths.blotches.closePath();
    }
    paths.light.moveTo(this.W * 0.10, -40); paths.light.lineTo(this.W * 0.45, -40);
    paths.light.lineTo(this.W * 0.90, this.H + 40); paths.light.lineTo(this.W * 0.55, this.H + 40); paths.light.closePath();
    paths.shade.moveTo(this.W + 40, -40); paths.shade.lineTo(this.W - 900, -40); paths.shade.lineTo(this.W + 40, 800); paths.shade.closePath();
    paths.shade.moveTo(-40, this.H + 40); paths.shade.lineTo(900, this.H + 40); paths.shade.lineTo(-40, this.H - 800); paths.shade.closePath();
    for (const line of this.roadLines) {
      paths.roads.moveTo(line[0][0], line[0][1]);
      for (let i = 1; i < line.length; i++) paths.roads.lineTo(line[i][0], line[i][1]);
    }
    for (const line of this.riverLines) {
      const path = new Path2D();
      path.moveTo(line[0][0], line[0][1]);
      for (let i = 1; i < line.length; i++) path.lineTo(line[i][0], line[i][1]);
      paths.rivers.push(path);
    }
    return paths;
  }

  visible(x, y, radius = 100) {
    const cam = this.game.camera, hw = cam.w / cam.zoom / 2, hh = cam.h / cam.zoom / 2;
    return x > cam.x - hw - radius && x < cam.x + hw + radius && y > cam.y - hh - radius && y < cam.y + hh + radius;
  }
  // move with axis-separated sliding so terrain deflects instead of gluing you in place.
  // CRITICAL: an entity already standing in an invalid spot (spawned or teleported there)
  // is never trapped — from inside a blocked region, all movement is allowed until you exit.
  moveBlocked(e, nx, ny) {
    if (this.blockedAt(e.x, e.y)) { e.x = nx; e.y = ny; return; }
    if (!this.blockedAt(nx, ny)) { e.x = nx; e.y = ny; return; }
    if (!this.blockedAt(nx, e.y)) { e.x = nx; e.vy = 0; return; }
    if (!this.blockedAt(e.x, ny)) { e.y = ny; e.vx = 0; return; }
    e.vx *= 0.2; e.vy *= 0.2;
  }

  buildScenery() {
    const R = makeRng(1234);
    const items = [];
    // two rivers crossing the map, with bridge points (visual landmarks)
    this.rivers = [
      { pts: [[950, -40], [900, 400], [1050, 900], [980, 1400], [1120, 1900], [1060, 2240]], bridges: [[985, 640], [1055, 1655]] },
      { pts: [[2450, -40], [2380, 500], [2500, 1000], [2350, 1500], [2450, 2240]], bridges: [[2437, 745]] },
    ];
    // scattered ground blotches so the ride reads as terrain, not void
    this.blotches = [];
    for (let i = 0; i < 45; i++) {
      const cx = R() * this.W, cy = R() * this.H, s = 20 + R() * 70;
      const pts = [];
      const n = 5 + (R() * 3 | 0);
      for (let j = 0; j < n; j++) {
        const a = j / n * TAU;
        pts.push([cx + Math.cos(a) * s * (0.6 + R() * 0.6), cy + Math.sin(a) * s * (0.4 + R() * 0.45)]);
      }
      this.blotches.push(pts);
    }
    const clearOf = (x, y, r) => {
      for (const s of WORLD.settlements) if (dist2(x, y, s.x, s.y) < (r + 130) ** 2) return false;
      for (const c of WORLD.camps) if (dist2(x, y, c.x, c.y) < (r + 130) ** 2) return false;
      return true;
    };
    // mountain ridges
    for (let i = 0; i < 26; i++) {
      const x = 100 + R() * (this.W - 200), y = 100 + R() * (this.H - 200);
      if (!clearOf(x, y, 80)) continue;
      const n = 2 + (R() * 3 | 0);
      for (let j = 0; j < n; j++) items.push({ kind: 'mtn', x: x + j * 70 * (R() < 0.5 ? 1 : -1) + R() * 40, y: y + (R() - 0.5) * 60, s: 45 + R() * 55, z: 2 });
    }
    // forests
    for (let i = 0; i < 40; i++) {
      const x = 80 + R() * (this.W - 160), y = 80 + R() * (this.H - 160);
      if (!clearOf(x, y, 40)) continue;
      const n = 2 + (R() * 4 | 0);
      for (let j = 0; j < n; j++) items.push({ kind: 'tree', x: x + (R() - 0.5) * 110, y: y + (R() - 0.5) * 90, s: 14 + R() * 12, z: 1 });
    }
    for (let i = 0; i < 30; i++) {
      const x = 80 + R() * (this.W - 160), y = 80 + R() * (this.H - 160);
      if (!clearOf(x, y, 30)) continue;
      items.push({ kind: 'rock', x, y, s: 14 + R() * 16, rot: R() * TAU, z: 1 });
    }
    // shrub clumps fill the empty midground between the big scenery pieces
    for (let i = 0; i < 55; i++) {
      const x = 60 + R() * (this.W - 120), y = 60 + R() * (this.H - 120);
      if (!clearOf(x, y, 20)) continue;
      items.push({ kind: 'shrub', x, y, s: 7 + R() * 6, z: 0 });
    }
    items.sort((a, b) => a.y - b.y);
    return items;
  }

  // Weighted tier draw (Plan 020, design decision 1): replaces the deleted flat
  // 0.6-1.5x fair-band guarantee. Weights shift from `weak` toward `strong` as
  // non-stronghold camps fall, so the curve rises across a run instead of tracking
  // the player forever. `razed` is 0..3.
  rollPartyBand(razed) {
    const R = this.simRng;
    const t = clamp(razed / 3, 0, 1);
    const wWeak = 0.40 - 0.30 * t, wEven = 0.35; // wStrong is the remainder
    const { weak, even, strong } = BALANCE.partyTiers;
    const r = R();
    if (r < wWeak) return weak.min + R() * (weak.max - weak.min);
    if (r < wWeak + wEven) return even.min + R() * (even.max - even.min);
    return strong.min + R() * (strong.max - strong.min);
  }

  // Shared enemy-composition roller, target strength on `simRng` — used by spawnParty
  // and by the floor guarantee (enforceBeatableFloor) so both draw from one formula.
  rollComp(target) {
    const R = this.simRng;
    const comp = [];
    let str = 0;
    while (str < target) {
      const r = R();
      if (target - str >= 5 && r < 0.2) { comp.push('brute'); str += 5; }
      else if (r < 0.55) { comp.push('bandit'); str += 1; }
      else if (r < 0.8) { comp.push('raider'); str += 1; }
      else { comp.push('wolf'); str += 1; }
    }
    return comp;
  }

  // Spawn a party aimed at a strength band around the player. `band`, when given
  // explicitly, overrides the weighted tier draw (used by the floor guarantee's
  // callers and by QA to probe the [2,24] clamp directly).
  spawnParty(camp, band) {
    const R = this.simRng;
    const mine = this.myStrength();
    const razed = this.save.camps.filter(c => c.razed && c.id !== 'strong').length;
    const effectiveBand = band ?? this.rollPartyBand(razed);
    const target = Math.max(2, Math.min(24, Math.round(mine * effectiveBand)));
    const comp = this.rollComp(target);
    // never spawn a party inside a river or mountain — retry a few scatter offsets
    let px = camp.x, py = camp.y;
    for (let i = 0; i < 8; i++) {
      const tx = camp.x + (R() - 0.5) * 200, ty = camp.y + (R() - 0.5) * 200;
      if (!this.blockedAt || !this.blockedAt(tx, ty)) { px = tx; py = ty; break; }
    }
    this.parties.push({
      camp: camp.id,
      x: px, y: py,
      vx: 0, vy: 0, facing: 0, bob: this.fxRng() * TAU,
      comp, home: { x: camp.x, y: camp.y },
      wander: null, wanderT: 0, occupying: null, raid: null,
      navT: this.simRng() * 0.3, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(this.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
  }

  // Design decision 5's floor guarantee: a settlement is "claimed" once some party
  // occupies or is travelling to raid it. A break-off only ever targets a settlement
  // when at least one other stays fully unclaimed afterward, so no sequence of
  // simultaneous break-offs can ever occupy every settlement at once.
  // Where a raiding party sits once it has taken a settlement: north of centre, clear of
  // the name/OCCUPIED chips below. Falls back around the compass if terrain blocks it.
  occupierPost(settlement) {
    const R = 64;
    const candidates = [[0, -R], [-R, -R * 0.5], [R, -R * 0.5], [-R, 0], [R, 0]];
    for (const [dx, dy] of candidates) {
      const x = clamp(settlement.x + dx, 60, this.W - 60);
      const y = clamp(settlement.y + dy, 60, this.H - 60);
      if (!this.blockedAt(x, y)) return { x, y };
    }
    return { x: settlement.x, y: Math.max(60, settlement.y - R) };
  }

  isSettlementClaimed(id) {
    const st = this.save.settlements.find(s => s.id === id);
    return !!(st && st.occupied) || this.parties.some(p => p.raid === id || p.occupying === id);
  }

  // The other half of the floor guarantee (STOP condition): if nothing currently on
  // the map — including a party occupying a settlement — is within the player's
  // reach, downgrade the weakest live party to an even-tier fight. This only ever
  // fires as an emergency correction; it is not a routine crutch like the deleted
  // fair-band guarantee, which forced nearly every spawn into a narrow band.
  enforceBeatableFloor() {
    if (this.parties.length === 0) return;
    const mine = this.myStrength();
    const beatable = mine * BALANCE.beatablePartyRatio;
    if (this.parties.some(p => this.strength(p.comp) <= beatable)) return;
    const { even } = BALANCE.partyTiers;
    const evenBand = () => even.min + this.simRng() * (even.max - even.min);
    // Prefer ADDING a beatable target over rewriting one the player may already have
    // read off a badge. `rollGarrison` sets the house rule that what you scouted is what
    // you fight, and silently weakening a party the player scouted breaks the same trust:
    // a lone 14-strength band used to become a 4 while the player watched.
    const alive = this.liveCamps();
    if (alive.length && this.parties.length < this.partyCap()) {
      const camp = alive[(this.simRng() * alive.length) | 0];
      this.spawnParty(camp, evenBand());
      this.particles.ring(camp.x, camp.y, 40, P.ink, 0.5, 3);
      this.persistParties();
      return;
    }
    // Only at the party cap, with no room to add one, is an existing band rewritten.
    let weakest = this.parties[0];
    for (const p of this.parties) if (this.strength(p.comp) < this.strength(weakest.comp)) weakest = p;
    const target = Math.max(2, Math.min(24, Math.round(mine * evenBand())));
    weakest.comp = this.rollComp(target);
  }

  // Camps still fielding parties, and the ceiling on how many may be alive at once.
  // Shared by the spawn timer and the floor guarantee so the cap formula exists once.
  liveCamps() {
    return WORLD.camps.filter(c => !c.stronghold && !this.save.camps.find(s => s.id === c.id).razed);
  }
  partyCap() {
    const alive = this.liveCamps();
    return alive.length ? 2 + alive.length * 2 : 0;
  }

  // brutes hit ~5x harder than a bandit; knights count double. Badges show THIS number.
  // (shared with battle.js's enemyStrength/playerStrength — one formula, not two.)
  strength(comp) { return enemyStrength(comp); }

  // Garrisons are rolled ONCE — when your scouts first sight the camp — and frozen.
  // Bandits don't magically reinforce because you recruited; what you scouted is what you fight.
  rollGarrison(camp) {
    const mine = this.myStrength();
    const garrisonSeed = (camp.x * 31 + camp.y * 7 + mine * 13 + (this.save.runSeed ?? 0)) >>> 0;
    const R = makeRng(deriveSeed(garrisonSeed, RNG_DOMAINS.WORLD_GARRISON));
    const hardMul = this.save.hard ? 1.25 : 1;
    const target = Math.max(camp.size + 2, Math.round(mine * (camp.tier || 1) * hardMul));
    const bruteCap = camp.stronghold ? 3 : mine >= 12 ? 2 : mine >= 8 ? 1 : 0;
    const comp = [];
    let str = 0, brutes = 0;
    while (str < target) {
      const r = R();
      if (brutes < bruteCap && target - str >= 5 && r < 0.22) { comp.push('brute'); brutes++; str += 5; }
      else if (r < 0.6) { comp.push('bandit'); str += 1; }
      else if (r < 0.85) { comp.push('raider'); str += 1; }
      else { comp.push('wolf'); str += 1; }
    }
    return comp;
  }
  // what the map/prompt SHOWS: the scouted count, or nothing if not yet scouted
  garrisonStrength(camp) {
    const st = this.save.camps.find(c => c.id === camp.id);
    return st && st.garrison ? this.strength(st.garrison) : null;
  }
  myStrength() {
    return playerStrength(this.save.troops);
  }

  nearSettlement(r = 110) {
    for (const s of WORLD.settlements) if (dist2(this.hero.x, this.hero.y, s.x, s.y) < r * r) return s;
    return null;
  }
  nearCamp() {
    for (const c of WORLD.camps) {
      const st = this.save.camps.find(s => s.id === c.id);
      if (!st.razed && dist2(this.hero.x, this.hero.y, c.x, c.y) < 130 * 130) return c;
    }
    return null;
  }

  say(text, t = 2.4) { this.msg = text; this.msgT = t; }

  // each settlement quotes its own prices — Ashford's farm lads are cheap, Brindle's hunters too
  costAt(s, type) {
    const d = UNIT_TYPES[type];
    if (s && type === 'spear' && s.spearCost) return s.spearCost;
    if (s && type === 'archer' && s.archerCost) return s.archerCost;
    return d.cost;
  }
  recruit(type) {
    const s = this.nearSettlement();
    const d = UNIT_TYPES[type];
    const cost = this.costAt(s, type);
    if (this.save.troops.length >= this.save.armyCap) { this.say('Army is at capacity'); return; }
    if (this.save.gold < cost) { this.say('Not enough gold'); return; }
    this.save.gold -= cost;
    this.save.troops.push({ type });
    this.game.sfx.coin();
    this.say(`${d.name} joined your warband`);
    this.particles.ring(this.hero.x, this.hero.y, 30, P.cream, 0.4, 3);
  }

  // Biomes are the lands BETWEEN the two rivers — crossing a bridge takes you into different country
  biomeAt(x) { return x < 1030 ? 'meadow' : x < 2430 ? 'rose' : 'night'; }
  nearRiver(x, y = this.hero.y) {
    return this.riverSegs.some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) < 140);
  }
  // which way you rode into the fight — battles keep your real map orientation
  approachTo(tx, ty) {
    const dx = tx - this.hero.x, dy = ty - this.hero.y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : (dy >= 0 ? 'S' : 'N');
  }

  startBattle(comp, title, onWinExtra, arena, ambush, partyMeta, subtitle, brief = false) {
    const save = this.save;
    // Plan 021 step 9: the roster ENTERING the fight, captured before anything about it
    // can change — result.survivors alone can't say how many of each type were lost.
    const preTroopTypes = save.troops.map(t => t.type);
    const enemyCompSnapshot = comp.slice();
    save.x = this.hero.x; save.y = this.hero.y;
    save.battleCount = (save.battleCount || 0) + 1;
    this.persistParties();
    this.game.persistRun();
    this.game.sfx.horn(147);
    this.game.startBattle({
      troops: save.troops.map(t => ({ type: t.type, hp: t.hp })),
      enemies: comp.map(c => ({ type: c })),
      seed: (Math.abs(this.hero.x * 31 + this.hero.y * 17) | 0) + 7,
      title,
      arena: arena || (this.nearSettlement(200) ? 'village' : this.nearRiver(this.hero.x) ? 'bridge' : 'road'),
      biome: this.biomeAt(this.hero.x),
      ambush,
      subtitle,
      // Plan 021 step 5: setup.brief keys the battle intro's trim so the three
      // scenario('battle_*') visual baselines (never routed through a brief) are
      // provably untouched — only fights reached via confirmBrief() set this.
      brief,
      deploy: this.pendingDeploy,
      approach: this.pendingApproach || 'E',
      // (pending* are per-battle one-shots)
      heroHp: save.heroHp,
      heroMaxHp: save.heroMaxHp,
      onEnd: (result) => {
        this.pendingDeploy = undefined; this.pendingApproach = undefined;
        save.stats = save.stats || { won: 0, kills: 0, lost: 0, playT: 0 };
        save.stats.kills += result.kills || 0;
        save.stats.lost += result.lost || 0;
        if (result.victory) save.stats.won++;
        // whittle down the enemy force by exactly who died (by type, not by array
        // position) — used below both for camp-garrison attrition and for the
        // roaming party you disengaged from. Reused per branch since each only
        // needs it once, but built from the same dead-type list either way.
        const removeDead = (comp) => {
          const dead = (result.deadTypes || []).slice();
          return comp.filter(t => {
            const idx = dead.indexOf(t);
            if (idx >= 0) { dead.splice(idx, 1); return false; }
            return true;
          });
        };
        const restoreRoamingParty = () => {
          // A roaming encounter is removed before battle entry. Reinsert only its
          // surviving composition at the encounter point; defeat changes save.x/y
          // to the recovery village, so those coordinates must come from metadata.
          if (!partyMeta || partyMeta.campId) return;
          const remaining = removeDead(partyMeta.comp);
          if (remaining.length === 0) {
            // A party occupying a settlement that happens to be fully wiped on a
            // retreat/defeat edge case (not a formal victory) still frees the
            // settlement — there is no occupier left to hold it.
            if (partyMeta.occupying) {
              const st = this.save.settlements.find(s => s.id === partyMeta.occupying);
              if (st) st.occupied = false;
            }
            return;
          }
          save.parties = save.parties || [];
          save.parties.push({
            camp: partyMeta.camp,
            x: partyMeta.x,
            y: partyMeta.y,
            comp: remaining,
            home: { ...partyMeta.home },
            waryT: partyMeta.waryT || 0,
            // re-inserted right on top of the hero on disengage — without its own
            // cooldown it would instantly re-clash the same frame grace expires
            clashT: BALANCE.battleGrace,
            ...(partyMeta.occupying ? { occupying: partyMeta.occupying } : {}),
          });
        };
        // camp garrisons no longer resurrect their dead on a failed or abandoned raid —
        // what you killed stays dead, so attrition against a camp is real
        if (partyMeta && partyMeta.campId && !result.victory) {
          const st = this.save.camps.find(c => c.id === partyMeta.campId);
          if (st && st.garrison) st.garrison = removeDead(st.garrison);
        }
        if (result.victory) {
          save.gold += result.loot;
          save.troops = result.survivors;
          save.heroHp = Math.min(save.heroMaxHp, result.heroHp + 20);
          save.toast = null;
          onWinExtra && onWinExtra(); // camp raids set their own toast (razed count, captives, remnants)
          if (!save.toast) {
            save.toast = result.lost > 0
              ? `Victory — ${result.lost} men lost. The camps are the objective: raid the tents.`
              : 'Victory, no losses! Raid the camps to stop the raids.';
          }
        } else if (result.retreated) {
          // disengage: keep the survivors you actually rode out with, no gold loss
          save.troops = result.survivors;
          save.heroHp = Math.max(20, result.heroHp);
          save.toast = 'You disengage and ride clear';
          // The enemy party you fled from stays at the encounter, minus its actual dead.
          restoreRoamingParty();
        } else {
          // defeat: your surviving men carry you to the NEAREST village, not magically home
          save.gold = Math.max(25, Math.round(save.gold * (1 - BALANCE.defeatGoldLoss)));
          save.troops = result.survivors || [];
          save.heroHp = Math.round(save.heroMaxHp * 0.5);
          let nearest = WORLD.settlements[0], bd = Infinity;
          for (const s of WORLD.settlements) {
            const d = dist2(save.x, save.y, s.x, s.y);
            if (d < bd) { bd = d; nearest = s; }
          }
          save.x = nearest.x; save.y = nearest.y + 80;
          if (save.troops.length < 2 && !save.hard) {
            while (save.troops.length < 2) save.troops.push({ type: 'spear' });
            save.toast = `Carried to ${nearest.name} — village volunteers rally to your banner`;
          } else if (save.troops.length === 0 && save.hard) {
            // hard mode: no volunteers — only your squire stays
            save.troops.push({ type: 'spear' });
            save.toast = `Carried to ${nearest.name} — only your squire remains. HARD lands breed no volunteers`;
          } else {
            save.toast = `Your men carry you to ${nearest.name} — the survivors regroup`;
          }
          // Defeat also leaves surviving roaming enemies in the world. This must run
          // after the teleport so restoration cannot accidentally use the new hero position.
          restoreRoamingParty();
        }
        // Plan 021 step 9: the aftermath payload rides on game.pendingAftermath, never on
        // `save` (no new save field, no schema bump — decision 9). Skipped when save.won:
        // a won stronghold raid's final victory screen already IS that fight's aftermath,
        // and consuming save.toast here would rob the pre-existing one-frame toast replay
        // of its message for no reason (the victory scene replaces it immediately anyway).
        if (!save.won) {
          const consequence = save.toast || null;
          save.toast = null; // consumed — must not be shown again behind a frozen msgT timer
          this.game.pendingAftermath = {
            victory: result.victory,
            retreated: result.retreated,
            loot: result.loot || 0,
            preTroopTypes,
            survivorTypes: (result.survivors || []).map(t => t.type),
            deadTypes: (result.deadTypes || []).slice(),
            enemyCompSnapshot,
            heroHp: save.heroHp, // POST-regen — result.heroHp would contradict the HUD
            heroMaxHp: save.heroMaxHp,
            consequence,
          };
        }
        this.game.startWorld(save);
      },
    });
  }

  // Plan 021 decision 8: World.startBattle() keeps committing immediately — legacy QA
  // records and window.__g call it directly and assert battle on the next line. Every
  // map-initiated fight now reaches it only through requestBattle()/confirmBrief() below.
  //
  // `descriptor` fields: title, subtitle, arena, ambush, approach, deploy, comp (display
  // snapshot; null means unscouted), canWithdraw, partyMeta, and EITHER `party` (a live
  // roaming-party reference, for a clash) OR `campId` (for a camp/stronghold assault) —
  // never both. onWinExtra is precomputed for a party (nothing mutates it while the brief
  // blocks every other world phase) but rebuilt at confirm for a camp via
  // campVictoryExtra(), since an unscouted garrison does not exist yet at request time.
  requestBattle(descriptor) {
    this.pending = { descriptor, battleCountAtRequest: this.save.battleCount || 0 };
    this.screen = buildBriefModel(descriptor, this.save);
  }

  // Cancel charges the fled-from party (decision 6): it saw you flinch. Camps have no
  // equivalent cooldown field — cancelling one just closes the brief, and the garrison
  // (rolled only at confirm) stays unrolled, so it is never revealed for free.
  cancelBrief() {
    const d = this.pending && this.pending.descriptor;
    if (d && d.party) {
      d.party.clashT = BALANCE.battleGrace;
      d.party.waryT = 25;
    }
    this.screen = null;
    this.pending = null;
  }

  confirmBrief() {
    const d = this.pending.descriptor;
    let comp = d.comp, onWinExtra = d.onWinExtra;
    if (d.party) {
      // Hold the party OBJECT, resolve indexOf at confirm — nothing else can touch
      // `this.parties` while the brief blocks every other world phase, but bail cleanly
      // rather than assume the index is still valid.
      const idx = this.parties.indexOf(d.party);
      if (idx < 0) { this.screen = null; this.pending = null; return; }
      this.parties.splice(idx, 1);
    } else if (d.campId) {
      const camp = WORLD.camps.find(c => c.id === d.campId);
      const st = this.save.camps.find(c => c.id === d.campId);
      // Decision 6: the garrison roll for an unscouted camp happens HERE, at confirm —
      // never at request time, or backing out would permanently reveal it for free.
      if (!st.garrison) st.garrison = this.rollGarrison(camp);
      comp = st.garrison; // the live alias startBattle()'s onEnd already expects
      onWinExtra = this.campVictoryExtra(camp, st, comp);
    }
    // Splice/garrison-roll above must finish before startBattle() calls persistParties()
    // and persistRun() (AGENTS.md: finish all map-side mutations, then persist once,
    // while still `world`) — the encounter must already be gone from the checkpoint it
    // writes, not merely gone from the next one.
    this.pendingApproach = d.approach;
    this.pendingDeploy = d.deploy;
    this.screen = null;
    this.pending = null;
    this.startBattle(comp, d.title, onWinExtra, d.arena, d.ambush, d.partyMeta, d.subtitle, true);
  }

  // Named modal phase (Plan 021 decision 7/step 6): first phase in update(), and it must
  // return immediately whenever a screen is open so the SAME keypress that just opened
  // or resolved a screen cannot also fall through into a world phase this tick. Opening
  // a screen is handled by the callers (requestBattle()'s two call sites already `return
  // true` right after calling it); this method only ever handles a screen that is
  // ALREADY open, so returning true unconditionally on that branch is correct.
  updateWorldScreens(inp) {
    if (!this.screen) return false;
    const btn = this.screenButtons || {};
    const clickedRect = (r) => !!r && inp.mouse.clicked &&
      inp.mouse.x >= r.x && inp.mouse.x <= r.x + r.w && inp.mouse.y >= r.y && inp.mouse.y <= r.y + r.h;
    if (this.screen.kind === 'brief') {
      const canWithdraw = !!(this.pending && this.pending.descriptor.canWithdraw);
      if (canWithdraw && (inp.pressedAction(ACTIONS.WITHDRAW) || clickedRect(btn.withdraw))) {
        this.cancelBrief();
        return true;
      }
      if (inp.pressedAction(ACTIONS.CONFIRM) || clickedRect(btn.confirm)) {
        this.confirmBrief();
        return true;
      }
      return true;
    }
    if (this.screen.kind === 'aftermath') {
      if (inp.pressedAction(ACTIONS.CONFIRM) || clickedRect(btn.confirm)) {
        this.screen = null;
        return true;
      }
      return true;
    }
    return false;
  }

  // Documented predicate (Plan 021 step 6) so main.js can gate stats.playT accrual
  // without reaching into World internals — a modal genuinely pauses the campaign, so
  // leaving it open must not inflate reported campaign time.
  isBlocking() { return !!this.screen; }

  updateHeroMovement(dt, inp, h) {
    // Movement is the first world phase: interactions and party AI observe its result.
    const ax = inp.axis();
    const SPEED = this.onRoad(h.x, h.y) ? 276 : 240, ACCEL = 900;
    h.vx += ax.x * ACCEL * dt; h.vy += ax.y * ACCEL * dt;
    const sp = len(h.vx, h.vy);
    if (sp > SPEED) { h.vx *= SPEED / sp; h.vy *= SPEED / sp; }
    if (!ax.any) { h.vx *= Math.max(0, 1 - 5 * dt); h.vy *= Math.max(0, 1 - 5 * dt); }
    this.moveBlocked(h,
      clamp(h.x + h.vx * dt, 60, this.W - 60),
      clamp(h.y + h.vy * dt, 60, this.H - 60));
    if (sp > 40) {
      h.facing = angLerp(h.facing, Math.atan2(h.vy, h.vx), 1 - Math.exp(-8 * dt));
      h.bob += dt * 10;
      this.game.sfx.gallop();
      if (this.fxRng() < dt * 10) this.particles.dust(h.x - h.vx * 0.05, h.y + 8, P.cream, 1, this.fxRng);
    }
  }

  // occupation state lives on save.settlements, mirroring how save.camps carries razed/garrison
  isSettlementOccupied(s) {
    const st = this.save.settlements.find(x => x.id === s.id);
    return !!(st && st.occupied);
  }

  updateSettlementInteractions(inp) {
    const s = this.nearSettlement();
    if (s) {
      const pressedService = inp.pressedAction(ACTIONS.RECRUIT_SPEAR) || inp.pressedAction(ACTIONS.WORLD_PRIMARY) ||
        (s.kind === 'town' && inp.pressedAction(ACTIONS.RECRUIT_KNIGHT)) || inp.pressedAction(ACTIONS.HEAL) ||
        (s.kind === 'town' && inp.pressedAction(ACTIONS.EXPAND_ARMY));
      if (this.isSettlementOccupied(s)) {
        if (pressedService) this.say(`${s.name} is occupied — drive off the raiders to restore its service`);
      } else {
        if (inp.pressedAction(ACTIONS.RECRUIT_SPEAR)) this.recruit('spear');
        if (inp.pressedAction(ACTIONS.WORLD_PRIMARY)) this.recruit('archer');
        if (s.kind === 'town' && inp.pressedAction(ACTIONS.RECRUIT_KNIGHT)) this.recruit('knight');
        if (inp.pressedAction(ACTIONS.HEAL)) {
          const healCost = s.freeHeal ? 0 : BALANCE.healCost;
          const heroHurt = this.save.heroHp < this.save.heroMaxHp;
          const troopsHurt = this.save.troops.some(t => t.hp != null && t.hp < UNIT_TYPES[t.type].hp);
          if (!heroHurt && !troopsHurt) this.say('Already rested');
          else if (this.save.gold < healCost) this.say('Not enough gold');
          else {
            this.save.gold -= healCost;
            this.save.heroHp = this.save.heroMaxHp;
            for (const t of this.save.troops) delete t.hp;
            this.game.sfx.coin();
            this.say(s.freeHeal ? 'The hot springs of Coldwell mend every wound — free of charge' : 'Warband rested and healed');
          }
        }
        if (s.kind === 'town' && inp.pressedAction(ACTIONS.EXPAND_ARMY)) {
          const cost = 40 + (this.save.armyCap - BALANCE.armyCapBase) * 20;
          if (this.save.gold >= cost) {
            this.save.gold -= cost; this.save.armyCap += 2;
            this.game.sfx.coin(); this.say(`Army capacity is now ${this.save.armyCap}`);
          } else this.say(`Need ${cost} gold`);
        }
      }
    }
    // Scouting is deliberately after interaction: a newly revealed garrison is visible
    // to the next phase, but cannot consume the same input as a camp assault.
    for (const c of WORLD.camps) {
      const st = this.save.camps.find(x => x.id === c.id);
      if (st.razed || st.garrison || c.stronghold) continue;
      if (dist2(this.hero.x, this.hero.y, c.x, c.y) < 340 * 340) {
        st.garrison = this.rollGarrison(c);
        // Plan 021 design decision 3: report an honest headcount (bodies), not the
        // strength scalar the toast used to print while calling it a headcount.
        const bodies = st.garrison.length, heavy = st.garrison.includes('brute');
        this.say(`Your scouts count the tents — ${bodies} raider${bodies === 1 ? '' : 's'} hold the camp${heavy ? ', brutes among them' : ''}`, 3);
        this.particles.ring(c.x, c.y, 50, P.ink, 0.5, 3);
      }
    }
    return s;
  }

  // Plan 021: the razing/absorption logic that used to be an inline onWinExtra closure
  // built at press time. It now must be rebuildable at CONFIRM time (decision 6: the
  // garrison roll for an unscouted camp is deferred to confirm, so `comp` may not exist
  // yet when the brief opens), so it lives here as a plain method parameterized on the
  // camp/save-camp-state/comp it needs instead of closing over press-time locals.
  campVictoryExtra(camp, st, comp) {
    return () => {
      st.razed = true;
      this.save.gold += camp.stronghold ? 200 : 60;
      if (camp.stronghold) this.save.won = true;
      const strongCamp = WORLD.camps.find(c => c.id === 'strong');
      for (const p of (this.save.parties || [])) {
        if (p.camp === camp.id) { p.camp = 'strong'; p.home = { x: strongCamp.x, y: strongCamp.y }; }
      }
      const razedNow = this.save.camps.filter(c => c.razed && c.id !== 'strong').length;
      if (!camp.stronghold) {
        const humans = comp.filter(t => t === 'bandit' || t === 'raider').length;
        let freed = 0;
        while (freed < Math.min(2, Math.ceil(humans / 3)) && this.save.troops.length < this.save.armyCap) {
          this.save.troops.push({ type: this.simRng() < 0.5 ? 'spear' : 'archer' });
          freed++;
        }
        let remnantNote = '';
        if (razedNow >= 3) {
          const strongSt = this.save.camps.find(c => c.id === 'strong');
          if (!strongSt.garrison) strongSt.garrison = this.rollGarrison(strongCamp);
          const remnants = (this.save.parties || []).filter(p => p.camp === 'strong');
          let absorbed = 0;
          for (const p of remnants) { strongSt.garrison.push(...p.comp); absorbed += p.comp.length; }
          this.save.parties = (this.save.parties || []).filter(p => p.camp !== 'strong');
          remnantNote = absorbed > 0
            ? ` ${absorbed} bandit remnants withdraw into Wolfsjaw and man its walls — storm it!`
            : ' Wolfsjaw stands alone — storm it!';
        }
        this.save.toast = `Camp razed (${razedNow}/3)!` +
          (freed > 0 ? ` ${freed} freed captives join your warband.` : '') + remnantNote;
      }
    };
  }

  // Plan 021 decision 8: WORLD_PRIMARY on a camp/stronghold now opens the brief instead
  // of committing immediately. `comp` in the descriptor is display-only — an unscouted
  // camp shows unknown in the brief (decision 6) and the real roll happens at confirm.
  updateCampInteraction(inp, settlement) {
    const camp = this.nearCamp();
    if (!camp || !inp.pressedAction(ACTIONS.WORLD_PRIMARY) || settlement) return false;
    const razedCount = this.save.camps.filter(c => c.razed && c.id !== 'strong').length;
    if (camp.stronghold && razedCount < 3) {
      this.say(`Wolfsjaw won't fall while its camps still feed it — cut the supply lines (${razedCount}/3)`);
      return true;
    }
    const st = this.save.camps.find(c => c.id === camp.id);
    this.requestBattle({
      campId: camp.id,
      title: camp.stronghold ? `ASSAULT ON ${camp.name.toUpperCase()}` : 'RAID THE CAMP',
      subtitle: camp.stronghold ? 'The final battle — for the realm!' : 'One of the 3 camps — raze it to reach Wolfsjaw',
      arena: 'camp',
      ambush: false,
      approach: this.approachTo(camp.x, camp.y),
      deploy: 4, // YOU are storming THEM — they scramble to arms, not a parade formup
      comp: st.garrison ? st.garrison.slice() : null,
      canWithdraw: true, // explicit WORLD_PRIMARY press — always player-initiated
      partyMeta: { campId: camp.id },
    });
    return true;
  }

  update(dt) {
    this.time += dt;
    const inp = this.game.input, h = this.hero;
    // Plan 021: the brief/aftermath modal phase runs FIRST, mirroring the
    // updateCampInteraction pre-empt idiom below. Returning true here blocks every other
    // world phase for the tick — hero movement, interactions, party AI (so `grace` freezes
    // for free, since it only decays inside updateParties), and spawns/victory — so a
    // modal genuinely pauses the campaign rather than just visually covering it.
    if (this.updateWorldScreens(inp)) return;
    if (this.msgT > 0) this.msgT -= dt;
    this.updateHeroMovement(dt, inp, h);
    const settlement = this.updateSettlementInteractions(inp);
    if (this.updateCampInteraction(inp, settlement)) return;

    this.enforceBeatableFloor();
    if (this.updateParties(dt)) return;

    // camps slowly send out new parties (visible spawn at the camp)
    this.updatePartySpawns(dt);

    // victory
    if (this.save.won) {
      this.game.startVictory(this.save);
      return;
    }

    this.updateCameraAndEffects(dt);
  }

  updateParties(dt) {
    // Party AI owns pursuit, navigation, river-safe movement, and encounter handoff.
    if (this.grace > 0) this.grace -= dt;
    const h = this.hero;
    const heroSafe = this.inSafeZone(h.x, h.y);
    for (const p of this.parties) {
      const pStr = this.strength(p.comp), mine = this.myStrength();
      const dh = Math.sqrt(dist2(p.x, p.y, h.x, h.y));
      let goal = null, speed = 105;
      // sanctuary stops FIGHTING near a settlement, never a party's intent while passing
      // through — otherwise a pursuit route clipping a safe zone flickers the hunt on/off
      const engaged = this.grace <= 0 && !heroSafe;
      if (p.waryT > 0) p.waryT -= dt;
      if (p.chaseT > 0) p.chaseT -= dt;
      if (p.clashT > 0) p.clashT -= dt;

      if (p.raid || p.occupying) {
        // Design decision 3: a party that broke off no longer cares about the hero at
        // all — it beelines for its target settlement and, once there, sits occupying
        // it until defeated. This branch entirely replaces the chase/flee/wander logic.
        if (p.occupying) {
          goal = { x: p.x, y: p.y }; speed = 0; p.mood = 'occupying';
        } else {
          const target = WORLD.settlements.find(s => s.id === p.raid);
          if (dist2(p.x, p.y, target.x, target.y) < BALANCE.raidArrivalR * BALANCE.raidArrivalR) {
            const st = this.save.settlements.find(s => s.id === p.raid);
            st.occupied = true;
            p.occupying = p.raid;
            p.raid = null;
            // Post at the gate rather than freezing wherever the beeline happened to end.
            // The settlement's name and OCCUPIED chips are drawn BELOW it, so an occupier
            // that stopped anywhere south of centre covered its own settlement's name.
            // A canonical post also makes the fight to retake a settlement look the same
            // every time instead of depending on the approach angle.
            const post = this.occupierPost(target);
            p.x = post.x; p.y = post.y; p.vx = 0; p.vy = 0;
            goal = { x: p.x, y: p.y }; speed = 0; p.mood = 'occupying';
            this.say(`${target.name} falls under raider occupation — its service is suspended!`, 3.2);
          } else {
            goal = target; speed = BALANCE.raidSpeed; p.mood = 'raiding';
          }
        }
      } else {
        const detectR = p.waryT > 0 ? 560 : 430; // a party that fled you once keeps watching for you
        if (engaged && (dh < detectR || p.chaseT > 0)) {
          // chasers aim at where you're GOING — interception geometry beats raw speed
          const lead = { x: h.x + h.vx * 1.1, y: h.y + h.vy * 1.1 };
          const fleeBar = p.waryT > 0 ? 1.1 : 0.75; // spooked parties don't re-try near-even odds
          if (pStr > mine * 1.3) { goal = lead; speed = 185; p.mood = 'chase'; }
          else if (pStr >= mine * fleeBar) { goal = lead; speed = 165; p.mood = 'chase'; }
          else if (dh < detectR) {
            goal = { x: p.x + (p.x - h.x) * 2, y: p.y + (p.y - h.y) * 2 }; speed = 195;
            if (p.mood !== 'flee') p.waryT = 25;
            p.mood = 'flee';
          } else p.mood = null;
          // a committed hunt survives the detour: crossing a bridge doesn't make them forget you
          if (p.mood === 'chase' && dh < detectR) p.chaseT = 16;
        } else p.mood = null;

        // Design decision 3: sustained, uncaught chase eventually gives up on the hero and
        // raids the nearest settlement instead — see BALANCE.raidBreakOffT. The floor
        // guarantee (design decision 5 / isSettlementClaimed) refuses the break-off rather
        // than let a break-off claim the last fully unclaimed settlement.
        if (p.mood === 'chase') {
          p.chaseHoldT = (p.chaseHoldT || 0) + dt;
          if (p.chaseHoldT >= BALANCE.raidBreakOffT) {
            const free = WORLD.settlements.filter(s => !this.isSettlementClaimed(s.id));
            if (free.length >= 2) {
              let target = null, bd = Infinity;
              for (const s of free) {
                const d = dist2(p.x, p.y, s.x, s.y);
                if (d < bd) { bd = d; target = s; }
              }
              p.raid = target.id;
              p.mood = 'raiding';
              p.chaseT = 0;
              this.say(`A war party gives up the chase and rides for ${target.name}!`, 3.2);
            } else {
              p.chaseHoldT = 0; // no settlement left to claim safely — keep hunting instead
            }
          }
        } else {
          p.chaseHoldT = 0;
        }
      }

      if (!goal) {
        p.wanderT -= dt;
        if (!p.wander || p.wanderT <= 0) {
          p.wander = { x: p.home.x + (this.simRng() - 0.5) * 700, y: p.home.y + (this.simRng() - 0.5) * 500 };
          p.wanderT = 3 + this.simRng() * 4;
        }
        goal = p.wander; speed = 80;
      }
      // navigation: route to the next visible waypoint (bridge gates, stagings, grid) when
      // the straight line is walled off — cached per party, replanned every ~0.6s
      {
        if (!p._navGoalVisibility) { p._navGoalVisibility = new Float64Array(this.navNodes.length); p._navGoalX = NaN; p._navGoalY = NaN; }
        p.navT = (p.navT == null ? 0 : p.navT) - dt;
        const goalChanged = !!p.navFor && len(goal.x - p.navFor.x, goal.y - p.navFor.y) > 140;
        if (p.navT <= 0 || goalChanged) {
          p.navGoal = this.pathGoal(p.x, p.y, goal, p);
          if (!p.navFor) p.navFor = { x: goal.x, y: goal.y };
          else { p.navFor.x = goal.x; p.navFor.y = goal.y; }
          p.navT = 0.5 + this.simRng() * 0.2;
        }
        const wp = p.navGoal;
        if (wp) goal = wp;
        // hard unstick of last resort: wedged >4s → step out in the first open compass direction
        if ((p.stuckT || 0) > 4) {
          for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            const ux = p.x + Math.cos(a) * 30, uy = p.y + Math.sin(a) * 30;
            if (!this.blockedAt(ux, uy)) { p.x = ux; p.y = uy; p.stuckT = 0; break; }
          }
        }
      }
      speed *= this.onRoad(p.x, p.y) ? 1.15 : 1; // bandits know the roads too
      const dx = goal.x - p.x, dy = goal.y - p.y, d = len(dx, dy) || 1;
      if (d > 10) {
        p.vx = lerp(p.vx, dx / d * speed, 1 - Math.exp(-4 * dt));
        p.vy = lerp(p.vy, dy / d * speed, 1 - Math.exp(-4 * dt));
      } else { p.vx *= 0.9; p.vy *= 0.9; }
      // soft mountain steering: a gentle nudge, never strong enough to cancel pursuit
      for (const o of this.solids) {
        const dd = dist2(p.x, p.y, o.x, o.y);
        const rr = o.r + 26;
        if (dd < rr * rr && dd > 1) {
          // equilibrium contribution ≈ 4/lerp ≈ 60 px/s — a nudge, never a wall
          const dm = Math.sqrt(dd), push = (rr - dm) / rr * 4 * dt * 60;
          p.vx += (p.x - o.x) / dm * push;
          p.vy += (p.y - o.y) / dm * push;
        }
      }
      const prevX = p.x, prevY = p.y;
      const nx2 = clamp(p.x + p.vx * dt, 60, this.W - 60);
      const ny2 = clamp(p.y + p.vy * dt, 60, this.H - 60);
      // parties: only rivers hard-block (bridge-exempt); escape allowed if somehow inside
      if (this.riverBlockedAt(p.x, p.y) || !this.riverBlockedAt(nx2, ny2)) { p.x = nx2; p.y = ny2; }
      else if (!this.riverBlockedAt(nx2, p.y)) { p.x = nx2; p.vy = 0; }
      else if (!this.riverBlockedAt(p.x, ny2)) { p.y = ny2; p.vx = 0; }
      else { p.vx *= 0.2; p.vy *= 0.2; }
      // catch-all unstick: crawling counts as stuck too — measure PROGRESS toward the goal,
      // not raw movement, so a party skimming a bank at 3px/s still gets rescued
      const progress = len(goal.x - prevX, goal.y - prevY) - len(goal.x - p.x, goal.y - p.y);
      if (d > 30 && progress < speed * dt * 0.3) p.stuckT = (p.stuckT || 0) + dt;
      else p.stuckT = 0;
      if (p.mood !== 'chase' && this.blockedAt(p.x + p.vx * dt * 8, p.y + p.vy * dt * 8) && p.wander) {
        p.wanderT = 0; // wandering parties re-pick a goal instead of grinding on terrain
      }
      if (len(p.vx, p.vy) > 20) { p.bob += dt * 9; p.facing = angLerp(p.facing, Math.atan2(p.vy, p.vx), 1 - Math.exp(-6 * dt)); }

      // collision → battle. Bandits dare to strike near village outskirts (110-260 band),
      // but never in the village itself — so village-arena ambushes genuinely happen.
      // Initiative matters: they caught you = ambush; you caught them running = no formup for them;
      // a mutual field meeting = both sides deploy.
      // world.grace (ambush immunity) only gates `engaged` above — it must not block
      // canClash too, or the player can't charge into a party they WANT to fight for the
      // whole post-battle window. The one party that does need a post-disengage cooldown
      // (reinserted right under the hero's feet) carries its own p.clashT instead.
      // Design decision 5: an occupier is exempt from the settlement-safe-zone block —
      // it must always be attackable where it sits, or the player has no recapture path.
      const isOccupier = !!p.occupying;
      const canClash = (p.clashT || 0) <= 0 && (isOccupier || !this.nearSettlement(130)) && dh < 46;
      if ((engaged || (canClash && dh < 46)) && canClash) {
        // Plan 021 decision 8/step 7: request instead of committing. The party splice,
        // persistParties(), battleCount++ and persistRun() all move to confirmBrief() —
        // this party stays exactly where it is, still fightable, until the player decides.
        const ambushed = p.mood === 'chase';
        const caughtThem = p.mood === 'flee';
        const occupiedSettlement = isOccupier ? WORLD.settlements.find(s => s.id === p.occupying) : null;
        this.requestBattle({
          party: p,
          title: occupiedSettlement ? `RETAKE ${occupiedSettlement.name.toUpperCase()}`
            : ambushed ? 'AMBUSHED!' : caughtThem ? 'RUN THEM DOWN!' : 'BANDIT SKIRMISH',
          subtitle: occupiedSettlement ? 'Drive them out and restore the settlement’s service'
            : caughtThem ? 'You caught them running — give no quarter' : 'Roaming party — worth loot, no camp progress',
          arena: null,
          ambush: ambushed,
          approach: this.approachTo(p.x, p.y),
          deploy: caughtThem ? 0 : undefined, // undefined = mutual 8s formup
          comp: p.comp.slice(),
          // Plan 021 decision 5: withdraw is offered only when the player initiated the
          // fight — an explicit camp/stronghold press (handled in updateCampInteraction)
          // or running down a fleeing party. An ambush or a mutual skirmish is committed.
          canWithdraw: caughtThem,
          onWinExtra: occupiedSettlement ? () => {
            const st = this.save.settlements.find(s => s.id === occupiedSettlement.id);
            if (st) st.occupied = false;
            this.save.toast = `${occupiedSettlement.name} is free again — its service resumes.`;
          } : null,
          partyMeta: { camp: p.camp, x: p.x, y: p.y, comp: p.comp.slice(), home: p.home, waryT: p.waryT, occupying: p.occupying },
        });
        return true;
      }
    }
    return false;
  }

  updatePartySpawns(dt) {

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 40;
      const alive = this.liveCamps();
      if (alive.length && this.parties.length < this.partyCap()) {
        // Plan 020: the old fair-band guarantee (forcing almost every spawn into a
        // narrow 0.7-1.2x band) is gone. Every spawn draws from the weighted tiers in
        // spawnParty()/rollPartyBand(); enforceBeatableFloor() is the only remaining
        // safety net, and it only intervenes when nothing beatable exists at all.
        const c = alive[(this.simRng() * alive.length) | 0];
        this.spawnParty(c);
        this.particles.ring(c.x, c.y, 40, P.ink, 0.5, 3);
        this.persistParties();
      }
    }

  }

  updateCameraAndEffects(dt) {
    const h = this.hero;
    const cam = this.game.camera;
    // riding kicks up dust — the hero's cross-bar movement signature (Thronefall + WatG both use it)
    if (Math.hypot(h.vx, h.vy) > 110) {
      this.dustT = (this.dustT || 0) + dt;
      if (this.dustT > 0.09) { this.dustT = 0; this.particles.dust(h.x - h.vx * 0.05, h.y + 8, P.cream, 2, this.fxRng); }
    }
    cam.follow(h.x + h.vx * 0.35, h.y + h.vy * 0.35, dt, 4);
    // clamp the view inside the map so no void shows at the edges
    const vw = cam.w / cam.zoom / 2, vh = cam.h / cam.zoom / 2;
    cam.x = clamp(cam.x, vw - 25, this.W - vw + 25);
    cam.y = clamp(cam.y, vh - 25, this.H - vh + 25);
    this.particles.update(dt);
  }

  // ---------------------------------------------------------------- draw
  draw(ctx) {
    const cam = this.game.camera, h = this.hero;
    const inp = this.game.input;
    // Plan 021: presentation-only hover pass, computed and stored ONLY here — never in
    // update() (AGENTS.md: "simulation must not read presentation"). See the constructor
    // comment for why the latch compares persistent pointer coordinates rather than the
    // transient `moved` flag. Also suppressed while a modal is open or the pointer sits
    // on a HUD rect.
    this.pointerEverMoved = this.pointerEverMoved ||
      inp.mouse.x !== this.pointerBootX || inp.mouse.y !== this.pointerBootY;
    if (this.pointerEverMoved && !this.screen && !isOverHud(inp.mouse.x, inp.mouse.y, cam.w, cam.h)) {
      const wp = cam.toWorld(inp.mouse.x, inp.mouse.y);
      this.hoverTarget = hoverTargetAt(this, wp.x, wp.y);
    } else {
      this.hoverTarget = null;
    }
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, 0, cam.w, cam.h);
    cam.apply(ctx);
    ctx.fillStyle = P.ground;
    ctx.fillRect(-40, -40, this.W + 80, this.H + 80);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 30;
    ctx.strokeRect(-15, -15, this.W + 30, this.H + 30);

    // ground blotches — cooler earth tone WITH the same hard ink edge every other shape
    // class carries (the battle terrain got this; the world map must speak the same language)
    ctx.fillStyle = '#C4873B'; ctx.fill(this._staticPaths.blotches);

    // world light grading: the same sun that lights every object sweeps one broad band
    // across the land; far corners fall into stepped shade — a lit world, not a color fill
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#FFF6E0';
    ctx.fill(this._staticPaths.light);
    ctx.fillStyle = P.ink;
    ctx.globalAlpha = 0.06;
    ctx.fill(this._staticPaths.shade);
    ctx.restore();

    // rivers with bridges
    for (let ri = 0; ri < this.rivers.length; ri++) {
      const r = this.rivers[ri];
      ctx.strokeStyle = P.water; ctx.lineWidth = 34; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke(this._staticPaths.rivers[ri]);
      ctx.strokeStyle = '#7FD9E6'; ctx.lineWidth = 5;
      ctx.setLineDash([12, 26]);
      ctx.stroke(this._staticPaths.rivers[ri]);
      ctx.setLineDash([]);
      for (const [bx, by] of r.bridges) {
        ctx.save();
        ctx.translate(bx, by);
        ctx.fillStyle = P.cream;
        ctx.fillRect(-26, -20, 52, 40);
        ctx.strokeStyle = P.ink; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(-26, -20); ctx.lineTo(26, -20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-26, 20); ctx.lineTo(26, 20); ctx.stroke();
        ctx.restore();
      }
    }

    // roads between settlements
    ctx.strokeStyle = P.cream; ctx.lineWidth = 5; ctx.setLineDash([14, 16]);
    ctx.globalAlpha = 0.32;
    const S = WORLD.settlements;
    // gentle sag through a jittered midpoint: trails worn by travel, not ruler-drawn debug lines
    // no redundant diagonals: roads that crisscross at odd angles read as debug lines
    ctx.stroke(this._staticPaths.roads);
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // scenery below entities
    for (const it of this.scenery) {
      if (!this.visible(it.x, it.y, it.kind === 'mtn' ? it.s * 1.5 : it.s * 2.2)) continue;
      if (it.kind === 'mtn') mountain(ctx, it.x, it.y, it.s, P.ink, P.cream);
      // deep green pines: vegetation must never share a hue family with hostile POI markers
      else if (it.kind === 'tree') tree(ctx, it.x, it.y, it.s, '#4F7231', '#3A5624', P.groundShade);
      // low shrub clumps fill the bare midground between the big scenery pieces
      else if (it.kind === 'shrub') {
        // vegetation, not mud: small dark-olive teardrop cluster in the trees' shape language
        for (const [ox, s2] of [[0, it.s], [it.s * 1.1, it.s * 0.75], [-it.s * 1.0, it.s * 0.65]]) {
          const tx = it.x + ox, ts = s2;
          ctx.fillStyle = '#5C6E31';
          ctx.beginPath(); ctx.moveTo(tx, it.y - ts * 1.6); ctx.lineTo(tx + ts * 0.7, it.y); ctx.lineTo(tx - ts * 0.7, it.y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#46551F';
          ctx.beginPath(); ctx.moveTo(tx, it.y - ts * 1.6); ctx.lineTo(tx + ts * 0.7, it.y); ctx.lineTo(tx, it.y); ctx.closePath(); ctx.fill();
        }
      }
      else rock(ctx, it.x, it.y, it.s, '#C9C4B4', '#8E897C', P.groundShade, it.rot);
    }

    // settlements
    for (const s of WORLD.settlements) if (this.visible(s.x, s.y, 140)) this.drawSettlement(ctx, s);
    // camps
    for (const c of WORLD.camps) {
      const st = this.save.camps.find(x => x.id === c.id);
      if (this.visible(c.x, c.y, 140)) this.drawCamp(ctx, c, st.razed);
    }

    // parties
    for (const p of this.parties) if (this.visible(p.x, p.y, 100)) this.drawParty(ctx, p);

    // hero party
    this.drawHero(ctx);

    this.particles.draw(ctx);

    // screen-space HUD
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // corner cloud vignette — atmosphere continuity with the menu and battle scenes
    ctx.fillStyle = 'rgba(255,246,227,0.92)';
    for (const [ox, oy, r] of [[0, 0, 44], [38, 12, 34], [-32, 14, 30], [18, -24, 26]]) {
      ctx.beginPath(); ctx.arc(-16 + ox, cam.h + 20 + oy, r, 0, TAU); ctx.fill();
    }
    this.drawHud(ctx);
    if (this.hoverTarget) drawHoverPanel(ctx, cam, this.hoverTarget);
    // World-scene modals draw last, over everything else. Each draw*Panel returns the
    // screen-space button rects it just laid out; updateWorldScreens() hit-tests clicks
    // against whatever was drawn last frame, the same lag the existing menuHitRegions
    // pattern (src/main.js) already accepts.
    if (this.screen) {
      if (this.screen.kind === 'brief') this.screenButtons = drawBriefPanel(ctx, cam, this.screen);
      else if (this.screen.kind === 'aftermath') this.screenButtons = drawAftermathPanel(ctx, cam, this.screen);
    } else {
      this.screenButtons = null;
    }
  }

  drawSettlement(ctx, s) {
    const town = s.kind === 'town';
    shadow(ctx, s.x, s.y + 10, town ? 52 : 34, 14, P.groundShade);
    // houses
    const house = (hx, hy, w, hh) => {
      // extruded: lit front + dark side wall + two-tone roof — drawn volume, not a flat glyph
      const ext = w * 0.26;
      ctx.fillStyle = '#3A4A72'; ctx.fillRect(hx - w / 2, hy - hh, w, hh);
      ctx.fillStyle = P.ink;
      ctx.beginPath(); ctx.moveTo(hx + w / 2, hy - hh); ctx.lineTo(hx + w / 2 + ext, hy - hh - ext * 0.4);
      ctx.lineTo(hx + w / 2 + ext, hy - ext * 0.4); ctx.lineTo(hx + w / 2, hy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.cream;
      ctx.beginPath(); ctx.moveTo(hx - w / 2 - 3, hy - hh); ctx.lineTo(hx, hy - hh - w * 0.55); ctx.lineTo(hx + w / 2 + 3, hy - hh); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade('#F2E3C1', 0.8);
      ctx.beginPath(); ctx.moveTo(hx, hy - hh - w * 0.55); ctx.lineTo(hx + w / 2 + 3, hy - hh);
      ctx.lineTo(hx + w / 2 + ext, hy - hh - ext * 0.4); ctx.closePath(); ctx.fill();
    };
    if (town) {
      // keep with towers
      ctx.fillStyle = P.ink; ctx.fillRect(s.x - 45, s.y - 60, 90, 60);
      ctx.fillStyle = P.cream; ctx.fillRect(s.x - 45, s.y - 70, 90, 12);
      for (const tx of [-45, 45]) {
        ctx.fillStyle = P.ink; ctx.fillRect(s.x + tx - 12, s.y - 90, 24, 90);
        ctx.fillStyle = P.cream; ctx.fillRect(s.x + tx - 15, s.y - 98, 30, 10);
      }
      ctx.fillStyle = P.accent;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 98); ctx.lineTo(s.x, s.y - 124); ctx.lineTo(s.x + 20, s.y - 118); ctx.lineTo(s.x, s.y - 112); ctx.closePath(); ctx.fill();
      house(s.x - 80, s.y + 26, 30, 22); house(s.x + 78, s.y + 20, 26, 18);
    } else {
      // tilled fields flank the village: irregular angled furrow strips in two close earth
      // tones — organic farmland, not a debug rectangle with pinstripes
      // a field is a TEXTURE on the ground plane (flat plot + furrow lines inside),
      // never a raised object with edges and shadows
      for (const [fx, fy, rot] of [[-74, 26, -0.16], [54, 36, 0.22]]) {
        ctx.save();
        ctx.translate(s.x + fx, s.y + fy);
        ctx.rotate(rot);
        ctx.fillStyle = '#D9992E';
        ctx.beginPath();
        ctx.moveTo(-26, -13); ctx.lineTo(22, -15); ctx.lineTo(26, 12); ctx.lineTo(-22, 14);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#C4873B'; ctx.lineWidth = 1.6;
        for (let i = -9; i <= 9; i += 4.5) {
          ctx.beginPath(); ctx.moveTo(-22, i); ctx.lineTo(22, i - 1.5); ctx.stroke();
        }
        ctx.restore();
      }
      // varied silhouettes: a long hall, a small hut, and a watchtower — not three same cubes
      house(s.x - 24, s.y + 10, 40, 18);
      house(s.x + 22, s.y + 16, 20, 14);
      ctx.fillStyle = P.ink; ctx.fillRect(s.x - 2, s.y - 34, 12, 26);
      ctx.fillStyle = P.cream;
      ctx.beginPath(); ctx.moveTo(s.x - 6, s.y - 34); ctx.lineTo(s.x + 4, s.y - 44); ctx.lineTo(s.x + 14, s.y - 34); ctx.closePath(); ctx.fill();
      // windmill vane
      ctx.strokeStyle = P.ink; ctx.lineWidth = 3;
      const a = this.time * 0.8;
      ctx.beginPath(); ctx.moveTo(s.x - 40, s.y - 30); ctx.lineTo(s.x - 40, s.y + 6); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const aa = a + i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(s.x - 40, s.y - 30); ctx.lineTo(s.x - 40 + Math.cos(aa) * 16, s.y - 30 + Math.sin(aa) * 16); ctx.stroke();
      }
    }
    // name — on a small cream chip, matching the game's one pill/chip text convention
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const nw = ctx.measureText(s.name).width + 18;
    ctx.fillStyle = P.cream;
    rrect(ctx, s.x - nw / 2, s.y + 34, nw, 20, 6); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    rrect(ctx, s.x - nw / 2, s.y + 34, nw, 20, 6); ctx.stroke();
    ctx.fillStyle = P.ink;
    ctx.fillText(s.name, s.x, s.y + 45);

    // Plan 020 design decision 4: occupied and threatened settlements carry their own
    // map markers, on top of the break-off toast — legibility must not depend on having
    // read a toast that already scrolled away.
    const occupied = this.isSettlementOccupied(s);
    const threatened = !occupied && this.parties.some(p => p.raid === s.id);
    if (occupied) {
      const label = 'OCCUPIED';
      ctx.font = '800 12px system-ui, sans-serif';
      const lw = ctx.measureText(label).width + 16;
      ctx.fillStyle = P.enemy;
      rrect(ctx, s.x - lw / 2, s.y + 58, lw, 18, 6); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      rrect(ctx, s.x - lw / 2, s.y + 58, lw, 18, 6); ctx.stroke();
      ctx.fillStyle = P.cream;
      ctx.fillText(label, s.x, s.y + 70);
    } else if (threatened) {
      // a pulsing warning ring — a raiding party is inbound but has not arrived yet
      const pulse = 6 + Math.sin(this.time * 5) * 3;
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = P.enemy; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.x, s.y, (town ? 76 : 58) + pulse, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawCamp(ctx, c, razed) {
    if (razed) {
      ctx.strokeStyle = P.groundShade; ctx.lineWidth = 4;
      for (const [ox, oy] of [[-14, -8], [10, -4], [-2, 10]]) {
        ctx.beginPath(); ctx.moveTo(c.x + ox - 7, c.y + oy - 7); ctx.lineTo(c.x + ox + 7, c.y + oy + 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(c.x + ox + 7, c.y + oy - 7); ctx.lineTo(c.x + ox - 7, c.y + oy + 7); ctx.stroke();
      }
      return;
    }
    shadow(ctx, c.x, c.y + 8, c.stronghold ? 52 : 28, 12, P.groundShade);
    const tent = (tx, ty, s) => {
      ctx.fillStyle = P.enemy;
      ctx.beginPath(); ctx.moveTo(tx - s, ty); ctx.lineTo(tx, ty - s * 1.2); ctx.lineTo(tx + s, ty); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.ink;
      ctx.beginPath(); ctx.moveTo(tx, ty - s * 1.2); ctx.lineTo(tx + s, ty); ctx.lineTo(tx + s * 0.2, ty); ctx.closePath(); ctx.fill();
      // door notch + pennant pole: a POI silhouette, not another tree-cone
      ctx.fillStyle = P.ink;
      ctx.beginPath(); ctx.moveTo(tx - s * 0.28, ty); ctx.lineTo(tx, ty - s * 0.55); ctx.lineTo(tx + s * 0.28, ty); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx, ty - s * 1.2); ctx.lineTo(tx, ty - s * 1.2 - 9); ctx.stroke();
      ctx.fillStyle = P.enemy;
      ctx.beginPath(); ctx.moveTo(tx, ty - s * 1.2 - 9); ctx.lineTo(tx + 8, ty - s * 1.2 - 6); ctx.lineTo(tx, ty - s * 1.2 - 3); ctx.closePath(); ctx.fill();
    };
    if (c.stronghold) {
      // palisade fort
      ctx.fillStyle = P.ink; ctx.fillRect(c.x - 60, c.y - 44, 120, 48);
      ctx.fillStyle = P.enemy; ctx.fillRect(c.x - 60, c.y - 52, 120, 10);
      tent(c.x - 26, c.y + 26, 15); tent(c.x + 26, c.y + 28, 17);
      ctx.fillStyle = P.enemy;
      ctx.beginPath(); ctx.moveTo(c.x, c.y - 52); ctx.lineTo(c.x, c.y - 80); ctx.lineTo(c.x + 20, c.y - 73); ctx.lineTo(c.x, c.y - 66); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.ink;
      ctx.font = '800 15px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(c.name, c.x, c.y + 58);
    } else {
      tent(c.x - 16, c.y + 6, 14); tent(c.x + 14, c.y + 10, 12);
      // campfire
      ctx.fillStyle = P.accent;
      ctx.beginPath(); ctx.arc(c.x + 2, c.y - 10 + Math.sin(this.time * 7) * 1.5, 5 + Math.sin(this.time * 11) * 1.2, 0, TAU); ctx.fill();
      // label — scouted camps show what your scouts counted; unscouted stay a mystery
      const est = this.garrisonStrength(c);
      ctx.fillStyle = P.enemy;
      // same cream chip convention as settlement names — clamped inside the map so the
      // label can never be clipped by the viewport edge
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const cw2 = ctx.measureText('Bandit camp').width + 16;
      const ly2 = Math.min(c.y + 24, this.H - 30);
      ctx.fillStyle = P.cream;
      rrect(ctx, c.x - cw2 / 2, ly2, cw2, 19, 6); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      rrect(ctx, c.x - cw2 / 2, ly2, cw2, 19, 6); ctx.stroke();
      ctx.fillStyle = P.enemy;
      ctx.fillText('Bandit camp', c.x, ly2 + 10);
    }
  }

  drawParty(ctx, p) {
    shadow(ctx, p.x, p.y + 4, 12, 10, P.groundShade);
    const bobY = Math.sin(p.bob) * 1.6;
    // enemy rider: dark figure with red banner
    ctx.fillStyle = P.enemy;
    rrect(ctx, p.x - 12, p.y - 14 + bobY, 24, 11, 5); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
    for (const off of [-7, 0, 7]) {
      ctx.beginPath(); ctx.moveTo(p.x + off, p.y - 4 + bobY); ctx.lineTo(p.x + off, p.y + 4); ctx.stroke();
    }
    ctx.fillStyle = P.ink;
    ctx.beginPath(); ctx.arc(p.x + Math.cos(p.facing) * 8, p.y - 18 + bobY, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = P.enemy;
    ctx.beginPath(); ctx.arc(p.x, p.y - 20 + bobY, 6, 0, TAU); ctx.fill();
    // Plan 021 design decision 1: the badge shows BODIES (p.comp.length), never strength —
    // strength stays internal and keeps driving stronger/outmatched/the odds pill below.
    // Strength itself is unchanged and still computed here for those judgments.
    const pStr = this.strength(p.comp), mineStr = this.myStrength();
    const bodies = p.comp.length;
    const heavy = p.comp.includes('brute');
    const stronger = pStr > mineStr * 1.15;
    // Plan 020 design decision 4: an explicit outmatched marker, readable at scouting
    // range (i.e. as soon as the party is on screen at all) rather than only once the
    // hero is close enough to trigger the odds pill below. The threshold matches the
    // AI's own "will hunt you down regardless" band so the glyph means something real.
    const outmatched = pStr > mineStr * 1.3;
    ctx.fillStyle = stronger ? P.enemy : P.ink;
    ctx.beginPath(); ctx.arc(p.x + 16, p.y - 26, 9.5, 0, TAU); ctx.fill();
    // Plan 021 design decision 2: a brute-bearing party gets a non-numeric heavy-unit
    // marker — a dark ring around the badge — instead of a second number. Drawn against
    // the background (radius 12.5 vs the badge's 9.5), so it reads regardless of the
    // badge's own fill color.
    if (heavy) {
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(p.x + 16, p.y - 26, 12.5, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = P.cream;
    ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(bodies), p.x + 16, p.y - 25);
    if (outmatched) {
      ctx.fillStyle = P.enemy;
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.fillText('⚠', p.x + 16, p.y - 40);
    }
    if (p.mood === 'flee') {
      ctx.fillStyle = P.ink;
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillText('!', p.x - 14, p.y - 26);
    }
    // close parties get an honest odds word — the NUMBER already lives in the badge,
    // so the floating text carries only the judgment (one number convention per token)
    const dh = dist2(p.x, p.y, this.hero.x, this.hero.y);
    if (dh < 420 * 420) {
      ctx.fillStyle = stronger ? P.enemy : P.ink;
      ctx.font = '800 11px system-ui, sans-serif';
      // odds word sits in the same pill language as every other label
      const oddsTxt = stronger ? '⚠ they outmatch you' : pStr < mineStr * 0.85 ? 'favored' : 'an even fight';
      const ow = ctx.measureText(oddsTxt).width + 14;
      ctx.fillStyle = P.cream;
      rrect(ctx, p.x - ow / 2, p.y - 58, ow, 17, 5); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
      rrect(ctx, p.x - ow / 2, p.y - 58, ow, 17, 5); ctx.stroke();
      ctx.fillStyle = stronger ? P.enemy : P.ink;
      ctx.fillText(oddsTxt, p.x, p.y - 49);
    }
  }

  drawHero(ctx) {
    const h = this.hero;
    // trailing warband figures — the map shows YOUR band: spears, bows, knights are tellable
    const troopsArr = this.save.troops;
    const n = Math.min(6, Math.ceil(troopsArr.length / 2));
    for (let i = n - 1; i >= 0; i--) {
      const t = troopsArr[Math.min(troopsArr.length - 1, i * 2)];
      const a = h.facing + Math.PI + (i % 2 === 0 ? 0.35 : -0.35);
      const d = 24 + i * 14;
      const tx = h.x + Math.cos(a) * d, ty = h.y + Math.sin(a) * d * 0.7;
      const tb = Math.sin(h.bob - i * 0.9) * 1.4;
      const knight = t && t.type === 'knight';
      shadow(ctx, tx, ty + 2, knight ? 6 : 5, 6, P.groundShade);
      ctx.fillStyle = '#BFD7E8';
      rrect(ctx, tx - (knight ? 5 : 4), ty - (knight ? 12 : 10) + tb, knight ? 10 : 8, knight ? 12 : 10, 3); ctx.fill();
      ctx.fillStyle = knight ? P.hero : P.ink;
      ctx.beginPath(); ctx.arc(tx, ty - (knight ? 14 : 12) + tb, 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
      if (t && t.type === 'spear') {
        ctx.beginPath(); ctx.moveTo(tx + 4, ty - 4 + tb); ctx.lineTo(tx + 8, ty - 16 + tb); ctx.stroke();
      } else if (t && t.type === 'archer') {
        ctx.beginPath(); ctx.arc(tx + 5, ty - 8 + tb, 4, -1.1, 1.1); ctx.stroke();
      }
    }
    shadow(ctx, h.x, h.y + 4, 13, 12, P.groundShade);
    const bobY = Math.sin(h.bob) * 1.8;
    // hero always reads instantly at map zoom: a persistent cream accent ring under the token
    ctx.strokeStyle = P.cream; ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(h.x, h.y - 8, 24, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    // horse
    ctx.fillStyle = P.hero;
    rrect(ctx, h.x - 14, h.y - 16 + bobY, 28, 12, 5); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
    for (const off of [-8, -1, 6]) {
      ctx.beginPath(); ctx.moveTo(h.x + off, h.y - 5 + bobY); ctx.lineTo(h.x + off, h.y + 4); ctx.stroke();
    }
    ctx.fillStyle = P.ink;
    ctx.beginPath(); ctx.arc(h.x + Math.cos(h.facing) * 10, h.y - 19 + bobY, 5, 0, TAU); ctx.fill();
    // rider
    ctx.fillStyle = P.hero;
    ctx.beginPath(); ctx.arc(h.x, h.y - 23 + bobY, 6.5, 0, TAU); ctx.fill();
    // banner
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(h.x - 7, h.y - 22 + bobY); ctx.lineTo(h.x - 7, h.y - 52 + bobY); ctx.stroke();
    ctx.fillStyle = P.enemy;
    const wave = Math.sin(this.time * 6) * 2;
    ctx.beginPath(); ctx.moveTo(h.x - 7, h.y - 52 + bobY); ctx.lineTo(h.x + 12, h.y - 46 + bobY + wave * 0.3); ctx.lineTo(h.x - 7, h.y - 40 + bobY); ctx.closePath(); ctx.fill();
    // Plan 021 design decision 1: warband badge shows BODIES (troops + the hero
    // himself), same convention as party/camp badges — strength stays internal.
    ctx.fillStyle = P.ink;
    ctx.beginPath(); ctx.arc(h.x + 18, h.y - 30, 9.5, 0, TAU); ctx.fill();
    ctx.fillStyle = P.hero;
    ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(this.save.troops.length + 1), h.x + 18, h.y - 29);
  }

  drawHud(ctx) {
    const cam = this.game.camera;
    const W = cam.w, H = cam.h;
    // top-left: gold, army
    ctx.fillStyle = P.ink;
    rrect(ctx, 14, 14, 240, 36, 8); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`⛃ ${this.save.gold}    ⚔ ${this.save.troops.length}/${this.save.armyCap}    ♥ ${this.save.heroHp}/${this.save.heroMaxHp}`, 26, 32);

    // objective (honest about the gate)
    const razed = this.save.camps.filter(c => c.razed && c.id !== 'strong').length;
    ctx.fillStyle = P.ink;
    rrect(ctx, W - 320, 14, 306, 36, 8); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.textAlign = 'right';
    ctx.fillText(razed < 3 ? `Raze the bandit camps (${razed}/3) to unlock Wolfsjaw` : 'Storm Wolfsjaw Hold!', W - 28, 32);

    // context prompt
    const s = this.nearSettlement();
    const camp = this.nearCamp();
    let lines = null;
    if (s && this.isSettlementOccupied(s)) {
      lines = [`${s.name} — OCCUPIED`, 'A raiding party has seized it — its service is suspended', 'Defeat them here to drive them out'];
    } else if (s) {
      const sc = this.costAt(s, 'spear'), ac = this.costAt(s, 'archer');
      const healTxt = s.freeHeal ? 'F Rest & heal FREE' : `F Rest & heal ${BALANCE.healCost}g`;
      lines = s.kind === 'town'
        ? [`${s.name} — ${s.flavor}`, `Q Spearman ${sc}g · E Archer ${ac}g · R Knight ${UNIT_TYPES.knight.cost}g`, `${healTxt} · T +2 army cap ${40 + (this.save.armyCap - BALANCE.armyCapBase) * 20}g`]
        : [`Village of ${s.name} — ${s.flavor}`, `Q Spearman ${sc}g · E Archer ${ac}g · ${healTxt}`];
    } else if (camp) {
      const razedC = this.save.camps.filter(c => c.razed && c.id !== 'strong').length;
      const est = this.garrisonStrength(camp), mine = this.myStrength();
      // Plan 021 design decision 3: proximity prompts carry only the odds WORD, never a
      // strength number — badges are bodies, prompts are words, hover shows both. Hover
      // the camp for the full breakdown.
      const odds = est == null ? 'ride closer to scout it' : est > mine * 1.15 ? '⚠ they outmatch you' : est < mine * 0.85 ? 'favored' : 'an even fight';
      lines = camp.stronghold
        ? (razedC < 3 ? [`${camp.name} — enemy stronghold`, `Its camps still feed it: cut the supply lines (${razedC}/3)`] : [`${camp.name} — enemy stronghold`, odds, 'E Storm the hold!'])
        : [`Bandit camp — ${odds}`, 'E Raid the camp (counts toward the 3)'];
    }
    if (lines) {
      const bw = 420, bx = W / 2 - bw / 2, by = H - 96;
      ctx.fillStyle = P.ink;
      rrect(ctx, bx, by, bw, lines.length * 22 + 16, 10); ctx.fill();
      ctx.fillStyle = P.cream; ctx.textAlign = 'center';
      lines.forEach((l, i) => {
        ctx.font = i === 0 ? '800 15px system-ui, sans-serif' : '600 13px system-ui, sans-serif';
        ctx.fillText(l, W / 2, by + 20 + i * 22);
      });
    }

    // toast
    if (this.msgT > 0 && this.msg) {
      ctx.globalAlpha = Math.min(1, this.msgT * 2);
      ctx.fillStyle = P.ink;
      const tw = ctx.measureText(this.msg).width + 50;
      rrect(ctx, W / 2 - tw / 2, 70, tw, 34, 8); ctx.fill();
      ctx.fillStyle = P.cream;
      ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.msg, W / 2, 88);
      ctx.globalAlpha = 1;
    }
  }
}
