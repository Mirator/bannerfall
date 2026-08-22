import { test, expect } from '@playwright/test';
import { bootToMenu as boot } from './test-helpers.js';

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
