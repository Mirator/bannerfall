// Scratch measurement harness for plans/029 (progression and unit identity).
//
// NOT a test and NOT part of any gate. It answers exactly one question, the one plans/019
// got wrong and had to retract: WHEN A BRACED SPEARMAN SWINGS, HOW FAST IS THE THING IT IS
// SWINGING AT ACTUALLY MOVING? BRACE_SPEED is 120 and the constants file claims only a wolf
// (158) can ever cross it. Plan 027 gave the enemy a commander that orders brutes and
// bandits forward on its own timing, so the claim has to be re-measured rather than
// re-asserted.
//
// Method: run the two canonical fixtures with the player's melee squads on HOLD, and on
// every tick sample every enemy that is inside a holding melee troop's strike reach — which
// is precisely the population the `closingFast` test in ai-phases.js is applied to. Record
// the enemy's raw speed (what the shipped test reads) and its CLOSING speed (the component
// of its velocity along the bearing to that troop, which is what "closing at speed" means
// in words).
//
// Usage:  node scripts/zz-brace-probe.mjs [--label before] [--seeds 12]
// Requires `python scripts/serve.py` on 127.0.0.1:8474.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const label = argOf('--label', 'before');
const SEEDS = Number(argOf('--seeds', 12));

const DT = 1 / 60;
const BASE = 'http://127.0.0.1:8474';
const rep = (type, n) => Array.from({ length: n }, () => ({ type }));

const ROAM = {
  troops: [...rep('spear', 4), ...rep('archer', 3), ...rep('knight', 1)],
  enemies: [...rep('bandit', 3), ...rep('raider', 2), ...rep('wolf', 2)],
};
// A brute-heavy side, because the brute is the body the "brace beats charges" claim is
// most often sold on and the one Plan 019 had to retract.
const HEAVY = {
  troops: [...rep('spear', 6), ...rep('archer', 3)],
  enemies: [...rep('brute', 2), ...rep('bandit', 5), ...rep('wolf', 3)],
};

const ORDERS = { spear: 'hold', archer: 'hold', knight: 'hold' };

async function probe(page, fixture, seeds) {
  return page.evaluate(async ({ fixture, orders, seeds, dt }) => {
    const C = await import('/src/battle/constants.js');
    const game = window.__g;
    const canvas = document.getElementById('game');
    canvas.width = 1280; canvas.height = 720;
    game.camera.w = 1280; game.camera.h = 720;
    const real = game.update.bind(game);
    game.update = () => {};
    // one bucket per enemy type: every contact sample, plus the swing-time samples
    const acc = {};
    const bump = (type, raw, closing, recent) => {
      const a = acc[type] || (acc[type] = { n: 0, raw: [], closing: [], recent: [] });
      a.n++; a.raw.push(raw); a.closing.push(closing); a.recent.push(recent);
    };
    // Rolling peak speed over the last MEMORY seconds, per enemy. This is exactly the
    // quantity a LATCHED brace would read: "how fast was this thing moving on its way in",
    // rather than "how fast is it moving now that it has stopped to swing".
    const MEMORY = 1.0;
    try {
      for (const seed of seeds) {
        game.startBattle({
          troops: fixture.troops, enemies: fixture.enemies, seed,
          title: 'BRACE PROBE', arena: 'road', biome: 'rose',
          deploy: 0, approach: 'E', heroHp: 120, heroMaxHp: 120, onEnd: () => {},
        });
        const b = game.scene;
        b.state = 'fight'; b.deployT = 0;
        game.input.injectMouse(640, 360, false);
        game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
        for (const [squad, order] of Object.entries(orders)) b.issueCommand(order, squad);
        let t = 0;
        const peak = new Map(); // enemy -> { v, until }
        while (b.state !== 'end' && t < 90) {
          real(dt); t += dt;
          for (const e of b.enemies) {
            const sp = Math.hypot(e.vx, e.vy);
            const cur = peak.get(e);
            if (!cur || sp >= cur.v || t > cur.until) peak.set(e, { v: sp, until: t + MEMORY });
          }
          for (const troop of b.troops) {
            if (troop.d.ranged) continue;
            if (b.squadStance(troop) !== 'hold') continue;
            for (const e of b.enemies) {
              const dx = e.x - troop.x, dy = e.y - troop.y;
              const d = Math.hypot(dx, dy);
              // the exact reach gate the swing uses in updateTroopPhase
              if (d >= troop.d.range + e.d.radius + 4) continue;
              const sp = Math.hypot(e.vx, e.vy);
              const closing = d > 0 ? -((e.vx * dx + e.vy * dy) / d) : 0;
              const pk = peak.get(e);
              bump(e.type, sp, closing, pk ? pk.v : sp);
              // Plan 029: the shipped predicate. `rushT` is the latch the brace actually
              // reads, so this column is the only one that answers "does the bonus fire".
              const a = acc[e.type];
              a.latched = (a.latched || 0) + ((e.rushT || 0) > 0 ? 1 : 0);
            }
          }
        }
      }
    } finally { game.update = real; }
    const pct = (arr, p) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((x, y) => x - y);
      return Math.round(10 * s[Math.min(s.length - 1, Math.floor(p * s.length))]) / 10;
    };
    const out = { braceSpeed: C.BRACE_SPEED, braceBonus: C.BRACE_BONUS, types: {} };
    for (const [type, a] of Object.entries(acc)) {
      out.types[type] = {
        samples: a.n,
        rawMedian: pct(a.raw, 0.5), rawP90: pct(a.raw, 0.9), rawMax: pct(a.raw, 0.999),
        closingMedian: pct(a.closing, 0.5), closingP90: pct(a.closing, 0.9), closingMax: pct(a.closing, 0.999),
        recentMedian: pct(a.recent, 0.5), recentP90: pct(a.recent, 0.9), recentMax: pct(a.recent, 0.999),
        // THE headline number: the share of contacts on which a braced spearman's swing
        // would actually carry the bonus, under the shipped rule.
        latchedPct: Math.round(1000 * (a.latched || 0) / a.n) / 10,
        rawOverBracePct: Math.round(1000 * a.raw.filter(v => v > C.BRACE_SPEED).length / a.n) / 10,
        closingOverBracePct: Math.round(1000 * a.closing.filter(v => v > C.BRACE_SPEED).length / a.n) / 10,
        recentOverBracePct: Math.round(1000 * a.recent.filter(v => v > C.BRACE_SPEED).length / a.n) / 10,
        // what fraction each candidate threshold would catch, on CLOSING speed...
        catchAt: Object.fromEntries([40, 50, 60, 70, 80, 90, 100, 120].map(th =>
          [th, Math.round(1000 * a.closing.filter(v => v > th).length / a.n) / 10])),
        // ...and on the LATCHED recent-peak speed, which is the candidate rule
        catchAtLatched: Object.fromEntries([40, 50, 60, 70, 80, 90, 100, 110, 120, 140].map(th =>
          [th, Math.round(1000 * a.recent.filter(v => v > th).length / a.n) / 10])),
      };
    }
    return out;
  }, { fixture, orders: ORDERS, seeds, dt: DT });
}

const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(BASE + '/');

const out = { label, generated: new Date().toISOString(), fixtures: {} };
out.fixtures.roam = await probe(page, ROAM, seeds);
console.log('roam', JSON.stringify(out.fixtures.roam, null, 1));
out.fixtures.heavy = await probe(page, HEAVY, seeds);
console.log('heavy', JSON.stringify(out.fixtures.heavy, null, 1));
await browser.close();

const file = `scripts/zz-brace-${label}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log('wrote', file);
