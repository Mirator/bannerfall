// Bannerfall — boot, state machine, fixed-timestep loop, headless test API.
import { PAL, WORLD } from './data.js?v=r47a9e4eb3305';
import { Input, Camera, Sfx, makeRng, deriveSeed, RNG_DOMAINS, rrect, mountain } from './engine.js?v=r47a9e4eb3305';
import { Battle } from './battle.js?v=r47a9e4eb3305';
import { World } from './world.js?v=r47a9e4eb3305';
import { sampleBattlefield } from './world/battlefield-brief.js?v=r47a9e4eb3305';
import { FIELD } from './battle/constants.js?v=r47a9e4eb3305';
import { ACTIONS } from './input-actions.js?v=r47a9e4eb3305';
import { createWebPlatform } from './platform/web-platform.js?v=r47a9e4eb3305';
import { SaveRepository } from './persistence/save-repository.js?v=r47a9e4eb3305';
import { buildSummaryModel } from './world-screens.js?v=r47a9e4eb3305';
import { strongholdModifiers, STRONGHOLD_POWER_LABELS } from './region.js?v=r47a9e4eb3305';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth || 1280;
  canvas.height = window.innerHeight || 720;
  if (game) {
    game.camera.w = canvas.width; game.camera.h = canvas.height; game.invalidate();
    // Plan 023: camera follow (which owns the map-edge clamp) is frozen while world time
    // is stale, so a resize during a freeze would leave cam.x/y unclamped against the new
    // viewport and show a void strip at the map edge until the player moved again.
    if (game.sceneName === 'world' && game.scene && typeof game.scene.clampCamera === 'function') {
      game.scene.clampCamera();
    }
  }
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
    // Milestone 025 Slice E: the regional-conquest summary is built once, from the
    // final save, by the same pure model builder the tests read.
    this.summary = buildSummaryModel(save);
    this.invalidate();
    this.clearRun(); // the campaign is over — the summary's Enter starts a genuinely fresh run
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
      // Milestone 025: the summary IS the restart flow — Enter (after the reveal
      // beat) starts a new campaign with a fresh seed, at the same difficulty the
      // finished run was played on.
      if (this.victoryT > 1.5 && this.input.pressedAction(ACTIONS.CONFIRM)) {
        this.startNewCampaign(!!(this.finalSave && this.finalSave.hard));
      }
    } else if (this.scene) {
      this.scene.update(dt);
      // autosave the campaign every few seconds while on the map
      this.saveTimer += dt;
      if (this.saveTimer > 4) { this.saveTimer = 0; this.persistRun(); }
      // Plan 021: a world-scene modal (brief/aftermath) genuinely pauses the campaign —
      // leaving one open must not inflate reported campaign time. Plan 023 adds the second
      // pause of the same kind: a stopped hero freezes world time, so no campaign time
      // passes while the map is stale either. Both are documented World predicates, so
      // main.js still never reads World internals; other scenes never define them.
      // The 4-second autosave above is deliberately NOT gated — a save write is durability,
      // not simulation, and while frozen it rewrites identical bytes.
      const sc = this.scene;
      const blocking = !!(sc && typeof sc.isBlocking === 'function' && sc.isBlocking())
        || !!(sc && typeof sc.isTimeFrozen === 'function' && sc.isTimeFrozen());
      if (this._lastSave && this._lastSave.stats && !blocking) this._lastSave.stats.playT += dt;
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
      ctx.fillStyle = PAL.world.cream;
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
    ctx.fillStyle = PAL.world.cream;
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
      settings: ['SETTINGS', 'WASD ride · mouse aim · LMB swing · Space dash · 1/2/3 orders · TAB squad'],
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
    ctx.font = `900 ${Math.min(64, W * 0.06)}px system-ui, sans-serif`;
    ctx.fillText('WOLFSJAW HAS FALLEN', W / 2, H * 0.14);
    if (this.summary && this.summary.hard) {
      ctx.fillStyle = P.accent;
      ctx.font = '900 18px system-ui, sans-serif';
      ctx.fillText('— A HARD CAMPAIGN —', W / 2, H * 0.14 + Math.min(52, W * 0.045));
    }

    // Milestone 025 Slice E: the full regional-conquest summary.
    const s = this.summary || buildSummaryModel(this.finalSave || {});
    const mins = Math.floor(s.time / 60), secs = Math.round(s.time % 60);
    const colW = Math.min(760, W - 80);
    const lx = W / 2 - colW / 2 + 30, rx = W / 2 + colW / 2 - 30;
    let y = H * 0.24;
    ctx.textAlign = 'left';
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.fillStyle = P.cream;
    ctx.fillText('THE CAMPAIGN', lx, y);
    ctx.textAlign = 'right';
    ctx.fillText('THE REALM', rx, y);
    y += 26;
    const rowL = [
      `Active time   ${mins}:${String(secs).padStart(2, '0')}`,
      `Battles won   ${s.battlesWon}`,
      `Battles lost   ${s.battlesLost}`,
      `Soldiers lost   ${s.soldiersLost}`,
      `Foes slain   ${s.foesSlain}`,
    ];
    const rowR = [
      `Settlements captured   ${s.captured}/${s.totalSettlements} (held ${s.held})`,
      `Camps razed   ${s.campsRazed}/3`,
      `Gold earned   ${s.goldEarned}  ·  spent   ${s.goldSpent}`,
      `Treasury   ${s.finalGold}`,
      `Final army   ${s.army}`,
    ];
    ctx.font = '600 15px system-ui, sans-serif';
    for (let i = 0; i < rowL.length; i++) {
      ctx.textAlign = 'left'; ctx.fillStyle = P.cream;
      ctx.fillText(rowL[i], lx, y + i * 24);
      ctx.textAlign = 'right';
      ctx.fillText(rowR[i], rx, y + i * 24);
    }
    y += rowL.length * 24 + 10;
    if (s.specs.length) {
      ctx.textAlign = 'center';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.fillStyle = P.hero;
      ctx.fillText('THE BANNER OF YOUR KINGDOM', W / 2, y);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = P.cream;
      ctx.fillText(s.specs.join('   ·   '), W / 2, y + 22);
      y += 48;
    } else {
      ctx.textAlign = 'center';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = '#9BA3BF';
      ctx.fillText('No settlement flew a specialized banner.', W / 2, y + 8);
      y += 34;
    }
    if (this.victoryT > 1.5 && Math.sin(this.victoryT * 4) > -0.3) {
      ctx.textAlign = 'center';
      ctx.fillStyle = P.hero;
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.fillText('Press ENTER for a new campaign', W / 2, H * 0.90);
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
// Plan 023: world time only flows while the hero rides, but many fixtures need to observe
// party AI, spawns or timers with the hero DELIBERATELY parked (to isolate a pursuit
// geometry, a timer, or a clash from incidental contact). `keepAwake` is a treadmill: the
// movement phase reports a riding speed without travelling, so hero.vx/vy stay 0 and
// hero.x/y never change and the fixture behaves exactly as it did before the freeze
// mechanic existed. Use a real held movement input instead whenever the movement phase
// itself is the subject of the test.
const keepAwake = (world, on = true) => {
  if (!world) return;
  if (on) {
    if (!world._rideOriginal) {
      world._rideOriginal = world.updateHeroMovement;
      world.updateHeroMovement = function () { this.heroSpeed = 300; };
    }
  } else if (world._rideOriginal) {
    world.updateHeroMovement = world._rideOriginal;
    world._rideOriginal = null;
  }
};
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
  // See keepAwake above: keeps the world simulating with the hero parked. Idempotent, and
  // scoped to the CURRENT scene instance — re-apply after any scenario(), which builds a
  // new World.
  keepAwake: (on = true) => { markTest(); keepAwake(game.scene, on); },
  state: () => {
    const s = { scene: game.sceneName };
    const sc = game.scene;
    if (game.sceneName === 'victory') s.summary = game.summary;
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
        // Milestone 025 Slice C: the objective surface tests and baselines read.
        objective: sc.objective ? {
          kind: sc.objective.kind,
          ...(sc.objective.kind === 'hold' ? {
            progress: Math.round(sc.objective.progress * 100) / 100,
            duration: sc.objective.duration,
            held: sc.objective.held, contested: sc.objective.contested,
            x: Math.round(sc.objective.x), y: Math.round(sc.objective.y),
          } : {}),
          ...(sc.objective.kind === 'break' ? {
            guardsTotal: sc.objectiveTargets.length,
            guardsAlive: sc.objectiveTargets.filter(t => !t.dead).length,
          } : {}),
        } : null,
        wavesPending: sc.pendingWaves ? sc.pendingWaves.length : 0,
      };
    }
    if (game.sceneName === 'world' && sc) {
      s.world = {
        hero: { x: sc.hero.x | 0, y: sc.hero.y | 0 },
        // Plan 023: the freeze mechanic's observable surface. `speed` is whole px/s and
        // `time` is 3dp so no float can make two otherwise-identical reads differ. All
        // three are inside the block world-hover.spec.js compares byte-for-byte between a
        // hovered and an un-hovered read, and all three are safe there because they are
        // pointer-independent AND tick-count-independent while the world is frozen.
        // `staleT` is deliberately NOT exposed: it accumulates on every frozen tick, so it
        // is effectively a frame counter and would make state() sensitive to how many
        // frames elapsed between two reads. It stays a presentation value read off
        // __g.scene, alongside grace, spawnT, msgT and particles.
        time: Math.round(sc.time * 1000) / 1000,
        speed: Math.round(sc.heroSpeed),
        flowing: sc.timeFlowing(),
        gold: sc.save.gold, troops: sc.save.troops.length,
        parties: sc.parties.length,
        camps: sc.save.camps,
        settlements: sc.save.settlements,
        // Milestone 025: the regional surface — ownership states, stronghold power
        // and the raid warning are all derivable from the save/parties above, but
        // tests read them through this documented shape instead of re-deriving.
        region: {
          power: STRONGHOLD_POWER_LABELS[strongholdModifiers(sc.save).stateId],
          powerPoints: strongholdModifiers(sc.save).points,
          raidTarget: (sc.parties.find(p => p.raid && p.raidKind === 'regional') || {}).raid || null,
          raidCdT: Math.round(sc.raidCdT),
        },
        // Plan 021: the numbers actually drawn — same convention (bodies, not strength)
        // and same heavy-marker rule (comp includes a brute) as World.drawParty/drawHero.
        badges: {
          hero: sc.save.troops.length + 1,
          parties: sc.parties.map(p => ({ bodies: p.comp.length, heavy: p.comp.includes('brute') })),
        },
        // presentation-only hover model — exactly what drawHoverPanel would draw this frame
        hover: sc.hoverTarget,
        screen: sc.screen,
        // Derived, not the raw internal bookkeeping (which may hold a live party
        // reference) — battleCountAtRequest and whether that party is still on the map.
        pending: sc.pending ? {
          battleCountAtRequest: sc.pending.battleCountAtRequest,
          partyStillPresent: sc.pending.descriptor.party ? sc.parties.includes(sc.pending.descriptor.party) : null,
        } : null,
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
    } else if (name === 'battle_river' || name === 'battle_woods' || name === 'battle_settlement') {
      // Plan 024 Phase 8: brief-derived battle scenarios, pinned to world positions that
      // provably yield the terrain each name promises. Verified at world seed 7, approach
      // 'E', brief seed 12345 (see plans/024-battlefield-rework.md's Phase 8 section):
      //   battle_river      (1150,1000) — 1 river, ford crossing, 7 woods, 2 hills, 2 roads
      //   battle_woods      (300,1500)  — no river, 8 woods, 6 hills, 7 scrub
      //   battle_settlement (985,640)   — 1 river with a real bridge, settlement, 8 woods, 2 roads
      // Unlike battle_small/big/bridge (deliberately briefless template fights), these carry a
      // real setup.field, so they are the only scenarios/baselines that exercise the terrain
      // sampled from the actual campaign map — see AGENTS.md's battlefield section.
      game.testSeed = 7;
      game.startWorld(null);
      const world = game.scene;
      const pos = {
        battle_river: [1150, 1000],
        battle_woods: [300, 1500],
        battle_settlement: [985, 640],
      }[name];
      world.hero.x = pos[0]; world.hero.y = pos[1];
      const approach = 'E', battleSeed = 12345;
      const field = sampleBattlefield(world, approach, battleSeed, FIELD.W, FIELD.H);
      const titles = {
        battle_river: 'RIVER CROSSING',
        battle_woods: 'WOODED HIGHLAND',
        battle_settlement: 'BRIDGE & SETTLEMENT',
      };
      game.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'archer' }, { type: 'archer' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' }, { type: 'raider' }, { type: 'raider' }],
        seed: battleSeed, title: titles[name], biome: world.biomeAt(world.hero.x),
        approach, field,
        onEnd: () => game.startWorld(null),
      });
    }     else if (name === 'battle_hold') {
      // Milestone 025 Slice C fixture: a Hold-the-ground defense, seeded like the
      // legacy battle fixtures so the objective HUD/ground have deterministic frames.
      game.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'archer' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'wolf' }],
        seed: 33, title: 'HOLD THE GROUND', arena: 'road', biome: 'meadow',
        objective: { kind: 'hold', duration: 35, radius: 170 },
        onEnd: () => game.startWorld(null),
      });
    } else if (name === 'battle_break') {
      // Milestone 025 Slice C fixture: Break the position with two guards (a camp).
      game.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'archer' }, { type: 'knight' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'raider' }],
        seed: 44, title: 'BREAK THE POSITION', arena: 'camp', biome: 'night',
        objective: { kind: 'break', guards: 2, hp: 260, radius: 30 },
        onEnd: () => game.startWorld(null),
      });
    } else if (name === 'battle_stronghold') {
      // Milestone 025 Slice E fixture: the authored finale — three guards, one
      // reinforcement wave, Entrenched display data.
      game.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'archer' }, { type: 'archer' }, { type: 'knight' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' }, { type: 'raider' }, { type: 'brute' }],
        seed: 55, title: 'ASSAULT ON WOLFSJAW HOLD', arena: 'camp', biome: 'rose',
        objective: { kind: 'break', guards: 3, hp: 260, radius: 30 },
        waves: [{ at: 25, comp: ['bandit', 'bandit', 'bandit', 'wolf'] }],
        stronghold: {
          label: 'ENTRENCHED',
          advantages: [
            'A reserve wave will reinforce the garrison mid-battle',
            'All three defensive guards still stand',
            'Their deployment is unscouted',
          ],
        },
        onEnd: () => game.startWorld(null),
      });
    } else if (name === 'victory_summary') {
      // Milestone 025 Slice E baseline fixture: a finished campaign with counters
      // and specializations worth showing off.
      const save = {
        gold: 214, hard: false,
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'archer' }, { type: 'archer' }, { type: 'knight' }],
        settlements: WORLD.settlements.map(s => ({ id: s.id, occupied: false, owner: s.id === 'ashford' || s.id === 'coldwell' ? 'player' : 'neutral' })),
        camps: WORLD.camps.map(c => ({ id: c.id, razed: c.id !== 'strong' })),
        stats: { won: 9, kills: 71, lost: 14, playT: 3742, battlesLost: 2, goldEarned: 812, goldSpent: 640, captures: 3 },
        won: true,
      };
      save.settlements.find(s => s.id === 'ashford').spec = 'barracks';
      save.settlements.find(s => s.id === 'coldwell').spec = 'watchtower';
      game.startVictory(save);
    } else if (name === 'world_region') {
      // Milestone 025 baseline fixture: a mid-conquest map. opts: {seed, owned: [ids],
      // spec: {id: spec}, occupied: [ids], razed: [ids]}. An occupied settlement gets
      // its occupier posted at the canonical gate so the seizure has its banner.
      if (opts && opts.seed != null) game.testSeed = opts.seed;
      game.startWorld(null);
      const world = game.scene;
      const o = opts || {};
      for (const id of o.owned || []) {
        const rec = world.save.settlements.find(s => s.id === id);
        rec.owner = 'player';
        if (o.spec && o.spec[id]) rec.spec = o.spec[id];
      }
      world.save.stats.captures = (o.owned || []).length;
      for (const id of o.occupied || []) world.save.settlements.find(s => s.id === id).occupied = true;
      for (const id of o.razed || []) world.save.camps.find(c => c.id === id).razed = true;
      if ((o.occupied || []).length) {
        const at = WORLD.settlements.find(s => s.id === o.occupied[0]);
        world.parties.length = 0;
        world.parties.push({
          camp: 'c1', x: at.x, y: at.y, vx: 0, vy: 0, facing: 0, bob: 0,
          comp: ['bandit', 'bandit', 'raider'],
          home: { x: WORLD.camps[0].x, y: WORLD.camps[0].y },
          wander: null, wanderT: 0, waryT: 0, clashT: 0,
          occupying: o.occupied[0], raid: null,
          navT: 0, navGoal: null, navFor: null,
          _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
        });
        world.persistParties();
      }
    } else if (name === 'world_brief') {
      // Plan 021: opens the brief through the PRODUCTION requestBattle path (a real
      // party clash or a real WORLD_PRIMARY press), never by assigning world.screen
      // directly. `kind` selects which of the real trigger shapes to drive:
      // 'party' (mutual skirmish, no withdraw), 'partyFlee' (caught a fleeing party,
      // withdraw offered), 'ambush' (they caught you, no withdraw), 'campScouted' (an
      // ordinary camp — standing close enough to assault it always auto-scouts it the
      // same tick, so this is simply what a normal camp assault looks like), and
      // 'stronghold' (Wolfsjaw: never auto-scouted by proximity, so its brief shows an
      // unknown garrison unless it happens to have been scouted some other way first —
      // it is the ONE camp decision 6's "unscouted force" case actually applies to).
      if (opts && opts.seed != null) game.testSeed = opts.seed;
      game.startWorld(null);
      const world = game.scene;
      const kind = (opts && opts.kind) || 'party';
      if (kind === 'campScouted' || kind === 'stronghold') {
        const campId = kind === 'stronghold' ? 'strong' : 'c1';
        const camp = WORLD.camps.find(c => c.id === campId);
        if (kind === 'stronghold') for (const c of world.save.camps) c.razed = c.id !== 'strong';
        world.parties.length = 0; // isolate: no incidental party collision on the ride in
        world.hero.x = camp.x; world.hero.y = camp.y;
        world.grace = 0;
        game.input.injectAction(ACTIONS.WORLD_PRIMARY, true);
        game.update(DT);
        game.input.injectAction(ACTIONS.WORLD_PRIMARY, false);
      } else {
        // Away from every settlement's canClash-blocking safe zone (WORLD.heroStart
        // itself sits ~128px from Ashford, just inside the 130px radius).
        world.hero.x = 1600; world.hero.y = 900;
        const mine = world.myStrength();
        const n = kind === 'ambush' ? Math.max(3, Math.ceil(mine * 1.6 / 5))
          : kind === 'partyFlee' ? Math.max(1, Math.round(mine * 0.4))
          : Math.max(1, Math.round(mine));
        const comp = kind === 'ambush' ? Array.from({ length: n }, () => 'brute')
          : Array.from({ length: n }, () => 'bandit');
        world.parties.length = 0;
        world.parties.push({
          camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
          comp, home: { x: WORLD.camps[0].x, y: WORLD.camps[0].y }, wander: null, wanderT: 999,
          waryT: 0, clashT: 0, occupying: null, raid: null,
          navT: 0, navGoal: null, navFor: null,
          _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
        });
        world.grace = 0;
        // Plan 023: the party-clash kinds place a party on a deliberately STATIONARY hero,
        // and a frozen tick runs the encounter seam only — it does not classify initiative.
        // Keep the world awake for this one setup tick (without moving the hero) so `mood`
        // resolves to ambush / run-them-down / mutual exactly as it does mid-ride, which is
        // when a real clash always happens.
        keepAwake(world, true);
        game.update(DT);
        keepAwake(world, false);
      }
    } else if (name === 'world_aftermath') {
      // Drives a real party clash through requestBattle -> confirm -> a real
      // Battle.endBattle() -> the real onEnd path, never by assigning world.screen
      // directly. opts.result selects the outcome: {victory:true} (default),
      // {victory:false} (defeat), {retreated:true}.
      if (opts && opts.seed != null) game.testSeed = opts.seed;
      game.startWorld(null);
      const world = game.scene;
      // Away from every settlement's canClash-blocking safe zone (WORLD.heroStart
      // itself sits ~128px from Ashford, just inside the 130px radius).
      world.hero.x = 1600; world.hero.y = 900;
      world.parties.length = 0;
      world.parties.push({
        camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
        comp: ['bandit', 'bandit'], home: { x: WORLD.camps[0].x, y: WORLD.camps[0].y }, wander: null, wanderT: 999,
        waryT: 0, clashT: 0, occupying: null, raid: null,
        navT: 0, navGoal: null, navFor: null,
        _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
      });
      world.grace = 0;
      // Plan 023: as in world_brief — one awake tick so the parked hero's clash still
      // classifies initiative. Released immediately; the aftermath itself needs no ride.
      keepAwake(world, true);
      game.update(DT); // opens the brief via the real party-clash path
      keepAwake(world, false);
      game.input.injectAction(ACTIONS.CONFIRM, true);
      game.update(DT); // confirms it -> real Battle.startBattle()
      game.input.injectAction(ACTIONS.CONFIRM, false);
      const battle = game.scene;
      const result = (opts && opts.result) || {};
      if (result.retreated) battle.endBattle(false, true);
      else battle.endBattle(result.victory !== false);
      // Flush the real end-banner hold (Battle gates onEnd on stateT > 2.6) so onEnd
      // actually fires and the new World picks up game.pendingAftermath.
      for (let i = 0; i < 200 && game.sceneName === 'battle'; i++) game.update(1 / 60);
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
