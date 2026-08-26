// Scratch analysis for plans/028, final fit. NOT a test and NOT part of any gate.
//
// Fits the per-type efficiency table against BOTH measured grids at once:
//
//   * zz-power-grid.json   — hand-built ladders, mostly one enemy type deep. This is what
//                            separates one body's worth from another's; a mixed grid alone
//                            cannot tell a wolf from a raider.
//   * zz-power-rolled.json — compositions drawn from the SHIPPED rollComposition on the
//                            shipped BALANCE.compRolls weights. This is the distribution
//                            the encounter generator actually produces, so it is what
//                            decides where the 50% crossing lands.
//
// The rolled rows are up-weighted: the separation comes from the ladders, the calibration
// has to come from the real thing. The logistic intercept is pinned at zero throughout, so
// a fitted ratio of 1.00 is a measured coin flip rather than something calibrated later.
//
// Usage: node scripts/zz-power-fit3.mjs [--rolledWeight 4] [--holdout]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const ROLLED_W = argOf('--rolledWeight', 4);

const g1 = JSON.parse(readFileSync('scripts/zz-power-grid.json', 'utf8'));
const g2 = JSON.parse(readFileSync('scripts/zz-power-rolled.json', 'utf8'));

const UNIT = {
  spear: { hp: 100, dmg: 10, cooldown: 1.05 },
  archer: { hp: 60, dmg: 10, cooldown: 1.7 },
  knight: { hp: 170, dmg: 15, cooldown: 0.95 },
};
const ENEMY = {
  bandit: { hp: 110, dmg: 10, cooldown: 1.3, windup: 0.5 },
  raider: { hp: 85, dmg: 9, cooldown: 2.2, windup: 0.55 },
  brute: { hp: 420, dmg: 24, cooldown: 2.8, windup: 0.95 },
  wolf: { hp: 55, dmg: 8, cooldown: 1.1, windup: 0.42 },
};
const HERO_HP = 120;
const RAW = {};
for (const [k, d] of Object.entries({ ...UNIT, ...ENEMY })) RAW[k] = { dps: d.dmg / (d.cooldown + (d.windup || 0)), hp: d.hp };

const listToCounts = (list) => (Array.isArray(list)
  ? list.reduce((a, t) => (a[t] = (a[t] || 0) + 1, a), {}) : list);

// Normalise both files into { roster:{type:n}, enemy:{type:n}, y, n, w, src }
const samples = [];
for (const r of g1.rows) {
  samples.push({ roster: g1.rosters[r.roster], enemy: JSON.parse(r.enemy), y: r.winPct / 100, n: r.runs, w: 1, src: 'ladder', tag: r.roster });
}
for (const r of g2.rows) {
  samples.push({ roster: listToCounts(g2.rosters[r.roster]), enemy: r.enemy, y: r.victory ? 1 : 0, n: 1, w: ROLLED_W, src: 'rolled', tag: r.roster });
}

const NAMES = ['archer', 'knight', 'bandit', 'raider', 'brute', 'wolf'];
const toL = (p) => { const L = { spear: 1, hero: 1 }; NAMES.forEach((k, i) => { L[k] = Math.exp(p[i]); }); return L; };
function ratio(s, L) {
  let pd = 0, ph = HERO_HP * L.hero;
  for (const [t, n] of Object.entries(s.roster)) { pd += n * RAW[t].dps * L[t]; ph += n * RAW[t].hp * L[t]; }
  let ed = 0, eh = 0;
  for (const [t, n] of Object.entries(s.enemy)) { ed += n * RAW[t].dps * L[t]; eh += n * RAW[t].hp * L[t]; }
  return Math.sqrt(ed * eh) / Math.sqrt(pd * ph);
}
function nll(p, set) {
  const L = toL(p), b = Math.exp(p[NAMES.length]);
  let s = 0, tw = 0;
  for (const x of set) {
    const q = 1 / (1 + Math.exp(b * Math.log(ratio(x, L))));
    const w = x.n * x.w;
    s -= w * (x.y * Math.log(Math.max(q, 1e-9)) + (1 - x.y) * Math.log(Math.max(1 - q, 1e-9)));
    tw += w;
  }
  return s / tw;
}
function fit(set) {
  let p = new Array(NAMES.length + 1).fill(0);
  p[NAMES.length] = Math.log(4);
  let best = nll(p, set);
  for (let st = 0.4; st > 0.0015; st *= 0.72) {
    let imp = true;
    while (imp) {
      imp = false;
      for (let i = 0; i < p.length; i++) for (const d of [st, -st]) {
        const q = p.slice(); q[i] += d;
        const v = nll(q, set);
        if (v < best - 1e-9) { best = v; p = q; imp = true; }
      }
    }
  }
  return { L: toL(p), b: Math.exp(p[NAMES.length]) };
}

const f = fit(samples);
console.log('fitted (spear and hero pinned at 1.00):',
  Object.entries(f.L).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' '), `slope=${f.b.toFixed(2)}`);

// ---- scoring --------------------------------------------------------------------------
const headRatio = (s) => {
  let mine = 3; for (const [t, n] of Object.entries(s.roster)) mine += n * (t === 'knight' ? 2 : 1);
  let th = 0; for (const [t, n] of Object.entries(s.enemy)) th += n * (t === 'brute' ? 5 : 1);
  return th / mine;
};
function acc(set, rf, crossing) {
  const dec = set.filter(s => s.n > 1 ? (s.y <= 0.2 || s.y >= 0.8) : true);
  let ok = 0, wt = 0;
  for (const s of dec) { const pred = rf(s) < crossing; const won = s.n > 1 ? s.y >= 0.8 : s.y === 1; if (pred === won) ok += s.n; wt += s.n; }
  return `${ok}/${wt} (${(100 * ok / wt).toFixed(1)}%)`;
}
let bestHeadC = { a: -1 };
for (let c = 0.4; c <= 1.8; c += 0.01) {
  const v = Number(acc(samples, headRatio, c).match(/\(([\d.]+)%/)[1]);
  if (v > bestHeadC.a) bestHeadC = { a: v, c: +c.toFixed(2) };
}
const ladders = samples.filter(s => s.src === 'ladder'), rolled = samples.filter(s => s.src === 'rolled');
console.table([
  { metric: `headcount, best crossing ${bestHeadC.c}`, all: acc(samples, headRatio, bestHeadC.c), ladders: acc(ladders, headRatio, bestHeadC.c), rolled: acc(rolled, headRatio, bestHeadC.c) },
  { metric: 'fitted power, crossing 1.00', all: acc(samples, s => ratio(s, f.L), 1), ladders: acc(ladders, s => ratio(s, f.L), 1), rolled: acc(rolled, s => ratio(s, f.L), 1) },
]);

// ---- where does the rolled distribution actually cross 50%? ----------------------------
function crossingTable(L, name) {
  const buckets = {};
  for (const s of rolled) {
    const k = (Math.round(ratio(s, L) * 10) / 10).toFixed(1);
    (buckets[k] ||= []).push(s.y);
  }
  const rows = Object.keys(buckets).sort().map(k => ({
    ratio: k, n: buckets[k].length,
    idleWinPct: +(100 * buckets[k].reduce((a, b) => a + b, 0) / buckets[k].length).toFixed(1),
  }));
  console.log(`\nrolled compositions, idle win rate by ${name} ratio:`);
  console.table(rows);
}
crossingTable(f.L, 'fitted');

// ---- candidate rounded tables ----------------------------------------------------------
if (process.argv.includes('--round')) {
  const round = (v, s) => Math.round(v / s) * s;
  for (const step of [0.05, 0.1]) {
    const L = { spear: 1, hero: 1 };
    for (const k of NAMES) L[k] = round(f.L[k], step);
    console.log(`\nrounded to ${step}:`, Object.entries(L).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '));
    console.table([{ all: acc(samples, s => ratio(s, L), 1), ladders: acc(ladders, s => ratio(s, L), 1), rolled: acc(rolled, s => ratio(s, L), 1) }]);
    crossingTable(L, `rounded-${step}`);
  }
}
