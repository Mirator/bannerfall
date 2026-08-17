// Bannerfall — boot, state machine, fixed-timestep loop, headless test API.
import { PAL } from './data.js?v=r7584d9e97185';
import { Input, Camera, Sfx, makeRng, deriveSeed, RNG_DOMAINS, rrect, mountain } from './engine.js?v=r7584d9e97185';
import { Battle } from './battle.js?v=r7584d9e97185';
import { World } from './world.js?v=r7584d9e97185';
import { ACTIONS } from './input-actions.js?v=r7584d9e97185';
import { createWebPlatform } from './platform/web-platform.js?v=r7584d9e97185';
import { SaveRepository } from './persistence/save-repository.js?v=r7584d9e97185';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth || 1280;
  canvas.height = window.innerHeight || 720;
  if (game) { game.camera.w = canvas.width; game.camera.h = canvas.height; game.invalidate(); }
}
window.addEventListener('resize', resize);

class Game {
  constructor({ platform, saves }) {
    this.platform = platform;
    this.saves = saves;
    this.input = new Input(canvas, platform);
    this.camera = new Camera(canvas.width, canvas.height);
    this.sfx = new Sfx(saves);
    this.shakeRng = makeRng(deriveSeed(99, RNG_DOMAINS.CAMERA_SHAKE));
    this.scene = null;
    this.sceneName = 'menu';
    this.menuT = 0;
    this.menuPanel = 'root';
    this.menuIndex = 0;
    this.menuHitRegions = [];
    this.pendingHard = false;
    this.victoryT = 0;
    this.paused = false;
    this.saveTimer = 0;
    // once any headless test API call drives the game (scenario/step/tap/key/mouse/click),
    // persistence switches to a separate slot so critics/tests can never overwrite or wipe
    // a real player's campaign save.
    this.testMode = false;
    this.testSeed = null; // one-shot deterministic runSeed override for scenario('world', {seed})
    this.effectsEnabled = true;
    this.renderDirty = true;
  }

  invalidate() { this.renderDirty = true; }

  reportSaveFailure(error) {
    this.saveWarning = 'Save failed — progress may not be stored.';
    this.saveError = error;
    this.invalidate();
  }

  // ---- campaign persistence: the run survives a refresh
  persistRun() {
    if (this.sceneName === 'world' && this.scene && this.scene.save && !this.scene.save.won) {
      const snapshot = this.scene.syncLiveStateToSave();
      if (!Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y) ||
          (snapshot.parties || []).some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        this.reportSaveFailure(new Error('Save snapshot contains non-finite campaign coordinates'));
        return;
      }
      this.saves.writeCampaign(this.testMode, snapshot)
        .catch(error => this.reportSaveFailure(error));
    }
  }
  loadRun() {
    return this.saves.getCampaign(this.testMode);
  }
  clearRun() {
    this.saves.removeCampaign(this.testMode).catch(error => this.reportSaveFailure(error));
  }

  enterMenu(panel = 'root') {
    this.scene = null;
    this.sceneName = 'menu';
    this.menuT = 0;
    this.menuPanel = panel;
    this.menuIndex = 0;
    this.menuHitRegions = [];
    this.pendingHard = false;
    this.paused = false;
    this.invalidate();
  }

  menuItems() {
    const save = this.loadRun();
    if (this.menuPanel === 'new') return [
      { id: 'normal', label: 'NORMAL CAMPAIGN', meta: 'Balanced camps · volunteers may join' },
      { id: 'hard', label: 'HARD CAMPAIGN', meta: 'Stronger camps · no volunteers' },
      { id: 'back', label: 'BACK' },
    ];
    if (this.menuPanel === 'confirm') return [
      { id: 'cancel', label: 'KEEP CURRENT CAMPAIGN' },
      { id: 'replace', label: `START NEW ${this.pendingHard ? 'HARD ' : ''}CAMPAIGN` },
    ];
    if (this.menuPanel === 'settings') return [
      { id: 'mute', label: 'SOUND', meta: this.sfx.muted ? 'Muted' : 'On' },
      { id: 'back', label: 'BACK' },
    ];
    if (this.menuPanel === 'credits') return [{ id: 'back', label: 'BACK' }];
    const items = [];
    if (save) {
      const seconds = Math.max(0, Math.floor(save.stats?.playT || 0));
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      items.push({
        id: 'continue', label: 'CONTINUE CAMPAIGN',
        meta: `${save.hard ? 'Hard' : 'Normal'} · ${save.troops.length} troops · ${time}`,
      });
    }
    items.push(
      { id: 'new', label: 'NEW CAMPAIGN' },
      { id: 'settings', label: 'SETTINGS' },
      { id: 'credits', label: 'CREDITS' },
    );
    return items;
  }

  setMenuPanel(panel) {
    this.menuPanel = panel;
    this.menuIndex = 0;
    this.menuHitRegions = [];
    this.invalidate();
  }

  startNewCampaign(hard) {
    this.sfx.horn(hard ? 147 : 262);
    this.clearRun();
    this.hardNext = !!hard;
    this.startWorld(null);
  }

  requestNewCampaign(hard) {
    this.pendingHard = !!hard;
    if (this.loadRun()) this.setMenuPanel('confirm');
    else this.startNewCampaign(this.pendingHard);
  }

  activateMenuItem(id) {
    if (id === 'continue') {
      const save = this.loadRun();
      if (save) { this.sfx.horn(262); this.startWorld(save); }
    } else if (id === 'new') this.setMenuPanel('new');
    else if (id === 'normal') this.requestNewCampaign(false);
    else if (id === 'hard') this.requestNewCampaign(true);
    else if (id === 'settings') this.setMenuPanel('settings');
    else if (id === 'credits') this.setMenuPanel('credits');
    else if (id === 'mute') {
      this.sfx.setMuted(!this.sfx.muted).catch(error => this.reportSaveFailure(error));
      this.invalidate();
    } else if (id === 'replace') this.startNewCampaign(this.pendingHard);
    else if (id === 'cancel') this.setMenuPanel('new');
    else if (id === 'back') this.setMenuPanel('root');
  }

  updateMenu(dt) {
    this.menuT += dt;
    const items = this.menuItems();
    this.menuIndex = Math.min(this.menuIndex, Math.max(0, items.length - 1));

    if (this.menuPanel === 'root' && this.input.pressedAction(ACTIONS.CONTINUE_RUN) && this.loadRun()) {
      this.activateMenuItem('continue');
      return;
    }
    if (this.menuPanel === 'root' && this.input.pressedAction(ACTIONS.NEW_HARD_RUN)) {
      this.requestNewCampaign(true);
      return;
    }

    const hovered = this.menuHitRegions.find(region =>
      this.input.mouse.x >= region.x && this.input.mouse.x <= region.x + region.w &&
      this.input.mouse.y >= region.y && this.input.mouse.y <= region.y + region.h);
    if (hovered && (this.input.mouse.moved || this.input.mouse.clicked)) {
      const hoverIndex = items.findIndex(item => item.id === hovered.id);
      if (hoverIndex >= 0 && hoverIndex !== this.menuIndex) {
        this.menuIndex = hoverIndex;
        this.invalidate();
      }
    }

    if (this.input.pressedAction(ACTIONS.MENU_UP)) {
      this.menuIndex = (this.menuIndex + items.length - 1) % items.length;
      this.invalidate();
    } else if (this.input.pressedAction(ACTIONS.MENU_DOWN)) {
      this.menuIndex = (this.menuIndex + 1) % items.length;
      this.invalidate();
    } else if (this.input.pressedAction(ACTIONS.MENU_BACK)) {
      if (this.menuPanel === 'confirm') this.setMenuPanel('new');
      else if (this.menuPanel !== 'root') this.setMenuPanel('root');
    } else if (this.input.pressedAction(ACTIONS.CONFIRM)) {
      this.activateMenuItem(items[this.menuIndex].id);
    } else if (this.input.mouse.clicked && hovered) {
      this.activateMenuItem(hovered.id);
    }
  }

  startWorld(save) {
    this.scene = new World(this, save);
    this.sceneName = 'world';
    this._lastSave = this.scene.save;
    this.camera.zoom = 1;
    this.camera.x = this.scene.hero.x; this.camera.y = this.scene.hero.y;
    this.invalidate();
    this.persistRun();
  }
  startBattle(setup) {
    this.scene = new Battle(this, setup);
    this.sceneName = 'battle';
    this.camera.zoom = 1;
    this.camera.x = this.scene.hero.x; this.camera.y = this.scene.hero.y;
    this.invalidate();
  }
  startVictory(save) {
    this.scene = null;
    this.sceneName = 'victory';
    this.victoryT = 0;
    this.finalSave = save;
    this.invalidate();
    this.clearRun(); // the campaign is over — next Enter starts a genuinely fresh run
    this.sfx.victory();
  }

  update(dt) {
    // mute toggle works everywhere
    if (this.input.pressedAction(ACTIONS.MUTE)) {
      this.sfx.setMuted(!this.sfx.muted).catch(error => this.reportSaveFailure(error));
      this.muteToastT = 2.5; this.invalidate();
    }
    if (this.muteToastT > 0) this.muteToastT -= dt;
    // pause: any active scene, Escape or P
    if (this.input.pressedAction(ACTIONS.PAUSE) &&
        (this.sceneName === 'world' || this.sceneName === 'battle')) {
      this.paused = !this.paused;
      if (this.paused) this.persistRun();
      this.invalidate();
    }
    if (this.paused) {
      if (this.input.pressedAction(ACTIONS.ABANDON_RUN)) { this.clearRun(); this.enterMenu(); }
      this.input.endFrame();
      return;
    }
    if (this.sceneName === 'menu') {
      this.updateMenu(dt);
    } else if (this.sceneName === 'victory') {
      this.victoryT += dt;
      if (this.victoryT > 1.5 && (this.input.pressedAction(ACTIONS.CONFIRM) || this.input.mouse.clicked)) {
        this.enterMenu();
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
    this.renderDirty = false;
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

  menuLayout(W, H) {
    const compact = W < 900 || H < 600;
    const panelW = Math.min(compact ? 520 : 470, W - 48);
    const panelX = compact ? (W - panelW) / 2 : Math.max(42, W * 0.055);
    return {
      compact, panelW, panelX,
      centerX: panelX + panelW / 2,
      titleY: compact ? H * 0.20 : H * 0.18,
      rootY: compact ? H * 0.38 : H * 0.36,
      panelY: compact ? H * 0.47 : H * 0.43,
    };
  }

  drawMenuCloud(cx, cy, s) {
    ctx.fillStyle = '#FFF6E3';
    for (const [ox, oy, r] of [[0, 0, s], [s * 0.9, -s * 0.25, s * 0.75], [-s * 0.9, -s * 0.15, s * 0.7], [s * 0.45, -s * 0.6, s * 0.6], [-s * 0.4, -s * 0.55, s * 0.55]]) {
      ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawMenuScenery(W, H, P, compact) {
    ctx.fillStyle = P.ground;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = P.groundShade;
    ctx.beginPath();
    ctx.moveTo(compact ? 0 : W * 0.46, H * 0.76);
    ctx.lineTo(W, H * 0.48); ctx.lineTo(W, H); ctx.lineTo(compact ? 0 : W * 0.35, H); ctx.closePath(); ctx.fill();

    const cloudSpan = W + 240;
    const driftA = (this.menuT * 7) % cloudSpan;
    const driftB = (this.menuT * 4.5) % cloudSpan;
    this.drawMenuCloud((W * 0.58 + driftA) % cloudSpan - 100, H * 0.16, 30);
    this.drawMenuCloud((W * 0.88 + driftB) % cloudSpan - 80, H * 0.08, 42);
    this.drawMenuCloud(W * 0.06, H * 1.02, 62);

    const horizon = H * 0.47;
    for (const [fx, fs] of [[0.50, 62], [0.61, 94], [0.72, 68], [0.82, 112], [0.94, 78]]) {
      mountain(ctx, W * fx, horizon - fs * 0.32, fs, P.ink, P.cream);
    }

    // One world-map road carries the eye from the menu toward the objective.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = P.ink; ctx.lineWidth = Math.max(28, W * 0.025);
    ctx.beginPath(); ctx.moveTo(W * 0.55, H * 0.91); ctx.quadraticCurveTo(W * 0.67, H * 0.72, W * 0.75, H * 0.61); ctx.quadraticCurveTo(W * 0.82, H * 0.51, W * 0.85, H * 0.39); ctx.stroke();
    ctx.strokeStyle = P.cream; ctx.lineWidth = Math.max(18, W * 0.015);
    ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

    // Wolfsjaw Hold: a tiny, readable destination rather than unrelated key art.
    const hx = W * 0.855, hy = H * 0.34, hs = Math.min(W, H) * 0.105;
    ctx.fillStyle = P.ink;
    ctx.fillRect(hx - hs * 0.55, hy, hs * 1.1, hs * 0.72);
    ctx.fillRect(hx - hs * 0.72, hy - hs * 0.28, hs * 0.32, hs);
    ctx.fillRect(hx + hs * 0.40, hy - hs * 0.28, hs * 0.32, hs);
    ctx.fillRect(hx - hs * 0.10, hy - hs * 0.45, hs * 0.20, hs * 1.17);
    ctx.fillStyle = P.cream;
    ctx.fillRect(hx - hs * 0.62, hy - hs * 0.18, hs * 0.12, hs * 0.34);
    ctx.fillRect(hx + hs * 0.50, hy - hs * 0.18, hs * 0.12, hs * 0.34);
    ctx.fillStyle = P.enemy;
    const flagWave = Math.sin(this.menuT * 2.2) * hs * 0.05;
    ctx.beginPath(); ctx.moveTo(hx, hy - hs * 0.45); ctx.lineTo(hx + hs * 0.36, hy - hs * 0.34 + flagWave); ctx.lineTo(hx, hy - hs * 0.22); ctx.closePath(); ctx.fill();

    const pointOnRoad = u => ({
      x: W * (0.55 + u * 0.29),
      y: H * (0.91 - u * 0.50 - Math.sin(u * Math.PI) * 0.035),
    });
    const travel = (0.22 + this.menuT * 0.035) % 1;
    // Dust remains presentation-only and deterministic; no gameplay/fx RNG is consumed.
    ctx.fillStyle = 'rgba(242,227,193,0.62)';
    for (let i = 0; i < 5; i++) {
      const p = pointOnRoad(Math.max(0, travel - 0.055 * i));
      const pulse = 3 + ((this.menuT * 12 + i * 2) % 4);
      ctx.beginPath(); ctx.arc(p.x - 10 - i * 2, p.y + 12, pulse, 0, Math.PI * 2); ctx.fill();
    }
    const drawSoldier = (p, spear) => {
      ctx.fillStyle = P.hero;
      ctx.fillRect(p.x - 3, p.y - 10, 6, 11);
      ctx.beginPath(); ctx.arc(p.x, p.y - 13, 3, 0, Math.PI * 2); ctx.fill();
      if (spear) {
        ctx.fillRect(p.x + 4, p.y - 25, 2, 25);
        ctx.beginPath(); ctx.moveTo(p.x + 5, p.y - 29); ctx.lineTo(p.x + 2, p.y - 23); ctx.lineTo(p.x + 8, p.y - 23); ctx.closePath(); ctx.fill();
      }
    };
    for (let i = 4; i >= 0; i--) drawSoldier(pointOnRoad(Math.max(0, travel - 0.055 * (i + 1))), i % 2 === 0);
    const hero = pointOnRoad(travel);
    ctx.fillStyle = P.hero;
    ctx.fillRect(hero.x - 13, hero.y - 8, 26, 9);
    for (const ox of [-9, -3, 5, 11]) ctx.fillRect(hero.x + ox, hero.y, 3, 5);
    ctx.beginPath(); ctx.arc(hero.x + 12, hero.y - 12, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.enemy;
    ctx.fillRect(hero.x - 3, hero.y - 22, 7, 14);
    ctx.beginPath(); ctx.arc(hero.x, hero.y - 25, 4, 0, Math.PI * 2); ctx.fill();
  }

  drawMenu() {
    const W = canvas.width, H = canvas.height;
    const P = PAL.world;
    const layout = this.menuLayout(W, H);
    this.drawMenuScenery(W, H, P, layout.compact);

    // Compact banner lockup leaves the world vignette and navigation equal room.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs2 = Math.min(82, W * (layout.compact ? 0.075 : 0.062));
    ctx.font = `900 ${fs2}px system-ui, sans-serif`;
    const tw2 = ctx.measureText('BANNERFALL').width;
    const rx = layout.centerX - tw2 / 2 - 25, ry2 = layout.titleY - fs2 * 0.54, rw = tw2 + 50, rh = fs2 * 1.08;
    ctx.fillStyle = P.enemy;
    ctx.fillRect(rx, ry2, rw, rh);
    ctx.beginPath(); ctx.moveTo(rx, ry2); ctx.lineTo(rx - 18, ry2 + rh / 2); ctx.lineTo(rx, ry2 + rh); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(rx + rw, ry2); ctx.lineTo(rx + rw + 18, ry2 + rh / 2); ctx.lineTo(rx + rw, ry2 + rh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#A32E23';
    ctx.fillRect(rx, ry2 + rh - 6, rw, 6);
    ctx.fillText('BANNERFALL', layout.centerX + 3, layout.titleY + 3);
    ctx.fillStyle = P.ink;
    ctx.fillText('BANNERFALL', layout.centerX, layout.titleY);
    ctx.strokeStyle = P.cream; ctx.lineWidth = 1.25;
    ctx.strokeText('BANNERFALL', layout.centerX, layout.titleY);
    ctx.font = `600 ${layout.compact ? 14 : 15}px system-ui, sans-serif`;
    ctx.fillStyle = P.ink;
    ctx.fillText('Raise a warband. Raze the camps. Take Wolfsjaw Hold.', layout.centerX, layout.titleY + fs2 * 0.88);
    const headings = {
      new: ['CHOOSE YOUR CAMPAIGN', 'Difficulty cannot be changed after departure.'],
      confirm: ['REPLACE SAVED CAMPAIGN?', 'Your current campaign will be permanently replaced.'],
      settings: ['SETTINGS', 'WASD ride · mouse aim · LMB swing · Space dash · 1/2/3 troop orders'],
      credits: ['CREDITS', 'Designed and built for the Bannerfall campaign.'],
    };
    const heading = headings[this.menuPanel];
    if (heading) {
      ctx.fillStyle = P.ink;
      ctx.font = '900 19px system-ui, sans-serif';
      ctx.fillText(heading[0], layout.centerX, H * 0.335);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(heading[1], layout.centerX, H * 0.372);
      if (this.menuPanel === 'credits') {
        ctx.fillText('Flat-shaded campaign maps, banners, and tiny warbands.', layout.centerX, H * 0.402);
      }
    }

    const items = this.menuItems();
    const pw = layout.panelW, rowH = 42, gap = 8;
    const startY = heading ? layout.panelY : layout.rootY;
    this.menuHitRegions = [];
    items.forEach((item, index) => {
      const x = layout.panelX, y = startY + index * (rowH + gap);
      const selected = index === this.menuIndex;
      ctx.fillStyle = selected ? P.cream : P.ink;
      rrect(ctx, x, y, pw, rowH, 8); ctx.fill();
      ctx.strokeStyle = selected ? P.hero : P.cream;
      ctx.lineWidth = selected ? 3 : 1.5;
      rrect(ctx, x, y, pw, rowH, 8); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = selected ? P.ink : P.cream;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.fillText(`${selected ? '▸  ' : '   '}${item.label}`, x + 18, y + rowH / 2 + 1);
      if (item.meta) {
        ctx.textAlign = 'right';
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText(item.meta, x + pw - 16, y + rowH / 2 + 1);
      }
      this.menuHitRegions.push({ id: item.id, x, y, w: pw, h: rowH });
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = P.ink;
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText(`${this.menuPanel === 'root' ? '↑↓ / WASD  Navigate' : '↑↓  Navigate'}    ·    ENTER  Select${this.menuPanel === 'root' ? '' : '    ·    ESC  Back'}    ·    M  Mute`, layout.centerX, H - 24);
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
let platform = null;
let saves = null;

// Fixed-timestep loop with rAF; watchdog keeps sim alive if rAF is throttled.
const DT = 1 / 60;
let acc = 0, last = performance.now(), lastTick = 0;

// A backlog cap: without it, a throttled/backgrounded tab (rAF paused, watchdog still
// ticking at ~20Hz) accumulates real minutes of sim debt and then fast-forwards through
// it on refocus. 0.25s is generous for normal hitches but bounds the worst case.
const MAX_ACC = 0.25;

function frame(now) {
  if (!game) { requestAnimationFrame(frame); return; }
  acc += Math.min(0.1, (now - last) / 1000);
  acc = Math.min(acc, MAX_ACC);
  last = now;
  lastTick = now;
  try {
    let n = 0;
    while (acc >= DT && n++ < 5) { game.update(DT); acc -= DT; }
    if (n > 0 || game.renderDirty) game.draw();
  } catch (err) {
    // an exception here would otherwise skip the reschedule below and freeze the
    // tab forever (and, for the watchdog, replay the same throw at 20Hz) — recover
    // to the menu instead of dying silently. The save on disk is untouched.
    console.error('Bannerfall: recovered from an error in the game loop', err);
    acc = 0;
    game.enterMenu();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  // headless watchdog: if rAF hasn't ticked in 300ms, drive the same accumulator
  // frame() uses, so sim time stays coupled to real time instead of a fixed 20Hz
  const now = performance.now();
  if (now - lastTick > 300) {
    acc += Math.min(0.1, (now - last) / 1000);
    acc = Math.min(acc, MAX_ACC);
    last = now;
    try {
      let n = 0;
      while (acc >= DT && n++ < 3) { game.update(DT); acc -= DT; }
      if (!platform.lifecycle.isBackgrounded() && (n > 0 || game.renderDirty)) game.draw();
    } catch (err) {
      console.error('Bannerfall: recovered from an error in the watchdog loop', err);
      acc = 0;
      game.enterMenu();
    }
  }
}, 50);

function exposeTestApi() {
// ---------------------------------------------------------------- test API
window.__g = game; // raw handle for critics/debugging
// any call through window.game flips persistence to a separate save slot — a critic
// driving the game headlessly can never read, overwrite, or wipe a real campaign.
const markTest = () => { game.testMode = true; };
window.game = {
  scene: () => game.sceneName,
  step: (seconds = DT) => {
    markTest();
    const steps = Math.min(60 * 30, Math.round(seconds / DT));
    for (let i = 0; i < steps; i++) game.update(DT);
    game.draw();
    return game.sceneName;
  },
  key: (code, down = true) => { markTest(); game.input.injectKey(code, down); },
  action: (name, down = true) => { markTest(); game.input.injectAction(name, down); },
  tap: (code) => { markTest(); game.input.injectKey(code, true); game.update(DT); game.input.injectKey(code, false); game.draw(); },
  mouse: (x, y, down) => { markTest(); game.input.injectMouse(x, y, down); },
  click: (x, y) => { markTest(); game.input.injectMouse(x, y, true); game.update(DT); game.input.injectMouse(x, y, false); game.draw(); },
  shot: () => canvas.toDataURL('image/png'),
  effects: (enabled = true) => { markTest(); game.effectsEnabled = !!enabled; },
  state: () => {
    const s = { scene: game.sceneName };
    const sc = game.scene;
    if (game.sceneName === 'menu') {
      const items = game.menuItems();
      s.menu = {
        panel: game.menuPanel,
        index: game.menuIndex,
        selected: items[game.menuIndex]?.id ?? null,
        items: items.map(item => ({ id: item.id, label: item.label, meta: item.meta ?? null })),
        pendingHard: game.pendingHard,
      };
    }
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
  // jump straight into a scenario for testing. opts.seed pins the world's runSeed so
  // camp garrisons and party comps are reproducible across test runs (world.js reads
  // game.testSeed once and clears it, mirroring the existing hardNext handshake).
  scenario: (name, opts) => {
    markTest();
    game.paused = false; // jumping to a scenario must not inherit a stale pause from prior state
    if (name === 'menu') game.enterMenu();
    else if (name === 'world') {
      if (opts && opts.seed != null) game.testSeed = opts.seed;
      game.startWorld(null);
    }
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
window.render_game_to_text = () => JSON.stringify(window.game.state());
window.advanceTime = (milliseconds = 0) => window.game.step(Math.max(0, milliseconds) / 1000);
}

async function bootstrap() {
  platform = createWebPlatform();
  saves = new SaveRepository(platform);
  await saves.initialize();
  // Size the canvas before Input captures its initial mouse center. The legacy
  // synchronous boot performed this resize before constructing Game; preserving
  // that order keeps seeded battle formations and visual baselines identical.
  resize();
  game = new Game({ platform, saves });
  resize();
  platform.lifecycle.onSuspend(() => {
    game.input.clear();
    if (game.sceneName === 'world') game.persistRun();
    saves.flush().catch(error => game.reportSaveFailure(error));
  });
  exposeTestApi();
  game.draw();
}

bootstrap().catch(error => {
  console.error('Bannerfall failed to initialize', error);
});
