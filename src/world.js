// Campaign world — the Bannerlord bar: settlements, roaming parties, army snowball.
import { PAL, WORLD, HERO, BALANCE, enemyStrength, playerStrength, rollComposition } from './data.js?v=rd5531dcfef09';
import { TAU, clamp, lerp, angLerp, dist2, len, makeRng, deriveSeed, RNG_DOMAINS, distToSegment, Particles } from './engine.js?v=rd5531dcfef09';
import { SAVE_VERSION } from './save.js?v=rd5531dcfef09';
import { buildAftermathModel } from './world-screens.js?v=rd5531dcfef09';
import { drawScene } from './world/render-scene.js?v=rd5531dcfef09';
import {
  startBattle as beginBattle,
  requestBattle as openBattleBrief,
  cancelBrief as dismissBrief,
  confirmBrief as acceptBrief,
  updateWorldScreens as worldScreens,
} from './world/battle-transition.js?v=rd5531dcfef09';
import {
  say as sayToast,
  costAt as unitCostAt,
  recruit as recruitUnit,
  approachTo as approachPoint,
  isSettlementOccupied as settlementOccupied,
  updateSettlementInteractions as settlementInteractions,
  campVictoryExtra as campVictoryBookkeeping,
  updateCampInteraction as campInteraction,
} from './world/settlement-interactions.js?v=rd5531dcfef09';
import {
  buildTerrainGeometry as buildGeometry, linesToSegments as sampleToSegments,
  buildStaticPaths as bakeStaticPaths, buildScenery as placeScenery,
  lineClear as segmentClear, pathGoal as navPathGoal,
} from './world/terrain.js?v=rd5531dcfef09';

const P = PAL.world;

export class World {
  constructor(game, save) {
    this.game = game;
    this.simRng = null;
    this.fxRng = null;
    this.particles = new Particles(() => this.game.effectsEnabled);
    this.W = WORLD.w; this.H = WORLD.h;
    this.time = 0;
    this.msg = null; this.msgT = 0;
    // Plan 021: presentation-only hover state. Written and read only in draw() —
    // AGENTS.md: "simulation must not read presentation." pointerEverMoved is a latch,
    // not `input.mouse.moved` itself: `moved` is cleared by endFrame() (engine.js) at
    // the end of EVERY Game.update() call, and Game.draw() always runs after at least
    // one update() in the same tick whenever a render actually happens — so by the time
    // draw() can read it, `moved` has already gone false again for the ordinary case of
    // one update per rendered frame. `mouse.x`/`mouse.y` are not reset by endFrame(),
    // only `moved`/`clicked` are, so the latch instead remembers the pointer's position
    // at construction time and fires once the CURRENT position differs from it — this
    // is unaffected by the update/draw ordering and still boot-safe, since the default
    // pointer sits on the hero token (canvas centre) at construction.
    this.pointerBootX = game.input.mouse.x;
    this.pointerBootY = game.input.mouse.y;
    this.pointerEverMoved = false;
    this.hoverTarget = null;
    // world-scene modals (Plan 021 Slice B): the pre-battle brief and the aftermath.
    // sceneName stays 'world' for both — see requestBattle()/updateWorldScreens().
    this.screen = null;
    this.pending = null;

    // persistent campaign state (survives battles)
    this.save = save || {
      version: SAVE_VERSION,
      gold: BALANCE.startGold,
      heroHp: HERO.hp, heroMaxHp: HERO.hp,
      troops: Array.from({ length: BALANCE.startTroops }, () => ({ type: 'spear' })),
      armyCap: BALANCE.armyCapBase,
      camps: WORLD.camps.map(c => ({ id: c.id, razed: false })),
      settlements: WORLD.settlements.map(s => ({ id: s.id, occupied: false })),
      won: false,
      x: WORLD.heroStart.x, y: WORLD.heroStart.y,
      parties: null,
      // each campaign rolls its own seed: garrisons, party comps and spawns differ per run —
      // unless a test pinned one via scenario('world', {seed}) for reproducible test worlds
      // OS/browser entropy chooses a fresh campaign seed; all in-run draws use
      // the derived simulation/presentation domains below.
      runSeed: game.testSeed != null ? game.testSeed : (Math.random() * 1e9) | 0,
      stats: { won: 0, kills: 0, lost: 0, playT: 0 },
      hard: !!game.hardNext,
      battleCount: 0,
    };
    game.hardNext = false;
    game.testSeed = null;

    this.hero = { x: this.save.x, y: this.save.y, vx: 0, vy: 0, facing: 0, bob: 0 };
    this.grace = save ? BALANCE.battleGrace : 0;   // ambush immunity after a battle
    // world randomness evolves across the campaign AND differs per run
    const campaignSeed = ((this.save.runSeed ?? 777) + (this.save.battleCount ?? 0) * 7919) >>> 0;
    this.simRng = makeRng(deriveSeed(campaignSeed, RNG_DOMAINS.WORLD_SIM));
    this.fxRng = makeRng(deriveSeed(campaignSeed, RNG_DOMAINS.WORLD_FX));
    if (this.save.toast) { this.say(this.save.toast, 3.5); this.save.toast = null; }
    // Plan 021 design decision 9: the aftermath payload rides on game.pendingAftermath,
    // never on `save` — a refresh mid-aftermath loses the screen, which is correct (the
    // checkpoint is a map snapshot, not a battle). Consumed and cleared exactly once,
    // beside the toast replay above, and only when this world is not the victory ending
    // (a won stronghold raid's aftermath IS the victory screen — see updateCampInteraction/
    // startVictory ordering in update()).
    if (game.pendingAftermath && !this.save.won) {
      this.screen = buildAftermathModel(game.pendingAftermath);
    }
    game.pendingAftermath = null;

    // scenery uses a fixed authored seed: it is static map input, not a campaign
    // stream, so changing effects can never perturb collision geometry.
    this.scenery = this.buildScenery();
    // Terrain is defined once as sampled polylines. Rendering and simulation both consume
    // these cached points, so a curve can never be visible in one system but absent in the
    // other. The segment arrays below are a derived query representation, not a second map.
    this.terrain = this.buildTerrainGeometry();
    this.riverLines = this.terrain.rivers;
    this.roadLines = this.terrain.roads;
    this.riverSegs = this.linesToSegments(this.riverLines);
    this.riverBands = this.riverLines.map(line => {
      const raw = this.linesToSegments([line]);
      const segs = new Float64Array(raw.length * 8);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      raw.forEach((s, i) => {
        const o = i * 8;
        for (let j = 0; j < 8; j++) segs[o + j] = s[j];
        if (s[4] < minX) minX = s[4]; if (s[5] > maxX) maxX = s[5];
        if (s[6] < minY) minY = s[6]; if (s[7] > maxY) maxY = s[7];
      });
      return { minX, maxX, minY, maxY, segs };
    });
    this.bridgePts = [];
    for (const r of this.rivers) {
      for (const b of r.bridges) this.bridgePts.push(b);
    }
    this.roadSegs = this.linesToSegments(this.roadLines);
    this._staticPaths = this.buildStaticPaths();
    this.solids = this.scenery.filter(it => it.kind === 'mtn' || it.kind === 'rock')
      .map(it => ({ x: it.x, y: it.y - (it.kind === 'mtn' ? it.s * 0.25 : 0), r: it.kind === 'mtn' ? it.s * 0.72 : it.s * 1.1 }))
      // bridge mouths must be open: no solid may sit within reach of a crossing
      .filter(o => this.bridgePts.every(([bx, by]) => dist2(o.x, o.y, bx, by) > (150 + o.r) * (150 + o.r)));
    // navigation graph: each bridge contributes two staging nodes (one per bank, set
    // perpendicular to its river) plus the bridge center; parties route through it with
    // line-of-sight Dijkstra — no more straight-line-only pursuit grinding on banks
    this.navNodes = [];
    for (const [bx, by] of this.bridgePts) {
      let best = null, bd = Infinity;
      for (const [ax, ay, cx, cy] of this.riverSegs) {
        const d = distToSegment(bx, by, ax, ay, cx, cy);
        if (d < bd) { bd = d; best = [ax, ay, cx, cy]; }
      }
      const [ax, ay, cx, cy] = best;
      const dl = Math.hypot(cx - ax, cy - ay) || 1;
      const nx = -(cy - ay) / dl, ny = (cx - ax) / dl;
      this.navNodes.push({ x: bx, y: by });
      // two staging rings per side: near (for the final approach) and far (visible from
      // most of the bank, so paths never have to skim along the river's blocked band)
      for (const s of [1, -1]) {
        for (const r of [110, 260]) {
          const wx = bx + nx * s * r, wy = by + ny * s * r;
          if (wx > 40 && wx < this.W - 40 && wy > 40 && wy < this.H - 40 && !this.blockedAt(wx, wy)) {
            this.navNodes.push({ x: wx, y: wy });
          }
        }
      }
    }
    // precompute node-to-node visibility
    const N = this.navNodes.length;
    this.navEdges = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        if (this.lineClear(this.navNodes[i].x, this.navNodes[i].y, this.navNodes[j].x, this.navNodes[j].y)) {
          const w = Math.hypot(this.navNodes[i].x - this.navNodes[j].x, this.navNodes[i].y - this.navNodes[j].y);
          this.navEdges[i].push([j, w]); this.navEdges[j].push([i, w]);
        }
      }
    }
    this._navScratch = {
      start: new Float64Array(N), toGoal: new Float64Array(N), dist: new Float64Array(N),
      first: new Int32Array(N), done: new Uint8Array(N),
    };

    // roaming parties: restore persisted ones, or spawn the initial set
    this.parties = [];
    if (this.save.parties) {
      for (const p of this.save.parties) {
        this.parties.push({
          camp: p.camp, x: p.x, y: p.y, vx: 0, vy: 0, facing: 0, bob: this.fxRng() * TAU,
          comp: p.comp, home: p.home, wander: null, wanderT: 0, waryT: p.waryT || 0,
          clashT: p.clashT || 0, occupying: p.occupying || null, raid: null,
          navT: this.simRng() * 0.3, navGoal: null, navFor: null,
          _navGoalVisibility: new Float64Array(N), _navGoalX: NaN, _navGoalY: NaN,
        });
      }
    } else {
      for (const c of WORLD.camps) {
        const st = this.save.camps.find(s => s.id === c.id);
        if (st.razed || c.stronghold) continue; // the Hold garrisons its walls; it doesn't raid — its camps do
        const n = 1 + (this.simRng() * 2 | 0);
        for (let i = 0; i < n; i++) this.spawnParty(c);
      }
    }
    this.spawnT = 30;
    this.persistParties();
  }

  persistParties() {
    this.save.parties = this.parties.map(p => {
      const rec = { camp: p.camp, x: p.x, y: p.y, comp: p.comp, home: p.home, waryT: p.waryT || 0, clashT: p.clashT || 0 };
      if (p.occupying) rec.occupying = p.occupying;
      return rec;
    });
  }

  syncLiveStateToSave() {
    this.save.x = this.hero.x;
    this.save.y = this.hero.y;
    this.persistParties();
    return this.save;
  }

  inSafeZone(x, y) {
    for (const s of WORLD.settlements) {
      if (dist2(x, y, s.x, s.y) < BALANCE.settlementSafeR * BALANCE.settlementSafeR) return true;
    }
    return false;
  }

  // Shared by every river-collision query below — kept as one method so the 95px bridge
  // exemption radius can never drift out of sync between blockedAt and riverBlockedAt.
  nearAnyBridge(x, y) {
    for (const [bx, by] of this.bridgePts) {
      if (dist2(x, y, bx, by) < 95 * 95) return true;
    }
    return false;
  }
  // Terrain rules: rivers block except within reach of a bridge; mountains and rocks are solid.
  // The bridge exemption (95) must overlap the river-block band (22) with margin from every
  // approach angle, or a dead pocket forms where units freeze against the bank.
  blockedAt(x, y) {
    if (!this.nearAnyBridge(x, y) && this.riverDistanceAt(x, y, 22) < 22) return true;
    for (const o of this.solids) {
      if (dist2(x, y, o.x, o.y) < o.r * o.r) return true;
    }
    return false;
  }
  onRoad(x, y) {
    for (const [ax, ay, bx, by] of this.roadSegs) {
      if (distToSegment(x, y, ax, ay, bx, by) < 28) return true;
    }
    return false;
  }

  // A bounded "is anything within `pad`" query, not a general nearest-distance function:
  // the per-segment bbox cull is only guaranteed to keep every segment truly within `pad`
  // (provable via triangle inequality, since a segment's bbox contains it), so a result is
  // exact whenever it's < pad, but calling this with a pad smaller than the true distance
  // can under-report (even return Infinity) instead of the real value. Every caller must
  // compare the result against this same `pad`, never against a stricter threshold.
  riverDistanceAt(x, y, pad = 0) {
    let best = Infinity;
    for (const band of this.riverBands) {
      if (x < band.minX - pad || x > band.maxX + pad || y < band.minY - pad || y > band.maxY + pad) continue;
      for (let o = 0; o < band.segs.length; o += 8) {
        const ax = band.segs[o], ay = band.segs[o + 1], bx = band.segs[o + 2], by = band.segs[o + 3];
        const minX = band.segs[o + 4], maxX = band.segs[o + 5], minY = band.segs[o + 6], maxY = band.segs[o + 7];
        if (x < minX - pad || x > maxX + pad || y < minY - pad || y > maxY + pad) continue;
        const d = distToSegment(x, y, ax, ay, bx, by);
        if (d < best) best = d;
      }
    }
    return best;
  }
  // River-only collision for AI parties: rivers block everyone, but bandits know the goat
  // paths through the mountains (soft-steered around them instead of hard-blocked) — this
  // keeps the coherent river/bridge rule while making AI freezes structurally impossible.
  riverBlockedAt(x, y, pad) {
    if (this.nearAnyBridge(x, y)) return false;
    const reach = 22 + (pad || 0);
    return this.riverDistanceAt(x, y, reach) < reach;
  }
  blockedAtPad(x, y, pad) {
    return this.riverBlockedAt(x, y, pad);
  }

  visible(x, y, radius = 100) {
    const cam = this.game.camera, hw = cam.w / cam.zoom / 2, hh = cam.h / cam.zoom / 2;
    return x > cam.x - hw - radius && x < cam.x + hw + radius && y > cam.y - hh - radius && y < cam.y + hh + radius;
  }
  // move with axis-separated sliding so terrain deflects instead of gluing you in place.
  // CRITICAL: an entity already standing in an invalid spot (spawned or teleported there)
  // is never trapped — from inside a blocked region, all movement is allowed until you exit.
  moveBlocked(e, nx, ny) {
    if (this.blockedAt(e.x, e.y)) { e.x = nx; e.y = ny; return; }
    if (!this.blockedAt(nx, ny)) { e.x = nx; e.y = ny; return; }
    if (!this.blockedAt(nx, e.y)) { e.x = nx; e.vy = 0; return; }
    if (!this.blockedAt(e.x, ny)) { e.y = ny; e.vx = 0; return; }
    e.vx *= 0.2; e.vy *= 0.2;
  }

  // Weighted tier draw (Plan 020, design decision 1): replaces the deleted flat
  // 0.6-1.5x fair-band guarantee. Weights shift from `weak` toward `strong` as
  // non-stronghold camps fall, so the curve rises across a run instead of tracking
  // the player forever. `razed` is 0..3.
  rollPartyBand(razed) {
    const R = this.simRng;
    const t = clamp(razed / 3, 0, 1);
    const wWeak = 0.40 - 0.30 * t, wEven = 0.35; // wStrong is the remainder
    const { weak, even, strong } = BALANCE.partyTiers;
    const r = R();
    if (r < wWeak) return weak.min + R() * (weak.max - weak.min);
    if (r < wWeak + wEven) return even.min + R() * (even.max - even.min);
    return strong.min + R() * (strong.max - strong.min);
  }

  // Roaming-party composition, target strength on `simRng` — used by spawnParty and by
  // the floor guarantee (enforceBeatableFloor) so both draw from one formula. Weights
  // live in BALANCE.compRolls.party, next to the garrison table rollGarrison uses.
  rollComp(target) {
    return rollComposition(target, this.simRng, BALANCE.compRolls.party);
  }

  // Spawn a party aimed at a strength band around the player. `band`, when given
  // explicitly, overrides the weighted tier draw (used by the floor guarantee's
  // callers and by QA to probe the [2,24] clamp directly).
  spawnParty(camp, band) {
    const R = this.simRng;
    const mine = this.myStrength();
    const razed = this.save.camps.filter(c => c.razed && c.id !== 'strong').length;
    const effectiveBand = band ?? this.rollPartyBand(razed);
    const target = clamp(Math.round(mine * effectiveBand), 2, 24);
    const comp = this.rollComp(target);
    // never spawn a party inside a river or mountain — retry a few scatter offsets
    let px = camp.x, py = camp.y;
    for (let i = 0; i < 8; i++) {
      const tx = camp.x + (R() - 0.5) * 200, ty = camp.y + (R() - 0.5) * 200;
      if (!this.blockedAt || !this.blockedAt(tx, ty)) { px = tx; py = ty; break; }
    }
    this.parties.push({
      camp: camp.id,
      x: px, y: py,
      vx: 0, vy: 0, facing: 0, bob: this.fxRng() * TAU,
      comp, home: { x: camp.x, y: camp.y },
      wander: null, wanderT: 0, occupying: null, raid: null,
      navT: this.simRng() * 0.3, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(this.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
  }

  // Design decision 5's floor guarantee: a settlement is "claimed" once some party
  // occupies or is travelling to raid it. A break-off only ever targets a settlement
  // when at least one other stays fully unclaimed afterward, so no sequence of
  // simultaneous break-offs can ever occupy every settlement at once.
  // Where a raiding party sits once it has taken a settlement: north of centre, clear of
  // the name/OCCUPIED chips below. Falls back around the compass if terrain blocks it.
  occupierPost(settlement) {
    const R = 64;
    const candidates = [[0, -R], [-R, -R * 0.5], [R, -R * 0.5], [-R, 0], [R, 0]];
    for (const [dx, dy] of candidates) {
      const x = clamp(settlement.x + dx, 60, this.W - 60);
      const y = clamp(settlement.y + dy, 60, this.H - 60);
      if (!this.blockedAt(x, y)) return { x, y };
    }
    return { x: settlement.x, y: Math.max(60, settlement.y - R) };
  }

  isSettlementClaimed(id) {
    const st = this.save.settlements.find(s => s.id === id);
    return !!(st && st.occupied) || this.parties.some(p => p.raid === id || p.occupying === id);
  }

  // The other half of the floor guarantee (STOP condition): if nothing currently on
  // the map — including a party occupying a settlement — is within the player's
  // reach, downgrade the weakest live party to an even-tier fight. This only ever
  // fires as an emergency correction; it is not a routine crutch like the deleted
  // fair-band guarantee, which forced nearly every spawn into a narrow band.
  enforceBeatableFloor() {
    if (this.parties.length === 0) return;
    const mine = this.myStrength();
    const beatable = mine * BALANCE.beatablePartyRatio;
    if (this.parties.some(p => this.strength(p.comp) <= beatable)) return;
    const { even } = BALANCE.partyTiers;
    const evenBand = () => even.min + this.simRng() * (even.max - even.min);
    // Prefer ADDING a beatable target over rewriting one the player may already have
    // read off a badge. `rollGarrison` sets the house rule that what you scouted is what
    // you fight, and silently weakening a party the player scouted breaks the same trust:
    // a lone 14-strength band used to become a 4 while the player watched.
    const alive = this.liveCamps();
    if (alive.length && this.parties.length < this.partyCap()) {
      const camp = alive[(this.simRng() * alive.length) | 0];
      this.spawnParty(camp, evenBand());
      this.particles.ring(camp.x, camp.y, 40, P.ink, 0.5, 3);
      this.persistParties();
      return;
    }
    // Only at the party cap, with no room to add one, is an existing band rewritten.
    let weakest = this.parties[0];
    for (const p of this.parties) if (this.strength(p.comp) < this.strength(weakest.comp)) weakest = p;
    const target = clamp(Math.round(mine * evenBand()), 2, 24);
    weakest.comp = this.rollComp(target);
  }

  // Camps still fielding parties, and the ceiling on how many may be alive at once.
  // Shared by the spawn timer and the floor guarantee so the cap formula exists once.
  liveCamps() {
    return WORLD.camps.filter(c => !c.stronghold && !this.save.camps.find(s => s.id === c.id).razed);
  }
  partyCap() {
    const alive = this.liveCamps();
    return alive.length ? 2 + alive.length * 2 : 0;
  }

  // brutes hit ~5x harder than a bandit; knights count double. Badges show THIS number.
  // (shared with battle.js's enemyStrength/playerStrength — one formula, not two.)
  strength(comp) { return enemyStrength(comp); }

  // Garrisons are rolled ONCE — when your scouts first sight the camp — and frozen.
  // Bandits don't magically reinforce because you recruited; what you scouted is what you fight.
  rollGarrison(camp) {
    const mine = this.myStrength();
    const garrisonSeed = (camp.x * 31 + camp.y * 7 + mine * 13 + (this.save.runSeed ?? 0)) >>> 0;
    const R = makeRng(deriveSeed(garrisonSeed, RNG_DOMAINS.WORLD_GARRISON));
    const hardMul = this.save.hard ? 1.25 : 1;
    const target = Math.max(camp.size + 2, Math.round(mine * (camp.tier || 1) * hardMul));
    const bruteCap = camp.stronghold ? 3 : mine >= 12 ? 2 : mine >= 8 ? 1 : 0;
    return rollComposition(target, R, BALANCE.compRolls.garrison, bruteCap);
  }
  // what the map/prompt SHOWS: the scouted count, or nothing if not yet scouted
  garrisonStrength(camp) {
    const st = this.save.camps.find(c => c.id === camp.id);
    return st && st.garrison ? this.strength(st.garrison) : null;
  }
  myStrength() {
    return playerStrength(this.save.troops);
  }

  // Army-cap upgrade price: rises by a step per +2 already bought. The charge site and the
  // town prompt's price tag both read this, so the displayed price is the price paid.
  armyCapCost() {
    return BALANCE.armyCapCostBase + (this.save.armyCap - BALANCE.armyCapBase) * BALANCE.armyCapCostStep;
  }

  nearSettlement(r = 110) {
    for (const s of WORLD.settlements) if (dist2(this.hero.x, this.hero.y, s.x, s.y) < r * r) return s;
    return null;
  }
  nearCamp() {
    for (const c of WORLD.camps) {
      const st = this.save.camps.find(s => s.id === c.id);
      if (!st.razed && dist2(this.hero.x, this.hero.y, c.x, c.y) < 130 * 130) return c;
    }
    return null;
  }

  // Biomes are the lands BETWEEN the two rivers — crossing a bridge takes you into different country
  biomeAt(x) { return x < 1030 ? 'meadow' : x < 2430 ? 'rose' : 'night'; }
  nearRiver(x, y = this.hero.y) {
    return this.riverSegs.some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) < 140);
  }

  // Documented predicate (Plan 021 step 6) so main.js can gate stats.playT accrual
  // without reaching into World internals — a modal genuinely pauses the campaign, so
  // leaving it open must not inflate reported campaign time.
  isBlocking() { return !!this.screen; }

  updateHeroMovement(dt, inp, h) {
    // Movement is the first world phase: interactions and party AI observe its result.
    const ax = inp.axis();
    const SPEED = this.onRoad(h.x, h.y) ? 276 : 240, ACCEL = 900;
    h.vx += ax.x * ACCEL * dt; h.vy += ax.y * ACCEL * dt;
    const sp = len(h.vx, h.vy);
    if (sp > SPEED) { h.vx *= SPEED / sp; h.vy *= SPEED / sp; }
    if (!ax.any) { h.vx *= Math.max(0, 1 - 5 * dt); h.vy *= Math.max(0, 1 - 5 * dt); }
    this.moveBlocked(h,
      clamp(h.x + h.vx * dt, 60, this.W - 60),
      clamp(h.y + h.vy * dt, 60, this.H - 60));
    if (sp > 40) {
      h.facing = angLerp(h.facing, Math.atan2(h.vy, h.vx), 1 - Math.exp(-8 * dt));
      h.bob += dt * 10;
      this.game.sfx.gallop();
      if (this.fxRng() < dt * 10) this.particles.dust(h.x - h.vx * 0.05, h.y + 8, P.cream, 1, this.fxRng);
    }
  }

  update(dt) {
    this.time += dt;
    const inp = this.game.input, h = this.hero;
    // Plan 021: the brief/aftermath modal phase runs FIRST, mirroring the
    // updateCampInteraction pre-empt idiom below. Returning true here blocks every other
    // world phase for the tick — hero movement, interactions, party AI (so `grace` freezes
    // for free, since it only decays inside updateParties), and spawns/victory — so a
    // modal genuinely pauses the campaign rather than just visually covering it.
    if (this.updateWorldScreens(inp)) return;
    if (this.msgT > 0) this.msgT -= dt;
    this.updateHeroMovement(dt, inp, h);
    const settlement = this.updateSettlementInteractions(inp);
    if (this.updateCampInteraction(inp, settlement)) return;

    this.enforceBeatableFloor();
    if (this.updateParties(dt)) return;

    // camps slowly send out new parties (visible spawn at the camp)
    this.updatePartySpawns(dt);

    // victory
    if (this.save.won) {
      this.game.startVictory(this.save);
      return;
    }

    this.updateCameraAndEffects(dt);
  }

  updateParties(dt) {
    // Party AI owns pursuit, navigation, river-safe movement, and encounter handoff.
    if (this.grace > 0) this.grace -= dt;
    const h = this.hero;
    const heroSafe = this.inSafeZone(h.x, h.y);
    for (const p of this.parties) {
      const pStr = this.strength(p.comp), mine = this.myStrength();
      const dh = Math.sqrt(dist2(p.x, p.y, h.x, h.y));
      let goal = null, speed = 105;
      // sanctuary stops FIGHTING near a settlement, never a party's intent while passing
      // through — otherwise a pursuit route clipping a safe zone flickers the hunt on/off
      const engaged = this.grace <= 0 && !heroSafe;
      if (p.waryT > 0) p.waryT -= dt;
      if (p.chaseT > 0) p.chaseT -= dt;
      if (p.clashT > 0) p.clashT -= dt;

      if (p.raid || p.occupying) {
        // Design decision 3: a party that broke off no longer cares about the hero at
        // all — it beelines for its target settlement and, once there, sits occupying
        // it until defeated. This branch entirely replaces the chase/flee/wander logic.
        if (p.occupying) {
          goal = { x: p.x, y: p.y }; speed = 0; p.mood = 'occupying';
        } else {
          const target = WORLD.settlements.find(s => s.id === p.raid);
          if (dist2(p.x, p.y, target.x, target.y) < BALANCE.raidArrivalR * BALANCE.raidArrivalR) {
            const st = this.save.settlements.find(s => s.id === p.raid);
            st.occupied = true;
            p.occupying = p.raid;
            p.raid = null;
            // Post at the gate rather than freezing wherever the beeline happened to end.
            // The settlement's name and OCCUPIED chips are drawn BELOW it, so an occupier
            // that stopped anywhere south of centre covered its own settlement's name.
            // A canonical post also makes the fight to retake a settlement look the same
            // every time instead of depending on the approach angle.
            const post = this.occupierPost(target);
            p.x = post.x; p.y = post.y; p.vx = 0; p.vy = 0;
            goal = { x: p.x, y: p.y }; speed = 0; p.mood = 'occupying';
            this.say(`${target.name} falls under raider occupation — its service is suspended!`, 3.2);
          } else {
            goal = target; speed = BALANCE.raidSpeed; p.mood = 'raiding';
          }
        }
      } else {
        const detectR = p.waryT > 0 ? 560 : 430; // a party that fled you once keeps watching for you
        if (engaged && (dh < detectR || p.chaseT > 0)) {
          // chasers aim at where you're GOING — interception geometry beats raw speed
          const lead = { x: h.x + h.vx * 1.1, y: h.y + h.vy * 1.1 };
          const fleeBar = p.waryT > 0 ? 1.1 : 0.75; // spooked parties don't re-try near-even odds
          if (pStr > mine * 1.3) { goal = lead; speed = 185; p.mood = 'chase'; }
          else if (pStr >= mine * fleeBar) { goal = lead; speed = 165; p.mood = 'chase'; }
          else if (dh < detectR) {
            goal = { x: p.x + (p.x - h.x) * 2, y: p.y + (p.y - h.y) * 2 }; speed = 195;
            if (p.mood !== 'flee') p.waryT = 25;
            p.mood = 'flee';
          } else p.mood = null;
          // a committed hunt survives the detour: crossing a bridge doesn't make them forget you
          if (p.mood === 'chase' && dh < detectR) p.chaseT = 16;
        } else p.mood = null;

        // Design decision 3: sustained, uncaught chase eventually gives up on the hero and
        // raids the nearest settlement instead — see BALANCE.raidBreakOffT. The floor
        // guarantee (design decision 5 / isSettlementClaimed) refuses the break-off rather
        // than let a break-off claim the last fully unclaimed settlement.
        if (p.mood === 'chase') {
          p.chaseHoldT = (p.chaseHoldT || 0) + dt;
          if (p.chaseHoldT >= BALANCE.raidBreakOffT) {
            const free = WORLD.settlements.filter(s => !this.isSettlementClaimed(s.id));
            if (free.length >= 2) {
              let target = null, bd = Infinity;
              for (const s of free) {
                const d = dist2(p.x, p.y, s.x, s.y);
                if (d < bd) { bd = d; target = s; }
              }
              p.raid = target.id;
              p.mood = 'raiding';
              p.chaseT = 0;
              this.say(`A war party gives up the chase and rides for ${target.name}!`, 3.2);
            } else {
              p.chaseHoldT = 0; // no settlement left to claim safely — keep hunting instead
            }
          }
        } else {
          p.chaseHoldT = 0;
        }
      }

      if (!goal) {
        p.wanderT -= dt;
        if (!p.wander || p.wanderT <= 0) {
          p.wander = { x: p.home.x + (this.simRng() - 0.5) * 700, y: p.home.y + (this.simRng() - 0.5) * 500 };
          p.wanderT = 3 + this.simRng() * 4;
        }
        goal = p.wander; speed = 80;
      }
      // navigation: route to the next visible waypoint (bridge gates, stagings, grid) when
      // the straight line is walled off — cached per party, replanned every ~0.6s
      {
        if (!p._navGoalVisibility) { p._navGoalVisibility = new Float64Array(this.navNodes.length); p._navGoalX = NaN; p._navGoalY = NaN; }
        p.navT = (p.navT == null ? 0 : p.navT) - dt;
        const goalChanged = !!p.navFor && len(goal.x - p.navFor.x, goal.y - p.navFor.y) > 140;
        if (p.navT <= 0 || goalChanged) {
          p.navGoal = this.pathGoal(p.x, p.y, goal, p);
          if (!p.navFor) p.navFor = { x: goal.x, y: goal.y };
          else { p.navFor.x = goal.x; p.navFor.y = goal.y; }
          p.navT = 0.5 + this.simRng() * 0.2;
        }
        const wp = p.navGoal;
        if (wp) goal = wp;
        // hard unstick of last resort: wedged >4s → step out in the first open compass direction
        if ((p.stuckT || 0) > 4) {
          for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            const ux = p.x + Math.cos(a) * 30, uy = p.y + Math.sin(a) * 30;
            if (!this.blockedAt(ux, uy)) { p.x = ux; p.y = uy; p.stuckT = 0; break; }
          }
        }
      }
      speed *= this.onRoad(p.x, p.y) ? 1.15 : 1; // bandits know the roads too
      const dx = goal.x - p.x, dy = goal.y - p.y, d = len(dx, dy) || 1;
      if (d > 10) {
        p.vx = lerp(p.vx, dx / d * speed, 1 - Math.exp(-4 * dt));
        p.vy = lerp(p.vy, dy / d * speed, 1 - Math.exp(-4 * dt));
      } else { p.vx *= 0.9; p.vy *= 0.9; }
      // soft mountain steering: a gentle nudge, never strong enough to cancel pursuit
      for (const o of this.solids) {
        const dd = dist2(p.x, p.y, o.x, o.y);
        const rr = o.r + 26;
        if (dd < rr * rr && dd > 1) {
          // equilibrium contribution ≈ 4/lerp ≈ 60 px/s — a nudge, never a wall
          const dm = Math.sqrt(dd), push = (rr - dm) / rr * 4 * dt * 60;
          p.vx += (p.x - o.x) / dm * push;
          p.vy += (p.y - o.y) / dm * push;
        }
      }
      const prevX = p.x, prevY = p.y;
      const nx2 = clamp(p.x + p.vx * dt, 60, this.W - 60);
      const ny2 = clamp(p.y + p.vy * dt, 60, this.H - 60);
      // parties: only rivers hard-block (bridge-exempt); escape allowed if somehow inside
      if (this.riverBlockedAt(p.x, p.y) || !this.riverBlockedAt(nx2, ny2)) { p.x = nx2; p.y = ny2; }
      else if (!this.riverBlockedAt(nx2, p.y)) { p.x = nx2; p.vy = 0; }
      else if (!this.riverBlockedAt(p.x, ny2)) { p.y = ny2; p.vx = 0; }
      else { p.vx *= 0.2; p.vy *= 0.2; }
      // catch-all unstick: crawling counts as stuck too — measure PROGRESS toward the goal,
      // not raw movement, so a party skimming a bank at 3px/s still gets rescued
      const progress = len(goal.x - prevX, goal.y - prevY) - len(goal.x - p.x, goal.y - p.y);
      if (d > 30 && progress < speed * dt * 0.3) p.stuckT = (p.stuckT || 0) + dt;
      else p.stuckT = 0;
      if (p.mood !== 'chase' && this.blockedAt(p.x + p.vx * dt * 8, p.y + p.vy * dt * 8) && p.wander) {
        p.wanderT = 0; // wandering parties re-pick a goal instead of grinding on terrain
      }
      if (len(p.vx, p.vy) > 20) { p.bob += dt * 9; p.facing = angLerp(p.facing, Math.atan2(p.vy, p.vx), 1 - Math.exp(-6 * dt)); }

      // collision → battle. Bandits dare to strike near village outskirts (110-260 band),
      // but never in the village itself — so village-arena ambushes genuinely happen.
      // Initiative matters: they caught you = ambush; you caught them running = no formup for them;
      // a mutual field meeting = both sides deploy.
      // world.grace (ambush immunity) only gates `engaged` above — it must not block
      // canClash too, or the player can't charge into a party they WANT to fight for the
      // whole post-battle window. The one party that does need a post-disengage cooldown
      // (reinserted right under the hero's feet) carries its own p.clashT instead.
      // Design decision 5: an occupier is exempt from the settlement-safe-zone block —
      // it must always be attackable where it sits, or the player has no recapture path.
      const isOccupier = !!p.occupying;
      const canClash = (p.clashT || 0) <= 0 && (isOccupier || !this.nearSettlement(130)) && dh < 46;
      if ((engaged || (canClash && dh < 46)) && canClash) {
        // Plan 021 decision 8/step 7: request instead of committing. The party splice,
        // persistParties(), battleCount++ and persistRun() all move to confirmBrief() —
        // this party stays exactly where it is, still fightable, until the player decides.
        const ambushed = p.mood === 'chase';
        const caughtThem = p.mood === 'flee';
        const occupiedSettlement = isOccupier ? WORLD.settlements.find(s => s.id === p.occupying) : null;
        this.requestBattle({
          party: p,
          title: occupiedSettlement ? `RETAKE ${occupiedSettlement.name.toUpperCase()}`
            : ambushed ? 'AMBUSHED!' : caughtThem ? 'RUN THEM DOWN!' : 'BANDIT SKIRMISH',
          subtitle: occupiedSettlement ? 'Drive them out and restore the settlement’s service'
            : caughtThem ? 'You caught them running — give no quarter' : 'Roaming party — worth loot, no camp progress',
          arena: null,
          ambush: ambushed,
          approach: this.approachTo(p.x, p.y),
          deploy: caughtThem ? 0 : undefined, // undefined = mutual 8s formup
          comp: p.comp.slice(),
          // Plan 021 decision 5: withdraw is offered only when the player initiated the
          // fight — an explicit camp/stronghold press (handled in updateCampInteraction)
          // or running down a fleeing party. An ambush or a mutual skirmish is committed.
          canWithdraw: caughtThem,
          onWinExtra: occupiedSettlement ? () => {
            const st = this.save.settlements.find(s => s.id === occupiedSettlement.id);
            if (st) st.occupied = false;
            this.save.toast = `${occupiedSettlement.name} is free again — its service resumes.`;
          } : null,
          partyMeta: { camp: p.camp, x: p.x, y: p.y, comp: p.comp.slice(), home: p.home, waryT: p.waryT, occupying: p.occupying },
        });
        return true;
      }
    }
    return false;
  }

  updatePartySpawns(dt) {

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 40;
      const alive = this.liveCamps();
      if (alive.length && this.parties.length < this.partyCap()) {
        // Plan 020: the old fair-band guarantee (forcing almost every spawn into a
        // narrow 0.7-1.2x band) is gone. Every spawn draws from the weighted tiers in
        // spawnParty()/rollPartyBand(); enforceBeatableFloor() is the only remaining
        // safety net, and it only intervenes when nothing beatable exists at all.
        const c = alive[(this.simRng() * alive.length) | 0];
        this.spawnParty(c);
        this.particles.ring(c.x, c.y, 40, P.ink, 0.5, 3);
        this.persistParties();
      }
    }

  }

  updateCameraAndEffects(dt) {
    const h = this.hero;
    const cam = this.game.camera;
    // riding kicks up dust — the hero's cross-bar movement signature (Thronefall + WatG both use it)
    if (Math.hypot(h.vx, h.vy) > 110) {
      this.dustT = (this.dustT || 0) + dt;
      if (this.dustT > 0.09) { this.dustT = 0; this.particles.dust(h.x - h.vx * 0.05, h.y + 8, P.cream, 2, this.fxRng); }
    }
    cam.follow(h.x + h.vx * 0.35, h.y + h.vy * 0.35, dt, 4);
    // clamp the view inside the map so no void shows at the edges
    const vw = cam.w / cam.zoom / 2, vh = cam.h / cam.zoom / 2;
    cam.x = clamp(cam.x, vw - 25, this.W - vw + 25);
    cam.y = clamp(cam.y, vh - 25, this.H - vh + 25);
    this.particles.update(dt);
  }

  // ---------------------------------------------------------------- delegating seams
  startBattle(comp, title, onWinExtra, arena, ambush, partyMeta, subtitle, brief = false) {
    return beginBattle(this, comp, title, onWinExtra, arena, ambush, partyMeta, subtitle, brief);
  }

  requestBattle(descriptor) {
    return openBattleBrief(this, descriptor);
  }

  cancelBrief() {
    return dismissBrief(this);
  }

  confirmBrief() {
    return acceptBrief(this);
  }

  updateWorldScreens(inp) {
    return worldScreens(this, inp);
  }

  say(text, t = 2.4) {
    return sayToast(this, text, t);
  }

  costAt(s, type) {
    return unitCostAt(this, s, type);
  }

  recruit(type) {
    return recruitUnit(this, type);
  }

  approachTo(tx, ty) {
    return approachPoint(this, tx, ty);
  }

  isSettlementOccupied(s) {
    return settlementOccupied(this, s);
  }

  updateSettlementInteractions(inp) {
    return settlementInteractions(this, inp);
  }

  campVictoryExtra(camp, st, comp) {
    return campVictoryBookkeeping(this, camp, st, comp);
  }

  updateCampInteraction(inp, settlement) {
    return campInteraction(this, inp, settlement);
  }

  // Implementations live under src/world/. These stay instance methods because the
  // constructor, the party AI and the terrain-geometry spec all reach them through the
  // scene, and world-battle-seams.spec.js patches the ordered phases by name.
  buildTerrainGeometry() {
    return buildGeometry(this);
  }

  linesToSegments(lines) {
    return sampleToSegments(this, lines);
  }

  buildStaticPaths() {
    return bakeStaticPaths(this);
  }

  buildScenery() {
    return placeScenery(this);
  }

  lineClear(x1, y1, x2, y2) {
    return segmentClear(this, x1, y1, x2, y2);
  }

  pathGoal(x, y, goal, party = null) {
    return navPathGoal(this, x, y, goal, party);
  }

  // Rendering lives in world/render-scene.js; this stays a method because main.js
  // drives the scene through the same draw(ctx) seam for every scene type.
  draw(ctx) {
    drawScene(this, ctx);
  }
}
