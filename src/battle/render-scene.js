// Battle scene composition: ground, props, the depth-sorted actor pass, HP-bar culling,
// then the HUD on top. `drawScene` is the whole frame — Battle.draw() delegates to it.
// `drawProps` is also called once at construction to bake the static prop layer.
import { UNIT_TYPES, ENEMY_TYPES } from '../data.js?v=r86e441c703d5';
import { TAU, clamp, lerp, len, shadow, shade, tree, rock, hpBar, balloon } from '../engine.js?v=r86e441c703d5';
import { stableSortPrefix } from './spatial-index.js?v=r86e441c703d5';
import { SQUAD_TYPES, DEPLOY_NO_MANS } from './constants.js?v=r86e441c703d5';
import { CROSSING_OPEN_HALF } from './terrain.js?v=r86e441c703d5';
import { drawTroop, drawEnemy, drawHero } from './render-units.js?v=r86e441c703d5';
import { drawHud } from './hud.js?v=r86e441c703d5';

// ------------------------------------------------------------- drawing

// Milestone 025 Slice C: the Hold objective's marked ground. Flat ring + soft fill,
// drawn under every actor; state colour carries the meaning (cream = unclaimed,
// green = held, red pulse = contested). Presentation only — reads battle.objective,
// writes nothing.
function drawObjectiveGround(battle, ctx) {
  const P = battle.palette;
  const o = battle.objective;
  if (!o || o.kind !== 'hold') return;
  const contested = o.contested;
  const held = o.held;
  ctx.save();
  ctx.globalAlpha = 0.10 + (contested ? 0.05 * (1 + Math.sin(battle.time * 8)) : 0);
  ctx.fillStyle = contested ? P.enemy : held ? P.hp : P.cream;
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = contested ? P.enemy : held ? P.hp : P.cream;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 14]);
  ctx.lineDashOffset = -battle.time * 30;
  ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.stroke();
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // centre banner: the ground has a standard, not just a boundary
  ctx.strokeStyle = P.ink; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - 44); ctx.stroke();
  ctx.fillStyle = contested ? P.enemy : P.friend;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y - 44); ctx.lineTo(o.x + 24, o.y - 36); ctx.lineTo(o.x, o.y - 28);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Plan 033: the deployment ground, drawn only while the paused placement phase is up.
// The player's side carries a faint friendly tint and a solid dashed frontier; the enemy's
// frontier is fainter — informational, the player cannot place anything there.
// Everything here derives from adx/ady, the same vector clampToDeployZone projects against,
// so the tinted ground and the enforced ground cannot disagree (the string-keyed approach
// table is not a second source of truth for this geometry).
function drawDeployZones(battle, ctx) {
  if (battle.state !== 'deploy') return;
  const P = battle.palette;
  const cx = battle.W / 2, cy = battle.H / 2, D = DEPLOY_NO_MANS;
  const fx = cx - battle.adx * D, fy = cy - battle.ady * D; // player frontier point
  const ex = cx + battle.adx * D, ey = cy + battle.ady * D; // enemy frontier point
  const px = -battle.ady, py = battle.adx;                  // along-frontier direction
  // Half-length of a frontier line: exactly the field's extent along the frontier plus a
  // hair, not max(W,H) both ways — the dash pattern tessellates the whole stroked length,
  // and ~80% of a 5000-unit line is off-camera every frame.
  const L = (Math.abs(px) * battle.W + Math.abs(py) * battle.H) / 2 + 40;
  ctx.save();
  // the player's ground: the half-plane behind his frontier, extruded away from the enemy
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = P.friend;
  ctx.beginPath();
  ctx.moveTo(fx - px * L, fy - py * L);
  ctx.lineTo(fx + px * L, fy + py * L);
  ctx.lineTo(fx + px * L - battle.adx * L * 2, fy + py * L - battle.ady * L * 2);
  ctx.lineTo(fx - px * L - battle.adx * L * 2, fy - py * L - battle.ady * L * 2);
  ctx.closePath(); ctx.fill();
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 14]);
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = P.friend;
  ctx.beginPath(); ctx.moveTo(fx - px * L, fy - py * L); ctx.lineTo(fx + px * L, fy + py * L); ctx.stroke();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = P.enemy;
  ctx.beginPath(); ctx.moveTo(ex - px * L, ey - py * L); ctx.lineTo(ex + px * L, ey + py * L); ctx.stroke();
  ctx.setLineDash([]);
  // the body being placed
  const drag = battle.dragUnit;
  if (drag) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = P.hero;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(drag.x, drag.y, (drag.d ? drag.d.radius : 14) + 10, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

// A defensive guard: a palisade tower with an enemy pennant — a structure with
// health, not another unit silhouette.
export function drawGuard(battle, ctx, o) {
  const P = battle.palette;
  ctx.save();
  if (o.flash > 0) { ctx.globalAlpha = 0.85; }
  // palisade body
  ctx.fillStyle = '#6B5233';
  ctx.beginPath();
  ctx.moveTo(o.x - o.r, o.y);
  ctx.lineTo(o.x - o.r, o.y - o.r * 1.7);
  for (let i = 0; i < 4; i++) {
    const px = o.x - o.r + (i + 0.5) * (o.r / 2);
    ctx.lineTo(px, o.y - o.r * 2.1);
    ctx.lineTo(px + o.r / 4, o.y - o.r * 1.7);
  }
  ctx.lineTo(o.x + o.r, o.y);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.stroke();
  // pennant
  ctx.beginPath(); ctx.moveTo(o.x, o.y - o.r * 2.1); ctx.lineTo(o.x, o.y - o.r * 2.6); ctx.stroke();
  ctx.fillStyle = P.enemy;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y - o.r * 2.6); ctx.lineTo(o.x + 16, o.y - o.r * 2.35); ctx.lineTo(o.x, o.y - o.r * 2.1);
  ctx.closePath(); ctx.fill();
  if (o.flash > 0) {
    ctx.globalAlpha = Math.min(1, o.flash * 6);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(o.x, o.y - o.r, o.r * 0.9, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
export function drawScene(battle, ctx) {
  const P = battle.palette;
  battle._alertCount = 0; // per-frame alert cluster-cull registry
  // paint the whole screen in the biome's shade tone FIRST — the battle sits on
  // continuous terrain, never on a floating "arena card" over the canvas default
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = P.groundShade;
  ctx.fillRect(0, 0, battle.game.camera.w, battle.game.camera.h);
  battle.game.camera.apply(ctx);
  const cam = battle.game.camera, h = battle.hero;
  // the arena is an island in teal water (Thronefall levels float in stylized voids)
  ctx.fillStyle = P.water;
  ctx.fillRect(0, 0, cam.w, cam.h);
  cam.apply(ctx);
  // wave dashes in the water, in world space so they parallax naturally
  ctx.strokeStyle = '#7FD9E6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const wx = ((i * 517) % (battle.W + 1200)) - 600;
    const wy = ((i * 331) % (battle.H + 900)) - 450;
    if (wx > -80 && wx < battle.W + 80 && wy > -60 && wy < battle.H + 60) continue; // only outside the island
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + 26, wy); ctx.stroke();
  }
  // island: ink cliff base, then ground on top
  ctx.fillStyle = P.ink;
  ctx.fill(battle._staticPaths.islandInk);
  ctx.fillStyle = P.ground;
  ctx.fill(battle._staticPaths.islandGround);
  ctx.strokeStyle = P.groundShade; ctx.lineWidth = 8;
  ctx.stroke(battle._staticPaths.islandBorder);
  // large second-tone regions: strong enough to read as landform, with a hard darker
  // edge on the light-away side so the patch reads as carved elevation, not a smudge
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = P.groundShade;
  ctx.fill(battle._staticPaths.regions);
  ctx.restore(); // no edge stroke at all: a line across same-biome ground is a seam, not art
  // per-scene light grading: one broad diagonal LIGHT band across the field (the sun falls
  // somewhere) + stepped shade wedges in the far corners — scene lighting, drawn flat
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.fillStyle = '#FFF6E0';
  ctx.fill(battle._staticPaths.light);
  ctx.fillStyle = P.ink;
  ctx.globalAlpha = 0.10;
  ctx.fill(battle._staticPaths.shadeNear);
  ctx.globalAlpha = 0.07;
  ctx.fill(battle._staticPaths.shadeFar);
  ctx.restore();
  // blotches
  ctx.fillStyle = P.groundShade;
  ctx.fill(battle._staticPaths.blotches);
  // Plan 024 Phase 6d: the static prop layer is a 2x2 grid of bounded canvases (built once
  // in the Battle constructor), not one arena-sized bitmap. Blit only the tiles the camera
  // can actually see this frame — cheap because there are only ever 4 — using the same
  // world-space frustum every other culled static geometry in this codebase computes via
  // `cam.toWorld`.
  const viewTL = cam.toWorld(0, 0), viewBR = cam.toWorld(cam.w, cam.h);
  const vx0 = Math.min(viewTL.x, viewBR.x), vx1 = Math.max(viewTL.x, viewBR.x);
  const vy0 = Math.min(viewTL.y, viewBR.y), vy1 = Math.max(viewTL.y, viewBR.y);
  for (const tile of battle._staticTiles) {
    if (tile.wx + tile.ww < vx0 || tile.wx > vx1 || tile.wy + tile.wh < vy0 || tile.wy > vy1) continue;
    ctx.drawImage(tile.canvas, tile.wx, tile.wy);
  }
  drawProps(battle, ctx, true);

  // Milestone 025 Slice C: the Hold objective's marked ground — a dashed banner ring
  // on the ground plane, under every unit. Contested pulses red; held glows green.
  drawObjectiveGround(battle, ctx);

  // Plan 033: deployment ground, under every actor like the objective ring above.
  drawDeployZones(battle, ctx);

  // Hold banners: one per squad actually holding, drawn from that squad's own anchor.
  // This was gated on the aggregate `command === 'hold'`, which is never 'hold' under a
  // split order - so the feature's in-world affordance vanished exactly when squads were
  // used independently, and the per-squad anchors were written but never read.
  for (const type of SQUAD_TYPES) {
    const squad = battle.squads[type];
    if (squad.stance !== 'hold' || squad.holdX == null) continue;
    if (!battle.troops.some(t => t.type === type)) continue;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(squad.holdX, squad.holdY); ctx.lineTo(squad.holdX, squad.holdY - 34); ctx.stroke();
    ctx.fillStyle = P.friend;
    ctx.beginPath(); ctx.moveTo(squad.holdX, squad.holdY - 34); ctx.lineTo(squad.holdX + 18, squad.holdY - 28);
    ctx.lineTo(squad.holdX, squad.holdY - 22); ctx.closePath(); ctx.fill();
  }

  // depth sort drawables
  const draws = battle._drawEntries;
  for (const entry of draws) entry.ref = null;
  const oldDrawLength = draws.length;
  let drawCount = 0;
  for (const o of battle.obstacles) {
    // Plan 034: 'none' colliders (river chain, crossing plugs) draw nothing — skipping
    // them HERE, not just in drawObstacle, keeps ~80 no-op entries per river fight out of
    // the per-frame stable sort and out of the orderingItems counter the perf specs read.
    if (o.kind === 'none') continue;
    const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
    entry.y = o.y; entry.kind = 0; entry.ref = o; drawCount++;
  }
  for (const t of battle.troops) {
    const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
    entry.y = t.y; entry.kind = 1; entry.ref = t; drawCount++;
  }
  for (const e of battle.enemies) {
    const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
    entry.y = e.y; entry.kind = 2; entry.ref = e; drawCount++;
  }
  // Break-the-position guards sort with the pile so units can stand behind them.
  for (const o of battle.objectiveTargets || []) {
    if (o.dead) continue;
    const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
    entry.y = o.y; entry.kind = 4; entry.ref = o; drawCount++;
  }
  const heroEntry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
  heroEntry.y = h.y; heroEntry.kind = 3; heroEntry.ref = h; drawCount++;
  for (let i = drawCount; i < oldDrawLength; i++) draws[i].ref = null;
  battle._drawEntriesActive = drawCount;
  battle._spatialCounters.orderingItems += drawCount;
  stableSortPrefix(draws, drawCount, battle._drawSortScratch, (a, b) => a.y - b.y);
  // shadows first
  for (const t of battle.troops) shadow(ctx, t.x, t.y + 2, t.d.radius, 12, P.groundShade);
  for (const e of battle.enemies) shadow(ctx, e.x, e.y + 2, e.d.radius, 12, P.groundShade);
  for (const o of battle.objectiveTargets || []) if (!o.dead) shadow(ctx, o.x, o.y + 2, o.r, 20, P.groundShade);
  shadow(ctx, h.x, h.y + 4, 15, 16, P.groundShade);
  for (let i = 0; i < drawCount; i++) {
    const d = draws[i];
    if (d.kind === 0) drawObstacle(battle, ctx, d.ref);
    else if (d.kind === 1) drawTroop(battle, ctx, d.ref);
    else if (d.kind === 2) drawEnemy(battle, ctx, d.ref);
    else if (d.kind === 4) drawGuard(battle, ctx, d.ref);
    else drawHero(battle, ctx);
  }
  // the commander is never buried: while hurt (and at the death moment) he draws above the pile
  if (h.hurtT > 0 || h.hp <= 0) drawHero(battle, ctx);

  // projectiles (arrows with arc + trail)
  for (const p of battle.projectiles) {
    const k = p.t / p.T;
    const x = lerp(p.sx, p.tx, k), y = lerp(p.sy, p.ty, k);
    const arcH = Math.sin(k * Math.PI) * Math.min(70, len(p.tx - p.sx, p.ty - p.sy) * 0.22);
    ctx.strokeStyle = P.cream; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    const k2 = Math.max(0, k - 0.12);
    const x2 = lerp(p.sx, p.tx, k2), y2 = lerp(p.sy, p.ty, k2);
    const arcH2 = Math.sin(k2 * Math.PI) * Math.min(70, len(p.tx - p.sx, p.ty - p.sy) * 0.22);
    ctx.moveTo(x2, y2 - arcH2); ctx.lineTo(x, y - arcH); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  battle.particles.draw(ctx);

  // HP bars (world space)
  // scrum readability: slimmer bars, and only for meaningfully wounded units (<90%)
  // density-gated: most-wounded units draw first, then any bar landing within 20px of an
  // already-drawn bar is skipped — packed melees show a few meaningful bars, not a bar wall
  const wounded = battle._woundedEntries;
  for (const entry of wounded) entry.u = null;
  let woundedCount = 0;
  for (const t of battle.troops) if (t.hp / t.maxHp < 0.9) {
    const entry = wounded[woundedCount] || (wounded[woundedCount] = { u: null, w: 0, fill: null });
    entry.u = t; entry.w = 24; entry.fill = P.hp; woundedCount++;
  }
  for (const e of battle.enemies) if (e.hp / e.maxHp < 0.9) {
    const entry = wounded[woundedCount] || (wounded[woundedCount] = { u: null, w: 0, fill: null });
    entry.u = e; entry.w = e.type === 'brute' ? 38 : 24; entry.fill = P.hp; woundedCount++;
  }
  battle._woundedEntriesActive = woundedCount;
  battle._spatialCounters.orderingItems += woundedCount;
  stableSortPrefix(wounded, woundedCount, battle._woundedSortScratch,
    (a, b) => a.u.hp / a.u.maxHp - b.u.hp / b.u.maxHp);
  // regional overlay budget: max 3 bars per ~120px region — past that a cluster is a
  // single wounded MASS, not individually-tracked units (Thronefall's hierarchy rule)
  const drawnBars = battle._drawnBars;
  let barCount = 0;
  for (let wi = 0; wi < woundedCount; wi++) {
    const { u, w, fill } = wounded[wi];
    const bx = u.x, by = u.y - u.d.radius * 3;
    let overlap = false, regionCount = 0;
    for (let i = 0; i < barCount; i++) {
      const bar = drawnBars[i];
      if (Math.abs(bar.x - bx) < 26 && Math.abs(bar.y - by) < 14) overlap = true;
      if (Math.abs(bar.x - bx) < 120 && Math.abs(bar.y - by) < 120) regionCount++;
    }
    if (overlap) continue;
    if (regionCount >= 3) continue;
    const bar = drawnBars[barCount] || (drawnBars[barCount] = { x: 0, y: 0 });
    bar.x = bx; bar.y = by;
    barCount++;
    hpBar(ctx, bx, by, w, u.hp / u.maxHp, P.hpBack, fill);
  }
  for (let i = barCount; i < drawnBars.length; i++) { drawnBars[i].x = 0; drawnBars[i].y = 0; }
  battle._drawnBarsActive = barCount;

  // squad balloons: one per unit type cluster (centroid)
  drawBalloons(battle, ctx);

  // HUD (screen space)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // corner cloud vignette — the same atmosphere motif as the menu, carried into gameplay
  const cw = battle.game.camera.w, ch = battle.game.camera.h;
  ctx.fillStyle = 'rgba(255,246,227,0.92)';
  for (const [ox, oy, r] of [[0, 0, 46], [40, 12, 36], [-34, 14, 32], [20, -26, 28]]) {
    ctx.beginPath(); ctx.arc(cw - 10 + ox, -18 + oy, r, 0, TAU); ctx.fill();
  }
  drawHud(battle, ctx);
}

export function drawBalloons(battle, ctx) {
  const P = battle.palette;
  const s = clamp(1 / battle.game.camera.zoom, 1, 1.7);
  // at mass-battle zoom: ONE badge per side (dominant type) — the silhouettes carry unit
  // identity now, and a stack of per-type badges over a melee drowns the fight it labels
  const massZoom = battle.game.camera.zoom < 0.95 || (battle.troops.length + battle.enemies.length) > 12;
  const groups = battle._groups, eg = battle._enemyGroups;
  for (const type in UNIT_TYPES) { if (!groups[type]) groups[type] = []; else groups[type].length = 0; }
  for (const type in ENEMY_TYPES) { if (!eg[type]) eg[type] = []; else eg[type].length = 0; }
  for (const t of battle.troops) groups[t.type].push(t);
  for (const e of battle.enemies) eg[e.type].push(e);
  if (massZoom) {
    let td = null, ed = null;
    for (const type in groups) if (groups[type].length && (!td || groups[type].length > groups[td].length)) td = type;
    for (const type in eg) if (eg[type].length && (!ed || eg[type].length > eg[ed].length)) ed = type;
    if (td) drawCentroidBalloon(battle, ctx, battle.troops, UNIT_TYPES[td].icon, P.ink, P.cream, 56, s);
    if (ed) drawCentroidBalloon(battle, ctx, battle.enemies, ENEMY_TYPES[ed].icon, P.enemyDark, P.enemyAccent, 58, s);
  } else {
    let ti = 0;
    for (const type in groups) if (groups[type].length) drawCentroidBalloon(battle, ctx, groups[type], UNIT_TYPES[type].icon, P.ink, P.cream, 56 + (ti++) * 28, s);
    let ei = 0;
    for (const type in eg) if (eg[type].length) drawCentroidBalloon(battle, ctx, eg[type], ENEMY_TYPES[type].icon, P.enemyDark, P.enemyAccent, 58 + (ei++) * 28, s);
  }
}

export function drawCentroidBalloon(battle, ctx, group, icon, ink, paper, lift, scale) {
  let cx = 0, cy = 0;
  for (const u of group) { cx += u.x; cy += u.y; }
  cx /= group.length; cy /= group.length;
  let top = cy;
  for (const u of group) top = Math.min(top, u.y - u.d.radius * 2.6);
  const stagger = lift - 56;
  const count = battle.game.camera.zoom < 0.95 ? 0 : group.length;
  balloon(ctx, cx, Math.min(cy - lift, top - 26 - Math.max(0, stagger)), icon, ink, paper, scale, count);
}

export function drawObstacle(battle, ctx, o) {
  const P = battle.palette;
  if (o.kind === 'none') return;
  if (o.kind === 'tree') tree(ctx, o.x, o.y, o.r * 1.15, P.tree, P.treeShade, P.groundShade);
  else if (o.kind === 'hill') drawHillTerrain(ctx, o.x, o.y, o.r * 0.7, P);
  else rock(ctx, o.x, o.y, o.r, P.rock, P.rockShade, P.groundShade, o.rot);
}

// Plan 024 Phase 6c: a battlefield hill needs to read as TERRAIN units fight around, not a
// landmark glimpsed from afar — `mountain()` (src/engine.js) is exactly that landmark icon,
// used for the campaign map's mountain ridges. Adapts its silhouette (same asymmetric-apex +
// shadow-side-outcrop path, so both maps keep one art direction) rather than inventing a new
// shape, but recolors it for the battle ground plane: a filled rock body, a `P.groundShade`
// sun-side wedge (the same second-tone motif the ground's own blotches/regions/light-and-
// shade wedges already use, instead of `mountain()`'s cream highlight, which reads as a snow
// cap at this scale) and an ink rim stroke tying the silhouette to the ground it sits on.
function drawHillTerrain(ctx, x, y, s, P) {
  // cast shadow first — every standing object in this scene obeys the same up-left light
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = P.ink;
  ctx.beginPath(); ctx.moveTo(x - s * 0.6, y + s * 0.42); ctx.lineTo(x + s * 1.75, y + s * 0.42);
  ctx.lineTo(x + s * 1.15, y + s * 0.62); ctx.lineTo(x - s * 0.4, y + s * 0.62); ctx.closePath(); ctx.fill();
  ctx.restore();
  const ax = x - s * 0.12;
  const apex = [ax, y - s], footL = [x - s, y + s * 0.4], footR = [x + s * 1.1, y + s * 0.42];
  const outcropPeak = [x + s * 0.78, y - s * 0.18], outcropL = [x + s * 0.55, y + s * 0.42], outcropR = [x + s * 1.25, y + s * 0.42];
  // filled rock body
  ctx.fillStyle = P.rock;
  ctx.beginPath(); ctx.moveTo(footL[0], footL[1]); ctx.lineTo(apex[0], apex[1]); ctx.lineTo(footR[0], footR[1]); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(outcropL[0], outcropL[1]); ctx.lineTo(outcropPeak[0], outcropPeak[1]); ctx.lineTo(outcropR[0], outcropR[1]); ctx.closePath(); ctx.fill();
  // sun-side wedge toward the global light (down-right), the ground's own second tone
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = P.groundShade;
  ctx.beginPath(); ctx.moveTo(apex[0], apex[1]); ctx.lineTo(footR[0], footR[1]); ctx.lineTo(x + s * 0.28, y + s * 0.42); ctx.closePath(); ctx.fill();
  ctx.restore();
  // ink rim: outlines the whole silhouette so it holds together as a solid landform
  ctx.strokeStyle = P.ink; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(footL[0], footL[1]); ctx.lineTo(apex[0], apex[1]); ctx.lineTo(outcropPeak[0], outcropPeak[1]);
  ctx.lineTo(outcropR[0], outcropR[1]); ctx.lineTo(footR[0], footR[1]); ctx.closePath();
  ctx.stroke();
}

export function drawProps(battle, ctx, dynamicOnly = false) {
  const P = battle.palette;
  for (const p of battle.props) {
    const dynamic = p.kind === 'fire' || p.kind === 'mill' || p.kind === 'river';
    if (dynamicOnly !== dynamic) continue;
    if (p.kind === 'riverPoly') {
      // A Brief-derived river: the real sampled polyline, not a straight column through the
      // middle. A thick round-joined stroke approximates the channel at the Brief's real
      // width; the lighter dashes are the same "water in motion" cue the old fixed river used.
      ctx.strokeStyle = P.water; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (p.widths) {
        for (let i = 1; i < p.pts.length; i++) {
          ctx.lineWidth = (p.widths[i - 1] + p.widths[i]) / 2;
          ctx.beginPath(); ctx.moveTo(p.pts[i - 1][0], p.pts[i - 1][1]);
          ctx.lineTo(p.pts[i][0], p.pts[i][1]); ctx.stroke();
        }
      } else {
        ctx.lineWidth = p.width;
        ctx.beginPath();
        ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
        ctx.stroke();
      }
      ctx.strokeStyle = P.waterLight; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let i = 1; i < p.pts.length; i += 2) {
        const ax = p.pts[i - 1][0], ay = p.pts[i - 1][1], bx = p.pts[i][0], by = p.pts[i][1];
        ctx.beginPath();
        ctx.moveTo(ax + (bx - ax) * 0.3, ay + (by - ay) * 0.3);
        ctx.lineTo(ax + (bx - ax) * 0.55, ay + (by - ay) * 0.55);
        ctx.stroke();
      }
    } else if (p.kind === 'roadPoly') {
      // A Brief-derived road: the real sampled polyline instead of a straight quadratic
      // through the middle.
      ctx.strokeStyle = P.cream; ctx.lineWidth = Math.max(10, p.width * 0.3); ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (p.kind === 'ford') {
      // A shallow crossing: a pale patch across the channel with stepping stones, oriented
      // across the real flow direction (`tx,ty`) rather than a fixed axis.
      const acrossA = Math.atan2(p.ty, p.tx) + Math.PI / 2;
      // Plan 034: the shallows span ±CROSSING_OPEN_HALF.ford along the tangent — imported,
      // not restated: the pale patch IS the wadable window now that the water beside it is
      // plugged, and a retune of the opening must move the art with it.
      const fordHalf = CROSSING_OPEN_HALF.ford;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(acrossA);
      ctx.globalAlpha = 0.85; ctx.fillStyle = shade(P.cream, 0.85);
      ctx.fillRect(-p.w / 2, -fordHalf, p.w, fordHalf * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = P.rock;
      for (let i = 0; i < 6; i++) {
        const sx = -p.w / 2 + (i + 0.5) * (p.w / 6);
        ctx.beginPath(); ctx.ellipse(sx, i % 2 ? 8 : -8, 10, 7, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    } else if (p.kind === 'bridgeSpan') {
      // Same built-wooden-thing style as the legacy fixed bridge, oriented across the real
      // flow direction (`tx,ty`) at the Brief's real crossing width, instead of a fixed axis.
      const acrossA = Math.atan2(p.ty, p.tx) + Math.PI / 2;
      // Plan 034: the deck spans ±CROSSING_OPEN_HALF.bridge along the tangent — imported,
      // not restated, because the drawn deck IS the passable window for unit centres and a
      // retune of the opening must move the art with it.
      const deckHalf = CROSSING_OPEN_HALF.bridge;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(acrossA);
      for (let pi = 0; pi < 8; pi++) {
        ctx.fillStyle = pi % 2 ? '#BE9245' : '#DDB870';
        ctx.fillRect(-p.w / 2 + pi * (p.w / 8), -deckHalf, p.w / 8, deckHalf * 2);
      }
      ctx.strokeStyle = P.ink; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(-p.w / 2, -deckHalf); ctx.lineTo(p.w / 2, -deckHalf); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-p.w / 2, deckHalf); ctx.lineTo(p.w / 2, deckHalf); ctx.stroke();
      ctx.fillStyle = P.ink;
      for (const [px, py] of [[-p.w / 2, -deckHalf], [p.w / 2, -deckHalf], [-p.w / 2, deckHalf], [p.w / 2, deckHalf]]) {
        ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.fill();
      }
      ctx.restore();
    } else if (p.kind === 'tree') {
      // Decorative-only wood-clump trees (Phase 3): all but the 2 largest per clump, which
      // get a real obstacle collider instead and are drawn via drawObstacle's depth-sorted
      // pass — this branch never sees those, so there is no double-draw.
      tree(ctx, p.x, p.y, p.r * 1.15, P.tree, P.treeShade, P.groundShade);
    } else if (p.kind === 'woodFloor') {
      // Plan 034: a wood's zone footprint, drawn instead of implied by a handful of trees.
      // TWO radii on purpose, because the wood has two: the filled disc is the slow ground
      // (zone r), the dashed rim is the ARROW COVER line (the LOS blocker is 0.8r —
      // terrain.js pushes both). Drawing one rim at r overstated cover by 25%. Baked into
      // the static tiles once, so the alpha work costs nothing per frame.
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = P.treeShade;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = P.treeShade; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.8, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (p.kind === 'hillFoot') {
      // Plan 034: the hill's collider — which is also its LOS blocker — as a ground-contact
      // footprint under the silhouette (whose ground line is a strip, not a circle):
      // one circle, because obstacle, blocker and footprint genuinely share this r. Same
      // static-bake terms as
      // woodFloor above.
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = P.rockShade;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = P.rockShade; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    } else if (p.kind === 'scrub') {
      // Plan 034: the faint disc is the scrub ZONE's true edge (its 0.92x ground was
      // invisible); the two ellipses are the bushes that always drew.
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = P.treeShade;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = P.treeShade;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 0.9, p.r * 0.6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = P.tree;
      ctx.beginPath(); ctx.ellipse(p.x - p.r * 0.15, p.y - p.r * 0.15, p.r * 0.55, p.r * 0.4, 0, 0, TAU); ctx.fill();
    } else if (p.kind === 'river') {
      const bx = battle.bridge.x;
      ctx.fillStyle = P.water;
      ctx.fillRect(bx - 45, -40, 90, battle.H + 80);
      ctx.strokeStyle = P.waterLight; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let y = 20; y < battle.H; y += 90) {
        ctx.beginPath(); ctx.moveTo(bx - 20, y); ctx.lineTo(bx + 6, y); ctx.stroke();
      }
      // the bridge — a BUILT wooden thing: deck planks, side rails, post caps
      // (a bare cream rectangle read as a missing-asset placeholder to two critics)
      const bty = battle.bridge.y - battle.bridge.h / 2, bh = battle.bridge.h;
      // alternating plank tones with real contrast, grooves on alternate seams only
      for (let pi = 0; pi < 8; pi++) {
        ctx.fillStyle = pi % 2 ? '#BE9245' : '#DDB870';
        ctx.fillRect(bx - 60 + pi * 15, bty, 15, bh);
      }
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
      for (let px = -30; px <= 30; px += 30) {
        ctx.beginPath(); ctx.moveTo(bx + px, bty + 3); ctx.lineTo(bx + px, bty + bh - 3); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = P.ink; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(bx - 60, bty); ctx.lineTo(bx + 60, bty); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 60, bty + bh); ctx.lineTo(bx + 60, bty + bh); ctx.stroke();
      ctx.fillStyle = P.ink;
      for (const [px, py] of [[-60, 0], [60, 0], [-60, bh], [60, bh]]) {
        ctx.beginPath(); ctx.arc(bx + px, bty + py, 6, 0, TAU); ctx.fill();
      }
    } else if (p.kind === 'road') {
      ctx.strokeStyle = P.cream; ctx.lineWidth = 26; ctx.globalAlpha = 0.35;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(-40, battle.H * 0.62); ctx.quadraticCurveTo(battle.W * 0.5, battle.H * 0.42, battle.W + 40, battle.H * 0.55); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (p.kind === 'plank') {
      shadow(ctx, p.x, p.y + 2, p.s * 0.5, p.s, P.groundShade);
      ctx.fillStyle = '#6B3A2A';
      ctx.fillRect(p.x - p.s * 0.4, p.y - p.s * 2.2, p.s * 0.8, p.s * 2.2);
      ctx.fillStyle = P.cream;
      ctx.beginPath(); ctx.moveTo(p.x - p.s * 0.4, p.y - p.s * 2.2); ctx.lineTo(p.x, p.y - p.s * 2.8); ctx.lineTo(p.x + p.s * 0.4, p.y - p.s * 2.2); ctx.closePath(); ctx.fill();
    } else if (p.kind === 'tuft') {
      ctx.strokeStyle = P.groundShade; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(p.x + i * 3, p.y);
        ctx.lineTo(p.x + i * 3 + p.rot * 4 + i, p.y - p.s - (i === 0 ? 2 : 0)); ctx.stroke();
      }
    } else if (p.kind === 'pebbles') {
      ctx.fillStyle = P.groundShade;
      for (const [ox, oy, rr] of [[0, 0, 1], [1.6, 0.5, 0.7], [-1.2, 0.8, 0.6]]) {
        ctx.beginPath();
        ctx.ellipse(p.x + ox * p.s, p.y + oy * p.s, p.s * rr, p.s * rr * 0.7, p.rot, 0, TAU);
        ctx.fill();
      }
    } else if (p.kind === 'tent') {
      // dark leather-brown, NOT enemy red: the red triangle must mean exactly one thing
      // on a battlefield (an enemy's hood), never also a structure
      shadow(ctx, p.x, p.y + 4, p.s, p.s * 0.8, P.groundShade);
      ctx.fillStyle = '#6B3A2A';
      ctx.beginPath(); ctx.moveTo(p.x - p.s, p.y); ctx.lineTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x + p.s, p.y); ctx.closePath(); ctx.fill();
      // lit slope face (up-left light) — every standing object carries the same light
      ctx.fillStyle = '#8A5138';
      ctx.beginPath(); ctx.moveTo(p.x - p.s, p.y); ctx.lineTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x - p.s * 0.2, p.y); ctx.closePath(); ctx.fill();
      // red lives only in the small pennant on top
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x, p.y - p.s * 1.25 - 10); ctx.stroke();
      ctx.fillStyle = P.enemy;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.25 - 10); ctx.lineTo(p.x + 9, p.y - p.s * 1.25 - 7); ctx.lineTo(p.x, p.y - p.s * 1.25 - 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.enemyDark;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x + p.s, p.y); ctx.lineTo(p.x + p.s * 0.25, p.y); ctx.closePath(); ctx.fill();
    } else if (p.kind === 'fire') {
      ctx.fillStyle = P.ink;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 12, 6, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = P.tree;
      ctx.beginPath(); ctx.arc(p.x, p.y - 6 + Math.sin(battle.time * 8) * 1.5, 6 + Math.sin(battle.time * 12) * 1.4, 0, TAU); ctx.fill();
    } else if (p.kind === 'stake') {
      ctx.strokeStyle = P.ink; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 4, p.y - p.s - 6); ctx.stroke();
    } else if (p.kind === 'house') {
      // extruded volume: lit front wall + darker side wall + two-tone gabled roof
      shadow(ctx, p.x, p.y + 6, p.w * 0.6, p.h * 0.6, P.groundShade);
      const wallL = '#3A4A72', wallD = P.ink, ext = p.w * 0.28;
      ctx.fillStyle = wallL; ctx.fillRect(p.x - p.w / 2, p.y - p.h, p.w, p.h);
      ctx.fillStyle = wallD;
      ctx.beginPath(); ctx.moveTo(p.x + p.w / 2, p.y - p.h); ctx.lineTo(p.x + p.w / 2 + ext, p.y - p.h - ext * 0.4);
      ctx.lineTo(p.x + p.w / 2 + ext, p.y - ext * 0.4); ctx.lineTo(p.x + p.w / 2, p.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.cream;
      ctx.beginPath(); ctx.moveTo(p.x - p.w / 2 - 4, p.y - p.h); ctx.lineTo(p.x, p.y - p.h - p.w * 0.5); ctx.lineTo(p.x + p.w / 2 + 4, p.y - p.h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(P.cream, 0.8);
      ctx.beginPath(); ctx.moveTo(p.x, p.y - p.h - p.w * 0.5); ctx.lineTo(p.x + p.w / 2 + 4, p.y - p.h);
      ctx.lineTo(p.x + p.w / 2 + ext, p.y - p.h - ext * 0.4); ctx.closePath(); ctx.fill();
      // door — a building people live in
      ctx.fillStyle = wallD; ctx.fillRect(p.x - 5, p.y - p.h * 0.55, 10, p.h * 0.55);
    } else if (p.kind === 'mill') {
      shadow(ctx, p.x, p.y + 4, p.s, p.s, P.groundShade);
      ctx.fillStyle = P.ink; ctx.fillRect(p.x - 8, p.y - p.s * 1.6, 16, p.s * 1.6);
      ctx.strokeStyle = P.cream; ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const a = battle.time * 0.7 + i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.6); ctx.lineTo(p.x + Math.cos(a) * p.s * 0.9, p.y - p.s * 1.6 + Math.sin(a) * p.s * 0.9); ctx.stroke();
      }
    } else if (p.kind === 'stone') {
      rock(ctx, p.x, p.y, p.s, P.rock, P.rockShade, P.groundShade, 0.8);
    } else if (p.kind === 'boulder') {
      // Plan 024 Phase 6b: a bigger, purely decorative cousin of 'stone' — same two-tone
      // rock treatment, no collider, scattered as generic ground interest.
      rock(ctx, p.x, p.y, p.s, P.rock, P.rockShade, P.groundShade, p.rot || 0.4);
    } else if (p.kind === 'log') {
      // A fallen trunk: a shaded cylinder body with a cut end-cap, oriented by `p.rot`.
      shadow(ctx, p.x, p.y + p.s * 0.3, p.s * 1.3, p.s * 0.7, P.groundShade);
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
      ctx.fillStyle = '#5A3324';
      ctx.fillRect(-p.s * 1.3, -p.s * 0.4, p.s * 2.6, p.s * 0.8);
      ctx.fillStyle = '#7A4A32';
      ctx.fillRect(-p.s * 1.3, -p.s * 0.4, p.s * 2.6, p.s * 0.32);
      ctx.fillStyle = '#3E2418';
      ctx.beginPath(); ctx.ellipse(p.s * 1.3, 0, p.s * 0.22, p.s * 0.4, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(-p.s * 1.3, -p.s * 0.4, p.s * 2.6, p.s * 0.8); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(p.s * 1.3, 0, p.s * 0.22, p.s * 0.4, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    } else if (p.kind === 'stump') {
      // What is left where a tree used to be: same trunk-brown as the tent/plank props,
      // with a growth-ring highlight and an ink rim.
      shadow(ctx, p.x, p.y + p.s * 0.3, p.s * 0.8, p.s * 0.6, P.groundShade);
      ctx.fillStyle = '#6B3A2A';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.7, p.s * 0.5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.7, p.s * 0.5, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#8A5138'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.4, p.s * 0.28, 0, 0, TAU); ctx.stroke();
    } else if (p.kind === 'reeds') {
      // River-bank dressing: a small fan of thin curved blades, angled by `p.rot`. Ground
      // level, no cast shadow — same treatment as 'tuft'.
      ctx.strokeStyle = P.treeShade; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(p.x + i * 3, p.y);
        ctx.quadraticCurveTo(p.x + i * 3 + p.rot * 4, p.y - p.s * 0.6, p.x + i * 5 + p.rot * 8, p.y - p.s);
        ctx.stroke();
      }
      ctx.strokeStyle = P.tree; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + p.rot * 4, p.y - p.s * 0.6, p.x + p.rot * 8, p.y - p.s);
      ctx.stroke();
    } else if (p.kind === 'crops') {
      // A tended patch near a settlement: a tidy 3x3 grid of short blade strokes, unlike
      // the irregular wild 'tuft' scatter — reads as cultivated, not wild growth.
      ctx.strokeStyle = P.treeShade; ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let row = -1; row <= 1; row++) {
        for (let col = -1; col <= 1; col++) {
          const cx = p.x + col * p.s * 0.9, cy = p.y + row * p.s * 0.55;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + p.rot * 3, cy - p.s * 0.6); ctx.stroke();
        }
      }
    } else if (p.kind === 'bones') {
      // A scattered skull-and-ribs — the oldest battlefield-dressing cliche there is, but
      // it earns its place: flat cream fill, ink outline, ground level, no shadow.
      ctx.fillStyle = P.cream; ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * 0.5, p.s * 0.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const rx = p.x + p.s * (0.9 + i * 0.4) * p.rot;
        ctx.moveTo(rx, p.y - p.s * 0.15); ctx.lineTo(rx + p.s * 0.22 * p.rot, p.y + p.s * 0.15);
      }
      ctx.stroke();
    }
  }
}
