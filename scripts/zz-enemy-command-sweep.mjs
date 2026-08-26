// Scratch measurement harness for plans/027 (enemy command symmetry).
//
// NOT a test and NOT part of any gate: it is a standalone Playwright driver that reproduces
// tests/e2e/stance-balance.spec.js's harness conventions (frozen scheduler, real fixed-step
// update, pinned canvas + cursor, cleared camera shake) over a wider seed sweep, and adds the
// two numbers that spec does not record: mean fight duration and per-seed resolution.
//
// Usage:  node scripts/zz-enemy-command-sweep.mjs [--label before] [--quick]
// Requires `python scripts/serve.py` to already be listening on 127.0.0.1:8474.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const label = (args.includes('--label') ? args[args.indexOf('--label') + 1] : 'run');
const quick = args.includes('--quick');
const idleOnly = args.includes('--idleonly');

const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const rep = (type, n) => Array.from({ length: n }, () => ({ type }));

// The phase-4 audit's standard roaming fight: 8 troops vs a 7-strength party.
const ROAM = {
  troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
  enemies: [...rep('bandit', 3), ...rep('raider', 2), ...rep('wolf', 2)],
};

const POLICIES = {
  idle: null,
  chargeAll: { spear: 'charge', archer: 'charge', knight: 'charge' },
  split: { spear: 'charge', archer: 'hold', knight: 'charge' },
  holdLine: { spear: 'hold', archer: 'hold', knight: 'charge' },
};

const ROAM_SEEDS = Array.from({ length: quick ? 8 : 24 }, (_, i) => i + 1);
const RAID_SEEDS = Array.from({ length: quick ? 6 : 40 }, (_, i) => i + 1);
const CAMPS = ['c1', 'c2', 'c3'];

async function roamSweep(page, orders, seeds) {
  return page.evaluate(({ fixture, orders, seeds, dt }) => {
    const game = window.__g;
    const canvas = document.getElementById('game');
    canvas.width = 1280; canvas.height = 720;
    game.camera.w = 1280; game.camera.h = 720;
    const real = game.update.bind(game);
    game.update = () => {};
    const rows = [];
    try {
      for (const seed of seeds) {
        game.startBattle({
          troops: fixture.troops, enemies: fixture.enemies, seed,
          title: 'ENEMY COMMAND SWEEP', arena: 'road', biome: 'rose',
          deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
        });
        const b = game.scene;
        b.state = 'fight'; b.deployT = 0;
        game.input.injectMouse(640, 360, false);
        game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
        if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
        let t = 0;
        while (b.state !== 'end' && t < 90) { real(dt); t += dt; }
        rows.push({
          seed, resolved: b.state === 'end', victory: !!b.victory,
          seconds: Math.round(t * 10) / 10,
          lost: b.startTroops - b.troops.length,
          heroHp: Math.max(0, Math.round(b.hero.hp)),
        });
      }
    } finally { game.update = real; }
    return rows;
  }, { fixture: ROAM, orders, seeds, dt: DT });
}

async function raidSweep(page, orders, seeds, campIds) {
  return page.evaluate(async ({ orders, seeds, campIds, dt }) => {
    const { WORLD } = await import('/src/data.js');
    const game = window.__g;
    const canvas = document.getElementById('game');
    canvas.width = 1280; canvas.height = 720;
    game.camera.w = 1280; game.camera.h = 720;
    const mix = ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'];
    const rows = [];
    const real = game.update.bind(game);
    game.update = () => {};
    try {
      for (const seed of seeds) {
        for (const campId of campIds) {
          const camp = WORLD.camps.find(c => c.id === campId);
          window.game.scenario('world', { seed });
          const world = game.scene;
          world.save.troops = mix.map(type => ({ type }));
          world.save.gold = 500;
          world.hero.x = camp.x; world.hero.y = camp.y; world.grace = 0;
          game.input.injectMouse(640, 360, false);
          game.input.injectKey('KeyE', true); real(dt); game.input.injectKey('KeyE', false);
          if (game.sceneName === 'world' && world.screen && world.screen.kind === 'brief') {
            game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
          }
          if (game.sceneName !== 'battle') continue;
          const b = game.scene;
          game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
          let t = 0;
          while (b.state === 'intro' && t < 3) { real(dt); t += dt; }
          const t0 = t;
          if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
          while (b.state !== 'end' && t < 95) { real(dt); t += dt; }
          rows.push({
            seed, campId, resolved: b.state === 'end', victory: !!b.victory,
            seconds: Math.round((t - t0) * 10) / 10,
            lost: b.startTroops - b.troops.length,
            heroHp: Math.max(0, Math.round(b.hero.hp)),
            enemies: b.totalEnemies,
          });
        }
      }
    } finally { game.update = real; }
    return rows;
  }, { orders, seeds, campIds, dt: DT });
}

function summarize(rows) {
  const n = rows.length;
  if (!n) return { runs: 0 };
  const wins = rows.filter(r => r.victory).length;
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  return {
    runs: n,
    winPct: Math.round(1000 * wins / n) / 10,
    avgLost: Math.round(100 * sum(r => r.lost) / n) / 100,
    avgSeconds: Math.round(10 * sum(r => r.seconds) / n) / 10,
    avgHeroHp: Math.round(sum(r => r.heroHp) / n),
    unresolved: rows.filter(r => !r.resolved).length,
  };
}

const out = { label, generated: new Date().toISOString(), roam: {}, raid: {}, raw: { roam: {}, raid: {} } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));

for (const [name, orders] of Object.entries(POLICIES)) {
  if (idleOnly && name !== 'idle') continue;
  await page.goto(BASE + '/');
  const t0 = Date.now();
  const rows = await roamSweep(page, orders, ROAM_SEEDS);
  out.raw.roam[name] = rows;
  out.roam[name] = summarize(rows);
  console.log(`roam/${name}`, JSON.stringify(out.roam[name]), `(${Math.round((Date.now() - t0) / 1000)}s)`);
}

for (const [name, orders] of Object.entries(POLICIES)) {
  if (idleOnly && name !== 'idle') continue;
  await page.goto(BASE + '/');
  const t0 = Date.now();
  const rows = await raidSweep(page, orders, RAID_SEEDS, CAMPS);
  out.raw.raid[name] = rows;
  out.raid[name] = summarize(rows);
  console.log(`raid/${name}`, JSON.stringify(out.raid[name]), `(${Math.round((Date.now() - t0) / 1000)}s)`);
}

await browser.close();
const file = `scripts/zz-sweep-${label}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('wrote', file);
