// Battle scene — the Thronefall bar: readable, punchy, simple.
import { PAL, BIOMES, UNIT_TYPES, ENEMY_TYPES, HERO, BALANCE, enemyStrength, playerStrength } from './data.js?v=r415e1b48d7e0';
import { TAU, clamp, lerp, angLerp, dist2, len, makeRng, deriveSeed, RNG_DOMAINS, Particles, shadow, shade, tree, rock, rrect, hpBar, balloon } from './engine.js?v=r415e1b48d7e0';
import { SpatialGrid, stableSortPrefix } from './battle/spatial-index.js?v=r415e1b48d7e0';
import { ACTIONS } from './input-actions.js?v=r415e1b48d7e0';

const BASE = Object.freeze(Object.assign({}, PAL.battle));

// One squad per unit type, in HUD order. Derived from the unit table so a new unit
// type can never exist without a squad to command it.
const SQUAD_TYPES = Object.freeze(Object.keys(UNIT_TYPES));
// Exported so world-screens.js (Plan 021) can label the player's roster on the brief
// screen with the exact same strings instead of duplicating them.
export const SQUAD_LABELS = Object.freeze({ spear: 'SPEARS', archer: 'BOWS', knight: 'HORSE' });

// Stance trade-offs. A braced melee line hits harder against anything closing faster than
// BRACE_SPEED, and a standing bow line shoots tighter than a walking one. See plans/019 for
// measured effects.
//
// BRACE_SPEED only ever catches wolves (158). Bandits are 92, raiders 82 and brutes 55, so
// nothing else in the roster can trigger it: this is a wolf counter, not a general
// anti-charge rule. HOLD does still beat CHARGE against brutes, but through slam avoidance
// and charge exposure rather than bracing. Do not describe it as a brute counter.
const BRACE_SPEED = 120;
const BRACE_BONUS = 1.8;
const BOW_SPREAD = 0.12;
const BOW_SPREAD_BRACED = 0.05;
// Men running at the enemy have their shields down and their formation open. This is what
// CHARGE pays for its speed, and the reason ordering everyone to charge is not free.
const CHARGE_EXPOSURE = 1.35;
// How long shields stay down after a charge order is rescinded.
const CHARGE_RECOVER = 1.1;
// A fight in which nobody has died for this long is not a battle, it is a grind.
const STALL_NO_DEATH = 14;
// What each order costs or buys, per squad kind — shown on the squad's own HUD row so the
// trade-off is legible during the fight. FOLLOW is deliberately absent: it is the neutral
// order and has nothing to advertise.
const STANCE_NOTES = Object.freeze({
  hold: { melee: 'braced', ranged: 'steady aim' },
  charge: { melee: 'shields down', ranged: 'bows down' },
});

function roundedPath(x, y, w, h, r) {
  const p = new Path2D();
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath();
  return p;
}

export class Battle {
  // setup: { troops:[{type}], enemies:[{type}], seed, title, onEnd(result) }
  constructor(game, setup) {
    this.game = game;
    this.setup = setup;
    const battleSeed = setup.seed ?? 1;
    this.simRng = makeRng(deriveSeed(battleSeed, RNG_DOMAINS.BATTLE_SIM));
    this.fxRng = makeRng(deriveSeed(battleSeed, RNG_DOMAINS.BATTLE_FX));
    this.particles = new Particles(() => this.game.effectsEnabled);
    this.W = 1250; this.H = 880;
    this.zoom = 1; this.zoomT = 1;
    // biome palette (rose | meadow | night) — same scene code, different world
    this.biome = setup.biome || 'rose';
    // Every battle owns its palette.  Keeping this object on the instance is important:
    // the menu/world can construct another scene while this one is still alive (and
    // tests intentionally construct two battles side by side).
    this.palette = Object.freeze(Object.assign({}, BASE, BIOMES[this.biome] || {}));
    this.state = 'intro';
    this.stateT = 0;
    this.freeze = 0;               // hit-stop timer
    // Squads are derived from unit type, never assigned: a recruit's role IS his squad,
    // so `save.troops` stays `{type, hp}` and no save-schema version is spent here.
    // `this.command` remains the all-squads aggregate that the QA and input-action
    // contracts assert on; a per-squad order only ever narrows what it describes.
    this.squads = Object.create(null);
    for (const type of SQUAD_TYPES) this.squads[type] = { stance: 'follow', holdX: null, holdY: null };
    this.selectedSquad = null;   // null = the whole warband

    this.command = 'follow';
    this.commandFlash = { text: '', t: 0 };
    this.projectiles = [];
    this.time = 0;
    this._allUnits = [];
    this._alerts = new Array(0);
    this._alertCount = 0;
    this._drawEntries = [];
    this._drawSortScratch = [];
    this._drawEntriesActive = 0;
    this._woundedEntries = [];
    this._woundedSortScratch = [];
    this._woundedEntriesActive = 0;
    this._drawnBars = [];
    this._drawnBarsActive = 0;
    this._groups = Object.create(null);
    this._enemyGroups = Object.create(null);
    // Broad phases use a fixed 128px grid. It is wider than the largest normal
    // melee interaction radius, while still keeping 400-1000 unit fixtures
    // distributed across dozens of buckets.
    this._enemyGrid = new SpatialGrid(this.W, this.H, 128);
    this._friendlyGrid = new SpatialGrid(this.W, this.H, 128);
    this._unitGrid = new SpatialGrid(this.W, this.H, 128);
    this._obstacleGrid = new SpatialGrid(this.W, this.H, 128);
    this._spatialCounters = { targetChecks: 0, separationChecks: 0, obstacleChecks: 0, orderingItems: 0 };
    this._separationSpatialThreshold = 128;

    // the fight keeps your real map orientation: you enter from the way you rode in,
    // enemies are ahead, and retreat means literally riding back the way you came
    this.approach = setup.approach || 'E'; // direction the ENEMY lies, from your approach
    const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
    const [adx, ady] = DIRS[this.approach] || DIRS.E;
    this.adx = adx; this.ady = ady;
    this.retreatDir = { E: 'west', W: 'east', S: 'north', N: 'south' }[this.approach];
    const cx0 = this.W / 2, cy0 = this.H / 2;

    // hero
    const heroMaxHp = Number.isFinite(setup.heroMaxHp) && setup.heroMaxHp > 0 ? setup.heroMaxHp : HERO.hp;
    const heroHp = Number.isFinite(setup.heroHp) ? Math.min(heroMaxHp, Math.max(0, setup.heroHp)) : heroMaxHp;
    this.hero = {
      x: cx0 - adx * this.W * 0.24, y: cy0 - ady * this.H * 0.26, vx: 0, vy: 0, facing: 0,
      hp: heroHp, maxHp: heroMaxHp,
      swingT: 0, dashT: 0, dashCdT: 0, hurtT: 0, bob: 0, iframesT: 0,
      // last heading actually travelled - drives formation, unlike `facing` which follows aim
      travelFacing: 0,
    };

    // terrain: arena template (road | camp | village) + scattered props
    this.arena = setup.arena || 'road';
    this.obstacles = [];
    this.props = [];   // non-colliding dressing drawn under units
    const simRng = this.simRng, fxRng = this.fxRng;
    for (let i = 0; i < 16; i++) {
      this.obstacles.push({ kind: simRng() < 0.45 ? 'rock' : 'tree', x: 140 + simRng() * (this.W - 280), y: 120 + simRng() * (this.H - 240), r: 24 + simRng() * 16, rot: fxRng() * TAU });
    }
    if (this.arena === 'camp') {
      for (const [ox, oy, s] of [[0.72, 0.32, 30], [0.86, 0.5, 34], [0.74, 0.68, 28]]) {
        this.props.push({ kind: 'tent', x: this.W * ox, y: this.H * oy, s });
        this.obstacles.push({ kind: 'none', x: this.W * ox, y: this.H * oy, r: s * 0.9 });
      }
      this.props.push({ kind: 'fire', x: this.W * 0.78, y: this.H * 0.5, s: 10 });
      for (let i = 0; i < 6; i++) this.props.push({ kind: 'stake', x: this.W * 0.62, y: this.H * (0.2 + i * 0.12), s: 10 });
      // palisade run behind the tents — jittered per-instance so it reads hand-placed, not tiled
      for (let i = 0; i < 7; i++) {
        this.props.push({ kind: 'plank', x: this.W * 0.94 + (fxRng() - 0.5) * 26, y: this.H * (0.22 + i * 0.095) + (fxRng() - 0.5) * 18, s: 11 + fxRng() * 5 });
      }
    } else if (this.arena === 'village') {
      for (const [ox, oy, w, hh] of [[0.2, 0.24, 56, 40], [0.34, 0.15, 46, 34], [0.14, 0.5, 50, 36]]) {
        this.props.push({ kind: 'house', x: this.W * ox, y: this.H * oy, w, h: hh });
        this.obstacles.push({ kind: 'none', x: this.W * ox, y: this.H * oy - 10, r: w * 0.6 });
      }
      this.props.push({ kind: 'mill', x: this.W * 0.12, y: this.H * 0.78, s: 30 });
    } else if (this.arena === 'bridge') {
      // a river cuts the arena in two; the bridge is the only crossing — chokepoint fight
      this.props.push({ kind: 'river' });
      const bx = this.W * 0.52, by = this.H * 0.5;
      this.bridge = { x: bx, y: by, w: 120, h: 96 };
      for (let y = -40; y < this.H + 40; y += 44) {
        if (Math.abs(y - by) < this.bridge.h / 2 + 20) continue; // gap at the bridge
        this.obstacles.push({ kind: 'none', x: bx, y, r: 42 });
      }
    } else {
      // road: a cream dashed track through the middle
      this.props.push({ kind: 'road' });
      this.props.push({ kind: 'stone', x: this.W * 0.42, y: this.H * 0.44, s: 8 });
      this.props.push({ kind: 'stone', x: this.W * 0.6, y: this.H * 0.62, s: 7 });
      // roadside landmarks: a fence run and marker stones — travelers pass through here
      for (let i = 0; i < 5; i++) this.props.push({ kind: 'plank', x: this.W * (0.30 + i * 0.045), y: this.H * 0.30, s: 9 });
      this.props.push({ kind: 'stone', x: this.W * 0.25, y: this.H * 0.52, s: 10 });
    }
    // ground interest everywhere: grass tufts + pebble scatters so no region reads as a
    // flat colored rectangle (the critics' "battle void") — non-colliding, drawn under units
    for (let i = 0; i < 26; i++) {
      this.props.push({ kind: 'tuft', x: 60 + fxRng() * (this.W - 120), y: 60 + fxRng() * (this.H - 120), s: 5 + fxRng() * 4, rot: fxRng() * 0.8 - 0.4 });
    }
    for (let i = 0; i < 10; i++) {
      this.props.push({ kind: 'pebbles', x: 80 + fxRng() * (this.W - 160), y: 80 + fxRng() * (this.H - 160), s: 3 + fxRng() * 3, rot: fxRng() * TAU });
    }
    // keep spawn areas clear
    this.obstacles = this.obstacles.filter(o =>
      o.kind === 'none' ||
      (dist2(o.x, o.y, this.hero.x, this.hero.y) > 180 * 180 &&
       dist2(o.x, o.y, this.W / 2 + adx * this.W * 0.25, this.H / 2 + ady * this.H * 0.27) > 220 * 220));
    this.blotches = [];
    for (let i = 0; i < 22; i++) {
      const pts = [];
      const cx = fxRng() * this.W, cy = fxRng() * this.H, s = 16 + fxRng() * 42;
      const n = 5 + (fxRng() * 3 | 0);
      for (let j = 0; j < n; j++) {
        const a = j / n * TAU;
        pts.push([cx + Math.cos(a) * s * (0.6 + fxRng() * 0.6), cy + Math.sin(a) * s * (0.4 + fxRng() * 0.45)]);
      }
      this.blotches.push(pts);
    }
    // large second-tone terrain regions: the ground is a place, not a colored rectangle
    this.regions = [];
    for (let i = 0; i < 4; i++) {
      const pts = [];
      const cx = fxRng() * this.W, cy = fxRng() * this.H, s = 160 + fxRng() * 200;
      const n = 7 + (fxRng() * 3 | 0);
      for (let j = 0; j < n; j++) {
        const a = j / n * TAU;
        pts.push([cx + Math.cos(a) * s * (0.55 + fxRng() * 0.5), cy + Math.sin(a) * s * (0.4 + fxRng() * 0.4)]);
      }
      this.regions.push(pts);
    }
    this._staticPaths = {
      blotches: new Path2D(), regions: new Path2D(), light: new Path2D(), shadeNear: new Path2D(), shadeFar: new Path2D(),
      islandInk: roundedPath(-46, -34, this.W + 92, this.H + 92, 60),
      islandGround: roundedPath(-30, -30, this.W + 60, this.H + 60, 46),
      islandBorder: roundedPath(4, 4, this.W - 8, this.H - 8, 34),
    };
    for (const list of [this.blotches, this.regions]) {
      const path = list === this.blotches ? this._staticPaths.blotches : this._staticPaths.regions;
      for (const b of list) {
        path.moveTo(b[0][0], b[0][1]);
        for (const pt of b) path.lineTo(pt[0], pt[1]);
        path.closePath();
      }
    }
    const light = this._staticPaths.light, shadeNear = this._staticPaths.shadeNear, shadeFar = this._staticPaths.shadeFar;
    light.moveTo(this.W * 0.05, -30); light.lineTo(this.W * 0.55, -30); light.lineTo(this.W * 0.95, this.H + 30); light.lineTo(this.W * 0.45, this.H + 30); light.closePath();
    shadeNear.moveTo(this.W + 30, -30); shadeNear.lineTo(this.W - 340, -30); shadeNear.lineTo(this.W + 30, 300); shadeNear.closePath();
    shadeNear.moveTo(-30, this.H + 30); shadeNear.lineTo(340, this.H + 30); shadeNear.lineTo(-30, this.H - 300); shadeNear.closePath();
    shadeFar.moveTo(this.W + 30, -30); shadeFar.lineTo(this.W - 500, -30); shadeFar.lineTo(this.W + 30, 440); shadeFar.closePath();
    shadeFar.moveTo(-30, this.H + 30); shadeFar.lineTo(500, this.H + 30); shadeFar.lineTo(-30, this.H - 440); shadeFar.closePath();

    // Props which never animate are rendered once into a bounded arena-sized layer.
    // Fire, mill motion, and bridge water remain on the dynamic pass below.
    this._staticLayer = document.createElement('canvas');
    this._staticLayer.width = this.W + 128; this._staticLayer.height = this.H + 128;
    const staticCtx = this._staticLayer.getContext('2d');
    staticCtx.translate(64, 64);
    this.drawProps(staticCtx, false);

    // troops
    this.troops = [];
    (setup.troops || []).forEach((t, i) => this.spawnTroop(t.type, t.hp));
    // enemies spawn AHEAD along your approach; ambushes pincer from ahead and behind
    this.enemies = [];
    const ecx = this.W / 2 + this.adx * this.W * 0.25, ecy = this.H / 2 + this.ady * this.H * 0.27;
    const bcx = this.W / 2 - this.adx * this.W * 0.42, bcy = this.H / 2 - this.ady * this.H * 0.40; // behind you
    (setup.enemies || []).forEach((e, i) => {
      const a = (i / Math.max(1, setup.enemies.length)) * TAU;
      let cx = ecx, cy = ecy;
      if (setup.ambush && i % 2 === 1) { cx = bcx; cy = bcy; }
      this.spawnEnemy(e.type,
        clamp(cx + Math.cos(a) * (60 + this.simRng() * 120), 50, this.W - 50),
        clamp(cy + Math.sin(a) * (50 + this.simRng() * 100), 50, this.H - 50));
    });
    this.totalEnemies = this.enemies.length;
    this.startTroops = this.troops.length;
    // strengths on the same scale the map uses (world.js's strength()/myStrength()) — for the defeat diagnosis
    this.enemyStrength = enemyStrength(setup.enemies);
    this.playerStrength = playerStrength(setup.troops);
    this.kills = 0;
    this.deadEnemyTypes = [];   // exactly which enemy types died — not just how many
    this.lastAction = 0;      // sim time of the last hit dealt or taken
    this.lastDeath = 0;       // sim time anyone last actually died
    this.bloodlust = false;   // stalemate breaker: survivors stop kiting and close in
    // deploy window scales with WHO holds the initiative:
    // mutual field battle = 8s (both sides form up), you storming them = 4s scramble,
    // you running down a fleeing party = 0 (you caught them), their ambush = 0 (they caught you).
    this.deployT = setup.ambush ? 0 : (setup.deploy != null ? setup.deploy : 8);
    this.deployMax = this.deployT || 1; // the HUD bar divides by this, not a hardcoded window length
    this.assignSlots();
  }

  spawnTroop(type, hp) {
    const d = UNIT_TYPES[type];
    this.troops.push({
      type, team: 'friendly', d, x: this.hero.x - 60 - this.simRng() * 80, y: this.hero.y + (this.simRng() - 0.5) * 160,
      vx: 0, vy: 0, hp: hp != null ? hp : d.hp, maxHp: d.hp, cd: this.simRng() * d.cooldown,
      facing: 0, slot: null, target: null, lunge: 0, bob: this.fxRng() * TAU, holdX: null, holdY: null, flash: 0,
      exposedT: 0,
    });
  }
  spawnEnemy(type, x, y) {
    const d = ENEMY_TYPES[type];
    this.enemies.push({
      type, team: 'enemy', d, x, y, vx: 0, vy: 0, hp: d.hp, maxHp: d.hp,
      cd: 0.5 + this.simRng() * d.cooldown, windupT: 0, facing: Math.PI,
      target: null, lunge: 0, bob: this.fxRng() * TAU, flash: 0, slamT: 0,
    });
  }

  // Formation slots behind the hero: melee front rows, archers behind.
  assignSlots() {
    const melee = this.troops.filter(t => !t.d.ranged);
    const ranged = this.troops.filter(t => t.d.ranged);
    const place = (arr, startRow) => {
      arr.forEach((t, i) => {
        const row = startRow + Math.floor(i / 5);
        const col = i % 5, rowCount = Math.min(5, arr.length - Math.floor(i / 5) * 5);
        t.slot = { row, col, rowCount };
      });
    };
    place(melee, 1);
    place(ranged, 1 + Math.ceil(melee.length / 5));
    // one pennant-bearer per squad type
    const seen = {};
    for (const t of this.troops) { t.leader = !seen[t.type]; seen[t.type] = true; }
  }
  slotPos(t) {
    const h = this.hero;
    const back = Math.atan2(-h.vy, -h.vx);
    // Formation hangs off the direction the commander is TRAVELLING, never where he is
    // aiming. Aim comes from the cursor through `Camera.toWorld`, whose origin is the
    // fit-to-action camera - which is positioned from the viewport. Reading `h.facing`
    // here made formation, and so fight outcomes, depend on window size: the same seed
    // and stance measured 41.2s/1 lost at 1280x720 and 28.4s/0 lost at 1600x900.
    // Presentation must not reach the simulation. `travelFacing` holds the last real
    // heading, so an idle commander keeps the line he rode in with.
    const a = (len(h.vx, h.vy) > 30) ? back : h.travelFacing + Math.PI;
    const s = t.slot;
    const behind = 40 + s.row * 30;
    const side = (s.col - (s.rowCount - 1) / 2) * 30;
    const px = h.x + Math.cos(a) * behind + Math.cos(a + Math.PI / 2) * side;
    const py = h.y + Math.sin(a) * behind + Math.sin(a + Math.PI / 2) * side;
    return { x: px, y: py };
  }

  // The order every squad is currently under, or 'mixed' when they diverge. This is
  // what `this.command` reports, so a caller reading it always sees the whole warband.
  aggregateStance() {
    let seen = null;
    // Manned squads only. Counting empty ones left `command` stuck on 'mixed' for the rest
    // of a fight once a squad was wiped, which also silently disabled the hold banner.
    const manned = this.mannedSquads();
    for (const type of (manned.length ? manned : SQUAD_TYPES)) {
      const stance = this.squads[type].stance;
      if (seen === null) seen = stance;
      else if (seen !== stance) return 'mixed';
    }
    return seen || 'follow';
  }

  squadStance(t) {
    // never fall back to `command`: it can read 'mixed', which is not a stance
    const squad = this.squads[t.type];
    return squad ? squad.stance : 'follow';
  }

  issueCommand(cmd, squadType = null) {
    const P = this.palette;
    // An order aimed at a squad with nobody left in it is a misfire, not a command. It used
    // to set a stance on zero troops while still flashing HOLD and sounding the horn, so the
    // player believed they had commanded an army they no longer had.
    if (squadType && !this.troops.some(t => t.type === squadType)) return;
    const targets = squadType ? [squadType] : this.mannedSquads();
    if (!targets.length) return;
    // Re-issuing the same order is a no-op except for HOLD, which re-anchors the line.
    if (cmd !== 'hold' && targets.every(type => this.squads[type].stance === cmd)) return;
    for (const type of targets) this.squads[type].stance = cmd;
    this.command = this.aggregateStance();
    const sfx = this.game.sfx;
    if (cmd === 'charge') { sfx.horn(196); this.commandFlash = { text: 'CHARGE!', t: 0.9 }; }
    if (cmd === 'follow') { sfx.horn(262); this.commandFlash = { text: 'TO ME!', t: 0.9 }; }
    if (cmd === 'hold') {
      sfx.horn(220); this.commandFlash = { text: 'HOLD!', t: 0.9 };
      for (const t of this.troops) {
        if (squadType && t.type !== squadType) continue;
        t.holdX = t.x; t.holdY = t.y;
      }
      // Each squad anchors its own banner where the commander stood when it was ordered.
      for (const type of targets) { this.squads[type].holdX = this.hero.x; this.squads[type].holdY = this.hero.y; }
    }
    for (const t of this.troops) {
      if (squadType && t.type !== squadType) continue;
      this.particles.ring(t.x, t.y, 16, P.cream, 0.3, 2);
    }
  }

  nearestEnemy(x, y, maxR = 1e9) {
    return this.nearestFromGrid(this._enemyGrid, x, y, maxR);
  }
  nearestFriendly(x, y) {
    const heroDistance = dist2(x, y, this.hero.x, this.hero.y);
    const troop = this._friendlyGrid.nearest(
      x, y, 1e9, null, this.hero, heroDistance, -1);
    return troop === this.hero ? { obj: this.hero, isHero: true } : { obj: troop, isHero: false };
  }
  nearestFriendlyRanged(x, y, maxR = 1e9) {
    return this.nearestFromGrid(this._friendlyGrid, x, y, maxR, t => t.d.ranged);
  }
  nearestFromGrid(grid, x, y, maxR, predicate = null) {
    return grid.nearest(x, y, maxR, predicate);
  }

  damageEnemy(e, dmg, kx, ky, source) {
    const P = this.palette;
    this.lastAction = this.time;
    e.hp -= dmg;
    e.flash = 0.12;
    e.vx += kx; e.vy += ky;
    // impact must be VISIBLE in a still frame: more sparks, longer-lived, plus debris
    this.particles.spark(e.x, e.y - 10, P.cream, 6, this.fxRng);
    this.particles.dust(e.x - kx * 0.03, e.y + 4, '#B4A08C', 2, this.fxRng); // fixed tan: survives night tint
    this.game.sfx.hit();
    if (e.hp <= 0) {
      this.kills++;
      this.deadEnemyTypes.push(e.type);
      const idx = this.enemies.indexOf(e);
      if (idx >= 0) {
        this.enemies.splice(idx, 1);
        this._enemyGrid.rebuild(this.enemies);
      }
      this.lastDeath = this.time;
      this.particles.shards(e.x, e.y, e.type === 'brute' ? P.enemyDark : P.enemy, e.type === 'brute' ? 16 : 10, this.fxRng);
      this.particles.dust(e.x, e.y, P.groundShade, 5, this.fxRng);
      this.particles.ring(e.x, e.y, e.type === 'brute' ? 44 : 30, '#FFFFFF', 0.3, 4);
      this.game.sfx.kill();
      if (source === 'hero') this.freeze = Math.max(this.freeze, 0.09);
      this.game.camera.shake(source === 'hero' ? 6 : 4, 0.18);
    }
  }
  damageFriendly(f, isHero, dmg, from) {
    const P = this.palette;
    this.lastAction = this.time;
    if (isHero && f.iframesT > 0) {
      this.particles.text(f.x, f.y - 40, 'MISS', P.cream, 13);
      return;
    }
    // A charging squad is running with shields down: the speed is paid for in blood.
    // Hero damage is deliberately untouched - the hero has no stance. Exposure lingers for
    // CHARGE_RECOVER seconds after the order changes, because reading the live stance let a
    // player tap HOLD for one tick mid-swing and take a charge's speed for none of its cost
    // (measured strictly better on both time and losses).
    if (!isHero && (this.squadStance(f) === 'charge' || (f.exposedT || 0) > 0)) dmg *= CHARGE_EXPOSURE;
    f.hp -= dmg;
    if (isHero) {
      f.hurtT = 0.25;
      this.game.sfx.hurt();
      this.game.camera.shake(7, 0.3);
      this.particles.spark(f.x, f.y - 12, P.enemy, 5, this.fxRng);
      // shoved out of the scrum — being surrounded is escapable, standing still is a choice
      if (from) {
        const a = Math.atan2(f.y - from.y, f.x - from.x);
        f.vx += Math.cos(a) * 240; f.vy += Math.sin(a) * 240;
      }
      if (f.hp <= 0) {
        // death clarity: name the killer on the defeat banner
        this.killedBy = from && from.type
          ? (from.type === 'brute' ? "a brute's slam" : from.type === 'wolf' ? 'wolf fangs' : from.type === 'raider' ? "a raider's arrow" : 'bandit blades')
          : from ? 'an arrow' : 'his wounds';
        this.endBattle(false);
      }
    } else {
      f.flash = 0.12;
      this.particles.spark(f.x, f.y - 10, P.enemy, 5, this.fxRng);
      this.particles.dust(f.x, f.y + 4, P.groundShade, 2, this.fxRng);
      if (f.hp <= 0) {
        const idx = this.troops.indexOf(f);
        if (idx >= 0) {
          this.troops.splice(idx, 1);
          this._friendlyGrid.rebuild(this.troops);
        }
        this.lastDeath = this.time;
        // losing the last man of the selected squad hands command back to the whole warband
        if (this.selectedSquad && !this.troops.some(t => t.type === this.selectedSquad)) {
          this.selectedSquad = null;
        }
        this.particles.shards(f.x, f.y, P.friend, 7, this.fxRng);
        this.particles.ring(f.x, f.y, 18, P.friend, 0.3, 2);
        this.game.sfx.kill();
        this.assignSlots();
      }
    }
  }

  fireArrow(sx, sy, tx, ty, friendly, dmg, speed, srcType, spread = BOW_SPREAD) {
    const d = Math.max(1, len(tx - sx, ty - sy));
    // slight inaccuracy
    const off = (this.simRng() - 0.5) * d * spread;
    const a = Math.atan2(ty - sy, tx - sx) + Math.PI / 2;
    tx += Math.cos(a) * off; ty += Math.sin(a) * off;
    this.projectiles.push({ sx, sy, tx, ty, t: 0, T: d / speed, friendly, dmg, srcType });
    this.game.sfx.bow();
  }

  endBattle(victory, retreated) {
    if (this.state === 'end') return;
    this.state = 'end';
    this.stateT = 0;
    this.victory = victory;
    this.retreated = !!retreated;
    if (victory) {
      this.loot = BALANCE.lootBase + this.totalEnemies * BALANCE.lootPerEnemy;
      this.game.sfx.victory();
    } else if (retreated) {
      this.game.sfx.horn(131);
    } else {
      this.game.sfx.defeat();
      this.game.camera.shake(10, 0.5);
    }
  }

  update(dt) {
    this.stateT += dt;
    if (this.updateSceneState(dt)) return;
    if (this.freeze > 0) { this.freeze -= dt; return; }
    this.updateActivePhases(dt);
  }

  updateSceneState(dt) {
    if (this.state === 'intro') {
      // Orders land during the intro banner. They used to be swallowed for ~1.1s - exactly
      // while the banner tells the player to position their men.
      this.updateCommandPhase(this.game.input);
      // Plan 021 step 5: a fight reached through the pre-battle brief already showed
      // both rosters and the N vs M total once — shorten the intro so the beat isn't
      // stated a third time (brief -> this banner -> the deploy countdown detail line).
      // Keyed strictly off setup.brief so scenario('battle_*') (never brief-routed) is
      // provably untouched.
      const introDur = this.setup.brief ? 0.6 : 1.1;
      if (this.stateT > introDur || (this.stateT > 0.6 && this.game.input.pressed.size > 0)) { this.state = 'fight'; this.game.sfx.horn(175); }
      this.updateCamera(dt);
      this.particles.update(dt);
      return true;
    }
    if (this.state === 'end') {
      this.particles.update(dt);
      this.updateCamera(dt);
      if (this.stateT > 2.6 && !this.onEndFired) {
        this.onEndFired = true; // onEnd must fire exactly once — this branch re-enters every frame
        const result = {
          victory: this.victory, retreated: this.retreated, loot: this.loot || 0, kills: this.kills,
          heroHp: Math.max(1, this.hero.hp),
          lost: this.startTroops - this.troops.length,
          survivors: this.troops.map(t => ({ type: t.type, hp: t.hp })),
          deadTypes: this.deadEnemyTypes.slice(),
        };
        this.setup.onEnd && this.setup.onEnd(result);
      }
      return true;
    }
    return false;
  }

  updateActivePhases(dt) {
    this.time += dt;
    const inp = this.game.input, h = this.hero;
    this._spatialCounters.targetChecks = 0;
    this._spatialCounters.separationChecks = 0;
    this._spatialCounters.obstacleChecks = 0;
    this._spatialCounters.orderingItems = 0;
    this._enemyGrid.clearStats(); this._friendlyGrid.clearStats();
    this._unitGrid.clearStats(); this._obstacleGrid.clearStats();

    this.updateCommandPhase(inp);
    const ax = inp.axis();
    this.updateHeroPhase(dt, inp, h, ax);
    this._enemyGrid.rebuild(this.enemies);
    this.updateTroopPhase(dt, h);
    this._friendlyGrid.rebuild(this.troops);
    this.updateEnemyPhase(dt, h);
    // Enemy movement is complete; projectile landing and later diagnostics
    // must see the current positions rather than the beginning-of-phase grid.
    this._enemyGrid.rebuild(this.enemies);
    this.updateSeparationPhase(h);
    // Separation can move enemies across cell boundaries. Projectile landings
    // must query the post-separation positions, not the pre-push buckets.
    this._enemyGrid.rebuild(this.enemies);
    this.updateProjectilePhase(dt, h);
    this.updateStalematePhase();
    this.resolveBattleResult(dt, h, ax);
    this.updatePresentationPhase(dt);
  }

  getSpatialStats() {
    return {
      targetChecks: this._enemyGrid.stats.candidateChecks + this._friendlyGrid.stats.candidateChecks,
      targetCells: this._enemyGrid.stats.cellVisits + this._friendlyGrid.stats.cellVisits,
      separationChecks: this._unitGrid.stats.candidateChecks,
      separationPairs: this._unitGrid.stats.pairs,
      obstacleChecks: this._obstacleGrid.stats.candidateChecks,
      orderingItems: this._spatialCounters.orderingItems,
      rebuilds: this._enemyGrid.stats.rebuilds + this._friendlyGrid.stats.rebuilds + this._unitGrid.stats.rebuilds + this._obstacleGrid.stats.rebuilds,
    };
  }

  updateHeroPhase(dt, inp, h, ax) {
    const P = this.palette;
    const sfx = this.game.sfx;
    // ---- hero movement
    const dashing = h.dashT > 0;
    if (!dashing) {
      h.vx += ax.x * HERO.accel * dt;
      h.vy += ax.y * HERO.accel * dt;
      const sp = len(h.vx, h.vy), max = HERO.speed;
      if (sp > max) { h.vx *= max / sp; h.vy *= max / sp; }
      if (!ax.any) { h.vx *= Math.max(0, 1 - HERO.friction * dt); h.vy *= Math.max(0, 1 - HERO.friction * dt); }
    } else {
      h.dashT -= dt;
      // trample — snapshot the list: damageEnemy() splices this.enemies on a kill, and
      // iterating the live array would skip whichever enemy slides into the vacated index
      for (const e of [...this.enemies]) {
        if (dist2(h.x, h.y, e.x, e.y) < 30 * 30 && !e._trampled) {
          e._trampled = true;
          this.damageEnemy(e, HERO.dashDmg, h.vx * 0.4 * dt * 60, h.vy * 0.4 * dt * 60, 'hero');
        }
      }
      this.particles.dust(h.x, h.y + 6, P.cream, 2, this.fxRng);
    }
    h.x += h.vx * dt; h.y += h.vy * dt;
    h.x = clamp(h.x, 40, this.W - 40); h.y = clamp(h.y, 40, this.H - 40);
    const mw = this.game.camera.toWorld(inp.mouse.x, inp.mouse.y);
    const moving = len(h.vx, h.vy) > 40;
    const aimA = Math.atan2(mw.y - h.y, mw.x - h.x);
    h.facing = angLerp(h.facing, moving ? Math.atan2(h.vy, h.vx) : aimA, 1 - Math.exp(-10 * dt));
    if (moving) h.travelFacing = angLerp(h.travelFacing, Math.atan2(h.vy, h.vx), 1 - Math.exp(-10 * dt));
    if (moving) { h.bob += dt * 11; sfx.gallop(); if (this.fxRng() < dt * 14) this.particles.dust(h.x - h.vx * 0.04, h.y + 8 - h.vy * 0.04, P.cream, 1, this.fxRng); }
    if (h.hurtT > 0) h.hurtT -= dt;
    if (h.iframesT > 0) h.iframesT -= dt;

    // ---- hero attack
    if (h.swingT > 0) h.swingT -= dt;
    if ((inp.mouse.clicked || inp.pressedAction(ACTIONS.ATTACK)) && h.swingT <= 0) {
      if (this.deployT > 0) { this.deployT = 0; this.commandFlash = { text: 'FIRST BLOOD!', t: 0.9 }; this.game.sfx.horn(155); }
      h.swingT = HERO.swingCd;
      sfx.swing();
      this.particles.slash(h.x, h.y - 6, aimA, HERO.swingRange, HERO.swingArc, P.cream);
      // small lunge
      h.vx += Math.cos(aimA) * 90; h.vy += Math.sin(aimA) * 90;
      // collect targets in the arc, hit only the nearest few — the hero is a knight, not a lawnmower
      const inArc = [];
      for (const e of this.enemies) {
        const d = Math.sqrt(dist2(h.x, h.y, e.x, e.y));
        if (d < HERO.swingRange + e.d.radius) {
          let da = Math.atan2(e.y - h.y, e.x - h.x) - aimA;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) < HERO.swingArc / 2 + 0.25) inArc.push([d, e]);
        }
      }
      inArc.sort((a, b) => a[0] - b[0]);
      const targets = inArc.slice(0, HERO.swingMaxTargets);
      for (const [, e] of targets) {
        this.damageEnemy(e, HERO.swingDmg, Math.cos(aimA) * 60, Math.sin(aimA) * 60, 'hero');
        e.vx += Math.cos(aimA) * 160; e.vy += Math.sin(aimA) * 160;
      }
      if (targets.length > 0) { this.freeze = Math.max(this.freeze, 0.045); this.game.camera.shake(2.5, 0.12); }
    }

    // ---- hero dash
    if (h.dashCdT > 0) h.dashCdT -= dt;
    if (inp.pressedAction(ACTIONS.DASH) && h.dashCdT <= 0) {
      h.dashT = HERO.dashTime; h.dashCdT = HERO.dashCd; h.iframesT = HERO.iframeTime;
      for (const e of this.enemies) e._trampled = false;
      const a = ax.any ? Math.atan2(ax.y, ax.x) : aimA;
      h.vx = Math.cos(a) * HERO.dashSpeed; h.vy = Math.sin(a) * HERO.dashSpeed;
      sfx.dash();
      this.particles.ring(h.x, h.y, 26, P.cream, 0.3, 3);
    }

  }

  updateTroopPhase(dt, h) {
    const P = this.palette;
    // ---- troops
    for (const t of this.troops) {
      t.cd -= dt;
      if (t.flash > 0) t.flash -= dt;
      if (t.lunge > 0) t.lunge -= dt * 5;
      let goal = null, engage = null;
      // exposure is refreshed while charging and decays after the order changes
      const squadStanceNow = this.squadStance(t);
      if (squadStanceNow === 'charge') t.exposedT = CHARGE_RECOVER;
      else if (t.exposedT > 0) t.exposedT = Math.max(0, t.exposedT - dt);

      // troops always defend the commander: any enemy near the hero is fair game
      const heroThreat = this.nearestEnemy(this.hero.x, this.hero.y, 90);
      const stance = squadStanceNow;
      if (stance === 'charge') {
        engage = this.nearestEnemy(t.x, t.y);
      } else if (stance === 'hold') {
        engage = this.nearestEnemy(t.x, t.y, t.d.ranged ? t.d.range : 140);
        if (!engage && heroThreat && dist2(t.x, t.y, this.hero.x, this.hero.y) < 260 * 260) engage = heroThreat;
        if (!engage) goal = { x: t.holdX, y: t.holdY };
      } else { // follow
        engage = this.nearestEnemy(t.x, t.y, t.d.ranged ? t.d.range * 0.9 : 150);
        if (!engage && heroThreat) engage = heroThreat;
        if (!engage) goal = this.slotPos(t);
      }

      if (engage) {
        const d = Math.sqrt(dist2(t.x, t.y, engage.x, engage.y));
        const wantR = t.d.ranged ? t.d.range * 0.8 : t.d.range + engage.d.radius - 6;
        if (t.d.ranged && stance === 'hold') {
          goal = null; // archers on hold stand ground
        } else if (d > wantR) {
          // surround: each unit approaches its own point on the target's circle
          if (!t.d.ranged && d < wantR * 3.5) {
            if (t.jit == null) t.jit = (this.troops.indexOf(t) * 2.399);
            goal = { x: engage.x + Math.cos(t.jit) * wantR * 0.9, y: engage.y + Math.sin(t.jit) * wantR * 0.9 };
          } else {
            // approach IN FORMATION: hold your lateral slot while closing, so a charge
            // reads as a wedge bearing down — not a swarm converging on one point
            const aa = Math.atan2(engage.y - t.y, engage.x - t.x);
            const side = (t.slot.col - (t.slot.rowCount - 1) / 2) * 26;
            const rowBack = t.slot.row * 24;
            goal = {
              x: engage.x - Math.cos(aa) * rowBack + Math.cos(aa + Math.PI / 2) * side,
              y: engage.y - Math.sin(aa) * rowBack + Math.sin(aa + Math.PI / 2) * side,
            };
          }
        } else if (t.d.ranged && d < t.d.keepAway) {
          goal = { x: t.x + (t.x - engage.x), y: t.y + (t.y - engage.y) };
        }
        t.facing = angLerp(t.facing, Math.atan2(engage.y - t.y, engage.x - t.x), 1 - Math.exp(-8 * dt));
        // A charge forfeits the bow line: archers ordered forward are running with their
        // bows down, so CHARGE trades the ranged screen for speed instead of keeping both.
        const advancingBow = t.d.ranged && stance === 'charge' && d > wantR;
        if (t.cd <= 0 && !advancingBow && d < (t.d.ranged ? t.d.range : t.d.range + engage.d.radius + 4)) {
          if (this.deployT > 0) { this.deployT = 0; this.commandFlash = { text: 'FIRST BLOOD!', t: 0.9 }; this.game.sfx.horn(155); }
          t.cd = t.d.cooldown;
          // A set line receives a charge: melee holding position hit harder against anything
          // closing at speed (wolves sprint at 158, a brute commits at 55). This is what makes
          // HOLD the answer to a pack instead of a strictly slower FOLLOW.
          const closingFast = stance === 'hold' && !t.d.ranged &&
            len(engage.vx, engage.vy) > BRACE_SPEED;
          const dmg = t.d.dmg * (closingFast ? BRACE_BONUS : 1);
          if (t.d.ranged) {
            // Archers standing still shoot straighter than archers walking.
            const spread = stance === 'hold' ? BOW_SPREAD_BRACED : BOW_SPREAD;
            this.fireArrow(t.x, t.y - 12, engage.x, engage.y, true, dmg, t.d.projSpeed, null, spread);
          } else {
            t.lunge = 1;
            this.damageEnemy(engage, dmg,
              Math.cos(t.facing) * 85, Math.sin(t.facing) * 85, 'troop');
          }
        }
      }

      if (goal) {
        const dx = goal.x - t.x, dy = goal.y - t.y, d = len(dx, dy);
        if (d > 6) {
          const sp = t.d.speed * (stance === 'charge' ? 1.15 : 1) * clamp(d / 40, 0.5, 1.6);
          t.vx = lerp(t.vx, dx / d * sp, 1 - Math.exp(-8 * dt));
          t.vy = lerp(t.vy, dy / d * sp, 1 - Math.exp(-8 * dt));
          if (!engage) t.facing = angLerp(t.facing, Math.atan2(dy, dx), 1 - Math.exp(-6 * dt));
        } else { t.vx *= 0.8; t.vy *= 0.8; }
      } else if (!engage) { t.vx *= 0.85; t.vy *= 0.85; }
      else { t.vx *= 0.9; t.vy *= 0.9; }

      t.x += t.vx * dt; t.y += t.vy * dt;
      t.x = clamp(t.x, 30, this.W - 30); t.y = clamp(t.y, 30, this.H - 30);
      if (len(t.vx, t.vy) > 30) { t.bob += dt * 10; if (this.fxRng() < dt * 3) this.particles.dust(t.x, t.y + 5, P.groundShade, 1, this.fxRng); }
    }

  }

  updateEnemyPhase(dt, h) {
    const P = this.palette;
    // ---- deploy window: enemies hold their line until the horn, the player sets up freely.
    // First blood (yours), closing to melee reach, or the timer ends it.
    if (this.deployT > 0) {
      this.deployT -= dt;
      this.lastAction = this.time; // no stalemate clock during forming-up
      this.lastDeath = this.time;
      const ne = this.nearestEnemy(h.x, h.y, 250);
      if (ne) this.deployT = 0; // riding into their line starts the fight on the spot
      if (this.deployT <= 0) {
        this.game.sfx.horn(155);
        this.commandFlash = { text: 'THEY ADVANCE!', t: 1.0 };
      }
      for (const e of this.enemies) {
        e.vx *= 0.85; e.vy *= 0.85;
        e.facing = angLerp(e.facing, Math.atan2(h.y - e.y, h.x - e.x), 1 - Math.exp(-3 * dt));
      }
    } else
    // ---- enemies
    for (const e of this.enemies) {
      e.cd -= dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.lunge > 0) e.lunge -= dt * 5;
      // wolves earn their name: they hunt the backline (nearest ranged troop)
      let tgt;
      if (e.type === 'wolf') {
        const best = this.nearestFriendlyRanged(e.x, e.y, 460);
        tgt = best ? { obj: best, isHero: false } : this.nearestFriendly(e.x, e.y);
      } else {
        tgt = this.nearestFriendly(e.x, e.y);
      }
      const to = tgt.obj;
      const d = Math.sqrt(dist2(e.x, e.y, to.x, to.y));
      e.facing = angLerp(e.facing, Math.atan2(to.y - e.y, to.x - e.x), 1 - Math.exp(-6 * dt));

      if (e.windupT > 0) {
        e.windupT -= dt;
        e.vx *= 0.8; e.vy *= 0.8;
        if (e.windupT <= 0) {
          // strike lands
          if (e.d.slamR) {
            this.game.sfx.brute();
            this.game.camera.shake(9, 0.35);
            this.particles.ring(e.x, e.y, e.d.slamR, P.enemy, 0.4, 5);
            this.particles.dust(e.x, e.y, P.groundShade, 10, this.fxRng);
            if (dist2(e.x, e.y, this.hero.x, this.hero.y) < e.d.slamR * e.d.slamR) this.damageFriendly(this.hero, true, e.d.dmg, e);
            for (const t of [...this.troops]) if (dist2(e.x, e.y, t.x, t.y) < e.d.slamR * e.d.slamR) this.damageFriendly(t, false, e.d.dmg);
          } else if (e.d.ranged) {
            this.fireArrow(e.x, e.y - 10, to.x, to.y, false, e.d.dmg, e.d.projSpeed, e.type);
          } else {
            e.lunge = 1;
            if (d < e.d.range + 16) {
              this.damageFriendly(to, tgt.isHero, e.d.dmg, e);
              if (!tgt.isHero) { to.vx += Math.cos(e.facing) * 85; to.vy += Math.sin(e.facing) * 85; }
            }
          }
          e.cd = e.d.cooldown;
        }
      } else {
        const speedMul = this.bloodlust ? 1.3 : 1;
        const wantR = e.d.ranged ? e.d.range * 0.85 : e.d.range + 6;
        if (e.d.ranged && d < e.d.keepAway && !this.bloodlust) {
          const a = Math.atan2(e.y - to.y, e.x - to.x);
          e.vx = lerp(e.vx, Math.cos(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
          e.vy = lerp(e.vy, Math.sin(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
        } else if (d > wantR) {
          let gx = to.x, gy = to.y;
          if (!e.d.ranged && d < wantR * 3.5) { // surround instead of stacking
            if (e.jit == null) e.jit = this.enemies.indexOf(e) * 2.399;
            gx += Math.cos(e.jit) * wantR * 0.7; gy += Math.sin(e.jit) * wantR * 0.7;
          }
          const a = Math.atan2(gy - e.y, gx - e.x);
          e.vx = lerp(e.vx, Math.cos(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
          e.vy = lerp(e.vy, Math.sin(a) * (e.d.speed * speedMul), 1 - Math.exp(-6 * dt));
        } else { e.vx *= 0.85; e.vy *= 0.85; }
        if (e.cd <= 0 && d < (e.d.ranged ? e.d.range : wantR + 8)) {
          e.windupT = e.d.windup; // telegraph
        }
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      e.x = clamp(e.x, 30, this.W - 30); e.y = clamp(e.y, 30, this.H - 30);
      if (len(e.vx, e.vy) > 25) e.bob += dt * 9;
    }

  }

  // Stance glyphs, shared by every squad row: an arrow to follow, crossed swords to
  // charge, a heater shield to hold. Drawn at native scale so they read at 1x.
  stanceIcon(ctx, id, cx, cy, scale = 1.55) {
    const P = this.palette;
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

  updateStalematePhase() {
    const P = this.palette;
    // Survivors stop kiting and close in after 10s without blood — or after STALL_NO_DEATH
    // seconds in which nobody actually died. The second clock matters because kiting
    // raiders keep landing hits, so `lastAction` never goes stale even while the fight
    // makes no progress at all: melee on FOLLOW hold formation and never close, and the
    // whole battle grinds past the 90s mark. Damage is not progress; bodies are.
    const stalled = this.time - this.lastAction > 10 ||
      this.time - this.lastDeath > STALL_NO_DEATH;
    if (!this.bloodlust && stalled && this.enemies.length > 0) {
      this.bloodlust = true;
      this.commandFlash = { text: 'THEY CLOSE IN!', t: 1.1 };
      this.game.sfx.horn(110);
      for (const e of this.enemies) this.particles.ring(e.x, e.y, 26, P.enemy, 0.5, 3);
    }
  }

  updatePresentationPhase(dt) {
    if (this.commandFlash.t > 0) this.commandFlash.t -= dt;
    this.updateCamera(dt);
    this.particles.update(dt);
  }

  updateProjectilePhase(dt, h) {
    const P = this.palette;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.t >= p.T) {
        const hx = p.tx, hy = p.ty;
        this.particles.dust(hx, hy, P.groundShade, 1, this.fxRng);
        if (p.friendly) {
          const e = this.nearestEnemy(hx, hy, 16);
          if (e) this.damageEnemy(e, p.dmg, 0, 0, 'troop');
        } else if (dist2(hx, hy, h.x, h.y) < 16 * 16 && h.iframesT <= 0) {
          this.damageFriendly(h, true, p.dmg, { x: hx, y: hy, type: p.srcType });
        } else {
          let hit = null, bd = 16 * 16;
          for (const t of this.troops) { const dd = dist2(hx, hy, t.x, t.y); if (dd < bd) { bd = dd; hit = t; } }
          if (hit) this.damageFriendly(hit, false, p.dmg);
        }
        this.projectiles.splice(i, 1);
      }
    }
  }

  updateSeparationPhase(h) {
    const all = this._allUnits;
    all.length = 0;
    for (const t of this.troops) all.push(t);
    for (const e of this.enemies) all.push(e);
    // Designed battles stay on the exact legacy mutation order. This avoids
    // changing a normal encounter because an earlier push moved a later unit
    // across a bucket boundary; the broad phase is reserved for stress sizes.
    if (all.length <= this._separationSpatialThreshold) {
      this.updateLegacySeparation(all, h);
      return;
    }
    let maxUnitRadius = 0;
    for (const unit of all) if (unit.d.radius > maxUnitRadius) maxUnitRadius = unit.d.radius;
    let maxObstacleRadius = 0;
    for (const obstacle of this.obstacles) if (obstacle.r > maxObstacleRadius) maxObstacleRadius = obstacle.r;
    this._unitGrid.rebuild(all);
    this._obstacleGrid.rebuild(this.obstacles);
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      const unitCandidates = this._unitGrid.queryOrdered(a.x, a.y, a.d.radius + maxUnitRadius + 13);
      for (let k = 0; k < unitCandidates; k++) {
        const b = this._unitGrid.queryItems[k];
        this._unitGrid.noteCandidate();
        if (b._spatialOrder <= i) continue;
        this._unitGrid.stats.pairs++;
        this.applyUnitSeparation(a, b);
      }
      this.pushOutOf(a, h, a.d.radius + HERO.radius + 3, 0.9);
      const obstacleCandidates = this._obstacleGrid.queryOrdered(a.x, a.y, a.d.radius + maxObstacleRadius);
      for (let k = 0; k < obstacleCandidates; k++) {
        const o = this._obstacleGrid.queryItems[k];
        this._obstacleGrid.noteCandidate();
        this.pushOutOf(a, o, a.d.radius + o.r, 1);
      }
    }
    const heroObstacleCandidates = this._obstacleGrid.queryOrdered(h.x, h.y, HERO.radius + maxObstacleRadius);
    for (let k = 0; k < heroObstacleCandidates; k++) {
      const o = this._obstacleGrid.queryItems[k];
      this._obstacleGrid.noteCandidate();
      this.pushOutOf(h, o, HERO.radius + o.r, 1);
    }
  }

  updateLegacySeparation(all, h) {
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) this.applyUnitSeparation(a, all[j]);
      this.pushOutOf(a, h, a.d.radius + HERO.radius + 3, 0.9);
      for (const o of this.obstacles) this.pushOutOf(a, o, a.d.radius + o.r, 1);
    }
    for (const o of this.obstacles) this.pushOutOf(h, o, HERO.radius + o.r, 1);
  }

  applyUnitSeparation(a, b) {
    const sameTeam = a.team === b.team;
    const rr = a.d.radius + b.d.radius + (sameTeam ? 13 : 7);
    const d2 = dist2(a.x, a.y, b.x, b.y);
    if (d2 < rr * rr && d2 > 0.01) {
      const d = Math.sqrt(d2), push = (rr - d) / d * (sameTeam ? 0.95 : 0.8);
      const dx = (a.x - b.x) * push, dy = (a.y - b.y) * push;
      a.x += dx; a.y += dy; b.x -= dx; b.y -= dy;
    }
  }

  // Push `a` clear of a body it must not overlap, moving only `a`: the hero shoves
  // troops aside but is not shoved by them, and obstacles never move at all. The
  // symmetric unit-vs-unit case stays separate above because both sides give ground.
  // `rr` is the sum of radii plus whatever spacing the caller wants kept.
  pushOutOf(a, b, rr, factor) {
    const d2 = dist2(a.x, a.y, b.x, b.y);
    if (d2 < rr * rr && d2 > 0.01) {
      const d = Math.sqrt(d2), push = (rr - d) / d * factor;
      a.x += (a.x - b.x) * push; a.y += (a.y - b.y) * push;
    }
  }

  // Squads the player can actually address: an empty squad is skipped so cycling never
  // lands on a banner with nobody under it.
  mannedSquads() {
    return SQUAD_TYPES.filter(type => this.troops.some(t => t.type === type));
  }

  // ALL → first manned squad → … → ALL. Selection is presentation-and-input state, so it
  // deliberately never reaches the save.
  cycleSquad() {
    const manned = this.mannedSquads();
    if (manned.length < 2) { this.selectedSquad = null; return; }
    const at = this.selectedSquad === null ? -1 : manned.indexOf(this.selectedSquad);
    this.selectedSquad = at + 1 >= manned.length ? null : manned[at + 1];
    this.game.sfx.horn(this.selectedSquad ? 294 : 233);
    const squad = this.selectedSquad;
    this.commandFlash = { text: squad ? SQUAD_LABELS[squad] : 'WHOLE WARBAND', t: 0.7 };
    this.game.invalidate();
  }

  updateCommandPhase(inp) {
    if (inp.pressedAction(ACTIONS.SQUAD_CYCLE)) this.cycleSquad();
    // A selected squad narrows the order; with ALL selected these behave exactly as
    // before, which is what the legacy QA and input-action contracts assert.
    if (inp.pressedAction(ACTIONS.COMMAND_FOLLOW)) this.issueCommand('follow', this.selectedSquad);
    if (inp.pressedAction(ACTIONS.COMMAND_CHARGE)) this.issueCommand('charge', this.selectedSquad);
    if (inp.pressedAction(ACTIONS.COMMAND_HOLD)) this.issueCommand('hold', this.selectedSquad);
  }

  resolveBattleResult(dt, h, ax) {
    if (this.enemies.length === 0) this.endBattle(true);
    if (h.hp <= 0) this.endBattle(false); // standing check — never rely only on the damage path
    // Retreat is a held INPUT decision; knockback, dashes, and drift never fill the bar.
    const inEscape = this.approach === 'E' ? h.x < 70 : this.approach === 'W' ? h.x > this.W - 70
      : this.approach === 'S' ? h.y < 70 : h.y > this.H - 70;
    const steeringOut = this.approach === 'E' ? ax.x < -0.3 : this.approach === 'W' ? ax.x > 0.3
      : this.approach === 'S' ? ax.y < -0.3 : ax.y > 0.3;
    if (this.setup.canRetreat !== false && inEscape && steeringOut && this.time > 3) {
      this.retreatT = (this.retreatT || 0) + dt;
      if (this.retreatT >= 1.3) this.endBattle(false, true);
    } else {
      this.retreatT = 0;
    }
  }

  // Fit-to-action camera: frame hero + all living units, clamp inside the arena.
  updateCamera(dt) {
    const cam = this.game.camera, h = this.hero;
    let minX = h.x, maxX = h.x, minY = h.y, maxY = h.y;
    const grow = (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const t of this.troops) grow(t.x, t.y);
    for (const e of this.enemies) grow(e.x, e.y);
    const pad = 170;
    const boxW = maxX - minX + pad * 2, boxH = maxY - minY + pad * 2;
    let z = Math.min(cam.w / boxW, cam.h / boxH);
    // floor raised 0.62 -> 0.80: below that, unit detail (strokes, weapons, shields) is
    // sub-resolution and the whole silhouette pass stops existing on screen
    z = clamp(z, 0.80, 1.15);
    this.zoomT = z;
    cam.zoom = lerp(cam.zoom, this.zoomT, 1 - Math.exp(-3 * dt));
    // target: midpoint biased toward the hero
    const bx = (minX + maxX) / 2, by = (minY + maxY) / 2;
    let cx = h.x * 0.45 + bx * 0.55, cy = h.y * 0.45 + by * 0.55;
    // clamp view inside arena (+ margin for the cliff band)
    const vw = cam.w / cam.zoom / 2, vh = cam.h / cam.zoom / 2, M = 110; // show coastline, not a band
    if (vw * 2 < this.W + M * 2) cx = clamp(cx, vw - M, this.W - vw + M); else cx = this.W / 2;
    if (vh * 2 < this.H + M * 2) cy = clamp(cy, vh - M, this.H - vh + M); else cy = this.H / 2;
    cam.follow(cx, cy, dt, 5);
  }

  // ------------------------------------------------------------- drawing
  draw(ctx) {
    const P = this.palette;
    this._alertCount = 0; // per-frame alert cluster-cull registry
    // paint the whole screen in the biome's shade tone FIRST — the battle sits on
    // continuous terrain, never on a floating "arena card" over the canvas default
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.groundShade;
    ctx.fillRect(0, 0, this.game.camera.w, this.game.camera.h);
    this.game.camera.apply(ctx);
    const cam = this.game.camera, h = this.hero;
    // the arena is an island in teal water (Thronefall levels float in stylized voids)
    ctx.fillStyle = P.water;
    ctx.fillRect(0, 0, cam.w, cam.h);
    cam.apply(ctx);
    // wave dashes in the water, in world space so they parallax naturally
    ctx.strokeStyle = '#7FD9E6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 40; i++) {
      const wx = ((i * 517) % (this.W + 1200)) - 600;
      const wy = ((i * 331) % (this.H + 900)) - 450;
      if (wx > -80 && wx < this.W + 80 && wy > -60 && wy < this.H + 60) continue; // only outside the island
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + 26, wy); ctx.stroke();
    }
    // island: ink cliff base, then ground on top
    ctx.fillStyle = P.ink;
    ctx.fill(this._staticPaths.islandInk);
    ctx.fillStyle = P.ground;
    ctx.fill(this._staticPaths.islandGround);
    ctx.strokeStyle = P.groundShade; ctx.lineWidth = 8;
    ctx.stroke(this._staticPaths.islandBorder);
    // large second-tone regions: strong enough to read as landform, with a hard darker
    // edge on the light-away side so the patch reads as carved elevation, not a smudge
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = P.groundShade;
    ctx.fill(this._staticPaths.regions);
    ctx.restore(); // no edge stroke at all: a line across same-biome ground is a seam, not art
    // per-scene light grading: one broad diagonal LIGHT band across the field (the sun falls
    // somewhere) + stepped shade wedges in the far corners — scene lighting, drawn flat
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = '#FFF6E0';
    ctx.fill(this._staticPaths.light);
    ctx.fillStyle = P.ink;
    ctx.globalAlpha = 0.10;
    ctx.fill(this._staticPaths.shadeNear);
    ctx.globalAlpha = 0.07;
    ctx.fill(this._staticPaths.shadeFar);
    ctx.restore();
    // blotches
    ctx.fillStyle = P.groundShade;
    ctx.fill(this._staticPaths.blotches);
    ctx.drawImage(this._staticLayer, -64, -64);
    this.drawProps(ctx, true);

    // Hold banners: one per squad actually holding, drawn from that squad's own anchor.
    // This was gated on the aggregate `command === 'hold'`, which is never 'hold' under a
    // split order - so the feature's in-world affordance vanished exactly when squads were
    // used independently, and the per-squad anchors were written but never read.
    for (const type of SQUAD_TYPES) {
      const squad = this.squads[type];
      if (squad.stance !== 'hold' || squad.holdX == null) continue;
      if (!this.troops.some(t => t.type === type)) continue;
      ctx.strokeStyle = P.ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(squad.holdX, squad.holdY); ctx.lineTo(squad.holdX, squad.holdY - 34); ctx.stroke();
      ctx.fillStyle = P.friend;
      ctx.beginPath(); ctx.moveTo(squad.holdX, squad.holdY - 34); ctx.lineTo(squad.holdX + 18, squad.holdY - 28);
      ctx.lineTo(squad.holdX, squad.holdY - 22); ctx.closePath(); ctx.fill();
    }

    // depth sort drawables
    const draws = this._drawEntries;
    for (const entry of draws) entry.ref = null;
    const oldDrawLength = draws.length;
    let drawCount = 0;
    for (const o of this.obstacles) {
      const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
      entry.y = o.y; entry.kind = 0; entry.ref = o; drawCount++;
    }
    for (const t of this.troops) {
      const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
      entry.y = t.y; entry.kind = 1; entry.ref = t; drawCount++;
    }
    for (const e of this.enemies) {
      const entry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
      entry.y = e.y; entry.kind = 2; entry.ref = e; drawCount++;
    }
    const heroEntry = draws[drawCount] || (draws[drawCount] = { y: 0, kind: 0, ref: null });
    heroEntry.y = h.y; heroEntry.kind = 3; heroEntry.ref = h; drawCount++;
    for (let i = drawCount; i < oldDrawLength; i++) draws[i].ref = null;
    this._drawEntriesActive = drawCount;
    this._spatialCounters.orderingItems += drawCount;
    stableSortPrefix(draws, drawCount, this._drawSortScratch, (a, b) => a.y - b.y);
    // shadows first
    for (const t of this.troops) shadow(ctx, t.x, t.y + 2, t.d.radius, 12, P.groundShade);
    for (const e of this.enemies) shadow(ctx, e.x, e.y + 2, e.d.radius, 12, P.groundShade);
    shadow(ctx, h.x, h.y + 4, 15, 16, P.groundShade);
    for (let i = 0; i < drawCount; i++) {
      const d = draws[i];
      if (d.kind === 0) this.drawObstacle(ctx, d.ref);
      else if (d.kind === 1) this.drawTroop(ctx, d.ref);
      else if (d.kind === 2) this.drawEnemy(ctx, d.ref);
      else this.drawHero(ctx);
    }
    // the commander is never buried: while hurt (and at the death moment) he draws above the pile
    if (h.hurtT > 0 || h.hp <= 0) this.drawHero(ctx);

    // projectiles (arrows with arc + trail)
    for (const p of this.projectiles) {
      const k = p.t / p.T;
      const x = lerp(p.sx, p.tx, k), y = lerp(p.sy, p.ty, k);
      const arcH = Math.sin(k * Math.PI) * Math.min(70, len(p.tx - p.sx, p.ty - p.sy) * 0.22);
      ctx.strokeStyle = P.cream; ctx.lineWidth = 2;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      const k2 = Math.max(0, k - 0.12);
      const x2 = lerp(p.sx, p.tx, k2), y2 = lerp(p.sy, p.ty, k2);
      const arcH2 = Math.sin(k2 * Math.PI) * Math.min(70, len(p.tx - p.sx, p.ty - p.sy) * 0.22);
      ctx.moveTo(x2, y2 - arcH2); ctx.lineTo(x, y - arcH); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    this.particles.draw(ctx);

    // HP bars (world space)
    // scrum readability: slimmer bars, and only for meaningfully wounded units (<90%)
    // density-gated: most-wounded units draw first, then any bar landing within 20px of an
    // already-drawn bar is skipped — packed melees show a few meaningful bars, not a bar wall
    const wounded = this._woundedEntries;
    for (const entry of wounded) entry.u = null;
    let woundedCount = 0;
    for (const t of this.troops) if (t.hp / t.maxHp < 0.9) {
      const entry = wounded[woundedCount] || (wounded[woundedCount] = { u: null, w: 0, fill: null });
      entry.u = t; entry.w = 24; entry.fill = P.hp; woundedCount++;
    }
    for (const e of this.enemies) if (e.hp / e.maxHp < 0.9) {
      const entry = wounded[woundedCount] || (wounded[woundedCount] = { u: null, w: 0, fill: null });
      entry.u = e; entry.w = e.type === 'brute' ? 38 : 24; entry.fill = P.hp; woundedCount++;
    }
    this._woundedEntriesActive = woundedCount;
    this._spatialCounters.orderingItems += woundedCount;
    stableSortPrefix(wounded, woundedCount, this._woundedSortScratch,
      (a, b) => a.u.hp / a.u.maxHp - b.u.hp / b.u.maxHp);
    // regional overlay budget: max 3 bars per ~120px region — past that a cluster is a
    // single wounded MASS, not individually-tracked units (Thronefall's hierarchy rule)
    const drawnBars = this._drawnBars;
    let barCount = 0;
    for (let wi = 0; wi < woundedCount; wi++) {
      const { u, w, fill } = wounded[wi];
      const bx = u.x, by = u.y - u.d.radius * 3;
      let overlap = false, regionCount = 0;
      for (let i = 0; i < barCount; i++) {
        const bar = drawnBars[i];
        if (Math.abs(bar.x - bx) < 26 && Math.abs(bar.y - by) < 14) overlap = true;
        if (Math.abs(bar.x - bx) < 120 && Math.abs(bar.y - by) < 120) regionCount++;
      }
      if (overlap) continue;
      if (regionCount >= 3) continue;
      const bar = drawnBars[barCount] || (drawnBars[barCount] = { x: 0, y: 0 });
      bar.x = bx; bar.y = by;
      barCount++;
      hpBar(ctx, bx, by, w, u.hp / u.maxHp, P.hpBack, fill);
    }
    for (let i = barCount; i < drawnBars.length; i++) { drawnBars[i].x = 0; drawnBars[i].y = 0; }
    this._drawnBarsActive = barCount;

    // squad balloons: one per unit type cluster (centroid)
    this.drawBalloons(ctx);

    // HUD (screen space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // corner cloud vignette — the same atmosphere motif as the menu, carried into gameplay
    const cw = this.game.camera.w, ch = this.game.camera.h;
    ctx.fillStyle = 'rgba(255,246,227,0.92)';
    for (const [ox, oy, r] of [[0, 0, 46], [40, 12, 36], [-34, 14, 32], [20, -26, 28]]) {
      ctx.beginPath(); ctx.arc(cw - 10 + ox, -18 + oy, r, 0, TAU); ctx.fill();
    }
    this.drawHud(ctx);
  }

  drawBalloons(ctx) {
    const P = this.palette;
    const s = clamp(1 / this.game.camera.zoom, 1, 1.7);
    // at mass-battle zoom: ONE badge per side (dominant type) — the silhouettes carry unit
    // identity now, and a stack of per-type badges over a melee drowns the fight it labels
    const massZoom = this.game.camera.zoom < 0.95 || (this.troops.length + this.enemies.length) > 12;
    const groups = this._groups, eg = this._enemyGroups;
    for (const type in UNIT_TYPES) { if (!groups[type]) groups[type] = []; else groups[type].length = 0; }
    for (const type in ENEMY_TYPES) { if (!eg[type]) eg[type] = []; else eg[type].length = 0; }
    for (const t of this.troops) groups[t.type].push(t);
    for (const e of this.enemies) eg[e.type].push(e);
    if (massZoom) {
      let td = null, ed = null;
      for (const type in groups) if (groups[type].length && (!td || groups[type].length > groups[td].length)) td = type;
      for (const type in eg) if (eg[type].length && (!ed || eg[type].length > eg[ed].length)) ed = type;
      if (td) this.drawCentroidBalloon(ctx, this.troops, UNIT_TYPES[td].icon, P.ink, P.cream, 56, s);
      if (ed) this.drawCentroidBalloon(ctx, this.enemies, ENEMY_TYPES[ed].icon, P.enemyDark, P.enemyAccent, 58, s);
    } else {
      let ti = 0;
      for (const type in groups) if (groups[type].length) this.drawCentroidBalloon(ctx, groups[type], UNIT_TYPES[type].icon, P.ink, P.cream, 56 + (ti++) * 28, s);
      let ei = 0;
      for (const type in eg) if (eg[type].length) this.drawCentroidBalloon(ctx, eg[type], ENEMY_TYPES[type].icon, P.enemyDark, P.enemyAccent, 58 + (ei++) * 28, s);
    }
  }

  drawCentroidBalloon(ctx, group, icon, ink, paper, lift, scale) {
    let cx = 0, cy = 0;
    for (const u of group) { cx += u.x; cy += u.y; }
    cx /= group.length; cy /= group.length;
    let top = cy;
    for (const u of group) top = Math.min(top, u.y - u.d.radius * 2.6);
    const stagger = lift - 56;
    const count = this.game.camera.zoom < 0.95 ? 0 : group.length;
    balloon(ctx, cx, Math.min(cy - lift, top - 26 - Math.max(0, stagger)), icon, ink, paper, scale, count);
  }

  drawObstacle(ctx, o) {
    const P = this.palette;
    if (o.kind === 'none') return;
    if (o.kind === 'tree') tree(ctx, o.x, o.y, o.r * 1.15, P.tree, P.treeShade, P.groundShade);
    else rock(ctx, o.x, o.y, o.r, P.rock, P.rockShade, P.groundShade, o.rot);
  }

  drawProps(ctx, dynamicOnly = false) {
    const P = this.palette;
    for (const p of this.props) {
      const dynamic = p.kind === 'fire' || p.kind === 'mill' || p.kind === 'river';
      if (dynamicOnly !== dynamic) continue;
      if (p.kind === 'river') {
        const bx = this.bridge.x;
        ctx.fillStyle = P.water;
        ctx.fillRect(bx - 45, -40, 90, this.H + 80);
        ctx.strokeStyle = P.waterLight; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (let y = 20; y < this.H; y += 90) {
          ctx.beginPath(); ctx.moveTo(bx - 20, y); ctx.lineTo(bx + 6, y); ctx.stroke();
        }
        // the bridge — a BUILT wooden thing: deck planks, side rails, post caps
        // (a bare cream rectangle read as a missing-asset placeholder to two critics)
        const bty = this.bridge.y - this.bridge.h / 2, bh = this.bridge.h;
        // alternating plank tones with real contrast, grooves on alternate seams only
        for (let pi = 0; pi < 8; pi++) {
          ctx.fillStyle = pi % 2 ? '#BE9245' : '#DDB870';
          ctx.fillRect(bx - 60 + pi * 15, bty, 15, bh);
        }
        ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.globalAlpha = 0.55;
        for (let px = -30; px <= 30; px += 30) {
          ctx.beginPath(); ctx.moveTo(bx + px, bty + 3); ctx.lineTo(bx + px, bty + bh - 3); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = P.ink; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(bx - 60, bty); ctx.lineTo(bx + 60, bty); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx - 60, bty + bh); ctx.lineTo(bx + 60, bty + bh); ctx.stroke();
        ctx.fillStyle = P.ink;
        for (const [px, py] of [[-60, 0], [60, 0], [-60, bh], [60, bh]]) {
          ctx.beginPath(); ctx.arc(bx + px, bty + py, 6, 0, TAU); ctx.fill();
        }
      } else if (p.kind === 'road') {
        ctx.strokeStyle = P.cream; ctx.lineWidth = 26; ctx.globalAlpha = 0.35;
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(-40, this.H * 0.62); ctx.quadraticCurveTo(this.W * 0.5, this.H * 0.42, this.W + 40, this.H * 0.55); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'plank') {
        shadow(ctx, p.x, p.y + 2, p.s * 0.5, p.s, P.groundShade);
        ctx.fillStyle = '#6B3A2A';
        ctx.fillRect(p.x - p.s * 0.4, p.y - p.s * 2.2, p.s * 0.8, p.s * 2.2);
        ctx.fillStyle = P.cream;
        ctx.beginPath(); ctx.moveTo(p.x - p.s * 0.4, p.y - p.s * 2.2); ctx.lineTo(p.x, p.y - p.s * 2.8); ctx.lineTo(p.x + p.s * 0.4, p.y - p.s * 2.2); ctx.closePath(); ctx.fill();
      } else if (p.kind === 'tuft') {
        ctx.strokeStyle = P.groundShade; ctx.lineWidth = 2; ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(p.x + i * 3, p.y);
          ctx.lineTo(p.x + i * 3 + p.rot * 4 + i, p.y - p.s - (i === 0 ? 2 : 0)); ctx.stroke();
        }
      } else if (p.kind === 'pebbles') {
        ctx.fillStyle = P.groundShade;
        for (const [ox, oy, rr] of [[0, 0, 1], [1.6, 0.5, 0.7], [-1.2, 0.8, 0.6]]) {
          ctx.beginPath();
          ctx.ellipse(p.x + ox * p.s, p.y + oy * p.s, p.s * rr, p.s * rr * 0.7, p.rot, 0, TAU);
          ctx.fill();
        }
      } else if (p.kind === 'tent') {
        // dark leather-brown, NOT enemy red: the red triangle must mean exactly one thing
        // on a battlefield (an enemy's hood), never also a structure
        shadow(ctx, p.x, p.y + 4, p.s, p.s * 0.8, P.groundShade);
        ctx.fillStyle = '#6B3A2A';
        ctx.beginPath(); ctx.moveTo(p.x - p.s, p.y); ctx.lineTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x + p.s, p.y); ctx.closePath(); ctx.fill();
        // lit slope face (up-left light) — every standing object carries the same light
        ctx.fillStyle = '#8A5138';
        ctx.beginPath(); ctx.moveTo(p.x - p.s, p.y); ctx.lineTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x - p.s * 0.2, p.y); ctx.closePath(); ctx.fill();
        // red lives only in the small pennant on top
        ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x, p.y - p.s * 1.25 - 10); ctx.stroke();
        ctx.fillStyle = P.enemy;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.25 - 10); ctx.lineTo(p.x + 9, p.y - p.s * 1.25 - 7); ctx.lineTo(p.x, p.y - p.s * 1.25 - 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = P.enemyDark;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.25); ctx.lineTo(p.x + p.s, p.y); ctx.lineTo(p.x + p.s * 0.25, p.y); ctx.closePath(); ctx.fill();
      } else if (p.kind === 'fire') {
        ctx.fillStyle = P.ink;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, 12, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = P.tree;
        ctx.beginPath(); ctx.arc(p.x, p.y - 6 + Math.sin(this.time * 8) * 1.5, 6 + Math.sin(this.time * 12) * 1.4, 0, TAU); ctx.fill();
      } else if (p.kind === 'stake') {
        ctx.strokeStyle = P.ink; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 4, p.y - p.s - 6); ctx.stroke();
      } else if (p.kind === 'house') {
        // extruded volume: lit front wall + darker side wall + two-tone gabled roof
        shadow(ctx, p.x, p.y + 6, p.w * 0.6, p.h * 0.6, P.groundShade);
        const wallL = '#3A4A72', wallD = P.ink, ext = p.w * 0.28;
        ctx.fillStyle = wallL; ctx.fillRect(p.x - p.w / 2, p.y - p.h, p.w, p.h);
        ctx.fillStyle = wallD;
        ctx.beginPath(); ctx.moveTo(p.x + p.w / 2, p.y - p.h); ctx.lineTo(p.x + p.w / 2 + ext, p.y - p.h - ext * 0.4);
        ctx.lineTo(p.x + p.w / 2 + ext, p.y - ext * 0.4); ctx.lineTo(p.x + p.w / 2, p.y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = P.cream;
        ctx.beginPath(); ctx.moveTo(p.x - p.w / 2 - 4, p.y - p.h); ctx.lineTo(p.x, p.y - p.h - p.w * 0.5); ctx.lineTo(p.x + p.w / 2 + 4, p.y - p.h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(P.cream, 0.8);
        ctx.beginPath(); ctx.moveTo(p.x, p.y - p.h - p.w * 0.5); ctx.lineTo(p.x + p.w / 2 + 4, p.y - p.h);
        ctx.lineTo(p.x + p.w / 2 + ext, p.y - p.h - ext * 0.4); ctx.closePath(); ctx.fill();
        // door — a building people live in
        ctx.fillStyle = wallD; ctx.fillRect(p.x - 5, p.y - p.h * 0.55, 10, p.h * 0.55);
      } else if (p.kind === 'mill') {
        shadow(ctx, p.x, p.y + 4, p.s, p.s, P.groundShade);
        ctx.fillStyle = P.ink; ctx.fillRect(p.x - 8, p.y - p.s * 1.6, 16, p.s * 1.6);
        ctx.strokeStyle = P.cream; ctx.lineWidth = 4;
        for (let i = 0; i < 4; i++) {
          const a = this.time * 0.7 + i * Math.PI / 2;
          ctx.beginPath(); ctx.moveTo(p.x, p.y - p.s * 1.6); ctx.lineTo(p.x + Math.cos(a) * p.s * 0.9, p.y - p.s * 1.6 + Math.sin(a) * p.s * 0.9); ctx.stroke();
        }
      } else if (p.kind === 'stone') {
        rock(ctx, p.x, p.y, p.s, P.rock, P.rockShade, P.groundShade, 0.8);
      }
    }
  }

  // chunky little figure
  figure(ctx, x, y, facing, bob, body, dark, opts = {}) {
    const P = this.palette;
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

  horse(ctx, x, y, facing, bob, body, dark, mane) {
    const P = this.palette;
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

  drawTroop(ctx, t) {
    const P = this.palette;
    const lungeX = t.lunge > 0 ? Math.cos(t.facing) * t.lunge * 6 : 0;
    const lungeY = t.lunge > 0 ? Math.sin(t.facing) * t.lunge * 6 : 0;
    const body = t.flash > 0 ? '#FFFFFF' : P.friend;
    if (t.d.mounted) {
      this.horse(ctx, t.x + lungeX, t.y + lungeY, t.facing, t.bob, body, P.ink, P.friendDark);
      this.figure(ctx, t.x + lungeX, t.y - 14 + lungeY, t.facing, 0, body, P.ink, { r: 7, weapon: 'sword', head: P.friendDark });
    } else {
      this.figure(ctx, t.x + lungeX, t.y + lungeY, t.facing, t.bob, body, P.ink,
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

  drawEnemy(ctx, e) {
    const P = this.palette;
    const lungeX = e.lunge > 0 ? Math.cos(e.facing) * e.lunge * 7 : 0;
    const lungeY = e.lunge > 0 ? Math.sin(e.facing) * e.lunge * 7 : 0;
    // brutes read as a distinct big threat at a glance: size + a HUE break (umber-brown, like
    // WatG's tan mammoth against white sheep), not merely a darker red lost among crimson ranks
    let body = e.flash > 0 ? '#FFFFFF' : (e.type === 'brute' ? '#6E4226' : P.enemy);
    // windup telegraph: blink toward hot red — NEVER toward white/cream, which would put
    // the enemy in the defenders' pale luminance band mid-clash (friend/foe read must hold)
    if (e.windupT > 0 && Math.sin(this.time * 30) > 0) body = '#E85A4A';
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
      this.figure(ctx, e.x + lungeX, e.y + lungeY, e.facing, e.bob, body, P.ink,
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
      this.figure(ctx, e.x + lungeX, e.y + lungeY, e.facing, e.bob, body, P.ink,
        { r: 9, weapon: e.d.ranged ? 'bow' : 'sword', scarf: P.enemyAccent,
          shield: e.d.ranged ? null : P.enemyDark, tip: P.enemyAccent,
          hat: e.d.ranged ? 'hood' : 'cap' });
    }
    // "!" attack telegraph — wolves get a red DOUBLE mark: their tell is faster, says so
    if (e.windupT > 0) {
      // cluster-cull: one alert per ~70px — three stacked "!" marks read as noise, not signal
      for (let i = 0; i < this._alertCount; i++) {
        const alert = this._alerts[i];
        if ((alert.x - e.x) ** 2 + (alert.y - e.y) ** 2 < 70 * 70) return;
      }
      const alert = this._alerts[this._alertCount] || (this._alerts[this._alertCount] = { x: 0, y: 0 });
      alert.x = e.x; alert.y = e.y;
      this._alertCount++;
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

  drawHero(ctx) {
    const P = this.palette;
    const h = this.hero;
    const body = h.hurtT > 0 ? '#FFFFFF' : P.hero;
    // dust ring while dashing
    if (h.dashT > 0) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = P.cream; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, h.y, 20, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.horse(ctx, h.x, h.y, h.facing, h.bob, body, P.ink, P.heroDark);
    this.figure(ctx, h.x, h.y - 15, h.facing, 0, body, P.ink, { r: 6.5, weapon: 'sword', head: P.heroDark });
    // banner
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(h.x - 8, h.y - 20); ctx.lineTo(h.x - 8, h.y - 52); ctx.stroke();
    ctx.fillStyle = P.enemy;
    ctx.beginPath(); ctx.moveTo(h.x - 8, h.y - 52); ctx.lineTo(h.x + 10, h.y - 46); ctx.lineTo(h.x - 8, h.y - 40); ctx.closePath(); ctx.fill();
  }

  drawHud(ctx) {
    const P = this.palette;
    const cam = this.game.camera, h = this.hero;
    const W = cam.w, Hh = cam.h;
    ctx.textBaseline = 'middle';

    // top-left: army + kills
    ctx.fillStyle = P.ink;
    rrect(ctx, 14, 14, 232, 34, 8); ctx.fill();
    ctx.fillStyle = P.cream;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Warband ${this.troops.length}   ·   Slain ${this.kills}/${this.totalEnemies}`, 26, 31);

    // bottom center: hero hp + dash + one row per squad.
    // Three rows instead of one chip strip: the player must be able to see, at a glance,
    // that his squads can be under DIFFERENT orders — that is the whole feature.
    // Rows exist only for squads the player actually has. A starting warband is four
    // spearmen, so the old fixed three rows showed BOWS 0 / HORSE 0 and advertised
    // "TAB pick squad" for a key that is a deliberate no-op below two squads - the first
    // thing a new player tried, and it did nothing.
    const squadRows = this.mannedSquads();
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
    if (this.selectedSquad === null && canPickSquads) {
      ctx.fillStyle = P.hero;
      rrect(ctx, bx + 10, rowsY + 2, 3, rowH * squadRows.length - 6, 1.5); ctx.fill();
    }
    ctx.font = '700 12px system-ui, sans-serif';
    squadRows.forEach((type, i) => {
      const ry = rowsY + i * rowH;
      const count = this.troops.reduce((n, t) => n + (t.type === type ? 1 : 0), 0);
      const selected = this.selectedSquad === type;
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
      const stance = this.squads[type].stance;
      this.stanceIcon(ctx, stance, bx + 116, ry + 9.5, 1.25);
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
    const nearEscape = this.approach === 'E' ? h.x < 190 : this.approach === 'W' ? h.x > this.W - 190
      : this.approach === 'S' ? h.y < 170 : h.y > this.H - 170;
    if (this.state === 'fight' && this.setup.canRetreat !== false && (nearEscape || this.time > 45) && this.time > 2) {
      const arrow = { west: '←', east: '→', north: '↑', south: '↓' }[this.retreatDir];
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = P.ink;
      rrect(ctx, 14, Hh / 2 - 26, 200, 52, 8); ctx.fill();
      ctx.fillStyle = P.cream;
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.textAlign = 'left';
      if (this.retreatT > 0) {
        ctx.fillText(`Retreating — keep holding ${arrow}…`, 24, Hh / 2 - 7);
        ctx.fillStyle = P.hpBack;
        rrect(ctx, 24, Hh / 2 + 6, 160, 8, 4); ctx.fill();
        ctx.fillStyle = P.hero;
        rrect(ctx, 24, Hh / 2 + 6, 160 * Math.min(1, this.retreatT / 1.3), 8, 4); ctx.fill();
      } else {
        ctx.fillText(`${arrow} hold ${arrow} at the ${this.retreatDir} edge`, 24, Hh / 2 - 7);
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.fillText('to RETREAT (keeps survivors)', 24, Hh / 2 + 12);
      }
      ctx.globalAlpha = 1;
    }

    // deploy countdown: set your line while they form theirs
    if (this.state === 'fight' && this.deployT > 0) {
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = P.ink;
      // Two measured lines. This was one 15px line of ~629px drawn into a hardcoded 460px
      // panel, so it spilled ~85px off both ends onto the battlefield in every battle.
      const headline = `They advance in ${Math.ceil(this.deployT)}`;
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
      rrect(ctx, W / 2 - dw / 2 + 16, 112, (dw - 32) * (this.deployT / this.deployMax), 6, 3); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // command flash
    if (this.commandFlash.t > 0) {
      const k = this.commandFlash.t / 0.9;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.fillStyle = P.cream;
      ctx.font = `900 ${Math.round(46 + (1 - k) * 6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(this.commandFlash.text, W / 2, Hh * 0.32);
      ctx.globalAlpha = 1;
    }

    // intro / end banners
    if (this.state === 'intro') {
      const k = Math.min(1, this.stateT / 0.35);
      ctx.globalAlpha = k;
      ctx.fillStyle = P.ink;
      // Plan 021 step 5: a brief-routed fight already stated N vs M once (and the
      // deploy countdown states it a third time in words) — drop this repeat, keyed
      // strictly off setup.brief so the un-briefed baselines are pixel-identical.
      const showCount = !this.setup.brief;
      ctx.fillRect(0, Hh * 0.36, W, this.setup.subtitle ? (showCount ? 104 : 82) : (showCount ? 86 : 64));
      ctx.fillStyle = P.cream;
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.setup.title || 'SKIRMISH', W / 2, Hh * 0.36 + 34);
      if (this.setup.subtitle) {
        ctx.font = '700 15px system-ui, sans-serif';
        ctx.fillStyle = P.hero;
        ctx.fillText(this.setup.subtitle, W / 2, Hh * 0.36 + 60);
        if (showCount) {
          ctx.fillStyle = P.cream;
          ctx.font = '600 14px system-ui, sans-serif';
          ctx.fillText(`${this.troops.length + 1} vs ${this.enemies.length}`, W / 2, Hh * 0.36 + 84);
        }
      } else if (showCount) {
        ctx.font = '600 15px system-ui, sans-serif';
        ctx.fillText(`${this.troops.length + 1} vs ${this.enemies.length}`, W / 2, Hh * 0.36 + 62);
      }
      ctx.globalAlpha = 1;
    }
    if (this.state === 'end') {
      const k = Math.min(1, this.stateT / 0.3);
      ctx.globalAlpha = k;
      ctx.fillStyle = P.ink;
      ctx.fillRect(0, Hh * 0.36, W, this.victory || this.retreated ? 96 : 112);
      ctx.fillStyle = this.victory ? P.hp : this.retreated ? P.cream : P.enemy;
      ctx.font = '900 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.victory ? 'VICTORY' : this.retreated ? 'WITHDRAWN' : 'DEFEAT', W / 2, Hh * 0.36 + 38);
      ctx.fillStyle = P.cream;
      ctx.font = '600 15px system-ui, sans-serif';
      const lost = this.startTroops - this.troops.length;
      if (this.victory) {
        ctx.fillText(`+${this.loot} gold  ·  ${this.kills} slain  ·  ${lost > 0 ? lost + ' of your men fell' : 'no losses'}`, W / 2, Hh * 0.36 + 68);
      } else if (this.retreated) {
        ctx.fillText(`You disengage in good order — ${this.troops.length} men ride out with you`, W / 2, Hh * 0.36 + 68);
      } else {
        ctx.fillText(`Slain by ${this.killedBy || 'the enemy'} — your warband scatters, poorer and fewer`, W / 2, Hh * 0.36 + 68);
        // diagnose the loss so the player knows what to change next time
        ctx.fillStyle = P.hero;
        ctx.font = '700 14px system-ui, sans-serif';
        // The hero's own survival is what decides an even fight, so say that rather than
        // pointing at HOLD: measured across camp raids, HOLD is not the stronger order, and
        // advice that sends the player to the weaker option teaches the wrong lesson.
        const advice = this.enemyStrength > this.playerStrength + 2
          ? `They were stronger (${this.enemyStrength} vs your ${this.playerStrength}) — recruit at a village, then return`
          : 'Even odds — you fell, not your warband. Dash out of the scrum before you are surrounded';
        ctx.fillText(advice, W / 2, Hh * 0.36 + 90);
      }
      ctx.globalAlpha = 1;
    }
  }
}
