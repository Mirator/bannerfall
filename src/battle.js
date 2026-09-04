// Battle scene — the Thronefall bar: readable, punchy, simple.
import {
  BIOMES, UNIT_TYPES, ENEMY_TYPES, HERO, enemyStrength, playerStrength, rankOf, rankMul,
  troopMaxHp,
} from './data.js?v=ra5856137107c';
import { perkMods } from './progression.js?v=ra5856137107c';
import { TAU, clamp, lerp, dist2, len, makeRng, deriveSeed, RNG_DOMAINS, Particles } from './engine.js?v=ra5856137107c';
import { SpatialGrid } from './battle/spatial-index.js?v=ra5856137107c';
import { ACTIONS } from './input-actions.js?v=ra5856137107c';
import {
  BASE, SQUAD_TYPES, SQUAD_LABELS, FIELD, ENGAGE_GAP, FLANK_GAP,
  BRACE_BONUS, BOW_SPREAD_BRACED, CHARGE_EXPOSURE, CHARGE_RECOVER, CHARGE_SPEED_MUL,
  DEPLOY_NO_MANS, DEPLOY_PICK_R, DEPLOY_ARM_T,
} from './battle/constants.js?v=ra5856137107c';
import {
  buildTerrain, terrainSpeedAt as terrainSpeed, crossingWaypoint as crossingWp,
  hasLineOfSight as losCheck,
} from './battle/terrain.js?v=ra5856137107c';
import { drawScene, drawProps } from './battle/render-scene.js?v=ra5856137107c';
import {
  updateSeparationPhase as separationPhase, getSpatialStats as spatialStats,
} from './battle/separation.js?v=ra5856137107c';
import {
  updateHeroPhase as heroPhase, updateTroopPhase as troopPhase,
  updateEnemyPhase as enemyPhase, updateStalematePhase as stalematePhase,
} from './battle/ai-phases.js?v=ra5856137107c';
import {
  damageEnemy as applyEnemyDamage, damageFriendly as applyFriendlyDamage,
  fireArrow as spawnArrow, endBattle as finishBattle, resolveBattleResult as resolveResult,
  arrowDamageAgainst as arrowDamage,
} from './battle/combat.js?v=ra5856137107c';
import {
  buildObjective as buildObjectiveState, updateObjectivePhase as objectivePhase,
  damageObjective as applyObjectiveDamage,
} from './battle/objectives.js?v=ra5856137107c';
import {
  buildEnemyCommand, updateEnemyCommandPhase as enemyCommandPhase,
  enemyStance as readEnemyStance, assignEnemySlots as assignSlotsForEnemies,
  placeEnemyDeployment as placeEnemyLine,
} from './battle/enemy-command.js?v=ra5856137107c';

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
    this.W = FIELD.W; this.H = FIELD.H;
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
    // Plan 029: the hero's perks, folded ONCE into the four battle numbers they can move
    // plus the two the phases read directly. Resolving them here rather than in the phases
    // keeps `progression.js` off the per-tick import graph entirely — only this module
    // imports it — and means a phase reads one number whether or not a perk is taken.
    // Every one of these defaults to the shipped constant, so a campaign with no perks
    // behaves exactly as it did before this plan.
    const mods = perkMods(setup.perks);
    this.perks = setup.perks ? [...setup.perks] : [];
    this.perkMods = mods;
    this.braceBonus = mods.braceBonus ?? BRACE_BONUS;
    this.bowSpreadBraced = BOW_SPREAD_BRACED * mods.bowSpreadBracedMul;
    this.chargeExposure = mods.chargeExposure ?? CHARGE_EXPOSURE;
    this.chargeRecover = mods.chargeRecover ?? CHARGE_RECOVER;
    this.chargeSpeedMul = mods.chargeSpeedMul ?? CHARGE_SPEED_MUL;
    this.bruteBonus = mods.bruteBonus;   // null keeps UNIT_TYPES' own declared value
    this.rally = mods.rally;             // 0 unless Warlord is taken
    this.rankEarlier = mods.rankEarlier; // Drillyard: thresholds arrive one battle sooner
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
    // distributed across the field's ~280 buckets (20x14 at the current size).
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
      // Plan 033: the hero opens facing the enemy on every approach, not hardcoded east —
      // slotPos() hangs the formation off travelFacing, and the deployment phase places
      // troops through it before anyone has moved, so "behind the commander" must mean
      // away from the enemy on a W/N/S approach too.
      x: cx0 - adx * ENGAGE_GAP / 2, y: cy0 - ady * ENGAGE_GAP / 2, vx: 0, vy: 0,
      facing: Math.atan2(ady, adx),
      hp: heroHp, maxHp: heroMaxHp,
      swingT: 0, dashT: 0, dashCdT: 0, hurtT: 0, bob: 0, iframesT: 0,
      // last heading actually travelled - drives formation, unlike `facing` which follows aim
      travelFacing: Math.atan2(ady, adx),
    };

    // terrain: obstacles, props, movement zones, LOS blockers, river crossings — built from
    // the world Brief when the fight has one (`setup.field`, Plan 024 Phase 2), or the
    // legacy arena templates when it does not (see buildTerrain's own doc comment and
    // AGENTS.md's battlefield section for why the briefless path is a normal, supported case).
    buildTerrain(this, setup.field);
    const fxRng = this.fxRng;
    // ground interest everywhere: grass tufts + pebble scatters so no region reads as a
    // flat colored rectangle (the critics' "battle void") — non-colliding, drawn under units
    // scatter counts are derived from area, not fixed, so density (props per square unit)
    // stays constant as the field size changes rather than the field reading sparser
    // or denser than the original 1250x880 tuning as it grows.
    const area = this.W * this.H;
    const tuftCount = Math.round(area / 42_000);
    for (let i = 0; i < tuftCount; i++) {
      this.props.push({ kind: 'tuft', x: 60 + fxRng() * (this.W - 120), y: 60 + fxRng() * (this.H - 120), s: 5 + fxRng() * 4, rot: fxRng() * 0.8 - 0.4 });
    }
    const pebbleCount = Math.round(area / 110_000);
    for (let i = 0; i < pebbleCount; i++) {
      this.props.push({ kind: 'pebbles', x: 80 + fxRng() * (this.W - 160), y: 80 + fxRng() * (this.H - 160), s: 3 + fxRng() * 3, rot: fxRng() * TAU });
    }
    // enemy centre, hoisted so the spawn-clearance filter below and the enemy-spawn
    // block further down stay in sync — one expression, not two copies.
    const enemyCx = cx0 + adx * ENGAGE_GAP / 2, enemyCy = cy0 + ady * ENGAGE_GAP / 2;
    // keep spawn areas clear
    this.obstacles = this.obstacles.filter(o =>
      o.kind === 'none' ||
      (dist2(o.x, o.y, this.hero.x, this.hero.y) > 180 * 180 &&
       dist2(o.x, o.y, enemyCx, enemyCy) > 220 * 220));
    // Obstacles never move once the fight starts, so the broad-phase grid is built exactly
    // once here rather than every frame. updateSeparationPhase's spatial path (large battles
    // only) also rebuilds it per frame, but that rebuild is a no-op in content since the
    // source array never changes — this one build is what serves designed-size battles,
    // which stay on the legacy separation path and never trigger that rebuild themselves.
    // Phase 4c (tangent steering, ai-phases.js) queries this grid every tick.
    this._obstacleGrid.rebuild(this.obstacles);
    this._maxObstacleR = 0;
    for (const o of this.obstacles) if (o.r > this._maxObstacleR) this._maxObstacleR = o.r;
    // Milestone 025 Slice C: the runtime objective (hold zone / break targets) is
    // built once the obstacle field above is final, so placement scans see the real
    // terrain. Elimination fights (no descriptor) build null state and cost nothing.
    buildObjectiveState(this);
    // Stronghold reserve waves (Entrenched holds) — plain data until due.
    this.pendingWaves = setup.waves && setup.waves.length
      ? setup.waves.map(w => ({ at: w.at, comp: [...w.comp] })) : null;
    // Reused output for steerAroundObstacle() (ai-phases.js) — one scratch entry per
    // instance, written and read synchronously within the same call, never allocated per unit.
    this._steerScratch = { x: 0, y: 0 };
    // Reused stand-in for the Break-the-position fallback (updateTroopPhase, ai-phases.js) —
    // one scratch entry per instance, same pattern as _steerScratch. It is written then read
    // synchronously within a single troop's iteration and never held past it, so sharing one
    // object across every troop's query in a frame is safe. vx/vy/isObjective never change
    // after this point: a guard is a structure and does not move, so those must stay fixed.
    this._objectiveEngageScratch = { x: 0, y: 0, vx: 0, vy: 0, isObjective: true, objRef: null, d: { radius: 0 } };
    this.blotches = [];
    const blotchCount = Math.round(area / 50_000);
    for (let i = 0; i < blotchCount; i++) {
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
    const regionCount = Math.round(area / 275_000);
    for (let i = 0; i < regionCount; i++) {
      const pts = [];
      const cx = fxRng() * this.W, cy = fxRng() * this.H, s = 220 + fxRng() * 280;
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
    shadeNear.moveTo(this.W + 30, -30); shadeNear.lineTo(this.W - 680, -30); shadeNear.lineTo(this.W + 30, 600); shadeNear.closePath();
    shadeNear.moveTo(-30, this.H + 30); shadeNear.lineTo(680, this.H + 30); shadeNear.lineTo(-30, this.H - 600); shadeNear.closePath();
    shadeFar.moveTo(this.W + 30, -30); shadeFar.lineTo(this.W - 1000, -30); shadeFar.lineTo(this.W + 30, 880); shadeFar.closePath();
    shadeFar.moveTo(-30, this.H + 30); shadeFar.lineTo(1000, this.H + 30); shadeFar.lineTo(-30, this.H - 880); shadeFar.closePath();

    // Props which never animate are rendered once into a bounded, TILED layer (Plan 024
    // Phase 6d). A single arena-sized canvas at this field's size is W+128 x H+128 =
    // 2628x1888 ~ 19.8 MB — the same league as the full-map bitmap AGENTS.md bans. A 2x2
    // grid of <=1400x1000 canvases keeps every individual canvas bounded regardless of how
    // large the field gets, which is the actual property the rule cares about (world static
    // geometry is "bounded Path2D caches plus camera culling", never one unbounded surface).
    // Each tile gets the SAME full drawProps() call with its own translate; canvas content
    // outside a tile's own width/height is simply never rasterized (a hard rectangular
    // clip, not custom code), so a prop straddling a tile boundary draws its correct half on
    // each side with no extra seam logic — the two halves are pixel-identical continuations
    // of the same shape because both tiles share one world coordinate system. Padding
    // (`PAD`) is added only on the field's OUTER edges (so an edge-hugging prop is not cut
    // off, matching the old layer's 64px margin); the internal seam at the field's midlines
    // carries no padding or overlap on purpose — that is exactly where the two tiles abut.
    const PAD = 64;
    const tileW = this.W / 2, tileH = this.H / 2;
    this._staticTiles = [];
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const wx0 = tx * tileW - (tx === 0 ? PAD : 0);
        const wx1 = (tx + 1) * tileW + (tx === 1 ? PAD : 0);
        const wy0 = ty * tileH - (ty === 0 ? PAD : 0);
        const wy1 = (ty + 1) * tileH + (ty === 1 ? PAD : 0);
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = wx1 - wx0; tileCanvas.height = wy1 - wy0;
        const tileCtx = tileCanvas.getContext('2d');
        tileCtx.translate(-wx0, -wy0);
        drawProps(this, tileCtx, false);
        this._staticTiles.push({ canvas: tileCanvas, wx: wx0, wy: wy0, ww: tileCanvas.width, wh: tileCanvas.height });
      }
    }

    // troops
    this.troops = [];
    (setup.troops || []).forEach((t, i) => this.spawnTroop(t.type, t.hp, t.vet));
    // enemies spawn AHEAD along your approach; ambushes pincer from ahead and behind
    // Reward roster records every actual arrival without mutating the initial setup.
    this.deployedEnemyTypes = [];
    this.enemies = [];
    const ecx = enemyCx, ecy = enemyCy;
    const bcx = cx0 - adx * FLANK_GAP, bcy = cy0 - ady * FLANK_GAP; // behind you
    // Plan 033: these scatter draws run for EVERY battle, deployment phase or not.
    // placeEnemyDeployment overwrites the positions for a deploy-phase fight, but consuming
    // the same two simRng() draws per enemy either way keeps the stream identical across
    // both paths — spawnEnemy's cd draw and every consumer after it — so the ambush path
    // replays pre-033 behaviour exactly. Do not delete them as dead code.
    (setup.enemies || []).forEach((e, i) => {
      const a = (i / Math.max(1, setup.enemies.length)) * TAU;
      let cx = ecx, cy = ecy;
      if (setup.ambush && i % 2 === 1) { cx = bcx; cy = bcy; }
      this.spawnEnemy(e.type,
        clamp(cx + Math.cos(a) * (90 + this.simRng() * 180), 50, this.W - 50),
        clamp(cy + Math.sin(a) * (75 + this.simRng() * 150), 50, this.H - 50));
    });
    this.totalEnemies = this.enemies.length;
    this.startTroops = this.troops.length;
    // Plan 027: the other side gets squads and a commander, built from the same battle seed
    // so nothing about it is persisted — a battle is not resumable and the commander is
    // reconstructible, exactly like simRng/fxRng. Its RNG stream is separate from simRng, so
    // it cannot perturb the draw sequence the rest of the fight depends on.
    buildEnemyCommand(this, battleSeed);
    // Reused output for enemyAnchorFor() (ai-phases.js), same instance-owned scratch pattern
    // as _steerScratch: written and read synchronously inside one enemy's iteration.
    this._enemyAnchorScratch = { x: 0, y: 0 };
    // strengths on the same scale the map uses (world.js's strength()/myStrength()) — for the defeat diagnosis
    this.enemyStrength = enemyStrength(setup.enemies);
    this.playerStrength = playerStrength(setup.troops, this.rankEarlier);
    this.kills = 0;
    this.deadEnemyTypes = [];   // exactly which enemy types died — not just how many
    this.lastAction = 0;      // sim time of the last hit dealt or taken
    this.lastDeath = 0;       // sim time anyone last actually died
    this.bloodlust = false;   // stalemate breaker: survivors stop kiting and close in
    // Plan 033: the timed deploy window is gone. Whether a fight opens with the paused
    // deployment phase still scales with WHO holds the initiative, read off the same
    // setup fields: a mutual field battle or you storming them = a deployment phase
    // (both sides form up before the horn); you running down a fleeing party
    // (deploy: 0) or their ambush = none — nobody paraded for a fight that started by
    // being caught.
    this.deployEnabled = !setup.ambush && (setup.deploy == null || setup.deploy > 0);
    this.deployArmT = DEPLOY_ARM_T;
    this.dragUnit = null; // the body under the mouse while placing, deployment phase only
    // Squad types the player explicitly ordered during intro or deployment (written by
    // issueCommand). confirmDeploy reads it to tell a deliberate FOLLOW from the neutral
    // default it promotes to HOLD — the stance string alone cannot make that distinction.
    this._deployOrdered = new Set();
    if (this.deployEnabled) placeEnemyLine(this);
    this.assignSlots();
    if (this.deployEnabled) {
      // The player's men deploy formed too, on FOLLOW's own slot geometry, so the phase
      // opens on a drawn-up line instead of the ride-in scatter (an instant confirm then
      // holds a line, not a blob). The scatter draws in spawnTroop still ran — same
      // stream-stability reason as the enemy side's, see the enemy spawn loop above.
      for (const t of this.troops) {
        const p = this.slotPos(t);
        t.x = p.x; t.y = p.y;
      }
    }
  }

  // Plan 029: `vet` is the persisted battles-won count. Rank is derived here and folded
  // into ONE multiplier that scales hit points and damage alike — the same shape
  // POWER_EFFICIENCY uses, which is what lets playerStrength() price a veteran without a
  // second concept. `rankEarlier` is the Drillyard perk, resolved on the instance.
  spawnTroop(type, hp, vet) {
    const d = UNIT_TYPES[type];
    const rank = rankOf(vet, this.rankEarlier);
    const mul = rankMul(rank);
    // troopMaxHp is the ONE formula for the ranked ceiling — the save validator reads the
    // same function, so a veteran's battle hit points can never fail its load bound.
    const maxHp = troopMaxHp({ type, vet }, this.rankEarlier);
    // Spawn behind the hero relative to the approach axis, not always to the west — on a
    // 'W' approach the old fixed-west offset spawned troops between the hero and the enemy.
    // Exactly two simRng() draws, in this order, so downstream RNG consumers are unperturbed.
    const back = 60 + this.simRng() * 80;
    const side = (this.simRng() - 0.5) * 160;
    this.troops.push({
      type, team: 'friendly', d,
      x: this.hero.x - this.adx * back - this.ady * side,
      y: this.hero.y - this.ady * back - this.adx * side,
      // A wounded veteran keeps the hit points he rode in with; an unwounded one is topped
      // up to his RANKED maximum, which is the same bound the save validator enforces.
      vx: 0, vy: 0, hp: hp != null ? Math.min(hp, maxHp) : maxHp, maxHp,
      cd: this.simRng() * d.cooldown,
      vet: vet || 0, rank, vetMul: mul,
      // Plan 032 made `facing` load-bearing (the flank arc reads it on every landed melee
      // blow), so a body must open facing the enemy on every approach — the hardcoded east
      // it used to carry gave the enemy a deterministic 1.35x opening tax on three of four
      // approaches, and drew the deployment tableau standing backwards.
      facing: Math.atan2(this.ady, this.adx),
      slot: null, target: null, lunge: 0, bob: this.fxRng() * TAU, holdX: null, holdY: null, flash: 0,
      exposedT: 0,
      // Plan 029: seconds left on this body's "came in at a rush" latch (the brace read)
      // and on the Warlord rally window. Both stay 0 for a body that never charges and a
      // campaign with no perks.
      rushT: 0, rallyT: 0,
      // Phase 5: seconds this unit's engaged target has been out of line of sight. Only a
      // ranged unit ever accumulates it; a melee unit's copy simply stays at 0 forever.
      blindT: 0,
    });
  }
  spawnEnemy(type, x, y) {
    const d = ENEMY_TYPES[type];
    this.deployedEnemyTypes.push(type);
    this.enemies.push({
      type, team: 'enemy', d, x, y, vx: 0, vy: 0, hp: d.hp, maxHp: d.hp,
      // Facing the player's side of the field for any approach (the old hardcoded west was
      // only right for 'E'); the rear half of an ambush pincer self-corrects within ticks,
      // exactly as it always did.
      cd: 0.5 + this.simRng() * d.cooldown, windupT: 0, facing: Math.atan2(-this.ady, -this.adx),
      target: null, lunge: 0, bob: this.fxRng() * TAU, flash: 0, slamT: 0,
      blindT: 0, // Phase 5: only a ranged enemy (raider) ever moves this off 0.
      // Plan 027, mirroring the troop record: charge exposure lingers after the order
      // changes, and the enemy commander's formation slot on a held line.
      exposedT: 0, eslot: null,
      // Plan 027: seconds a stalking wolf is still breaking off after a bite (hit and run).
      recoilT: 0,
      // Plan 029: the same rush latch the player's bodies carry — the brace predicate is
      // one function used by both sides, so both sides need the field.
      rushT: 0,
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
    // Intro commands are as deliberate as deployment commands. Remember even an
    // explicit FOLLOW on the neutral default so confirmation does not turn it into HOLD.
    const preDeploy = this.deployEnabled && (this.state === 'intro' || this.state === 'deploy');
    if (preDeploy) for (const type of targets) this._deployOrdered.add(type);
    // Re-issuing a pre-fight order acknowledges the choice; live repeats are no-ops
    // except for HOLD, which re-anchors the line.
    if (!preDeploy && cmd !== 'hold' && targets.every(type => this.squads[type].stance === cmd)) return;
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
      // stated a third time (brief -> this banner -> the deployment panel).
      // Keyed strictly off setup.brief so scenario('battle_*') (never brief-routed) is
      // provably untouched.
      const introDur = this.setup.brief ? 0.6 : 1.1;
      if (this.stateT > introDur || (this.stateT > 0.6 && this.game.input.pressed.size > 0)) {
        // Plan 033: a fight with a deployment phase pauses on it; only an ambush or a
        // caught-fleeing fight (deploy: 0) goes straight to blows.
        this.state = this.deployEnabled ? 'deploy' : 'fight';
        this.game.sfx.horn(175);
      }
      // Presentation keeps breathing through a paused state — including the command-flash
      // decay, or an order issued here freezes its banner on screen (review of Plan 033).
      this.updatePresentationPhase(dt);
      return true;
    }
    if (this.state === 'deploy') {
      this.updateDeployPhase(dt);
      if (this.commandFlash.t > 0) this.commandFlash.t -= dt;
      // The camera holds still while a body is being dragged: the fit-to-action camera
      // follows the dragged body, which shifts toWorld(cursor) next frame and closes a
      // feedback loop (measured 1.4-8.7x over-travel before the clamps arrest it). Frozen,
      // the body tracks the cursor exactly; the fit resumes on release, which is also what
      // walks the view toward the rear of the zone across successive drags.
      if (!this.dragUnit) this.updateCamera(dt);
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
          // Plan 029: `vet` rides out with the man who earned it. The INCREMENT is not
          // applied here — battle-transition.js owns it, because only the world knows
          // whether this was a victory and what the banner's ceiling is.
          survivors: this.troops.map(t => ({ type: t.type, hp: t.hp, vet: t.vet || 0 })),
          deadTypes: this.deadEnemyTypes.slice(),
        };
        this.setup.onEnd && this.setup.onEnd(result);
      }
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- Plan 033: deployment
  // The paused placement phase. Runs INSTEAD of the tick pipeline (updateSceneState returns
  // true out of update()), so nothing here advances battle.time, cooldowns, or any clock —
  // the pause is structural, not a flag every phase has to honour. Mouse placement reads
  // the cursor through Camera.toWorld exactly like hero aim does: player input reaching the
  // simulation is the one sanctioned crossing of the presentation boundary, and toWorld
  // never includes the render-time shake offset (AGENTS.md).
  updateDeployPhase(dt) {
    const inp = this.game.input;
    if (this.deployArmT > 0) this.deployArmT -= dt;
    // Squad selection and pre-orders still land here, as they already did during the intro.
    this.updateCommandPhase(inp);
    const mw = this.game.camera.toWorld(inp.mouse.x, inp.mouse.y);
    if (inp.mouse.clicked) {
      let best = null, bd = DEPLOY_PICK_R * DEPLOY_PICK_R;
      for (const t of this.troops) {
        const d = dist2(mw.x, mw.y, t.x, t.y);
        if (d < bd) { bd = d; best = t; }
      }
      if (dist2(mw.x, mw.y, this.hero.x, this.hero.y) < bd) best = this.hero;
      this.dragUnit = best;
    }
    if (!inp.mouse.down) this.dragUnit = null;
    if (this.dragUnit) {
      const p = this.clampToDeployZone(mw.x, mw.y);
      // Plan 034: never place a body inside a collider. The river wall is the sharp case —
      // its plug lattice has no feasible interior, so a body dropped there would be ejected
      // by pushOutOf to an arbitrary side of the river at the horn, with its hold anchor
      // baked inside the wall — but the same guard keeps hold anchors out of rocks and
      // trees. The drag simply refuses to move onto blocked ground and holds its last
      // valid spot; O(obstacles) once per drag frame.
      const ur = this.dragUnit.d ? this.dragUnit.d.radius : 14;
      let blocked = false;
      for (const o of this.obstacles) {
        if (dist2(p.x, p.y, o.x, o.y) < (o.r + ur) * (o.r + ur)) { blocked = true; break; }
      }
      if (!blocked) {
        this.dragUnit.x = p.x; this.dragUnit.y = p.y;
        this.dragUnit.vx = 0; this.dragUnit.vy = 0;
      }
    }
    if (this.deployArmT <= 0 && inp.pressedAction(ACTIONS.CONFIRM)) this.confirmDeploy();
  }

  // The player's deployment ground: his side of the field, up to DEPLOY_NO_MANS short of
  // the midline along the approach axis. Projection, not rejection — a drag past the
  // frontier slides along it instead of sticking.
  clampToDeployZone(x, y) {
    const cx = this.W / 2, cy = this.H / 2;
    const s = (x - cx) * this.adx + (y - cy) * this.ady;
    const over = s + DEPLOY_NO_MANS;
    if (over > 0) { x -= this.adx * over; y -= this.ady * over; }
    return { x: clamp(x, 40, this.W - 40), y: clamp(y, 40, this.H - 40) };
  }

  confirmDeploy() {
    if (this.state !== 'deploy') return;
    const P = this.palette;
    this.state = 'fight';
    this.dragUnit = null;
    // The placed line means something: a squad the player gave NO order holds where he put
    // it until ordered otherwise. `_deployOrdered` (written by pre-fight issueCommand
    // calls) is what separates the neutral default from a deliberate FOLLOW pressed during
    // the phase — the stance string alone cannot, and silently overwriting a chosen order
    // is the misfire issueCommand's own guard exists to prevent.
    //
    // This deliberately does NOT route through issueCommand('hold'): an order anchors the
    // squad banner at the commander, but a deployment anchors each banner at the squad's
    // own placed ground — the marker must point at the line the player just built, not at
    // wherever the hero stands. Anything new the HOLD order path learns (see issueCommand)
    // must be mirrored here.
    for (const type of this.mannedSquads()) {
      const squad = this.squads[type];
      const promoted = squad.stance === 'follow' && !this._deployOrdered.has(type);
      if (promoted) squad.stance = 'hold';
      if (squad.stance !== 'hold') continue;
      let cx = 0, cy = 0, n = 0;
      for (const t of this.troops) {
        if (t.type !== type) continue;
        t.holdX = t.x; t.holdY = t.y;
        cx += t.x; cy += t.y; n++;
        this.particles.ring(t.x, t.y, 16, P.cream, 0.3, 2);
      }
      // Re-anchored for pre-ordered HOLD squads too: their order-time anchor points at
      // where the hero stood when the key was pressed, which dragging has since made stale.
      squad.holdX = cx / n; squad.holdY = cy / n;
    }
    this.command = this.aggregateStance();
    this.game.sfx.horn(155);
    this.commandFlash = { text: 'THEY ADVANCE!', t: 1.0 };
  }

  // Plan 033: the deployment phase is a structural pause. main.js's campaign playT accrual
  // duck-types this exact predicate off whatever scene is live (the world's modal freeze
  // already defines it), and an unbounded pause must not inflate reported campaign time —
  // the same rule the world-scene modals carry (see main.js's blocking gate).
  isTimeFrozen() {
    return this.state === 'deploy';
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
    // Plan 027: the enemy commander reads the field and issues orders BEFORE anybody moves,
    // so both sides act on the same tick's orders — the player's own orders were just read
    // above. Its own decisions are throttled to CMD_TICK internally; this call is a timer
    // bump on every other tick.
    this.updateEnemyCommandPhase(dt);
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
    // Milestone 025 Slice C: objective advance sits between stalemate and result so
    // resolveBattleResult() — the single terminal decision point — always judges
    // this tick's objective status.
    this.updateObjectivePhase(dt);
    this.resolveBattleResult(dt, h, ax);
    this.updatePresentationPhase(dt);
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
          // Plan 029: the shooter's declared counter is resolved against the body the
          // arrow actually found, not the one it was aimed at.
          if (e) this.damageEnemy(e, arrowDamage(this, p, e.type), 0, 0, 'troop');
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

  // Fit-to-action camera: frame hero + all living units, clamp inside the arena.
  //
  // The pre-fight states ('intro' and the paused 'deploy') frame the field DIFFERENTLY, and
  // the reason is a defect the headless playtest recorded: the hero bias below is what makes
  // the live fight readable, but during deployment it pushed the enemy formation off screen
  // and left the player forming a line against nothing but an edge chevron. Both boxes are
  // the same AABB — the difference is only where the view is centred, plus the deploy
  // frontier joining the box so the ground the player may actually place men on is framed
  // with him. Presentation only: nothing here is read back by a phase, and the drag in
  // updateDeployPhase still goes through Camera.toWorld, which is unchanged.
  updateCamera(dt) {
    const cam = this.game.camera, h = this.hero;
    // 'intro' qualifies only for a fight that is ABOUT to deploy: the banner is the first
    // second of the same tableau, and letting the two states disagree would snap the view
    // forward on the frame the horn sounds. An ambush (or a caught-fleeing `deploy: 0`
    // fight) has no line to form and no frontier to show, so its intro keeps the hero bias
    // below — being jumped is a fight about where YOU are.
    const framingBothLines = this.state === 'deploy' ||
      (this.state === 'intro' && this.deployEnabled);
    let minX = h.x, maxX = h.x, minY = h.y, maxY = h.y;
    const grow = (x, y) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };
    for (const t of this.troops) grow(t.x, t.y);
    for (const e of this.enemies) grow(e.x, e.y);
    // The player's frontier — the far edge of clampToDeployZone, DEPLOY_NO_MANS short of
    // the midline. Drawn during the phase, so it must be inside the view that frames it.
    if (framingBothLines) {
      grow(this.W / 2 - this.adx * DEPLOY_NO_MANS, this.H / 2 - this.ady * DEPLOY_NO_MANS);
    }
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
    if (framingBothLines) {
      // Centring on the box midpoint is what guarantees every body on both sides is inside
      // the view, since the zoom above was fitted to that same box. The hero bias is exactly
      // what broke that guarantee: he stands ENGAGE_GAP/2 behind the midpoint.
      cx = bx; cy = by;
      // …unless the bodies cannot fit even at the 0.80 floor. That is the ordinary case on a
      // N/S approach: ENGAGE_GAP is 820 and a 720px-tall viewport shows 900 world px at the
      // floor, which the two formations' depth alone overruns. Centring the whole box then
      // spends the view on the enemy's REAR ranks and pushes the player's own line off the
      // near edge, so bias along the approach axis instead — frame the span from the
      // player's rearmost man to the enemy's FRONT edge, the two things the phase is about,
      // and let the enemy's rear ranks be what falls outside. When even that span is longer
      // than the view, its midpoint splits the shortfall evenly between the two rather than
      // sacrificing one end whole.
      // The comparison is against the UNPADDED extents on purpose: `pad` is breathing room,
      // not a requirement, so a field that fits its bodies with the pad partly spent is
      // still a fit. Using boxW/boxH here would put an exactly-fitting field one float
      // rounding away from taking the fallback branch it does not need.
      if (maxX - minX > cam.w / z || maxY - minY > cam.h / z) {
        const scx = this.W / 2, scy = this.H / 2;
        const sOf = (x, y) => (x - scx) * this.adx + (y - scy) * this.ady;
        let ownRear = sOf(h.x, h.y), enemyFront = Infinity;
        for (const t of this.troops) ownRear = Math.min(ownRear, sOf(t.x, t.y));
        for (const e of this.enemies) enemyFront = Math.min(enemyFront, sOf(e.x, e.y));
        if (Number.isFinite(enemyFront)) {
          // Rebuild the target from the box's PERPENDICULAR component and this axis span, so
          // the lateral framing the box already earned is kept untouched.
          const perp = (bx - scx) * -this.ady + (by - scy) * this.adx;
          const s = (ownRear + enemyFront) / 2;
          cx = scx + this.adx * s - this.ady * perp;
          cy = scy + this.ady * s + this.adx * perp;
        }
      }
    }
    // clamp view inside arena (+ margin for the cliff band)
    const vw = cam.w / cam.zoom / 2, vh = cam.h / cam.zoom / 2, M = 110; // show coastline, not a band
    if (vw * 2 < this.W + M * 2) cx = clamp(cx, vw - M, this.W - vw + M); else cx = this.W / 2;
    if (vh * 2 < this.H + M * 2) cy = clamp(cy, vh - M, this.H - vh + M); else cy = this.H / 2;
    cam.follow(cx, cy, dt, 5);
  }

  // ---------------------------------------------------------------- delegating seams
  // The implementations live under src/battle/. These stay instance methods on purpose,
  // not direct module calls: world-battle-seams.spec.js patches the ordered phases to
  // assert their sequence, and the campaign/QA suites drive endBattle and the damage
  // entry points straight off the scene. A method here is the seam those rely on.
  updateHeroPhase(dt, inp, h, ax) {
    heroPhase(this, dt, inp, h, ax);
  }

  updateTroopPhase(dt, h) {
    troopPhase(this, dt, h);
  }

  updateEnemyPhase(dt, h) {
    enemyPhase(this, dt, h);
  }

  // Plan 027 seams. updateEnemyCommandPhase is one of the ordered phases, so it is a method
  // for the same reason its siblings are: world-battle-seams.spec.js patches the pipeline by
  // name. enemyStance mirrors squadStance as the per-unit read every enemy AI branch and the
  // damage path go through; assignEnemySlots is reached by the reinforcement-wave path.
  updateEnemyCommandPhase(dt) {
    enemyCommandPhase(this, dt);
  }

  enemyStance(e) {
    return readEnemyStance(this, e);
  }

  assignEnemySlots() {
    assignSlotsForEnemies(this);
  }

  updateStalematePhase() {
    stalematePhase(this);
  }

  // Milestone 025 Slice C seams. updateObjectivePhase is one of the ordered phases
  // (patchable by the seam tests like its siblings); damageObjective mirrors
  // damageEnemy/damageFriendly as an instance entry point used by ai-phases.js.
  updateObjectivePhase(dt) {
    objectivePhase(this, dt);
  }

  damageObjective(target, dmg) {
    applyObjectiveDamage(this, target, dmg);
  }

  damageEnemy(e, dmg, kx, ky, source) {
    applyEnemyDamage(this, e, dmg, kx, ky, source);
  }

  damageFriendly(f, isHero, dmg, from) {
    applyFriendlyDamage(this, f, isHero, dmg, from);
  }

  // `spread` is forwarded as-is so combat.js keeps ownership of its BOW_SPREAD default.
  // Plan 029: `bonusVs` is the shooter's declared per-type counter table, carried ON the
  // arrow rather than folded into `dmg` at the moment it is loosed. An arrow resolves
  // against whoever is nearest where it lands, which is not necessarily the body it was
  // aimed at, so baking an anti-brute multiplier in at fire time would pay it out on a
  // bandit standing next to the brute.
  fireArrow(sx, sy, tx, ty, friendly, dmg, speed, srcType, spread, bonusVs) {
    spawnArrow(this, sx, sy, tx, ty, friendly, dmg, speed, srcType, spread, bonusVs);
  }

  endBattle(victory, retreated) {
    finishBattle(this, victory, retreated);
  }

  resolveBattleResult(dt, h, ax) {
    resolveResult(this, dt, h, ax);
  }

  // Separation lives in battle/separation.js. Both of these stay methods: the phase is
  // one of the ordered seams world-battle-seams.spec.js patches to assert call order, and
  // performance.spec.js drives both directly off the instance.
  updateSeparationPhase(h) {
    separationPhase(this, h);
  }

  getSpatialStats() {
    return spatialStats(this);
  }

  // Terrain queries live in battle/terrain.js; both stay methods because ai-phases.js calls
  // them off the instance every tick per unit, and world-battle-seams-style tests reach
  // named instance methods rather than the module functions directly (AGENTS.md).
  terrainSpeedAt(x, y) {
    return terrainSpeed(this, x, y);
  }

  crossingWaypoint(x, y, tx, ty) {
    return crossingWp(this, x, y, tx, ty);
  }

  // Phase 5: segment-vs-blocker visibility test, called from ai-phases.js for target
  // selection and the pre-fire gate, and reached directly by
  // tests/e2e/battlefield-terrain.spec.js.
  hasLineOfSight(sx, sy, tx, ty) {
    return losCheck(this, sx, sy, tx, ty);
  }

  // Rendering lives in battle/render-scene.js; this stays a method because main.js
  // drives the scene through the same draw(ctx) seam for every scene type.
  draw(ctx) {
    drawScene(this, ctx);
  }
}
