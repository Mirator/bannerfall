// The in-battle HUD: squad rows with their stance trade-offs, the deploy countdown, the
// retreat prompt and the end banner. Presentation only, and the largest single drawing
// job in the scene, which is why it gets its own module.
import { HERO, enemyStrength, playerStrength } from '../data.js?v=ra209d001f5a8';
import { clamp, rrect } from '../engine.js?v=ra209d001f5a8';
import { SQUAD_LABELS, STANCE_NOTES } from './constants.js?v=ra209d001f5a8';
import { stanceIcon } from './render-units.js?v=ra209d001f5a8';

export function drawHud(battle, ctx) {
  const P = battle.palette;
  const cam = battle.game.camera, h = battle.hero;
  const W = cam.w, Hh = cam.h;
  ctx.textBaseline = 'middle';

  // top-left: army + kills
  ctx.fillStyle = P.ink;
  rrect(ctx, 14, 14, 232, 34, 8); ctx.fill();
  ctx.fillStyle = P.cream;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Warband ${battle.troops.length}   ·   Slain ${battle.kills}/${battle.totalEnemies}`, 26, 31);

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
  ctx.font = '700 12px system-ui, sans-serif';
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
  ctx.font = '600 11px system-ui, sans-serif';
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
    ctx.font = '800 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    if (battle.retreatT > 0) {
      ctx.fillText(`Retreating — keep holding ${arrow}…`, 24, Hh / 2 - 7);
      ctx.fillStyle = P.hpBack;
      rrect(ctx, 24, Hh / 2 + 6, 160, 8, 4); ctx.fill();
      ctx.fillStyle = P.hero;
      rrect(ctx, 24, Hh / 2 + 6, 160 * Math.min(1, battle.retreatT / 1.3), 8, 4); ctx.fill();
    } else {
      ctx.fillText(`${arrow} hold ${arrow} at the ${battle.retreatDir} edge`, 24, Hh / 2 - 7);
      ctx.font = '600 12px system-ui, sans-serif';
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
    ctx.font = '800 15px system-ui, sans-serif';
    const headlineW = ctx.measureText(headline).width;
    ctx.font = '700 13px system-ui, sans-serif';
    const detailW = ctx.measureText(detail).width;
    const dw = Math.min(W - 40, Math.max(320, Math.max(headlineW, detailW) + 44));
    rrect(ctx, W / 2 - dw / 2, 64, dw, 62, 10); ctx.fill();
    ctx.fillStyle = P.hero;
    ctx.textAlign = 'center';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillText(headline, W / 2, 82);
    ctx.font = '700 13px system-ui, sans-serif';
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
    ctx.font = `900 ${Math.round(46 + (1 - k) * 6)}px system-ui, sans-serif`;
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
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(battle.setup.title || 'SKIRMISH', W / 2, Hh * 0.36 + 34);
    if (battle.setup.subtitle) {
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillStyle = P.hero;
      ctx.fillText(battle.setup.subtitle, W / 2, Hh * 0.36 + 60);
      if (showCount) {
        ctx.fillStyle = P.cream;
        ctx.font = '600 14px system-ui, sans-serif';
        ctx.fillText(`${battle.troops.length + 1} vs ${battle.enemies.length}`, W / 2, Hh * 0.36 + 84);
      }
    } else if (showCount) {
      ctx.font = '600 15px system-ui, sans-serif';
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
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(battle.victory ? 'VICTORY' : battle.retreated ? 'WITHDRAWN' : 'DEFEAT', W / 2, Hh * 0.36 + 38);
    ctx.fillStyle = P.cream;
    ctx.font = '600 15px system-ui, sans-serif';
    const lost = battle.startTroops - battle.troops.length;
    if (battle.victory) {
      ctx.fillText(`+${battle.loot} gold  ·  ${battle.kills} slain  ·  ${lost > 0 ? lost + ' of your men fell' : 'no losses'}`, W / 2, Hh * 0.36 + 68);
    } else if (battle.retreated) {
      ctx.fillText(`You disengage in good order — ${battle.troops.length} men ride out with you`, W / 2, Hh * 0.36 + 68);
    } else {
      ctx.fillText(`Slain by ${battle.killedBy || 'the enemy'} — your warband scatters, poorer and fewer`, W / 2, Hh * 0.36 + 68);
      // diagnose the loss so the player knows what to change next time
      ctx.fillStyle = P.hero;
      ctx.font = '700 14px system-ui, sans-serif';
      // The hero's own survival is what decides an even fight, so say that rather than
      // pointing at HOLD: measured across camp raids, HOLD is not the stronger order, and
      // advice that sends the player to the weaker option teaches the wrong lesson.
      const advice = battle.enemyStrength > battle.playerStrength + 2
        ? `They were stronger (${battle.enemyStrength} vs your ${battle.playerStrength}) — recruit at a village, then return`
        : 'Even odds — you fell, not your warband. Dash out of the scrum before you are surrounded';
      ctx.fillText(advice, W / 2, Hh * 0.36 + 90);
    }
    ctx.globalAlpha = 1;
  }
}
