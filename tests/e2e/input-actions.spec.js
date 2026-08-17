import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
}

async function movementState(page, named) {
  return page.evaluate(useNamed => {
    window.game.scenario('world', { seed: 4401 });
    const game = window.__g;
    const before = { x: game.scene.hero.x, y: game.scene.hero.y };
    if (useNamed) game.input.injectAction('moveRight', true);
    else game.input.injectKey('KeyD', true);
    for (let i = 0; i < 30; i++) game.update(1 / 60);
    if (useNamed) game.input.injectAction('moveRight', false);
    else game.input.injectKey('KeyD', false);
    return { before, after: { x: game.scene.hero.x, y: game.scene.hero.y } };
  }, named);
}

test('named movement actions and keyboard bindings produce identical state', async ({ page }) => {
  await boot(page);
  const keyboard = await movementState(page, false);
  const named = await movementState(page, true);
  expect(named).toEqual(keyboard);
});

test('named combat commands, pause, mute, and abandon actions preserve keyboard behavior', async ({ page }) => {
  await boot(page);
  const commands = await page.evaluate(() => {
    window.game.scenario('battle_big');
    for (let i = 0; i < 80; i++) window.__g.update(1 / 60);
    window.game.key('Digit2', true); window.__g.update(1 / 60); window.game.key('Digit2', false);
    const keyboardCommand = window.__g.scene.command;
    window.game.scenario('battle_big');
    for (let i = 0; i < 80; i++) window.__g.update(1 / 60);
    window.game.action('commandCharge', true); window.__g.update(1 / 60); window.game.action('commandCharge', false);
    const namedCommand = window.__g.scene.command;
    window.game.scenario('world', { seed: 4402 });
    window.game.key('Escape', true); window.__g.update(1 / 60); window.game.key('Escape', false);
    const keyboardPaused = window.__g.paused;
    window.game.scenario('world', { seed: 4402 });
    window.game.action('pause', true); window.__g.update(1 / 60); window.game.action('pause', false);
    const namedPaused = window.__g.paused;
    window.game.action('mute', true); window.__g.update(1 / 60); window.game.action('mute', false);
    const muted = window.__g.sfx.muted;
    window.game.action('abandonRun', true); window.__g.update(1 / 60); window.game.action('abandonRun', false);
    return { keyboardCommand, namedCommand, keyboardPaused, namedPaused, muted, scene: window.__g.sceneName };
  });
  expect(commands.keyboardCommand).toBe('charge');
  expect(commands.namedCommand).toBe(commands.keyboardCommand);
  expect(commands.namedPaused).toBe(commands.keyboardPaused);
  expect(commands.muted).toBe(true);
  expect(commands.scene).toBe('menu');
});
