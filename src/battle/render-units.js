// Battle actor rendering, lifted out of battle.js: one function per thing that stands
// on the field. Presentation only — every function takes the Battle instance, reads it,
// and draws. Nothing here mutates simulation state (see AGENTS.md: presentation may read
// simulation, never the reverse).
import { TAU, rrect, shade } from '../engine.js?v=r3d4da160c3c7';

// Stance glyphs, shared by every squad row: an arrow to follow, crossed swords to
// charge, a heater shield to hold. Drawn at native scale so they read at 1x.
export function stanceIcon(battle, ctx, id, cx, cy, scale = 1.55) {
  const P = battle.palette;
  ctx.save();
  ctx.strokeStyle = P.cream; ctx.fillStyle = P.hero; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  const ix = 0, iy = 0;
  if (id === 'follow') {
    ctx.beginPath(); ctx.moveTo(ix, iy + 5); ctx.lineTo(ix, iy - 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ix, iy - 5); ctx.lineTo(ix + 6, iy - 3); ctx.lineTo(ix, iy - 1); ctx.closePath(); ctx.fill();
  } else if (id === 'charge') {
    // crossed swords: two angled blades with triangular tips, not a bare X
    for (const dir of [1, -1]) {
      ctx.beginPath(); ctx.moveTo(ix - 4 * dir, iy + 4); ctx.lineTo(ix + 3 * dir, iy - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ix + 3 * dir, iy - 3); ctx.lineTo(ix + 5.5 * dir, iy - 5.5);
      ctx.lineTo(ix + 4.5 * dir, iy - 2); ctx.closePath(); ctx.fill();
    }
  } else {
    // heater shield: straight top edge, squared shoulders, point at the base
    ctx.beginPath(); ctx.moveTo(ix - 4.5, iy - 4.5); ctx.lineTo(ix + 4.5, iy - 4.5);
    ctx.lineTo(ix + 4.5, iy - 0.5); ctx.lineTo(ix, iy + 5.5); ctx.lineTo(ix - 4.5, iy - 0.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = P.cream; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ix - 4.5, iy - 4.5); ctx.lineTo(ix + 4.5, iy - 4.5); ctx.stroke();
  }
  ctx.restore();
}

// chunky little figure
export function figure(battle, ctx, x, y, facing, bob, body, dark, opts = {}) {
  const P = battle.palette;
  const bobY = Math.sin(bob) * 1.6;
  const r = opts.r || 7;
  const lx = Math.cos(facing), ly = Math.sin(facing);
  y += bobY;
  // VOLUME body: two SOLID tones split down the axis — lit face left, shade face right,
  // hard boundary. Computed colors, never alpha overlays (those vanish at rater resolution).
  const shadeC = body.startsWith('#') ? shade(body, 0.72) : body;
  ctx.fillStyle = body;
  rrect(ctx, x - r * 0.85, y - r * 2.1, r * 1.7, r * 2.1, r * 0.7); ctx.fill();
  ctx.save();
  rrect(ctx, x - r * 0.85, y - r * 2.1, r * 1.7, r * 2.1, r * 0.7); ctx.clip();
  ctx.fillStyle = shadeC;
  ctx.fillRect(x + r * 0.12, y - r * 2.1, r * 0.75, r * 2.1);
  ctx.restore();
  ctx.strokeStyle = dark; ctx.lineWidth = 1.6;
  rrect(ctx, x - r * 0.85, y - r * 2.1, r * 1.7, r * 2.1, r * 0.7); ctx.stroke();
  // head
  ctx.fillStyle = opts.head || dark;
  ctx.beginPath(); ctx.arc(x, y - r * 2.35, r * 0.62, 0, TAU); ctx.fill();
  // headgear — per-type silhouette ON the body, so type reads without any badge:
  // 'helm' = brimmed dome (spear/knight), 'hood' = peaked cowl (archers/raiders), 'cap' = band knot (bandits)
  // sized to read at play zoom without cropping in — the hat IS the type signal, not a garnish
  const hy = y - r * 2.35;
  if (opts.hat === 'helm') {
    ctx.fillStyle = opts.metal || P.metal || '#E8E4DA';
    ctx.beginPath(); ctx.arc(x, hy - r * 0.05, r * 0.95, Math.PI, 0); ctx.fill();
    ctx.fillRect(x - r * 1.15, hy - r * 0.14, r * 2.3, r * 0.3);
    ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, hy - r * 0.05, r * 0.95, Math.PI, 0); ctx.stroke();
  } else if (opts.hat === 'hood') {
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(x - r * 0.95, hy + r * 0.25); ctx.lineTo(x, hy - r * 1.5); ctx.lineTo(x + r * 0.95, hy + r * 0.25); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - r * 0.95, hy + r * 0.25); ctx.lineTo(x, hy - r * 1.5); ctx.lineTo(x + r * 0.95, hy + r * 0.25); ctx.stroke();
  } else if (opts.hat === 'cap') {
    // dark maroon band: a cream strip at head height reads as a full-health HP bar
    ctx.fillStyle = '#5A1812';
    ctx.fillRect(x - r * 0.95, hy - r * 0.62, r * 1.9, r * 0.5);
    ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
    ctx.strokeRect(x - r * 0.95, hy - r * 0.62, r * 1.9, r * 0.5);
  }
  // off-hand shield first (under the weapon arm) — silhouette breaks the capsule on the off side
  if (opts.shield) {
    // chest-boss shield drawn FULLY INSIDE the torso outline: any disc that pokes past the
    // body edge leaves a crescent sliver that reads as a floating letterform at range
    const sx = x - lx * r * 0.30, sy = y - r * 1.15 - ly * r * 0.12;
    ctx.fillStyle = opts.shield;
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.42, 0, TAU); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.42, 0, TAU); ctx.stroke();
  }
  // weapon — scaled with body size and drawn heavy, so unit type reads at battle zoom,
  // not just up close. Stroked in bright metal, not ink: dark strokes vanish on dark biomes.
  const k = r / 9;
  // ink under-stroke beneath the metal: a weapon is an outlined OBJECT in the scene,
  // never a bare white glyph that could be mistaken for floating UI
  const metalC = opts.metal || P.metal || '#E8E4DA';
  ctx.strokeStyle = P.ink; ctx.lineWidth = 4.2 * k; ctx.lineCap = 'round';
  if (opts.weapon === 'spear' || opts.weapon === 'sword') {
    const ex2 = x + lx * r * 1.1 + lx * (opts.weapon === 'spear' ? 18 : 15) * k;
    const ey2 = y - r * 1.1 + ly * r * 0.7 + ly * (opts.weapon === 'spear' ? 18 : 15) * k;
    ctx.beginPath();
    ctx.moveTo(x + lx * r * 1.1 - lx * (opts.weapon === 'spear' ? 8 : 0) * k, y - r * 1.1 + ly * r * 0.7 - ly * (opts.weapon === 'spear' ? 8 : 0) * k);
    ctx.lineTo(ex2, ey2); ctx.stroke();
  }
  ctx.strokeStyle = metalC; ctx.lineWidth = 2.6 * k; ctx.lineCap = 'round';
  const wx = x + lx * r * 1.1, wy = y - r * 1.1 + ly * r * 0.7;
  if (opts.weapon === 'spear') {
    const hx2 = wx + lx * 18 * k, hy2 = wy + ly * 18 * k;
    ctx.beginPath(); ctx.moveTo(wx - lx * 8 * k, wy - ly * 8 * k); ctx.lineTo(hx2, hy2); ctx.stroke();
    ctx.fillStyle = opts.tip || '#F2E3C1';
    ctx.beginPath(); ctx.moveTo(hx2 + lx * 7 * k, hy2 + ly * 7 * k);
    ctx.lineTo(hx2 - ly * 3.4 * k, hy2 + lx * 3.4 * k);
    ctx.lineTo(hx2 + ly * 3.4 * k, hy2 - lx * 3.4 * k); ctx.closePath(); ctx.fill();
    // ink outline on the tip: every weapon shape is an outlined object, no exceptions
    ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6 * k; ctx.stroke();
    ctx.strokeStyle = metalC; ctx.lineWidth = 2.6 * k;
  } else if (opts.weapon === 'bow') {
    // the bow hugs the torso edge (overlapping the body) — a pale arc floating at arm's
    // length IS a detached white crescent, the last surviving source of the "D" read
    const bx2 = x + lx * r * 0.62, by2 = y - r * 1.15 + ly * r * 0.35;
    ctx.strokeStyle = P.ink; ctx.lineWidth = 5.6 * k; // outlined object, not floating UI
    ctx.beginPath(); ctx.arc(bx2, by2, 7.4 * k, facing - 1.1, facing + 1.1); ctx.stroke();
    ctx.strokeStyle = metalC; ctx.lineWidth = 4.0 * k; // readable as a BOW in a full unzoomed frame
    ctx.beginPath(); ctx.arc(bx2, by2, 7.4 * k, facing - 1.1, facing + 1.1); ctx.stroke();
    ctx.lineWidth = 1.8 * k;
    ctx.beginPath();
    ctx.moveTo(bx2 + Math.cos(facing - 1.05) * 6.2 * k, by2 + Math.sin(facing - 1.05) * 6.2 * k);
    ctx.lineTo(bx2 + Math.cos(facing + 1.05) * 6.2 * k, by2 + Math.sin(facing + 1.05) * 6.2 * k);
    ctx.stroke();
  } else if (opts.weapon === 'sword') {
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + lx * 15 * k, wy + ly * 15 * k); ctx.stroke();
    // crossguard gets the same ink-under/metal-over as the blade — no bare "+" glyphs
    ctx.strokeStyle = P.ink; ctx.lineWidth = 4.2 * k;
    ctx.beginPath();
    ctx.moveTo(wx + lx * 4 * k - ly * 3.6 * k, wy + ly * 4 * k + lx * 3.6 * k);
    ctx.lineTo(wx + lx * 4 * k + ly * 3.6 * k, wy + ly * 4 * k - lx * 3.6 * k);
    ctx.stroke();
    ctx.strokeStyle = metalC; ctx.lineWidth = 2.6 * k;
    ctx.beginPath();
    ctx.moveTo(wx + lx * 4 * k - ly * 3.6 * k, wy + ly * 4 * k + lx * 3.6 * k);
    ctx.lineTo(wx + lx * 4 * k + ly * 3.6 * k, wy + ly * 4 * k - lx * 3.6 * k);
    ctx.stroke();
  } else if (opts.weapon === 'club') {
    ctx.lineWidth = 4.2 * k;
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + lx * 15 * k, wy + ly * 15 * k); ctx.stroke();
    if (opts.hammer) {
      // rectangular maul head with a cream separating stroke so it never merges into shadow
      ctx.save();
      ctx.translate(wx + lx * 15 * k, wy + ly * 15 * k);
      ctx.rotate(facing);
      ctx.fillStyle = '#33150F';
      ctx.fillRect(-2.5 * k, -6 * k, 8 * k, 12 * k);
      ctx.strokeStyle = '#EFE6CE'; ctx.lineWidth = 1.4;
      ctx.strokeRect(-2.5 * k, -6 * k, 8 * k, 12 * k);
      ctx.restore();
    } else {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath(); ctx.arc(wx + lx * 15 * k, wy + ly * 15 * k, 3.6 * k, 0, TAU); ctx.fill();
    }
  }
  if (opts.scarf) {
    ctx.fillStyle = opts.scarf;
    ctx.fillRect(x - r * 0.85, y - r * 1.75, r * 1.7, r * 0.55);
  }
}

export function horse(battle, ctx, x, y, facing, bob, body, dark, mane) {
  const P = battle.palette;
  const bobY = Math.sin(bob) * 2;
  const lx = Math.cos(facing);
  const dir = lx >= 0 ? 1 : -1;
  y += bobY;
  ctx.fillStyle = body;
  rrect(ctx, x - 16, y - 18, 32, 13, 6); ctx.fill();          // torso
  ctx.strokeStyle = dark; ctx.lineWidth = 1.6;
  rrect(ctx, x - 16, y - 18, 32, 13, 6); ctx.stroke();
  ctx.fillStyle = body;
  ctx.fillRect(Math.min(x + dir * 10, x + dir * 19), y - 27, 9, 14); // neck
  ctx.fillStyle = dark;
  ctx.fillRect(Math.min(x + dir * 14, x + dir * 24), y - 32, 12, 8); // head
  // muzzle drop + ear: the wedge silhouette that makes it read as an animal, not a peg-box
  ctx.beginPath();
  ctx.moveTo(x + dir * 26, y - 26); ctx.lineTo(x + dir * 30, y - 23); ctx.lineTo(x + dir * 22, y - 24);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + dir * 16, y - 32); ctx.lineTo(x + dir * 18, y - 38); ctx.lineTo(x + dir * 21, y - 32);
  ctx.closePath(); ctx.fill();
  // legs
  ctx.strokeStyle = dark; ctx.lineWidth = 3;
  for (const off of [-10, -3, 5, 12]) {
    const lift = Math.sin(bob * 2 + off) * 2.5;
    ctx.beginPath(); ctx.moveTo(x + off, y - 6); ctx.lineTo(x + off, y + 4 - Math.max(0, lift)); ctx.stroke();
  }
  // mane
  ctx.fillStyle = mane;
  ctx.fillRect(x + dir * 8 - 2, y - 29, 4, 10);
}

export function drawTroop(battle, ctx, t) {
  const P = battle.palette;
  const lungeX = t.lunge > 0 ? Math.cos(t.facing) * t.lunge * 6 : 0;
  const lungeY = t.lunge > 0 ? Math.sin(t.facing) * t.lunge * 6 : 0;
  const body = t.flash > 0 ? '#FFFFFF' : P.friend;
  if (t.d.mounted) {
    horse(battle, ctx, t.x + lungeX, t.y + lungeY, t.facing, t.bob, body, P.ink, P.friendDark);
    figure(battle, ctx, t.x + lungeX, t.y - 14 + lungeY, t.facing, 0, body, P.ink, { r: 7, weapon: 'sword', head: P.friendDark });
  } else {
    figure(battle, ctx, t.x + lungeX, t.y + lungeY, t.facing, t.bob, body, P.ink,
      { r: 9, weapon: t.d.ranged ? 'bow' : 'spear', head: P.friendDark,
        shield: t.d.ranged ? null : P.cream, hat: t.d.ranged ? 'hood' : 'helm' });
  }
  // squad leader carries a pale pennant — the warband reads as a banner-led mass
  if (t.leader) {
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(t.x + 8, t.y - 18); ctx.lineTo(t.x + 8, t.y - 42); ctx.stroke();
    ctx.fillStyle = P.friend;
    ctx.beginPath(); ctx.moveTo(t.x + 8, t.y - 42); ctx.lineTo(t.x + 21, t.y - 37); ctx.lineTo(t.x + 8, t.y - 32); ctx.closePath(); ctx.fill();
  }
}

export function drawEnemy(battle, ctx, e) {
  const P = battle.palette;
  const lungeX = e.lunge > 0 ? Math.cos(e.facing) * e.lunge * 7 : 0;
  const lungeY = e.lunge > 0 ? Math.sin(e.facing) * e.lunge * 7 : 0;
  // brutes read as a distinct big threat at a glance: size + a HUE break (umber-brown, like
  // WatG's tan mammoth against white sheep), not merely a darker red lost among crimson ranks
  let body = e.flash > 0 ? '#FFFFFF' : (e.type === 'brute' ? '#6E4226' : P.enemy);
  // windup telegraph: blink toward hot red — NEVER toward white/cream, which would put
  // the enemy in the defenders' pale luminance band mid-clash (friend/foe read must hold)
  if (e.windupT > 0 && Math.sin(battle.time * 30) > 0) body = '#E85A4A';
  if (e.type === 'brute') {
    // slam telegraph: stroke-only rings (no alpha wash — a fill desaturates the melee
    // exactly where legibility matters, and soft washes violate the flat-shading rule)
    // one ring per anchor: just the shrinking strike ring (its closing motion IS the telegraph)
    // desaturated gold, not red — red belongs to enemy hoods alone
    if (e.windupT > 0) {
      const rr2 = e.d.slamR * (1 - e.windupT / e.d.windup);
      // opaque gold with a thin ink under-stroke: the gold must not anti-alias into the biome
      ctx.strokeStyle = P.ink; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(e.x, e.y, rr2, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#D9B36A'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, rr2, 0, TAU); ctx.stroke();
    }
    // dusty-rose chest band, not bone-white: white/cream belongs to the defender side only
    // legs FIRST (under the body): the brute must read as a creature, not a barrel prop
    ctx.strokeStyle = P.ink; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(e.x + lungeX - 8, e.y + lungeY - 4); ctx.lineTo(e.x + lungeX - 10, e.y + lungeY + 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x + lungeX + 8, e.y + lungeY - 4); ctx.lineTo(e.x + lungeX + 10, e.y + lungeY + 8); ctx.stroke();
    figure(battle, ctx, e.x + lungeX, e.y + lungeY, e.facing, e.bob, body, P.ink,
      { r: 20, weapon: 'club', scarf: '#B5766B', hammer: true, head: '#4A2418',
        metal: '#EFE6CE' }); // cream haft: the weapon contrasts the body instead of matching it
    // near-black armor plate band: the big threat gets its own third tone, like WatG's mammoth
    ctx.fillStyle = '#33150F';
    ctx.fillRect(e.x + lungeX - 17, e.y + lungeY - 32, 34, 9);
  } else if (e.type === 'wolf') {
    const x = e.x + lungeX, y = e.y + lungeY + Math.sin(e.bob) * 1.4;
    const lx = Math.cos(e.facing), ly = Math.sin(e.facing);
    const crouch = e.windupT > 0 ? 0.55 : 1; // the pounce-crouch IS the wolf's distinct tell
    ctx.fillStyle = body;
    ctx.save();
    ctx.translate(x, y - 8 + (e.windupT > 0 ? 3 : 0));
    ctx.rotate(Math.atan2(ly * 0.5, lx));
    ctx.beginPath(); ctx.ellipse(0, 0, 14 + (e.windupT > 0 ? 2 : 0), 7 * crouch, 0, 0, TAU); ctx.fill();   // body
    ctx.beginPath(); ctx.arc(13, -3 * crouch, 5.5, 0, TAU); ctx.fill();          // head
    ctx.fillStyle = P.ink;
    ctx.beginPath(); ctx.moveTo(15, -8 * crouch); ctx.lineTo(18, -12 * crouch); ctx.lineTo(19, -7 * crouch); ctx.closePath(); ctx.fill(); // ear
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-13, -2); ctx.lineTo(-20, -7 * crouch); ctx.stroke(); // tail
    ctx.restore();
  } else {
    figure(battle, ctx, e.x + lungeX, e.y + lungeY, e.facing, e.bob, body, P.ink,
      { r: 9, weapon: e.d.ranged ? 'bow' : 'sword', scarf: P.enemyAccent,
        shield: e.d.ranged ? null : P.enemyDark, tip: P.enemyAccent,
        hat: e.d.ranged ? 'hood' : 'cap' });
  }
  // "!" attack telegraph — wolves get a red DOUBLE mark: their tell is faster, says so
  if (e.windupT > 0) {
    // cluster-cull: one alert per ~70px — three stacked "!" marks read as noise, not signal
    for (let i = 0; i < battle._alertCount; i++) {
      const alert = battle._alerts[i];
      if ((alert.x - e.x) ** 2 + (alert.y - e.y) ** 2 < 70 * 70) return;
    }
    const alert = battle._alerts[battle._alertCount] || (battle._alerts[battle._alertCount] = { x: 0, y: 0 });
    alert.x = e.x; alert.y = e.y;
    battle._alertCount++;
    const wolf = e.type === 'wolf';
    const yy = e.y - (e.type === 'brute' ? 64 : wolf ? 34 : 46);
    // enemyDark, not ink-black: the alert stays inside the enemy color language
    ctx.fillStyle = P.enemyDark;
    ctx.beginPath(); ctx.arc(e.x, yy, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 14px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(wolf ? '!!' : '!', e.x, yy + 0.5);
  }
}

export function drawHero(battle, ctx) {
  const P = battle.palette;
  const h = battle.hero;
  const body = h.hurtT > 0 ? '#FFFFFF' : P.hero;
  // dust ring while dashing
  if (h.dashT > 0) {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = P.cream; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(h.x, h.y, 20, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  horse(battle, ctx, h.x, h.y, h.facing, h.bob, body, P.ink, P.heroDark);
  figure(battle, ctx, h.x, h.y - 15, h.facing, 0, body, P.ink, { r: 6.5, weapon: 'sword', head: P.heroDark });
  // banner
  ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(h.x - 8, h.y - 20); ctx.lineTo(h.x - 8, h.y - 52); ctx.stroke();
  ctx.fillStyle = P.enemy;
  ctx.beginPath(); ctx.moveTo(h.x - 8, h.y - 52); ctx.lineTo(h.x + 10, h.y - 46); ctx.lineTo(h.x - 8, h.y - 40); ctx.closePath(); ctx.fill();
}
