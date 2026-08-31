import { test, expect } from '@playwright/test';
import { bootWorld, collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Plan 024 Phase 3/4/5 regression guards — full coverage of the Testing section in
// plans/024-battlefield-rework.md.
//
// Covers, in order: river crossings are genuinely passable (the defect that made the bridge
// arena unwinnable in Phase 1); `battle.blockers` composition (hills/woods/houses only, never
// rocks/scrub/individual trees); spawn-clearance holds for an open-country fight;
// `terrainSpeedAt` speed bands (road/wood/open), sampled from the actual brief rather than
// hardcoded coordinates; crossing convergence over a stepped river fight (nobody grinds on a
// bank); no unit ends up embedded in an obstacle after a stepped fight; and the three
// measured obstacle-size caps (`ROCK_R_CAP`, `TREE_COLLIDER_CAP`, `HILL_SAFE_R`) documented in
// AGENTS.md's "Battlefield terrain (Plan 024)" section. The three tests already here (hill
// corridor-safety cap, LOS across a hill, blind-archer advance) are unchanged.
//
// New tests reuse the Phase 8 brief-derived scenarios (`battle_river`, `battle_woods`,
// `battle_settlement`, all world seed 7 / approach 'E' / brief seed 12345 — see src/main.js)
// rather than re-deriving briefs by hand, and read the exact Brief a battle was built from off
// `battle.setup.field` (set verbatim by the `Battle` constructor) instead of resampling.
const DT = 1 / 60;

test('a hill capped only when it fouls the corridor between the two forces still lets the fight resolve', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Measured while fixing plans/024's oversized-rock defect: a synthetic hill sitting dead
  // centre on the straight corridor between the two spawn points, at the plan's own largest
  // legitimate hill radius (mtn -> r = s*0.72*S = 288 at s=100), made this exact fixture never
  // resolve inside a 120s cap — tangent steering (LOOKAHEAD=170) cannot route two whole armies
  // around a circle that wide relative to the corridor. r<=195 always resolved in the same
  // probe; r>=200 never did, on- or off-axis. `buildFromBrief`'s corridor-safety cap
  // (src/battle/terrain.js) is what is under test here: it should shrink ONLY a hill that
  // actually fouls the corridor, not the field's other hills.
  const result = await page.evaluate(async ({ dt }) => {
    const g = window.__g;
    const { sampleBattlefield } = await import('/src/world/battlefield-brief.js');
    const { FIELD } = await import('/src/battle/constants.js');

    window.game.scenario('world', { seed: 7 });
    const world = g.scene;
    world.hero.x = 1700; world.hero.y = 2100; // deep country: no natural hill near the corridor
    const field = sampleBattlefield(world, 'E', 12345, FIELD.W, FIELD.H);
    const naturalHillCount = field.hills.length;

    // Drop an oversized hill dead centre on the corridor (field centre, since the hero spawns
    // W/2 - ENGAGE_GAP/2 and the enemy centre spawns W/2 + ENGAGE_GAP/2 on an 'E' approach).
    field.hills.push({ x: FIELD.W / 2, y: FIELD.H / 2, r: 288 });

    const real = g.update.bind(g);
    g.update = () => {};
    let seconds = 0, resolved = false, victory = false, cappedHillR = null;
    try {
      g.startBattle({
        troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'archer' }, { type: 'archer' }],
        enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' }, { type: 'raider' }, { type: 'raider' }],
        seed: 12345, title: 'CORRIDOR HILL TEST', biome: 'rose',
        deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, field, onEnd: () => {},
      });
      const b = g.scene;
      b.state = 'fight';
      const centreHill = b.obstacles.find(o => o.kind === 'hill' && o.x === FIELD.W / 2 && o.y === FIELD.H / 2);
      cappedHillR = centreHill ? centreHill.r : null;
      let t = 0;
      while (b.state !== 'end' && t < 100) { real(dt); t += dt; }
      seconds = Math.round(t * 10) / 10;
      resolved = b.state === 'end';
      victory = !!b.victory;
    } finally { g.update = real; }
    return { seconds, resolved, victory, naturalHillCount, cappedHillR };
  }, { dt: DT });

  // The injected hill must have been capped well under the 200 danger threshold...
  expect(result.cappedHillR).not.toBeNull();
  expect(result.cappedHillR).toBeLessThan(200);
  // ...and the fight must actually finish, unlike the uncapped 288-radius version of this
  // exact fixture, which ran the full 120s without ever reaching 'end'.
  expect(result.resolved, `fight never resolved (${result.seconds}s) — corridor cap is not working`).toBe(true);
  expect(result.victory).toBe(true);

  assertNoRuntimeErrors(runtimeErrors);
});

test('line of sight is blocked by a hill and restored 300 units to the side of it', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // A synthetic single-hill field, same construction style as the corridor test above:
  // straight through the hill's centre must be blocked, and the same two points shifted
  // 300 units laterally (well clear of the hill's own radius) must be visible again.
  const result = await page.evaluate(async () => {
    const g = window.__g;
    const { FIELD } = await import('/src/battle/constants.js');
    const field = {
      rivers: [], crossings: [], roads: [], woods: [], rocks: [], scrub: [],
      settlement: null, camp: null,
      hills: [{ x: FIELD.W / 2, y: FIELD.H / 2, r: 150 }],
    };
    const real = g.update.bind(g);
    g.update = () => {};
    let throughHill, besideHill;
    try {
      g.startBattle({
        troops: [{ type: 'spear' }], enemies: [{ type: 'bandit' }],
        seed: 1, title: 'LOS HILL TEST', biome: 'rose', deploy: 0, approach: 'E',
        heroHp: 120, heroMaxHp: 120, field, onEnd: () => {},
      });
      const b = g.scene;
      const sx = b.hero.x, sy = FIELD.H / 2; // hero.y is already H/2 on an 'E' approach
      const tx = FIELD.W / 2 + 400, ty = FIELD.H / 2; // straight through the hill's centre
      throughHill = b.hasLineOfSight(sx, sy, tx, ty);
      besideHill = b.hasLineOfSight(sx, sy + 300, tx, ty + 300);
    } finally { g.update = real; }
    return { throughHill, besideHill };
  });

  expect(result.throughHill, 'a sightline through the hill centre must be blocked').toBe(false);
  expect(result.besideHill, 'the same sightline shifted 300 units clear of the hill must be visible').toBe(true);

  assertNoRuntimeErrors(runtimeErrors);
});

test('a blind archer advances on its target instead of holding position', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // A small hill sits on the straight line between a lone archer and a lone bandit, so the
  // archer's engaged target is never visible. HOLD stance is issued: per the pre-Phase-5
  // behaviour preserved just above this block ("archers on hold stand ground"), a HOLD
  // archer with a target never moves at all, at any distance, as long as it is not blind —
  // the cleanest possible default to override. Plan 024 Phase 5's mandatory fallback says
  // that once `blindT` passes 1.5s the archer must stop holding and close the distance
  // instead of standing still behind the hill forever.
  //
  // The bandit is pinned in place every tick (position AND velocity reset after each step).
  // Without this, the bandit's own melee approach closes the gap on its own regardless of
  // what the archer does, and the distance-decreased assertion would pass even with the
  // fallback deleted — confirmed during authoring by temporarily disabling the fallback
  // with an unpinned bandit: the test still passed, because the bandit chasing the archer
  // was enough on its own. Pinning the enemy isolates the archer's OWN motion, and was
  // re-verified the same way: with the fallback disabled and the bandit pinned, this
  // version of the test does fail.
  const result = await page.evaluate(async ({ dt }) => {
    const g = window.__g;
    const field = {
      rivers: [], crossings: [], roads: [], woods: [], rocks: [], scrub: [],
      settlement: null, camp: null,
      hills: [{ x: 1090, y: 880, r: 50 }],
    };
    const real = g.update.bind(g);
    g.update = () => {};
    let d0 = null, d1 = null, blindAtCheckpoint = null, losBlockedAtStart = null;
    try {
      g.startBattle({
        troops: [{ type: 'archer' }], enemies: [{ type: 'bandit' }],
        seed: 1, title: 'BLIND ARCHER TEST', biome: 'rose', deploy: 0, approach: 'E',
        heroHp: 120, heroMaxHp: 120, field, onEnd: () => {},
      });
      const b = g.scene;
      b.state = 'fight';
      const t = b.troops[0], e = b.enemies[0];
      // 180 apart, well inside the archer's 230 range (HOLD's target search is capped at
      // range, unlike CHARGE's unbounded search), with the hill sitting on the segment
      // between them.
      t.x = 1000; t.y = 880;
      const ex = 1180, ey = 880;
      e.x = ex; e.y = ey;
      const pin = () => { e.x = ex; e.y = ey; e.vx = 0; e.vy = 0; };
      b.issueCommand('hold');
      losBlockedAtStart = !b.hasLineOfSight(t.x, t.y, ex, ey);
      let time = 0;
      // Run past the 1.5s blind threshold first.
      while (time < 1.6 && b.state !== 'end') { real(dt); pin(); time += dt; }
      blindAtCheckpoint = t.blindT;
      d0 = Math.hypot(t.x - ex, t.y - ey);
      let t3 = 0;
      while (t3 < 3 && b.state !== 'end') { real(dt); pin(); t3 += dt; }
      d1 = Math.hypot(t.x - ex, t.y - ey);
    } finally { g.update = real; }
    return { d0, d1, blindAtCheckpoint, losBlockedAtStart };
  }, { dt: DT });

  expect(result.losBlockedAtStart, 'the hill must actually block LOS between the pair at their starting positions').toBe(true);
  expect(result.blindAtCheckpoint, 'blindT must have passed the 1.5s fallback threshold').toBeGreaterThan(1.5);
  expect(result.d1, 'a blind archer must close distance on its (stationary) target instead of standing still').toBeLessThan(result.d0);

  assertNoRuntimeErrors(runtimeErrors);
});

test('every river crossing is genuinely passable', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Guards Plan 024's defect #1: Phase 1 doubled the field while a fixed-gap arena wall stayed
  // the same absolute width, so a river/wall obstacle chain could reach back into its own
  // crossing and make the fight unwinnable (measured: 80.2% of unit-steps stalled, never
  // resolved in 90s). buildRiverChain (src/battle/terrain.js) is supposed to skip any chain
  // circle within a crossing's own radius of its centre — this checks that promise held for
  // both canonical crossing kinds: a synthesised ford (battle_river) and a real bridge
  // (battle_settlement).
  for (const name of ['battle_river', 'battle_settlement']) {
    const result = await page.evaluate((scenarioName) => {
      window.game.scenario(scenarioName);
      const b = window.__g.scene;
      const field = b.setup.field;
      // River-chain obstacles are `kind:'none'` circles whose radius is EXACTLY half a
      // river's visible width (buildRiverChain's `r = river.width * 0.5`) — this distinguishes
      // them from the unrelated `kind:'none'` circles tents/houses/palisade planks also use.
      const riverRadii = field.rivers.map(r => r.width * 0.5);
      const riverObstacles = b.obstacles.filter(o =>
        o.kind === 'none' && riverRadii.some(rr => Math.abs(o.r - rr) < 0.01));
      const crossings = b.crossings.map(c => ({ x: c.x, y: c.y, w: c.w, kind: c.kind }));
      const violations = [];
      for (const o of riverObstacles) {
        for (const c of crossings) {
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          if (d < c.w) violations.push({ ox: o.x, oy: o.y, crossing: c, d });
        }
      }
      return {
        riverCount: field.rivers.length, crossingCount: crossings.length,
        crossingKinds: crossings.map(c => c.kind), riverObstacleCount: riverObstacles.length,
        violations,
      };
    }, name);

    expect(result.riverCount, `${name} should sample a river`).toBeGreaterThan(0);
    expect(result.crossingCount, `${name} should sample at least one crossing`).toBeGreaterThan(0);
    expect(result.violations, `${name}: river obstacle sits inside a crossing's own radius: ${JSON.stringify(result.violations)}`).toEqual([]);
  }

  assertNoRuntimeErrors(runtimeErrors);
});

test('blockers contain only hills, woods and houses — never rocks, scrub, or individual trees', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // LOS blocker policy (AGENTS.md's "Battlefield terrain" section): a wood contributes exactly
  // ONE blocker (not one per tree), a hill contributes one, a village house contributes one —
  // rocks and scrub never push a blocker at all. This pins the composition by an exact count
  // (hills + woods + 3-per-settlement, since placeVillage always builds exactly 3 houses) AND
  // by checking no blocker coordinate coincides with a rock or scrub position.
  for (const name of ['battle_river', 'battle_woods', 'battle_settlement']) {
    const result = await page.evaluate((scenarioName) => {
      window.game.scenario(scenarioName);
      const b = window.__g.scene;
      const field = b.setup.field;
      const houseCount = field.settlement ? 3 : 0;
      const expected = field.hills.length + field.woods.length + houseCount;
      const forbidden = new Set([...field.rocks, ...field.scrub].map(o => `${o.x.toFixed(2)},${o.y.toFixed(2)}`));
      const contaminated = b.blockers.filter(bl => forbidden.has(`${bl.x.toFixed(2)},${bl.y.toFixed(2)}`));
      return {
        blockerCount: b.blockers.length, expected, contaminated,
        hills: field.hills.length, woods: field.woods.length, houseCount,
      };
    }, name);

    expect(result.contaminated, `${name}: a blocker reuses a rock/scrub position`).toEqual([]);
    expect(result.blockerCount, `${name}: blocker count should be exactly hills(${result.hills}) + woods(${result.woods}) + houses(${result.houseCount})`).toBe(result.expected);
  }

  assertNoRuntimeErrors(runtimeErrors);
});

test('an open-country brief-derived fight still produces obstacles clear of both spawns', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // (1700, 2100) is AGENTS.md's canonical "deep country" fixture: no river, no settlement, no
  // camp. Even with nothing to hang a name on, the fixed-area rock/tree scatter in
  // buildTerrain() always runs, so obstacles must still exist AND still respect the same
  // spawn-clearance filter (battle.js) that keeps the fight from opening with someone standing
  // in a rock.
  const result = await page.evaluate(async () => {
    const g = window.__g;
    const { sampleBattlefield } = await import('/src/world/battlefield-brief.js');
    const { FIELD, ENGAGE_GAP } = await import('/src/battle/constants.js');
    window.game.scenario('world', { seed: 7 });
    const world = g.scene;
    world.hero.x = 1700; world.hero.y = 2100;
    const field = sampleBattlefield(world, 'E', 12345, FIELD.W, FIELD.H);
    g.startBattle({
      troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'archer' }],
      enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'raider' }],
      seed: 12345, title: 'OPEN COUNTRY TEST', biome: 'rose',
      deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, field, onEnd: () => {},
    });
    const b = g.scene;
    const enemyCx = b.W / 2 + b.adx * ENGAGE_GAP / 2, enemyCy = b.H / 2 + b.ady * ENGAGE_GAP / 2;
    const violations = b.obstacles
      .filter(o => o.kind !== 'none')
      .filter(o => Math.hypot(o.x - b.hero.x, o.y - b.hero.y) <= 180 || Math.hypot(o.x - enemyCx, o.y - enemyCy) <= 220)
      .map(o => ({ kind: o.kind, x: o.x, y: o.y, r: o.r }));
    return {
      hasRiver: field.rivers.length > 0, hasSettlement: !!field.settlement, hasCamp: !!field.camp,
      obstacleCount: b.obstacles.length, violations,
    };
  });

  expect(result.hasRiver, 'fixture should be open country: no river').toBe(false);
  expect(result.hasSettlement, 'fixture should be open country: no settlement').toBe(false);
  expect(result.hasCamp, 'fixture should be open country: no camp').toBe(false);
  expect(result.obstacleCount, 'open country should still produce obstacles').toBeGreaterThan(0);
  expect(result.violations, `an obstacle sits inside the spawn-clearance radius: ${JSON.stringify(result.violations)}`).toEqual([]);

  assertNoRuntimeErrors(runtimeErrors);
});

test('terrainSpeedAt is faster on a road, slower in a wood, and neutral in the open', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Sample points are derived from battle_river's OWN brief (2 roads, 7 woods) rather than
  // hardcoded field coordinates, so this keeps working if the fixture's terrain composition
  // ever shifts.
  const result = await page.evaluate(() => {
    window.game.scenario('battle_river');
    const b = window.__g.scene;
    const field = b.setup.field;

    const clearOfOtherZones = (x, y) =>
      field.woods.every(w => Math.hypot(x - w.x, y - w.y) > w.r) &&
      field.scrub.every(s => Math.hypot(x - s.x, y - s.y) > s.r) &&
      field.crossings.every(c => c.kind !== 'ford' || Math.hypot(x - c.x, y - c.y) > c.w * 0.55);
    const clearOfRoads = (x, y) => field.roads.every(r => r.pts.every(([px, py]) => Math.hypot(x - px, y - py) > r.width));

    let roadPt = null;
    for (const road of field.roads) {
      for (const [x, y] of road.pts) { if (clearOfOtherZones(x, y)) { roadPt = [x, y]; break; } }
      if (roadPt) break;
    }
    const woodPt = field.woods.length ? [field.woods[0].x, field.woods[0].y] : null;
    const candidates = [[200, 200], [b.W - 200, 200], [200, b.H - 200], [b.W - 200, b.H - 200], [b.W / 2, 200], [b.W / 2, b.H - 200]];
    const openPt = candidates.find(([x, y]) => clearOfOtherZones(x, y) && clearOfRoads(x, y)) || null;

    return {
      roadPt, woodPt, openPt,
      roadSpeed: roadPt ? b.terrainSpeedAt(roadPt[0], roadPt[1]) : null,
      woodSpeed: woodPt ? b.terrainSpeedAt(woodPt[0], woodPt[1]) : null,
      openSpeed: openPt ? b.terrainSpeedAt(openPt[0], openPt[1]) : null,
    };
  });

  expect(result.roadPt, 'no road point clear of other zones was found in the brief').not.toBeNull();
  expect(result.roadSpeed, 'terrainSpeedAt on a clear road point').toBeGreaterThan(1);
  expect(result.woodPt, 'battle_river should sample at least one wood').not.toBeNull();
  expect(result.woodSpeed, 'terrainSpeedAt at a wood centre').toBeLessThan(1);
  expect(result.openPt, 'no open-ground point clear of every zone was found').not.toBeNull();
  expect(result.openSpeed, 'terrainSpeedAt in the open').toBeCloseTo(1, 5);

  assertNoRuntimeErrors(runtimeErrors);
});

test('units near a river either reach a crossing or steadily close on one over a stepped fight', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Guards "units grinding on a riverbank": every surviving unit must either already be on its
  // effective destination side of the river (per the SAME crossingWaypoint() rule production
  // movement uses, ai-phases.js) or have gotten strictly closer to the nearest crossing after
  // 20 simulated seconds. Capped well short of this fixture's own ~41-44s measured resolution
  // time (plans/024's Retrospective) rather than stepping to 'end'.
  const result = await page.evaluate(async ({ dt }) => {
    const g = window.__g;
    const { ENGAGE_GAP } = await import('/src/battle/constants.js');
    window.game.scenario('battle_river');
    const b = g.scene;
    b.state = 'fight';
    if (b.crossings.length === 0) return { skipped: true };

    const nearestCrossingDist = (x, y) => Math.min(...b.crossings.map(c => Math.hypot(x - c.x, y - c.y)));
    const enemyCx = b.W / 2 + b.adx * ENGAGE_GAP / 2, enemyCy = b.H / 2 + b.ady * ENGAGE_GAP / 2;
    const heroX0 = b.hero.x, heroY0 = b.hero.y;
    const otherSideOf = (u) => (u.team === 'friendly' ? { x: enemyCx, y: enemyCy } : { x: heroX0, y: heroY0 });
    const livingUnits = () => [...b.troops, ...b.enemies].filter(u => u.hp > 0);

    const before = livingUnits().map(u => ({
      u, d0: nearestCrossingDist(u.x, u.y),
      crossed0: b.crossingWaypoint(u.x, u.y, otherSideOf(u).x, otherSideOf(u).y) === null,
    }));

    const real = g.update.bind(g);
    g.update = () => {};
    let t = 0;
    try { while (t < 20 && b.state !== 'end') { real(dt); t += dt; } }
    finally { g.update = real; }

    const failures = [];
    for (const rec of before) {
      if (rec.u.hp <= 0) continue; // died mid-fight — not a stall
      const d1 = nearestCrossingDist(rec.u.x, rec.u.y);
      const other = otherSideOf(rec.u);
      const crossed1 = b.crossingWaypoint(rec.u.x, rec.u.y, other.x, other.y) === null;
      if (!crossed1 && !(d1 < rec.d0)) {
        failures.push({ team: rec.u.team, type: rec.u.type, d0: rec.d0, d1, crossed0: rec.crossed0, crossed1 });
      }
    }
    return { skipped: false, checked: before.length, failures };
  }, { dt: DT });

  expect(result.skipped, 'battle_river should sample a crossing').toBe(false);
  expect(result.checked).toBeGreaterThan(0);
  expect(result.failures, `unit(s) jammed on the riverbank: ${JSON.stringify(result.failures)}`).toEqual([]);

  assertNoRuntimeErrors(runtimeErrors);
});

test('a crossing is passable only where it is drawn: the water beside it is walled', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // Plan 034: buildRiverChain's skip radius opens ~2*c.w of water around a crossing while
  // the drawn deck/shallows span only 2*CROSSING_OPEN_HALF — plugCrossingShoulders walls
  // the difference. Structural, not simulated: every sample point in the shoulder band must
  // sit inside some obstacle footprint (the plug grid's worst-case interior gap is 25.4
  // units against plug r 26), and the crossing's own opening must stay obstacle-free.
  // The sampler walks the RIVER'S OWN POLYLINE, not the builder's crossing-tangent frame —
  // a lattice laid in the frame the wall was generated from can only ever measure the
  // wall's interior spacing, never a hole where the frame drifted off a bending channel or
  // where the plug band hands off to the resumed chain (the seam depends on the chain's
  // sample phase). Every water point outside a crossing's opening must sit inside some
  // obstacle footprint; the opening's own centreline must stay clear. The band between
  // (open) and (walled) — the plug lattice's leading edge — is a 26-unit transition annulus
  // with no assertion, matching the geometry contract in plugCrossingShoulders.
  const result = await page.evaluate(async () => {
    const g = window.__g;
    const { CROSSING_OPEN_HALF, channelAt } = await import('/src/battle/terrain.js');
    const out = [];
    for (const name of ['battle_river', 'battle_settlement']) {
      window.game.scenario(name);
      const b = g.scene;
      b.state = 'fight';
      const rivers = b.props.filter(p => p.kind === 'riverPoly');
      const inObstacle = (x, y) => b.obstacles.some(o => (x - o.x) ** 2 + (y - o.y) ** 2 <= o.r * o.r);
      let holes = 0, blockedOpen = 0, walled = 0, open = 0;
      const holeAt = [];
      for (const river of rivers) {
        const pts = river.pts;
        for (let i = 1; i < pts.length; i++) {
          const ax = pts[i - 1][0], ay = pts[i - 1][1], bx = pts[i][0], by = pts[i][1];
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 14));
          for (let k = 0; k <= n; k++) {
            const x = ax + (bx - ax) * (k / n), y = ay + (by - ay) * (k / n);
            if (x < 60 || y < 60 || x > b.W - 60 || y > b.H - 60) continue; // map-edge run-out
            let dmin = Infinity, cn = null;
            for (const c of b.crossings) {
              const d = Math.hypot(x - c.x, y - c.y);
              if (d < dmin) { dmin = d; cn = c; }
            }
            const openHalf = cn ? CROSSING_OPEN_HALF[cn.kind] : 0;
            if (cn && dmin <= openHalf - 12) {
              open++;
              if (inObstacle(x, y)) blockedOpen++;
              continue;
            }
            if (cn && dmin < openHalf + 14) continue; // transition annulus, no assertion
            const local = channelAt(rivers, x, y);
            const nx = -local.ty, ny = local.tx;
            const acrossMax = local.half - 14;
            for (let across = -acrossMax; across <= acrossMax; across += 12) {
              walled++;
              if (!inObstacle(x + nx * across, y + ny * across)) {
                holes++;
                if (holeAt.length < 4) holeAt.push({ x: Math.round(x), y: Math.round(y), across: Math.round(across), dmin: Math.round(dmin) });
              }
            }
          }
        }
      }
      out.push({ name, crossings: b.crossings.length, open, walled, holes, blockedOpen, holeAt });
    }
    return out;
  });

  expect(result.length).toBe(2);
  for (const r of result) {
    expect(r.crossings, `${r.name}: the fixture must sample at least one crossing`).toBeGreaterThan(0);
    expect(r.walled, `${r.name}: the sampler must cover real walled water`).toBeGreaterThan(200);
    expect(r.open, `${r.name}: the sampler must cover the opening`).toBeGreaterThan(2);
    expect(r.holes, `${r.name}: open water outside a crossing (${r.holes}/${r.walled}) at ${JSON.stringify(r.holeAt)}`).toBe(0);
    expect(r.blockedOpen, `${r.name}: a crossing's own opening is blocked`).toBe(0);
  }

  assertNoRuntimeErrors(runtimeErrors);
});

test('no unit ends up embedded in an obstacle after a stepped fight', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // battle_woods is the densest of the three brief-derived fixtures (6 hills, 8 woods, 7
  // scrub), so it is the best stress case for `pushOutOf` (separation.js) actually keeping
  // units out of the obstacles it is supposed to shove them away from. 2-unit tolerance for
  // float/step slop, not a free pass for real overlap.
  const result = await page.evaluate(({ dt }) => {
    const g = window.__g;
    window.game.scenario('battle_woods');
    const b = g.scene;
    b.state = 'fight';

    const real = g.update.bind(g);
    g.update = () => {};
    let t = 0;
    try { while (t < 15 && b.state !== 'end') { real(dt); t += dt; } }
    finally { g.update = real; }

    const TOLERANCE = 2;
    const violations = [];
    for (const u of [...b.troops, ...b.enemies]) {
      if (u.hp <= 0) continue;
      for (const o of b.obstacles) {
        const allowed = u.d.radius + o.r;
        const d = Math.hypot(u.x - o.x, u.y - o.y);
        if (d < allowed - TOLERANCE) violations.push({ type: u.type, x: u.x, y: u.y, obstacle: o.kind, ox: o.x, oy: o.y, d, allowed });
      }
    }
    return { seconds: Math.round(t * 10) / 10, violations };
  }, { dt: DT });

  expect(result.violations, `unit(s) embedded in an obstacle: ${JSON.stringify(result.violations)}`).toEqual([]);

  assertNoRuntimeErrors(runtimeErrors);
});

test('obstacle size caps hold: rocks, colliding trees, and corridor-adjacent hills', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootWorld(page, { seed: 7 });

  // The three caps documented in AGENTS.md's "Obstacle-size caps, and why they exist": each
  // one fixed a measured stall (an oversized rock/hill/tree collider sitting near the direct
  // corridor between the two forces made a fight take 2x as long, or never resolve at all —
  // plans/024's Retrospective, defects #2 and #3). ROCK_R_CAP=70 and TREE_COLLIDER_CAP=60 are
  // unconditional; HILL_SAFE_R=150 only applies within HILL_CORRIDOR_MARGIN=260 of the
  // hero-to-enemy-centre corridor. These four numbers are hardcoded here deliberately, the
  // same way battlefield-brief.spec.js already pins ROCK_R_CAP=70 directly — they are the
  // published contract in AGENTS.md, not an implementation detail to import.
  const result = await page.evaluate(async ({ names }) => {
    const g = window.__g;
    const { distToSegment } = await import('/src/engine.js');
    const { ENGAGE_GAP } = await import('/src/battle/constants.js');
    const out = {};
    for (const name of names) {
      window.game.scenario(name);
      const b = g.scene;
      const field = b.setup.field;
      const enemyCx = b.W / 2 + b.adx * ENGAGE_GAP / 2, enemyCy = b.H / 2 + b.ady * ENGAGE_GAP / 2;

      const oversizedRocks = field.rocks.filter(r => r.r > 70);
      const oversizedTrees = b.obstacles.filter(o => o.kind === 'tree' && o.r > 60);
      const hillObstacles = b.obstacles.filter(o => o.kind === 'hill');
      const hillViolations = hillObstacles.filter(o => {
        const dCorridor = distToSegment(o.x, o.y, b.hero.x, b.hero.y, enemyCx, enemyCy);
        return (dCorridor - o.r) < 260 && o.r > 150;
      });
      out[name] = {
        oversizedRocks: oversizedRocks.length, oversizedTrees: oversizedTrees.length,
        hillCount: hillObstacles.length, hillViolations: hillViolations.length,
      };
    }
    return out;
  }, { names: ['battle_river', 'battle_woods', 'battle_settlement'] });

  for (const name of ['battle_river', 'battle_woods', 'battle_settlement']) {
    expect(result[name].oversizedRocks, `${name}: a sampled rock exceeds ROCK_R_CAP`).toBe(0);
    expect(result[name].oversizedTrees, `${name}: a colliding tree exceeds TREE_COLLIDER_CAP`).toBe(0);
    expect(result[name].hillViolations, `${name}: a corridor-adjacent hill exceeds HILL_SAFE_R`).toBe(0);
  }

  assertNoRuntimeErrors(runtimeErrors);
});
