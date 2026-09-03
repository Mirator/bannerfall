import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// The deployment camera. A headless playtest recorded the defect this file guards: during
// 'deploy' the fit-to-action camera framed the player's line and left the enemy formation
// off screen, visible only as an edge chevron — the player formed a line against nothing he
// could see. The camera IS presentation, so every claim here is read off the camera's own
// visible world rect (`Camera.toWorld` of the two screen corners), which is the same
// transform the renderer and the minimap frustum use.
//
// Everything runs inside ONE page.evaluate per scenario, with the live scheduler parked
// afterwards, so no rAF tick can land between the step and the read.

// Every production scenario that reaches the deployment phase: battle_bridge is the one
// battle fixture that skips it (an ambush), and it is covered by the fight-camera case at
// the bottom instead.
const DEPLOY_SCENARIOS = [
  'battle_small', 'battle_big', 'battle_river', 'battle_woods', 'battle_settlement',
  'battle_hold', 'battle_break', 'battle_stronghold',
];

// The scenario's own intro is 1.1s, so 1.5s is inside the paused deployment phase — the
// same settle the nine battle visual baselines use, deliberately, so this file and those
// PNGs are talking about the same frame.
async function frameDeployment(page, scenario) {
  return page.evaluate(name => {
    localStorage.clear();
    window.game.scenario(name, {});
    window.game.step(1.5);
    const g = window.__g;
    g.update = () => {};
    const b = g.scene, cam = g.camera;
    const tl = cam.toWorld(0, 0), br = cam.toWorld(cam.w, cam.h);
    const outside = u => u.x < tl.x || u.x > br.x || u.y < tl.y || u.y > br.y;
    // The far edge of clampToDeployZone: the ground the player may actually place men on
    // ends here, and the phase draws the frontier, so it belongs inside the framing.
    // Restated rather than imported — src modules carry cache-token query strings that a
    // node-side spec cannot resolve — so it is kept in step with battle/constants.js by hand.
    const DEPLOY_NO_MANS = 220;
    const frontier = {
      x: b.W / 2 - b.adx * DEPLOY_NO_MANS,
      y: b.H / 2 - b.ady * DEPLOY_NO_MANS,
    };
    return {
      state: b.state,
      zoom: cam.zoom,
      troops: b.troops.length,
      enemies: b.enemies.length,
      troopsOutside: b.troops.filter(outside).length,
      enemiesOutside: b.enemies.filter(outside).length,
      heroOutside: outside(b.hero),
      frontierOutside: outside(frontier),
    };
  }, scenario);
}

for (const scenario of DEPLOY_SCENARIOS) {
  test(`the deployment camera frames both lines in ${scenario}`, async ({ page }) => {
    const runtimeErrors = collectRuntimeErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
    const out = await frameDeployment(page, scenario);
    expect(out.state, 'the fixture must actually be sitting in the paused phase').toBe('deploy');
    expect(out.enemies).toBeGreaterThan(0);
    expect(out.troops).toBeGreaterThan(0);
    // The claim, both sides of it: the player sees his own line AND what he is forming
    // against. The enemy half is the regression — it was the half that failed.
    expect(out.enemiesOutside, 'every enemy must be inside the deployment view').toBe(0);
    expect(out.troopsOutside, 'every troop must be inside the deployment view').toBe(0);
    expect(out.heroOutside).toBe(false);
    expect(out.frontierOutside, 'the deploy frontier must be framed with the line').toBe(false);
    // The zoom clamp is not negotiable presentation: below 0.80 the unit silhouettes stop
    // existing on screen (battle.js), and above 1.15 the fit stops being a fit.
    expect(out.zoom).toBeGreaterThanOrEqual(0.80);
    expect(out.zoom).toBeLessThanOrEqual(1.15);
    assertNoRuntimeErrors(runtimeErrors);
  });
}

test('a field that cannot fit frames the player line against the enemy front edge', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  // A 'N' approach puts ENGAGE_GAP (820) on the SHORT viewport axis: 720px shows 900 world
  // px at the 0.80 zoom floor, and the two formations' depth overruns that on its own. So
  // this is the branch where something MUST fall outside, and the question is only what.
  const out = await page.evaluate(dt => {
    const g = window.__g;
    g.startBattle({
      troops: [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' },
        { type: 'archer' }, { type: 'archer' }, { type: 'knight' }],
      enemies: [{ type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' }, { type: 'bandit' },
        { type: 'raider' }, { type: 'raider' }, { type: 'brute' }],
      seed: 91, title: 'NORTHWARD', arena: 'road', biome: 'meadow', approach: 'N',
      onEnd: () => {},
    });
    const real = g.update.bind(g);
    for (let i = 0; i < Math.round(1.5 / dt); i++) real(dt);
    g.update = () => {};
    const b = g.scene, cam = g.camera;
    const tl = cam.toWorld(0, 0), br = cam.toWorld(cam.w, cam.h);
    // Signed distance along the approach axis, from the field centre: negative is the
    // player's side, positive the enemy's.
    const sOf = (x, y) => (x - b.W / 2) * b.adx + (y - b.H / 2) * b.ady;
    const all = [...b.troops, ...b.enemies, b.hero];
    const unitSpan = {
      lo: Math.min(...all.map(u => sOf(u.x, u.y))),
      hi: Math.max(...all.map(u => sOf(u.x, u.y))),
    };
    const ownRear = Math.min(...b.troops.map(t => sOf(t.x, t.y)), sOf(b.hero.x, b.hero.y));
    const enemyFront = Math.min(...b.enemies.map(e => sOf(e.x, e.y)));
    // The view, in the same axis coordinate. tl/br are corners, so the axis extent is the
    // ordered pair of their projections whichever way the axis points.
    const vs = [sOf(tl.x, tl.y), sOf(br.x, br.y)].sort((p, q) => p - q);
    return {
      state: b.state, zoomT: b.zoomT,
      viewSpan: vs[1] - vs[0], viewLo: vs[0], viewHi: vs[1],
      camAxis: sOf(cam.x, cam.y),
      unitSpanLen: unitSpan.hi - unitSpan.lo,
      ownRear, enemyFront,
      heroAxis: sOf(b.hero.x, b.hero.y),
    };
  }, 1 / 60);
  expect(out.state).toBe('deploy');
  expect(out.zoomT, 'the fit is already at the zoom floor').toBeCloseTo(0.80, 6);
  expect(out.unitSpanLen, 'the fixture must overrun the view or it proves nothing')
    .toBeGreaterThan(out.viewSpan);
  // The rule: centre the span from the player's rearmost man to the enemy's FRONT edge.
  expect(out.camAxis, 'the view centres the player-line-to-enemy-front span')
    .toBeCloseTo((out.ownRear + out.enemyFront) / 2, 0);
  // Which is not the hero, and is forward of him — the defect was a view sat on the hero
  // with the enemy formation entirely past the far edge.
  expect(out.camAxis).toBeGreaterThan(out.heroAxis + 200);
  // Centring that span splits its shortfall evenly by construction, so both ends read on
  // screen instead of one being sacrificed whole. The magnitude is recorded rather than
  // guessed: measured 22px of shortfall on this fixture, ~11px at each end — under half a
  // body, where the old hero-centred view left the enemy front rank hundreds of px out.
  const shortfall = (out.enemyFront - out.ownRear) - out.viewSpan;
  expect(shortfall).toBeGreaterThan(0);
  expect(shortfall, 'the span the phase is about very nearly fits').toBeLessThan(40);
  expect(out.viewLo - out.ownRear).toBeCloseTo(shortfall / 2, 0);
  expect(out.enemyFront - out.viewHi).toBeCloseTo(shortfall / 2, 0);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the live fight camera still leads with the hero', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  // The pre-fight framing is a pre-fight rule. Once blows are exchanged the hero bias is
  // what keeps the fight readable, and battle_bridge (an ambush, no deployment phase) is
  // the fixture that reaches 'fight' on its own. The camera must be nearer the hero than
  // the plain midpoint of the field's bodies.
  const out = await page.evaluate(() => {
    localStorage.clear();
    window.game.scenario('battle_bridge', {});
    window.game.step(1.5);
    const g = window.__g;
    g.update = () => {};
    const b = g.scene, cam = g.camera;
    const all = [...b.troops, ...b.enemies, b.hero];
    const mid = {
      x: (Math.min(...all.map(u => u.x)) + Math.max(...all.map(u => u.x))) / 2,
      y: (Math.min(...all.map(u => u.y)) + Math.max(...all.map(u => u.y))) / 2,
    };
    const d = (a, bb) => Math.hypot(a.x - bb.x, a.y - bb.y);
    return {
      state: b.state,
      towardHero: d(cam, b.hero) <= d(mid, b.hero) + 1e-6,
    };
  });
  expect(out.state).toBe('fight');
  expect(out.towardHero, 'the fight camera keeps its hero bias').toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});
