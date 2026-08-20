// Battle scene composition: ground, props, the depth-sorted actor pass, HP-bar culling,
// then the HUD on top. `drawScene` is the whole frame — Battle.draw() delegates to it.
// `drawProps` is also called once at construction to bake the static prop layer.
import { UNIT_TYPES, ENEMY_TYPES } from '../data.js?v=ra209d001f5a8';
import { TAU, clamp, lerp, len, shadow, shade, tree, rock, hpBar, balloon } from '../engine.js?v=ra209d001f5a8';
import { stableSortPrefix } from './spatial-index.js?v=ra209d001f5a8';
import { SQUAD_TYPES } from './constants.js?v=ra209d001f5a8';
import { drawTroop, drawEnemy, drawHero } from './render-units.js?v=ra209d001f5a8';
import { drawHud } from './hud.js?v=ra209d001f5a8';

// ------------------------------------------------------------- drawing
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
  ctx.drawImage(battle._staticLayer, -64, -64);
  drawProps(battle, ctx, true);

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
  const heroEntry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
  heroEntry.y = h.y; heroEntry.kind = 3; heroEntry.ref = h; drawCount++;
  for (let i = drawCount; i < oldDrawLength; i++) draws[i].ref = null;
  battle._drawEntriesActive = drawCount;
  battle._spatialCounters.orderingItems += drawCount;
  stableSortPrefix(draws, drawCount, battle._drawSortScratch, (a, b) => a.y - b.y);
  // shadows first
  for (const t of battle.troops) shadow(ctx, t.x, t.y + 2, t.d.radius, 12, P.groundShade);
  for (const e of battle.enemies) shadow(ctx, e.x, e.y + 2, e.d.radius, 12, P.groundShade);
  shadow(ctx, h.x, h.y + 4, 15, 16, P.groundShade);
  for (let i = 0; i < drawCount; i++) {
    const d = draws[i];
    if (d.kind === 0) drawObstacle(battle, ctx, d.ref);
    else if (d.kind === 1) drawTroop(battle, ctx, d.ref);
    else if (d.kind === 2) drawEnemy(battle, ctx, d.ref);
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
  else rock(ctx, o.x, o.y, o.r, P.rock, P.rockShade, P.groundShade, o.rot);
}

export function drawProps(battle, ctx, dynamicOnly = false) {
  const P = battle.palette;
  for (const p of battle.props) {
    const dynamic = p.kind === 'fire' || p.kind === 'mill' || p.kind === 'river';
    if (dynamicOnly !== dynamic) continue;
    if (p.kind === 'river') {
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
    }
  }
}
