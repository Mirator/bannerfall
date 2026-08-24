// Campaign-map actors and HUD: the hero's rider, enemy party tokens with one body-count
// badge, and the top/bottom HUD chrome. Presentation only — these read the
// World instance (and its save) and draw; they never advance simulation state.
import { PAL, WORLD, UNIT_TYPES, oddsWord } from '../data.js?v=rdb594a1bb6f7';
import { TAU, rrect, shadow } from '../engine.js?v=rdb594a1bb6f7';
import {
  strongholdModifiers, STRONGHOLD_POWER_LABELS, OWNERSHIP, SPECIALIZATIONS,
} from '../region.js?v=rdb594a1bb6f7';
import { WORLD_ART, worldHudLayout, heroPresentationPosition } from './visual-style.js?v=rdb594a1bb6f7';

const specName = id => (SPECIALIZATIONS[id] || {}).name || id;

const P = PAL.world;
const WORLD_LANDMARKS = [...WORLD.settlements, ...WORLD.camps];

export function drawParty(world, ctx, p) {
  shadow(ctx, p.x, p.y + 4, 12, 10, P.groundShade, WORLD_ART.shadow.smallAlpha);
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
  // One supporting badge: bodies stay numeric, while its fill alone communicates danger.
  // Heavy composition, exact odds and intent remain available in the hover/brief models.
  const pStr = world.strength(p.comp), mineStr = world.myStrength();
  const bodies = p.comp.length;
  const outmatched = pStr > mineStr * 1.3;
  ctx.fillStyle = outmatched ? P.enemy : P.ink;
  ctx.beginPath(); ctx.arc(p.x + 16, p.y - 26, WORLD_ART.scale.unit.partyBadgeR, 0, TAU); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(bodies), p.x + 16, p.y - 25);
}

export function drawHero(world, ctx) {
  const actual = world.hero;
  // Arrival tokens dock above the landmark silhouette instead of collapsing the hero,
  // banner, body badge and destination into one unreadable knot. This copy is strictly
  // presentation state: navigation, interactions, camera and persistence use `actual`.
  const marker = heroPresentationPosition(world, WORLD_LANDMARKS);
  const h = marker.x === actual.x && marker.y === actual.y ? actual : { ...actual, ...marker };
  // trailing warband figures — the map shows YOUR band: spears, bows, knights are tellable
  const troopsArr = world.save.troops;
  const n = Math.min(6, Math.ceil(troopsArr.length / 2));
  for (let i = n - 1; i >= 0; i--) {
    const t = troopsArr[Math.min(troopsArr.length - 1, i * 2)];
    const a = h.facing + Math.PI + (i % 2 === 0 ? 0.35 : -0.35);
    const d = 24 + i * 14;
    const tx = h.x + Math.cos(a) * d, ty = h.y + Math.sin(a) * d * 0.7;
    const tb = Math.sin(h.bob - i * 0.9) * 1.4;
    const knight = t && t.type === 'knight';
    shadow(ctx, tx, ty + 2, knight ? 6 : 5, 6, P.groundShade, WORLD_ART.shadow.smallAlpha);
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
  shadow(ctx, h.x, h.y + 4, 13, 12, P.groundShade, WORLD_ART.shadow.smallAlpha);
  const bobY = Math.sin(h.bob) * 1.8;
  // hero always reads instantly at map zoom: a persistent cream accent ring under the token
  ctx.strokeStyle = P.cream; ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(h.x, h.y - 8, WORLD_ART.scale.unit.heroR, 0, TAU); ctx.stroke();
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
  const wave = Math.sin(world.time * 6) * 2;
  ctx.beginPath(); ctx.moveTo(h.x - 7, h.y - 52 + bobY); ctx.lineTo(h.x + 12, h.y - 46 + bobY + wave * 0.3); ctx.lineTo(h.x - 7, h.y - 40 + bobY); ctx.closePath(); ctx.fill();
  // Plan 021 design decision 1: warband badge shows BODIES (troops + the hero
  // himself), same convention as party/camp badges — strength stays internal.
  ctx.fillStyle = P.ink;
  ctx.beginPath(); ctx.arc(h.x + 18, h.y - 30, WORLD_ART.scale.unit.badgeR, 0, TAU); ctx.fill();
  ctx.fillStyle = P.hero;
  ctx.font = '800 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(world.save.troops.length + 1), h.x + 18, h.y - 29);
}

export function drawHud(world, ctx) {
  const cam = world.game.camera;
  const W = cam.w, H = cam.h;
  const layout = worldHudLayout(W, H);
  const resource = layout.resource, objective = layout.objective;
  // top-left: gold, army
  ctx.fillStyle = P.ink;
  rrect(ctx, resource.x, resource.y, resource.w, resource.h, WORLD_ART.hud.radius); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`⛃ ${world.save.gold}    ⚔ ${world.save.troops.length}/${world.save.armyCap}    ♥ ${world.save.heroHp}/${world.save.heroMaxHp}`, resource.x + 12, resource.y + resource.h / 2);

  // objective — Milestone 025: stronghold power, not a camp count. The player can
  // assault at any time; the chip says how much weakening has been earned so far.
  {
    const mods = strongholdModifiers(world.save);
    const label = STRONGHOLD_POWER_LABELS[mods.stateId];
    ctx.fillStyle = P.ink;
    rrect(ctx, objective.x, objective.y, objective.w, objective.h, WORLD_ART.hud.radius); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.textAlign = 'right';
    ctx.font = '800 14px Inter, system-ui, sans-serif';
    ctx.fillText(`Wolfsjaw: ${label}`, objective.x + objective.w - 14, objective.y + 14);
    ctx.fillStyle = P.hero;
    ctx.font = '800 12px Inter, system-ui, sans-serif';
    ctx.fillText(`◇  Weaken it (${mods.points}/${mods.maxPoints})`, objective.x + objective.w - 14, objective.y + 32);
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#B8C2D8';
    ctx.fillText('Capture settlements · raze camps', objective.x + objective.w - 14, objective.y + 47);
  }

  // Milestone 025 Slice D: an active regional raid warns above the toast line.
  const raidParty = world.parties.find(p => p.raid && p.raidKind === 'regional');
  if (raidParty) {
    const targetDef = WORLD.settlements.find(s => s.id === raidParty.raid);
    if (targetDef) {
      ctx.fillStyle = P.enemy;
      const warn = `⚠ Raiders ride on ${targetDef.name}!`;
      ctx.font = '800 14px Inter, system-ui, sans-serif';
      const ww = ctx.measureText(warn).width + 40;
      rrect(ctx, W / 2 - ww / 2, layout.topSafe.h + 4 + Math.sin(world.time * 6) * 2, ww, 30, 8); ctx.fill();
      ctx.fillStyle = P.cream;
      ctx.textAlign = 'center';
      ctx.fillText(warn, W / 2, layout.topSafe.h + 20);
    }
  }

  // context prompt
  const s = world.nearSettlement();
  const camp = world.nearCamp();
  let lines = null;
  if (s && world.isSettlementOccupied(s)) {
    lines = [`${s.name} — OCCUPIED`, 'A raiding party has seized it — its service is suspended', 'Defeat them here to drive them out'];
  } else if (s) {
    const sc = world.costAt(s, 'spear'), ac = world.costAt(s, 'archer');
    const healTxt = s.freeHeal ? 'F Rest & heal FREE' : `F Rest & heal ${world.healCostAt(s)}g`;
    const rec = world.save.settlements.find(x => x.id === s.id);
    const owned = rec && rec.owner === OWNERSHIP.PLAYER;
    const specLine = owned && rec.spec ? `${rec.spec === 'watchtower' ? '' : ''}${specName(rec.spec)}` : null;
    const claimLine = !owned && !rec?.spec ? 'G Claim this settlement for your banner' : null;
    const base = s.kind === 'town'
      ? [`${s.name} — ${s.flavor}`, `Q Spearman ${sc}g · E Archer ${ac}g · R Knight ${UNIT_TYPES.knight.cost}g`, `${healTxt} · T +2 army cap ${world.armyCapCost()}g`]
      : [`Village of ${s.name} — ${s.flavor}`, `Q Spearman ${sc}g · E Archer ${ac}g · ${healTxt}`];
    if (owned && rec.spec) base.push(`${s.name} is yours — ${specLine}`);
    else if (!owned) base.push(claimLine);
    lines = base;
  } else if (camp) {
    const razedC = world.save.camps.filter(c => c.razed && c.id !== 'strong').length;
    const est = world.garrisonStrength(camp), mine = world.myStrength();
    // Plan 021 design decision 3: proximity prompts carry only the odds WORD, never a
    // strength number — badges are bodies, prompts are words, hover shows both. Hover
    // the camp for the full breakdown.
    const odds = est == null ? 'ride closer to scout it' : oddsWord(est, mine);
    lines = camp.stronghold
      ? (razedC < 3 ? [`${camp.name} — enemy stronghold`, `Its camps still feed it: cut the supply lines (${razedC}/3)`] : [`${camp.name} — enemy stronghold`, odds, 'E Storm the hold!'])
      : [`Bandit camp — ${odds}`, 'E Raid the camp (counts toward the 3)'];
  }
  if (lines) {
    const bw = Math.min(W - WORLD_ART.hud.margin * 2, WORLD_ART.hud.contextW);
    const panelH = lines.length * 22 + 16;
    const bx = W / 2 - bw / 2, by = H - panelH - WORLD_ART.hud.margin;
    ctx.fillStyle = P.ink;
    rrect(ctx, bx, by, bw, lines.length * 22 + 16, 10); ctx.fill();
    ctx.fillStyle = P.cream; ctx.textAlign = 'center';
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? '800 15px Inter, system-ui, sans-serif' : '600 13px Inter, system-ui, sans-serif';
      ctx.fillText(l, W / 2, by + 20 + i * 22);
    });
  }

  // toast
  if (world.msgT > 0 && world.msg) {
    ctx.globalAlpha = Math.min(1, world.msgT * 2);
    ctx.fillStyle = P.ink;
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    const tw = Math.min(W - WORLD_ART.hud.margin * 2, ctx.measureText(world.msg).width + 50);
    rrect(ctx, W / 2 - tw / 2, 70, tw, 34, 8); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.textAlign = 'center';
    ctx.fillText(world.msg, W / 2, 88);
    ctx.globalAlpha = 1;
  }
}
