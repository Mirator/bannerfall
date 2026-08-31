// Scratch measurement harness for plans/035, camp half. NOT a test, NOT part of a gate.
//
// Plan 035 step 2 requires checking that the CAMP tier curve (WORLD.camps[].tier, a knob
// this slice does not touch) still spans winnable-to-punishing after the roaming-party
// bands move. This measures exactly that: every camp including the stronghold, sized by
// its own `tier` through the shipped rollGarrison, reached through the production raid
// entry (KeyE site menu -> raid row -> brief -> deployment confirm), with each edge
// asserted so a flow change fails loudly instead of measuring a paused scene.
//
// Both scoring conventions are reported for the same reason the ratio probe reports both:
// `closed` counts only battles that reached a terminal state, `all` scores an unresolved
// 95s window as a loss the way the shipped sweep's winPct does.
//
// Usage: node scripts/zz-camp035-curve.mjs [--seeds 40] [--rosters fresh,mid,late]
//                                          [--policies idle,chargeAll] [--workers 6]
//                                          [--label camp035]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SEEDS = Number(argOf('--seeds', 40));
const WORKERS = Number(argOf('--workers', 6));
const LABEL = argOf('--label', 'camp035');
const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

const ROSTERS = {
  fresh: ['spear', 'spear', 'spear', 'spear'],
  mid: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'knight'],
  late: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'],
};
const ROSTER_NAMES = String(argOf('--rosters', 'fresh,late')).split(',');
const ALL_POLICIES = {
  idle: null,
  chargeAll: { spear: 'charge', archer: 'charge', knight: 'charge' },
  holdLine: { spear: 'hold', archer: 'hold', knight: 'hold' },
};
const POLICY_NAMES = String(argOf('--policies', 'idle,chargeAll')).split(',');
const CAMPS = ['c1', 'c2', 'c3', 'strong'];

const JOBS = [];
for (const rosterName of ROSTER_NAMES) {
  for (const campId of CAMPS) {
    for (const policy of POLICY_NAMES) {
      for (let s = 1; s <= SEEDS; s++) JOBS.push({ rosterName, campId, policy, seed: s });
    }
  }
}

const runBattle = async ({ job, rosters, policies, dt }) => {
  const { WORLD, enemyStrength } = await import('/src/data.js');
  const game = window.__g;
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;
  const orders = policies[job.policy];
  const real = game.update.bind(game);
  game.update = () => {};
  try {
    const camp = WORLD.camps.find(c => c.id === job.campId);
    window.game.scenario('world', { seed: job.seed });
    const world = game.scene;
    world.save.troops = rosters[job.rosterName].map(type => ({ type }));
    world.save.gold = 500;
    world.hero.x = camp.x; world.hero.y = camp.y; world.grace = 0;
    const mine = world.myStrength();
    game.input.injectMouse(640, 360, false);
    game.input.injectKey('KeyE', true); real(dt); game.input.injectKey('KeyE', false);
    if (!(game.sceneName === 'world' && world.screen && world.screen.kind === 'site')) {
      throw new Error('KeyE did not open the site menu at ' + job.campId + ': screen=' +
        ((world.screen || {}).kind || 'none'));
    }
    game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
    if (!(game.sceneName === 'world' && world.screen && world.screen.kind === 'brief')) {
      throw new Error('the raid row did not open the brief at ' + job.campId + ': screen=' +
        ((world.screen || {}).kind || 'none'));
    }
    game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
    if (game.sceneName !== 'battle') {
      throw new Error('the brief confirm did not reach a battle: scene=' + game.sceneName);
    }
    const b = game.scene;
    // Read the garrison off the SCENE rather than off the roll: a stronghold's modifiers
    // thin it at confirm time, so the roll is not what is fought. NOTE the limit of this:
    // `b.enemies` is the STARTING force, so a stronghold's reserve waves (which arrive at
    // STRONGHOLD_WAVE_AT) are not in the reported `bodies` or `ratio`. The win rate is
    // measured on the whole fight either way; only the ratio column understates a
    // stronghold that has waves.
    const comp = b.enemies.map(e => e.type);
    const waves = b.pendingWaves ? b.pendingWaves.length : 0;
    game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
    let t = 0;
    while (b.state === 'intro' && t < 3) { real(dt); t += dt; }
    let armT = 0;
    while (b.state === 'deploy' && armT < 0.5) { real(dt); t += dt; armT += dt; }
    if (b.state === 'deploy') {
      game.input.injectKey('Enter', true); real(dt); t += dt; game.input.injectKey('Enter', false);
    }
    if (b.state !== 'fight') throw new Error('the deploy confirm did not start the fight: state=' + b.state);
    if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
    while (b.state !== 'end' && t < 95) { real(dt); t += dt; }
    return {
      rosterName: job.rosterName, campId: job.campId, policy: job.policy, seed: job.seed,
      tier: camp.tier, bodies: comp.length, waves,
      mine: Math.round(1000 * mine) / 1000,
      ratio: Math.round(1000 * enemyStrength(comp) / mine) / 1000,
      resolved: b.state === 'end', victory: !!b.victory,
      seconds: Math.round(t * 10) / 10,
      lost: b.startTroops - b.troops.length,
      heroHp: Math.max(0, Math.round(b.hero.hp)),
    };
  } finally { game.update = real; }
};

const browser = await chromium.launch();
const slices = Array.from({ length: WORKERS }, () => []);
JOBS.forEach((job, i) => slices[i % WORKERS].push(job));
let done = 0;
const rows = (await Promise.all(slices.map(async (slice) => {
  if (!slice.length) return [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  await page.goto(BASE + '/');
  const out = [];
  for (const job of slice) {
    out.push(await page.evaluate(runBattle, {
      job, rosters: ROSTERS, policies: Object.fromEntries(POLICY_NAMES.map(k => [k, ALL_POLICIES[k]])), dt: DT,
    }));
    if (++done % 100 === 0) process.stderr.write('  ' + done + '/' + JOBS.length + '\n');
  }
  await page.close();
  return out;
}))).flat();
await browser.close();

writeFileSync('scripts/zz-' + LABEL + '.json',
  JSON.stringify({ label: LABEL, seeds: SEEDS, rosters: ROSTER_NAMES, policies: POLICY_NAMES, rows }, null, 2));
console.log(rows.length + ' battles, wrote scripts/zz-' + LABEL + '.json');

const g = {};
for (const r of rows) (g[[r.rosterName, r.campId, r.policy].join('|')] ||= []).push(r);
const seOf = (p, den) => (den ? 100 * Math.sqrt((p / 100) * (1 - p / 100) / den) : NaN);
const fmt = (num, den) => (den
  ? (100 * num / den).toFixed(1).padStart(5) + '+/-' + seOf(100 * num / den, den).toFixed(1).padEnd(4)
  : '     -    ');
console.log('\nroster camp   tier  policy      bodies  ratio  win%(closed)  win%(all)   stall  waves');
for (const rosterName of ROSTER_NAMES) {
  for (const campId of CAMPS) {
    for (const policy of POLICY_NAMES) {
      const a = g[[rosterName, campId, policy].join('|')] || [];
      if (!a.length) continue;
      const c = a.filter(r => r.resolved);
      console.log(rosterName.padEnd(7) + campId.padEnd(7) +
        a[0].tier.toFixed(1).padEnd(6) + policy.padEnd(12) +
        (a.reduce((x, r) => x + r.bodies, 0) / a.length).toFixed(1).padStart(5) + '  ' +
        (a.reduce((x, r) => x + r.ratio, 0) / a.length).toFixed(3) + '  ' +
        fmt(c.filter(r => r.victory).length, c.length) + '  ' +
        fmt(a.filter(r => r.victory).length, a.length) +
        String(a.length - c.length).padStart(6) +
        String(a.reduce((x, r) => x + r.waves, 0)).padStart(7));
    }
  }
}
