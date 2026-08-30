// The in-battle HUD: squad rows with their stance trade-offs, the deploy countdown, the
// retreat prompt and the end banner. Presentation only, and the largest single drawing
// job in the scene, which is why it gets its own module.
import { HERO, BALANCE, enemyStrength, playerStrength, weightText } from '../data.js?v=rf856e1bc4599';
import { TAU, clamp, rrect } from '../engine.js?v=rf856e1bc4599';
import { SQUAD_LABELS, STANCE_NOTES } from './constants.js?v=rf856e1bc4599';
import { stanceIcon } from './render-units.js?v=rf856e1bc4599';

// Plan 024 Phase 7 — "reading a field you cannot see". At the 0.80 zoom floor a 1280x720
// viewport shows about a third of the field, and squad balloons already collapse below
// zoom < 0.95 (render-scene.js), so the player loses spatial awareness of anything not on
// screen. Both additions below are presentation-only: draw path only, no simulation state,
// nothing exposed anywhere a test could observe it (the `staleT` precedent in AGENTS.md —
// exposing per-frame presentation state breaks byte-identical state comparisons elsewhere).
const MM_W = 180, MM_H = 127, MM_MARGIN = 14;
const CHEVRON_CAP = 12;
const CHEVRON_MARGIN = 26;
// Milestone 025 Slice C panel geometry, shared with the chevron reservation below so the
// two never drift apart — see drawObjectivePanel and drawOffscreenChevrons.
const OBJ_PANEL_W = 300, OBJ_PANEL_H = 58, OBJ_PANEL_Y = 14, OBJ_PANEL_MARGIN = 14;

// Bakes the field outline, river/road polylines and wood/hill silhouettes into a small
// offscreen canvas exactly once (cached on the battle instance, same pattern as
// `_staticTiles` in battle.js): the terrain is static for the whole fight, so re-stroking
// it every frame would be pure waste on top of the per-frame dot/frustum work below.
// Reads the SAME already-built battle state the main scene draws from (`battle.props` for
// the river/road polylines, `battle.obstacles` for hills, `battle.zones` for woods) rather
// than reaching back into `setup.field` — briefless template fights (battle_small/big/
// bridge) carry none of these, so the bake degenerates to just the outline, matching how
// terrain.js's own briefless path is a normal, supported case.
function bakeMinimapTerrain(battle) {
  const P = battle.palette;
  const canvas = document.createElement('canvas');
  canvas.width = MM_W; canvas.height = MM_H;
  const c = canvas.getContext('2d');
  const sx = MM_W / battle.W, sy = MM_H / battle.H;
  // Plan 024 Task 1 fix: the panel used to fill with P.ground, the SAME colour as the
  // battlefield behind it (measured: night biome panel 59,59,104 against adjacent field
  // ground 79,78,115 — under 20 units apart per channel, functionally invisible). `P.ink`
  // is deliberately far from every biome's ground hue (it is the outline/shadow colour, so
  // every biome already tunes it for maximum separation from `ground`), which is exactly
  // the contrast this panel needs, and it stays inside the existing per-battle palette
  // rather than inventing a new hardcoded colour. Verified by pixel-scan in all three
  // biomes — see plans/024's Phase 8 section for the measured before/after deltas.
  c.fillStyle = P.ink;
  c.fillRect(0, 0, MM_W, MM_H);
  // roads under rivers under woods/hills, same back-to-front order as the main scene
  c.globalAlpha = 0.5;
  c.strokeStyle = P.cream; c.lineWidth = 2; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const p of battle.props) {
    if (p.kind !== 'roadPoly') continue;
    c.beginPath();
    c.moveTo(p.pts[0][0] * sx, p.pts[0][1] * sy);
    for (let i = 1; i < p.pts.length; i++) c.lineTo(p.pts[i][0] * sx, p.pts[i][1] * sy);
    c.stroke();
  }
  c.globalAlpha = 1;
  c.strokeStyle = P.water; c.lineWidth = 2.5; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const p of battle.props) {
    if (p.kind !== 'riverPoly') continue;
    c.beginPath();
    c.moveTo(p.pts[0][0] * sx, p.pts[0][1] * sy);
    for (let i = 1; i < p.pts.length; i++) c.lineTo(p.pts[i][0] * sx, p.pts[i][1] * sy);
    c.stroke();
  }
  c.fillStyle = P.tree;
  for (const z of battle.zones) {
    if (z.kind !== 'wood') continue;
    c.beginPath(); c.ellipse(z.x * sx, z.y * sy, Math.max(1.5, z.r * sx), Math.max(1.5, z.r * sy), 0, 0, TAU); c.fill();
  }
  c.fillStyle = P.rock;
  for (const o of battle.obstacles) {
    if (o.kind !== 'hill') continue;
    c.beginPath(); c.ellipse(o.x * sx, o.y * sy, Math.max(1.5, o.r * sx), Math.max(1.5, o.r * sy), 0, 0, TAU); c.fill();
  }
  // The frame used to be P.ink, which is now the fill colour too and would vanish — P.cream
  // (the panel's own text/lit-face colour) keeps the frame visible against the darker fill.
  c.strokeStyle = P.cream; c.lineWidth = 2;
  c.strokeRect(1, 1, MM_W - 2, MM_H - 2);
  return canvas;
}

// Corner panel: baked terrain, then per-frame friendly/enemy/hero dots and the camera
// frustum rectangle. Placed bottom-right so it never contends with the top-left army panel,
// the bottom-centre squad panel, or the left-edge retreat prompt.
function drawMinimap(battle, ctx, W, Hh) {
  const P = battle.palette, cam = battle.game.camera, h = battle.hero;
  if (!battle._minimapCanvas) battle._minimapCanvas = bakeMinimapTerrain(battle);
  const mx = W - MM_W - MM_MARGIN, my = Hh - MM_H - MM_MARGIN;
  const sx = MM_W / battle.W, sy = MM_H / battle.H;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = P.ink;
  rrect(ctx, mx - 4, my - 4, MM_W + 8, MM_H + 8, 8); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.drawImage(battle._minimapCanvas, mx, my);
  ctx.save();
  ctx.beginPath(); ctx.rect(mx, my, MM_W, MM_H); ctx.clip();
  ctx.translate(mx, my);
  for (const t of battle.troops) {
    ctx.fillStyle = P.friend;
    ctx.beginPath(); ctx.arc(t.x * sx, t.y * sy, 1.6, 0, TAU); ctx.fill();
  }
  for (const e of battle.enemies) {
    ctx.fillStyle = P.enemy;
    ctx.beginPath(); ctx.arc(e.x * sx, e.y * sy, 1.6, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = P.hero;
  ctx.beginPath(); ctx.arc(h.x * sx, h.y * sy, 2.4, 0, TAU); ctx.fill();
  // camera frustum: the world-space rectangle currently on screen, in field space
  const tl = cam.toWorld(0, 0), br = cam.toWorld(cam.w, cam.h);
  ctx.strokeStyle = P.cream; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.85;
  ctx.strokeRect(tl.x * sx, tl.y * sy, (br.x - tl.x) * sx, (br.y - tl.y) * sy);
  ctx.restore();
  ctx.restore();
}

// Off-screen chevrons: a small clamped arrow at the screen edge for any friendly/enemy
// outside the camera frustum, so a fight that has spread beyond the viewport still reads.
// Capped at CHEVRON_CAP per side (nearest to the camera centre first) so a large battle
// does not ring the whole screen in arrows.
function drawOffscreenChevrons(battle, ctx, W, Hh) {
  const P = battle.palette, cam = battle.game.camera;
  const cx = W / 2, cy = Hh / 2;
  const camWx = cam.x + cam.sx, camWy = cam.y + cam.sy;
  const toScreen = (wx, wy) => ({ x: (wx - camWx) * cam.zoom + cx, y: (wy - camWy) * cam.zoom + cy });
  // Reserved HUD rectangles the clamped arrow must not land inside: the top-left army
  // panel, the minimap panel itself, and the bottom-centre squad panel (sized generously —
  // its exact height depends on squad count, so this over-covers rather than risks a clip).
  const reserved = [
    { x: 10, y: 10, w: 240, h: 42 },
    { x: W - MM_W - MM_MARGIN - 8, y: Hh - MM_H - MM_MARGIN - 8, w: MM_W + 16, h: MM_H + 16 },
    { x: W / 2 - 190, y: Hh - 150, w: 380, h: 150 },
  ];
  // The top-right objective chip (hold timer / guard pips) only exists for briefed
  // Hold/Break fights — battle.objective is null for classic elimination and the three
  // briefless template baselines, so this reservation must stay conditional or it would
  // shift chevron placement in fights that never draw the panel.
  if (battle.objective) {
    reserved.push({ x: W - OBJ_PANEL_W - OBJ_PANEL_MARGIN - 8, y: OBJ_PANEL_Y - 8, w: OBJ_PANEL_W + 16, h: OBJ_PANEL_H + 16 });
  }
  const inReserved = (x, y) => reserved.some(r => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
  const clampChevron = (x, y) => {
    let cxp = clamp(x, CHEVRON_MARGIN, W - CHEVRON_MARGIN);
    let cyp = clamp(y, CHEVRON_MARGIN, Hh - CHEVRON_MARGIN);
    if (inReserved(cxp, cyp)) {
      // Nudge along whichever screen edge it is already clamped to until it clears the
      // reserved rectangle, rather than hiding the arrow — losing the last few units'
      // signal right where the HUD is densest would defeat the point of the chevron.
      for (const r of reserved) {
        if (cxp <= r.x + r.w && cxp >= r.x && cyp <= r.y + r.h && cyp >= r.y) {
          if (cyp <= CHEVRON_MARGIN + 1) cyp = r.y + r.h + 6;
          else if (cyp >= Hh - CHEVRON_MARGIN - 1) cyp = r.y - 6;
          else if (cxp <= CHEVRON_MARGIN + 1) cxp = r.x + r.w + 6;
          else cxp = r.x - 6;
        }
      }
    }
    return { x: cxp, y: cyp };
  };
  const drawSide = (units, color) => {
    const off = [];
    for (const u of units) {
      const s = toScreen(u.x, u.y);
      if (s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= Hh) continue; // on screen already
      const d2 = (s.x - cx) * (s.x - cx) + (s.y - cy) * (s.y - cy);
      off.push({ s, d2 });
    }
    off.sort((a, b) => a.d2 - b.d2);
    const n = Math.min(CHEVRON_CAP, off.length);
    for (let i = 0; i < n; i++) {
      const { s, d2 } = off[i];
      const a = Math.atan2(s.y - cy, s.x - cx);
      const p = clampChevron(s.x, s.y);
      const dist = Math.sqrt(d2);
      const alpha = clamp(1 - dist / 1600, 0.35, 0.95);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(-5, -5.5); ctx.lineTo(-5, 5.5); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };
  drawSide(battle.troops, P.friend);
  drawSide(battle.enemies, P.enemy);
  ctx.globalAlpha = 1;
}

// Milestone 025 Slice C: the compact objective panel — current progress for Hold
// and Break fights, in one chip the eye already visits for the army count. Hidden
// for classic elimination fights, which have nothing to report.
function drawObjectivePanel(battle, ctx, W) {
  const P = battle.palette;
  const o = battle.objective;
  if (!o) return;
  const px = W - OBJ_PANEL_W - OBJ_PANEL_MARGIN, py = OBJ_PANEL_Y, pw = OBJ_PANEL_W;
  ctx.fillStyle = P.ink;
  rrect(ctx, px, py, pw, OBJ_PANEL_H, 8); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  if (o.kind === 'hold') {
    const left = Math.max(0, o.duration - o.progress);
    ctx.fillText(`OBJECTIVE · HOLD THE GROUND`, px + 14, py + 16);
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    if (o.contested) ctx.fillStyle = P.enemy;
    else if (!o.held) ctx.fillStyle = '#9BA3BF';
    else ctx.fillStyle = P.hp;
    ctx.fillText(o.contested ? 'CONTESTED — clock paused' : o.held ? 'Holding — keep them off' : 'No squad inside!', px + 14, py + 32);
    ctx.fillStyle = P.hpBack;
    rrect(ctx, px + 14, py + 42, pw - 28, 8, 4); ctx.fill();
    ctx.fillStyle = o.contested ? P.enemy : P.hp;
    rrect(ctx, px + 14, py + 42, (pw - 28) * Math.min(1, o.progress / o.duration), 8, 4); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.font = '800 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(left)}s`, px + pw - 14, py + 32);
  } else {
    const alive = battle.objectiveTargets.filter(t => !t.dead).length;
    ctx.fillText(`OBJECTIVE · BREAK THE POSITION`, px + 14, py + 16);
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = alive ? P.cream : P.hp;
    ctx.fillText(alive ? `${alive} guard${alive === 1 ? '' : 's'} standing` : 'The position is broken', px + 14, py + 32);
    // one pip per guard, filled by remaining health
    battle.objectiveTargets.forEach((t, i) => {
      const gx2 = px + 14 + i * ((pw - 28) / battle.objectiveTargets.length);
      const gw2 = (pw - 28) / battle.objectiveTargets.length - 6;
      ctx.fillStyle = P.hpBack;
      rrect(ctx, gx2, py + 42, gw2, 8, 4); ctx.fill();
      if (!t.dead) {
        ctx.fillStyle = P.hero;
        rrect(ctx, gx2, py + 42, gw2 * Math.max(0, t.hp / t.maxHp), 8, 4); ctx.fill();
      }
    });
  }
}

export function drawHud(battle, ctx) {
  const P = battle.palette;
  const cam = battle.game.camera, h = battle.hero;
  const W = cam.w, Hh = cam.h;
  ctx.textBaseline = 'middle';

  // top-left: army + kills
  ctx.fillStyle = P.ink;
  rrect(ctx, 14, 14, 232, 34, 8); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Warband ${battle.troops.length}   ·   Slain ${battle.kills}/${battle.totalEnemies}`, 26, 31);

  // Plan 024 Phase 7: a minimap and off-screen chevrons, so a field 4x the viewport still
  // reads. Drawn for both 'fight' and 'end'/'intro' alike — cheap (baked terrain, a handful
  // of per-frame dots/arrows) and there is no state where hiding it helps the player.
  drawMinimap(battle, ctx, W, Hh);
  drawOffscreenChevrons(battle, ctx, W, Hh);

  // Milestone 025 Slice C: compact objective progress (hold timer / guard health).
  drawObjectivePanel(battle, ctx, W);

  // bottom center: hero hp + dash + one row per squad.
  // Three rows instead of one chip strip: the player must be able to see, at a glance,
  // that his squads can be under DIFFERENT orders — that is the whole feature.
  // Rows exist only for squads the player actually has. A starting warband is four
  // spearmen, so the old fixed three rows showed BOWS 0 / HORSE 0 and advertised
  // "TAB pick squad" for a key that is a deliberate no-op below two squads - the first
  // thing a new player tried, and it did nothing.
  const squadRows = battle.mannedSquads();
  const canPickSquads = squadRows.length > 1;
  const rowsH = squadRows.length * 21;
  const bw = 360, bh = 35 + rowsH + (canPickSquads ? 18 : 6);
  const bx = W / 2 - bw / 2, by = Hh - bh - 12;
  ctx.fillStyle = P.ink;
  rrect(ctx, bx, by, bw, bh, 10); ctx.fill();
  // hp
  ctx.fillStyle = P.hpBack;
  rrect(ctx, bx + 14, by + 10, bw - 28, 10, 5); ctx.fill();
  ctx.fillStyle = h.hp / h.maxHp > 0.35 ? P.hp : P.enemy;
  const frac = Math.max(0, h.hp / h.maxHp);
  if (frac > 0) { rrect(ctx, bx + 14, by + 10, (bw - 28) * frac, 10, 5); ctx.fill(); }
  // dash pip
  ctx.fillStyle = P.hpBack;
  rrect(ctx, bx + 14, by + 24, 60, 5, 2.5); ctx.fill();
  ctx.fillStyle = P.cream;
  const dfrac = 1 - Math.max(0, h.dashCdT) / HERO.dashCd;
  rrect(ctx, bx + 14, by + 24, 60 * clamp(dfrac, 0, 1), 5, 2.5); ctx.fill();

  // squad rows
  const rowH = 21, rowsY = by + 35, rowW = bw - 20;
  // With the whole warband addressed, a rail spans every row: one order reaches them all.
  // Pointless when there is only one squad, so it is drawn only where it means something.
  if (battle.selectedSquad === null && canPickSquads) {
    ctx.fillStyle = P.hero;
    rrect(ctx, bx + 10, rowsY + 2, 3, rowH * squadRows.length - 6, 1.5); ctx.fill();
  }
  ctx.font = '700 12px Inter, system-ui, sans-serif';
  squadRows.forEach((type, i) => {
    const ry = rowsY + i * rowH;
    const count = battle.troops.reduce((n, t) => n + (t.type === type ? 1 : 0), 0);
    const selected = battle.selectedSquad === type;
    if (selected) { ctx.fillStyle = 'rgba(255,211,77,0.20)'; rrect(ctx, bx + 8, ry, rowW + 4, rowH - 2, 5); ctx.fill(); }
    // caret marks the squad the number keys will reach
    if (selected) {
      ctx.fillStyle = P.hero;
      ctx.beginPath(); ctx.moveTo(bx + 12, ry + 5); ctx.lineTo(bx + 18, ry + 9.5); ctx.lineTo(bx + 12, ry + 14); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = P.cream;
    ctx.textAlign = 'left';
    ctx.fillText(SQUAD_LABELS[type], bx + 22, ry + 10);
    ctx.fillText(String(count), bx + 84, ry + 10);
    const stance = battle.squads[type].stance;
    stanceIcon(battle, ctx, stance, bx + 116, ry + 9.5, 1.25);
    ctx.fillText(stance.toUpperCase(), bx + 130, ry + 10);
    // the braced/exposed consequence, spelled out where the order is shown, so the
    // trade-off is readable in the fight instead of only in the balance numbers
    const note = STANCE_NOTES[stance]?.[type === 'archer' ? 'ranged' : 'melee'] ?? '';
    if (note) {
      ctx.fillStyle = stance === 'hold' ? 'rgba(124,224,107,0.85)' : 'rgba(194,58,46,0.95)';
      ctx.textAlign = 'right';
      ctx.fillText(note, bx + rowW + 2, ry + 10);
    }
  });
  // key hints — Tab is only offered once there is more than one squad to pick between
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(239,230,206,0.62)';
  ctx.textAlign = 'center';
  if (canPickSquads) ctx.fillText('TAB pick squad  ·  1 follow  2 charge  3 hold', bx + bw / 2, by + bh - 9);

  // retreat hint: near your escape edge, or whenever a fight drags on
  const nearEscape = battle.approach === 'E' ? h.x < 190 : battle.approach === 'W' ? h.x > battle.W - 190
    : battle.approach === 'S' ? h.y < 170 : h.y > battle.H - 170;
  if (battle.state === 'fight' && battle.setup.canRetreat !== false && (nearEscape || battle.time > 45) && battle.time > 2) {
    const arrow = { west: '←', east: '→', north: '↑', south: '↓' }[battle.retreatDir];
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = P.ink;
    rrect(ctx, 14, Hh / 2 - 26, 200, 52, 8); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.font = '800 14px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    if (battle.retreatT > 0) {
      ctx.fillText(`Retreating — keep holding ${arrow}…`, 24, Hh / 2 - 7);
      ctx.fillStyle = P.hpBack;
      rrect(ctx, 24, Hh / 2 + 6, 160, 8, 4); ctx.fill();
      ctx.fillStyle = P.hero;
      rrect(ctx, 24, Hh / 2 + 6, 160 * Math.min(1, battle.retreatT / 1.3), 8, 4); ctx.fill();
    } else {
      ctx.fillText(`${arrow} hold ${arrow} at the ${battle.retreatDir} edge`, 24, Hh / 2 - 7);
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillText('to RETREAT (keeps survivors)', 24, Hh / 2 + 12);
    }
    ctx.globalAlpha = 1;
  }

  // deploy countdown: set your line while they form theirs
  if (battle.state === 'fight' && battle.deployT > 0) {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = P.ink;
    // Two measured lines. This was one 15px line of ~629px drawn into a hardcoded 460px
    // panel, so it spilled ~85px off both ends onto the battlefield in every battle.
    const headline = `They advance in ${Math.ceil(battle.deployT)}`;
    const detail = 'position your men — 1 follow · 3 hold · 2 or a swing attacks NOW';
    ctx.font = '800 15px Inter, system-ui, sans-serif';
    const headlineW = ctx.measureText(headline).width;
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    const detailW = ctx.measureText(detail).width;
    const dw = Math.min(W - 40, Math.max(320, Math.max(headlineW, detailW) + 44));
    rrect(ctx, W / 2 - dw / 2, 64, dw, 62, 10); ctx.fill();
    ctx.fillStyle = P.hero;
    ctx.textAlign = 'center';
    ctx.font = '800 15px Inter, system-ui, sans-serif';
    ctx.fillText(headline, W / 2, 82);
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillText(detail, W / 2, 100);
    ctx.fillStyle = P.hpBack;
    rrect(ctx, W / 2 - dw / 2 + 16, 112, dw - 32, 6, 3); ctx.fill();
    ctx.fillStyle = P.hero;
    rrect(ctx, W / 2 - dw / 2 + 16, 112, (dw - 32) * (battle.deployT / battle.deployMax), 6, 3); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // command flash
  if (battle.commandFlash.t > 0) {
    const k = battle.commandFlash.t / 0.9;
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.fillStyle = P.cream;
    ctx.font = `900 ${Math.round(46 + (1 - k) * 6)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(battle.commandFlash.text, W / 2, Hh * 0.32);
    ctx.globalAlpha = 1;
  }

  // intro / end banners
  if (battle.state === 'intro') {
    const k = Math.min(1, battle.stateT / 0.35);
    ctx.globalAlpha = k;
    ctx.fillStyle = P.ink;
    // Plan 021 step 5: a brief-routed fight already stated N vs M once (and the
    // deploy countdown states it a third time in words) — drop this repeat, keyed
    // strictly off setup.brief so the un-briefed baselines are pixel-identical.
    const showCount = !battle.setup.brief;
    ctx.fillRect(0, Hh * 0.36, W, battle.setup.subtitle ? (showCount ? 104 : 82) : (showCount ? 86 : 64));
    ctx.fillStyle = P.cream;
    ctx.font = '900 34px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(battle.setup.title || 'SKIRMISH', W / 2, Hh * 0.36 + 34);
    if (battle.setup.subtitle) {
      ctx.font = '700 15px Inter, system-ui, sans-serif';
      ctx.fillStyle = P.hero;
      ctx.fillText(battle.setup.subtitle, W / 2, Hh * 0.36 + 60);
      if (showCount) {
        ctx.fillStyle = P.cream;
        ctx.font = '600 14px Inter, system-ui, sans-serif';
        ctx.fillText(`${battle.troops.length + 1} vs ${battle.enemies.length}`, W / 2, Hh * 0.36 + 84);
      }
    } else if (showCount) {
      ctx.font = '600 15px Inter, system-ui, sans-serif';
      ctx.fillText(`${battle.troops.length + 1} vs ${battle.enemies.length}`, W / 2, Hh * 0.36 + 62);
    }
    ctx.globalAlpha = 1;
  }
  if (battle.state === 'end') {
    const k = Math.min(1, battle.stateT / 0.3);
    ctx.globalAlpha = k;
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, Hh * 0.36, W, battle.victory || battle.retreated ? 96 : 112);
    ctx.fillStyle = battle.victory ? P.hp : battle.retreated ? P.cream : P.enemy;
    ctx.font = '900 40px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(battle.victory ? 'VICTORY' : battle.retreated ? 'WITHDRAWN' : 'DEFEAT', W / 2, Hh * 0.36 + 38);
    ctx.fillStyle = P.cream;
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    const lost = battle.startTroops - battle.troops.length;
    if (battle.victory) {
      ctx.fillText(`+${battle.loot} gold  ·  ${battle.kills} slain  ·  ${lost > 0 ? lost + ' of your men fell' : 'no losses'}`, W / 2, Hh * 0.36 + 68);
    } else if (battle.retreated) {
      ctx.fillText(`You disengage in good order — ${battle.troops.length} men ride out with you`, W / 2, Hh * 0.36 + 68);
    } else {
      ctx.fillText(`Slain by ${battle.killedBy || 'the enemy'} — your warband scatters, poorer and fewer`, W / 2, Hh * 0.36 + 68);
      // diagnose the loss so the player knows what to change next time
      ctx.fillStyle = P.hero;
      ctx.font = '700 14px Inter, system-ui, sans-serif';
      // The hero's own survival is what decides an even fight, so say that rather than
      // pointing at HOLD: measured across camp raids, HOLD is not the stronger order, and
      // advice that sends the player to the weaker option teaches the wrong lesson.
      // Plan 028: the "+2 strength points" gap became a ratio, because fighting weight is
      // a measured quantity now and an absolute margin means different things to a
      // four-man warband and a twelve-man one. `oddsStronger` is the same threshold the
      // map's odds pill used to promise this fight was winnable, so the defeat screen and
      // the brief cannot disagree about whether the player was outmatched.
      const advice = battle.enemyStrength > battle.playerStrength * BALANCE.oddsStronger
        ? `They were stronger (${weightText(battle.enemyStrength)} vs your ${weightText(battle.playerStrength)}) — recruit at a village, then return`
        : 'Even odds — you fell, not your warband. Dash out of the scrum before you are surrounded';
      ctx.fillText(advice, W / 2, Hh * 0.36 + 90);
    }
    ctx.globalAlpha = 1;
  }
}
