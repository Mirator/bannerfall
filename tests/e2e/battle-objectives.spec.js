import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Milestone 025 Slice C regression guard: the three reusable battle objectives.
//
// Every test here drives the REAL ordered tick pipeline (updateActivePhases ->
// updateObjectivePhase -> resolveBattleResult) through the synchronous fixed-step
// API, with the live scheduler parked so rAF timing cannot contaminate a
// measurement — the same harness rules stance-balance and battlefield-terrain
// follow. The one architecture claim under everything: objective code computes
// status, and ONLY resolveBattleResult() ends a fight.
//
// Intro rule (tests/README.md): a battle opens in 'intro' and runs no phases, so
// every fixture forces state='fight' directly, exactly like
// battlefield-terrain. Fixture enemies are re-pinned (position AND hp) at every
// batch boundary — an archer left shooting at a static fixture can otherwise
// deplete it into an accidental elimination victory.

const DT = 1 / 60;

// Plain descriptors — functions cannot cross the evaluate boundary, so the real
// setup objects (troop/enemy records and the onEnd callback) are built in-page.
const HOLD_DESC = {
  troops: ['spear', 'spear', 'spear', 'archer'],
  enemies: ['bandit', 'bandit', 'wolf'],
  seed: 33, title: 'HOLD THE GROUND', arena: 'road', biome: 'meadow',
  objective: { kind: 'hold', duration: 35, radius: 170 },
};

const BREAK_DESC = {
  troops: ['spear', 'spear', 'archer', 'knight'],
  enemies: ['bandit', 'bandit', 'raider'],
  seed: 44, title: 'BREAK THE POSITION', arena: 'camp', biome: 'night',
  objective: { kind: 'break', guards: 2, hp: 260, radius: 30 },
};

// Installs the shared fixture preamble before the app loads: expands a plain
// descriptor into a real battle setup, starts it, and skips the intro.
async function openBattleHarness(page) {
  await page.addInitScript(() => {
    window.__bootObjectiveBattle = desc => {
      window.__g.startBattle({
        ...desc,
        troops: desc.troops.map(type => ({ type })),
        enemies: desc.enemies.map(type => ({ type })),
        onEnd: () => {},
      });
      const b = window.__g.scene;
      b.state = 'fight';
      return b;
    };
    // Reads the strings one HUD frame actually puts on the canvas. The objective panel is
    // presentation, so what it CLAIMS is asserted where the claim is made rather than
    // through a mirrored state field — a panel can lie while every field behind it is right,
    // which is exactly the defect these assertions guard.
    window.__drawnText = () => {
      const drawn = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
        drawn.push(String(text));
        return original.call(this, text, ...rest);
      };
      try { window.__g.draw(); } finally { CanvasRenderingContext2D.prototype.fillText = original; }
      return drawn;
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
}

test('hold zone placement is in-bounds, obstacle-clear, and deterministic', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(setup => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const build = () => {
        const b = window.__bootObjectiveBattle(JSON.parse(JSON.stringify(setup)));
        const o = b.objective;
        const inBounds = o.x - o.r >= 0 && o.x + o.r <= b.W && o.y - o.r >= 0 && o.y + o.r <= b.H;
        // Traversable: the marked ground's centre sits outside every physical
        // obstacle and every LOS blocker (hills/woods/houses).
        const clearPhysical = b.obstacles.every(o2 =>
          o2.kind === 'none' || (o2.x - o.x) ** 2 + (o2.y - o.y) ** 2 > o2.r * o2.r);
        const clearBlockers = b.blockers.every(o2 =>
          (o2.x - o.x) ** 2 + (o2.y - o.y) ** 2 > o2.r * o2.r);
        return { x: o.x, y: o.y, r: o.r, duration: o.duration, inBounds, clearPhysical, clearBlockers };
      };
      const a = build();
      const c = build();
      return { a, deterministic: a.x === c.x && a.y === c.y };
    } finally { g.update = real; }
  }, HOLD_DESC);
  expect(out.a.inBounds, 'hold zone inside the field').toBe(true);
  expect(out.a.clearPhysical, 'hold zone centre outside every obstacle').toBe(true);
  expect(out.a.clearBlockers, 'hold zone centre outside every LOS blocker').toBe(true);
  expect(out.a.duration).toBe(35);
  expect(out.deterministic).toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the hold clock runs only while a squad holds and no enemy contests', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const o = b.objective;
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      const pin = (unit, x, y) => { unit.x = x; unit.y = y; unit.hp = 99999; };
      const pinFoes = (except, x, y) => {
        for (const e of b.enemies) if (e !== except) pin(e, b.W - 120, b.H - 120);
        if (except) pin(except, x, y);
      };
      const holder = b.troops[0];
      const foe = b.enemies[0];

      // Held and uncontested: the timer runs.
      for (let i = 0; i < 10; i++) { pinFoes(null); pin(holder, o.x, o.y); step(0.1); }
      const heldOnly = { held: o.held, contested: o.contested, progress: o.progress };

      // An enemy inside the zone contests it: the clock pauses even though the
      // squad is still standing on the ground.
      for (let i = 0; i < 10; i++) { pinFoes(foe, o.x + 20, o.y); pin(holder, o.x, o.y); step(0.1); }
      const contested = { held: o.held, contested: o.contested, progress: o.progress };

      // The holder leaves: an empty zone does not bank progress either.
      for (let i = 0; i < 10; i++) { pinFoes(foe, o.x + 20, o.y); pin(holder, o.x - o.r - 140, o.y); step(0.1); }
      const empty = { held: o.held, contested: o.contested, progress: o.progress };

      // Holder back, contest driven off: the clock resumes from where it paused.
      for (let i = 0; i < 10; i++) { pinFoes(null); pin(holder, o.x, o.y); step(0.1); }
      const resumed = { held: o.held, contested: o.contested, progress: o.progress };
      return { heldOnly, contested, empty, resumed };
    } finally { g.update = real; }
  }, { setup: HOLD_DESC, dt: DT });
  expect(out.heldOnly.held).toBe(true);
  expect(out.heldOnly.contested).toBe(false);
  expect(out.heldOnly.progress).toBeGreaterThan(0.8);

  expect(out.contested.contested).toBe(true);
  expect(out.contested.progress).toBeCloseTo(out.heldOnly.progress, 1);

  expect(out.empty.held).toBe(false);
  expect(out.empty.contested).toBe(true);
  expect(out.empty.progress).toBeCloseTo(out.heldOnly.progress, 1);

  expect(out.resumed.held).toBe(true);
  expect(out.resumed.contested).toBe(false);
  expect(out.resumed.progress).toBeGreaterThan(out.heldOnly.progress + 0.8);
  assertNoRuntimeErrors(runtimeErrors);
});

test('holding to the timeout wins through resolveBattleResult exactly once', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const o = b.objective;
      let endCalls = 0;
      const realEnd = b.endBattle.bind(b);
      b.endBattle = (...args) => { endCalls++; realEnd(...args); };
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      o.progress = o.duration - 0.5;
      b.troops[0].x = o.x; b.troops[0].y = o.y;
      for (let i = 0; i < 6; i++) {
        for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; }
        step(0.1);
      }
      const ended = {
        state: b.state, victory: b.victory, endCalls, resolvedBy: b.resolvedBy,
        drawn: window.__drawnText(),
      };
      step(3); // ride out the end-banner hold so onEnd fires
      return { ended, onEndFired: b.onEndFired, enemiesLeft: b.enemies.length };
    } finally { g.update = real; }
  }, { setup: HOLD_DESC, dt: DT });
  expect(out.ended.state).toBe('end');
  expect(out.ended.victory).toBe(true);
  expect(out.ended.endCalls, 'objective timeout ends the fight exactly once').toBe(1);
  expect(out.ended.resolvedBy).toBe('objective');
  // The panel reports the resolution rather than a countdown over a won fight.
  expect(out.ended.drawn).toContain('Ground held');
  expect(out.ended.drawn.some(s => /^\d+s$/.test(s)),
    'a decided hold must not still show seconds remaining').toBe(false);
  expect(out.onEndFired).toBe(true);
  // Killing every enemy remains a valid PARALLEL win — here the enemies survived.
  expect(out.enemiesLeft).toBeGreaterThan(0);
  assertNoRuntimeErrors(runtimeErrors);
});

test('elimination remains a valid hold-objective victory with the clock unfinished', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      let endCalls = 0;
      const realEnd = b.endBattle.bind(b);
      b.endBattle = (...args) => { endCalls++; realEnd(...args); };
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      step(0.5);
      for (const e of [...b.enemies]) b.damageEnemy(e, e.hp + 10, 0, 0, 'qa');
      const before = { enemies: b.enemies.length, progress: b.objective.progress };
      step(0.2);
      return { before, state: b.state, victory: b.victory, endCalls };
    } finally { g.update = real; }
  }, { setup: HOLD_DESC, dt: DT });
  expect(out.before.enemies).toBe(0);
  expect(out.before.progress).toBeLessThan(35);
  expect(out.state).toBe('end');
  expect(out.victory).toBe(true);
  expect(out.endCalls).toBe(1);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a hold defense lost or abandoned resolves as a non-victory', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);

  // Defeat: the commander falls.
  const defeat = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      step(0.5);
      b.damageFriendly(b.hero, true, b.hero.hp + 1, { type: 'bandit', x: b.hero.x, y: b.hero.y });
      return {
        state: b.state, victory: b.victory, retreated: b.retreated,
        resolvedBy: b.resolvedBy, drawn: window.__drawnText(),
      };
    } finally { g.update = real; }
  }, { setup: HOLD_DESC, dt: DT });
  expect(defeat.state).toBe('end');
  expect(defeat.victory).toBe(false);
  expect(defeat.retreated).toBe(false);
  // The hero's death ends the fight inside damageFriendly, NOT through resolveBattleResult,
  // so `resolvedBy` is null here on purpose — and the panel still has to say what happened.
  // That is the whole reason the wording falls back to victory/retreated.
  expect(defeat.resolvedBy ?? null).toBe(null);
  expect(defeat.drawn).toContain('Ground lost');

  // Withdrawal: the held escape-edge decision — the player accepting the loss.
  const withdraw = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      for (let i = 0; i < 34; i++) {
        for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; }
        step(0.1); // battle.time must pass 3 before the bar may fill
      }
      b.hero.x = 50; b.hero.y = b.H / 2; // approach E puts escape in the west
      g.input.injectKey('KeyA', true);
      for (let i = 0; i < 14; i++) {
        for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; }
        step(0.1);
      }
      g.input.injectKey('KeyA', false);
      return {
        state: b.state, victory: b.victory, retreated: b.retreated,
        resolvedBy: b.resolvedBy, drawn: window.__drawnText(),
      };
    } finally { g.update = real; }
  }, { setup: HOLD_DESC, dt: DT });
  expect(withdraw.state).toBe('end');
  expect(withdraw.victory).toBe(false);
  expect(withdraw.retreated).toBe(true);
  expect(withdraw.resolvedBy).toBe('retreat');
  expect(withdraw.drawn).toContain('Ground lost — you withdrew');
  assertNoRuntimeErrors(runtimeErrors);
});

test('break guards spawn spread, obstacle-clear, in-bounds, and deterministically', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(setup => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const build = guardCount => {
        const s = { ...setup, objective: { ...setup.objective, guards: guardCount } };
        const b = window.__bootObjectiveBattle(s);
        const targets = b.objectiveTargets.map(t => ({ x: t.x, y: t.y, r: t.r, hp: t.hp, maxHp: t.maxHp }));
        const inBounds = targets.every(t =>
          t.x - t.r >= 40 && t.x + t.r <= b.W - 40 && t.y - t.r >= 40 && t.y + t.r <= b.H - 40);
        // The placement scan's own promise: a guard's footprint never overlaps a
        // physical obstacle (clearOf radius + 24 margin).
        const clear = targets.every(t => b.obstacles.every(o =>
          o.kind === 'none' || (o.x - t.x) ** 2 + (o.y - t.y) ** 2 > (o.r + t.r + 24) ** 2));
        const spread = guardCount === 1 ? true :
          targets.some((t, i) => i > 0 && (t.x !== targets[0].x || t.y !== targets[0].y));
        return { targets, inBounds, clear, spread };
      };
      const two = build(2);
      const three = build(3);
      const threeAgain = build(3);
      return {
        two: { count: two.targets.length, inBounds: two.inBounds, clear: two.clear, spread: two.spread, hp: two.targets[0].hp },
        three: { count: three.targets.length, inBounds: three.inBounds, clear: three.clear, spread: three.spread },
        deterministic: JSON.stringify(three.targets) === JSON.stringify(threeAgain.targets),
      };
    } finally { g.update = real; }
  }, BREAK_DESC);
  expect(out.two.count).toBe(2);
  expect(out.two.inBounds).toBe(true);
  expect(out.two.clear).toBe(true);
  expect(out.two.spread).toBe(true);
  expect(out.two.hp).toBe(260);
  expect(out.three.count).toBe(3);
  expect(out.three.inBounds).toBe(true);
  expect(out.three.clear).toBe(true);
  expect(out.three.spread).toBe(true);
  expect(out.deterministic, 'same setup builds the same guard positions').toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});

test('destroying every guard wins even with defenders still standing — exactly once', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      let endCalls = 0;
      const realEnd = b.endBattle.bind(b);
      b.endBattle = (...args) => { endCalls++; realEnd(...args); };
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      for (let i = 0; i < 5; i++) {
        for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; }
        step(0.1);
      }
      for (const t of b.objectiveTargets) b.damageObjective(t, t.hp + 10);
      const before = {
        guardsAlive: b.objectiveTargets.filter(t => !t.dead).length,
        enemies: b.enemies.length,
      };
      step(0.2);
      step(3);
      return { before, state: b.state, victory: b.victory, endCalls, onEndFired: b.onEndFired };
    } finally { g.update = real; }
  }, { setup: BREAK_DESC, dt: DT });
  expect(out.before.guardsAlive).toBe(0);
  expect(out.before.enemies).toBeGreaterThan(0);
  expect(out.state).toBe('end');
  expect(out.victory).toBe(true);
  expect(out.endCalls, 'the last guard fells the position exactly once').toBe(1);
  expect(out.onEndFired).toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});

test('eliminating every enemy also wins a break fight with guards still standing', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      step(0.5);
      for (const e of [...b.enemies]) b.damageEnemy(e, e.hp + 10, 0, 0, 'qa');
      const before = {
        enemies: b.enemies.length,
        guardsAlive: b.objectiveTargets.filter(t => !t.dead).length,
      };
      step(0.2);
      return {
        before, state: b.state, victory: b.victory, resolvedBy: b.resolvedBy,
        guardsAlive: b.objectiveTargets.filter(t => !t.dead).length,
        drawn: window.__drawnText(),
      };
    } finally { g.update = real; }
  }, { setup: BREAK_DESC, dt: DT });
  expect(out.before.enemies).toBe(0);
  expect(out.before.guardsAlive).toBeGreaterThan(0);
  expect(out.state).toBe('end');
  expect(out.victory).toBe(true);
  // The panel must report the RESOLUTION once the fight is over. This ending is the case
  // that lied: the guards are genuinely untouched, so the live line ("2 guards standing",
  // both bars full) sat over a victory banner and read as an unfinished objective.
  expect(out.resolvedBy, 'the win condition that fired is what the panel reads').toBe('elimination');
  expect(out.guardsAlive, 'the guards really do survive an elimination win').toBeGreaterThan(0);
  expect(out.drawn).toContain('OBJECTIVE · BREAK THE POSITION');
  expect(out.drawn).toContain('Position taken — garrison destroyed');
  expect(out.drawn.some(s => /guards? standing/.test(s)),
    'a decided fight must not still report standing guards as the objective').toBe(false);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a break fight where the last guard and the last enemy fall in the same tick ends once', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      // Count EFFECTIVE endings — resolveBattleResult checks its conditions in
      // sequence and endBattle's own state guard makes the redundant second call a
      // no-op, so the outcome must happen once, not the invocation.
      let effectiveEnds = 0;
      const realEnd = b.endBattle.bind(b);
      b.endBattle = (...args) => { if (b.state !== 'end') effectiveEnds++; realEnd(...args); };
      for (const e of [...b.enemies]) b.damageEnemy(e, e.hp + 10, 0, 0, 'qa');
      for (const t of b.objectiveTargets) b.damageObjective(t, t.hp + 10);
      // The last guard's death sets the death hit-stop, which consumes the next
      // tick — step past it; the claim under test is ONE ending, not one tick.
      for (let i = 0; i < 12; i++) real(dt);
      return { state: b.state, victory: b.victory, effectiveEnds };
    } finally { g.update = real; }
  }, { setup: BREAK_DESC, dt: DT });
  expect(out.state).toBe('end');
  expect(out.victory).toBe(true);
  expect(out.effectiveEnds, 'two simultaneous win conditions must produce ONE ending').toBe(1);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a HELD line stays on its anchor while a CHARGE breaks the position', async ({ page }) => {
  // Plan 040, audit finding 9. The Break-the-position block ran for every stance: a squad
  // with no hostile in reach took the nearest standing guard as its target however far
  // away it was, and the `d > wantR` branch then replaced the hold anchor with a formation
  // goal on it. A braced spear line in a camp raid walked across the field — the one thing
  // HOLD promises it will not do, and consistent with `holdLine` costing 62-63 s and 30 of
  // 120 raids unresolved in critiques/progression-comparison.md.
  //
  // The guards are moved well outside every troop's reach (a held melee body reaches 140,
  // an archer its 230) so the fixture isolates the rule rather than the geometry the arena
  // happened to roll. Both halves are asserted, because the fix must not make the position
  // unbreakable: HOLD stays home and touches nothing, CHARGE goes and breaks it.
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(async setup => {
    const { UNIT_TYPES } = await import('/src/data.js');
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    const dt = 1 / 60;
    try {
      const run = (order) => {
        const b = window.__bootObjectiveBattle(JSON.parse(JSON.stringify(setup)));
        // No enemies at all: this test is about the OBJECTIVE, and a live hostile would
        // legitimately give a held line something closer to do — and would take the CHARGE
        // column's target away from the guard entirely, since `charge` picks the nearest
        // ENEMY and the Break block only runs when nothing else was engaged.
        //
        // An empty field is an elimination victory on the first tick, so the fixture also
        // parks the one terminal decision point. This is the narrowest possible override:
        // `resolveBattleResult` is the only thing that ends a fight (this file's own header
        // states that), so silencing `endBattle` leaves the whole ordered tick pipeline —
        // troop phase, steering, objective phase — running exactly as it does in a real
        // battle, which is the thing under test.
        b.enemies.length = 0;
        b.endBattle = () => {};
        // Park every guard far from the line, and remember the anchors the order sets.
        const far = [];
        for (const o of b.objectiveTargets) {
          o.x = b.W - 80; o.y = b.H - 80; o.hp = o.maxHp;
          far.push(o);
        }
        b.issueCommand(order);
        const anchors = b.troops.map(t => ({ x: t.holdX, y: t.holdY, sx: t.x, sy: t.y }));
        for (let i = 0; i < 60 * 10; i++) real(dt);
        const drift = b.troops.map((t, i) => Math.hypot(t.x - anchors[i].sx, t.y - anchors[i].sy));
        return {
          maxDrift: Math.round(Math.max(...drift)),
          guardHp: far.map(o => Math.round(o.hp)),
          guardMaxHp: far.map(o => Math.round(o.maxHp)),
          state: b.state,
        };
      };
      return { hold: run('hold'), charge: run('charge'), meleeReach: 140, bowReach: UNIT_TYPES.archer.range };
    } finally { g.update = real; }
  }, BREAK_DESC);

  // A held line does not walk to a guard it cannot reach...
  expect(out.hold.maxDrift,
    `a held troop drifted ${out.hold.maxDrift}px from where it was anchored — the line is ` +
    'walking to the objective again').toBeLessThanOrEqual(60);
  // ...and therefore does not scratch it.
  expect(out.hold.guardHp, 'a held line damaged a guard it should not have reached')
    .toEqual(out.hold.guardMaxHp);
  // But the position is still breakable by a squad that is ORDERED to break it: charge
  // must both travel and do damage, or this fix made the objective unwinnable.
  expect(out.charge.maxDrift,
    'a charging line did not advance on the guard').toBeGreaterThan(out.hold.maxDrift);
  expect(Math.min(...out.charge.guardHp),
    'a charging line never damaged the guard it was sent at')
    .toBeLessThan(Math.max(...out.charge.guardMaxHp));
  assertNoRuntimeErrors(runtimeErrors);
});

test('losing the commander still loses a break fight', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      step(0.5);
      b.damageFriendly(b.hero, true, b.hero.hp + 1, { type: 'bandit', x: b.hero.x, y: b.hero.y });
      return { state: b.state, victory: b.victory, guardsAlive: b.objectiveTargets.filter(t => !t.dead).length };
    } finally { g.update = real; }
  }, { setup: BREAK_DESC, dt: DT });
  expect(out.state).toBe('end');
  expect(out.victory).toBe(false);
  expect(out.guardsAlive).toBe(2);
  assertNoRuntimeErrors(runtimeErrors);
});

test('an Entrenched stronghold reserve wave arrives on schedule and keeps kill accounting coherent', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const out = await page.evaluate(dt => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const setup = {
        troops: ['spear', 'spear', 'spear', 'archer'],
        enemies: ['brute'],
        seed: 55, title: 'WAVE TEST', arena: 'camp', biome: 'rose',
        objective: { kind: 'break', guards: 3, hp: 260, radius: 30 },
        waves: [{ at: 2, comp: ['bandit', 'wolf'] }],
      };
      const b = window.__bootObjectiveBattle(setup);
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      for (let i = 0; i < 19; i++) { for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; } step(0.1); }
      const before = { time: b.time, enemies: b.enemies.map(e => e.type), pending: b.pendingWaves.length, total: b.totalEnemies };
      for (let i = 0; i < 6; i++) step(0.1);
      const after = {
        time: b.time, enemies: b.enemies.map(e => e.type).sort(),
        pending: b.pendingWaves.length, total: b.totalEnemies,
        flash: b.commandFlash && b.commandFlash.text,
      };
      // Now wipe everything — original, wave, and guards — and the fight must end
      // in a coherent victory (totalEnemies feeds the loot formula). The guard
      // deaths set hit-stop, so step past it before judging the result.
      for (const e of [...b.enemies]) b.damageEnemy(e, e.hp + 10, 0, 0, 'qa');
      for (const t of b.objectiveTargets) b.damageObjective(t, t.hp + 10);
      for (let i = 0; i < 12; i++) real(dt);
      return { before, after, state: b.state, victory: b.victory, loot: b.loot };
    } finally { g.update = real; }
  }, DT);
  expect(out.before.time).toBeLessThan(2);
  expect(out.before.enemies).toEqual(['brute']);
  expect(out.before.pending).toBe(1);
  expect(out.after.time).toBeGreaterThanOrEqual(2);
  expect(out.after.pending).toBe(0);
  expect(out.after.enemies).toEqual(['bandit', 'brute', 'wolf']);
  expect(out.after.total).toBe(3);
  expect(out.after.flash).toBe('REINFORCEMENTS!');
  expect(out.state).toBe('end');
  expect(out.victory).toBe(true);
  expect(out.loot).toBeGreaterThan(0);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the objective panel surface exposes live progress for both kinds', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openBattleHarness(page);
  const hold = await page.evaluate(({ setup, dt }) => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      const o = b.objective;
      const step = seconds => { for (let i = 0; i < Math.round(seconds / dt); i++) real(dt); };
      for (let i = 0; i < 5; i++) { for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; } step(0.1); }
      b.troops[0].x = o.x; b.troops[0].y = o.y;
      for (let i = 0; i < 5; i++) { for (const e of b.enemies) { e.x = b.W - 120; e.y = b.H - 120; e.hp = 99999; } step(0.1); }
      return window.game.state().battle.objective;
    } finally { g.update = real; }
  }, { setup: HOLD_DESC, dt: DT });
  expect(hold.kind).toBe('hold');
  expect(hold.duration).toBe(35);
  expect(hold.held).toBe(true);
  expect(hold.contested).toBe(false);
  expect(hold.progress).toBeGreaterThan(0);

  const brk = await page.evaluate(setup => {
    const g = window.__g;
    const real = g.update.bind(g);
    g.update = () => {};
    try {
      const b = window.__bootObjectiveBattle(setup);
      b.objectiveTargets[0].dead = true;
      return window.game.state().battle.objective;
    } finally { g.update = real; }
  }, BREAK_DESC);
  expect(brk.kind).toBe('break');
  expect(brk.guardsTotal).toBe(2);
  expect(brk.guardsAlive).toBe(1);
  assertNoRuntimeErrors(runtimeErrors);
});
