import { test, expect } from '@playwright/test';
import { WORLD_ART } from '../../src/world/visual-style.js';

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

  expect(geometry.roadCount).toBe(5);
  expect(geometry.roadEndpoints).toEqual([
    [[700, 1150], [1500, 1750]],
    [[700, 1150], [1350, 550]],
    [[1500, 1750], [2050, 1150]],
    [[1350, 550], [2050, 1150]],
    [[2050, 1150], [2800, 600]],
  ]);
  expect(geometry.roadMidpointQueries).toEqual([true, true, true, true, true]);
  expect(geometry.invisibleChord).toBe(false);
  expect(geometry.riverStart).toEqual([960, -80]);
  expect(geometry.riverEnd).toEqual([850, 2240]);
  expect(geometry.riverCenterBlocked).toBe(true);
  expect(geometry.riverBankOpen).toBe(false);
  expect(geometry.bridgeOpen).toEqual([false, false, false]);
  expect(geometry.pathSegments).toBeGreaterThan(100);
});

test('roads curve through intentional crossings and rivers vary within the art contract', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__g);

  const geometry = await page.evaluate(() => {
    window.__g.startWorld(null);
    const w = window.__g.scene;
    const pointSegmentDistance = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const d2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / d2));
      return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
    };
    const distanceToLines = (p, lines) => Math.min(...lines.flatMap(line =>
      line.slice(1).map((b, i) => pointSegmentDistance(p, line[i], b))));
    const chordDeviation = line => {
      const a = line[0], b = line[line.length - 1];
      return Math.max(...line.slice(1, -1).map(p => pointSegmentDistance(p, a, b)));
    };
    const tangentAngleAt = point => Math.min(...w.roadLines.map(line => {
      let nearest = 0, nearestD = Infinity;
      line.forEach((p, i) => {
        const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
        if (d < nearestD) { nearest = i; nearestD = d; }
      });
      if (nearestD > 3) return Infinity;
      const a = line[Math.max(0, nearest - 2)], b = line[Math.min(line.length - 1, nearest + 2)];
      const degrees = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI);
      return Math.min(degrees, 180 - degrees);
    }));
    const crossings = [];
    for (const line of w.roadLines) for (const p of line) {
      const riverD = distanceToLines(p, w.riverLines);
      if (riverD <= 28) {
        const bridgeD = Math.min(...w.bridgePts.map(b => Math.hypot(p[0] - b[0], p[1] - b[1])));
        crossings.push({ riverD, bridgeD });
      }
    }
    const widthCollisionChecks = w.riverLines.flatMap((line, riverIndex) =>
      w.rivers[riverIndex].widths.map((width, sectionIndex) => {
        const sectionCount = w.rivers[riverIndex].widths.length;
        const i = Math.min(line.length - 2,
          Math.floor((sectionIndex + 0.5) / sectionCount * (line.length - 1)));
        const a = line[i], b = line[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy) || 1;
        const nx = -dy / length, ny = dx / length;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const reach = w.riverProfiles[riverIndex].profiles[i].left;
        return {
          nearBridge: w.nearAnyBridge(mx, my),
          inside: w.riverBlockedAt(mx + nx * (reach - 2), my + ny * (reach - 2)),
          outside: w.riverBlockedAt(mx + nx * (reach + 5), my + ny * (reach + 5)),
        };
      }));
    return {
      deviations: w.roadLines.map(chordDeviation),
      roadKinds: w.terrain.roadDefinitions.map(r => r.kind),
      bridgeRoadAngles: w.bridgePts.map(tangentAngleAt),
      frameMountainRoadDistances: w.scenery
        .filter(it => it.kind === 'mapFrame' && it.visualKind === 'mtn')
        .map(it => ({ x: it.x, y: it.y, distance: distanceToLines([it.x, it.y], w.roadLines) })),
      bridgeRiverDistances: w.bridgePts.map(p => distanceToLines(p, w.riverLines)),
      routedBridgeRoadDistances: w.bridgePts.map(p => distanceToLines(p, w.roadLines)),
      crossings,
      widths: w.rivers.flatMap(r => r.widths),
      shallowCounts: w.rivers.map(r => r.shallows.length),
      shallowDistances: w.rivers.flatMap((r, i) => r.shallows.map(sh => {
        const p = w.riverLines[i][Math.round(sh.t * (w.riverLines[i].length - 1))];
        return distanceToLines(p, [w.riverLines[i]]);
      })),
      widthCollisionChecks,
    };
  });

  expect(geometry.deviations.every(d => d > 20)).toBe(true);
  expect(geometry.roadKinds).toEqual(['minor', 'secondary', 'secondary', 'major', 'major']);
  expect(geometry.bridgeRoadAngles.every(angle => angle < 10)).toBe(true);
  expect(geometry.frameMountainRoadDistances.every(item => item.distance > 90)).toBe(true);
  expect(geometry.bridgeRiverDistances.every(d =>
    d < WORLD_ART.scale.bridge.max / 2 + WORLD_ART.rivers.minWidth / 2)).toBe(true);
  expect(geometry.routedBridgeRoadDistances.every(d => d < 2)).toBe(true);
  expect(geometry.crossings.length).toBeGreaterThan(0);
  expect(geometry.crossings.every(c => c.bridgeD < 82)).toBe(true);
  expect(Math.min(...geometry.widths)).toBeGreaterThanOrEqual(WORLD_ART.rivers.minWidth);
  expect(Math.max(...geometry.widths)).toBeLessThanOrEqual(WORLD_ART.rivers.maxWidth);
  expect(geometry.shallowCounts.every(n => n <= 1)).toBe(true);
  expect(geometry.shallowDistances.every(d => d < 22)).toBe(true);
  const widthChecks = geometry.widthCollisionChecks.filter(check => !check.nearBridge);
  expect(widthChecks.every(check => check.inside && !check.outside)).toBe(true);
});
