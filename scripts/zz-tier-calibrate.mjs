// Scratch measurement harness for plans/028. NOT a test and NOT part of any gate.
//
// Two questions the plan has to answer with numbers rather than arithmetic:
//
//   1. CALIBRATION — at what power band does an IDLE hero win about half his fights?
//      For each band it rolls a real party through World.rollComp() (the shipped
//      generator, on the shipped composition weights) against a real warband, then fights
//      it out headlessly with the hero never swinging.
//   2. FRESH-CAMPAIGN DISTRIBUTION — what tiers does a brand new campaign actually see,
//      and is the weak band still a foothold?
//
// Usage: node scripts/zz-tier-calibrate.mjs [--seeds 12] [--label cal]
// Requires `python scripts/serve.py` on 127.0.0.1:8474.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SEEDS = Number(argOf('--seeds', 12));
const label = argOf('--label', 'cal');
const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const ROSTERS = {
  fresh: ['spear', 'spear', 'spear', 'spear'],
  mid: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight'],
  late: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'],
};
const BANDS = [0.55, 0.70, 0.80, 0.90, 1.00, 1.10, 1.15, 1.30, 1.50, 1.70];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(BASE + '/');

const calibration = await page.evaluate(async ({ rosters, bands, seeds, dt }) => {
  const { BALANCE, enemyStrength, playerStrength } = await import('/src/data.js');
  const game = window.__g;
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const out = [];
  for (const [name, types] of Object.entries(rosters)) {
    const troops = types.map(type => ({ type }));
    const mine = playerStrength(troops);
    for (const band of bands) {
      let wins = 0, resolved = 0, lost = 0, secs = 0, ratioSum = 0, bodies = 0;
      for (let s = 1; s <= seeds; s++) {
        // roll the comp through the SHIPPED generator, on a world so it uses simRng
        window.game.scenario('world', { seed: s * 37 });
        const world = game.scene;
        world.save.troops = troops.map(t => ({ ...t }));
        const cl = BALANCE.encounterWeightClamp;
        const comp = world.rollComp(clamp(mine * band, cl.min, cl.max));
        ratioSum += enemyStrength(comp) / mine;
        bodies += comp.length;
        const real = game.update.bind(game);
        game.update = () => {};
        try {
          game.startBattle({
            troops: troops.map(t => ({ type: t.type })),
            enemies: comp.map(type => ({ type })),
            seed: s * 101 + Math.round(band * 100),
            title: 'TIER CALIBRATION', arena: 'road', biome: 'rose',
            deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
          });
          const b = game.scene;
          b.state = 'fight'; b.deployT = 0;
          game.input.injectMouse(640, 360, false);
          game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
          let t = 0;
          while (b.state !== 'end' && t < 90) { real(dt); t += dt; }
          if (b.state === 'end') resolved++;
          if (b.victory) wins++;
          lost += b.startTroops - b.troops.length;
          secs += t;
        } finally { game.update = real; }
      }
      out.push({
        roster: name, mine: Math.round(mine * 100) / 100, band,
        realRatio: Math.round(100 * ratioSum / seeds) / 100,
        avgBodies: Math.round(10 * bodies / seeds) / 10,
        runs: seeds, winPct: Math.round(1000 * wins / seeds) / 10,
        resolved, avgLost: Math.round(100 * lost / seeds) / 100,
        avgSeconds: Math.round(10 * secs / seeds) / 10,
      });
    }
  }
  return out;
}, { rosters: ROSTERS, bands: BANDS, seeds: SEEDS, dt: DT });

console.table(calibration);

// ---- fresh-campaign tier distribution -------------------------------------------------
await page.goto(BASE + '/');
const fresh = await page.evaluate(async ({ seeds }) => {
  const { BALANCE, enemyStrength, playerStrength } = await import('/src/data.js');
  const game = window.__g;
  const T = BALANCE.partyTiers;
  const weakEven = (T.weak.max + T.even.min) / 2;
  const evenStrong = (T.even.max + T.strong.min) / 2;
  const tierOf = r => (r <= weakEven ? 'weak' : r >= evenStrong ? 'strong' : 'even');
  const rows = [];
  for (let s = 1; s <= seeds; s++) {
    window.game.scenario('world', { seed: s * 37 });
    const w = game.scene;
    const mine = playerStrength(w.save.troops);
    // what a fresh campaign is looking at the moment it starts
    const start = w.parties.map(p => enemyStrength(p.comp) / mine);
    // and what the next twelve spawn-timer draws would put on the map, at the same
    // starting warband (the timer's own camp choice, not a fixed camp)
    const next = [];
    for (let i = 0; i < 12; i++) {
      const alive = w.liveCamps();
      w.spawnParty(alive[(i * 7) % alive.length]);
      next.push(enemyStrength(w.parties[w.parties.length - 1].comp) / mine);
    }
    rows.push({ seed: s * 37, mine: Math.round(mine * 100) / 100, start, next });
  }
  const tally = (list) => list.reduce((a, r) => (a[tierOf(r)]++, a), { weak: 0, even: 0, strong: 0 });
  const allStart = rows.flatMap(r => r.start), allNext = rows.flatMap(r => r.next);
  return {
    seeds,
    onTheMapAtStart: { n: allStart.length, ...tally(allStart), minRatio: +Math.min(...allStart).toFixed(2), maxRatio: +Math.max(...allStart).toFixed(2) },
    nextTwelveSpawns: { n: allNext.length, ...tally(allNext), minRatio: +Math.min(...allNext).toFixed(2), maxRatio: +Math.max(...allNext).toFixed(2) },
    seedsWithNoBeatableStart: rows.filter(r => !r.start.some(x => x <= 1.15)).length,
    rows,
  };
}, { seeds: 20 });

console.log('\nfresh campaign, on the map at start:', JSON.stringify(fresh.onTheMapAtStart));
console.log('fresh campaign, next twelve spawns:  ', JSON.stringify(fresh.nextTwelveSpawns));
console.log('seeds starting with nothing at or under the beatable ratio:', fresh.seedsWithNoBeatableStart, 'of', fresh.seeds);

await browser.close();
writeFileSync(`scripts/zz-tier-${label}.json`, JSON.stringify({ label, seeds: SEEDS, calibration, fresh }, null, 2));
console.log('wrote', `scripts/zz-tier-${label}.json`);
