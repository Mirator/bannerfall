// Bannerfall — boot, state machine, fixed-timestep loop, headless test API.
import { PAL } from './data.js?v=r10';
import { Input, Camera, Sfx, makeRng, rrect, mountain } from './engine.js?v=r10';
import { Battle } from './battle.js?v=r10';
import { World } from './world.js?v=r10';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth || 1280;
  canvas.height = window.innerHeight || 720;
  if (game) { game.camera.w = canvas.width; game.camera.h = canvas.height; }
}
window.addEventListener('resize', resize);

class Game {
  constructor() {
    this.input = new Input(canvas);
    this.camera = new Camera(canvas.width, canvas.height);
    this.sfx = new Sfx();
    this.shakeRng = makeRng(99);
    this.scene = null;
    this.sceneName = 'menu';
    this.menuT = 0;
    this.victoryT = 0;
    this.paused = false;
    this.saveTimer = 0;
  }

  // ---- campaign persistence: the run survives a refresh
  persistRun() {
    if (this.sceneName === 'world' && this.scene && this.scene.save && !this.scene.save.won) {
      try { localStorage.setItem('bf_save', JSON.stringify(this.scene.save)); } catch (e) {}
    }
  }
  loadRun() {
    try {
      const raw = localStorage.getItem('bf_save');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  clearRun() { try { localStorage.removeItem('bf_save'); } catch (e) {} }

  startWorld(save) {
    this.scene = new World(this, save);
    this.sceneName = 'world';
    this._lastSave = this.scene.save;
    this.camera.zoom = 1;
    this.camera.x = this.scene.hero.x; this.camera.y = this.scene.hero.y;
    this.persistRun();
  }
  startBattle(setup) {
    this.scene = new Battle(this, setup);
    this.sceneName = 'battle';
    this.camera.zoom = 1;
    this.camera.x = this.scene.hero.x; this.camera.y = this.scene.hero.y;
  }
  startVictory(save) {
    this.scene = null;
    this.sceneName = 'victory';
    this.victoryT = 0;
    this.finalSave = save;
    this.clearRun(); // the campaign is over — next Enter starts a genuinely fresh run
    this.sfx.victory();
  }

  update(dt) {
    // mute toggle works everywhere
    if (this.input.pressed.has('KeyM')) { this.sfx.setMuted(!this.sfx.muted); this.muteToastT = 2.5; }
    if (this.muteToastT > 0) this.muteToastT -= dt;
    // pause: any active scene, Escape or P
    if ((this.input.pressed.has('Escape') || this.input.pressed.has('KeyP')) &&
        (this.sceneName === 'world' || this.sceneName === 'battle')) {
      this.paused = !this.paused;
      if (this.paused) this.persistRun();
    }
    if (this.paused) {
      if (this.input.pressed.has('KeyR')) { this.paused = false; this.clearRun(); this.sceneName = 'menu'; this.menuT = 0; this.scene = null; }
      this.input.endFrame();
      return;
    }
    if (this.sceneName === 'menu') {
      this.menuT += dt;
      if (this.input.pressed.has('KeyC') && this.loadRun()) {
        this.sfx.horn(262);
        this.startWorld(this.loadRun());
      } else if (this.input.pressed.has('KeyH')) {
        this.sfx.horn(147);
        this.clearRun();
        this.hardNext = true;
        this.startWorld(null);
      } else if (this.input.pressed.has('Enter') || this.input.mouse.clicked) {
        this.sfx.horn(262);
        this.clearRun();
        this.startWorld(null);
      }
    } else if (this.sceneName === 'victory') {
      this.victoryT += dt;
      if (this.victoryT > 1.5 && (this.input.pressed.has('Enter') || this.input.mouse.clicked)) {
        this.sceneName = 'menu'; this.menuT = 0;
      }
    } else if (this.scene) {
      this.scene.update(dt);
      // autosave the campaign every few seconds while on the map
      this.saveTimer += dt;
      if (this.saveTimer > 4) { this.saveTimer = 0; this.persistRun(); }
      if (this._lastSave && this._lastSave.stats) this._lastSave.stats.playT += dt;
    }
    this.camera.update(dt, this.shakeRng);
    this.input.endFrame();
  }

  draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.sceneName === 'menu') this.drawMenu();
    else if (this.sceneName === 'victory') this.drawVictory();
    else if (this.scene) this.scene.draw(ctx);
    if (this.paused) this.drawPause();
    // mute indicator — transient toast on toggle, not permanent HUD chrome
    if (this.sfx.muted && this.muteToastT > 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(30,42,74,0.85)';
      rrect(ctx, canvas.width - 96, canvas.height - 40, 82, 26, 6); ctx.fill();
      ctx.fillStyle = '#F2E3C1';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🔇 muted', canvas.width - 55, canvas.height - 27);
    }
  }

  drawPause() {
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(21,22,46,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#F2E3C1';
    ctx.font = '900 54px system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H * 0.4);
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('ESC / P — resume    ·    M — mute    ·    R — abandon run (menu)', W / 2, H * 0.4 + 54);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#9BA3BF';
    ctx.fillText('Your campaign auto-saves on the map — closing the tab is safe', W / 2, H * 0.4 + 84);
  }

  drawMenu() {
    const W = canvas.width, H = canvas.height;
    const P = PAL.world;
    ctx.fillStyle = P.ground;
    ctx.fillRect(0, 0, W, H);
    // committed corner motif: cloud clusters (the WatG-validated vignette), not ambiguous ovals
    const cloud = (cx, cy, s) => {
      ctx.fillStyle = '#FFF6E3';
      for (const [ox, oy, r] of [[0, 0, s], [s * 0.9, -s * 0.25, s * 0.75], [-s * 0.9, -s * 0.15, s * 0.7], [s * 0.45, -s * 0.6, s * 0.6], [-s * 0.4, -s * 0.55, s * 0.55]]) {
        ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2); ctx.fill();
      }
    };
    cloud(W * 0.05, H * 0.99, 66); cloud(W * 0.17, H * 1.04, 52); cloud(W * 0.97, H * 0.04, 58);
    // mountains — same faceted three-tone draw as the world map (no menu/game style seam),
    // varied sizes and irregular spacing so the ridge doesn't read as one shape copy-pasted
    // no peak may cross the center button column — z-order collisions on the first screen
    for (const [fx, fs] of [[0.05, 47], [0.14, 92], [0.245, 61], [0.33, 112], [0.65, 66], [0.735, 84], [0.845, 55], [0.94, 99]]) {
      mountain(ctx, W * fx, H * 0.72 - fs * 0.35, fs, P.ink, P.cream);
    }
    // the game's own iconography on its poster: a marching warband silhouette along the ridge base
    const ry = H * 0.725;
    ctx.fillStyle = P.ink;
    const marcher = (mx, spear) => {
      ctx.fillRect(mx - 4, ry - 16, 8, 16);
      ctx.beginPath(); ctx.arc(mx, ry - 19, 3.5, 0, Math.PI * 2); ctx.fill();
      if (spear) { ctx.fillRect(mx + 5, ry - 32, 2, 32); ctx.beginPath(); ctx.moveTo(mx + 6, ry - 38); ctx.lineTo(mx + 2, ry - 30); ctx.lineTo(mx + 10, ry - 30); ctx.closePath(); ctx.fill(); }
    };
    // marchers live LEFT of the button column, in hero-gold so they read against the ridge
    ctx.fillStyle = P.hero;
    for (let i = 0; i < 5; i++) marcher(W * 0.175 + i * 26, i % 2 === 0);
    ctx.fillStyle = P.hero;
    ctx.fillRect(W * 0.15 - 14, ry - 14, 28, 10);
    for (const lo of [-10, -4, 4, 10]) ctx.fillRect(W * 0.15 + lo, ry - 5, 3, 5);
    ctx.beginPath(); ctx.arc(W * 0.15 + 12, ry - 18, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(W * 0.15 - 2, ry - 44, 2.5, 30);
    ctx.fillStyle = P.enemy;
    ctx.beginPath(); ctx.moveTo(W * 0.15, ry - 44); ctx.lineTo(W * 0.15 + 16, ry - 39); ctx.lineTo(W * 0.15, ry - 34); ctx.closePath(); ctx.fill();
    // title — poster lockup: hard offset shadow under the wordmark, same one-light rule as the game
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.min(110, W * 0.09)}px system-ui, sans-serif`;
    // banner-ribbon plate behind the wordmark: the title sits ON a banner — it IS the game's name
    const tw2 = ctx.measureText('BANNERFALL').width;
    const fs2 = Math.min(110, W * 0.09);
    const rx = W / 2 - tw2 / 2 - 36, ry2 = H * 0.3 - fs2 * 0.54, rw = tw2 + 72, rh = fs2 * 1.08;
    ctx.fillStyle = P.enemy;
    ctx.fillRect(rx, ry2, rw, rh);
    // notched swallowtail ends
    ctx.beginPath(); ctx.moveTo(rx, ry2); ctx.lineTo(rx - 26, ry2 + rh / 2); ctx.lineTo(rx, ry2 + rh); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(rx + rw, ry2); ctx.lineTo(rx + rw + 26, ry2 + rh / 2); ctx.lineTo(rx + rw, ry2 + rh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#A32E23';
    ctx.fillRect(rx, ry2 + rh - 8, rw, 8);
    // stepped long-shadow (3 stacked copies) + accent understroke: a carved poster lockup
    ctx.fillStyle = '#A32E23';
    ctx.fillText('BANNERFALL', W / 2 + 4, H * 0.3 + 4);
    ctx.fillStyle = P.ink;
    ctx.fillText('BANNERFALL', W / 2, H * 0.3);
    ctx.strokeStyle = P.cream; ctx.lineWidth = 1.5;
    ctx.strokeText('BANNERFALL', W / 2, H * 0.3);
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillStyle = P.ink;
    ctx.fillText('Raise a warband. Raze the camps. Take Wolfsjaw Hold.', W / 2, H * 0.3 + Math.min(70, W * 0.05) * 1.45);
    // action chips on ink pills so they never fight the mountain art behind them
    // one shared pill width: visual weight must track priority, not text length
    const chip = (text, y, font, primary) => {
      ctx.font = font;
      // shared width band with real padding; every pill gets a separating stroke so it can
      // never fuse with same-color background art
      const tw = Math.max(primary ? 420 : 380, ctx.measureText(text).width + 44);
      ctx.fillStyle = P.ink;
      rrect(ctx, W / 2 - tw / 2, y - 15, tw, 30, 15); ctx.fill();
      ctx.strokeStyle = primary ? P.hero : P.cream; // SOLID stroke: antialiasing is not a border
      ctx.lineWidth = 2.5;
      rrect(ctx, W / 2 - tw / 2, y - 15, tw, 30, 15); ctx.stroke();
      ctx.fillStyle = P.cream;
      ctx.fillText(text, W / 2, y + 1);
    };
    if (Math.sin(this.menuT * 4) > -0.3) chip('Press ENTER to ride', H * 0.52, '800 20px system-ui, sans-serif', true);
    if (this.loadRun()) chip('C — continue your saved campaign', H * 0.585, '700 15px system-ui, sans-serif', false);
    chip('H — ride out on HARD (stronger camps, no volunteers)', H * 0.645, '700 14px system-ui, sans-serif', false);
    // controls panel (drawn last, on its own ink card so it never fights the art)
    const lines = [
      'WASD ride  ·  mouse aim  ·  LMB swing  ·  SPACE dash  ·  1/2/3 troop orders',
    ];
    const pw = 560, ph = lines.length * 26 + 24, px = W / 2 - pw / 2, py = H * 0.78;
    ctx.fillStyle = P.ink;
    rrect(ctx, px, py, pw, ph, 12); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.font = '600 14px system-ui, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, py + 25 + i * 26));
  }

  drawVictory() {
    const W = canvas.width, H = canvas.height;
    const P = PAL.world;
    ctx.fillStyle = P.ink;
    ctx.fillRect(0, 0, W, H);
    // captured banners along the bottom — the spoils on display
    for (let i = 0; i < 7; i++) {
      const x = W * (0.14 + i * 0.12), sway = Math.sin(this.victoryT * 2 + i) * 4;
      ctx.strokeStyle = P.cream; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, H * 0.98); ctx.lineTo(x, H * 0.80); ctx.stroke();
      ctx.fillStyle = i % 2 ? P.accent : P.enemy;
      ctx.beginPath();
      ctx.moveTo(x, H * 0.80); ctx.lineTo(x + 30 + sway, H * 0.825); ctx.lineTo(x, H * 0.85);
      ctx.closePath(); ctx.fill();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = P.hero;
    ctx.font = `900 ${Math.min(90, W * 0.08)}px system-ui, sans-serif`;
    ctx.fillText('WOLFSJAW HAS FALLEN', W / 2, H * 0.3);
    if (this.finalSave && this.finalSave.hard) {
      ctx.fillStyle = P.accent;
      ctx.font = '900 20px system-ui, sans-serif';
      ctx.fillText('— A HARD CAMPAIGN —', W / 2, H * 0.3 + Math.min(64, W * 0.055));
    }
    ctx.fillStyle = P.cream;
    const st = (this.finalSave && this.finalSave.stats) || { won: 0, kills: 0, lost: 0, playT: 0 };
    const mins = Math.floor(st.playT / 60), secs = Math.round(st.playT % 60);
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText('The realm is yours. The bards will sing of it.', W / 2, H * 0.44);
    ctx.font = '600 16px system-ui, sans-serif';
    const lines = [
      `Campaign time  ${mins}:${String(secs).padStart(2, '0')}`,
      `Battles won  ${st.won}   ·   Foes slain  ${st.kills}   ·   Men lost  ${st.lost}`,
      `Gold amassed  ${this.finalSave ? this.finalSave.gold : 0}`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.52 + i * 28));
    if (this.victoryT > 1.5 && Math.sin(this.victoryT * 4) > -0.3) {
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.fillText('Press ENTER for a new campaign', W / 2, H * 0.68);
    }
  }
}

let game = null;
resize();
game = new Game();
resize();

// Fixed-timestep loop with rAF; watchdog keeps sim alive if rAF is throttled.
const DT = 1 / 60;
let acc = 0, last = performance.now(), lastTick = 0;

function frame(now) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  lastTick = now;
  let n = 0;
  while (acc >= DT && n++ < 5) { game.update(DT); acc -= DT; }
  game.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  // headless watchdog: if rAF hasn't ticked in 300ms, drive the same accumulator
  // frame() uses, so sim time stays coupled to real time instead of a fixed 20Hz
  const now = performance.now();
  if (now - lastTick > 300) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    let n = 0;
    while (acc >= DT && n++ < 3) { game.update(DT); acc -= DT; }
    game.draw();
  }
}, 50);

// ---------------------------------------------------------------- test API
window.__g = game; // raw handle for critics/debugging
window.game = {
  scene: () => game.sceneName,
  step: (seconds = DT) => {
    const steps = Math.min(60 * 30, Math.round(seconds / DT));
    for (let i = 0; i < steps; i++) game.update(DT);
    game.draw();
    return game.sceneName;
  },
  key: (code, down = true) => { game.input.injectKey(code, down); },
  tap: (code) => { game.input.injectKey(code, true); game.update(DT); game.input.injectKey(code, false); game.draw(); },
  mouse: (x, y, down) => { game.input.injectMouse(x, y, down); },
  click: (x, y) => { game.input.injectMouse(x, y, true); game.update(DT); game.input.injectMouse(x, y, false); game.draw(); },
  shot: () => canvas.toDataURL('image/png'),
  state: () => {
    const s = { scene: game.sceneName };
    const sc = game.scene;
    if (game.sceneName === 'battle' && sc) {
      s.battle = {
        state: sc.state, command: sc.command,
        hero: { x: sc.hero.x | 0, y: sc.hero.y | 0, hp: sc.hero.hp },
        troops: sc.troops.length, enemies: sc.enemies.length,
        kills: sc.kills, victory: sc.victory,
      };
    }
    if (game.sceneName === 'world' && sc) {
      s.world = {
        hero: { x: sc.hero.x | 0, y: sc.hero.y | 0 },
        gold: sc.save.gold, troops: sc.save.troops.length,
        parties: sc.parties.length,
        camps: sc.save.camps,
      };
    }
    return s;
  },
  // jump straight into a scenario for testing
  scenario: (name) => {
    if (name === 'menu') { game.sceneName = 'menu'; game.scene = null; }
    else if (name === 'world') game.startWorld(null);
    else if (name === 'battle_small') {
      game.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'archer' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'raider' }],
        seed: 42, title: 'TEST SKIRMISH', arena: 'road',
        onEnd: () => game.startWorld(null),
      });
    } else if (name === 'battle_big') {
      const T = [], E = [];
      for (let i = 0; i < 7; i++) T.push({ type: 'spear' });
      for (let i = 0; i < 4; i++) T.push({ type: 'archer' });
      for (let i = 0; i < 3; i++) T.push({ type: 'knight' });
      for (let i = 0; i < 7; i++) E.push({ type: 'bandit' });
      for (let i = 0; i < 3; i++) E.push({ type: 'raider' });
      E.push({ type: 'brute' });
      game.startBattle({
        troops: T, enemies: E,
        seed: 7, title: 'TEST BATTLE', arena: 'camp', biome: 'night',
        onEnd: () => game.startWorld(null),
      });
    } else if (name === 'battle_bridge') {
      game.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'archer' }, { type: 'archer' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'wolf' }, { type: 'wolf' }, { type: 'raider' }],
        seed: 21, title: 'AMBUSHED!', arena: 'bridge', biome: 'meadow', ambush: true,
        onEnd: () => game.startWorld(null),
      });
    }
    game.draw();
    return game.sceneName;
  },
};
