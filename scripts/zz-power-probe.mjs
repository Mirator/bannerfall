// Scratch measurement harness for plans/028 (encounter power rebase).
//
// NOT a test and NOT part of any gate. It runs a grid of seeded small-force matchups
// headlessly and records who actually wins, so a candidate combat-power metric can be
// FITTED against measured outcomes rather than asserted from arithmetic. The hero is
// present and completely idle in every run (he never swings), matching the `idle` policy
// the Plan 027 sweep measures — the encounter generator's job is to make THAT player lose
// sometimes.
//
// Usage:  node scripts/zz-power-probe.mjs [--label grid] [--seeds 6] [--quick]
// Requires `python scripts/serve.py` on 127.0.0.1:8474.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const label = argOf('--label', 'grid');
const quick = args.includes('--quick');
const SEEDS = Number(argOf('--seeds', quick ? 3 : 6));

const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const rep = (type, n) => Array.from({ length: n }, () => ({ type }));
const comp = (spec) => Object.entries(spec).flatMap(([type, n]) => rep(type, n));

// Player rosters. Every one carries the idle hero implicitly (Battle always builds one).
const ROSTERS = {
  s6: { spear: 6 },
  s8: { spear: 8 },
  a6: { archer: 6 },
  k4: { knight: 4 },
  s4a3: { spear: 4, archer: 3 },
  roam: { spear: 4, archer: 3, knight: 1 },   // the Plan 027 Fixture A player side
  raid: { spear: 4, archer: 3, knight: 2 },   // the camp-raid harness mix
  s3a2: { spear: 3, archer: 2 },
};

// Enemy sides, chosen to bracket the 50% crossing for each roster and to isolate one
// enemy type at a time (so the fit can separate range, speed and AoE from raw dps x hp).
function enemyLadders() {
  const out = [];
  const push = (spec) => out.push(spec);
  for (const n of [4, 6, 8, 10, 12, 14, 16, 20]) push({ bandit: n });
  for (const n of [4, 6, 8, 10, 12, 14, 18]) push({ wolf: n });
  for (const n of [3, 5, 7, 9, 11, 14]) push({ raider: n });
  for (const n of [1, 2, 3, 4, 5, 6]) push({ brute: n });
  // mixes on the real roll shapes
  for (const n of [2, 3, 4, 5]) push({ bandit: n * 2, raider: n, wolf: n });
  for (const n of [1, 2, 3]) push({ brute: n, bandit: n * 2, raider: n });
  for (const n of [2, 4, 6]) push({ bandit: n, wolf: n });
  return out;
}

async function runMatchups(page, jobs) {
  return page.evaluate(async ({ jobs, dt, seeds }) => {
    const game = window.__g;
    const canvas = document.getElementById('game');
    canvas.width = 1280; canvas.height = 720;
    game.camera.w = 1280; game.camera.h = 720;
    const real = game.update.bind(game);
    game.update = () => {};
    const rows = [];
    try {
      for (const job of jobs) {
        let wins = 0, resolved = 0, secs = 0, lost = 0, enemiesLeft = 0;
        for (let s = 1; s <= seeds; s++) {
          game.startBattle({
            troops: job.troops, enemies: job.enemies, seed: s * 101 + job.idx,
            title: 'POWER PROBE', arena: 'road', biome: 'rose',
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
          secs += t;
          lost += b.startTroops - b.troops.length;
          enemiesLeft += b.enemies.length;
        }
        rows.push({
          idx: job.idx, roster: job.roster, enemy: job.enemyLabel,
          runs: seeds, wins, winPct: Math.round(1000 * wins / seeds) / 10,
          resolved, avgSeconds: Math.round(10 * secs / seeds) / 10,
          avgLost: Math.round(100 * lost / seeds) / 100,
          avgEnemiesLeft: Math.round(100 * enemiesLeft / seeds) / 100,
        });
      }
    } finally { game.update = real; }
    return rows;
  }, { jobs, dt: DT, seeds: SEEDS });
}

const jobs = [];
let idx = 0;
for (const [roster, spec] of Object.entries(ROSTERS)) {
  for (const espec of enemyLadders()) {
    jobs.push({
      idx: idx++, roster, enemyLabel: JSON.stringify(espec),
      troops: comp(spec), enemies: comp(espec),
    });
  }
}
const LIMIT = Number(argOf('--limit', 0));
if (LIMIT > 0) jobs.length = Math.min(jobs.length, LIMIT);
console.log(`${jobs.length} matchups x ${SEEDS} seeds = ${jobs.length * SEEDS} battles`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(BASE + '/');

const rows = [];
const CHUNK = 12;
const t0 = Date.now();
for (let i = 0; i < jobs.length; i += CHUNK) {
  const slice = jobs.slice(i, i + CHUNK);
  rows.push(...await runMatchups(page, slice));
  console.log(`${Math.min(i + CHUNK, jobs.length)}/${jobs.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
}
await browser.close();

const file = `scripts/zz-power-${label}.json`;
writeFileSync(file, JSON.stringify({ label, seeds: SEEDS, rosters: ROSTERS, rows }, null, 2));
console.log('wrote', file);
