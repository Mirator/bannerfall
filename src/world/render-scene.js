// Campaign-map scene composition: ground and light grading, terrain, roads and rivers,
// bridges, settlements and camps, then the actors and HUD on top, then any open modal.
// `drawScene` is the whole frame — World.draw() delegates to it.
import { PAL, WORLD } from '../data.js?v=r3b20caaaa2ab';
import { TAU, shadow, shade, tree, mountain, rrect, rock } from '../engine.js?v=r3b20caaaa2ab';
import {
  hoverTargetAt, drawHoverPanel, isOverHud, drawBriefPanel, drawAftermathPanel,
  drawSpecPanel, drawPerkPanel, drawSitePanel,
} from '../world-screens.js?v=r3b20caaaa2ab';
import {
  settlementState, settlementRecord, SPECIALIZATIONS, OWNERSHIP,
  strongholdStateId, STRONGHOLD_POWER_LABELS,
} from '../region.js?v=r3b20caaaa2ab';
import { drawParty, drawHero, drawHud } from './render-actors.js?v=r3b20caaaa2ab';
import { WORLD_ART, worldRegionAt, worldHudLayout } from './visual-style.js?v=r3b20caaaa2ab';

const P = PAL.world;

// ---------------------------------------------------------------- draw
export function drawScene(world, ctx) {
  const cam = world.game.camera, h = world.hero;
  const inp = world.game.input;
  // Plan 021: presentation-only hover pass, computed and stored ONLY here — never in
  // update() (AGENTS.md: "simulation must not read presentation"). See the constructor
  // comment for why the latch compares persistent pointer coordinates rather than the
  // transient `moved` flag. Also suppressed while a modal is open or the pointer sits
  // on a HUD rect.
  world.pointerEverMoved = world.pointerEverMoved ||
    inp.mouse.x !== world.pointerBootX || inp.mouse.y !== world.pointerBootY;
  if (world.pointerEverMoved && !world.screen && !isOverHud(inp.mouse.x, inp.mouse.y, cam.w, cam.h)) {
    const wp = cam.toWorld(inp.mouse.x, inp.mouse.y);
    world.hoverTarget = hoverTargetAt(world, wp.x, wp.y);
  } else {
    world.hoverTarget = null;
  }
  ctx.fillStyle = P.ink;
  ctx.fillRect(0, 0, cam.w, cam.h);
  cam.apply(ctx);
  ctx.fillStyle = P.ground;
  // Camera-safe overscan prevents an empty navy slab at the eastern/western limits on
  // wide displays. Simulation bounds remain unchanged; this is only backdrop paint.
  ctx.fillRect(-cam.w, -cam.h, world.W + cam.w * 2, world.H + cam.h * 2);
  // A slim cartographic edge marks the playable boundary without turning the screen edge
  // into a heavy navy bar when the camera reaches the map limits.
  ctx.strokeStyle = P.ink; ctx.lineWidth = 3; ctx.globalAlpha = 0.22;
  ctx.strokeRect(-3.5, -3.5, world.W + 7, world.H + 7);
  ctx.globalAlpha = 1;

  // Three cached elevation countries establish a west→east hierarchy. Their irregular
  // authored boundaries are broad and low-contrast, never screen-spanning light triangles.
  for (const regionPath of world._staticPaths.regions) {
    const style = WORLD_ART.regions.find(region => region.id === regionPath.id);
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = style.ground;
    ctx.fill(regionPath.path);
  }
  ctx.globalAlpha = 1;
  // Wide, curved midpoint bands hide the polygon seams so regional changes read as a
  // gradual country transition rather than a screen-spanning triangular light facet.
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const transitionColors = ['#ECA23C', '#E39A39'];
  world._staticPaths.transitions.forEach((path, i) => {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = transitionColors[i]; ctx.lineWidth = 180; ctx.stroke(path);
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = transitionColors[i]; ctx.lineWidth = 92; ctx.stroke(path);
  });
  ctx.restore();

  // Forest floors and riparian ground are geography-supporting regions, not decoration.
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.fillStyle = WORLD_ART.palette.forestFloor;
  ctx.fill(world._staticPaths.forestFloors);
  ctx.fillStyle = WORLD_ART.palette.riparian;
  for (const path of world._staticPaths.riparian) ctx.fill(path);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = WORLD_ART.palette.roadShadow;
  ctx.fill(world._staticPaths.deadGround);
  ctx.restore();

  // Farmland is static ground-plane geometry: two cached draws, regardless of plot count.
  ctx.fillStyle = WORLD_ART.palette.field; ctx.globalAlpha = 0.72; ctx.fill(world._staticPaths.fields);
  ctx.strokeStyle = WORLD_ART.palette.furrow; ctx.lineWidth = 3; ctx.globalAlpha = 0.55;
  ctx.stroke(world._staticPaths.fieldFurrows); ctx.globalAlpha = 1;

  // One filled water body, one soft bank and one interrupted flow cue. Filled asymmetric
  // boundaries avoid the parallel-pipeline look produced by stacked centerline strokes.
  for (let ri = 0; ri < world.rivers.length; ri++) {
    const river = world._staticPaths.rivers[ri];
    ctx.globalAlpha = WORLD_ART.shadow.terrainAlpha; ctx.fillStyle = WORLD_ART.palette.bank; ctx.fill(river.bank);
    ctx.globalAlpha = 1; ctx.fillStyle = WORLD_ART.palette.water; ctx.fill(river.water);
    ctx.globalAlpha = 0.18; ctx.fillStyle = WORLD_ART.palette.waterDeep;
    for (const path of river.deepBends) ctx.fill(path);
    ctx.globalAlpha = 0.58; ctx.strokeStyle = WORLD_ART.palette.sand;
    ctx.lineWidth = 7; ctx.lineCap = 'round';
    for (const path of river.sandBanks) ctx.stroke(path);
    ctx.globalAlpha = 0.42; ctx.fillStyle = '#9FD8D5';
    for (const shallow of river.shallows) {
      ctx.fill(shallow.path);
      const [x, y] = shallow.stone, [nx, ny] = shallow.normal;
      ctx.fillStyle = '#72777D'; ctx.beginPath(); ctx.ellipse(x + nx * 8, y + ny * 4, 4.5, 3, 0.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9FD8D5';
    }
    ctx.globalAlpha = 0.9; ctx.fillStyle = WORLD_ART.palette.sand;
    for (const island of river.islands) ctx.fill(island);
    ctx.save();
    ctx.globalAlpha = WORLD_ART.rivers.highlightAlpha;
    ctx.strokeStyle = WORLD_ART.palette.waterLight;
    ctx.lineWidth = WORLD_ART.rivers.highlightWidth; ctx.lineCap = 'round';
    ctx.setLineDash(WORLD_ART.rivers.highlightDash); ctx.lineDashOffset = -world.time * 5;
    ctx.stroke(river.flowHighlight); ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Roads use cached per-route classes: regional spines carry more visual weight than
  // village lanes, while every route remains quieter than a landmark or unit marker.
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const hud = worldHudLayout(cam.w, cam.h);
  const roadHudRects = [hud.resource, hud.objective];
  if (world.msgT > 0 && world.msg) roadHudRects.push({ x: cam.w / 2 - 220, y: 60, w: 440, h: 54 });
  const distanceToRect = (x, y, rect) => Math.hypot(
    Math.max(rect.x - x, 0, x - rect.x - rect.w),
    Math.max(rect.y - y, 0, y - rect.y - rect.h));
  const roadVisibility = section => {
    const sx = (section.x - cam.x) * cam.zoom + cam.w / 2;
    const sy = (section.y - cam.y) * cam.zoom + cam.h / 2;
    const edgeAlpha = Math.min(1, sx / WORLD_ART.roads.edgeFade, (cam.w - sx) / WORLD_ART.roads.edgeFade,
      sy / WORLD_ART.roads.edgeFade, (cam.h - sy) / WORLD_ART.roads.edgeFade);
    const hudAlpha = Math.min(1, ...roadHudRects.map(rect => distanceToRect(sx, sy, rect) / WORLD_ART.roads.hudFade));
    return Math.max(0, Math.min(edgeAlpha, hudAlpha));
  };
  for (const road of world._staticPaths.roads) {
    // Paint every shoulder first, then every road surface. Interleaving the two made
    // the next section's shoulder overprint the previous section as a dotted seam.
    for (const section of road.sections) {
      const visibility = roadVisibility(section);
      if (visibility <= 0) continue;
      ctx.strokeStyle = WORLD_ART.palette.roadShadow;
      ctx.lineWidth = section.width + WORLD_ART.roads.shadowExtra;
      ctx.globalAlpha = WORLD_ART.roads.shadowAlpha * visibility; ctx.stroke(section.path);
    }
    for (const section of road.sections) {
      const visibility = roadVisibility(section);
      if (visibility <= 0) continue;
      ctx.strokeStyle = WORLD_ART.palette.road; ctx.lineWidth = section.width;
      ctx.globalAlpha = WORLD_ART.roads.alpha * visibility; ctx.stroke(section.path);
    }
  }
  ctx.lineCap = 'round'; ctx.setLineDash([]); ctx.globalAlpha = 1;

  // scenery below entities
  for (const it of world.scenery) {
    if (it.kind === 'field') continue;
    if (it.mapVisible === false) continue;
    const cluster = it.clusterId && world.visualClusters.get(it.clusterId);
    if (cluster && !world.visible(cluster.x, cluster.y, cluster.r)) continue;
    const visualKind = it.kind === 'mapFrame' ? it.visualKind : it.kind;
    const cullR = visualKind === 'mtn' ? WORLD_ART.scale.mountain.max * 1.7 : it.s * 3.2;
    if (!cluster && !world.visible(it.x, it.y, cullR)) continue;
    if (visualKind === 'mtn') {
      // One simulation ridge becomes a three-peak visual cluster. The central peak still
      // matches the canonical collider; the overlapping foothill is silhouette, not new terrain.
      const peak = Math.max(WORLD_ART.scale.mountain.min,
        Math.min(WORLD_ART.scale.mountain.max, it.s * WORLD_ART.scale.mountain.main));
      const lead = !cluster || cluster.items[0] === it;
      const peakCount = cluster ? cluster.items.filter(item => (item.visualKind || item.kind) === 'mtn').length : 1;
      if (lead && peakCount < WORLD_ART.clusters.foothills.max) {
        mountain(ctx, it.x - peak * 0.62, it.y + peak * 0.17, peak * WORLD_ART.scale.mountain.companion, P.ink, P.cream, WORLD_ART.shadow.mountainAlpha);
      }
      mountain(ctx, it.x, it.y, peak, WORLD_ART.palette.ink, '#FFF8E8', WORLD_ART.shadow.mountainAlpha);
    }
    // deep green pines: vegetation must never share a hue family with hostile POI markers
    else if (visualKind === 'tree') {
      // Small deterministic groves fill the midground while keeping scenery generation,
      // battlefield sampling and RNG consumption exactly as before.
      const main = Math.max(WORLD_ART.scale.tree.min,
        Math.min(WORLD_ART.scale.tree.max, it.s * WORLD_ART.scale.tree.main));
      const region = worldRegionAt(it.x);
      if (!cluster || cluster.items[0] === it) {
        tree(ctx, it.x - main * 0.7, it.y + main * 0.14, main * WORLD_ART.scale.tree.companions[0], region.vegetation, WORLD_ART.palette.treeDark, P.groundShade, WORLD_ART.shadow.treeAlpha);
        tree(ctx, it.x + main * 0.72, it.y + main * 0.22, main * WORLD_ART.scale.tree.companions[1], WORLD_ART.palette.tree, WORLD_ART.palette.treeDark, P.groundShade, WORLD_ART.shadow.treeAlpha);
      }
      tree(ctx, it.x, it.y, main, region.vegetation, WORLD_ART.palette.treeDark, P.groundShade, WORLD_ART.shadow.treeAlpha);
    }
    // low shrub clumps fill the bare midground between the big scenery pieces
    else if (visualKind === 'shrub') {
      // One low silhouette reinforces its parent cluster without reading as an isolated tree.
      shadow(ctx, it.x, it.y, it.s * 1.35, it.s * 0.8, P.groundShade, WORLD_ART.shadow.smallAlpha);
      ctx.fillStyle = WORLD_ART.palette.treeDark;
      ctx.beginPath();
      ctx.moveTo(it.x - it.s * 1.25, it.y);
      ctx.lineTo(it.x - it.s * 0.62, it.y - it.s * 0.8);
      ctx.lineTo(it.x, it.y - it.s * 0.3);
      ctx.lineTo(it.x + it.s * 0.68, it.y - it.s * 0.92);
      ctx.lineTo(it.x + it.s * 1.28, it.y);
      ctx.closePath(); ctx.fill();
    }
    else {
      // Rock items read as deliberate outcrops, never unexplained lone pebbles.
      const main = Math.max(WORLD_ART.scale.rock.min,
        Math.min(WORLD_ART.scale.rock.max, it.s * WORLD_ART.scale.rock.main));
      rock(ctx, it.x, it.y, main, WORLD_ART.palette.rock, WORLD_ART.palette.rockDark, P.groundShade, it.rot, WORLD_ART.shadow.smallAlpha);
      rock(ctx, it.x - main * 0.9, it.y + main * 0.28, main * WORLD_ART.scale.rock.companions[0], '#C9C5BA', '#6E7180', P.groundShade, it.rot + 0.7, WORLD_ART.shadow.smallAlpha);
      rock(ctx, it.x + main * 0.85, it.y + main * 0.34, main * WORLD_ART.scale.rock.companions[1], '#DED9CB', '#858394', P.groundShade, it.rot - 0.5, WORLD_ART.shadow.smallAlpha);
    }
  }

  // Crossings sit over both route and water and enter/leave with their river context.
  for (const river of world.rivers) {
    for (const [bx, by] of river.bridges) if (world.visible(bx, by, WORLD_ART.scale.bridge.max)) {
      drawBridge(world, ctx, bx, by);
    }
  }

  // settlements
  for (const s of WORLD.settlements) if (world.visible(s.x, s.y, 180)) drawSettlement(world, ctx, s);
  // camps
  for (const c of WORLD.camps) {
    const st = world.save.camps.find(x => x.id === c.id);
    if (world.visible(c.x, c.y, 180)) drawCamp(world, ctx, c, st.razed);
  }

  // parties
  for (const p of world.parties) if (world.visible(p.x, p.y, 100)) drawParty(world, ctx, p);

  // hero party
  drawHero(world, ctx);

  world.particles.draw(ctx);

  // screen-space HUD
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Plan 023: the frozen-world wash sits OVER the map and its particles but UNDER the
  // cloud vignette, HUD, hover panel and any modal, so HUD text stays fully legible.
  drawFreezeCue(world, ctx, cam);
  drawCameraEdgeVeil(world, ctx, cam);
  // corner cloud vignette — atmosphere continuity with the menu and battle scenes
  ctx.fillStyle = 'rgba(255,246,227,0.92)';
  for (const [ox, oy, r] of [[0, 0, 44], [38, 12, 34], [-32, 14, 30], [18, -24, 26]]) {
    ctx.beginPath(); ctx.arc(-16 + ox, cam.h + 20 + oy, r, 0, TAU); ctx.fill();
  }
  drawHud(world, ctx);
  if (world.hoverTarget) drawHoverPanel(ctx, cam, world.hoverTarget);
  // World-scene modals draw last, over everything else. Each draw*Panel returns the
  // screen-space button rects it just laid out; updateWorldScreens() hit-tests clicks
  // against whatever was drawn last frame, the same lag the existing menuHitRegions
  // pattern (src/main.js) already accepts.
  if (world.screen) {
    if (world.screen.kind === 'brief') world.screenButtons = drawBriefPanel(ctx, cam, world.screen);
    else if (world.screen.kind === 'aftermath') world.screenButtons = drawAftermathPanel(ctx, cam, world.screen);
    else if (world.screen.kind === 'spec') world.screenButtons = drawSpecPanel(ctx, cam, world.screen);
    else if (world.screen.kind === 'perk') world.screenButtons = drawPerkPanel(ctx, cam, world.screen);
    else if (world.screen.kind === 'site') world.screenButtons = drawSitePanel(ctx, cam, world.screen);
  } else {
    world.screenButtons = null;
  }
}

// a built wooden crossing, not a bare cream slab: planks, rail posts, and piers
// sunk into the water, plus a cast shadow so the deck reads as sitting above the current
// Plan 023: the stale-world cue — the map reads as a held still frame while the hero is
// stopped. `world.staleT` (0..1) is advanced in World.updateWorldClock(); this function
// only READS it, because draw() runs zero or many times per tick. Two full-viewport
// fillRects and one cached gradient: no beginPath and no arc, so it costs nothing against
// the structural Canvas budget in performance.spec.js. It draws even when effects are off
// — this is information, not decoration: without it a stopped world has no explanation.
// Suppressed under a modal, which is already a stronger "the campaign is paused" statement.
export function drawFreezeCue(world, ctx, cam) {
  const k = world.staleT;
  if (k <= 0 || world.screen) return;
  // desaturation rather than darkening: the hues wash out, so the map reads as stale
  // rather than as night falling.
  ctx.save();
  ctx.globalCompositeOperation = 'saturation';
  // Kept LIGHT on purpose: the world layer under this wash carries gameplay-critical colour
  // coding (the red "they outmatch you" pill, the party marker), and a heavy desaturation
  // strips that signal. The cue only has to say "held", not "greyscale".
  ctx.globalAlpha = 0.28 * k;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, cam.w, cam.h);
  ctx.restore();
  // Vignette: one viewport-sized gradient, rebuilt only when the viewport actually
  // changes — the same bounded presentation cache as world._staticPaths.
  if (world._freezeVigW !== cam.w || world._freezeVigH !== cam.h) {
    const g = ctx.createRadialGradient(
      cam.w / 2, cam.h / 2, Math.min(cam.w, cam.h) * 0.48,
      cam.w / 2, cam.h / 2, Math.max(cam.w, cam.h) * 0.78);
    g.addColorStop(0, 'rgba(21,22,46,0)');
    g.addColorStop(1, 'rgba(21,22,46,0.34)');
    world._freezeVig = g; world._freezeVigW = cam.w; world._freezeVigH = cam.h;
  }
  ctx.save();
  ctx.globalAlpha = k;
  ctx.fillStyle = world._freezeVig;
  ctx.fillRect(0, 0, cam.w, cam.h);
  ctx.restore();
  drawWallCue(world, ctx, cam, k);
}

// One line for the ONE stall the wash cannot explain by itself: the rider is walled in and
// still pushing (`heroWallT`, published by World.updateHeroMovement — read only, like
// `staleT`). Everywhere else the wash means "you stopped", which needs no words. Costs
// nothing when the hero is merely parked, since it draws only in the blocked-with-input
// state, so the world baselines are unaffected.
//
// Deliberately gated on the wash (`k > 0`): since Plan 041's wall-slide a rider pushing
// along a bank keeps moving and keeps the clock flowing, and the slide IS the feedback.
// The line appears only when the slide has nowhere left to go — every heading blocked,
// time stalled, key still held — which is the one case the wash cannot explain. The
// 2026-09-03 audit refresh read the gate as a defect ("invisible in the common case");
// it is the contract, pinned by world-movement.spec.js. An ink plate keeps the cream text
// legible over any ground colour; `heroWallT` saturates in ~0.25s so it ramps the alpha.
function drawWallCue(world, ctx, cam, k) {
  if (!(world.heroWallT > 0) || !(k > 0)) return;
  const text = world.heroWallRiver
    ? 'The river bars the way — cross at a bridge or ford'
    : 'Broken ground bars the way — ride around it';
  ctx.save();
  ctx.globalAlpha = Math.min(1, k * 3) * Math.min(1, world.heroWallT);
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle'; // declared, see drawSettlement
  const w = ctx.measureText(text).width + 28, h = 30;
  const x = cam.w / 2, y = cam.h * 0.24;
  ctx.fillStyle = 'rgba(21,22,46,0.78)';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#EFE6CE';
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawBridge(world, ctx, bx, by) {
  ctx.save();
  ctx.translate(bx, by);
  let nearestWidth = WORLD_ART.rivers.normalWidth, nearestD = Infinity;
  for (const river of world._staticPaths.rivers) river.line.forEach((p, i) => {
    const d = (p[0] - bx) ** 2 + (p[1] - by) ** 2;
    if (d < nearestD) { nearestD = d; nearestWidth = river.profile[i].width; }
  });
  const deckW = Math.max(WORLD_ART.scale.bridge.min, Math.min(WORLD_ART.scale.bridge.max, nearestWidth + 18));
  const deckH = 18;
  // Dark abutments and tiny flat foam marks make contact with both bank and water explicit.
  ctx.fillStyle = P.ink; ctx.globalAlpha = 0.28;
  ctx.fillRect(-deckW / 2 - 5, -deckH / 2 - 4, 8, deckH + 8);
  ctx.fillRect(deckW / 2 - 3, -deckH / 2 - 4, 8, deckH + 8);
  ctx.fillStyle = WORLD_ART.palette.waterLight; ctx.globalAlpha = 0.38;
  ctx.beginPath(); ctx.ellipse(-deckW * 0.34, -deckH * 0.7, 7, 2, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(deckW * 0.32, deckH * 0.72, 6, 1.8, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = P.ink; ctx.globalAlpha = 0.22;
  ctx.beginPath(); ctx.ellipse(2, 4, deckW / 2, deckH / 2 + 3, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  const planks = 6, pw = deckW / planks;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = i % 2 ? '#E8D7A8' : P.cream;
    ctx.fillRect(-deckW / 2 + i * pw, -deckH / 2, pw, deckH);
  }
  ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4;
  for (let i = 1; i < planks; i++) {
    ctx.beginPath(); ctx.moveTo(-deckW / 2 + i * pw, -deckH / 2 + 2); ctx.lineTo(-deckW / 2 + i * pw, deckH / 2 - 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = P.ink; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-deckW / 2, -deckH / 2); ctx.lineTo(deckW / 2, -deckH / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-deckW / 2, deckH / 2); ctx.lineTo(deckW / 2, deckH / 2); ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let px = -19; px <= 19; px += 12.5) {
    ctx.beginPath(); ctx.moveTo(px, -deckH / 2); ctx.lineTo(px, -deckH / 2 - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, deckH / 2); ctx.lineTo(px, deckH / 2 + 5); ctx.stroke();
  }
  ctx.fillStyle = P.ink;
  for (const [px, py] of [[-deckW / 2, -deckH / 2], [deckW / 2, -deckH / 2], [-deckW / 2, deckH / 2], [deckW / 2, deckH / 2]]) {
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function drawSettlement(world, ctx, s) {
  ctx.save();
  const town = s.kind === 'town';
  const landmarkScale = town ? WORLD_ART.scale.fort.scale : WORLD_ART.scale.village.scale;
  ctx.translate(s.x, s.y); ctx.scale(landmarkScale, landmarkScale); ctx.translate(-s.x, -s.y);
  shadow(ctx, s.x, s.y + 12, town ? 70 : 52, town ? 36 : 28, P.groundShade, WORLD_ART.shadow.landmarkAlpha);
  const roofColor = town ? '#394B70'
    : s.id === 'ashford' ? '#24569A' : s.id === 'brindle' ? '#326746' : '#D8672B';
  // houses
  const house = (hx, hy, w, hh) => {
    // extruded: lit front + dark side wall + two-tone roof — drawn volume, not a flat glyph
    const ext = w * 0.26;
    ctx.fillStyle = '#FFF4D8'; ctx.fillRect(hx - w / 2, hy - hh, w, hh);
    ctx.fillStyle = '#D8C79E';
    ctx.beginPath(); ctx.moveTo(hx + w / 2, hy - hh); ctx.lineTo(hx + w / 2 + ext, hy - hh - ext * 0.4);
    ctx.lineTo(hx + w / 2 + ext, hy - ext * 0.4); ctx.lineTo(hx + w / 2, hy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = roofColor;
    ctx.beginPath(); ctx.moveTo(hx - w / 2 - 3, hy - hh); ctx.lineTo(hx, hy - hh - w * 0.55); ctx.lineTo(hx + w / 2 + 3, hy - hh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(roofColor, 0.7);
    ctx.beginPath(); ctx.moveTo(hx, hy - hh - w * 0.55); ctx.lineTo(hx + w / 2 + 3, hy - hh);
    ctx.lineTo(hx + w / 2 + ext, hy - hh - ext * 0.4); ctx.closePath(); ctx.fill();
    // Tiny amber windows are enough to make each building read as inhabited at map scale.
    ctx.fillStyle = P.accent;
    ctx.fillRect(hx - w * 0.27, hy - hh * 0.55, Math.max(3, w * 0.13), Math.max(3, hh * 0.23));
    ctx.fillStyle = '#8F4A2B';
    ctx.fillRect(hx + w * 0.12, hy - Math.max(7, hh * 0.48), Math.max(4, w * 0.14), Math.max(7, hh * 0.48));
  };
  if (town) {
    // keep with towers
    ctx.fillStyle = '#6F7890'; ctx.fillRect(s.x - 45, s.y - 60, 90, 60);
    ctx.fillStyle = P.cream; ctx.fillRect(s.x - 45, s.y - 70, 90, 12);
    for (const tx of [-45, 45]) {
      ctx.fillStyle = '#59657F'; ctx.fillRect(s.x + tx - 12, s.y - 90, 24, 90);
      ctx.fillStyle = P.cream; ctx.fillRect(s.x + tx - 15, s.y - 98, 30, 10);
    }
    ctx.fillStyle = P.accent;
    ctx.beginPath(); ctx.moveTo(s.x, s.y - 98); ctx.lineTo(s.x, s.y - 124); ctx.lineTo(s.x + 20, s.y - 118); ctx.lineTo(s.x, s.y - 112); ctx.closePath(); ctx.fill();
    house(s.x - 80, s.y + 26, 30, 22); house(s.x + 78, s.y + 20, 26, 18);
    // Gate, slit windows and stepped stone base turn the keep from a block into a landmark.
    ctx.fillStyle = P.ink;
    rrect(ctx, s.x - 12, s.y - 30, 24, 30, 10); ctx.fill();
    ctx.fillStyle = '#27324D';
    for (const wx of [-27, 0, 27]) ctx.fillRect(s.x + wx - 2, s.y - 48, 4, 12);
    ctx.fillStyle = '#69748A';
    ctx.fillRect(s.x - 58, s.y, 116, 8);
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
    // A readable miniature village: varied roofs overlap into one strong silhouette while
    // remaining open enough that the hero can be seen when riding through it.
    house(s.x - 30, s.y + 10, 40, 18);
    house(s.x + 18, s.y + 16, 22, 15);
    house(s.x + 43, s.y + 5, 24, 17);
    house(s.x - 2, s.y - 5, 26, 20);
    // Chapel tower supplies a clear vertical landmark among the clustered roofs.
    ctx.fillStyle = '#FFF4D8'; ctx.fillRect(s.x + 5, s.y - 42, 17, 34);
    ctx.fillStyle = shade(roofColor, 0.7);
    ctx.beginPath(); ctx.moveTo(s.x + 2, s.y - 42); ctx.lineTo(s.x + 13.5, s.y - 57);
    ctx.lineTo(s.x + 25, s.y - 42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.accent; ctx.fillRect(s.x + 11, s.y - 31, 5, 9);
    ctx.fillStyle = P.ink; ctx.fillRect(s.x - 2, s.y - 34, 12, 26);
    ctx.fillStyle = P.cream;
    ctx.beginPath(); ctx.moveTo(s.x - 6, s.y - 34); ctx.lineTo(s.x + 4, s.y - 44); ctx.lineTo(s.x + 14, s.y - 34); ctx.closePath(); ctx.fill();
    // windmill vane
    ctx.strokeStyle = P.ink; ctx.lineWidth = 3;
    if (s.id === 'ashford') {
      const a = world.time * 0.8;
      ctx.beginPath(); ctx.moveTo(s.x - 40, s.y - 30); ctx.lineTo(s.x - 40, s.y + 6); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const aa = a + i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(s.x - 40, s.y - 30); ctx.lineTo(s.x - 40 + Math.cos(aa) * 16, s.y - 30 + Math.sin(aa) * 16); ctx.stroke();
      }
    }
    // Warm village green and path bind the separate buildings into one destination.
    ctx.save();
    ctx.globalAlpha = 0.48; ctx.strokeStyle = '#FFE7AF'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x - 60, s.y + 22); ctx.quadraticCurveTo(s.x, s.y + 5, s.x + 62, s.y + 20); ctx.stroke();
    ctx.restore();
  }
  // Dark destination plates match the HUD hierarchy and stay readable over pale roads.
  // Baseline is DECLARED, never inherited: the interaction chip in render-actors.js ends
  // its frame on 'alphabetic' and the resource chip ends on 'middle', so map labels that
  // only set textAlign rendered their text jammed against the top edge of the plate on
  // every frame after the hero stood at a landmark. Every chip below centres its text on
  // the plate it just drew.
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // the specialization glyph rides on the name chip — one compact status icon. It is
  // measured BEFORE the plate so the plate is widened to hold it; sized in, it can never
  // be painted over the name.
  const rec = settlementRecord(world.save, s.id);
  const glyph = rec && rec.owner === OWNERSHIP.PLAYER && !rec.occupied && rec.spec
    ? SPECIALIZATIONS[rec.spec].glyph : null;
  const nameW = ctx.measureText(s.name).width;
  let glyphW = 0;
  if (glyph) {
    ctx.font = '800 12px Inter, system-ui, sans-serif';
    glyphW = ctx.measureText(glyph).width;
    ctx.font = '800 14px Inter, system-ui, sans-serif';
  }
  const gap = glyph ? 6 : 0;
  const contentW = nameW + gap + glyphW;
  const nw = contentW + 18;
  const contentX = s.x - contentW / 2;
  ctx.fillStyle = P.ink;
  rrect(ctx, s.x - nw / 2, s.y + 34, nw, 20, 6); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.fillText(s.name, contentX + nameW / 2, s.y + 44);
  if (glyph) {
    ctx.font = '800 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = P.hero;
    ctx.fillText(glyph, contentX + nameW + gap + glyphW / 2, s.y + 44);
  }

  // Milestone 025 Slice A: ownership reads from the map without any text — the
  // settlement's banner flies gold for the player, crimson while occupied, and
  // neutral cream otherwise; a player-held town with a specialization adds its
  // glyph to the name chip.
  const state = settlementState(world.save, s.id);
  const bannerColor = state === 'player' ? P.hero : state === 'occupied' ? P.enemy : P.cream;
  const poleX = s.kind === 'town' ? s.x + 58 : s.x + 44;
  const poleTop = s.y - (s.kind === 'town' ? 96 : 52);
  ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(poleX, s.y + 8); ctx.lineTo(poleX, poleTop); ctx.stroke();
  {
    const wave = Math.sin(world.time * 5) * 2;
    ctx.fillStyle = bannerColor;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop);
    ctx.lineTo(poleX + 22, poleTop + 7 + wave * 0.3);
    ctx.lineTo(poleX, poleTop + 14);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(poleX, poleTop); ctx.lineTo(poleX + 22, poleTop + 7 + wave * 0.3);
    ctx.lineTo(poleX, poleTop + 14); ctx.closePath(); ctx.stroke();
  }

  // Plan 020 design decision 4: occupied and threatened settlements carry their own
  // map markers, on top of the break-off toast — legibility must not depend on having
  // read a toast that already scrolled away.
  const occupied = world.isSettlementOccupied(s);
  const threatened = !occupied && world.parties.some(p => p.raid === s.id);
  if (occupied) {
    const label = 'OCCUPIED';
    ctx.font = '800 12px Inter, system-ui, sans-serif';
    const lw = ctx.measureText(label).width + 16;
    ctx.fillStyle = P.enemy;
    rrect(ctx, s.x - lw / 2, s.y + 58, lw, 18, 6); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    rrect(ctx, s.x - lw / 2, s.y + 58, lw, 18, 6); ctx.stroke();
    ctx.fillStyle = P.cream;
    ctx.fillText(label, s.x, s.y + 67);
  } else if (threatened) {
    // a pulsing warning ring — a raiding party is inbound but has not arrived yet
    const pulse = 6 + Math.sin(world.time * 5) * 3;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = P.enemy; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, (town ? 76 : 58) + pulse, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// A restrained screen-space frame turns unavoidable camera clipping of large, non-
// interactive silhouettes into a deliberate edge treatment. It never affects culling,
// world coordinates, input, or HUD contrast.
function drawCameraEdgeVeil(world, ctx, cam) {
  const size = WORLD_ART.framing.edgeVeil;
  const alpha = WORLD_ART.framing.edgeVeilAlpha;
  if (world._edgeVeilW !== cam.w || world._edgeVeilH !== cam.h) {
    const specs = [
      [0, 0, size, 0], [cam.w, 0, cam.w - size, 0],
      [0, 0, 0, size], [0, cam.h, 0, cam.h - size],
    ];
    world._edgeVeilGradients = specs.map(([x0, y0, x1, y1]) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgba(30,42,74,${alpha})`);
      g.addColorStop(1, 'rgba(30,42,74,0)');
      return g;
    });
    world._edgeVeilW = cam.w; world._edgeVeilH = cam.h;
  }
  const rects = [[0, 0, size, cam.h], [cam.w - size, 0, size, cam.h],
    [0, 0, cam.w, size], [0, cam.h - size, cam.w, size]];
  ctx.save();
  for (let i = 0; i < rects.length; i++) {
    ctx.fillStyle = world._edgeVeilGradients[i]; ctx.fillRect(...rects[i]);
  }
  ctx.restore();
}

export function drawCamp(world, ctx, c, razed) {
  if (razed) {
    ctx.strokeStyle = P.groundShade; ctx.lineWidth = 4;
    for (const [ox, oy] of [[-14, -8], [10, -4], [-2, 10]]) {
      ctx.beginPath(); ctx.moveTo(c.x + ox - 7, c.y + oy - 7); ctx.lineTo(c.x + ox + 7, c.y + oy + 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x + ox + 7, c.y + oy - 7); ctx.lineTo(c.x + ox - 7, c.y + oy + 7); ctx.stroke();
    }
    return;
  }
  ctx.save();
  const campScale = c.stronghold ? WORLD_ART.scale.fort.scale : WORLD_ART.scale.camp.scale;
  ctx.translate(c.x, c.y); ctx.scale(campScale, campScale); ctx.translate(-c.x, -c.y);
  shadow(ctx, c.x, c.y + 8, c.stronghold ? 52 : 28, 12, P.groundShade, WORLD_ART.shadow.landmarkAlpha);
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
    ctx.font = '800 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; // declared, see drawSettlement
    const holdW = ctx.measureText(c.name).width + 22;
    ctx.fillStyle = P.ink;
    rrect(ctx, c.x - holdW / 2, c.y + 43, holdW, 22, 6); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.fillText(c.name, c.x, c.y + 54);
    // Milestone 025 Slice A: the hold's power state is a map-readable word chip,
    // not a hidden number — its colour deepens as the hold weakens toward Exposed.
    const powerId = strongholdStateId(world.save);
    const label = STRONGHOLD_POWER_LABELS[powerId];
    ctx.font = '800 12px Inter, system-ui, sans-serif';
    const lw2 = ctx.measureText(label).width + 16;
    ctx.fillStyle = powerId === 'exposed' ? P.hero : P.enemy;
    rrect(ctx, c.x - lw2 / 2, c.y + 66, lw2, 18, 6); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    rrect(ctx, c.x - lw2 / 2, c.y + 66, lw2, 18, 6); ctx.stroke();
    ctx.fillStyle = powerId === 'exposed' ? P.ink : P.cream;
    ctx.fillText(label, c.x, c.y + 75);
  } else {
    tent(c.x - 16, c.y + 6, 14); tent(c.x + 14, c.y + 10, 12);
    // campfire
    ctx.fillStyle = P.accent;
    ctx.beginPath(); ctx.arc(c.x + 2, c.y - 10 + Math.sin(world.time * 7) * 1.5, 5 + Math.sin(world.time * 11) * 1.2, 0, TAU); ctx.fill();
    // label — scouted camps show what your scouts counted; unscouted stay a mystery
    const est = world.garrisonStrength(c);
    ctx.fillStyle = P.enemy;
    // same cream chip convention as settlement names — clamped inside the map so the
    // label can never be clipped by the viewport edge
    ctx.font = '800 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; // declared, see drawSettlement
    const cw2 = ctx.measureText('Bandit camp').width + 16;
    const ly2 = Math.min(c.y + 24, world.H - 30);
    ctx.fillStyle = P.enemy;
    rrect(ctx, c.x - cw2 / 2, ly2, cw2, 19, 6); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.fillText('Bandit camp', c.x, ly2 + 9.5);
  }
  ctx.restore();
}
