// Scratch analysis for plans/028. NOT a test and NOT part of any gate.
//
// Reads the measured matchup grid written by scripts/zz-power-probe.mjs and scores
// candidate combat-power metrics against it: how well does each one predict who actually
// won? Compares the headcount metric the encounter generator ships with (Plan 020's
// enemyStrength/playerStrength) against the sqrt(dps x hp) power metric and its variants.
//
// Usage: node scripts/zz-power-fit.mjs [file]
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'scripts/zz-power-grid.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

const UNIT_TYPES = {
  spear: { hp: 100, dmg: 10, range: 30, speed: 105, cooldown: 1.05 },
  archer: { hp: 60, dmg: 10, range: 230, speed: 95, cooldown: 1.7, ranged: true },
  knight: { hp: 170, dmg: 15, range: 34, speed: 175, cooldown: 0.95 },
};
const ENEMY_TYPES = {
  bandit: { hp: 110, dmg: 10, range: 28, speed: 92, cooldown: 1.3, windup: 0.5 },
  raider: { hp: 85, dmg: 9, range: 210, speed: 82, cooldown: 2.2, windup: 0.55, ranged: true },
  brute: { hp: 420, dmg: 24, range: 52, speed: 55, cooldown: 2.8, windup: 0.95, slamR: 100 },
  wolf: { hp: 55, dmg: 8, range: 24, speed: 158, cooldown: 1.1, windup: 0.42 },
};
const HERO_HP = 120;

// ---- the metric under test, parameterised ------------------------------------------
function stats(counts, table, W) {
  let dps = 0, hp = 0;
  for (const [type, n] of Object.entries(counts)) {
    const d = table[type];
    let u = d.dmg / (d.cooldown + (d.windup || 0));
    if (d.slamR) u *= W.aoe;
    if (d.ranged) u *= W.ranged;
    dps += n * u;
    hp += n * d.hp * (d.ranged ? W.rangedHp : 1);
  }
  return { dps, hp };
}
const power = (s) => Math.sqrt(s.dps * s.hp);

function ratios(row, W) {
  const p = stats(data.rosters[row.roster], UNIT_TYPES, W);
  p.hp += HERO_HP * W.heroSoak;
  const e = stats(JSON.parse(row.enemy), ENEMY_TYPES, W);
  return power(e) / power(p);
}
// The shipped metric: brute 5, everything else 1; hero 3, knight 2.
function headRatio(row) {
  const roster = data.rosters[row.roster];
  let mine = 3;
  for (const [t, n] of Object.entries(roster)) mine += n * (t === 'knight' ? 2 : 1);
  let theirs = 0;
  for (const [t, n] of Object.entries(JSON.parse(row.enemy))) theirs += n * (t === 'brute' ? 5 : 1);
  return theirs / mine;
}

// ---- scoring ------------------------------------------------------------------------
// Only DECISIVE rows are classified (a genuine coin-flip carries no information about
// where the boundary is); the crossing is fitted on all of them.
const rows = data.rows.filter(r => r.runs > 0);
const decisive = rows.filter(r => r.winPct <= 20 || r.winPct >= 80);

function score(name, ratioOf) {
  const rs = rows.map(r => ({ r, x: Math.log(ratioOf(r)) }));
  // logistic fit of P(player wins) on log ratio, by simple gradient descent
  let a = 0, b = -4;
  for (let it = 0; it < 30000; it++) {
    let ga = 0, gb = 0;
    for (const { r, x } of rs) {
      const z = a + b * x, p = 1 / (1 + Math.exp(-z));
      const y = r.winPct / 100, w = r.runs;
      ga += w * (p - y); gb += w * (p - y) * x;
    }
    a -= 1e-4 * ga; b -= 1e-4 * gb;
  }
  const crossing = Math.exp(-a / b); // ratio at which the player wins 50%
  // classification accuracy of "the side with more power wins", at the fitted crossing
  let ok = 0;
  for (const r of decisive) {
    const predPlayerWins = ratioOf(r) < crossing;
    if (predPlayerWins === (r.winPct >= 80)) ok++;
  }
  // mean absolute error of the fitted curve over all rows
  let mae = 0;
  for (const { r, x } of rs) mae += Math.abs(1 / (1 + Math.exp(-(a + b * x))) - r.winPct / 100);
  mae /= rs.length;
  // how sharply the metric separates: the ratio window in which outcomes are mixed
  const mixed = rows.filter(r => r.winPct > 20 && r.winPct < 80).map(ratioOf).sort((x, y) => x - y);
  return {
    metric: name,
    crossing: Math.round(crossing * 1000) / 1000,
    slope: Math.round(b * 100) / 100,
    decisiveAcc: `${ok}/${decisive.length} (${Math.round(1000 * ok / decisive.length) / 10}%)`,
    mae: Math.round(mae * 1000) / 1000,
    mixedBand: mixed.length ? `${mixed[0].toFixed(2)}..${mixed[mixed.length - 1].toFixed(2)}` : '-',
  };
}

const BASE = { ranged: 1, rangedHp: 1, aoe: 1, heroSoak: 1 };
const cands = [
  ['headcount (shipped)', headRatio],
  ['sqrt(dps*hp), naive', (r) => ratios(r, BASE)],
  ['+ranged dps 1.15', (r) => ratios(r, { ...BASE, ranged: 1.15 })],
  ['+ranged dps 1.30', (r) => ratios(r, { ...BASE, ranged: 1.30 })],
  ['+ranged dps 0.85', (r) => ratios(r, { ...BASE, ranged: 0.85 })],
  ['+aoe 1.4', (r) => ratios(r, { ...BASE, aoe: 1.4 })],
  ['+aoe 1.8', (r) => ratios(r, { ...BASE, aoe: 1.8 })],
  ['+aoe 0.8', (r) => ratios(r, { ...BASE, aoe: 0.8 })],
  ['+heroSoak 0.5', (r) => ratios(r, { ...BASE, heroSoak: 0.5 })],
  ['+heroSoak 2.0', (r) => ratios(r, { ...BASE, heroSoak: 2.0 })],
  ['+rangedHp 0.8', (r) => ratios(r, { ...BASE, rangedHp: 0.8 })],
];
console.table(cands.map(([n, f]) => score(n, f)));

// ---- coarse grid search over the four weights ---------------------------------------
if (process.argv.includes('--search')) {
  let best = null;
  for (const ranged of [0.8, 0.9, 1.0, 1.1, 1.2, 1.3])
    for (const rangedHp of [0.8, 0.9, 1.0, 1.1])
      for (const aoe of [0.8, 1.0, 1.2, 1.4, 1.6, 1.8])
        for (const heroSoak of [0.5, 1.0, 1.5, 2.0]) {
          const W = { ranged, rangedHp, aoe, heroSoak };
          const s = score(JSON.stringify(W), (r) => ratios(r, W));
          const acc = Number(s.decisiveAcc.match(/\(([\d.]+)%/)[1]);
          const key = -acc + s.mae * 10;
          if (!best || key < best.key) best = { key, s, W };
        }
  console.log('best weights:', best.W);
  console.table([best.s]);
}

// ---- per-row residuals, worst first --------------------------------------------------
if (process.argv.includes('--resid')) {
  const W = BASE;
  const out = rows.map(r => ({
    roster: r.roster, enemy: r.enemy, winPct: r.winPct,
    power: Math.round(ratios(r, W) * 100) / 100,
    head: Math.round(headRatio(r) * 100) / 100,
    disagree: Math.round((headRatio(r) / ratios(r, W)) * 100) / 100,
  }));
  out.sort((a, b) => b.disagree - a.disagree);
  console.log('\n--- where headcount and power disagree most (head/power) ---');
  console.table(out.slice(0, 12));
  console.table(out.slice(-12));
}
