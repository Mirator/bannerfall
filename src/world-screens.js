// Plan 021 — pure functions and plain-data models for map legibility and the
// battle brief/aftermath screens. No phase ownership, no simulation state: the
// same shape as engine.js's rrect/tree/mountain helpers, which already live
// outside the scenes. World.js owns `this.hoverTarget`/`this.screen`/`this.pending`
// and calls into these helpers from draw()/updateWorldScreens().
import { PAL, WORLD, UNIT_TYPES, ENEMY_TYPES, enemyStrength, playerStrength, oddsWord, ODDS_WORDS } from './data.js?v=r44f9dbca8fbc';
import { clamp, rrect } from './engine.js?v=r44f9dbca8fbc';
import { SQUAD_LABELS } from './battle/constants.js?v=r44f9dbca8fbc';
import {
  SPECIALIZATIONS, SPEC_IDS, OBJECTIVE_LABELS, STRONGHOLD_POWER_LABELS,
} from './region.js?v=r44f9dbca8fbc';
import { pointInWorldHud, heroPresentationPosition } from './world/visual-style.js?v=r44f9dbca8fbc';

// Same palette the world scene draws with — these panels sit on top of it.
const P = PAL.world;
const WORLD_LANDMARKS = [...WORLD.settlements, ...WORLD.camps];

// Prose labels, derived from the type tables rather than hand-copied: adding a unit or
// enemy type can no longer silently drop it from a breakdown or casualty list. Singular
// is the table's own `name`, lowercased for mid-sentence use ('2 spearmen', 'a bandit');
// plurals are declared because 'spearmen'/'wolves' are not derivable. Object key order
// follows the tables, which is what gives the rows their stable display order.
const labelsOf = (types, field) =>
  Object.freeze(Object.fromEntries(Object.keys(types).map(t => [t, field(types[t])])));
const ENEMY_LABELS = labelsOf(ENEMY_TYPES, d => d.name.toLowerCase());
const ENEMY_LABELS_PLURAL = labelsOf(ENEMY_TYPES, d => d.plural);
const UNIT_LABELS = labelsOf(UNIT_TYPES, d => d.name.toLowerCase());
const UNIT_LABELS_PLURAL = labelsOf(UNIT_TYPES, d => d.plural);

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
  const heroMarker = heroPresentationPosition(world, WORLD_LANDMARKS);
  const heroR = 46, heroD2 = (wx - heroMarker.x) ** 2 + (wy - heroMarker.y) ** 2;
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
      kind: 'hero', x: heroMarker.x, y: heroMarker.y,
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
    const odds = oddsWord(strength, mine);
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
  return pointInWorldHud(mx, my, camW, camH);
}

function worldToScreen(cam, x, y) {
  return { x: (x - cam.x) * cam.zoom + cam.w / 2, y: (y - cam.y) * cam.zoom + cam.h / 2 };
}

export function drawHoverPanel(ctx, cam, model) {
  if (!model) return;
  const anchor = worldToScreen(cam, model.x, model.y);
  const lines = [model.title, ...model.lines];
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  let w = ctx.measureText(lines[0]).width;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  for (let i = 1; i < lines.length; i++) w = Math.max(w, ctx.measureText(lines[i]).width);
  const pw = w + 28, ph = lines.length * 18 + 14;
  let px = anchor.x - pw / 2, py = anchor.y - ph - 34;
  px = clamp(px, 6, Math.max(6, cam.w - pw - 6));
  py = clamp(py, 6, Math.max(6, cam.h - ph - 6));
  ctx.fillStyle = 'rgba(30,42,74,0.94)';
  rrect(ctx, px, py, pw, ph, 8); ctx.fill();
  ctx.strokeStyle = P.cream; ctx.lineWidth = 1.5;
  rrect(ctx, px, py, pw, ph, 8); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = P.cream;
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  ctx.fillText(lines[0], px + 14, py + 20);
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  for (let i = 1; i < lines.length; i++) ctx.fillText(lines[i], px + 14, py + 20 + i * 18);
}

// ---------------------------------------------------------------- brief
// `descriptor` is built by World.requestBattle's callers (see world.js); it never
// carries a live reference the confirm/cancel path would need to mutate later.
// Milestone 025: the descriptor may carry `objective` (Hold/Break) and, for the
// stronghold assault, a `stronghold` power summary — both are rendered as explicit
// lines so the objective and its stakes are stated before commitment.
export function buildBriefModel(descriptor, save) {
  const playerRoster = troopBreakdown(save.troops) || 'no troops — just you';
  const playerBodies = save.troops.length + 1;
  const playerStr = playerStrength(save.troops);
  const scouted = descriptor.comp != null || !!descriptor.revealDeployment;
  const enemyRoster = scouted ? enemyBreakdown(descriptor.comp) : 'unknown — unscouted';
  const enemyBodies = scouted ? descriptor.comp.length : null;
  const enemyStr = scouted ? enemyStrength(descriptor.comp) : null;
  const odds = !scouted ? 'unknown' : oddsWord(enemyStr, playerStr);
  const objective = descriptor.objective || null;
  const stronghold = descriptor.stronghold || null;
  return {
    kind: 'brief',
    title: descriptor.title,
    subtitle: descriptor.subtitle || null,
    arena: descriptor.arena || null,
    approach: descriptor.approach || 'E',
    canWithdraw: !!descriptor.canWithdraw,
    odds,
    // Milestone 025 UX contract: state the objective, the deployment context and
    // the consequences of withdrawal on the brief itself.
    objective: objective ? buildObjectiveBriefLines(objective) : null,
    stronghold: stronghold ? {
      label: stronghold.label,
      advantages: stronghold.advantages.slice(),
    } : null,
    options: { confirm: true, withdraw: !!descriptor.canWithdraw },
    player: { roster: playerRoster, bodies: playerBodies, strength: playerStr },
    enemy: { roster: enemyRoster, bodies: enemyBodies, strength: enemyStr, scouted },
  };
}

function buildObjectiveBriefLines(objective) {
  if (objective.kind === 'hold') {
    return [
      `${OBJECTIVE_LABELS.hold}: keep a squad inside the marked ground for ${objective.duration}s`,
      'The clock pauses while enemies contest it — wiping them out also wins',
      'Withdrawing abandons the ground to the raiders',
    ];
  }
  if (objective.kind === 'break') {
    return [
      `${OBJECTIVE_LABELS.break}: destroy all ${objective.guards} defensive guards`,
      'Destroying every guard wins even if defenders survive — so does wiping them out',
      'Withdrawing leaves the position intact for another day',
    ];
  }
  return [`${OBJECTIVE_LABELS.elimination}: destroy every raider`];
}

export function drawBriefPanel(ctx, cam, model) {
  const W = cam.w, H = cam.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(21,22,46,0.72)';
  ctx.fillRect(0, 0, W, H);
  // Milestone 025: objective/stronghold lines grow the panel instead of squeezing
  // the roster columns.
  const extraLines =
    (model.objective ? model.objective.length : 0) +
    (model.stronghold ? 1 + model.stronghold.advantages.length : 0);
  const pw = Math.min(720, W - 60), ph = Math.min(420 + extraLines * 18, H - 60);
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  ctx.fillStyle = P.ink;
  rrect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = P.cream; ctx.lineWidth = 2;
  rrect(ctx, px, py, pw, ph, 14); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = P.cream;
  ctx.font = '900 26px Inter, system-ui, sans-serif';
  ctx.fillText(model.title || 'BATTLE', W / 2, py + 40);
  if (model.subtitle) {
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    ctx.fillStyle = P.hero;
    ctx.fillText(model.subtitle, W / 2, py + 64);
  }
  const colY = py + (model.subtitle ? 96 : 84);
  const colW = pw / 2 - 40;
  const leftX = px + pw / 4, rightX = px + pw * 3 / 4;
  ctx.textAlign = 'left';
  ctx.font = '800 15px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.cream;
  ctx.fillText('YOUR WARBAND', leftX - colW / 2, colY);
  ctx.fillText('THE ENEMY', rightX - colW / 2, colY);
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  ctx.fillText(model.player.roster, leftX - colW / 2, colY + 26);
  ctx.fillText(`${model.player.bodies} bodies · fighting weight ${model.player.strength}`, leftX - colW / 2, colY + 46);
  ctx.fillText(model.enemy.roster, rightX - colW / 2, colY + 26);
  ctx.fillText(
    model.enemy.scouted ? `${model.enemy.bodies} bodies · fighting weight ${model.enemy.strength}` : 'composition unknown',
    rightX - colW / 2, colY + 46,
  );
  ctx.textAlign = 'center';
  ctx.font = '800 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = model.odds === ODDS_WORDS.outmatched ? P.enemy : P.cream;
  ctx.fillText(model.odds, W / 2, colY + 86);
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.cream;
  let y = colY + 110;
  ctx.fillText(`Arena: ${model.arena || 'field'}`, W / 2, y);
  y += 24;
  if (model.objective) {
    ctx.fillStyle = P.hero;
    for (let i = 0; i < model.objective.length; i++) {
      ctx.fillText(model.objective[i], W / 2, y + i * 18);
    }
    y += model.objective.length * 18;
  }
  if (model.stronghold) {
    y += 6;
    ctx.font = '800 15px Inter, system-ui, sans-serif';
    ctx.fillStyle = P.enemy;
    ctx.fillText(`STRONGHOLD POWER: ${model.stronghold.label}`, W / 2, y);
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = P.cream;
    y += 20;
    for (const line of model.stronghold.advantages) {
      ctx.fillText(line, W / 2, y);
      y += 18;
    }
  }

  // Real clickable buttons, not just a text footer — updateWorldScreens() hit-tests
  // clicks against the rects returned here (drawn last frame, one frame of lag, the
  // same idiom src/main.js's menuHitRegions already uses).
  const footerY = py + ph - 30, btnH = 30;
  ctx.font = '800 13px Inter, system-ui, sans-serif';
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
  ctx.fillStyle = accent ? P.hero : P.cream;
  rrect(ctx, rect.x, rect.y, rect.w, rect.h, 8); ctx.fill();
  ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
  rrect(ctx, rect.x, rect.y, rect.w, rect.h, 8); ctx.stroke();
  ctx.fillStyle = P.ink;
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
}

// ---------------------------------------------------------------- specialization choice
// Milestone 025 Slice B: the one-time, permanent specialization modal. Pure model
// over (settlement, save); the four options are declared in region.js so the modal,
// the effects and the save validation read one table.
export function buildSpecModel(settlement, save) {
  const existing = save.settlements.find(s => s.id === settlement.id);
  const options = SPEC_IDS.map(id => {
    const def = SPECIALIZATIONS[id];
    return {
      id,
      name: def.name,
      glyph: def.glyph,
      immediate: def.immediate.text,
      ongoing: def.ongoing,
    };
  });
  return {
    kind: 'spec',
    settlement: { id: settlement.id, name: settlement.name },
    alreadyChosen: !!(existing && existing.spec),
    chosenSpec: existing && existing.spec,
    index: 0,
    options,
  };
}

export function drawSpecPanel(ctx, cam, model) {
  const W = cam.w, H = cam.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(21,22,46,0.72)';
  ctx.fillRect(0, 0, W, H);
  const pw = Math.min(640, W - 60), rowH = 64, headH = 108, footH = 56;
  const ph = headH + model.options.length * (rowH + 8) + footH;
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  ctx.fillStyle = P.ink;
  rrect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = P.cream; ctx.lineWidth = 2;
  rrect(ctx, px, py, pw, ph, 14); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = P.cream;
  ctx.font = '900 24px Inter, system-ui, sans-serif';
  ctx.fillText(`${model.settlement.name.toUpperCase()} JOINS YOUR BANNER`, W / 2, py + 36);
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.hero;
  ctx.fillText('Choose what it becomes — permanent for this campaign', W / 2, py + 62);
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  ctx.fillText('↑↓ choose · ENTER commit · X decide later', W / 2, py + 86);

  const rects = [];
  model.options.forEach((opt, i) => {
    const y = py + headH + i * (rowH + 8);
    const selected = i === model.index;
    ctx.fillStyle = selected ? P.cream : '#26304F';
    rrect(ctx, px + 24, y, pw - 48, rowH, 10); ctx.fill();
    ctx.strokeStyle = selected ? P.hero : '#3A4A72'; ctx.lineWidth = selected ? 3 : 1.5;
    rrect(ctx, px + 24, y, pw - 48, rowH, 10); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = selected ? P.ink : P.cream;
    ctx.font = '800 16px Inter, system-ui, sans-serif';
    ctx.fillText(`${opt.glyph}  ${opt.name}`, px + 44, y + 26);
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = selected ? '#3A4A72' : '#B9C2DC';
    ctx.fillText(`${opt.immediate}  ·  later visits: ${opt.ongoing}`, px + 44, y + 48);
    rects.push({ x: px + 24, y, w: pw - 48, h: rowH });
  });

  const footerY = py + ph - footH / 2;
  ctx.textAlign = 'center';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  ctx.fillText('A captured settlement pays its benefit only while it flies your banner', W / 2, footerY);
  ctx.textBaseline = 'alphabetic';
  // updateWorldScreens() hit-tests clicks against these; `index` mirrors the hovered row.
  const first = rects[0];
  return { spec: { ...first, h: rects[rects.length - 1].y + rects[rects.length - 1].h - first.y, rows: rects } };
}

// ---------------------------------------------------------------- campaign summary
// Milestone 025 Slice E: the regional-conquest summary behind the stronghold
// victory. Pure over the final save — the same campaign always summarizes the
// same way.
export function buildSummaryModel(save) {
  const stats = save.stats || {};
  const settlements = save.settlements || [];
  const captured = settlements.filter(s => s.owner === OWNERSHIP_PLAYER).length;
  const held = settlements.filter(s => s.owner === OWNERSHIP_PLAYER && !s.occupied).length;
  const specs = settlements
    .filter(s => s.spec)
    .map(s => `${settlementName(s.id)}: ${SPECIALIZATIONS[s.spec].name}`);
  const armyCounts = countByType(save.troops || [], Object.keys(UNIT_TYPES));
  const army = Object.keys(UNIT_TYPES).filter(t => armyCounts[t] > 0)
    .map(t => `${armyCounts[t]} ${SQUAD_LABELS[t].toLowerCase()}`);
  const razed = (save.camps || []).filter(c => c.razed && c.id !== 'strong').length;
  return {
    kind: 'summary',
    hard: !!save.hard,
    time: stats.playT || 0,
    battlesWon: stats.won || 0,
    battlesLost: stats.battlesLost || 0,
    captured,
    held,
    totalSettlements: settlements.length,
    campsRazed: razed,
    soldiersLost: stats.lost || 0,
    foesSlain: stats.kills || 0,
    goldEarned: stats.goldEarned || 0,
    goldSpent: stats.goldSpent || 0,
    finalGold: save.gold || 0,
    army: army.length ? army.join(', ') : 'no standing host',
    specs,
  };
}

const OWNERSHIP_PLAYER = 'player';

function settlementName(id) {
  const s = WORLD.settlements.find(cand => cand.id === id);
  return s ? s.name : id;
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
  ctx.fillStyle = P.ink;
  rrect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = P.cream; ctx.lineWidth = 2;
  rrect(ctx, px, py, pw, ph, 14); ctx.stroke();
  ctx.textAlign = 'center';
  const headline = model.victory ? 'VICTORY' : model.retreated ? 'WITHDRAWN' : 'DEFEAT';
  ctx.fillStyle = model.victory ? P.good : model.retreated ? P.cream : P.enemy;
  ctx.font = '900 30px Inter, system-ui, sans-serif';
  ctx.fillText(headline, W / 2, py + 44);

  ctx.textAlign = 'left';
  ctx.font = '800 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.cream;
  const colW = pw / 2 - 40;
  const leftX = px + 40, rightX = px + pw / 2 + 20;
  let y = py + 84;
  ctx.fillText('YOUR LOSSES', leftX, y);
  ctx.fillText('ENEMY LOSSES', rightX, y);
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  const lossLines = (losses) => losses.length ? losses.map(l => `${l.count} ${l.label}`) : ['none'];
  const playerLossLines = lossLines(model.playerLosses || []);
  const enemyLossLines = lossLines(model.enemyLosses || []);
  const rows = Math.max(playerLossLines.length, enemyLossLines.length);
  for (let i = 0; i < rows; i++) {
    if (playerLossLines[i]) ctx.fillText(playerLossLines[i], leftX, y + 22 + i * 18);
    if (enemyLossLines[i]) ctx.fillText(enemyLossLines[i], rightX, y + 22 + i * 18);
  }
  y += 22 + rows * 18 + 20;
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.hero;
  ctx.fillText(`Loot: +${model.loot || 0} gold`, leftX, y);
  ctx.fillText(`Hero HP: ${model.heroHp}/${model.heroMaxHp}`, rightX, y);
  y += 30;
  if (model.consequence) {
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = P.cream;
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
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  const btnW = ctx.measureText(continueLabel).width + 28, btnH = 30, footerY = py + ph - 24;
  const confirmRect = { x: W / 2 - btnW / 2, y: footerY - btnH / 2, w: btnW, h: btnH };
  drawButton(ctx, confirmRect, continueLabel, true);
  ctx.textBaseline = 'alphabetic';
  return { confirm: confirmRect, withdraw: null };
}
