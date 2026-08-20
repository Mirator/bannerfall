import { test, expect } from '@playwright/test';

// The game canvas is deliberately compared at CSS-pixel scale. Chromium can
// rasterize text and antialiased edges slightly differently on Windows and
// Linux, so a small per-pixel threshold is paired with a strict differing-area
// cap. A missing landmark, unit group, or large palette/layout change still
// changes far more than 1.5% of the canvas and fails the assertion.
const VISUAL_OPTIONS = {
  animations: 'disabled',
  scale: 'css',
  threshold: 0.20,
  maxDiffPixelRatio: 0.015,
};

async function settle(page, scenario, options = {}) {
  await page.goto('/');
  await page.evaluate(({ scenarioName, scenarioOptions }) => {
    localStorage.clear();
    window.game.scenario(scenarioName, scenarioOptions);
    const game = window.__g;
    const scene = game.scene;
    if (scenarioOptions.center) {
      scene.hero.x = scenarioOptions.center[0];
      scene.hero.y = scenarioOptions.center[1];
      game.camera.x = scenarioOptions.center[0];
      game.camera.y = scenarioOptions.center[1];
    }
    // Advance only through the synchronous fixed-step API. Replace the live
    // scheduler update with a no-op after the explicit steps so the capture is
    // frozen without drawing the user-facing pause overlay.
    if (scenarioOptions.steps) window.game.step(scenarioOptions.steps);
    game.update = () => {};
    game.paused = false;
    game.draw();
  }, { scenarioName: scenario, scenarioOptions: options });
  return page.locator('#game');
}

test('seeded world overview remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world', { seed: 20260817, steps: 0.5 });
  await expect(canvas).toHaveScreenshot('world-overview.png', VISUAL_OPTIONS);
});

test('title menu campaign vignette remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'menu', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('menu-campaign-vignette.png', VISUAL_OPTIONS);
});

test('world road river and bridge landmark remains visible', async ({ page }) => {
  const canvas = await settle(page, 'world', {
    seed: 20260817,
    center: [985, 640],
    // Plan 023: 0.5s (was 0.25s) so the frozen-world cue has fully settled at staleT === 1.
    // The world freezes on the third tick either way, so nothing else differs between the
    // two counts — this only makes the baseline insensitive to the fade constant.
    steps: 0.5,
  });
  await expect(canvas).toHaveScreenshot('world-bridge.png', VISUAL_OPTIONS);
});

test('pre-battle brief for a fleeing party remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_brief', { kind: 'partyFlee', seed: 424242 });
  await expect(canvas).toHaveScreenshot('world-brief-party.png', VISUAL_OPTIONS);
});

test('pre-battle brief for a camp assault with withdraw remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_brief', { kind: 'campScouted', seed: 424242 });
  await expect(canvas).toHaveScreenshot('world-brief-camp-withdraw.png', VISUAL_OPTIONS);
});

test('victory aftermath remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_aftermath', { seed: 424242, result: { victory: true } });
  await expect(canvas).toHaveScreenshot('world-aftermath-victory.png', VISUAL_OPTIONS);
});

test('defeat aftermath remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_aftermath', { seed: 424242, result: { victory: false } });
  await expect(canvas).toHaveScreenshot('world-aftermath-defeat.png', VISUAL_OPTIONS);
});

test('small road battle composition remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_small', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-small.png', VISUAL_OPTIONS);
});

test('large night camp battle composition remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_big', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-big-night-camp.png', VISUAL_OPTIONS);
});

test('bridge ambush battle composition remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_bridge', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-bridge-ambush.png', VISUAL_OPTIONS);
});
