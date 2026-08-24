import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] || 'shots/map-cohesion/final');
const url = process.env.BANNERFALL_URL || 'http://127.0.0.1:8474';
await mkdir(outDir, { recursive: true });

const frames = [
  { name: 'ashford-frozen-1280x720', center: [700, 1150], size: [1280, 720], frozen: true },
  { name: 'coldwell-bridge-frozen-1280x720', center: [1080, 590], size: [1280, 720], frozen: true },
  { name: 'brindle-frozen-1280x720', center: [1500, 1750], size: [1280, 720], frozen: true },
  { name: 'highmere-frozen-1280x720', center: [2050, 1150], size: [1280, 720], frozen: true },
  { name: 'wolfsjaw-frozen-1280x720', center: [2800, 600], size: [1280, 720], frozen: true },
  { name: 'brindle-occupied-1280x720', center: [1500, 1750], size: [1280, 720], frozen: true, occupied: ['brindle'] },
  { name: 'ashford-active-raid-1280x720', center: [1050, 1250], size: [1280, 720], moving: true, raid: true },
  { name: 'ashford-moving-960x540', center: [700, 1150], size: [960, 540], moving: true },
  { name: 'coldwell-bridge-moving-960x540', center: [1080, 590], size: [960, 540], moving: true },
  { name: 'highmere-moving-1600x900', center: [2050, 1150], size: [1600, 900], moving: true },
  { name: 'wolfsjaw-moving-1600x900', center: [2800, 600], size: [1600, 900], moving: true },
];

const browser = await chromium.launch({ headless: true });
const errors = [];
for (const frame of frames) {
  const page = await browser.newPage({ viewport: { width: frame.size[0], height: frame.size[1] } });
  page.on('pageerror', error => errors.push(`${frame.name}: ${error.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`${frame.name}: ${msg.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => window.__g && window.game);
  await page.evaluate(options => {
    localStorage.clear();
    window.game.scenario('world_region', {
      seed: 20260817, occupied: options.occupied || [], owned: [], razed: [],
    });
    const game = window.__g, world = game.scene;
    world.hero.x = options.center[0]; world.hero.y = options.center[1];
    game.camera.x = options.center[0]; game.camera.y = options.center[1];
    if (options.raid) {
      world.parties.push({
        x: 1180, y: 1190, comp: ['wolf', 'wolf', 'raider', 'raider'], bob: 0,
        facing: 0, mood: 'raid', raid: 'ashford', raidKind: 'regional',
      });
    }
    if (options.moving) window.game.keepAwake(true);
    window.game.step(options.frozen ? 0.5 : 0.25);
    window.game.keepAwake(false);
    game.camera.x = options.center[0]; game.camera.y = options.center[1];
    game.update = () => {}; game.paused = false; game.draw();
  }, frame);
  await page.locator('#game').screenshot({ path: path.join(outDir, `${frame.name}.png`) });
  await page.close();
}
await browser.close();

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`captured ${frames.length} frames in ${outDir} with no page or console errors`);
}
