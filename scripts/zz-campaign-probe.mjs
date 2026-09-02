// Scratch measurement harness for plans/037. NOT a test, NOT part of a gate.
//
// What it measures: a whole CAMPAIGN, end to end, for each of the four scripted policies
// in tests/e2e/campaign-harness.js — time-to-victory, the gold curve, fights per run, the
// ratio the warband arrives at Wolfsjaw with, and gold per fight bucketed by what was
// actually fought. Plans 028-035 measured single battles to three digits; nothing had
// ever measured the arc they sit in.
//
// It shares the harness module with tests/e2e/campaign-arc.spec.js on purpose: the
// numbers a plan quotes and the numbers a gate asserts must come from the same code, or
// the two can disagree without either being wrong.
//
// Usage (the server must be running: `python scripts/serve.py`):
//   node scripts/zz-campaign-probe.mjs [--seeds 12] [--policies claimRush,campRaider]
//                                      [--workers 4] [--resolve real|forced]
//                                      [--label baseline] [--wall 3600] [--battles 60]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { runCampaign, summarize, goldByComposition, POLICIES } from '../tests/e2e/campaign-harness.js';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const SEEDS = Number(argOf('--seeds', 12));
const POLICY_NAMES = String(argOf('--policies', POLICIES.join(','))).split(',');
const WORKERS = Number(argOf('--workers', 4));
const RESOLVE = argOf('--resolve', 'real');
const LABEL = argOf('--label', 'campaign037');
const WALL = Number(argOf('--wall', 3600));
const MAX_BATTLES = Number(argOf('--battles', 60));
const BASE = 'http://127.0.0.1:8474';

// Plain arithmetic seeds, chosen only for count and not for content, so no result can be
// accused of landing on favourable seeds.
const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);

const jobs = [];
for (const policy of POLICY_NAMES) for (const seed of seeds) jobs.push({ policy, seed });

async function worker(id, queue, out) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, baseURL: BASE });
  page.on('pageerror', e => console.error(`[w${id}] page error:`, e.message));
  try {
    for (;;) {
      const job = queue.shift();
      if (!job) break;
      const started = Date.now();
      try {
        const record = await runCampaign(page, {
          seed: job.seed, policy: job.policy, resolve: RESOLVE,
          wallT: WALL, maxBattles: MAX_BATTLES,
        });
        record.wallClockMs = Date.now() - started;
        out.push(record);
        console.log(summarize(record));
      } catch (err) {
        console.error(`[w${id}] ${job.policy}/${job.seed} FAILED: ${err.message}`);
        out.push({ seed: job.seed, policy: job.policy, error: String(err.message) });
      }
    }
  } finally {
    await browser.close();
  }
}

const results = [];
const queue = jobs.slice();
await Promise.all(Array.from({ length: Math.max(1, WORKERS) }, (_, i) => worker(i, queue, results)));
results.sort((a, b) => (a.policy < b.policy ? -1 : a.policy > b.policy ? 1 : a.seed - b.seed));

// Per-policy aggregate: the three headline numbers the audit could only estimate.
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = n => Math.round(n * 10) / 10;
const r3 = n => Math.round(n * 1000) / 1000;
const byPolicy = {};
for (const policy of POLICY_NAMES) {
  const rows = results.filter(r => r.policy === policy && !r.error);
  const stormed = rows.filter(r => r.storm);
  byPolicy[policy] = {
    runs: rows.length,
    won: rows.filter(r => r.won).length,
    wall: rows.filter(r => r.outcome === 'wall').length,
    cap: rows.filter(r => r.outcome === 'cap').length,
    playT: Math.round(mean(rows.map(r => r.playT))),
    battles: r1(mean(rows.map(r => r.battles))),
    winPct: Math.round(100 * mean(rows.map(r => (r.battles ? r.wins / r.battles : 0)))),
    goldEarned: Math.round(mean(rows.map(r => r.goldEarned))),
    goldSpent: Math.round(mean(rows.map(r => r.goldSpent))),
    finalGold: Math.round(mean(rows.map(r => r.finalGold))),
    finalWeight: r1(mean(rows.map(r => r.finalWeight))),
    stormRatio: r3(mean(stormed.map(r => r.storm.ratio))),
    stormWinPct: stormed.length ? Math.round(100 * stormed.filter(r => r.storm.won).length / stormed.length) : null,
    strongholdStates: countOf(rows.map(r => r.strongholdStateAtStorm)),
    floorFires: r1(mean(rows.map(r => r.floorFires))),
    raidsLanded: r1(mean(rows.map(r => r.raidsLanded))),
    claimsRefused: r1(mean(rows.map(r => r.claimsRefused))),
    goldPerBattle: r1(mean(rows.map(r => (r.battles ? r.goldEarned / r.battles : 0)))),
  };
}
function countOf(list) {
  const out = {};
  for (const v of list) out[v == null ? 'none' : v] = (out[v == null ? 'none' : v] || 0) + 1;
  return out;
}

const composition = goldByComposition(results.filter(r => !r.error));
const huntComposition = goldByComposition(results.filter(r => !r.error), ['hunt', 'party']);

console.log('\n=== per policy ===');
console.log(JSON.stringify(byPolicy, null, 2));
console.log('\n=== gold by majority body type (all won fights) ===');
console.log(JSON.stringify(composition, null, 2));
console.log('\n=== gold by majority body type (roaming fights only) ===');
console.log(JSON.stringify(huntComposition, null, 2));

const out = `scripts/zz-campaign-${LABEL}.json`;
writeFileSync(out, JSON.stringify({
  label: LABEL, resolve: RESOLVE, seeds, policies: POLICY_NAMES, wall: WALL, maxBattles: MAX_BATTLES,
  byPolicy, composition, huntComposition, records: results,
}, null, 2));
console.log(`\nwrote ${out}`);
