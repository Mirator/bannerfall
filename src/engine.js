// Shared engine: math, RNG, input, camera, particles, audio, flat-shaded drawing helpers.
import { ACTIONS, DEFAULT_BINDINGS } from './input-actions.js?v=rada68ae0c75b';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export const len = (x, y) => Math.hypot(x, y);
export const angLerp = (a, b, t) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};

// Distance from point P to segment AB (used for river collision + road bonuses)
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Deterministic RNG (mulberry32). Domain seeds keep simulation, presentation,
// and camera effects from consuming one another's sequence.
export const RNG_DOMAINS = Object.freeze({
  WORLD_SIM: 0x13579BDF,
  WORLD_FX: 0x2468ACE0,
  WORLD_GARRISON: 0x0F1E2D3C,
  BATTLE_SIM: 0x31415926,
  BATTLE_FX: 0x27182818,
  CAMERA_SHAKE: 0x9E3779B9,
  AUDIO_FX: 0xDEADBEEF,
});

export function deriveSeed(seed, domain) {
  let x = ((seed >>> 0) ^ (domain >>> 0) ^ 0xA511E9B3) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- Input
export class Input {
  constructor(canvas, platform = null) {
    this.keys = new Set();
    this.pressed = new Set();     // cleared each frame — edge triggers
    this.actionKeys = new Set();
    this.actionPressed = new Set();
    this.mouse = { x: canvas.width / 2, y: canvas.height / 2, down: false, clicked: false, moved: false };
    this.canvas = canvas;
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    // a keyup can be lost entirely if focus left the page while the key was held
    // (alt-tab, a browser shortcut) — without this, movement/attack keys stick forever
    this.unsubscribeDeactivate = platform?.lifecycle?.onDeactivate?.(() => this.clear()) ?? null;
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      this.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
      this.mouse.moved = true;
    });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) { this.mouse.down = true; this.mouse.clicked = true; } });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
  clear() { this.keys.clear(); this.pressed.clear(); this.actionKeys.clear(); this.actionPressed.clear(); }
  endFrame() { this.pressed.clear(); this.actionPressed.clear(); this.mouse.clicked = false; this.mouse.moved = false; }
  // test API injection
  injectKey(code, down) {
    if (down) { if (!this.keys.has(code)) this.pressed.add(code); this.keys.add(code); }
    else this.keys.delete(code);
  }
  injectAction(action, down = true) {
    if (down) {
      if (!this.actionKeys.has(action)) this.actionPressed.add(action);
      this.actionKeys.add(action);
    } else this.actionKeys.delete(action);
  }
  down(action) {
    const codes = DEFAULT_BINDINGS[action] ?? [];
    return this.actionKeys.has(action) || codes.some(code => this.keys.has(code));
  }
  pressedAction(action) {
    const codes = DEFAULT_BINDINGS[action] ?? [];
    return this.actionPressed.has(action) || codes.some(code => this.pressed.has(code));
  }
  injectMouse(x, y, down) {
    if (x != null) { this.mouse.moved = this.mouse.moved || this.mouse.x !== x || this.mouse.y !== y; this.mouse.x = x; this.mouse.y = y; }
    if (down != null) { if (down && !this.mouse.down) this.mouse.clicked = true; this.mouse.down = down; }
  }
  axis() {
    let x = 0, y = 0;
    if (this.down(ACTIONS.MOVE_LEFT)) x -= 1;
    if (this.down(ACTIONS.MOVE_RIGHT)) x += 1;
    if (this.down(ACTIONS.MOVE_UP)) y -= 1;
    if (this.down(ACTIONS.MOVE_DOWN)) y += 1;
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l, any: x !== 0 || y !== 0 };
  }
}

// ---------------------------------------------------------------- Camera
export class Camera {
  constructor(w, h) {
    this.x = 0; this.y = 0; this.zoom = 1;
    this.w = w; this.h = h;
    this.shakeT = 0; this.shakeAmp = 0;
    this.sx = 0; this.sy = 0;
  }
  follow(tx, ty, dt, speed = 5) {
    const t = 1 - Math.exp(-speed * dt);
    this.x = lerp(this.x, tx, t);
    this.y = lerp(this.y, ty, t);
  }
  shake(amp, time = 0.25) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, time); }
  update(dt, rng) {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * (this.shakeT > 0 ? this.shakeT / 0.25 : 0);
      this.sx = (rng() * 2 - 1) * a; this.sy = (rng() * 2 - 1) * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    } else { this.sx = 0; this.sy = 0; }
  }
  apply(ctx) {
    ctx.setTransform(this.zoom, 0, 0, this.zoom,
      this.w / 2 - (this.x + this.sx) * this.zoom,
      this.h / 2 - (this.y + this.sy) * this.zoom);
  }
  // Pointer-to-world is a SIMULATION input: it feeds hero aim, which feeds hero facing,
  // which feeds FOLLOW formation slots. It therefore deliberately excludes the shake
  // offset that `apply()` adds at render time. Including `sx`/`sy` here let decorative
  // shake — driven by its own persistent RNG stream — change fight outcomes, so two
  // identical seeded battles could diverge. Keep presentation out of this transform.
  toWorld(px, py) {
    return { x: (px - this.w / 2) / this.zoom + this.x, y: (py - this.h / 2) / this.zoom + this.y };
  }
}

// ---------------------------------------------------------------- Particles
// kinds: dust, shard, ring, slash, arrowTrail, spark, text
export class Particles {
  constructor(isEnabled = () => true) { this.list = []; this.isEnabled = isEnabled; }
  add(p) { if (this.isEnabled()) this.list.push(Object.assign({ t: 0 }, p)); }
  dust(x, y, color, n = 3, rng) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, s = 12 + rng() * 30;
      this.add({ kind: 'dust', x: x + (rng() - 0.5) * 8, y: y + (rng() - 0.5) * 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5 - 8, life: 0.5 + rng() * 0.35, r: 3.2 + rng() * 3.4, color });
    }
  }
  shards(x, y, color, n = 6, rng) {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, s = 60 + rng() * 160;
      this.add({ kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: 90 + rng() * 160, z: 8, life: 0.55 + rng() * 0.3, r: 2.5 + rng() * 3.5, rot: rng() * TAU, vr: (rng() - 0.5) * 14, color });
    }
  }
  ring(x, y, r, color, life = 0.35, width = 3) { this.add({ kind: 'ring', x, y, r0: r * 0.25, r1: r, life, color, width }); }
  slash(x, y, ang, range, arc, color) { this.add({ kind: 'slash', x, y, ang, range, arc, life: 0.22, color }); }
  spark(x, y, color, n = 4, rng) {
    // long enough to survive into a captured still: a hit that leaves no visible trace
    // in a random frame fails the Thronefall impact-feedback bar
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, s = 100 + rng() * 170;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.38 + rng() * 0.2, color });
    }
  }
  text(x, y, str, color, size = 15) { this.add({ kind: 'text', x, y, str, color, size, life: 0.9, vy: -34 }); }
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) { L.splice(i, 1); continue; }
      if (p.vx != null) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.kind === 'shard') { p.z += p.vz * dt; p.vz -= 620 * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.4; p.vx *= 0.6; p.vy *= 0.6; } p.rot += p.vr * dt; }
      if (p.kind === 'dust') { p.vx *= (1 - 2.4 * dt); p.vy *= (1 - 2.4 * dt); }
      if (p.kind === 'spark') { p.vx *= (1 - 6 * dt); p.vy *= (1 - 6 * dt); }
      if (p.kind === 'text') { p.y += p.vy * dt; p.vy *= (1 - 3 * dt); }
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const k = 1 - p.t / p.life;
      if (p.kind === 'dust') {
        ctx.globalAlpha = 0.5 * k;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + p.t * 2.2), 0, TAU); ctx.fill();
      } else if (p.kind === 'shard') {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = p.color;
        ctx.save(); ctx.translate(p.x, p.y - p.z); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.moveTo(-p.r, p.r * 0.7); ctx.lineTo(p.r, p.r * 0.4); ctx.lineTo(0, -p.r); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (p.kind === 'ring') {
        ctx.globalAlpha = 0.85 * k;
        ctx.strokeStyle = p.color; ctx.lineWidth = p.width * k + 1;
        const r = lerp(p.r0, p.r1, 1 - k * k);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      } else if (p.kind === 'slash') {
        // faint fill + bold rim: a near-opaque wedge erased the hero under it on every swing
        const grow = 0.6 + 0.4 * (1 - k);
        ctx.globalAlpha = Math.min(0.28, k * 0.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, p.range * grow, p.ang - p.arc / 2, p.ang + p.arc / 2);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.range * grow, p.ang - p.arc / 2, p.ang + p.arc / 2);
        ctx.stroke();
      } else if (p.kind === 'spark') {
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else if (p.kind === 'text') {
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.fillStyle = p.color;
        ctx.font = `800 ${p.size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(p.str, p.x, p.y);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- Audio (WebAudio synth — no assets)
export class Sfx {
  constructor(saves = null) {
    this.saves = saves;
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.muted = saves?.getSettings?.().muted === true;
    this.lastAt = {};
    this.noiseRng = makeRng(deriveSeed(0x534658, RNG_DOMAINS.AUDIO_FX));
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
    return this.saves?.setMuted?.(m) ?? Promise.resolve();
  }
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.35;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.enabled = false; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.enabled && this.ctx;
  }
  throttle(name, ms) {
    const now = performance.now();
    if (this.lastAt[name] && now - this.lastAt[name] < ms) return true;
    this.lastAt[name] = now;
    return false;
  }
  env(node, t0, a, d, peak = 1) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  noise(dur, filterFreq, peak = 0.5, type = 'lowpass') {
    if (!this.ensure()) return;
    const c = this.ctx, t0 = c.currentTime;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = this.noiseRng() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = c.createGain(); this.env(g, t0, 0.005, dur, peak);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }
  tone(freq, dur, type = 'square', peak = 0.25, slide = 0) {
    if (!this.ensure()) return;
    const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    const g = c.createGain(); this.env(g, t0, 0.008, dur, peak);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  swing() { if (!this.throttle('swing', 60)) this.noise(0.12, 2600, 0.35, 'bandpass'); }
  hit() { if (!this.throttle('hit', 40)) { this.noise(0.08, 900, 0.5); this.tone(140, 0.09, 'triangle', 0.3, -60); } }
  kill() { if (!this.throttle('kill', 50)) { this.noise(0.14, 600, 0.5); this.tone(90, 0.16, 'sawtooth', 0.22, -40); } }
  hurt() { this.tone(200, 0.18, 'sawtooth', 0.3, -120); this.noise(0.12, 500, 0.4); }
  dash() { this.noise(0.22, 1800, 0.4, 'highpass'); }
  bow() { if (!this.throttle('bow', 80)) { this.tone(600, 0.06, 'square', 0.12, 500); this.noise(0.05, 3000, 0.15, 'highpass'); } }
  horn(freq = 220) {
    if (!this.ensure()) return;
    const c = this.ctx, t0 = c.currentTime;
    for (const [f, p] of [[freq, 0.28], [freq * 1.5, 0.16], [freq * 2, 0.08]]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(p, t0 + 0.06);
      g.gain.setValueAtTime(p, t0 + 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 0.7);
    }
  }
  coin() { this.tone(880, 0.07, 'square', 0.18); this.tone(1320, 0.1, 'square', 0.14); }
  brute() { this.noise(0.3, 300, 0.7); this.tone(60, 0.3, 'sine', 0.5, -20); }
  gallop() { if (!this.throttle('gallop', 210)) this.noise(0.04, 700, 0.1); }
  victory() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'square', 0.2), i * 130)); }
  defeat() { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'sawtooth', 0.2), i * 180)); }
}

// Darken a #rrggbb color by factor f (0..1) — the volume pass draws every shade face as a
// SOLID computed tone, never an alpha overlay (alpha overlays vanish at rater resolution)
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---------------------------------------------------------------- Flat-shaded drawing helpers
// One consistent global light direction for every cast shadow in the game (down-right, matches
// the old fixed offset's angle) — Thronefall reads readable because every shadow leans one way.
const LIGHT_ANGLE = Math.atan2(0.16, 0.30);
const LIGHT_COS = Math.cos(LIGHT_ANGLE), LIGHT_SIN = Math.sin(LIGHT_ANGLE);

// Hard-edged cast shadow for a "standing" object of given height: a flat ellipse stretched away
// from the object along the shared light direction, growing with height, rather than a soft
// centered contact blob.
export function shadow(ctx, x, y, r, h, color) {
  ctx.fillStyle = color;
  const len = h * 0.55;
  ctx.save();
  ctx.translate(x + LIGHT_COS * len, y + LIGHT_SIN * len * 0.6);
  ctx.rotate(LIGHT_ANGLE);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.05 + len * 0.62, r * 0.48 + h * 0.06, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// Thronefall-style two-tone triangle tree (stacked)
export function tree(ctx, x, y, s, light, dark, trunk) {
  shadow(ctx, x, y, s * 0.5, s * 1.3, trunk);
  for (let i = 0; i < 2; i++) {
    const yy = y - i * s * 0.55, ss = s * (1 - i * 0.28);
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(x, yy - ss * 1.15); ctx.lineTo(x + ss * 0.62, yy); ctx.lineTo(x, yy + ss * 0.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.moveTo(x, yy - ss * 1.15); ctx.lineTo(x - ss * 0.62, yy); ctx.lineTo(x, yy + ss * 0.1); ctx.closePath(); ctx.fill();
  }
}

// Two-tone rock
export function rock(ctx, x, y, s, light, dark, shadowC, rot = 0.3) {
  shadow(ctx, x, y + s * 0.2, s * 0.9, s * 0.8, shadowC);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = rot + i / 6 * TAU;
    const r = s * (0.75 + 0.3 * Math.sin(i * 2.7));
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.72 - s * 0.3]);
  }
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0], pts[2][1]);
  ctx.lineTo(x, y - s * 0.55); ctx.closePath(); ctx.fill();
}

// Mountain cluster (for world map) — three tones: shadow face, lit face, snow cap.
// One extra facet is what separates "volumetric rock" from "flat triangle" at a glance.
export function mountain(ctx, x, y, s, ink, cream) {
  // cast shadow first — mountains obey the same up-left light as every other standing object
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(x - s * 0.6, y + s * 0.42); ctx.lineTo(x + s * 1.75, y + s * 0.42);
  ctx.lineTo(x + s * 1.15, y + s * 0.62); ctx.lineTo(x - s * 0.4, y + s * 0.62); ctx.closePath(); ctx.fill();
  ctx.restore();
  // asymmetric apex + a small shadow-side outcrop: a rock formation, not a triangle icon
  const ax = x - s * 0.12;
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.4); ctx.lineTo(ax, y - s); ctx.lineTo(x + s * 1.1, y + s * 0.42); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + s * 0.55, y + s * 0.42); ctx.lineTo(x + s * 0.78, y - s * 0.18); ctx.lineTo(x + s * 1.25, y + s * 0.42); ctx.closePath(); ctx.fill();
  // lit face (toward the global light: down-right) — a mid-tone wedge on the right side
  ctx.save();
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = cream;
  ctx.beginPath(); ctx.moveTo(ax, y - s); ctx.lineTo(x + s * 1.1, y + s * 0.42); ctx.lineTo(x + s * 0.28, y + s * 0.42); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = cream;
  ctx.beginPath(); ctx.moveTo(ax, y - s); ctx.lineTo(ax - s * 0.34, y - s * 0.42); ctx.lineTo(ax + 2, y - s * 0.34); ctx.lineTo(ax + s * 0.4, y - s * 0.5); ctx.closePath(); ctx.fill();
}

// Rounded rect
export function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Health bar (Thronefall-thin, but never sub-pixel: bright fill, minimum legible width)
export function hpBar(ctx, x, y, w, frac, back, fill) {
  if (frac >= 1) return;
  w = Math.max(w, 22);
  ctx.fillStyle = back;
  ctx.fillRect(x - w / 2 - 1, y - 3.5, w + 2, 7);
  ctx.fillStyle = fill;
  ctx.fillRect(x - w / 2, y - 2.5, w * Math.max(0, frac), 5);
}

// Squad icon balloon (colored circle with glyph, optional unit count), s = scale
export function balloon(ctx, x, y, kind, ink, paper, s = 1, count = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // plain rounded chip — the old swallowtail notch made the whole badge silhouette
  // read as a floating letter "D" at native scale (root cause of a six-round complaint)
  const w = count > 1 ? 40 : 26;
  ctx.fillStyle = ink;
  rrect(ctx, -w / 2, -11, w, 22, 5); ctx.fill();
  if (count > 1) ctx.translate(-8, 0);
  ctx.strokeStyle = paper; ctx.lineWidth = 2; ctx.lineCap = 'round';
  if (kind === 'spear') {
    ctx.beginPath(); ctx.moveTo(-4.5, 5); ctx.lineTo(2.5, -2); ctx.stroke();
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.moveTo(1, -5.5); ctx.lineTo(5.5, -1); ctx.lineTo(4.5, -5.5); ctx.closePath(); ctx.fill();
  } else if (kind === 'bow') {
    // one bold shaft + solid arrowhead, no curves: the only shape that survives 12-16px
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-4.5, 4.5); ctx.lineTo(2.4, -2.4); ctx.stroke();
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.moveTo(5.5, -5.5); ctx.lineTo(0.2, -2.6); ctx.lineTo(2.6, -0.2); ctx.closePath(); ctx.fill();
  } else if (kind === 'helm') {
    ctx.beginPath(); ctx.arc(0, 1, 4.5, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4.5, 1); ctx.lineTo(4.5, 1); ctx.stroke();
  } else if (kind === 'axe') {
    // clear axe read: straight haft + solid broad blade wedge (the old arc read as a wrench)
    ctx.beginPath(); ctx.moveTo(-4.5, 5); ctx.lineTo(3, -2.5); ctx.stroke();
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.moveTo(1, -5.5); ctx.lineTo(6, -2.5); ctx.lineTo(4.5, 0.5); ctx.lineTo(0.5, -1.5); ctx.closePath(); ctx.fill();
  } else if (kind === 'fang') {
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.moveTo(-4.5, -3); ctx.lineTo(-1.5, 4.5); ctx.lineTo(0, -3); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0.5, -3); ctx.lineTo(3, 4.5); ctx.lineTo(4.5, -3); ctx.closePath(); ctx.fill();
  } else if (kind === 'club') {
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-3.5, 4.5); ctx.lineTo(3, -3); ctx.stroke();
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.arc(3.5, -3.5, 2.5, 0, TAU); ctx.fill();
  }
  if (count > 1) {
    ctx.translate(8, 0);
    ctx.fillStyle = paper;
    ctx.font = '800 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(count), 11, 0.5);
  }
  ctx.restore();
}
