import { test, expect } from '@playwright/test';

test('world terrain queries use the rendered canonical curves', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__g);

  const geometry = await page.evaluate(() => {
    const game = window.__g;
    game.testSeed = 0;
    game.startWorld(null);
    const world = game.scene;
    const roadMidpoints = world.roadLines.map(line => line[Math.floor(line.length / 2)]);
    const river = world.riverLines[0];
    const riverPoint = river[2];
    const riverNext = river[3];
    const dx = riverNext[0] - riverPoint[0], dy = riverNext[1] - riverPoint[1];
    const length = Math.hypot(dx, dy) || 1;
    return {
      roadCount: world.roadLines.length,
      roadEndpoints: world.roadLines.map(line => [line[0], line[line.length - 1]]),
      roadMidpointQueries: roadMidpoints.map(([x, y]) => world.onRoad(x, y)),
      invisibleChord: world.onRoad(1375, 1150),
      riverStart: river[0],
      riverEnd: river[river.length - 1],
      riverCenterBlocked: world.riverBlockedAt(riverPoint[0], riverPoint[1]),
      riverBankOpen: world.riverBlockedAt(riverPoint[0] - dy / length * 60, riverPoint[1] + dx / length * 60),
      bridgeOpen: world.bridgePts.map(([x, y]) => world.riverBlockedAt(x, y)),
      pathSegments: world.riverSegs.length + world.roadSegs.length,
    };
  });

  expect(geometry.roadCount).toBe(4);
  expect(geometry.roadEndpoints).toEqual([
    [[700, 1150], [1500, 1750]],
    [[700, 1150], [1350, 550]],
    [[1500, 1750], [2050, 1150]],
    [[1350, 550], [2050, 1150]],
  ]);
  expect(geometry.roadMidpointQueries).toEqual([true, true, true, true]);
  expect(geometry.invisibleChord).toBe(false);
  expect(geometry.riverStart).toEqual([950, -40]);
  expect(geometry.riverEnd).toEqual([1060, 2240]);
  expect(geometry.riverCenterBlocked).toBe(true);
  expect(geometry.riverBankOpen).toBe(false);
  expect(geometry.bridgeOpen).toEqual([false, false, false]);
  expect(geometry.pathSegments).toBeGreaterThan(100);
});
