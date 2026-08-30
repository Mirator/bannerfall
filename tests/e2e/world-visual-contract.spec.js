import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORLD_ART, worldHudLayout, pointInWorldHud } from '../../src/world/visual-style.js';

const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x &&
  a.y < b.y + b.h && a.y + a.h > b.y;

test('all world asset families share the art-direction scale and shadow contract', () => {
  expect(WORLD_ART.scale.tree).toMatchObject({ min: 24, max: 42 });
  expect(WORLD_ART.scale.rock).toMatchObject({ min: 18, max: 32 });
  expect(WORLD_ART.scale.mountain).toMatchObject({ min: 90, max: 150 });
  expect(WORLD_ART.scale.bridge).toMatchObject({ min: 55, max: 70 });
  expect(WORLD_ART.scale.village).toMatchObject({ min: 130, max: 160 });
  expect(WORLD_ART.scale.fort).toMatchObject({ min: 170, max: 210 });
  expect(Object.keys(WORLD_ART.shadow).sort()).toEqual([
    'direction', 'landmarkAlpha', 'mountainAlpha', 'smallAlpha', 'terrainAlpha', 'treeAlpha',
  ]);

  const here = fileURLToPath(new URL('../../src/world/render-scene.js', import.meta.url));
  const renderer = readFileSync(here, 'utf8');
  for (const family of ['tree', 'rock', 'mountain', 'bridge', 'village', 'fort', 'camp']) {
    expect(renderer, `${family} must use WORLD_ART.scale`).toContain(`WORLD_ART.scale.${family}`);
  }
  expect(renderer).toContain('WORLD_ART.shadow.terrainAlpha');
  const terrain = readFileSync(fileURLToPath(new URL('../../src/world/terrain.js', import.meta.url)), 'utf8');
  expect(terrain).toContain('paths.forestFloors.moveTo');
  expect(terrain).toContain('paths.deadGround.moveTo');
});

test('authored clusters reinforce regions and suppress isolated decoration', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__g);
  const model = await page.evaluate(() => {
    window.__g.startWorld(null);
    const w = window.__g.scene;
    return {
      terrainRegions: w.terrainRegions.map(r => ({ id: r.id, points: r.points.length })),
      scenery: w.scenery.map(it => ({
        kind: it.kind, visualKind: it.visualKind, family: it.family, clusterId: it.clusterId,
        regionId: it.regionId, mapVisible: it.mapVisible, x: it.x, y: it.y,
      })),
      clusters: [...w.visualClusters].map(([id, c]) => ({ id, count: c.items.length, r: c.r })),
    };
  });

  expect(model.terrainRegions.map(r => r.id)).toEqual(['west', 'center', 'east']);
  for (const region of model.terrainRegions) {
    expect(region.points).toBeGreaterThanOrEqual(8);
    expect(region.points).toBeLessThanOrEqual(12);
  }
  for (const it of model.scenery.filter(it => it.kind !== 'shrub' || it.mapVisible)) {
    expect(it.family, `${it.kind} family`).toBeTruthy();
    expect(it.clusterId, `${it.kind} cluster`).toBeTruthy();
    expect(['west', 'center', 'east']).toContain(it.regionId);
  }
  expect(model.scenery.filter(it => it.kind === 'shrub' && !it.mapVisible).length).toBeGreaterThan(0);
  expect(model.scenery.filter(it => it.family === 'farmland' && it.regionId === 'west').length).toBeGreaterThanOrEqual(2);
  expect(model.scenery.some(it => it.clusterId === 'frame-brindle' && it.family === 'forest')).toBe(true);
  expect(model.scenery.some(it => it.clusterId === 'frame-highmere' && it.family === 'foothills')).toBe(true);
  expect(model.scenery.some(it => it.clusterId === 'frame-wolfsjaw' && it.regionId === 'east')).toBe(true);
  expect(model.clusters.every(cluster => cluster.count >= 1 && cluster.r > 0)).toBe(true);
});

test('interactive landmarks retain negative space and unchanged coordinates', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__g);
  const result = await page.evaluate(() => {
    window.__g.startWorld(null);
    const w = window.__g.scene;
    const points = [...w.scenery]
      .filter(it => it.mapVisible !== false && it.kind !== 'field' && it.kind !== 'mapFrame')
      .map(it => ({ x: it.x, y: it.y }));
    const defs = [
      ...window.__g.scene.save.settlements.map(rec => {
        const def = [{ id: 'ashford', x: 700, y: 1150 }, { id: 'brindle', x: 1500, y: 1750 },
          { id: 'coldwell', x: 1350, y: 550 }, { id: 'keep', x: 2050, y: 1150 }].find(x => x.id === rec.id);
        return { ...def, clearance: rec.id === 'keep' ? 150 : 125 };
      }),
      { id: 'c1', x: 1050, y: 1500, clearance: 120 },
      { id: 'c2', x: 1850, y: 500, clearance: 120 },
      { id: 'c3', x: 2500, y: 1750, clearance: 120 },
      { id: 'strong', x: 2800, y: 600, clearance: 150 },
    ];
    return defs.map(def => ({ ...def, nearest: Math.min(...points.map(p => Math.hypot(p.x - def.x, p.y - def.y))) }));
  });

  expect(result.map(({ id, x, y }) => ({ id, x, y }))).toEqual([
    { id: 'ashford', x: 700, y: 1150 }, { id: 'brindle', x: 1500, y: 1750 },
    { id: 'coldwell', x: 1350, y: 550 }, { id: 'keep', x: 2050, y: 1150 },
    { id: 'c1', x: 1050, y: 1500 }, { id: 'c2', x: 1850, y: 500 },
    { id: 'c3', x: 2500, y: 1750 }, { id: 'strong', x: 2800, y: 600 },
  ]);
  for (const item of result) expect(item.nearest, item.id).toBeGreaterThanOrEqual(item.clearance);
});

for (const [width, height] of [[960, 540], [1280, 720], [1600, 900]]) {
  test(`HUD-safe rectangles are shared and non-overlapping at ${width}x${height}`, () => {
    const layout = worldHudLayout(width, height);
    for (const rect of [layout.resource, layout.objective, layout.topSafe, layout.bottomSafe]) {
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(height);
    }
    expect(overlap(layout.resource, layout.objective)).toBe(false);
    expect(pointInWorldHud(width / 2, 20, width, height)).toBe(true);
    expect(pointInWorldHud(width / 2, height - 20, width, height)).toBe(true);
    expect(pointInWorldHud(width / 2, height / 2, width, height)).toBe(false);
  });
}

// The map's name plates used to only set `textAlign` and inherit whatever `textBaseline`
// the previous frame's HUD left behind: the landmark interaction chip ends on
// 'alphabetic' and the resource chip ends on 'middle', so a settlement name jumped to the
// top edge of its own plate on every frame after the hero stood at a landmark. That is a
// render-order accident, not a style, and it is invisible to a single-frame baseline —
// this test pins the plates against ANY inherited baseline and against the text drifting
// off-centre inside the plate it was drawn on.
test('map name plates centre their text regardless of the inherited canvas baseline', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.game && window.game.scenario);
  const probe = await page.evaluate(() => {
    window.game.scenario('world');
    window.game.step(0.2);
    const g = window.__g, site = { x: 700, y: 1150 };  // Ashford
    g.scene.hero.x = site.x; g.scene.hero.y = site.y;
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    // The plate lives just under the settlement anchor; the village art is scaled 1.28.
    const x0 = Math.round(canvas.width / 2 - 100), w = 200;
    const y0 = Math.round(canvas.height / 2 + 38), h = 42;
    const near = (d, i, c) => Math.abs(d[i] - c[0]) < 26 && Math.abs(d[i + 1] - c[1]) < 26 &&
      Math.abs(d[i + 2] - c[2]) < 26;
    const rows = [];
    for (const baseline of ['alphabetic', 'middle', 'top', 'bottom', 'hanging']) {
      g.camera.x = site.x; g.camera.y = site.y;  // step(0) runs no update, so this holds
      ctx.textBaseline = baseline;
      window.game.step(0);
      const d = ctx.getImageData(x0, y0, w, h).data;
      const ink = [], cream = [];
      for (let y = 0; y < h; y++) {
        let i = 0, c = 0;
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4;
          if (near(d, p, [30, 42, 74])) i++;
          if (near(d, p, [242, 227, 193])) c++;
        }
        if (i > 60) ink.push(y);
        if (c > 4) cream.push(y);
      }
      rows.push({ baseline, plate: [ink[0], ink[ink.length - 1]], text: [cream[0], cream[cream.length - 1]] });
    }
    return rows;
  });

  const first = probe[0];
  expect(first.plate[0], 'the name plate must be inside the probed crop').toBeGreaterThan(0);
  expect(first.text[0], 'the name must render inside the plate').toBeGreaterThan(first.plate[0]);
  for (const frame of probe) {
    expect(frame, `baseline '${frame.baseline}' changed the plate`).toEqual({ ...first, baseline: frame.baseline });
  }
  // and the name sits centred on its plate rather than riding either edge
  const above = first.text[0] - first.plate[0];
  const below = first.plate[1] - first.text[1];
  expect(Math.abs(above - below), `name off-centre in its plate (${above} above, ${below} below)`)
    .toBeLessThanOrEqual(3);
});
