import { test, expect } from '@playwright/test';
import { bootToMenu as boot } from './test-helpers.js';

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

test('named WITHDRAW action and its keyboard binding (KeyX) cancel a pre-battle brief identically', async ({ page }) => {
  await boot(page);
  async function withdraw(page, useNamed) {
    return page.evaluate((named) => {
      window.game.scenario('world', { seed: 424242 });
      const world = window.__g.scene;
      world.hero.x = 1600; world.hero.y = 900; // clear of every settlement's safe zone
      const mine = world.myStrength();
      world.parties.length = 0;
      world.parties.push({
        camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
        // weak enough to flee -> caught fleeing -> withdraw offered (decision 5)
        comp: Array.from({ length: Math.max(1, Math.round(mine * 0.4)) }, () => 'bandit'),
        home: { x: world.hero.x, y: world.hero.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
        occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
        _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
      });
      const party = world.parties[0];
      world.grace = 0;
      window.__g.update(1 / 60); // opens the brief
      if (named) window.__g.input.injectAction('withdraw', true);
      else window.__g.input.injectKey('KeyX', true);
      window.__g.update(1 / 60);
      if (named) window.__g.input.injectAction('withdraw', false);
      else window.__g.input.injectKey('KeyX', false);
      return {
        scene: window.__g.sceneName, screenGone: !world.screen,
        partyPresent: world.parties.includes(party), clashT: party.clashT, waryT: party.waryT,
      };
    }, useNamed);
  }
  const keyboard = await withdraw(page, false);
  const named = await withdraw(page, true);
  expect(named).toEqual(keyboard);
  expect(named.screenGone).toBe(true);
  expect(named.partyPresent).toBe(true);
});
