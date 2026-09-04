import { test, expect } from '@playwright/test';
import { bootToMenu as boot, collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

test('suspend is deduplicated and requests one storage flush', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    let suspendCount = 0;
    let flushCount = 0;
    window.__g.platform.lifecycle.onSuspend(() => { suspendCount++; });
    window.__g.platform.storage.flush = async () => { flushCount++; };
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    await window.__g.saves.flush();
    return { suspendCount, flushCount };
  });
  expect(result).toEqual({ suspendCount: 1, flushCount: 2 });
});

test('storage failure becomes a player-visible warning without crashing', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.game.scenario('world', { seed: 8844 }));
  await page.evaluate(() => {
    window.__g.platform.storage.write = async () => { throw new Error('quota exceeded'); };
    window.__g.persistRun();
  });
  await expect.poll(() => page.evaluate(() => window.__g.saveWarning)).toBe('Save failed — progress may not be stored.');
  expect(await page.evaluate(() => window.__g.saveError.message)).toContain('quota exceeded');
});

// The existing storage-failure test above replaces `platform.storage.write` at the
// repository seam, so the WEB ADAPTER's own try/catch never ran and neither did
// storageError(). This drives the real adapter against a localStorage that throws, which
// is what a full quota or a locked-down private window actually looks like.
test('the web adapter names the failed operation and its semantic slot', async ({ page }) => {
  await boot(page);
  const messages = await page.evaluate(async () => {
    const proto = Object.getPrototypeOf(localStorage);
    const original = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
    const boom = () => { throw new Error('quota exceeded'); };
    proto.getItem = boom; proto.setItem = boom; proto.removeItem = boom;
    const seen = [];
    const capture = async run => {
      try { await run(); seen.push('resolved without error'); }
      catch (error) { seen.push(error.message); }
    };
    try {
      const storage = window.__g.platform.storage;
      // no frame can run between these: every await here settles on the microtask queue
      await capture(() => storage.read('campaign'));
      await capture(() => storage.write('testCampaign', '{}'));
      await capture(() => storage.remove('settings'));
    } finally {
      Object.assign(proto, original);
    }
    return seen;
  });
  expect(messages).toEqual([
    'Web storage read failed for campaign: quota exceeded',
    'Web storage write failed for testCampaign: quota exceeded',
    'Web storage remove failed for settings: quota exceeded',
  ]);
});

test('backgrounding suspends once and returning to the tab resumes once', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const seen = [];
    const lifecycle = window.__g.platform.lifecycle;
    lifecycle.onDeactivate(() => seen.push('deactivate'));
    lifecycle.onSuspend(() => seen.push('suspend'));
    lifecycle.onResume(() => seen.push('resume'));
    const backgroundedWhileBlurred = [];
    window.dispatchEvent(new FocusEvent('blur'));
    backgroundedWhileBlurred.push(lifecycle.isBackgrounded());
    window.dispatchEvent(new FocusEvent('blur')); // a repeat must not re-notify
    backgroundedWhileBlurred.push(lifecycle.isBackgrounded());
    window.dispatchEvent(new FocusEvent('focus'));
    window.dispatchEvent(new FocusEvent('focus')); // nor must a repeat re-resume
    return { seen, backgroundedWhileBlurred, backgroundedAfter: lifecycle.isBackgrounded() };
  });
  expect(result.seen).toEqual(['deactivate', 'suspend', 'resume']);
  expect(result.backgroundedWhileBlurred).toEqual([true, true]);
  expect(result.backgroundedAfter).toBe(false);
});

// persistRun()'s integrity guard. A non-finite coordinate is exactly what the
// Camera.toWorld() shake defect produced once already, and writing one would persist a
// campaign that cannot be loaded — so the guard refuses the write and reports instead.
test('a non-finite campaign coordinate is refused rather than persisted', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.game.scenario('world', { seed: 8844 }));
  const cases = await page.evaluate(async () => {
    const game = window.__g;
    const out = [];
    game.scene.parties.push({ camp: 'c1', x: 900, y: 1400, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit'], home: { x: 900, y: 1400 }, wander: null, wanderT: 0 });
    for (const spoil of [
      () => { const h = game.scene.hero, x = h.x; h.x = NaN; return () => { h.x = x; }; },
      () => { const p = game.scene.parties[0], y = p.y; p.y = Infinity; return () => { p.y = y; }; },
    ]) {
      game.saveWarning = null; game.saveError = null;
      const before = localStorage.getItem('bf_save_test');
      const restore = spoil();
      game.persistRun();
      await game.saves.flush();
      out.push({
        warning: game.saveWarning,
        error: game.saveError && game.saveError.message,
        slotUnchanged: localStorage.getItem('bf_save_test') === before,
      });
      restore();
    }
    return out;
  });
  for (const result of cases) {
    expect(result.warning).toBe('Save failed — progress may not be stored.');
    expect(result.error).toBe('Save snapshot contains non-finite campaign coordinates');
    expect(result.slotUnchanged).toBe(true);
  }
});

test('save warning is drawn across scenes and clears only after campaign recovery', async ({ page }, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await boot(page);
  await page.evaluate(async () => {
    window.game.scenario('world', { seed: 8844 });
    await window.__g.saves.flush();
    const game = window.__g;
    const write = game.platform.storage.write;
    window.restoreWrites = () => { game.platform.storage.write = write; };
    game.platform.storage.write = async (slot, raw) => {
      if (slot === 'testCampaign') throw new Error('quota exceeded');
      return write(slot, raw);
    };
    game.persistRun();
    await game.saves.flush().catch(() => {});
    await game.sfx.setMuted(true); // settings success must not clear the campaign failure
    game.update = () => {};
    game.draw();
  });
  const canvas = page.locator('#game');
  await canvas.screenshot({ path: testInfo.outputPath('save-warning-world.png') });
  for (const scene of ['world', 'battle_small', 'victory', 'menu']) {
    const drawn = await page.evaluate(sceneName => {
      const game = window.__g;
      if (sceneName !== 'world') window.game.scenario(sceneName, { seed: 8844 });
      const ctx = document.getElementById('game').getContext('2d');
      const fillText = ctx.fillText.bind(ctx), text = [];
      ctx.fillText = (...args) => { text.push(args[0]); return fillText(...args); };
      try { game.draw(); game.paused = true; game.draw(); game.paused = false; }
      finally { ctx.fillText = fillText; }
      return { text, warning: game.saveWarning, stateWarning: JSON.parse(window.render_game_to_text()).saveWarning };
    }, scene);
    expect(drawn.warning).toBe('Save failed — progress may not be stored.');
    expect(drawn.text.filter(text => text === drawn.warning)).toHaveLength(2);
    expect(drawn.stateWarning).toBe(drawn.warning);
    expect(drawn.text.join(' ')).not.toMatch(/campaign saved|closing the tab is safe/);
  }
  await page.evaluate(async () => {
    window.restoreWrites();
    window.game.scenario('world', { seed: 8844 });
    window.__g.persistRun();
    await window.__g.saves.flush();
    window.__g.draw();
  });
  expect(await page.evaluate(() => window.__g.saveWarning)).toBeNull();
  assertNoRuntimeErrors(errors);
});

test('an older pending write cannot clear a newer snapshot validation failure', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    window.game.scenario('world', { seed: 8844 });
    const game = window.__g;
    await game.saves.flush();
    const write = game.platform.storage.write;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    game.platform.storage.write = async (slot, raw) => { await gate; return write(slot, raw); };
    game.persistRun();
    const x = game.scene.hero.x;
    game.scene.hero.x = NaN;
    game.persistRun();
    game.scene.hero.x = x;
    release();
    await game.saves.flush();
    const afterOlderWrite = game.saveWarning;
    await game.sfx.setMuted(true);
    const afterSettings = game.saveWarning;
    game.persistRun();
    await game.saves.flush();
    return { afterOlderWrite, afterSettings, afterRecovery: game.saveWarning };
  });
  expect(result.afterOlderWrite).toBe('Save failed — progress may not be stored.');
  expect(result.afterSettings).toBe(result.afterOlderWrite);
  expect(result.afterRecovery).toBeNull();
});

for (const key of ['bf_save', 'bf_save_test', 'bf_mute']) {
  test(`startup read failure for ${key} preserves bytes and retries without duplicate wiring`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await boot(page);
    const before = await page.evaluate(async () => {
      window.__g.startNewCampaign(false);
      await window.__g.saves.flush();
      localStorage.setItem('bf_save_test', localStorage.getItem('bf_save'));
      localStorage.setItem('bf_mute', '1');
      return ['bf_save', 'bf_save_test', 'bf_mute'].map(key => localStorage.getItem(key));
    });
    await page.addInitScript(failedKey => {
      window.failReads = true;
      const original = Storage.prototype.getItem;
      window.storedBytes = () => ['bf_save', 'bf_save_test', 'bf_mute'].map(key => original.call(localStorage, key));
      Storage.prototype.getItem = function (key) {
        if (window.failReads && key === failedKey) throw new Error('storage denied');
        return original.call(this, key);
      };
      window.wiringCounts = {};
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, ...args) {
        if (this === window || this === document) window.wiringCounts[type] = (window.wiringCounts[type] || 0) + 1;
        return add.call(this, type, ...args);
      };
    }, key);
    await page.reload();
    const retry = page.getByRole('button', { name: 'Retry loading' });
    await expect(retry).toBeVisible();
    expect(await page.evaluate(() => window.__g === undefined)).toBe(true);
    expect(await page.evaluate(() => window.storedBytes())).toEqual(before);
    const counts = await page.evaluate(() => window.wiringCounts);
    await retry.click();
    await expect(retry).toBeEnabled();
    expect(await page.evaluate(() => window.wiringCounts)).toEqual(counts);
    expect(await page.evaluate(() => window.storedBytes())).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath('startup-storage-retry.png') });
    await page.evaluate(() => { window.failReads = false; });
    await retry.click();
    await expect(page.locator('#storage-recovery')).toHaveCount(0);
    await page.waitForFunction(() => window.__g?.sceneName === 'menu');
    expect(await page.evaluate(() => window.storedBytes())).toEqual(before);
    const resumed = await page.evaluate(() => {
      let calls = 0;
      window.__g.platform.lifecycle.onSuspend(() => calls++);
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      return { calls, savedGold: window.__g.loadRun().gold };
    });
    expect(resumed.calls).toBe(1);
    expect(resumed.savedGold).toBe(JSON.parse(before[0]).gold);
    expect(errors).toEqual([]);
  });
}
