// Scratch measurement harness for plans/035. NOT a test, NOT part of a gate.
//
// What it measures: the win-rate-vs-ratio curve for a player who COMMANDS, so
// BALANCE.partyTiers can be recalibrated around an active commander instead of an idle
// one. Plan 028's probe (zz-power-probe2.mjs) measured the same curve for an idle hero,
// but it did so by reaching into the scene — `b.state = 'fight'; b.deployT = 0` — which
// pre-dates Plan 033 and therefore skips the deployment phase that now decides what
// "pressing nothing" even means. This probe drives the PRODUCTION entry instead, with
// every edge asserted, so it can never silently measure a paused or empty scene:
//
//   party path : a real party clash -> requestBattle -> brief CONFIRM -> mutual deploy
//                phase -> deploy CONFIRM -> fight. This is the path BALANCE.partyTiers
//                actually governs.
//   camp  path : hero at the camp -> KeyE site menu -> raid row CONFIRM -> brief CONFIRM
//                -> deploy phase -> deploy CONFIRM -> fight. Same sequence raidSweep in
//                tests/e2e/stance-balance.spec.js drives.
//
// The ratio under test is EXACT rather than a band label: the enemy comp is rolled to
// `mine * ratio` through the shipped rollComposition on the shipped comp-roll table, then
// installed on the encounter, and the realised ratio (enemyStrength/playerStrength) is
// recorded per battle so the curve is bucketed by what was actually fought.
//
// Policies: `idle` presses only the deployment confirm nobody can skip; `chargeAll`
// additionally issues charge to all three squads through issueCommand, exactly as the
// sweep's chargeAll column does. The hero never swings in either — the harness cannot
// script hero input, which is why the BANDS are where an active player is priced.
//
// Usage: node scripts/zz-tier035-probe.mjs [--ratios 0.8,1.0,1.2] [--seeds 25]
//                                          [--path party|camp|both] [--workers 6]
//                                          [--label scout] [--rosters fresh,mid,late]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const RATIOS = String(argOf('--ratios', '0.7,0.85,1.0,1.15,1.3,1.45')).split(',').map(Number);
const SEEDS = Number(argOf('--seeds', 25));
const PATH_ARG = argOf('--path', 'both');
const PATHS = PATH_ARG === 'both' ? ['party', 'camp'] : [PATH_ARG];
const WORKERS = Number(argOf('--workers', 6));
const LABEL = argOf('--label', 'tier035');
const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';

// The camp path rotates the three raidable camps, exactly as raidSweep does; the camp's own
// `tier` is bypassed here (the garrison is installed at the ratio under test) so what
// rotates is the ARENA and the terrain sample, not the difficulty.
const CAMPS = ['c1', 'c2', 'c3'];

// The party path rotates six open map positions, because a roaming fight's battlefield is
// SAMPLED from wherever the hero stands (sampleBattlefield in world/battle-transition.js)
// and a curve measured at one spot would be a property of that spot's terrain rather than
// of the pricing. All six were verified to resolve; each is checked with `blockedAt` at run
// time and the clash edge is asserted, so a spot that stops being open fails loudly.
//
// MEASURED, and deliberately excluded: world (1600, 900) — the spot the world_aftermath
// scenario uses — samples a battlefield whose obstacle field contains six r=60 trees at
// x 1090-1170, y 730-940, a solid wall directly across the engagement axis. Both lines
// freeze roughly 80px apart and NEITHER SIDE EVER CLOSES: 3/3 seeds ran the full 95s
// window with the enemy at full hit points, bloodlust armed at 14s and nothing behind it.
// That is a terrain/steering defect, not a pricing one, and is recorded as an out-of-scope
// finding in plans/035 rather than worked around silently.
const PARTY_SPOTS = [[1300, 1100], [900, 800], [1750, 1500], [2400, 900], [1200, 400], [2600, 1400]];

// Three points on the campaign's own roster curve: what a run starts with, what it looks
// like mid-run, and a near-capped warband. A tier band has to mean the same thing at all
// three or it is not a band, it is a difficulty spike at one point in the run.
const ROSTERS = {
  fresh: ['spear', 'spear', 'spear', 'spear'],
  mid: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'knight'],
  late: ['spear', 'spear', 'spear', 'spear', 'archer', 'archer', 'archer', 'knight', 'knight'],
};
const ROSTER_NAMES = String(argOf('--rosters', 'fresh,mid,late')).split(',');
// The same three policy columns the shipped sweep uses, plus `split`, so "the strongest
// simple input" is a measurement rather than an assumption.
const ALL_POLICIES = {
  idle: null,
  chargeAll: { spear: 'charge', archer: 'charge', knight: 'charge' },
  holdLine: { spear: 'hold', archer: 'hold', knight: 'hold' },
  split: { spear: 'charge', archer: 'hold', knight: 'charge' },
};
const POLICY_NAMES = String(argOf('--policies', 'idle,chargeAll')).split(',');
const POLICIES = Object.fromEntries(POLICY_NAMES.map(k => {
  if (!(k in ALL_POLICIES)) throw new Error('no such policy: ' + k);
  return [k, ALL_POLICIES[k]];
}));

// The work list, built here so the workers can just take slices of it. Seeds are a plain
// arithmetic sequence, chosen for count and not for content.
const JOBS = [];
for (const path of PATHS) {
  for (const rosterName of ROSTER_NAMES) {
    for (const ratio of RATIOS) {
      for (const policy of Object.keys(POLICIES)) {
        for (let s = 1; s <= SEEDS; s++) {
          // Site rotates with the seed so every (ratio, policy) cell draws the same set of
          // battlefields — the two policies are compared on identical ground, never on
          // different terrain samples.
          JOBS.push({
            path, rosterName, ratio, policy, seed: s,
            campId: CAMPS[(s - 1) % CAMPS.length],
            spot: PARTY_SPOTS[(s - 1) % PARTY_SPOTS.length],
          });
        }
      }
    }
  }
}

// One battle, driven through the production entry. Runs inside the page.
const runBattle = async ({ job, rosters, policies, dt }) => {
  const { WORLD, BALANCE, enemyStrength, rollComposition } = await import('/src/data.js');
  const game = window.__g;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // Outcomes depend on canvas size (the fit-to-action camera feeds hero aim, which feeds
  // FOLLOW formation), so pin it before measuring anything — same rule as raidSweep.
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;

  const types = rosters[job.rosterName];
  const orders = policies[job.policy];
  const real = game.update.bind(game);
  game.update = () => {};
  try {
    // A fresh campaign per battle: its simRng is the stream the comp is rolled on, and a
    // scenario reset is what keeps one battle from leaking state into the next.
    window.game.scenario('world', { seed: job.seed * 7919 + Math.round(job.ratio * 1000) });
    const world = game.scene;
    world.save.troops = types.map(type => ({ type }));
    world.save.gold = 500;
    world.grace = 0;
    const mine = world.myStrength();
    const cl = BALANCE.encounterWeightClamp;
    const target = clamp(mine * job.ratio, cl.min, cl.max);

    let comp;
    if (job.path === 'camp') {
      // The camp path fights the SAVED garrison: confirmBrief only rolls one when the
      // save has none, so installing it here is what pins the ratio. Brute cap mirrors
      // rollGarrison's own rule so the composition is the shipped distribution.
      const caps = BALANCE.garrisonBruteCaps;
      const bruteCap = mine >= caps.twoAt ? 2 : mine >= caps.oneAt ? 1 : 0;
      comp = rollComposition(target, world.simRng, BALANCE.compRolls.garrison, bruteCap);
      const camp = WORLD.camps.find(c => c.id === job.campId);
      if (!camp) throw new Error('no such camp: ' + job.campId);
      world.save.camps.find(c => c.id === camp.id).garrison = comp.slice();
      world.hero.x = camp.x; world.hero.y = camp.y;
      game.input.injectMouse(640, 360, false);
      game.input.injectKey('KeyE', true); real(dt); game.input.injectKey('KeyE', false);
      if (!(game.sceneName === 'world' && world.screen && world.screen.kind === 'site')) {
        throw new Error('KeyE did not open the site menu: screen=' +
          ((world.screen || {}).kind || 'none'));
      }
      game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
      if (!(game.sceneName === 'world' && world.screen && world.screen.kind === 'brief')) {
        throw new Error('the raid row did not open the brief: screen=' +
          ((world.screen || {}).kind || 'none'));
      }
      game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
    } else {
      // The party path fights a real roaming party through tryClash. The party is placed on
      // the hero, at one of PARTY_SPOTS — all clear of every settlement's canClash-blocking
      // safe zone, and all open ground.
      comp = rollComposition(target, world.simRng, BALANCE.compRolls.party);
      const [hx, hy] = job.spot;
      if (world.blockedAt(hx, hy)) {
        throw new Error('party spot ' + hx + ',' + hy + ' is inside terrain');
      }
      world.hero.x = hx; world.hero.y = hy;
      world.parties.length = 0;
      world.parties.push({
        camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
        comp: comp.slice(), home: { x: WORLD.camps[0].x, y: WORLD.camps[0].y },
        wander: null, wanderT: 999, waryT: 0, clashT: 0, occupying: null, raid: null,
        raidKind: null, mood: null, navT: 0, navGoal: null, navFor: null,
        _navGoalVisibility: new Float64Array(world.navNodes.length),
        _navGoalX: NaN, _navGoalY: NaN,
      });
      game.input.injectMouse(640, 360, false);
      // Plan 023: the world only ticks while the hero rides, so a parked hero needs one
      // awake tick for the clash to classify initiative at all (same as world_aftermath).
      window.game.keepAwake(true); real(dt); window.game.keepAwake(false);
      if (!(game.sceneName === 'world' && world.screen && world.screen.kind === 'brief')) {
        throw new Error('the party clash did not open a brief: screen=' +
          ((world.screen || {}).kind || 'none'));
      }
      game.input.injectKey('Enter', true); real(dt); game.input.injectKey('Enter', false);
    }
    if (game.sceneName !== 'battle') {
      throw new Error('the brief confirm did not reach a battle: scene=' + game.sceneName +
        ', screen=' + (((game.scene || {}).screen || {}).kind || 'none'));
    }
    const b = game.scene;
    game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
    let t = 0;
    // orders issued during `intro` are discarded, so wait the banner out first
    while (b.state === 'intro' && t < 3) { real(dt); t += dt; }
    // Plan 033: arm the deployment CONFIRM (DEPLOY_ARM_T), then press it. Asserted, so a
    // flow change can never leave this probe measuring a scene that never started.
    let armT = 0; // its own clock: `t` already carries the intro wait
    while (b.state === 'deploy' && armT < 0.5) { real(dt); t += dt; armT += dt; }
    if (b.state === 'deploy') {
      game.input.injectKey('Enter', true); real(dt); t += dt; game.input.injectKey('Enter', false);
    }
    if (b.state !== 'fight') {
      throw new Error('the deploy confirm did not start the fight: state=' + b.state);
    }
    if (orders) for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
    while (b.state !== 'end' && t < 95) { real(dt); t += dt; }
    const counts = comp.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {});
    return {
      path: job.path, rosterName: job.rosterName, ratio: job.ratio,
      policy: job.policy, seed: job.seed,
      site: job.path === 'camp' ? job.campId : job.spot.join(','),
      arena: b.arena,
      bodies: comp.length, enemy: counts,
      mine: Math.round(1000 * mine) / 1000,
      realRatio: Math.round(1000 * enemyStrength(comp) / mine) / 1000,
      resolved: b.state === 'end',
      victory: !!b.victory,
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
    out.push(await page.evaluate(runBattle, { job, rosters: ROSTERS, policies: POLICIES, dt: DT }));
    if (++done % 100 === 0) process.stderr.write('  ' + done + '/' + JOBS.length + '\n');
  }
  await page.close();
  return out;
}))).flat();
await browser.close();

writeFileSync('scripts/zz-' + LABEL + '.json',
  JSON.stringify({
    label: LABEL, ratios: RATIOS, seeds: SEEDS, paths: PATHS,
    rosters: ROSTER_NAMES, camps: CAMPS, partySpots: PARTY_SPOTS, rows,
  }, null, 2));
console.log(rows.length + ' battles, wrote scripts/zz-' + LABEL + '.json');

const unresolved = rows.filter(r => !r.resolved);
if (unresolved.length) {
  // A battle that never closes inside the window is NOT a loss and must not be silently
  // counted as one: it is a terrain/steering artefact of the battlefield it was fought on.
  // Reported by site so a bad spot is named rather than averaged away.
  const bySite = unresolved.reduce((a, r) => (a[r.path + ' ' + r.site] = (a[r.path + ' ' + r.site] || 0) + 1, a), {});
  console.log('WARNING: ' + unresolved.length + '/' + rows.length +
    ' battles did not resolve inside 95s: ' + JSON.stringify(bySite));
}

// Win rate by nominal ratio and policy, per path, with the binomial standard error so a
// margin can be read against its own noise instead of eyeballed.
//
// TWO scoring conventions are printed, because they disagree and the disagreement is data:
//   `closed` counts only battles that reached a terminal state — the honest "who beat whom".
//   `all`    counts an unresolved 95s window as a loss, which is what the shipped sweep's
//            winPct does (its denominator is total runs).
// An idle line stalls far more often than a charging one on sampled roaming-fight terrain,
// so its two columns differ by tens of points; a charging line rarely stalls, so its
// crossing is nearly the same under either convention. That is why the CHARGING crossing
// is the one this slice calibrates on.
const key = r => r.path + '|' + r.ratio.toFixed(2) + '|' + r.policy;
const groups = {};
for (const r of rows) (groups[key(r)] ||= []).push(r);
const closed = g => g.filter(r => r.resolved);
const rate = (num, den) => (den ? 100 * num / den : NaN);
const seOf = (p, den) => (den ? 100 * Math.sqrt((p / 100) * (1 - p / 100) / den) : NaN);
const fmt = (p, den) => (den ? p.toFixed(1).padStart(5) + '+/-' + seOf(p, den).toFixed(1).padEnd(4) : '     -    ');
for (const path of PATHS) {
  console.log('\n' + path + ' path');
  console.log('ratio realised policy      closed  win%(closed)  win%(all)    n   stall');
  for (const ratio of RATIOS) {
    for (const policy of POLICY_NAMES) {
      const g = groups[path + '|' + ratio.toFixed(2) + '|' + policy] || [];
      if (!g.length) continue;
      const c = closed(g);
      const realised = g.reduce((a, r) => a + r.realRatio, 0) / g.length;
      console.log(ratio.toFixed(2) + '  ' + realised.toFixed(3) + '   ' + policy.padEnd(12) +
        String(c.length).padStart(5) + '   ' +
        fmt(rate(c.filter(r => r.victory).length, c.length), c.length) + '  ' +
        fmt(rate(g.filter(r => r.victory).length, g.length), g.length) + ' ' +
        String(g.length).padStart(5) + String(g.length - c.length).padStart(7));
    }
  }
}
