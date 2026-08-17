import { test, expect } from '@playwright/test';

async function boot(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
}

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
