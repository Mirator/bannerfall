// Scratch measurement harness for plans/028, second pass. NOT a test, NOT part of a gate.
//
// The first grid (zz-power-probe.mjs) swept hand-built enemy ladders, most of them a
// single type deep. That is the right data for separating one body's worth from another's,
// but it is NOT the distribution the encounter generator draws from: every real party and
// garrison comes out of `rollComposition` on the BALANCE.compRolls weights, which is mixed
// by construction. Measured, the metric fitted on the hand-built grid crosses 50% at about
// 1.12 on rolled compositions rather than at 1.00.
//
// This pass fixes that by measuring the real thing: for each roster and each target weight,
// roll a comp through the shipped generator, fight it with the hero idle, and record the
// exact composition alongside the outcome so the fit sees compositions rather than labels.
//
// Usage: node scripts/zz-power-probe2.mjs [--seeds 8] [--label rolled]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SEEDS = Number(argOf('--seeds', 8));
const label = argOf('--label', 'rolled');
const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const ROSTERS = {
  fresh: ['spear', 'spear', 'spear', 'spear'],
  spears: ['spear', 'spear', 'spear', 'spear', 'spear', 'spear'],
  bows: ['spear', 'spear', 'archer', 'archer', 'archer', 'archer'],
  mid: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight'],
  horse: ['spear', 'spear', 'knight', 'knight', 'knight'],
  late: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'],
};
const BANDS = [0.6, 0.75, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5];
const TABLES = ['party', 'garrison'];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(BASE + '/');

const rows = await page.evaluate(async ({ rosters, bands, tables, seeds, dt }) => {
  const { BALANCE, playerStrength, enemyStrength, rollComposition } = await import('/src/data.js');
  const game = window.__g;
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const out = [];
  for (const [name, types] of Object.entries(rosters)) {
    const troops = types.map(type => ({ type }));
    const mine = playerStrength(troops);
    for (const table of tables) {
      for (const band of bands) {
        for (let s = 1; s <= seeds; s++) {
          // A fresh world per run only to get a seeded simRng for the roll.
          window.game.scenario('world', { seed: s * 61 + Math.round(band * 100) });
          const world = game.scene;
          const cl = BALANCE.encounterWeightClamp;
          const comp = rollComposition(clamp(mine * band, cl.min, cl.max),
            world.simRng, BALANCE.compRolls[table]);
          const real = game.update.bind(game);
          game.update = () => {};
          let victory = false, resolved = false, secs = 0, lost = 0;
          try {
            game.startBattle({
              troops: types.map(type => ({ type })),
              enemies: comp.map(type => ({ type })),
              seed: s * 977 + Math.round(band * 100),
              title: 'ROLLED PROBE', arena: 'road', biome: 'rose',
              deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
            });
            const b = game.scene;
            b.state = 'fight'; b.deployT = 0;
            game.input.injectMouse(640, 360, false);
            game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
            let t = 0;
            while (b.state !== 'end' && t < 90) { real(dt); t += dt; }
            resolved = b.state === 'end';
            victory = !!b.victory;
            secs = Math.round(t * 10) / 10;
            lost = b.startTroops - b.troops.length;
          } finally { game.update = real; }
          const counts = comp.reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {});
          out.push({
            roster: name, table, band, seed: s,
            enemy: counts, bodies: comp.length,
            shippedRatio: Math.round(1000 * enemyStrength(comp) / mine) / 1000,
            victory, resolved, seconds: secs, lost,
          });
        }
      }
    }
  }
  return out;
}, { rosters: ROSTERS, bands: BANDS, tables: TABLES, seeds: SEEDS, dt: DT });

await browser.close();
writeFileSync(`scripts/zz-power-${label}.json`, JSON.stringify({ label, seeds: SEEDS, rosters: ROSTERS, rows }, null, 2));
console.log(`${rows.length} battles, wrote scripts/zz-power-${label}.json`);
// quick view: win rate by shipped-ratio bucket
const buckets = {};
for (const r of rows) {
  const k = (Math.floor(r.shippedRatio * 10) / 10).toFixed(1);
  (buckets[k] ||= []).push(r.victory ? 1 : 0);
}
for (const k of Object.keys(buckets).sort()) {
  const v = buckets[k];
  console.log(`ratio ${k}  n=${String(v.length).padStart(3)}  idle win ${(100 * v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}%`);
}
