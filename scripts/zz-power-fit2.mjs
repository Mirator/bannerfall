// Scratch analysis for plans/028. NOT a test and NOT part of any gate.
//
// Fits ONE efficiency multiplier per body type against the measured matchup grid
// (scripts/zz-power-probe.mjs), with the logistic intercept PINNED AT ZERO so that a
// fitted power ratio of 1.0 means a measured coin flip by construction. The multiplier
// scales a body's damage AND its hit points, so it scales that body's contribution to
// sqrt(dps x hp) linearly and reads directly as "what this body is really worth".
//
// Usage: node scripts/zz-power-fit2.mjs [file] [--holdout]
import { readFileSync } from 'node:fs';

const file = process.argv.find(a => a.endsWith('.json')) || 'scripts/zz-power-grid.json';
const data = JSON.parse(readFileSync(file, 'utf8'));

const UNIT = {
  spear: { hp: 100, dmg: 10, cooldown: 1.05 },
  archer: { hp: 60, dmg: 10, cooldown: 1.7, ranged: true },
  knight: { hp: 170, dmg: 15, cooldown: 0.95 },
};
const ENEMY = {
  bandit: { hp: 110, dmg: 10, cooldown: 1.3, windup: 0.5 },
  raider: { hp: 85, dmg: 9, cooldown: 2.2, windup: 0.55, ranged: true },
  brute: { hp: 420, dmg: 24, cooldown: 2.8, windup: 0.95, slamR: 100 },
  wolf: { hp: 55, dmg: 8, cooldown: 1.1, windup: 0.42 },
};
const HERO_HP = 120;
const raw = (d) => ({ dps: d.dmg / (d.cooldown + (d.windup || 0)), hp: d.hp });
const RAW = {};
for (const [k, d] of Object.entries({ ...UNIT, ...ENEMY })) RAW[k] = raw(d);

// free parameters: spear is the unit and stays 1.0
const NAMES = ['archer', 'knight', 'hero', 'bandit', 'raider', 'brute', 'wolf'];
const PLAYER_TYPES = ['spear', 'archer', 'knight'];

function sides(row, L) {
  let pd = 0, ph = HERO_HP * L.hero;
  for (const [t, n] of Object.entries(data.rosters[row.roster])) {
    const m = t === 'spear' ? 1 : L[t];
    pd += n * RAW[t].dps * m; ph += n * RAW[t].hp * m;
  }
  let ed = 0, eh = 0;
  for (const [t, n] of Object.entries(JSON.parse(row.enemy))) {
    ed += n * RAW[t].dps * L[t]; eh += n * RAW[t].hp * L[t];
  }
  return [Math.sqrt(pd * ph), Math.sqrt(ed * eh)];
}

const rows = data.rows;
function nll(params, subset = rows) {
  const L = paramsToL(params);
  const b = Math.exp(params[NAMES.length]);
  let s = 0;
  for (const r of subset) {
    const [p, e] = sides(r, L);
    const z = -b * Math.log(e / p);
    const q = 1 / (1 + Math.exp(-z));
    const y = r.winPct / 100, n = r.runs;
    s -= n * (y * Math.log(Math.max(q, 1e-9)) + (1 - y) * Math.log(Math.max(1 - q, 1e-9)));
  }
  return s / subset.length;
}
function paramsToL(p) {
  const L = { spear: 1 };
  NAMES.forEach((n, i) => { L[n] = Math.exp(p[i]); });
  return L;
}

// Nelder-Mead-free: coordinate descent with shrinking steps. Small, deterministic, enough
// for eight smooth parameters.
function fit(subset) {
  let p = new Array(NAMES.length + 1).fill(0);
  p[NAMES.length] = Math.log(3.5);
  let best = nll(p, subset);
  for (let step = 0.4; step > 0.0015; step *= 0.72) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < p.length; i++) {
        for (const d of [step, -step]) {
          const q = p.slice(); q[i] += d;
          const v = nll(q, subset);
          if (v < best - 1e-9) { best = v; p = q; improved = true; }
        }
      }
    }
  }
  return { p, nll: best };
}

const { p, nll: loss } = fit(rows);
const L = paramsToL(p);
const slope = Math.exp(p[NAMES.length]);
console.log('fitted efficiency multipliers (spear = 1.000 by definition):');
for (const n of ['archer', 'knight', 'hero', 'bandit', 'raider', 'brute', 'wolf']) {
  const base = n === 'hero' ? null : RAW[n];
  const solo = base ? Math.sqrt(base.dps * base.hp) / Math.sqrt(RAW.spear.dps * RAW.spear.hp) : null;
  console.log(`  ${n.padEnd(7)} x${L[n].toFixed(3)}` +
    (solo ? `   raw solo weight ${solo.toFixed(2)} -> corrected ${(solo * L[n]).toFixed(2)}` : '   (hit points only)'));
}
console.log('logistic slope', slope.toFixed(2), 'mean NLL', loss.toFixed(4));

// ---- scoring, against headcount, with the crossing pinned at 1.0 for the power metric
function headRatio(row) {
  let mine = 3;
  for (const [t, n] of Object.entries(data.rosters[row.roster])) mine += n * (t === 'knight' ? 2 : 1);
  let theirs = 0;
  for (const [t, n] of Object.entries(JSON.parse(row.enemy))) theirs += n * (t === 'brute' ? 5 : 1);
  return theirs / mine;
}
const decisive = rows.filter(r => r.winPct <= 20 || r.winPct >= 80);
function report(name, ratioOf, crossing) {
  let ok = 0, mae = 0;
  for (const r of decisive) if ((ratioOf(r) < crossing) === (r.winPct >= 80)) ok++;
  // brier-style error using the metric's own best logistic
  let a = Math.log(1 / 1), b = 3.5;
  for (let it = 0; it < 4000; it++) {
    let gb = 0, ga = 0;
    for (const r of rows) {
      const x = Math.log(ratioOf(r) / crossing);
      const q = 1 / (1 + Math.exp(b * x - a));
      ga += (q - r.winPct / 100); gb += (q - r.winPct / 100) * -x;
    }
    a -= 3e-4 * ga; b -= 3e-4 * gb;
  }
  for (const r of rows) {
    const x = Math.log(ratioOf(r) / crossing);
    mae += Math.abs(1 / (1 + Math.exp(b * x - a)) - r.winPct / 100);
  }
  return { metric: name, crossing, decisive: `${ok}/${decisive.length} (${(100 * ok / decisive.length).toFixed(1)}%)`, mae: +(mae / rows.length).toFixed(3) };
}
// headcount gets its own best crossing (generous): scan for the one that maximises accuracy
let bestHead = { acc: -1 };
for (let c = 0.4; c <= 1.6; c += 0.01) {
  let ok = 0;
  for (const r of decisive) if ((headRatio(r) < c) === (r.winPct >= 80)) ok++;
  if (ok > bestHead.acc) bestHead = { acc: ok, c: +c.toFixed(2) };
}
const powRatio = (r) => { const [pp, ee] = sides(r, L); return ee / pp; };
console.table([
  report(`headcount (shipped), best crossing`, headRatio, bestHead.c),
  report('fitted power, crossing pinned at 1.0', powRatio, 1.0),
]);

// ---- per-family measured crossings under the fitted metric ---------------------------
console.log('\nmeasured 50% crossings under the fitted metric (want ~1.00):');
for (const roster of Object.keys(data.rosters)) {
  const rs = rows.filter(r => r.roster === roster);
  const fams = {};
  for (const r of rs) { const e = JSON.parse(r.enemy); (fams[Object.keys(e).sort().join('+')] ||= []).push({ r, e }); }
  const out = [];
  for (const [key, list] of Object.entries(fams)) {
    list.sort((a, b) => powRatio(a.r) - powRatio(b.r));
    let prev = null, cross = null;
    for (const it of list) {
      const pw = powRatio(it.r);
      if (prev && prev.win >= 50 && it.r.winPct < 50) cross = prev.pw + ((prev.win - 50) / (prev.win - it.r.winPct)) * (pw - prev.pw);
      prev = { win: it.r.winPct, pw };
    }
    if (cross) out.push(`${key}=${cross.toFixed(2)}`);
  }
  console.log('  ' + roster.padEnd(6) + out.join('  '));
}

// ---- holdout: fit on half the rosters, score on the other half ------------------------
if (process.argv.includes('--holdout')) {
  const names = Object.keys(data.rosters);
  const A = new Set(names.filter((_, i) => i % 2 === 0));
  const trainRows = rows.filter(r => A.has(r.roster));
  const testRows = rows.filter(r => !A.has(r.roster));
  const f = fit(trainRows);
  const Lh = paramsToL(f.p);
  const rr = (r) => { const [pp, ee] = sides(r, Lh); return ee / pp; };
  const dec = testRows.filter(r => r.winPct <= 20 || r.winPct >= 80);
  let ok = 0; for (const r of dec) if ((rr(r) < 1.0) === (r.winPct >= 80)) ok++;
  let okH = 0; for (const r of dec) if ((headRatio(r) < bestHead.c) === (r.winPct >= 80)) okH++;
  console.log(`\nholdout (train ${[...A].join(',')} / test the rest):`);
  console.log(`  fitted power ${ok}/${dec.length} (${(100 * ok / dec.length).toFixed(1)}%)  vs  headcount ${okH}/${dec.length} (${(100 * okH / dec.length).toFixed(1)}%)`);
  console.log('  train multipliers', Object.fromEntries(Object.entries(Lh).map(([k, v]) => [k, +v.toFixed(3)])));
}
