// Scratch measurement harness for plans/029. NOT a test and NOT part of any gate.
//
// The phase-4 audit's finding 3 is that "gold stops being a resource after about four
// fights": the sinks were exhaustive and cheap, so after the army cap was full and the
// warband healed there was nothing left to want. Plan 029 adds two sinks (the banner) and
// changes the shape of a third (the army cap now buys places in the column, and a knight
// takes two). This measures whether that is actually true rather than asserting it.
//
// Method: play a scripted campaign OPENING through the real world paths — ride onto a
// roaming party, confirm the brief, resolve the fight, take the loot — and record the
// gold curve alongside the running cost of a reasonable spending policy. The hero is
// idle in the fight itself (endBattle is forced) because this measures the ECONOMY, not
// the combat; the loot formula does not care who swung.
//
// Usage: node scripts/zz-economy-probe.mjs [--fights 14] [--seeds 6]
// Requires `python scripts/serve.py` on 127.0.0.1:8474.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const FIGHTS = argOf('--fights', 14);
const SEEDS = argOf('--seeds', 6);
const BASE = 'http://127.0.0.1:8474';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.error('PAGE ERROR', e.message));
await page.goto(BASE + '/');

const runs = await page.evaluate(async ({ fights, seeds }) => {
  const { BALANCE, UNIT_TYPES, armySlots } = await import('/src/data.js');
  const { bannerCost, BANNER_MAX } = await import('/src/progression.js');
  const game = window.__g;
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;
  const out = [];
  for (let s = 1; s <= seeds; s++) {
    window.game.scenario('world', { seed: s * 61 });
    let world = game.scene;
    world.save.gold = BALANCE.startGold;
    const rows = [];
    let earned = 0, spent = 0;
    for (let f = 0; f < fights; f++) {
      world = game.scene;
      if (game.sceneName !== 'world') { rows.push({ stopped: 'battle did not return to world' }); break; }
      // A "reasonable" spending policy, applied before each fight: fill the column with
      // the cheapest useful body, buy a cap upgrade when it is affordable and the column
      // is full, and raise the banner when nothing else is wanted. This is deliberately
      // NOT optimal play — it is a player who spends what he has on the things offered.
      let guard = 0;
      while (guard++ < 60) {
        const before = world.save.gold;
        const slots = armySlots(world.save.troops);
        const spearCost = world.costAt(null, 'spear');
        if (slots + 1 <= world.save.armyCap && world.save.gold >= spearCost) {
          world.save.gold -= spearCost;
          world.save.troops.push({ type: 'spear' });
        } else if (slots + 1 > world.save.armyCap && world.save.gold >= world.armyCapCost()) {
          world.save.gold -= world.armyCapCost();
          world.save.armyCap += 2;
        } else if (world.save.banner < BANNER_MAX && world.save.gold >= bannerCost(world.save.banner)) {
          world.save.gold -= bannerCost(world.save.banner);
          world.save.banner += 1;
        } else break;
        spent += before - world.save.gold;
      }
      // Plan 023: the campaign only simulates while the hero RIDES, so a harness that
      // teleports him from fight to fight freezes the party-spawn timer and runs the map
      // dry after a handful of encounters. keepAwake is the documented treadmill for
      // exactly this, and the wait between fights is what a player riding across the map
      // would spend anyway — without it this measures a shorter opening than the game has.
      window.game.keepAwake(true);
      for (let i = 0; i < 45 * 60 && world.parties.length === 0; i++) window.game.step(1 / 60);
      window.game.step(3);

      // Ride onto the nearest party outside a sanctuary and take the fight.
      let target = null, bd = Infinity;
      for (const p of world.parties) {
        if (world.inSafeZone(p.x, p.y)) continue;
        const d = (p.x - world.hero.x) ** 2 + (p.y - world.hero.y) ** 2;
        if (d < bd) { bd = d; target = p; }
      }
      if (!target) { rows.push({ stopped: 'no reachable party' }); break; }
      const goldBefore = world.save.gold;
      world.hero.x = target.x; world.hero.y = target.y; world.grace = 0;
      window.game.step(0.1);
      if (game.sceneName === 'world' && game.scene.screen && game.scene.screen.kind === 'brief') {
        game.input.injectKey('Enter', true); window.game.step(1 / 60); game.input.injectKey('Enter', false);
      }
      if (game.sceneName !== 'battle') { rows.push({ stopped: 'clash did not start a battle' }); break; }
      const b = game.scene;
      const enemies = b.totalEnemies;
      b.endBattle(true);
      for (let i = 0; i < 400 && game.sceneName !== 'world'; i++) window.game.step(1 / 60);
      if (game.sceneName !== 'world') break;
      world = game.scene;
      // Clear any modal the return raised (aftermath, then a perk choice) so the next
      // fight can be reached; taking the perk is part of the opening either way.
      for (let i = 0; i < 6 && world.screen; i++) {
        game.input.injectKey('Enter', true); window.game.step(1 / 60); game.input.injectKey('Enter', false);
      }
      const loot = world.save.gold - goldBefore;
      earned += Math.max(0, loot);
      rows.push({
        fight: f + 1, enemies, loot, gold: world.save.gold,
        bodies: world.save.troops.length, slots: armySlots(world.save.troops),
        cap: world.save.armyCap, banner: world.save.banner,
        perks: (world.save.perks || []).length,
        vets: world.save.troops.filter(t => (t.vet || 0) > 0).length,
      });
    }
    out.push({ seed: s * 61, earned, spent, rows });
  }
  return {
    out,
    sinks: {
      spear: UNIT_TYPES.spear.cost, archer: UNIT_TYPES.archer.cost, knight: UNIT_TYPES.knight.cost,
      knightSlots: UNIT_TYPES.knight.slots,
      heal: BALANCE.healCost,
      armyCapFirst: BALANCE.armyCapCostBase, armyCapStep: BALANCE.armyCapCostStep,
      banner: BALANCE.bannerCosts,
      lootBase: BALANCE.lootBase, lootPerEnemy: BALANCE.lootPerEnemy,
    },
  };
}, { fights: FIGHTS, seeds: SEEDS });

await browser.close();

const n = runs.out.length;
const avgAt = (i, f) => {
  const vals = runs.out.map(r => r.rows[i]).filter(r => r && !r.stopped).map(f);
  return vals.length ? Math.round(10 * vals.reduce((a, b) => a + b, 0) / vals.length) / 10 : null;
};
console.log('sinks:', JSON.stringify(runs.sinks));
console.log(`\n${n} campaign openings, ${FIGHTS} fights each`);
console.log('fight | loot | gold held | bodies | slots/cap | banner | perks | veterans');
for (let i = 0; i < FIGHTS; i++) {
  if (avgAt(i, r => r.loot) === null) break;
  console.log([
    String(i + 1).padStart(5),
    String(avgAt(i, r => r.loot)).padStart(5),
    String(avgAt(i, r => r.gold)).padStart(10),
    String(avgAt(i, r => r.bodies)).padStart(7),
    (avgAt(i, r => r.slots) + '/' + avgAt(i, r => r.cap)).padStart(10),
    String(avgAt(i, r => r.banner)).padStart(7),
    String(avgAt(i, r => r.perks)).padStart(6),
    String(avgAt(i, r => r.vets)).padStart(9),
  ].join(' |'));
}
const earned = runs.out.reduce((a, r) => a + r.earned, 0) / n;
const spent = runs.out.reduce((a, r) => a + r.spent, 0) / n;
console.log(`\nmean earned ${Math.round(earned)} g, mean spent ${Math.round(spent)} g over the opening`);

writeFileSync('scripts/zz-economy-prog.json', JSON.stringify(runs, null, 2));
console.log('wrote scripts/zz-economy-prog.json');
