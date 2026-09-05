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
  // The bundled face is what makes these baselines portable, and canvas text falls back
  // silently while it is still loading. Capture only once it is actually available.
  await page.waitForFunction(() => document.fonts.check('800 16px Inter'));
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
    // frozen without drawing the user-facing pause overlay — unless the overlay
    // IS the subject, which `paused: true` asks for. The freeze is what makes
    // that safe: a real pause would keep re-arming the abandon countdown, and
    // the overlay draws that countdown.
    if (scenarioOptions.steps) window.game.step(scenarioOptions.steps);
    game.update = () => {};
    game.paused = !!scenarioOptions.paused;
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

// Plan 030: the site menu is the one modal behind every map interaction, so the two shapes
// it takes are both worth pinning — a town, which carries every service row including a
// refused one, and a camp, whose single row is the door to the assault brief.
test('the town site menu remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_site', { kind: 'town', seed: 424242 });
  await expect(canvas).toHaveScreenshot('world-site-town.png', VISUAL_OPTIONS);
});

test('the camp site menu remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_site', { kind: 'camp', seed: 424242 });
  await expect(canvas).toHaveScreenshot('world-site-camp.png', VISUAL_OPTIONS);
});

// The two permanent-choice modals. They had no visual coverage at all until now, which is
// why the shared-painter question could not honestly be settled: nothing would have caught
// a regression in either.
test('the specialization choice remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_choice', { kind: 'spec', seed: 424242 });
  await expect(canvas).toHaveScreenshot('world-spec-choice.png', VISUAL_OPTIONS);
});

test('the perk choice remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_choice', { kind: 'perk', seed: 424242 });
  await expect(canvas).toHaveScreenshot('world-perk-choice.png', VISUAL_OPTIONS);
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

// Plan 024 Phase 8: the three briefless scenarios above never carry a setup.field, so none
// of the visual suite exercised real campaign-map terrain until now. These three are
// brief-derived (see src/main.js's battle_river/battle_woods/battle_settlement), pinned to
// world positions that provably yield the terrain each name promises (world seed 7, approach
// 'E', brief seed 12345 — see plans/024-battlefield-rework.md's Phase 8 section).
test('river-crossing battle terrain remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_river', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-river-crossing.png', VISUAL_OPTIONS);
});

test('wooded-highland battle terrain remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_woods', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-wooded-highland.png', VISUAL_OPTIONS);
});

test('bridge and settlement battle terrain remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_settlement', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-bridge-settlement.png', VISUAL_OPTIONS);
});

// Milestone 025 baselines: the regional-conquest surfaces. The world territory frame
// pins ownership banners (a Barracks holding), an occupied settlement with its
// occupier posted at the gate, and the WEAKENED power chip; the two power frames pin
// the other chip states at the stronghold itself; the three objective battles pin the
// hold zone/break guards/stronghold HUD; the summary pins the campaign-end screen.
test('territory ownership banners occupied ground and the weakened power chip remain visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_region', {
    seed: 20260817,
    owned: ['ashford'],
    spec: { ashford: 'barracks' },
    occupied: ['brindle'],
    razed: ['c1'],
    center: [1100, 1450],
    steps: 0.5,
  });
  await expect(canvas).toHaveScreenshot('world-territory-ownership.png', VISUAL_OPTIONS);
});

test('the WEAKENED stronghold power state remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_region', {
    seed: 20260817,
    owned: ['ashford', 'brindle'],
    center: [2620, 780],
    steps: 0.5,
  });
  await expect(canvas).toHaveScreenshot('world-power-weakened.png', VISUAL_OPTIONS);
});

test('the EXPOSED stronghold power state remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world_region', {
    seed: 20260817,
    owned: ['ashford', 'brindle', 'coldwell', 'keep'],
    razed: ['c1', 'c2', 'c3'],
    center: [2620, 780],
    steps: 0.5,
  });
  await expect(canvas).toHaveScreenshot('world-power-exposed.png', VISUAL_OPTIONS);
});

test('the Hold-the-ground objective HUD and zone remain visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_hold', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-hold.png', VISUAL_OPTIONS);
});

test('the Break-the-position objective HUD and guards remain visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_break', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-break.png', VISUAL_OPTIONS);
});

test('the stronghold assault HUD with its reserve wave remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'battle_stronghold', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('battle-stronghold.png', VISUAL_OPTIONS);
});

test('the campaign summary remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'victory_summary', { steps: 1.5 });
  await expect(canvas).toHaveScreenshot('victory-summary.png', VISUAL_OPTIONS);
});

// The two screens the suite could not see, added after the 2026-09-05 UI audit.
//
// The summary above is captured at steps 1.5 and the terminal choice only draws past
// `victoryT > 1.5` (main.js drawVictory), so the rows the player needs in order to do
// anything at all were outside every baseline in the repository. Captured at 3s, which is
// also past the point where the selected row's alpha pulse has left its opening phase.
//
// NOTE for whoever fixes finding 1 of critiques/ui-ux-audit-2026-09-05.md: this baseline
// pins the CURRENT layout, in which those rows are drawn at H*0.885 on top of the banner
// poles drawn from H*0.80, and the pulse lets a pole show through the primary action. It is
// a truthful record of a screen that is wrong. Moving the rows is a deliberate visual change
// and re-records this PNG; that is the gate working, not a regression.
test('the armed victory choice remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'victory_summary', { steps: 3 });
  await expect(canvas).toHaveScreenshot('victory-summary-armed.png', VISUAL_OPTIONS);
});

// The pause overlay had no coverage of any kind: it is drawn by main.js outside every
// scene's own draw path, so no scene baseline reaches it. `abandonArmT` is deliberately
// left at 0: the armed variant of that line prints a countdown to one decimal, which a PNG
// cannot hold stable. Its wording is pinned in hud-copy.spec.js, which can set the arm.
test('the pause overlay remains visually stable', async ({ page }) => {
  const canvas = await settle(page, 'world', { seed: 20260817, steps: 0.5, paused: true });
  await expect(canvas).toHaveScreenshot('world-paused.png', VISUAL_OPTIONS);
});
