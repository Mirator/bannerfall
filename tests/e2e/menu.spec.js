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

// A paused run with a distinctive purse already on disk, so both pause exits can be told
// apart by what survives them. Pausing itself persists (main.js), and every call through
// window.game writes the test slot, never a real player's campaign.
async function pausedRun(page, gold) {
  await page.evaluate(async (savedGold) => {
    window.game.scenario('world', { seed: 1701 });
    window.__g.scene.save.gold = savedGold;
    window.game.action('pause', true);
    window.__g.update(1 / 60);
    window.game.action('pause', false);
    await window.__g.saves.flush();
  }, gold);
}

test('abandoning a run from the pause overlay takes two presses of R', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootFresh(page);
  await pausedRun(page, 555);
  expect(await page.evaluate(() => window.__g.paused)).toBe(true);

  // One press ARMS. The overlay used to delete the campaign here, with no confirmation of
  // any kind, from a line that read like "resume" and "mute".
  await tapAction(page, 'abandonRun');
  const armed = await page.evaluate(async () => {
    await window.__g.saves.flush();
    return {
      scene: window.__g.sceneName, paused: window.__g.paused,
      armed: window.__g.abandonArmT > 0,
      savedGold: (window.__g.loadRun() || {}).gold ?? null,
      stored: localStorage.getItem('bf_save_test') !== null,
    };
  });
  expect(armed).toEqual({ scene: 'world', paused: true, armed: true, savedGold: 555, stored: true });

  // The second press, inside the arm, is the one that destroys.
  await tapAction(page, 'abandonRun');
  const gone = await page.evaluate(async () => {
    await window.__g.saves.flush();
    return {
      scene: window.__g.sceneName, paused: window.__g.paused,
      save: window.__g.loadRun(), stored: localStorage.getItem('bf_save_test'),
    };
  });
  expect(gone).toEqual({ scene: 'menu', paused: false, save: null, stored: null });
  expect(runtimeErrors).toEqual([]);
});

test('the arm expires, and resuming clears it, so R alone can never abandon', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootFresh(page);
  await pausedRun(page, 606);

  // Armed, then waited out: the next R re-arms rather than committing.
  await tapAction(page, 'abandonRun');
  await page.evaluate(() => window.game.step(2.5));
  expect(await page.evaluate(() => window.__g.abandonArmT)).toBe(0);
  await tapAction(page, 'abandonRun');
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('world');

  // Resuming and pausing again is not a way to keep an arm alive across the boundary.
  await tapAction(page, 'pause');
  await tapAction(page, 'pause');
  const state = await page.evaluate(async () => {
    await window.__g.saves.flush();
    return { armT: window.__g.abandonArmT, paused: window.__g.paused, savedGold: (window.__g.loadRun() || {}).gold ?? null };
  });
  expect(state).toEqual({ armT: 0, paused: true, savedGold: 606 });
  await tapAction(page, 'abandonRun');
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('world');
  expect(runtimeErrors).toEqual([]);
});

test('quitting from the pause overlay keeps the campaign and CONTINUE resumes it', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootFresh(page);
  await pausedRun(page, 917);

  await tapAction(page, 'quitToMenu');
  const quit = await page.evaluate(async () => {
    await window.__g.saves.flush();
    return {
      scene: window.__g.sceneName, paused: window.__g.paused,
      stored: localStorage.getItem('bf_save_test') !== null,
      savedGold: (window.__g.loadRun() || {}).gold ?? null,
      selected: window.game.state().menu.selected,
    };
  });
  expect(quit).toEqual({ scene: 'menu', paused: false, stored: true, savedGold: 917, selected: 'continue' });

  await tapAction(page, 'confirm');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  expect(await page.evaluate(() => window.__g.scene.save.gold)).toBe(917);
  expect(runtimeErrors).toEqual([]);
});

test('the victory summary offers the menu as well as another campaign', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await bootFresh(page);
  const openSummary = () => page.evaluate(() => {
    window.game.scenario('victory_summary');
    window.game.step(1.6); // past the reveal arm, exactly as the screen itself gates on
  });

  // ESC is the way out from either row.
  await openSummary();
  expect(await page.evaluate(() => window.game.state().victory))
    .toEqual({ index: 0, selected: 'again', options: ['again', 'menu'], armed: true });
  await tapAction(page, 'menuBack');
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('menu');

  // And so does CONFIRM, once the MAIN MENU row is the live one.
  await openSummary();
  await tapAction(page, 'menuDown');
  expect(await page.evaluate(() => window.game.state().victory.selected)).toBe('menu');
  await tapAction(page, 'confirm');
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('menu');

  // The default row still restarts the run, which is what the summary has always done.
  await openSummary();
  await tapAction(page, 'confirm');
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
  expect(runtimeErrors).toEqual([]);
});

test('the victory prompt is never invisible once the summary has armed', async ({ page }) => {
  await bootFresh(page);
  // The prompt used to be gated on Math.sin(victoryT * 4) > -0.3, so it was absent for
  // roughly 30% of every cycle. This counts the pixels it actually paints, frame by frame,
  // across two full periods of the pulse that replaced the blink. The assertion is on the
  // rendered canvas, not on a second copy of the formula.
  const litPerFrame = await page.evaluate(() => {
    window.game.scenario('victory_summary');
    window.game.step(1.6); // past the reveal arm
    const element = document.getElementById('game');
    const context = element.getContext('2d');
    const top = Math.round(element.height * 0.885) - 13;
    const counts = [];
    // 50 samples 0.1s apart is 5s of screen time, against a pulse period of 2*PI/3 ~ 2.1s:
    // two full cycles, so a trough anywhere in the wave is sampled.
    for (let frame = 0; frame < 50; frame++) {
      window.game.step(0.1); // step() draws, so each sample is a real painted frame
      const pixels = context.getImageData(0, top, element.width, 26).data;
      let lit = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        // The selected row is PAL.world.hero (#FFD34D) over ink, at whatever alpha the
        // pulse is at. Warm and light: the cream banner poles in the same strip fail
        // r - b > 60, and the ink ground fails r > 120.
        if (r > 120 && r > g && g > b && r - b > 60) lit++;
      }
      counts.push(lit);
    }
    return counts;
  });
  expect(Math.min(...litPerFrame)).toBeGreaterThan(30);
});

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
