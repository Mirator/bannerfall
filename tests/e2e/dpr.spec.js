import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, drainRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// The whole file runs on a 2x display. The rest of the suite — and every visual baseline —
// runs at deviceScaleFactor 1, and that is the other half of the same contract: the backing
// store is the ONLY thing the device pixel ratio is allowed to change. Layout, the pointer,
// the camera and the simulation all stay in CSS pixels, so a 1x and a 2x page must agree on
// every number that is not a backing-store dimension.
const VIEWPORT = { width: 1280, height: 720 };
const SEED = 20260817;
const POINT = { x: 412, y: 287 }; // an off-centre CSS point, so a 2x error cannot land on itself

test.use({ viewport: VIEWPORT, deviceScaleFactor: 2 });

async function bootMenu(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
}

// One synchronous evaluate: the scenario, the fixed steps, the freeze and the read all
// happen without an intervening rAF frame, so the result is reproducible on any host and at
// any ratio. The freeze is the visual suite's `game.update = () => {}` rather than the pause
// overlay, so nothing drifts between the two pages while the test compares them.
async function frozenSeededWorld(page, seed = SEED) {
  return page.evaluate(seedValue => {
    localStorage.clear();
    window.game.scenario('world', { seed: seedValue });
    // Plan 023: a parked hero freezes world time. keepAwake runs the tick pipeline anyway
    // without moving him, so these are real party-AI, spawn and raid-cadence ticks.
    window.game.keepAwake(true);
    window.game.step(1.5);
    window.game.keepAwake(false);
    const game = window.__g;
    game.update = () => {};
    game.draw();
    return {
      state: window.game.state(),
      camera: {
        x: game.camera.x, y: game.camera.y,
        w: game.camera.w, h: game.camera.h, zoom: game.camera.zoom,
      },
    };
  }, seed);
}

async function withRatioOnePage(browser, baseURL, body) {
  // browser.newContext() does not inherit the project's `use` options, so the base URL and
  // viewport are passed through explicitly — only the ratio differs from this file's pages.
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT, deviceScaleFactor: 1 });
  try {
    return await body(await context.newPage());
  } finally {
    await context.close();
  }
}

test('the backing store carries the device pixel ratio while layout stays in CSS pixels', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootMenu(page);
  const measured = await page.evaluate(() => {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    // An identity reset is what every draw path asks for; on a 2x display it must land on
    // the device scale, or the frame is drawn into a quarter of the backing store.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const identity = ctx.getTransform();
    // Camera.apply()'s own matrix goes through the same seam: zoom 1 must reach the device
    // as scale 2, not as scale 1.
    window.__g.camera.zoom = 1;
    window.__g.camera.x = 0; window.__g.camera.y = 0;
    window.__g.camera.sx = 0; window.__g.camera.sy = 0;
    window.__g.camera.apply(ctx);
    const camera = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return {
      ratio: window.devicePixelRatio,
      backing: [canvas.width, canvas.height],
      css: [canvas.clientWidth, canvas.clientHeight],
      cameraView: [window.__g.camera.w, window.__g.camera.h],
      pointer: [window.__g.input.mouse.x, window.__g.input.mouse.y],
      identity: [identity.a, identity.b, identity.c, identity.d, identity.e, identity.f],
      cameraScale: [camera.a, camera.d],
    };
  });

  expect(measured.ratio).toBe(2);
  expect(measured.css).toEqual([VIEWPORT.width, VIEWPORT.height]);
  expect(measured.backing).toEqual([VIEWPORT.width * 2, VIEWPORT.height * 2]);
  // Everything layout reads is the logical size, unchanged by the ratio.
  expect(measured.cameraView).toEqual([VIEWPORT.width, VIEWPORT.height]);
  expect(measured.pointer).toEqual([VIEWPORT.width / 2, VIEWPORT.height / 2]);
  expect(measured.identity).toEqual([2, 0, 0, 2, 0, 0]);
  expect(measured.cameraScale).toEqual([2, 2]);

  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a resize keeps the backing store at the ratio and the camera in CSS pixels', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootMenu(page);
  await page.setViewportSize({ width: 1000, height: 640 });
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.getElementById('game');
    return [canvas.clientWidth, canvas.clientHeight, canvas.width, canvas.height,
      window.__g.camera.w, window.__g.camera.h];
  })).toEqual([1000, 640, 2000, 1280, 1000, 640]);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the seeded world simulates identically at ratio 1 and ratio 2', async ({ page, browser, baseURL }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootMenu(page);
  const scaled = await frozenSeededWorld(page);
  const plain = await withRatioOnePage(browser, baseURL, async refPage => {
    await bootMenu(refPage);
    return frozenSeededWorld(refPage);
  });

  expect(scaled.state).toEqual(plain.state);
  expect(scaled.camera).toEqual(plain.camera);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a real click at one CSS point reaches the same world point at both ratios', async ({ page, browser, baseURL }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  // A real dispatched mouse event, not injectMouse: the CSS-pixel mapping under test lives
  // in the canvas mousemove listener, which injectMouse bypasses entirely.
  const probe = async target => {
    await bootMenu(target);
    await frozenSeededWorld(target);
    await target.mouse.move(POINT.x, POINT.y);
    await target.mouse.down();
    await target.mouse.up();
    return target.evaluate(() => {
      const game = window.__g;
      const aim = game.camera.toWorld(game.input.mouse.x, game.input.mouse.y);
      return {
        pointer: [game.input.mouse.x, game.input.mouse.y],
        world: [aim.x, aim.y],
        clicked: game.input.mouse.clicked,
      };
    });
  };

  const scaled = await probe(page);
  const plain = await withRatioOnePage(browser, baseURL, refPage => probe(refPage));

  expect(scaled.pointer).toEqual([POINT.x, POINT.y]);
  expect(scaled.clicked).toBe(true);
  expect(scaled.pointer).toEqual(plain.pointer);
  expect(scaled.world).toEqual(plain.world);
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});

test('menu, world and battle draw at ratio 2 without a runtime error', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootMenu(page);
  await page.evaluate(() => { window.game.scenario('world', { seed: 7 }); window.game.step(1); });
  await page.evaluate(() => { window.game.scenario('battle_small'); window.game.step(2); });
  await page.evaluate(() => { window.game.scenario('menu'); window.game.step(0.5); });
  await drainRuntimeErrors(page);
  assertNoRuntimeErrors(runtimeErrors);
});
