// Plan 021 — pure functions and plain-data models for map legibility and the
// battle brief/aftermath screens. No phase ownership, no simulation state: the
// same shape as engine.js's rrect/tree/mountain helpers, which already live
// outside the scenes. World.js owns `this.hoverTarget`/`this.screen`/`this.pending`
// and calls into these helpers from draw()/updateWorldScreens().
import {
  PAL, WORLD, UNIT_TYPES, ENEMY_TYPES, enemyStrength, playerStrength, oddsWord, ODDS_WORDS,
  weightText, armySlots, rankOf, rankName,
} from './data.js?v=rdc06e391aa49';
import { PERKS, availablePerks, perkPointsEarned, bannerLabel, perkMods } from './progression.js?v=rdc06e391aa49';
import { clamp, rrect } from './engine.js?v=rdc06e391aa49';
import { SQUAD_LABELS } from './battle/constants.js?v=rdc06e391aa49';
import {
  SPECIALIZATIONS, SPEC_IDS, OBJECTIVE_LABELS, STRONGHOLD_POWER_LABELS,
} from './region.js?v=rdc06e391aa49';
import { pointInWorldHud, heroPresentationPosition } from './world/visual-style.js?v=rdc06e391aa49';

// Same palette the world scene draws with — these panels sit on top of it.
const P = PAL.world;

// ---------------------------------------------------------------- modal primitives
// Plan 031. Five panels drew the same scrim, the same frame and the same selectable row by
// hand; drawSpecPanel and drawPerkPanel were 79% byte-identical. These four functions are
// that shared shape, and they are deliberately pixel-exact with what they replaced — the
// row's two text baselines round to the same y at every rowH the panels actually use, so
// the brief, aftermath and site baselines did not move when this landed.

// One flat wash over the whole canvas. The aftermath asks for a heavier one.
function drawModalScrim(ctx, W, H, alpha = 0.72) {
  ctx.fillStyle = `rgba(21,22,46,${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

// The panel body. The shadow is offset along the game's single light direction (down-right,
// the same one WORLD_ART.shadow.direction declares) rather than drawn with ctx.shadowBlur,
// which costs no beginPath but is genuinely expensive over a rect this size.
function drawModalFrame(ctx, px, py, pw, ph) {
  ctx.fillStyle = 'rgba(12,14,30,0.34)';
  rrect(ctx, px + 5, py + 7, pw, ph, 14); ctx.fill();
  ctx.fillStyle = P.ink;
  rrect(ctx, px, py, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = P.cream; ctx.lineWidth = 2;
  rrect(ctx, px, py, pw, ph, 14); ctx.stroke();
}

// A hairline under the header band with a diamond at each end — the same separator the main
// menu draws around its list, which is the quality bar for canvas UI in this game. Costs no
// beginPath: two fillRects and two rotated squares.
function drawModalRule(ctx, cx, y, halfW) {
  ctx.fillStyle = 'rgba(255,246,227,0.16)';
  ctx.fillRect(cx - halfW, y, halfW * 2, 1);
  ctx.fillStyle = P.hero;
  for (const x of [cx - halfW, cx + halfW]) {
    ctx.save(); ctx.translate(x, y + 0.5); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-2.5, -2.5, 5, 5); ctx.restore();
  }
}

// One selectable row. `alpha` dims a refused one; `labelPx` is the only genuine difference
// between the site panel's rows and the two choice panels'.
function drawModalRow(ctx, r, o) {
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = o.selected ? P.cream : '#26304F';
  rrect(ctx, r.x, r.y, r.w, r.h, 10); ctx.fill();
  ctx.strokeStyle = o.selected ? P.hero : '#3A4A72'; ctx.lineWidth = o.selected ? 3 : 1.5;
  rrect(ctx, r.x, r.y, r.w, r.h, 10); ctx.stroke();
  const labelY = Math.round(r.y + r.h * 0.40), detailY = Math.round(r.y + r.h * 0.75);
  // The marker sits in the gutter the rows already reserved between their left edge and the
  // label, so adding it moved no existing glyph.
  ctx.textAlign = 'left';
  ctx.fillStyle = o.selected ? P.enemy : '#5A688F';
  ctx.font = '800 12px Inter, system-ui, sans-serif';
  ctx.fillText(o.selected ? '\u25B8' : '\u00B7', r.x + 8, labelY);
  ctx.fillStyle = o.selected ? P.ink : P.cream;
  ctx.font = `800 ${o.labelPx || 16}px Inter, system-ui, sans-serif`;
  ctx.fillText(o.label, r.x + 20, labelY);
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = o.selected ? '#3A4A72' : '#B9C2DC';
  ctx.fillText(fitText(ctx, o.detail, r.w - 32), r.x + 20, detailY);
  ctx.globalAlpha = 1;
}

// The merged block updateWorldScreens() hit-tests against: the bbox of every row, plus the
// rows themselves so a click can name one. Guards the empty case, which drawSpecPanel and
// drawPerkPanel both used to index past.
function rowBlock(rects, key) {
  if (!rects.length) return { [key]: null };
  const first = rects[0], last = rects[rects.length - 1];
  return { [key]: { x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y, rows: rects } };
}

// While a permanent choice is still arming, say so instead of printing a commit key that
// does nothing — a dead press with no explanation is worse than a short wait.
function armHint(model, hint) {
  return model.armT > 0 ? '↑↓ choose · read it first…' : hint;
}

// Truncate to fit rather than run past the panel border. The perk and brief panels both draw
// copy that lives in progression.js and region.js — files edited for gameplay reasons by
// people who are not looking at pixel budgets — so the panels defend themselves.
function fitText(ctx, text, maxW) {
  if (!text || ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '\u2026').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + '\u2026';
}

// Plan 031: how long a permanent-choice modal refuses to be committed after it opens.
//
// The specialization and the perk screens are the only two modals that appear UNBIDDEN —
// they arrive on the tick the aftermath closes, which is the tick the player was already
// pressing CONFIRM to clear that aftermath. A player clearing a victory screen at a normal
// mashing rate lands the next press ~125ms later, on a permanent choice they have not read,
// and takes option 0 for the rest of the campaign. Navigation is allowed immediately (moving
// the selection is proof of reading); only the commit waits.
//
// The victory summary already guards itself the same way (main.js `victoryT > 1.5`).
export const CHOICE_ARM_T = 0.4;
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

// Plan 029: one line summarising the warband's veterancy, by highest rank present. Named
// ranks rather than a count of chevrons, because the name is what the perk screen, the
// banner prompt and the summary all use — one vocabulary for the whole feature.
// `earlier` is the Drillyard shift: the battle grants rank with it applied, so a panel
// reading rank without it would tell a Drillyard campaign it has no veterans while the
// battlefield draws their chevrons.
export function veteranLine(troops, earlier = 0) {
  const counts = new Map();
  for (const t of troops || []) {
    const r = rankOf(t.vet, earlier);
    if (r > 0) counts.set(r, (counts.get(r) || 0) + 1);
  }
  if (counts.size === 0) return 'no veterans yet — men earn rank by winning and surviving';
  const parts = [...counts.keys()].sort((a, b) => b - a)
    .map(r => `${counts.get(r)} ${rankName(r)}${counts.get(r) === 1 ? '' : 's'}`);
  return parts.join(', ');
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
    const earlier = perkMods(world.save.perks).rankEarlier;
    const strength = playerStrength(troops, earlier);
    return {
      kind: 'hero', x: heroMarker.x, y: heroMarker.y,
      title: 'Your warband', bodies: troops.length + 1, strength,
      lines: [
        troops.length ? troopBreakdown(troops) : 'no troops — just you',
        // Plan 028: the hero is not worth three spearmen on the map's books. He is 120
        // hit points that the odds already assume you will not swing — the sword is your
        // margin over them, so it is not counted here.
        `fighting weight ${weightText(strength)} · your sword is not in it`,
        // Plan 029: veterancy IS counted in that weight (playerStrength reads `vet`), so
        // the panel says how much of it is men who have been here before.
        veteranLine(troops, earlier),
      ],
    };
  }
  if (best.kind === 'party') {
    const p = best.party;
    const bodies = p.comp.length, heavy = p.comp.includes('brute');
    const strength = enemyStrength(p.comp);
    const mine = playerStrength(world.save.troops, perkMods(world.save.perks).rankEarlier);
    // Same odds-word convention as the close-range pill drawn under the party token
    // (world.js drawParty) — hover repeats it alongside the numbers it omits.
    const odds = oddsWord(strength, mine);
    return {
      kind: 'party', x: p.x, y: p.y,
      title: heavy ? 'Raiding party (heavy)' : 'Raiding party',
      bodies, heavy, strength, mine, odds, mood: p.mood || null,
      lines: [
        `${bodies} riders${heavy ? ' (heavy)' : ''} · fighting weight ${weightText(strength)} · yours ${weightText(mine)}`,
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
  const strength = enemyStrength(campState.garrison);
  const mine = playerStrength(world.save.troops, perkMods(world.save.perks).rankEarlier);
  return {
    kind: 'camp', x: camp.x, y: camp.y, scouted: true, title,
    bodies, heavy, strength, mine,
    lines: [
      `${bodies} defenders${heavy ? ' (heavy)' : ''} · fighting weight ${weightText(strength)} · yours ${weightText(mine)}`,
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
  const earlier = perkMods(save.perks).rankEarlier;
  const playerStr = playerStrength(save.troops, earlier);
  // Plan 031: the scrim puts the HUD's heart chip at 28% visibility, and riding into a camp
  // assault at 22/120 is a decision made without the most important number on the board.
  const heroHp = save.heroHp, heroMaxHp = save.heroMaxHp;
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
    // Plan 029: what you are risking. `veterans` names what would be lost, `perks` names
    // what you are bringing that the odds number does NOT include — the same honesty rule
    // Plan 028 applied to the hero's sword.
    player: {
      hp: heroHp, maxHp: heroMaxHp,
      roster: playerRoster, bodies: playerBodies, strength: playerStr,
      veterans: veteranLine(save.troops, earlier),
      perks: (save.perks || []).map(id => PERKS[id]).filter(Boolean).map(p => p.name),
    },
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
  // The vertical placement below is measured from a MIDDLE baseline. It used to arrive here
  // by accident — drawHud() sets textBaseline 'middle' for the resource chip and never reset
  // it, so every world modal silently inherited it and would have shifted the moment the HUD
  // stopped leaking. Declared explicitly instead (Plan 030).
  ctx.textBaseline = 'middle';
  drawModalScrim(ctx, W, H);
  // Milestone 025: objective/stronghold lines grow the panel instead of squeezing
  // the roster columns.
  const extraLines =
    (model.objective ? model.objective.length : 0) +
    (model.stronghold ? 1 + model.stronghold.advantages.length : 0);
  // Plan 029 added two roster lines on the player's column (veterans, perks), so the panel
  // is 40px taller before the objective/stronghold lines are counted.
  const pw = Math.min(720, W - 60), ph = Math.min(320 + extraLines * 18, H - 60);
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  drawModalFrame(ctx, px, py, pw, ph);
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
  ctx.fillText(`${model.player.roster}   ♥ ${model.player.hp}/${model.player.maxHp}`,
    leftX - colW / 2, colY + 26);
  ctx.fillText(`${model.player.bodies} bodies · fighting weight ${weightText(model.player.strength)}`, leftX - colW / 2, colY + 46);
  // Plan 029: the veteran line sits under the weight because it is part OF the weight;
  // the perk line sits under that because it is not, and the brief says so by placing it
  // apart rather than by adding a caveat nobody reads.
  ctx.fillStyle = P.hero;
  ctx.fillText(model.player.veterans, leftX - colW / 2, colY + 64);
  if (model.player.perks.length) {
    ctx.fillText(fitText(ctx, `⚑ ${model.player.perks.join(' · ')}`, colW), leftX - colW / 2, colY + 82);
  }
  ctx.fillStyle = P.cream;
  ctx.fillText(model.enemy.roster, rightX - colW / 2, colY + 26);
  ctx.fillText(
    model.enemy.scouted ? `${model.enemy.bodies} bodies · fighting weight ${weightText(model.enemy.strength)}` : 'composition unknown',
    rightX - colW / 2, colY + 46,
  );
  ctx.textAlign = 'center';
  ctx.font = '800 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = model.odds === ODDS_WORDS.outmatched ? P.enemy : P.cream;
  ctx.fillText(model.odds, W / 2, colY + 112);
  ctx.font = '600 13px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.cream;
  let y = colY + 136;
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
  const confirmLabel = 'E — Confirm', withdrawLabel = 'X — Withdraw';
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
    armT: CHOICE_ARM_T,
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
  ctx.textBaseline = 'middle'; // see drawBriefPanel: declared, not inherited from drawHud
  drawModalScrim(ctx, W, H);
  const pw = Math.min(640, W - 60), gap = 8, headH = 108, footH = 86;
  const n = model.options.length;
  // Clamped like the brief and the site menu: without this a fifth specialization would put
  // the panel's own border off-canvas on a short window.
  const maxPh = H - 32;
  const rowH = Math.max(40, Math.min(64, Math.floor((maxPh - headH - footH) / Math.max(1, n)) - gap));
  const ph = Math.min(headH + n * (rowH + gap) + footH, maxPh);
  const px = W / 2 - pw / 2, py = Math.max(16, H / 2 - ph / 2);
  drawModalFrame(ctx, px, py, pw, ph);
  ctx.textAlign = 'center';
  ctx.fillStyle = P.cream;
  ctx.font = '900 24px Inter, system-ui, sans-serif';
  ctx.fillText(`${model.settlement.name.toUpperCase()} JOINS YOUR BANNER`, W / 2, py + 36);
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.hero;
  ctx.fillText('Choose what it becomes — permanent for this campaign', W / 2, py + 62);
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  ctx.fillText(armHint(model, '\u2191\u2193 choose \u00b7 E commit \u00b7 X decide later'), W / 2, py + 86);
  drawModalRule(ctx, W / 2, py + headH - 14, pw / 2 - 24);

  const rects = [];
  model.options.forEach((opt, i) => {
    const r = { x: px + 24, y: py + headH + i * (rowH + gap), w: pw - 48, h: rowH };
    drawModalRow(ctx, r, {
      selected: i === model.index,
      label: `${opt.glyph}  ${opt.name}`,
      detail: `${opt.immediate}  \u00b7  later visits: ${opt.ongoing}`,
    });
    rects.push(r);
  });

  ctx.textAlign = 'center';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  ctx.fillText('A captured settlement pays its benefit only while it flies your banner',
    W / 2, py + ph - footH + 20);
  const defer = { x: W / 2 - 78, y: py + ph - 44, w: 156, h: 28 };
  drawButton(ctx, defer, 'DECIDE LATER  (X)', false);
  ctx.textBaseline = 'alphabetic';
  return { defer, ...rowBlock(rects, 'spec') };
}

// ---------------------------------------------------------------- perk choice
// Plan 029: the hero's perk choice, deliberately the same shape as the specialization
// modal above — same model fields, same `index`, same row rects — so the panel below can
// share its layout and `updateWorldScreens` can share its navigation. The options come
// from progression.js so the tier gates live in one place.
export function buildPerkModel(save) {
  const options = availablePerks(save).map(p => ({
    id: p.id, name: p.name, glyph: p.glyph, tier: p.tier, text: p.text, note: p.note,
  }));
  const taken = (save.perks || []).map(id => PERKS[id]).filter(Boolean);
  return {
    kind: 'perk',
    armT: CHOICE_ARM_T,
    index: 0,
    options,
    taken: taken.map(p => p.name),
    // Stated on the panel: this is a milestone reward, and the player should be able to
    // see which milestone paid for it without leaving the screen.
    earned: perkPointsEarned(save),
    spent: (save.perks || []).length,
  };
}

export function drawPerkPanel(ctx, cam, model) {
  const W = cam.w, H = cam.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textBaseline = 'middle'; // see drawBriefPanel: declared, not inherited from drawHud
  drawModalScrim(ctx, W, H);
  const pw = Math.min(660, W - 60), gap = 8, headH = 112, footH = 86;
  const n = model.options.length;
  // Five perks are a normal mid-campaign state once two tiers are open, and unclamped that
  // put the panel's header and footer off-canvas on a short window.
  const maxPh = H - 32;
  const rowH = Math.max(40, Math.min(64, Math.floor((maxPh - headH - footH) / Math.max(1, n)) - gap));
  const ph = Math.min(headH + n * (rowH + gap) + footH, maxPh);
  const px = W / 2 - pw / 2, py = Math.max(16, H / 2 - ph / 2);
  drawModalFrame(ctx, px, py, pw, ph);
  ctx.textAlign = 'center';
  ctx.fillStyle = P.cream;
  ctx.font = '900 24px Inter, system-ui, sans-serif';
  ctx.fillText('THE CAMPAIGN HAS TAUGHT YOU SOMETHING', W / 2, py + 36);
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.hero;
  ctx.fillText('Choose one — permanent for this campaign', W / 2, py + 62);
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  // buildPerkModel has always computed `earned` and `spent` and the panel has never drawn
  // either, so a player could not see how many points they had banked.
  const banked = Math.max(0, model.earned - model.spent);
  const held = model.taken.length ? `Already yours: ${model.taken.join(', ')}` : 'Your first';
  ctx.fillText(fitText(ctx, `${held}  \u00b7  ${banked} point${banked === 1 ? '' : 's'} banked`, pw - 60),
    W / 2, py + 84);
  ctx.fillText(armHint(model, '\u2191\u2193 choose \u00b7 E commit \u00b7 X decide later'), W / 2, py + 102);
  drawModalRule(ctx, W / 2, py + headH - 14, pw / 2 - 24);

  const rects = [];
  model.options.forEach((opt, i) => {
    const r = { x: px + 24, y: py + headH + i * (rowH + gap), w: pw - 48, h: rowH };
    drawModalRow(ctx, r, {
      selected: i === model.index,
      label: `${opt.glyph}  ${opt.name}`,
      detail: `${opt.text}  \u00b7  ${opt.note}`,
    });
    rects.push(r);
  });

  ctx.textAlign = 'center';
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  ctx.fillText('Every one of these pays only when you give an order', W / 2, py + ph - footH + 20);
  const defer = { x: W / 2 - 78, y: py + ph - 44, w: 156, h: 28 };
  drawButton(ctx, defer, 'DECIDE LATER  (X)', false);
  ctx.textBaseline = 'alphabetic';
  return { defer, ...rowBlock(rects, 'perk') };
}

// ---------------------------------------------------------------- site menu
// Plan 030: the one modal behind every map interaction. Same chrome as the specialization
// and perk panels above — deliberately, so the campaign has one modal language — with two
// additions the others do not need: the purse in the header (the HUD chip is under the
// scrim) and a notice line in the footer carrying whatever the last committed row said.
//
// The model is built in world/site-menu.js; this function only draws it and returns the
// rects updateWorldScreens() hit-tests against.
export function drawSitePanel(ctx, cam, model) {
  const W = cam.w, H = cam.h;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textBaseline = 'alphabetic'; // this panel's offsets are measured from the text baseline
  ctx.fillStyle = 'rgba(21,22,46,0.72)';
  ctx.fillRect(0, 0, W, H);
  // The panel must fit the canvas, which is window.innerHeight and can be well under 700
  // on a laptop or a half-height window. A town sells seven things, so the rows shrink
  // before the panel overflows and the footer is anchored to the panel's own bottom edge —
  // otherwise the LEAVE button lands off-canvas and a mouse-only player has no way out.
  // drawBriefPanel clamps for the same reason.
  const pw = Math.min(640, W - 60), gap = 6, headH = 122, footH = 78;
  const n = Math.max(1, model.rows.length);
  const maxPh = H - 32;
  const rowH = Math.max(34, Math.min(52, Math.floor((maxPh - headH - footH) / n) - gap));
  const ph = Math.min(headH + n * (rowH + gap) + footH, maxPh);
  const px = W / 2 - pw / 2, py = Math.max(16, H / 2 - ph / 2);
  drawModalFrame(ctx, px, py, pw, ph);

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = P.cream;
  ctx.font = '900 24px Inter, system-ui, sans-serif';
  ctx.fillText(model.title, W / 2, py + 36);
  ctx.font = '700 13px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.hero;
  ctx.fillText(model.subtitle, W / 2, py + 58);
  // The purse, in the same glyph order the HUD chip uses, so the two never read as
  // different numbers for the same thing.
  const purse = model.purse;
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillStyle = P.cream;
  ctx.fillText(`⛃ ${purse.gold}    ⚔ ${purse.slots}/${purse.cap}    ♥ ${purse.hp}/${purse.maxHp}`, W / 2, py + 84);
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9BA3BF';
  ctx.fillText(model.rows.length ? '↑↓ choose · E do it · X leave' : 'X leave', W / 2, py + 104);
  drawModalRule(ctx, W / 2, py + headH - 12, pw / 2 - 24);

  const rects = [];
  model.rows.forEach((row, i) => {
    const r = { x: px + 24, y: py + headH + i * (rowH + gap), w: pw - 48, h: rowH };
    // A refused row still draws, still selects and still commits: the service method owns
    // the refusal and says it in the notice line, which is what keeps `enabled` from ever
    // drifting away from the actual rule.
    drawModalRow(ctx, r, {
      selected: i === model.index,
      alpha: row.enabled ? 1 : 0.55,
      labelPx: 15,
      label: row.label,
      detail: row.enabled ? row.detail : `${row.detail}  ·  ${row.disabledReason}`,
    });
    rects.push(r);
  });

  // Anchored to the panel, not to the row count: the notice and the LEAVE button stay on
  // canvas even when `ph` had to be clamped.
  const footTop = py + ph - footH;
  ctx.textAlign = 'center';
  if (model.notice) {
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = P.hero;
    ctx.fillText(model.notice, W / 2, footTop + 18);
  }
  const leave = { x: W / 2 - 60, y: footTop + 30, w: 120, h: 34 };
  drawButton(ctx, leave, 'LEAVE  (X)', false);
  ctx.textBaseline = 'alphabetic';
  return { leave, ...rowBlock(rects, 'site') };
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
    // Plan 029: what the run BUILT, not just what it spent. The veteran line and the perk
    // list are the two things a campaign now carries that gold never did.
    veterans: veteranLine(save.troops || [], perkMods(save.perks).rankEarlier),
    banner: bannerLabel(save.banner || 0),
    perks: (save.perks || []).map(id => PERKS[id]).filter(Boolean).map(p => p.name),
    slots: armySlots(save.troops || []),
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
    goldLost: payload.goldLost || 0,
    veterans: payload.veterans || null,
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
  ctx.textBaseline = 'middle'; // see drawBriefPanel: declared, not inherited from drawHud
  drawModalScrim(ctx, W, H, 0.78);
  // Sized to what it actually reports. A victory with no losses used to reserve 440px for
  // roughly 200 of content and read as a mostly-empty box.
  const lossRows = Math.max(
    (model.playerLosses || []).length || 1, (model.enemyLosses || []).length || 1);
  const consequenceLines = model.consequence ? Math.ceil(model.consequence.length / 62) : 0;
  const pw = Math.min(680, W - 60);
  const ph = Math.min(196 + lossRows * 18 + (model.veterans ? 22 : 0) + consequenceLines * 18, H - 60);
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  drawModalFrame(ctx, px, py, pw, ph);
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
  // A defeat's real headline is what it took, not the loot it did not earn.
  ctx.fillText(model.goldLost > 0 ? `Lost: −${model.goldLost} gold` : `Loot: +${model.loot || 0} gold`,
    leftX, y);
  ctx.fillText(`Hero HP: ${model.heroHp}/${model.heroMaxHp}`, rightX, y);
  y += 22;
  if (model.veterans) {
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#B9C2DC';
    ctx.fillText(fitText(ctx, model.veterans, pw - 80), leftX, y);
  }
  y += 24;
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
  const continueLabel = 'E — Continue';
  ctx.font = '800 13px Inter, system-ui, sans-serif';
  const btnW = ctx.measureText(continueLabel).width + 28, btnH = 30, footerY = py + ph - 24;
  const confirmRect = { x: W / 2 - btnW / 2, y: footerY - btnH / 2, w: btnW, h: btnH };
  drawButton(ctx, confirmRect, continueLabel, true);
  ctx.textBaseline = 'alphabetic';
  return { confirm: confirmRect, withdraw: null };
}
