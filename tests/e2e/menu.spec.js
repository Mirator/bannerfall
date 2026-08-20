import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, bootFresh } from './test-helpers.js';

async function tapAction(page, action) {
  await page.evaluate(name => {
    window.game.action(name, true);
    window.__g.update(1 / 60);
    window.game.action(name, false);
    window.__g.draw();
  }, action);
}

async function tapKey(page, code) {
  await page.evaluate(keyCode => window.game.tap(keyCode), code);
}

async function seedTestCampaign(page, { gold = 731, hard = false } = {}) {
  await page.evaluate(async ({ savedGold, hardMode }) => {
    window.game.scenario('world', { seed: 1701 });
    window.__g.scene.save.gold = savedGold;
    window.__g.scene.save.hard = hardMode;
    window.__g.scene.save.stats.playT = 125;
    window.__g.persistRun();
    await window.__g.saves.flush();
    window.__g.enterMenu();
    window.__g.draw();
  }, { savedGold: gold, hardMode: hard });
}

test('saved campaign is the safe default and Enter continues without erasing it', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootFresh(page);
  await seedTestCampaign(page);

  const menu = await page.evaluate(() => window.game.state().menu);
  expect(menu.panel).toBe('root');
  expect(menu.selected).toBe('continue');
  expect(menu.items[0]).toEqual({
    id: 'continue',
    label: 'CONTINUE CAMPAIGN',
    meta: 'Normal · 4 troops · 2:05',
  });

  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  expect(await page.evaluate(() => window.__g.scene.save.gold)).toBe(731);
  expect(runtimeErrors).toEqual([]);
});

test('new campaign requires an explicit saved-run replacement confirmation', async ({ page }) => {
  await bootFresh(page);
  await seedTestCampaign(page, { gold: 812 });

  await tapAction(page, 'menuDown');
  await tapAction(page, 'confirm');
  await expect.poll(() => page.evaluate(() => window.game.state().menu.panel)).toBe('new');
  await tapAction(page, 'confirm');
  let state = await page.evaluate(() => window.game.state());
  expect(state.menu).toMatchObject({ panel: 'confirm', selected: 'cancel', pendingHard: false });

  await tapAction(page, 'confirm');
  expect(await page.evaluate(() => window.game.state().menu.panel)).toBe('new');
  expect(await page.evaluate(() => window.__g.loadRun().gold)).toBe(812);

  await tapAction(page, 'confirm');
  await tapAction(page, 'menuDown');
  await tapAction(page, 'confirm');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  state = await page.evaluate(() => window.game.state());
  expect(state.world.gold).toBe(80);
  expect(await page.evaluate(() => window.__g.loadRun().gold)).toBe(80);
});

test('hard mode, legacy shortcuts, settings, credits, mouse, and text hooks remain operable', async ({ page }) => {
  await bootFresh(page);

  await tapAction(page, 'confirm');
  await tapAction(page, 'menuDown');
  await tapAction(page, 'confirm');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  expect(await page.evaluate(() => window.__g.scene.save.hard)).toBe(true);

  await page.evaluate(async () => {
    await window.__g.saves.flush();
    window.__g.enterMenu();
    window.__g.draw();
  });
  await tapKey(page, 'KeyH');
  expect(await page.evaluate(() => window.game.state().menu)).toMatchObject({
    panel: 'confirm', selected: 'cancel', pendingHard: true,
  });
  await tapAction(page, 'menuBack');
  await tapAction(page, 'menuBack');
  expect(await page.evaluate(() => window.game.state().menu.panel)).toBe('root');
  await tapKey(page, 'KeyC');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');

  await page.evaluate(async () => {
    window.__g.clearRun();
    await window.__g.saves.flush();
    window.__g.enterMenu();
    window.__g.draw();
  });
  await tapAction(page, 'menuDown');
  await tapAction(page, 'confirm');
  expect(await page.evaluate(() => window.game.state().menu.panel)).toBe('settings');
  await tapAction(page, 'menuBack');
  expect(await page.evaluate(() => window.game.state().menu.panel)).toBe('root');

  const creditsCenter = await page.evaluate(() => {
    const region = window.__g.menuHitRegions.find(item => item.id === 'credits');
    return { x: region.x + region.w / 2, y: region.y + region.h / 2 };
  });
  await page.evaluate(({ x, y }) => window.game.click(x, y), creditsCenter);
  expect(await page.evaluate(() => window.game.state().menu.panel)).toBe('credits');
  expect(JSON.parse(await page.evaluate(() => window.render_game_to_text())).menu.panel).toBe('credits');
  expect(await page.evaluate(() => window.advanceTime(16))).toBe('menu');
});
