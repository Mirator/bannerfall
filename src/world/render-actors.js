// Campaign-map actors and HUD: the hero's rider, enemy party tokens with their body-count
// badge and odds pill, and the top/bottom HUD chrome. Presentation only — these read the
// World instance (and its save) and draw; they never advance simulation state.
import { PAL, UNIT_TYPES, BALANCE, oddsWord, ODDS_WORDS } from '../data.js?v=rd5531dcfef09';
import { TAU, dist2, rrect, shadow } from '../engine.js?v=rd5531dcfef09';

const P = PAL.world;

export function drawParty(world, ctx, p) {
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
  const pStr = world.strength(p.comp), mineStr = world.myStrength();
  const bodies = p.comp.length;
  const heavy = p.comp.includes('brute');
  // One odds judgment, reused for the badge colour and the pill text below.
  const oddsTxt = oddsWord(pStr, mineStr);
  const stronger = oddsTxt === ODDS_WORDS.outmatched;
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
  const dh = dist2(p.x, p.y, world.hero.x, world.hero.y);
  if (dh < 420 * 420) {
    ctx.fillStyle = stronger ? P.enemy : P.ink;
    ctx.font = '800 11px system-ui, sans-serif';
    // odds word sits in the same pill language as every other label
    const ow = ctx.measureText(oddsTxt).width + 14;
    ctx.fillStyle = P.cream;
    rrect(ctx, p.x - ow / 2, p.y - 58, ow, 17, 5); ctx.fill();
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5;
    rrect(ctx, p.x - ow / 2, p.y - 58, ow, 17, 5); ctx.stroke();
    ctx.fillStyle = stronger ? P.enemy : P.ink;
    ctx.fillText(oddsTxt, p.x, p.y - 49);
  }
}

export function drawHero(world, ctx) {
  const h = world.hero;
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
  const wave = Math.sin(world.time * 6) * 2;
  ctx.beginPath(); ctx.moveTo(h.x - 7, h.y - 52 + bobY); ctx.lineTo(h.x + 12, h.y - 46 + bobY + wave * 0.3); ctx.lineTo(h.x - 7, h.y - 40 + bobY); ctx.closePath(); ctx.fill();
  // Plan 021 design decision 1: warband badge shows BODIES (troops + the hero
  // himself), same convention as party/camp badges — strength stays internal.
  ctx.fillStyle = P.ink;
  ctx.beginPath(); ctx.arc(h.x + 18, h.y - 30, 9.5, 0, TAU); ctx.fill();
  ctx.fillStyle = P.hero;
  ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(world.save.troops.length + 1), h.x + 18, h.y - 29);
}

export function drawHud(world, ctx) {
  const cam = world.game.camera;
  const W = cam.w, H = cam.h;
  // top-left: gold, army
  ctx.fillStyle = P.ink;
  rrect(ctx, 14, 14, 240, 36, 8); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`⛃ ${world.save.gold}    ⚔ ${world.save.troops.length}/${world.save.armyCap}    ♥ ${world.save.heroHp}/${world.save.heroMaxHp}`, 26, 32);

  // objective (honest about the gate)
  const razed = world.save.camps.filter(c => c.razed && c.id !== 'strong').length;
  ctx.fillStyle = P.ink;
  rrect(ctx, W - 320, 14, 306, 36, 8); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.textAlign = 'right';
  ctx.fillText(razed < 3 ? `Raze the bandit camps (${razed}/3) to unlock Wolfsjaw` : 'Storm Wolfsjaw Hold!', W - 28, 32);

  // context prompt
  const s = world.nearSettlement();
  const camp = world.nearCamp();
  let lines = null;
  if (s && world.isSettlementOccupied(s)) {
    lines = [`${s.name} — OCCUPIED`, 'A raiding party has seized it — its service is suspended', 'Defeat them here to drive them out'];
  } else if (s) {
    const sc = world.costAt(s, 'spear'), ac = world.costAt(s, 'archer');
    const healTxt = s.freeHeal ? 'F Rest & heal FREE' : `F Rest & heal ${BALANCE.healCost}g`;
    lines = s.kind === 'town'
      ? [`${s.name} — ${s.flavor}`, `Q Spearman ${sc}g · E Archer ${ac}g · R Knight ${UNIT_TYPES.knight.cost}g`, `${healTxt} · T +2 army cap ${world.armyCapCost()}g`]
      : [`Village of ${s.name} — ${s.flavor}`, `Q Spearman ${sc}g · E Archer ${ac}g · ${healTxt}`];
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
  if (world.msgT > 0 && world.msg) {
    ctx.globalAlpha = Math.min(1, world.msgT * 2);
    ctx.fillStyle = P.ink;
    const tw = ctx.measureText(world.msg).width + 50;
    rrect(ctx, W / 2 - tw / 2, 70, tw, 34, 8); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(world.msg, W / 2, 88);
    ctx.globalAlpha = 1;
  }
}
