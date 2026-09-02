// Bannerfall — boot, state machine, fixed-timestep loop, headless test API.
import { PAL, WORLD, enemyStrength, armySlots, rankOf } from './data.js?v=ra324aad8885b';
import { Input, Camera, makeRng, deriveSeed, RNG_DOMAINS, rrect, mountain } from './engine.js?v=ra324aad8885b';
import { Sfx } from './audio.js?v=ra324aad8885b';
import { Battle } from './battle.js?v=ra324aad8885b';
import { World } from './world.js?v=ra324aad8885b';
import { sampleBattlefield } from './world/battlefield-brief.js?v=ra324aad8885b';
import { FIELD } from './battle/constants.js?v=ra324aad8885b';
import { ACTIONS } from './input-actions.js?v=ra324aad8885b';
import { createWebPlatform } from './platform/web-platform.js?v=ra324aad8885b';
import { SaveRepository } from './persistence/save-repository.js?v=ra324aad8885b';
import { buildSummaryModel } from './world-screens.js?v=ra324aad8885b';
import { strongholdModifiers, STRONGHOLD_POWER_LABELS, REGION } from './region.js?v=ra324aad8885b';
import { perkChoiceDue, perkMods } from './progression.js?v=ra324aad8885b';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Solid haze tone for distant scenery — blending colors and filling opaque avoids the
// seams that globalAlpha leaves where a mountain's overlapping facets double-composite.
// Accepts '#rrggbb' or this function's own 'rgb(r,g,b)' output, so results can chain
// (e.g. blending two already-blended tones) without silently producing NaN -> black.
function colorChannels(c) {
  if (c[0] === '#') {
    const p = parseInt(c.slice(1), 16);
    return [(p >> 16) & 255, (p >> 8) & 255, p & 255];
  }
  return c.match(/\d+/g).map(Number);
}
function mixColor(a, b, t) {
  const [ar, ag, ab] = colorChannels(a), [br, bg, bb] = colorChannels(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

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
    // The boot scene is the menu, but the constructor does not go through enterMenu(), so
    // the opening bed is selected here. Nothing sounds yet: Sfx records the wanted track
    // and only starts it once a gesture has unlocked the AudioContext.
    this.sfx.setTrack('campaign');
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

  // The one place scene-to-music mapping lives. The menu and the campaign map share a bed
  // on purpose: the menu vista IS the campaign's establishing shot, and a cut between two
  // different pieces on every CONTINUE press reads as a mistake rather than a transition.
  // The victory summary drops the bed entirely — its fanfare is the music for that screen.
  setSceneMusic(track) { this.sfx.setTrack(track); }

  enterMenu(panel = 'root') {
    this.setSceneMusic('campaign');
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
    // Every activation ticks; the campaign-start ids additionally blow a horn below, and
    // the two layered is the intended lockup — the click is the button, the horn is the
    // departure.
    this.sfx.uiSelect();
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
        this.sfx.uiMove();
        this.invalidate();
      }
    }

    if (this.input.pressedAction(ACTIONS.MENU_UP)) {
      this.menuIndex = (this.menuIndex + items.length - 1) % items.length;
      this.sfx.uiMove();
      this.invalidate();
    } else if (this.input.pressedAction(ACTIONS.MENU_DOWN)) {
      this.menuIndex = (this.menuIndex + 1) % items.length;
      this.sfx.uiMove();
      this.invalidate();
    } else if (this.input.pressedAction(ACTIONS.MENU_BACK)) {
      this.sfx.uiMove();
      if (this.menuPanel === 'confirm') this.setMenuPanel('new');
      else if (this.menuPanel !== 'root') this.setMenuPanel('root');
    } else if (this.input.pressedAction(ACTIONS.CONFIRM)) {
      this.activateMenuItem(items[this.menuIndex].id);
    } else if (this.input.mouse.clicked && hovered) {
      this.activateMenuItem(hovered.id);
    }
  }

  startWorld(save) {
    this.setSceneMusic('campaign');
    this.scene = new World(this, save);
    this.sceneName = 'world';
    this._lastSave = this.scene.save;
    this.camera.zoom = 1;
    this.camera.x = this.scene.hero.x; this.camera.y = this.scene.hero.y;
    // Plan 023: the map-edge clamp rides on the camera-follow path, which does not run
    // until the hero moves. The hero starts near the western limit, so on a wide display
    // the opening frame centred on him showed out-of-bounds ground west of the map border
    // and then snapped east on the first moving tick. Clamp once at scene entry so the
    // first frame is already the framing the player keeps.
    this.scene.clampCamera();
    this.invalidate();
    this.persistRun();
  }
  startBattle(setup) {
    this.setSceneMusic('battle');
    this.scene = new Battle(this, setup);
    this.sceneName = 'battle';
    this.camera.zoom = 1;
    this.camera.x = this.scene.hero.x; this.camera.y = this.scene.hero.y;
    this.invalidate();
  }
  startVictory(save) {
    this.setSceneMusic(null);
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
      ctx.font = '700 12px Inter, system-ui, sans-serif';
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
    ctx.font = '900 54px Inter, system-ui, sans-serif';
    ctx.fillText('PAUSED', W / 2, H * 0.4);
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    ctx.fillText('ESC / P — resume    ·    M — mute    ·    R — abandon run (menu)', W / 2, H * 0.4 + 54);
    ctx.font = '600 13px Inter, system-ui, sans-serif';
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

  drawMenuDiamond(cx, cy, s, color, tickW = 0) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.restore();
    if (tickW > 0) {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx - s * 1.3, cy); ctx.lineTo(cx - s * 0.8, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + s * 0.8, cy); ctx.lineTo(cx + s * 1.3, cy); ctx.stroke();
    }
  }

  drawMenuCloud(cx, cy, s) {
    const lobes = [[0, 0, s], [s * 0.9, -s * 0.25, s * 0.75], [-s * 0.9, -s * 0.15, s * 0.7], [s * 0.45, -s * 0.6, s * 0.6], [-s * 0.4, -s * 0.55, s * 0.55], [s * 0.15, -s * 0.35, s * 0.5]];
    // Underside shade first, offset down — a two-tone cloud reads as a soft volume
    // instead of a flat cutout.
    ctx.fillStyle = '#E3C79A';
    for (const [ox, oy, r] of lobes) {
      ctx.beginPath(); ctx.arc(cx + ox, cy + oy + s * 0.14, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#FFF6E3';
    for (const [ox, oy, r] of lobes) {
      ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Dark backing behind the menu column so its text keeps contrast regardless of what
  // the sunset gradient underneath is doing at that x position.
  drawMenuVignette(W, H, P, panelRight) {
    const vignette = ctx.createLinearGradient(0, 0, panelRight, 0);
    vignette.addColorStop(0, 'rgba(30,42,74,0.62)');
    vignette.addColorStop(0.75, 'rgba(30,42,74,0.30)');
    vignette.addColorStop(1, 'rgba(30,42,74,0)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, panelRight, H);
  }

  drawMenuScenery(W, H, P, compact) {
    // Sunset gradient: dark navy behind the menu column, warming toward the
    // vista on the right — same three palette tokens as the flat fill before,
    // just read as a spectrum instead of a single stop.
    // Extra intermediate stops: the original 4-stop version crammed nearly the whole
    // navy-to-orange color change into the first third, which reads as a banded step
    // rather than a continuous painted wash even though it's mathematically smooth.
    const sky = ctx.createLinearGradient(0, 0, W, H * 0.55);
    sky.addColorStop(0, P.ink);
    sky.addColorStop(0.18, mixColor(P.ink, P.groundShade, 0.4));
    sky.addColorStop(0.34, P.groundShade);
    sky.addColorStop(0.48, mixColor(P.groundShade, P.ground, 0.5));
    sky.addColorStop(0.62, P.ground);
    sky.addColorStop(1, P.ground);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun: one soft radial glow (not concentric hard-edged rings) sitting fully
    // inside frame — a gradient reads as atmosphere, stacked flat circles read as rings.
    // Shifted left of the castle and tightened — the sun should sit behind the ridge
    // as a light source, not out-glow the castle as the frame's brightest focal point.
    const sunX = W * 0.70, sunY = H * 0.33, sunR = Math.min(H * 0.22, sunY - 4);
    // One continuous gradient, not two overlapping circles — two separate radial fills
    // leave a visible step where the inner disc's edge meets the outer glow's alpha.
    // The solid zone is now half the total radius — enough of it survives the peak's
    // occlusion to still read as an actual circle, not just an unbounded soft blur.
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sun.addColorStop(0, 'rgba(242,227,193,1)');
    sun.addColorStop(0.5, 'rgba(242,227,193,1)');
    sun.addColorStop(0.68, 'rgba(242,227,193,0.5)');
    sun.addColorStop(0.85, 'rgba(242,227,193,0.2)');
    sun.addColorStop(1, 'rgba(242,227,193,0)');
    ctx.fillStyle = sun;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();

    // Richer and darker than the flat P.groundShade token — the near hill needs a real
    // value break from the sky above it, not just the mountain silhouette to carry the
    // horizon read.
    ctx.fillStyle = mixColor(P.groundShade, P.ink, 0.3);
    ctx.beginPath();
    ctx.moveTo(compact ? 0 : W * 0.46, H * 0.76);
    ctx.lineTo(W, H * 0.48); ctx.lineTo(W, H); ctx.lineTo(compact ? 0 : W * 0.35, H); ctx.closePath(); ctx.fill();

    const cloudSpan = W + 240;
    const driftA = (this.menuT * 7) % cloudSpan;
    const driftB = (this.menuT * 4.5) % cloudSpan;
    this.drawMenuCloud((W * 0.58 + driftA) % cloudSpan - 100, H * 0.16, 30);
    this.drawMenuCloud((W * 0.88 + driftB) % cloudSpan - 80, H * 0.08, 42);

    const horizon = H * 0.47;
    // Far ridge: hazy and pale for atmospheric perspective behind the near range. Plain
    // triangles, not the full mountain() rock formation — its separate outcrop facet reads
    // as a detached shard at this size, where real distance would soften it to one shape.
    // Cool grey-blue haze (ink toward cream, not toward the warm ground) so the distant
    // ridge reads as atmospheric distance against the warm mid-range in front of it.
    // Blend toward white, not cream — cream is red-heavy and pulls the far ridge warm,
    // defeating the point of a *cool* haze contrasting the warm near range.
    const hazeInk = mixColor(P.ink, '#FFFFFF', 0.6), hazeCream = mixColor('#FFFFFF', P.ink, 0.05);
    for (const [fx, fs] of [[0.48, 55], [0.58, 82], [0.68, 66], [0.78, 102], [0.93, 62]]) {
      const mx = W * fx, my = horizon - fs * 0.78;
      ctx.fillStyle = hazeInk;
      ctx.beginPath();
      ctx.moveTo(mx - fs, my + fs * 0.4); ctx.lineTo(mx - fs * 0.15, my - fs); ctx.lineTo(mx + fs * 1.05, my + fs * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hazeCream;
      ctx.beginPath();
      ctx.moveTo(mx - fs * 0.15, my - fs); ctx.lineTo(mx - fs * 0.42, my - fs * 0.34); ctx.lineTo(mx + fs * 0.05, my - fs * 0.42);
      ctx.closePath(); ctx.fill();
    }
    // Mid ridge: halfway in both height and hue between the cool far haze and the warm
    // near range — two flat tones jumping straight from blue-grey to brown reads as
    // two posterized layers instead of continuous atmospheric perspective.
    const midHaze = mixColor(hazeInk, mixColor(P.ink, P.groundShade, 0.32), 0.5);
    for (const [fx, fs] of [[0.51, 50], [0.63, 58], [0.86, 68]]) {
      const mx = W * fx, my = horizon - fs * 0.62;
      ctx.fillStyle = midHaze;
      ctx.beginPath();
      ctx.moveTo(mx - fs, my + fs * 0.4); ctx.lineTo(mx - fs * 0.15, my - fs); ctx.lineTo(mx + fs * 1.05, my + fs * 0.42);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = mixColor(midHaze, P.cream, 0.7);
      ctx.beginPath();
      ctx.moveTo(mx - fs * 0.15, my - fs); ctx.lineTo(mx - fs * 0.42, my - fs * 0.34); ctx.lineTo(mx + fs * 0.05, my - fs * 0.42);
      ctx.closePath(); ctx.fill();
    }
    // Near range: a warmer navy-brown blend, distinct from the far ridge's cool haze
    // and from pure P.ink — a third tonal step between distance and foreground.
    const midInk = mixColor(P.ink, P.groundShade, 0.32);
    for (const [fx, fs] of [[0.50, 62], [0.61, 94], [0.72, 68], [0.82, 112], [0.94, 78]]) {
      mountain(ctx, W * fx, horizon - fs * 0.32, fs, midInk, P.cream);
    }

    // Pine silhouettes on the slopes below the mountains — fixed positions (this is
    // presentation-only art, not simulation, so no RNG stream is spent on it).
    // Pine ink leans toward the palette's one green (P.good) instead of pure navy —
    // otherwise the trees are indistinguishable from the mountains and UI at a glance.
    const pineInk = mixColor(P.ink, P.good, 0.13);
    // lean tilts the whole tree a few degrees — identical dead-vertical copies read as
    // mechanically stamped; even a slight lean sells hand placement.
    const drawPine = (px, py, s, lean = 0) => {
      ctx.save();
      ctx.translate(px, py); ctx.rotate(lean); ctx.translate(-px, -py);
      ctx.fillStyle = pineInk;
      ctx.fillRect(px - s * 0.06, py, s * 0.12, s * 0.22);
      // Rim light mixes toward the sun's own gold, not a generic cream lighten — ties
      // the trees back into the one light source everything else answers to.
      const lit = mixColor(pineInk, P.hero, 0.4);
      for (const [w, h, dy] of [[0.55, 0.55, 0], [0.42, 0.5, 0.32], [0.28, 0.42, 0.58]]) {
        ctx.fillStyle = pineInk;
        ctx.beginPath();
        ctx.moveTo(px - s * w * 0.5, py - s * dy);
        ctx.lineTo(px + s * w * 0.5, py - s * dy);
        ctx.lineTo(px, py - s * (dy + h));
        ctx.closePath(); ctx.fill();
        // Lit half (toward the same down-right light every other shape obeys).
        ctx.fillStyle = lit;
        ctx.beginPath();
        ctx.moveTo(px, py - s * dy);
        ctx.lineTo(px + s * w * 0.5, py - s * dy);
        ctx.lineTo(px, py - s * (dy + h));
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    };
    // Loose overlapping clumps, not an evenly spaced planted grid — each entry near an
    // existing tree is a companion at a staggered height/lean, not a lone stamped copy.
    for (const [fx, fy, fs, lean] of [
      [0.40, 0.82, 46, -0.05], [0.435, 0.865, 30, 0.08], [0.48, 0.88, 40, 0.04],
      [0.38, 0.74, 30, 0.06], [0.405, 0.755, 20, -0.07], [0.44, 0.78, 26, 0],
      [0.63, 0.66, 22, -0.04], [0.70, 0.60, 18, 0.05],
      [0.90, 0.68, 24, 0], [0.925, 0.70, 16, 0.09], [0.97, 0.60, 20, -0.03],
    ]) drawPine(W * fx, H * fy, fs, lean);

    // One world-map road carries the eye from the menu toward the objective.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = P.ink; ctx.lineWidth = Math.max(28, W * 0.025);
    ctx.beginPath(); ctx.moveTo(W * 0.55, H * 0.91); ctx.quadraticCurveTo(W * 0.67, H * 0.72, W * 0.75, H * 0.61); ctx.quadraticCurveTo(W * 0.82, H * 0.51, W * 0.85, H * 0.39); ctx.stroke();
    ctx.strokeStyle = P.cream; ctx.lineWidth = Math.max(18, W * 0.015);
    ctx.stroke();
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';

    const pointOnRoad = u => ({
      x: W * (0.55 + u * 0.29),
      y: H * (0.91 - u * 0.50 - Math.sin(u * Math.PI) * 0.035),
    });

    // Wolfsjaw Hold: a tiny, readable destination rather than unrelated key art.
    // Sized to clear the tallest far-ridge peak — the castle should be the tallest
    // silhouette on the skyline, not tied with (or beaten by) the mountains behind it.
    const hx = W * 0.855, hy = H * 0.27, hs = Math.min(W, H) * 0.15;
    // A rock outcrop under the walls — without it the keep looks welded flat onto the
    // mountainside instead of crowning its own promontory. Faceted (shadow plane + a
    // lit plane facing the same down-right light as everything else), and taller/wider
    // than the keep footprint so it reads as ground the castle stands on.
    const rockDark = mixColor(P.ink, P.groundShade, 0.28), rockLit = mixColor(rockDark, P.cream, 0.4);
    ctx.fillStyle = rockDark;
    ctx.beginPath();
    ctx.moveTo(hx - hs * 1.25, hy + hs * 0.95); ctx.lineTo(hx - hs * 0.60, hy + hs * 0.20);
    ctx.lineTo(hx - hs * 0.05, hy + hs * 0.55); ctx.lineTo(hx + hs * 0.55, hy + hs * 0.15);
    ctx.lineTo(hx + hs * 1.35, hy + hs * 0.95); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rockLit;
    ctx.beginPath();
    ctx.moveTo(hx - hs * 0.05, hy + hs * 0.55); ctx.lineTo(hx + hs * 0.55, hy + hs * 0.15);
    ctx.lineTo(hx + hs * 1.35, hy + hs * 0.95); ctx.lineTo(hx + hs * 0.35, hy + hs * 0.95); ctx.closePath(); ctx.fill();
    ctx.fillStyle = P.ink;
    ctx.fillRect(hx - hs * 0.55, hy, hs * 1.1, hs * 0.72);
    ctx.fillRect(hx - hs * 0.72, hy - hs * 0.28, hs * 0.32, hs);
    ctx.fillRect(hx + hs * 0.40, hy - hs * 0.28, hs * 0.32, hs);
    ctx.fillRect(hx - hs * 0.10, hy - hs * 0.45, hs * 0.20, hs * 1.17);
    // Lit wall faces: a translucent strip on the light-facing (right) side of each
    // block — the same down-right light every other menu shape obeys — so the keep
    // reads as a volume instead of one flat silhouette.
    ctx.save(); ctx.globalAlpha = 0.24; ctx.fillStyle = P.cream;
    ctx.fillRect(hx + hs * 0.06, hy, hs * 0.49, hs * 0.72);
    ctx.fillRect(hx - hs * 0.50, hy - hs * 0.28, hs * 0.10, hs);
    ctx.fillRect(hx + hs * 0.62, hy - hs * 0.28, hs * 0.10, hs);
    ctx.fillRect(hx + hs * 0.02, hy - hs * 0.45, hs * 0.08, hs * 1.17);
    ctx.restore();
    // Crenellations: a few teeth along the keep and each flanking tower —
    // the difference between a fortress silhouette and a plain box.
    const crenellate = (x0, x1, y) => {
      const teeth = 4, w = (x1 - x0) / (teeth * 2 - 1);
      for (let i = 0; i < teeth; i++) ctx.fillRect(x0 + i * 2 * w, y - hs * 0.09, w, hs * 0.09);
    };
    crenellate(hx - hs * 0.55, hx + hs * 0.55, hy);
    crenellate(hx - hs * 0.72, hx - hs * 0.40, hy - hs * 0.28);
    crenellate(hx + hs * 0.40, hx + hs * 0.72, hy - hs * 0.28);
    ctx.fillStyle = P.cream;
    ctx.fillRect(hx - hs * 0.62, hy - hs * 0.18, hs * 0.12, hs * 0.34);
    ctx.fillRect(hx + hs * 0.50, hy - hs * 0.18, hs * 0.12, hs * 0.34);
    // Gate glow: a soft falloff around a bright core reads as light spilling from an
    // archway; a flat-filled rectangle would just read as a painted yellow block.
    const gateX = hx, gateY = hy + hs * 0.51, gateGlowR = hs * 0.17;
    const gateGlow = ctx.createRadialGradient(gateX, gateY, 0, gateX, gateY, gateGlowR);
    gateGlow.addColorStop(0, P.hero);
    gateGlow.addColorStop(0.55, 'rgba(255,211,77,0.65)');
    gateGlow.addColorStop(1, 'rgba(255,211,77,0)');
    ctx.fillStyle = gateGlow;
    ctx.beginPath(); ctx.arc(gateX, gateY, gateGlowR, 0, Math.PI * 2); ctx.fill();
    // An arched doorway, not a squared-off box — a rect topped with a semicircle is
    // what actually reads as a gate instead of a lit window.
    ctx.fillStyle = P.hero;
    ctx.fillRect(hx - hs * 0.09, hy + hs * 0.44, hs * 0.18, hs * 0.28);
    ctx.beginPath(); ctx.arc(hx, hy + hs * 0.44, hs * 0.09, Math.PI, 0); ctx.fill();
    const flagWave = Math.sin(this.menuT * 2.2) * hs * 0.05;
    ctx.fillStyle = P.enemy;
    ctx.beginPath(); ctx.moveTo(hx, hy - hs * 0.45); ctx.lineTo(hx + hs * 0.36, hy - hs * 0.34 + flagWave); ctx.lineTo(hx, hy - hs * 0.22); ctx.closePath(); ctx.fill();
    // Third flag on the right tower balances the left one — two flanking flags either
    // side of the center spire instead of one lone tower left bare.
    const flagWave3 = Math.sin(this.menuT * 2.2 + 2.1) * hs * 0.04;
    ctx.beginPath(); ctx.moveTo(hx + hs * 0.56, hy - hs * 0.28); ctx.lineTo(hx + hs * 0.82, hy - hs * 0.20 + flagWave3); ctx.lineTo(hx + hs * 0.56, hy - hs * 0.10); ctx.closePath(); ctx.fill();
    // Second, smaller flag on the left tower — the castle reads as garrisoned, not empty.
    const flagWave2 = Math.sin(this.menuT * 2.2 + 1.1) * hs * 0.04;
    ctx.beginPath(); ctx.moveTo(hx - hs * 0.66, hy - hs * 0.28); ctx.lineTo(hx - hs * 0.40, hy - hs * 0.20 + flagWave2); ctx.lineTo(hx - hs * 0.66, hy - hs * 0.10); ctx.closePath(); ctx.fill();

    // Torches line the road, echoing the lit path up to the hold.
    const roadStart = pointOnRoad(0.05), roadEnd = pointOnRoad(0.95);
    const rdx = roadEnd.x - roadStart.x, rdy = roadEnd.y - roadStart.y;
    const rlen = Math.hypot(rdx, rdy) || 1;
    const normal = { x: -rdy / rlen, y: rdx / rlen };
    for (let i = 0; i < 7; i++) {
      const u = 0.08 + i * 0.13;
      const p = pointOnRoad(u);
      const side = i % 2 === 0 ? 1 : -1;
      const px = p.x + normal.x * 22 * side, py = p.y + normal.y * 22 * side;
      ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 16); ctx.stroke();
      ctx.fillStyle = P.enemy;
      ctx.beginPath(); ctx.moveTo(px, py - 16); ctx.lineTo(px + 7, py - 13); ctx.lineTo(px, py - 10); ctx.closePath(); ctx.fill();
    }

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
        // Tilted, wood-shafted, with a diamond steel head — a dead-vertical shaft plus
        // a symmetric triangle head reads as a UI up-arrow at this scale, not a spear.
        ctx.save();
        ctx.translate(p.x + 3, p.y - 9);
        ctx.rotate(-0.3);
        ctx.fillStyle = mixColor(P.ink, P.groundShade, 0.25);
        ctx.fillRect(-1, -23, 2, 23);
        ctx.fillStyle = P.cream;
        ctx.beginPath();
        ctx.moveTo(0, -29); ctx.lineTo(-2.5, -21.5); ctx.lineTo(0, -24); ctx.lineTo(2.5, -21.5); ctx.closePath(); ctx.fill();
        ctx.restore();
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
    this.drawMenuVignette(W, H, P, layout.panelX + layout.panelW + 60);

    // Compact banner lockup leaves the world vignette and navigation equal room.
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs2 = Math.min(82, W * (layout.compact ? 0.075 : 0.062));
    ctx.font = `900 ${fs2}px Inter, system-ui, sans-serif`;
    const tw2 = ctx.measureText('BANNERFALL').width;
    // Clamp the ribbon's own center so its left notch point stays on-canvas — at
    // layout.centerX alone the point lands at a negative x and gets silently clipped,
    // leaving a flat, asymmetric left edge instead of the intended banner-tail shape.
    const titleCenterX = Math.max(layout.centerX, tw2 / 2 + 25 + 18 + 8);
    const rx = titleCenterX - tw2 / 2 - 25, ry2 = layout.titleY - fs2 * 0.54, rw = tw2 + 50, rh = fs2 * 1.08;
    this.drawMenuDiamond(titleCenterX, ry2 - 14, 6, P.cream, 5);
    ctx.fillStyle = P.enemy;
    ctx.fillRect(rx, ry2, rw, rh);
    ctx.beginPath(); ctx.moveTo(rx, ry2); ctx.lineTo(rx - 18, ry2 + rh / 2); ctx.lineTo(rx, ry2 + rh); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(rx + rw, ry2); ctx.lineTo(rx + rw + 18, ry2 + rh / 2); ctx.lineTo(rx + rw, ry2 + rh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#A32E23';
    ctx.fillRect(rx, ry2 + rh - 6, rw, 6);
    ctx.fillText('BANNERFALL', titleCenterX + 3, layout.titleY + 3);
    ctx.fillStyle = P.ink;
    ctx.fillText('BANNERFALL', titleCenterX, layout.titleY);
    ctx.strokeStyle = P.cream; ctx.lineWidth = 1.25;
    ctx.strokeText('BANNERFALL', titleCenterX, layout.titleY);
    // Subtitle drops to a lighter weight and smaller size — a clearer step down from
    // the bold row labels than the near-equal weight/size it had before.
    ctx.font = `500 ${layout.compact ? 12 : 13}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = P.cream;
    ctx.fillText('Raise a warband. Raze the camps. Take Wolfsjaw Hold.', titleCenterX, layout.titleY + fs2 * 0.88);
    this.drawMenuDiamond(titleCenterX, layout.titleY + fs2 * 0.88 + 18, 6, P.cream, 5);
    const headings = {
      new: ['CHOOSE YOUR CAMPAIGN', 'Difficulty cannot be changed after departure.'],
      confirm: ['REPLACE SAVED CAMPAIGN?', 'Your current campaign will be permanently replaced.'],
      settings: ['SETTINGS', 'WASD ride · mouse aim · LMB swing · Space dash · 1/2/3 orders · TAB squad'],
      credits: ['CREDITS', 'Designed and built for the Bannerfall campaign.'],
    };
    const heading = headings[this.menuPanel];
    if (heading) {
      ctx.fillStyle = P.cream;
      ctx.font = '900 19px Inter, system-ui, sans-serif';
      ctx.fillText(heading[0], layout.centerX, H * 0.335);
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillText(heading[1], layout.centerX, H * 0.372);
      if (this.menuPanel === 'credits') {
        ctx.fillText('Flat-shaded campaign maps, banners, and tiny warbands.', layout.centerX, H * 0.402);
      }
    }

    const items = this.menuItems();
    const pw = layout.panelW, rowH = 42, gap = 8;
    const startY = heading ? layout.panelY : layout.rootY;
    const frameH = items.length * (rowH + gap) - gap;
    // Engraved frame around the whole list, echoing the title's diamond dividers.
    ctx.strokeStyle = P.cream; ctx.lineWidth = 1.5;
    rrect(ctx, layout.panelX - 12, startY - 22, pw + 24, frameH + 44, 10); ctx.stroke();
    this.drawMenuDiamond(layout.centerX, startY - 22, 6, P.cream, 5);
    this.drawMenuDiamond(layout.centerX, startY + frameH + 22, 6, P.cream, 5);
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
      // Marker drawn separately from the label so it can carry its own accent color —
      // the selected arrow reads as the ribbon's red, not just a darker copy of the text.
      ctx.font = '800 15px Inter, system-ui, sans-serif';
      ctx.fillStyle = selected ? P.enemy : mixColor(P.cream, P.ink, 0.35);
      ctx.fillText(selected ? '▸' : '•', x + 18, y + rowH / 2 + 1);
      ctx.fillStyle = selected ? P.ink : P.cream;
      ctx.fillText(item.label, x + 36, y + rowH / 2 + 1);
      if (item.meta) {
        ctx.textAlign = 'right';
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillText(item.meta, x + pw - 16, y + rowH / 2 + 1);
      }
      this.menuHitRegions.push({ id: item.id, x, y, w: pw, h: rowH });
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = P.cream;
    ctx.font = '700 12px Inter, system-ui, sans-serif';
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
    ctx.font = `900 ${Math.min(64, W * 0.06)}px Inter, system-ui, sans-serif`;
    ctx.fillText('WOLFSJAW HAS FALLEN', W / 2, H * 0.14);
    if (this.summary && this.summary.hard) {
      ctx.fillStyle = P.accent;
      ctx.font = '900 18px Inter, system-ui, sans-serif';
      ctx.fillText('— A HARD CAMPAIGN —', W / 2, H * 0.14 + Math.min(52, W * 0.045));
    }

    // Milestone 025 Slice E: the full regional-conquest summary.
    const s = this.summary || buildSummaryModel(this.finalSave || {});
    const mins = Math.floor(s.time / 60), secs = Math.round(s.time % 60);
    const colW = Math.min(760, W - 80);
    const lx = W / 2 - colW / 2 + 30, rx = W / 2 + colW / 2 - 30;
    let y = H * 0.24;
    ctx.textAlign = 'left';
    ctx.font = '800 15px Inter, system-ui, sans-serif';
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
      `Camps razed   ${s.campsRazed}/${REGION.linkedCamps.length}`,
      `Gold earned   ${s.goldEarned}  ·  spent   ${s.goldSpent}`,
      `Treasury   ${s.finalGold}`,
      `Final army   ${s.army}`,
    ];
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    for (let i = 0; i < rowL.length; i++) {
      ctx.textAlign = 'left'; ctx.fillStyle = P.cream;
      ctx.fillText(rowL[i], lx, y + i * 24);
      ctx.textAlign = 'right';
      ctx.fillText(rowR[i], rx, y + i * 24);
    }
    y += rowL.length * 24 + 10;
    if (s.specs.length) {
      ctx.textAlign = 'center';
      ctx.font = '800 14px Inter, system-ui, sans-serif';
      ctx.fillStyle = P.hero;
      ctx.fillText('THE BANNER OF YOUR KINGDOM', W / 2, y);
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = P.cream;
      ctx.fillText(s.specs.join('   ·   '), W / 2, y + 22);
      y += 48;
    } else {
      ctx.textAlign = 'center';
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#9BA3BF';
      ctx.fillText('No settlement flew a specialized banner.', W / 2, y + 8);
      y += 34;
    }
    if (this.victoryT > 1.5 && Math.sin(this.victoryT * 4) > -0.3) {
      ctx.textAlign = 'center';
      ctx.fillStyle = P.hero;
      ctx.font = '800 20px Inter, system-ui, sans-serif';
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
  // bootstrap() has not populated game/platform yet — same guard as frame(), and for
  // the same reason: do nothing to acc/last/lastTick, so the first real tick after
  // bootstrap sees them exactly as frame()'s own Math.min(0.1, ...) clamp expects.
  if (!game || !platform) return;
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
      // enterMenu() touches game.scene/menu state — guard it too, so a failure inside
      // recovery cannot escape this callback the way the un-guarded dereference did.
      try { game.enterMenu(); } catch (err2) {
        console.error('Bannerfall: recovery itself failed in the watchdog loop', err2);
      }
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
        // Plan 029: the persistent progression surface tests read instead of re-deriving.
        // `slots` is the number the army cap is actually budgeted against (a knight is
        // two), which is a different quantity from `troops` above and both are wanted.
        slots: armySlots(sc.save.troops),
        armyCap: sc.save.armyCap,
        perks: (sc.save.perks || []).slice(),
        banner: sc.save.banner || 0,
        veterans: sc.save.troops.map(t => rankOf(t.vet, perkMods(sc.save.perks).rankEarlier)).filter(r => r > 0).length,
        perkChoiceDue: perkChoiceDue(sc.save),
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
      //   battle_river      (1025,940)  — 1 river and its ford inside the gameplay camera
      //   battle_woods      (300,1500)  — no river, 8 woods, 6 hills, 7 scrub
      //   battle_settlement (985,640)   — 1 river with a real bridge, settlement, 8 woods, 2 roads
      // Unlike battle_small/big/bridge (deliberately briefless template fights), these carry a
      // real setup.field, so they are the only scenarios/baselines that exercise the terrain
      // sampled from the actual campaign map — see AGENTS.md's battlefield section.
      game.testSeed = 7;
      game.startWorld(null);
      const world = game.scene;
      const pos = {
        battle_river: [1025, 940],
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
        // Plan 030: WORLD_PRIMARY opens the site menu; the assault row it selects by
        // default is what actually calls requestBattle. Two production presses, exactly
        // what a player does.
        game.input.injectAction(ACTIONS.WORLD_PRIMARY, true);
        game.update(DT);
        game.input.injectAction(ACTIONS.WORLD_PRIMARY, false);
        game.input.injectAction(ACTIONS.CONFIRM, true);
        game.update(DT);
        game.input.injectAction(ACTIONS.CONFIRM, false);
      } else {
        // Away from every settlement's canClash-blocking safe zone (WORLD.heroStart
        // itself sits ~128px from Ashford, just inside the 130px radius).
        world.hero.x = 1600; world.hero.y = 900;
        const mine = world.myStrength();
        // Plan 028: these three fixtures always meant "a party at N times my strength",
        // and they still do — but `mine` is fighting weight now, so the body count is
        // derived by dividing the target weight by one body's worth instead of by the old
        // 5-points-per-brute / 1-point-per-bandit headcount rule.
        const heavy = kind === 'ambush';
        const band = heavy ? 1.6 : kind === 'partyFlee' ? 0.4 : 1.0;
        const per = enemyStrength([heavy ? 'brute' : 'bandit']);
        const n = Math.max(heavy ? 3 : 1, Math.round(mine * band / per));
        const comp = Array.from({ length: n }, () => (heavy ? 'brute' : 'bandit'));
        // Plan 036: initiative now reads whether the hero is closing on the party, not
        // just the party's intent, so a party sitting exactly on top of a stationary
        // hero can no longer produce the mutual case 'party' is documented as. Offset
        // it a few px east — still well inside tryClash's 46px clash radius, so the
        // single setup tick below still clashes — and give the hero a real velocity
        // aimed at it, so the closing check reads a genuine approach exactly like a
        // player riding a chasing party down. 'ambush' and 'partyFlee' stay on a
        // stationary hero on purpose: an ambush must still resolve with zero hero
        // velocity, and a fleeing party's mood is never 'chase', so the closing check
        // never applies to it.
        const riding = kind === 'party';
        world.parties.length = 0;
        world.parties.push({
          camp: 'c1', x: world.hero.x + (riding ? 20 : 0), y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
          comp, home: { x: WORLD.camps[0].x, y: WORLD.camps[0].y }, wander: null, wanderT: 999,
          waryT: 0, clashT: 0, occupying: null, raid: null,
          navT: 0, navGoal: null, navFor: null,
          _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
        });
        world.grace = 0;
        if (riding) { world.hero.vx = 220; world.hero.vy = 0; }
        // Plan 023: the party-clash kinds place a party on a deliberately STATIONARY hero,
        // and a frozen tick runs the encounter seam only — it does not classify initiative.
        // Keep the world awake for this one setup tick (without moving the hero) so `mood`
        // resolves to ambush / run-them-down / mutual exactly as it does mid-ride, which is
        // when a real clash always happens. keepAwake only fakes `heroSpeed` (the
        // timeFlowing() gate) — it never touches hero.vx/vy, so the 'party' kind's
        // closing velocity set above survives it untouched.
        keepAwake(world, true);
        game.update(DT);
        keepAwake(world, false);
      }
    } else if (name === 'world_site') {
      // Plan 030: the site menu, opened through the production WORLD_PRIMARY press at a
      // real landmark. `kind` picks which shape of menu: 'village' (Ashford, claimable),
      // 'town' (Highmere, every service including the banner), 'camp' (a scouted bandit
      // camp), 'stronghold' (Wolfsjaw). Never opened by assigning world.screen.
      if (opts && opts.seed != null) game.testSeed = opts.seed;
      game.startWorld(null);
      const world = game.scene;
      const kind = (opts && opts.kind) || 'village';
      const at = kind === 'town' ? WORLD.settlements.find(x => x.kind === 'town')
        : kind === 'camp' ? WORLD.camps.find(c => c.id === 'c1')
        : kind === 'stronghold' ? WORLD.camps.find(c => c.id === 'strong')
        : WORLD.settlements.find(x => x.id === 'ashford');
      world.parties.length = 0; // isolate: no incidental party collision on the ride in
      world.hero.x = at.x; world.hero.y = at.y;
      world.grace = 0;
      game.input.injectAction(ACTIONS.WORLD_PRIMARY, true);
      game.update(DT);
      game.input.injectAction(ACTIONS.WORLD_PRIMARY, false);
    } else if (name === 'world_choice') {
      // The two permanent-choice modals, opened through their production paths so the
      // visual suite covers them at all. `kind: 'spec'` claims Ashford at its gates (the
      // claim row raises the specialization prompt); `kind: 'perk'` takes the milestone a
      // claim also earns, by committing that specialization first — chooseSpec() re-asks
      // offerPerkChoice() on the tick it closes. Never opened by assigning world.screen.
      if (opts && opts.seed != null) game.testSeed = opts.seed;
      game.startWorld(null);
      const world = game.scene;
      const at = WORLD.settlements.find(x => x.id === 'ashford');
      world.parties.length = 0;
      world.hero.x = at.x; world.hero.y = at.y;
      world.grace = 0;
      const press = (action) => {
        game.input.injectAction(action, true);
        game.update(DT);
        game.input.injectAction(action, false);
      };
      press(ACTIONS.WORLD_PRIMARY); // the site menu
      const claimAt = world.screen.rows.findIndex(r => r.id === 'claim');
      for (let i = 0; i < claimAt; i++) press(ACTIONS.MENU_DOWN);
      press(ACTIONS.CONFIRM); // claim -> the specialization prompt
      if ((opts && opts.kind) === 'perk') {
        // Plan 031: a permanent choice refuses a commit until its arm expires, so this
        // fixture waits it out exactly as a player does. Reaching past the guard here would
        // make the scenario the one caller in the game that does not obey it.
        let guard = 0;
        while (game.scene.screen && game.scene.screen.armT > 0 && guard++ < 120) game.update(DT);
        press(ACTIONS.CONFIRM); // commit it -> the perk prompt
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

// Every canvas font string names Inter first, and the weights the scenes actually draw
// with are 600/700/800/900. They all resolve to the one bundled variable file.
const UI_FONT_WEIGHTS = [600, 700, 800, 900];

// Canvas text does not wait for a webfont the way DOM text does: fillText and measureText
// silently fall back until the face is loaded, and the menu's title ribbon is sized from
// measureText, so a first frame drawn against the fallback is both wrong and a different
// layout. Load the face before that frame. A failure is not fatal — the font strings still
// name system-ui behind Inter, so the game renders with the host's metrics instead.
async function loadUiFonts() {
  if (!document.fonts || typeof document.fonts.load !== 'function') return;
  try {
    await Promise.all(UI_FONT_WEIGHTS.map(weight => document.fonts.load(`${weight} 16px Inter`)));
  } catch (error) {
    console.warn('Bannerfall: bundled font failed to load, falling back to system-ui', error);
  }
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
  // Chromium keeps an AudioContext suspended until the document has been interacted
  // with. The DOM target is chosen here, next to the other window wiring; what happens
  // on the gesture belongs to the audio module.
  game.sfx.attachUnlock(window);
  platform.lifecycle.onSuspend(() => {
    game.input.clear();
    if (game.sceneName === 'world') game.persistRun();
    saves.flush().catch(error => game.reportSaveFailure(error));
  });
  exposeTestApi();
  await loadUiFonts();
  game.draw();
}

bootstrap().catch(error => {
  console.error('Bannerfall failed to initialize', error);
});
