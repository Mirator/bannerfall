// Scratch measurement harness for plans/028. NOT a test and NOT part of any gate.
//
// The "before" half of the headline. `scripts/zz-tier-calibrate.mjs` measures what an idle
// hero wins against a party the SHIPPED generator drew at a given tier. This measures the
// same thing for the PRE-028 generator, so the two are comparable.
//
// The old generator is reconstructed here rather than checked out, because the harness
// around it (the battle driver, the rosters, the seeds) has to be identical for the
// comparison to mean anything. It is a faithful copy of what `origin/enemy-command-symmetry`
// shipped and nothing else: headcount strength (brute 5, hero 3, knight 2, everything else
// 1), the [2, 24] integer clamp, the always-overshoot roller, and Plan 020's tier bands.
//
// Usage: node scripts/zz-tier-before.mjs [--seeds 24]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const SEEDS = Number(args.includes('--seeds') ? args[args.indexOf('--seeds') + 1] : 24);
const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const ROSTERS = {
  fresh: ['spear', 'spear', 'spear', 'spear'],
  mid: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight'],
  late: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'],
};
// Plan 020's bands, on Plan 020's headcount scale.
const OLD_TIERS = { weak: [0.45, 0.7], even: [0.8, 1.2], strong: [1.5, 2.2] };
const BANDS = [0.45, 0.55, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 1.85, 2.2];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(BASE + '/');

const rows = await page.evaluate(async ({ rosters, bands, seeds, dt }) => {
  const { BALANCE, enemyStrength, playerStrength } = await import('/src/data.js');
  const game = window.__g;
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // --- the pre-028 generator, verbatim ---
  const oldPlayerStrength = (troops) => 3 + troops.reduce((s, t) => s + (t.type === 'knight' ? 2 : 1), 0);
  const oldRoll = (target, R, w, bruteCap = Infinity) => {
    const comp = []; let str = 0, brutes = 0;
    while (str < target) {
      const r = R();
      if (brutes < bruteCap && target - str >= 5 && r < w.brute) { comp.push('brute'); brutes++; str += 5; }
      else if (r < w.bandit) { comp.push('bandit'); str += 1; }
      else if (r < w.raider) { comp.push('raider'); str += 1; }
      else { comp.push('wolf'); str += 1; }
    }
    return comp;
  };
  const out = [];
  for (const [name, types] of Object.entries(rosters)) {
    const troops = types.map(type => ({ type }));
    const oldMine = oldPlayerStrength(troops);
    const newMine = playerStrength(troops);
    for (const band of bands) {
      let wins = 0, resolved = 0, lost = 0, secs = 0, ratioSum = 0, bodies = 0;
      for (let s = 1; s <= seeds; s++) {
        window.game.scenario('world', { seed: s * 37 });
        const world = game.scene;
        const comp = oldRoll(clamp(Math.round(oldMine * band), 2, 24), world.simRng, BALANCE.compRolls.party);
        // What that party is really worth, measured on the Plan 028 scale.
        ratioSum += enemyStrength(comp) / newMine;
        bodies += comp.length;
        const real = game.update.bind(game);
        game.update = () => {};
        try {
          game.startBattle({
            troops: types.map(type => ({ type })), enemies: comp.map(type => ({ type })),
            seed: s * 101 + Math.round(band * 100),
            title: 'PRE-028 TIER', arena: 'road', biome: 'rose',
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
        roster: name, oldMine, band,
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

await browser.close();
console.table(rows.map(r => ({ roster: r.roster, band: r.band, realPowerRatio: r.realRatio, bodies: r.avgBodies, idleWin: r.winPct, lost: r.avgLost, sec: r.avgSeconds })));
for (const [tier, [lo, hi]] of Object.entries(OLD_TIERS)) {
  const sel = rows.filter(r => r.band >= lo - 1e-9 && r.band <= hi + 1e-9);
  const n = sel.reduce((s, r) => s + r.runs, 0);
  const w = sel.reduce((s, r) => s + r.runs * r.winPct / 100, 0);
  const rr = sel.reduce((s, r) => s + r.runs * r.realRatio, 0) / n;
  console.log(`${tier.padEnd(7)} bands ${[...new Set(sel.map(r => r.band))].join(',')}  pooled idle win ${(100 * w / n).toFixed(1)}%  over ${n} runs  (mean real power ratio ${rr.toFixed(2)})`);
}
writeFileSync('scripts/zz-tier-before.json', JSON.stringify({ seeds: SEEDS, rows }, null, 2));
console.log('wrote scripts/zz-tier-before.json');
