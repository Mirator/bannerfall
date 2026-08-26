// Scratch measurement harness for plans/028. NOT a test and NOT part of any gate.
//
// One question only, at a sample size big enough to answer it: over organic camp raids,
// does the best DELIBERATE order policy beat pressing nothing? That is the assertion the
// `@sweep` `test.fail` annotation in tests/e2e/stance-balance.spec.js records as unmet.
// Plan 019 was retracted for calling it on 15 raids; Plan 027 declined to flip it on a
// 0.0-point margin over 120. This runs the same fixture over three times as many seeds and
// reports the margin with a binomial standard error, so the call can be made on evidence.
//
// Usage: node scripts/zz-orders-wide.mjs [--seeds 120] [--label wide]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const N = Number(argOf('--seeds', 120));
const label = argOf('--label', 'wide');
const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const POLICIES = {
  idle: null,
  chargeAll: { spear: 'charge', archer: 'charge', knight: 'charge' },
  split: { spear: 'charge', archer: 'hold', knight: 'charge' },
  holdLine: { spear: 'hold', archer: 'hold', knight: 'charge' },
};

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
          });
        }
      }
    } finally { game.update = real; }
    return rows;
  }, { orders, seeds, campIds, dt: DT });
}

const seeds = Array.from({ length: N }, (_, i) => i + 1);
const camps = ['c1', 'c2', 'c3'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));

const out = { label, seeds: N, raids: N * camps.length, generated: new Date().toISOString(), policies: {}, raw: {} };
for (const [name, orders] of Object.entries(POLICIES)) {
  await page.goto(BASE + '/');
  const t0 = Date.now();
  const rows = await raidSweep(page, orders, seeds, camps);
  const wins = rows.filter(r => r.victory).length;
  const p = wins / rows.length;
  out.raw[name] = rows;
  out.policies[name] = {
    runs: rows.length,
    winPct: Math.round(1000 * p) / 10,
    sePct: Math.round(1000 * Math.sqrt(p * (1 - p) / rows.length)) / 10,
    avgLost: Math.round(100 * rows.reduce((s, r) => s + r.lost, 0) / rows.length) / 100,
    avgSeconds: Math.round(10 * rows.reduce((s, r) => s + r.seconds, 0) / rows.length) / 10,
    avgHeroHp: Math.round(rows.reduce((s, r) => s + r.heroHp, 0) / rows.length),
    unresolved: rows.filter(r => !r.resolved).length,
  };
  console.log(name.padEnd(10), JSON.stringify(out.policies[name]), `(${Math.round((Date.now() - t0) / 1000)}s)`);
}
await browser.close();

// paired comparison: same seed+camp, did the policy win where idle lost and vice versa?
const key = r => `${r.seed}|${r.campId}`;
const idleMap = new Map(out.raw.idle.map(r => [key(r), r.victory]));
out.paired = {};
for (const name of Object.keys(POLICIES)) {
  if (name === 'idle') continue;
  let wonOnly = 0, lostOnly = 0, both = 0, neither = 0;
  for (const r of out.raw[name]) {
    const i = idleMap.get(key(r));
    if (r.victory && !i) wonOnly++;
    else if (!r.victory && i) lostOnly++;
    else if (r.victory) both++; else neither++;
  }
  const n = wonOnly + lostOnly;
  out.paired[name] = {
    policyWonIdleLost: wonOnly, idleWonPolicyLost: lostOnly, bothWon: both, bothLost: neither,
    discordant: n,
    // McNemar exact-ish: SE of the difference over discordant pairs
    marginPct: Math.round(1000 * (wonOnly - lostOnly) / out.raw[name].length) / 10,
    seOfMarginPct: n ? Math.round(1000 * Math.sqrt(n) / out.raw[name].length) / 10 : 0,
  };
  console.log('paired', name.padEnd(10), JSON.stringify(out.paired[name]));
}
writeFileSync(`scripts/zz-orders-${label}.json`, JSON.stringify(out, null, 2));
console.log('wrote', `scripts/zz-orders-${label}.json`);
