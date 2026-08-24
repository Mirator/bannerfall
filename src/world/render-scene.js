// Campaign-map scene composition: ground and light grading, terrain, roads and rivers,
// bridges, settlements and camps, then the actors and HUD on top, then any open modal.
// `drawScene` is the whole frame — World.draw() delegates to it.
import { PAL, WORLD } from '../data.js?v=r06a7e18cad00';
import { TAU, shadow, shade, tree, mountain, rrect, rock } from '../engine.js?v=r06a7e18cad00';
import {
  hoverTargetAt, drawHoverPanel, isOverHud, drawBriefPanel, drawAftermathPanel,
  drawSpecPanel,
} from '../world-screens.js?v=r06a7e18cad00';
import {
  settlementState, settlementRecord, SPECIALIZATIONS, OWNERSHIP,
  strongholdStateId, STRONGHOLD_POWER_LABELS,
} from '../region.js?v=r06a7e18cad00';
import { drawParty, drawHero, drawHud } from './render-actors.js?v=r06a7e18cad00';

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
  ctx.fillRect(-40, -40, world.W + 80, world.H + 80);
  ctx.strokeStyle = P.ink; ctx.lineWidth = 30;
  ctx.strokeRect(-15, -15, world.W + 30, world.H + 30);

  // ground blotches — cooler earth tone WITH the same hard ink edge every other shape
  // class carries (the battle terrain got this; the world map must speak the same language)
  ctx.fillStyle = '#C4873B'; ctx.fill(world._staticPaths.blotches);

  // world light grading: the same sun that lights every object sweeps one broad band
  // across the land; far corners fall into stepped shade — a lit world, not a color fill
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#FFF6E0';
  ctx.fill(world._staticPaths.light);
  ctx.fillStyle = P.ink;
  ctx.globalAlpha = 0.06;
  ctx.fill(world._staticPaths.shade);
  ctx.restore();

  // rivers with bridges — solid ink-outlined bands, same hard-edge language as every
  // other shape on this map (no alpha washes: layered translucency self-intersects into
  // visible gaps at the river's sharper hand-authored bends, and reads as hazy against
  // the flat-color rest of the scene). A narrow solid highlight + one animated dash pass
  // is enough to sell current without stacking soft bands.
  for (let ri = 0; ri < world.rivers.length; ri++) {
    const r = world.rivers[ri];
    const path = world._staticPaths.rivers[ri];
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // crisp ink bank, solid like every other outline on the map
    ctx.strokeStyle = P.ink; ctx.lineWidth = 38;
    ctx.stroke(path);
    // deep water body
    ctx.strokeStyle = P.water; ctx.lineWidth = 32;
    ctx.stroke(path);
    // shallow center channel — a solid lighter band reads as depth, not a soft glow
    ctx.strokeStyle = P.waterLight; ctx.lineWidth = 12;
    ctx.stroke(path);
    // flowing current: a dashed pass drifting downstream sells live water
    ctx.strokeStyle = P.cream; ctx.lineWidth = 4;
    ctx.setLineDash([12, 26]); ctx.lineDashOffset = -world.time * 50;
    ctx.stroke(path);
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    for (const [bx, by] of r.bridges) drawBridge(world, ctx, bx, by);
  }

  // roads between settlements
  ctx.strokeStyle = P.cream; ctx.lineWidth = 5; ctx.setLineDash([14, 16]);
  ctx.globalAlpha = 0.32;
  const S = WORLD.settlements;
  // gentle sag through a jittered midpoint: trails worn by travel, not ruler-drawn debug lines
  // no redundant diagonals: roads that crisscross at odd angles read as debug lines
  ctx.stroke(world._staticPaths.roads);
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  // scenery below entities
  for (const it of world.scenery) {
    if (!world.visible(it.x, it.y, it.kind === 'mtn' ? it.s * 1.5 : it.s * 2.2)) continue;
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
  for (const s of WORLD.settlements) if (world.visible(s.x, s.y, 140)) drawSettlement(world, ctx, s);
  // camps
  for (const c of WORLD.camps) {
    const st = world.save.camps.find(x => x.id === c.id);
    if (world.visible(c.x, c.y, 140)) drawCamp(world, ctx, c, st.razed);
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
}

export function drawBridge(world, ctx, bx, by) {
  ctx.save();
  ctx.translate(bx, by);
  ctx.fillStyle = P.ink; ctx.globalAlpha = 0.22;
  ctx.beginPath(); ctx.ellipse(2, 4, 29, 23, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  const planks = 6, pw = 52 / planks;
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = i % 2 ? '#E8D7A8' : P.cream;
    ctx.fillRect(-26 + i * pw, -20, pw, 40);
  }
  ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4;
  for (let i = 1; i < planks; i++) {
    ctx.beginPath(); ctx.moveTo(-26 + i * pw, -18); ctx.lineTo(-26 + i * pw, 18); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = P.ink; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-26, -20); ctx.lineTo(26, -20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-26, 20); ctx.lineTo(26, 20); ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let px = -19; px <= 19; px += 12.5) {
    ctx.beginPath(); ctx.moveTo(px, -20); ctx.lineTo(px, -25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px, 20); ctx.lineTo(px, 25); ctx.stroke();
  }
  ctx.fillStyle = P.ink;
  for (const [px, py] of [[-26, -20], [26, -20], [-26, 20], [26, 20]]) {
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function drawSettlement(world, ctx, s) {
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
    ctx.fillStyle = shade(P.cream, 0.8);
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
    const a = world.time * 0.8;
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
  // the specialization glyph rides on the name chip — one compact status icon
  {
    const rec = settlementRecord(world.save, s.id);
    if (rec && rec.owner === OWNERSHIP.PLAYER && !rec.occupied && rec.spec) {
      const glyph = SPECIALIZATIONS[rec.spec].glyph;
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.fillStyle = P.hero;
      ctx.fillText(glyph, s.x + nw / 2 - 9, s.y + 46);
    }
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
    const pulse = 6 + Math.sin(world.time * 5) * 3;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = P.enemy; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, (town ? 76 : 58) + pulse, 0, TAU); ctx.stroke();
    ctx.restore();
  }
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
    // Milestone 025 Slice A: the hold's power state is a map-readable word chip,
    // not a hidden number — its colour deepens as the hold weakens toward Exposed.
    const powerId = strongholdStateId(world.save);
    const label = STRONGHOLD_POWER_LABELS[powerId];
    ctx.font = '800 12px system-ui, sans-serif';
    const lw2 = ctx.measureText(label).width + 16;
    ctx.fillStyle = powerId === 'exposed' ? P.hero : P.enemy;
    rrect(ctx, c.x - lw2 / 2, c.y + 66, lw2, 18, 6); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    rrect(ctx, c.x - lw2 / 2, c.y + 66, lw2, 18, 6); ctx.stroke();
    ctx.fillStyle = powerId === 'exposed' ? P.ink : P.cream;
    ctx.fillText(label, c.x, c.y + 78);
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
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const cw2 = ctx.measureText('Bandit camp').width + 16;
    const ly2 = Math.min(c.y + 24, world.H - 30);
    ctx.fillStyle = P.cream;
    rrect(ctx, c.x - cw2 / 2, ly2, cw2, 19, 6); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    rrect(ctx, c.x - cw2 / 2, ly2, cw2, 19, 6); ctx.stroke();
    ctx.fillStyle = P.enemy;
    ctx.fillText('Bandit camp', c.x, ly2 + 10);
  }
}
