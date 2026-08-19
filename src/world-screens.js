// Plan 021 — pure functions and plain-data models for map legibility and the
// battle brief/aftermath screens. No phase ownership, no simulation state: the
// same shape as engine.js's rrect/tree/mountain helpers, which already live
// outside the scenes. World.js owns `this.hoverTarget`/`this.screen`/`this.pending`
// and calls into these helpers from draw()/updateWorldScreens().
import { WORLD, UNIT_TYPES, ENEMY_TYPES, enemyStrength, playerStrength } from './data.js?v=r4873a112c73f';
import { rrect } from './engine.js?v=r4873a112c73f';
import { SQUAD_LABELS } from './battle.js?v=r4873a112c73f';

const ENEMY_LABELS = Object.freeze({ bandit: 'bandit', raider: 'raider', wolf: 'wolf', brute: 'brute' });
const ENEMY_LABELS_PLURAL = Object.freeze({ bandit: 'bandits', raider: 'raiders', wolf: 'wolves', brute: 'brutes' });
const UNIT_LABELS = Object.freeze({ spear: 'spearman', archer: 'archer', knight: 'knight' });
const UNIT_LABELS_PLURAL = Object.freeze({ spear: 'spearmen', archer: 'archers', knight: 'knights' });

// Frequency-count rows for a flat list of dead enemy types (result.deadTypes already
// names exactly who died — no before/after subtraction needed).
function countRows(list, singular, plural) {
  const counts = countByType(list, Object.keys(singular));
  return Object.keys(singular).filter(t => counts[t] > 0)
    .map(t => ({ count: counts[t], label: counts[t] === 1 ? singular[t] : plural[t] }));
}
// Before/after subtraction for the player roster: "losses" is not directly reported,
// only the pre-battle roster and result.survivors.
function lossRows(beforeTypes, afterTypes, singular, plural) {
  const before = countByType(beforeTypes, Object.keys(singular));
  const after = countByType(afterTypes, Object.keys(singular));
  const rows = [];
  for (const t of Object.keys(singular)) {
    const lost = Math.max(0, before[t] - (after[t] || 0));
    if (lost > 0) rows.push({ count: lost, label: lost === 1 ? singular[t] : plural[t] });
  }
  return rows;
}

function countByType(list, types) {
  const counts = Object.create(null);
  for (const t of types) counts[t] = 0;
  for (const entry of list) {
    const type = typeof entry === 'string' ? entry : entry.type;
    if (counts[type] == null) counts[type] = 0;
    counts[type]++;
  }
  return counts;
}

// "6 riders · fighting weight 14 · yours 9" style breakdowns — one comma list of
// non-zero unit-type counts, in a stable declared order.
function enemyBreakdown(comp) {
  const counts = countByType(comp, Object.keys(ENEMY_TYPES));
  return Object.keys(ENEMY_TYPES).filter(t => counts[t] > 0)
    .map(t => `${counts[t]} ${counts[t] === 1 ? ENEMY_LABELS[t] : ENEMY_LABELS_PLURAL[t]}`).join(', ');
}
function troopBreakdown(troops) {
  const counts = countByType(troops, Object.keys(UNIT_TYPES));
  return Object.keys(UNIT_TYPES).filter(t => counts[t] > 0).map(t => `${counts[t]} ${SQUAD_LABELS[t]}`).join(', ');
}

function partyIntent(p) {
  if (p.occupying) return 'holding a settlement it occupies';
  if (p.raid) return 'riding to raid a settlement';
  if (p.mood === 'chase') return 'hunting you down';
  if (p.mood === 'flee') return 'fleeing from you';
  return 'patrolling';
}

// ---------------------------------------------------------------- hover
// Nearest-candidate hit test over the hero/warband, visible roaming parties, and
// visible non-razed camps (scouted or not — an unscouted camp still hovers, it
// just shows no composition, per the "what you scouted is what you fight" rule).
export function hoverTargetAt(world, wx, wy) {
  let best = null, bestD2 = Infinity;
  const heroR = 46, heroD2 = (wx - world.hero.x) ** 2 + (wy - world.hero.y) ** 2;
  if (heroD2 <= heroR * heroR) { best = { kind: 'hero' }; bestD2 = heroD2; }
  for (const p of world.parties) {
    if (!world.visible(p.x, p.y, 100)) continue;
    const r = 40, d2 = (wx - p.x) ** 2 + (wy - p.y) ** 2;
    if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; best = { kind: 'party', party: p }; }
  }
  for (const c of WORLD.camps) {
    const st = world.save.camps.find(s => s.id === c.id);
    if (!st || st.razed) continue;
    if (!world.visible(c.x, c.y, 140)) continue;
    const r = c.stronghold ? 90 : 70, d2 = (wx - c.x) ** 2 + (wy - c.y) ** 2;
    if (d2 <= r * r && d2 < bestD2) { bestD2 = d2; best = { kind: 'camp', camp: c, campState: st }; }
  }
  if (!best) return null;

  if (best.kind === 'hero') {
    const troops = world.save.troops;
    const strength = playerStrength(troops);
    return {
      kind: 'hero', x: world.hero.x, y: world.hero.y,
      title: 'Your warband', bodies: troops.length + 1, strength,
      lines: [
        troops.length ? troopBreakdown(troops) : 'no troops — just you',
        `you count for 3 · fighting weight ${strength}`,
      ],
    };
  }
  if (best.kind === 'party') {
    const p = best.party;
    const bodies = p.comp.length, heavy = p.comp.includes('brute');
    const strength = enemyStrength(p.comp), mine = playerStrength(world.save.troops);
    // Same odds-word convention as the close-range pill drawn under the party token
    // (world.js drawParty) — hover repeats it alongside the numbers it omits.
    const odds = strength > mine * 1.15 ? '⚠ they outmatch you' : strength < mine * 0.85 ? 'favored' : 'an even fight';
    return {
      kind: 'party', x: p.x, y: p.y,
      title: heavy ? 'Raiding party (heavy)' : 'Raiding party',
      bodies, heavy, strength, mine, odds, mood: p.mood || null,
      lines: [
        `${bodies} riders${heavy ? ' (heavy)' : ''} · fighting weight ${strength} · yours ${mine}`,
        enemyBreakdown(p.comp),
        `${odds} · ${partyIntent(p)}`,
      ],
    };
  }
  // camp
  const { camp, campState } = best;
  const title = camp.stronghold ? camp.name : 'Bandit camp';
  if (!campState.garrison) {
    return { kind: 'camp', x: camp.x, y: camp.y, scouted: false, title, lines: ['unscouted — ride closer to scout it'] };
  }
  const bodies = campState.garrison.length, heavy = campState.garrison.includes('brute');
  const strength = enemyStrength(campState.garrison), mine = playerStrength(world.save.troops);
  return {
    kind: 'camp', x: camp.x, y: camp.y, scouted: true, title,
    bodies, heavy, strength, mine,
    lines: [
      `${bodies} defenders${heavy ? ' (heavy)' : ''} · fighting weight ${strength} · yours ${mine}`,
      enemyBreakdown(campState.garrison),
    ],
  };
}

// Suppress hover while the pointer sits over a HUD rect: the top gold/army and
// objective chips, the toast, and the bottom context-prompt panel.
export function isOverHud(mx, my, camW, camH) {
  if (my < 112) return true;
  if (my > camH - 112) return true;
  return false;
}

function worldToScreen(cam, x, y) {
  return { x: (x - cam.x) * cam.zoom + cam.w / 2, y: (y - cam.y) * cam.zoom + cam.h / 2 };
}

export function drawHoverPanel(ctx, cam, model) {
  if (!model) return;
  const anchor = worldToScreen(cam, model.x, model.y);
  const lines = [model.title, ...model.lines];
  ctx.font = '800 13px system-ui, sans-serif';
  let w = ctx.measureText(lines[0]).width;
  ctx.font = '600 12px system-ui, sans-serif';
  for (let i = 1; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
  const pw = w + 28, ph = lines.length * 18 + 14;
  let px = anchor.x - pw / 2, py = anchor.y - ph - 34;
  px = Math.max(6, Math.min(cam.w - pw - 6, px));
  py = Math.max(6, Math.min(cam.h - ph - 6, py));
  ctx.fillStyle = 'rgba(30,42,74,0.94)';
  rrect(ctx, px, py, pw, ph, 8); ctx.fill();
  ctx.strokeStyle = '#F2E3C1'; ctx.lineWidth = 1.5;
  rrect(ctx, px, py, pw, ph, 8); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#F2E3C1';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.fillText(lines[0], px + 14, py + 20);
  ctx.font = '600 12px system-ui, sans-serif';
  for (let i = 1; i < lines.length; i++) ctx.fillText(lines[i], px + 14, py + 20 + i * 18);
}

// ---------------------------------------------------------------- brief
// `descriptor` is built by World.requestBattle's callers (see world.js); it never
// carries a live reference the confirm/cancel path would need to mutate later.
export function buildBriefModel(descriptor, save) {
  const playerRoster = troopBreakdown(save.troops) || 'no troops — just you';
  const playerBodies = save.troops.length + 1;
  const playerStr = playerStrength(save.troops);
  const scouted = descriptor.comp != null;
  const enemyRoster = scouted ? enemyBreakdown(descriptor.comp) : 'unknown — unscouted';
  const enemyBodies = scouted ? descriptor.comp.length : null;
  const enemyStr = scouted ? enemyStrength(descriptor.comp) : null;
  const odds = !scouted ? 'unknown' : enemyStr > playerStr * 1.15 ? '⚠ they outmatch you'
    : enemyStr < playerStr * 0.85 ? 'favored' : 'an even fight';
  return {
    kind: 'brief',
    title: descriptor.title,
    subtitle: descriptor.subtitle || null,
    arena: descriptor.arena || null,
    approach: descriptor.approach || 'E',
    canWithdraw: !!descriptor.canWithdraw,
    odds,
    options: { confirm: true, withdraw: !!descriptor.canWithdraw },
    player: { roster: playerRoster, bodies: playerBodies, strength: playerStr },
    enemy: { roster: enemyRoster, bodies: enemyBodies, strength: enemyStr, scouted },
  };
}

export function drawBriefPanel(ctx, cam, model) {
  const W = cam.w, H = cam.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(21,22,46,0.72)';
  ctx.fillRect(0, 0, W, H);
  const pw = Math.min(720, W - 60), ph = Math.min(420, H - 60);
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  ctx.fillStyle = '#1E2A4A';
  rrect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = '#F2E3C1'; ctx.lineWidth = 2;
  rrect(ctx, px, py, pw, ph, 14); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#F2E3C1';
  ctx.font = '900 26px system-ui, sans-serif';
  ctx.fillText(model.title || 'BATTLE', W / 2, py + 40);
  if (model.subtitle) {
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.fillStyle = '#FFD34D';
    ctx.fillText(model.subtitle, W / 2, py + 64);
  }
  const colY = py + (model.subtitle ? 96 : 84);
  const colW = pw / 2 - 40;
  const leftX = px + pw / 4, rightX = px + pw * 3 / 4;
  ctx.textAlign = 'left';
  ctx.font = '800 15px system-ui, sans-serif';
  ctx.fillStyle = '#F2E3C1';
  ctx.fillText('YOUR WARBAND', leftX - colW / 2, colY);
  ctx.fillText('THE ENEMY', rightX - colW / 2, colY);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(model.player.roster, leftX - colW / 2, colY + 26);
  ctx.fillText(`${model.player.bodies} bodies · fighting weight ${model.player.strength}`, leftX - colW / 2, colY + 46);
  ctx.fillText(model.enemy.roster, rightX - colW / 2, colY + 26);
  ctx.fillText(
    model.enemy.scouted ? `${model.enemy.bodies} bodies · fighting weight ${model.enemy.strength}` : 'composition unknown',
    rightX - colW / 2, colY + 46,
  );
  ctx.textAlign = 'center';
  ctx.font = '800 16px system-ui, sans-serif';
  ctx.fillStyle = model.odds === '⚠ they outmatch you' ? '#C23A2E' : '#F2E3C1';
  ctx.fillText(model.odds, W / 2, colY + 86);
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillStyle = '#F2E3C1';
  ctx.fillText(`Arena: ${model.arena || 'field'}`, W / 2, colY + 110);

  // Real clickable buttons, not just a text footer — updateWorldScreens() hit-tests
  // clicks against the rects returned here (drawn last frame, one frame of lag, the
  // same idiom src/main.js's menuHitRegions already uses).
  const footerY = py + ph - 30, btnH = 30;
  ctx.font = '800 13px system-ui, sans-serif';
  const confirmLabel = 'ENTER — Confirm', withdrawLabel = 'X — Withdraw';
  const confirmW = ctx.measureText(confirmLabel).width + 28;
  let confirmRect, withdrawRect = null;
  if (model.canWithdraw) {
    const withdrawW = ctx.measureText(withdrawLabel).width + 28, gap = 20;
    const startX = W / 2 - (confirmW + gap + withdrawW) / 2;
    confirmRect = { x: startX, y: footerY - btnH / 2, w: confirmW, h: btnH };
    withdrawRect = { x: startX + confirmW + gap, y: footerY - btnH / 2, w: withdrawW, h: btnH };
  } else {
    confirmRect = { x: W / 2 - confirmW / 2, y: footerY - btnH / 2, w: confirmW, h: btnH };
  }
  drawButton(ctx, confirmRect, confirmLabel, true);
  if (withdrawRect) drawButton(ctx, withdrawRect, withdrawLabel, false);
  ctx.textBaseline = 'alphabetic';
  return { confirm: confirmRect, withdraw: withdrawRect };
}

function drawButton(ctx, rect, label, accent) {
  ctx.fillStyle = accent ? '#FFD34D' : '#F2E3C1';
  rrect(ctx, rect.x, rect.y, rect.w, rect.h, 8); ctx.fill();
  ctx.strokeStyle = '#1E2A4A'; ctx.lineWidth = 2;
  rrect(ctx, rect.x, rect.y, rect.w, rect.h, 8); ctx.stroke();
  ctx.fillStyle = '#1E2A4A';
  ctx.font = '800 13px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
}

// ---------------------------------------------------------------- aftermath
// `payload` (game.pendingAftermath, built in World's onEnd closure and consumed/cleared
// in the next World's constructor) carries raw snapshots; this builds the display model
// — per-side casualties by unit type — the same way hover/brief build theirs from raw
// state rather than being handed already-formatted text.
export function buildAftermathModel(payload) {
  const playerLosses = lossRows(payload.preTroopTypes, payload.survivorTypes, UNIT_LABELS, UNIT_LABELS_PLURAL);
  const enemyLosses = countRows(payload.deadTypes, ENEMY_LABELS, ENEMY_LABELS_PLURAL);
  return {
    kind: 'aftermath',
    victory: !!payload.victory,
    retreated: !!payload.retreated,
    loot: payload.loot || 0,
    heroHp: payload.heroHp,
    heroMaxHp: payload.heroMaxHp,
    consequence: payload.consequence || null,
    playerLosses,
    enemyLosses,
  };
}

export function drawAftermathPanel(ctx, cam, model) {
  const W = cam.w, H = cam.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(21,22,46,0.78)';
  ctx.fillRect(0, 0, W, H);
  const pw = Math.min(680, W - 60), ph = Math.min(440, H - 60);
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  ctx.fillStyle = '#1E2A4A';
  rrect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = '#F2E3C1'; ctx.lineWidth = 2;
  rrect(ctx, px, py, pw, ph, 14); ctx.stroke();
  ctx.textAlign = 'center';
  const headline = model.victory ? 'VICTORY' : model.retreated ? 'WITHDRAWN' : 'DEFEAT';
  ctx.fillStyle = model.victory ? '#7CE06B' : model.retreated ? '#F2E3C1' : '#C23A2E';
  ctx.font = '900 30px system-ui, sans-serif';
  ctx.fillText(headline, W / 2, py + 44);

  ctx.textAlign = 'left';
  ctx.font = '800 14px system-ui, sans-serif';
  ctx.fillStyle = '#F2E3C1';
  const colW = pw / 2 - 40;
  const leftX = px + 40, rightX = px + pw / 2 + 20;
  let y = py + 84;
  ctx.fillText('YOUR LOSSES', leftX, y);
  ctx.fillText('ENEMY LOSSES', rightX, y);
  ctx.font = '600 13px system-ui, sans-serif';
  const lossLines = (losses) => losses.length ? losses.map(l => `${l.count} ${l.label}`) : ['none'];
  const playerLossLines = lossLines(model.playerLosses || []);
  const enemyLossLines = lossLines(model.enemyLosses || []);
  const rows = Math.max(playerLossLines.length, enemyLossLines.length);
  for (let i = 0; i < rows; i++) {
    if (playerLossLines[i]) ctx.fillText(playerLossLines[i], leftX, y + 22 + i * 18);
    if (enemyLossLines[i]) ctx.fillText(enemyLossLines[i], rightX, y + 22 + i * 18);
  }
  y += 22 + rows * 18 + 20;
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.fillStyle = '#FFD34D';
  ctx.fillText(`Loot: +${model.loot || 0} gold`, leftX, y);
  ctx.fillText(`Hero HP: ${model.heroHp}/${model.heroMaxHp}`, rightX, y);
  y += 30;
  if (model.consequence) {
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#F2E3C1';
    ctx.textAlign = 'center';
    // The consequence toast can run long (razed-camp remnant notes); wrap it instead of
    // spilling off the panel edges.
    const words = model.consequence.split(' ');
    let line = '', lineY = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > pw - 80 && line) {
        ctx.fillText(line, W / 2, lineY);
        line = word; lineY += 18;
      } else line = test;
    }
    if (line) ctx.fillText(line, W / 2, lineY);
  }
  ctx.textAlign = 'center';
  const continueLabel = 'ENTER — Continue';
  ctx.font = '800 13px system-ui, sans-serif';
  const btnW = ctx.measureText(continueLabel).width + 28, btnH = 30, footerY = py + ph - 24;
  const confirmRect = { x: W / 2 - btnW / 2, y: footerY - btnH / 2, w: btnW, h: btnH };
  drawButton(ctx, confirmRect, continueLabel, true);
  ctx.textBaseline = 'alphabetic';
  return { confirm: confirmRect, withdraw: null };
}
