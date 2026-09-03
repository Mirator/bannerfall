import { test, expect } from '@playwright/test';
import { BALANCE, WORLD } from '../../src/data.js';
import { runCampaign, summarize, goldByComposition, POLICIES } from './campaign-harness.js';
import { collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Plan 038 — the campaign arc, measured.
//
// Everything Plans 028-035 measured was ONE BATTLE. This file measures the run those
// battles sit in: how long a scripted player takes to reach Wolfsjaw, what the gold curve
// does on the way, and what odds the warband arrives with. The harness itself, its four
// policies and its stated blind spots are documented in campaign-harness.js.
//
// The split is the one playwright.config.js already makes. A campaign is roughly 5-15
// battles at up to 95 s of simulated time each, so the full four-policy sweep is tagged
// `@sweep`, runs under `npm run test:balance`, and is excluded from the 30 s per-test PR
// gate. ONE smoke test — two seeds, four fights, forced resolution — runs in `npm test`
// so the harness cannot rot silently while nobody is looking at it.

// Plain arithmetic seeds, chosen only for count and not for content.
const SWEEP_SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

// The sweep is 48 campaigns and three tests read it. Playwright runs this file in ONE
// worker (`workers: 1`), so the module-level cache below is shared between them and the
// measurement is taken once rather than three times.
let sweepPromise = null;
function sweep(page) {
  if (!sweepPromise) {
    sweepPromise = (async () => {
      const byPolicy = {};
      for (const policy of POLICIES) {
        byPolicy[policy] = [];
        for (const seed of SWEEP_SEEDS) byPolicy[policy].push(await runCampaign(page, { seed, policy }));
      }
      return byPolicy;
    })();
  }
  return sweepPromise;
}

test('the campaign harness drives a real campaign through the production entries', async ({ page }) => {
  // The smoke test. `forced` resolves each fight at the deployment confirm, so this
  // exercises every EDGE the harness asserts — the site menu, the brief, the deployment
  // phase, the aftermath, the spec and perk modals, the save slot — without paying for
  // simulated combat. Four fights is enough to reach the second modal queue.
  const runtimeErrors = collectRuntimeErrors(page);
  const records = [];
  for (const seed of [1, 2]) {
    records.push(await runCampaign(page, {
      seed, policy: 'campRaider', resolve: 'forced', maxBattles: 4, wallT: 900,
    }));
  }
  for (const r of records) {
    expect(['won', 'wall', 'cap', 'route']).toContain(r.outcome);
    expect(r.battles, `seed ${r.seed} fought nothing at all`).toBeGreaterThan(0);
    expect(r.fights.length).toBe(r.battles);
    for (const f of r.fights) {
      expect(f.ratio, `a fight with no measurable ratio: ${JSON.stringify(f)}`).toBeGreaterThan(0);
      expect(Object.keys(f.enemies).length).toBeGreaterThan(0);
    }
    // `forced` grants the fight at the deployment confirm, so every battle is a win and
    // the loot arithmetic is the only thing moving gold upward.
    expect(r.wins).toBe(r.battles);
    expect(r.goldEarned).toBeGreaterThan(0);
  }
  // Every call through window.game writes bf_save_test; the real campaign slot must be
  // untouched by a measurement run.
  const realSlot = await page.evaluate(() => localStorage.getItem('bf_save'));
  expect(realSlot, 'the harness wrote the real save slot').toBeNull();
  assertNoRuntimeErrors(runtimeErrors);
});

test.describe('campaign arc', () => {
  test('the same seed and policy replay identically', { tag: '@sweep' }, async ({ page }) => {
    // Determinism is the hard contract every other number here rests on. Plan 038's first
    // STOP condition is this one: if two runs of one seed disagree, fix determinism before
    // measuring anything — do not average over a non-deterministic run.
    test.setTimeout(300_000);
    for (const policy of ['claimRush', 'campRaider']) {
      const first = await runCampaign(page, { seed: 7, policy });
      const second = await runCampaign(page, { seed: 7, policy });
      expect(second, `${policy}/7 must replay identically`).toEqual(first);
    }
  });

  test('a claim is bought, and riding past four settlements does not expose the hold', { tag: '@sweep' }, async ({ page }) => {
    // Plan 038 acceptance criteria 2 and 4, plus the console table that
    // `critiques/campaign-arc-comparison.md` quotes.
    test.setTimeout(1_800_000);
    const byPolicy = await sweep(page);
    const all = Object.values(byPolicy).flat();
    console.log('campaign arc:');
    for (const r of all) console.log('  ' + summarize(r));
    const roaming = goldByComposition(all, ['hunt', 'party']);
    console.log('gold by majority body type (roaming fights):');
    console.log(JSON.stringify(roaming, null, 2));

    // --- criterion 2. Both halves: the price is STRUCTURAL (the whole march cannot be
    // bought out of the opening purse), and the power state is gated on a razed camp, so
    // the route that never fights cannot reach the thinned garrison it used to.
    const claimTotal = WORLD.settlements.reduce((sum, s) => sum + BALANCE.claimCost[s.kind], 0);
    expect(claimTotal, 'claiming every settlement must cost more than the starting purse')
      .toBeGreaterThan(BALANCE.startGold);
    for (const r of byPolicy.claimRush) {
      expect(r.strongholdStateAtStorm,
        `claimRush/${r.seed} reached EXPOSED without razing a camp`).not.toBe('exposed');
    }

    // --- criterion 4: loot is paid per body type, so what a fight pays no longer depends
    // on which cheap body the roller happened to pick.
    const { wolf, bandit } = roaming;
    expect(wolf, 'no wolf-heavy roaming fights were measured').toBeTruthy();
    expect(bandit, 'no bandit-heavy roaming fights were measured').toBeTruthy();
    const perFight = Math.abs(wolf.goldPerFight - bandit.goldPerFight) /
      Math.max(wolf.goldPerFight, bandit.goldPerFight);
    expect(perFight,
      `gold per fight still depends on body type: wolf-heavy ${wolf.goldPerFight}, ` +
      `bandit-heavy ${bandit.goldPerFight}`).toBeLessThanOrEqual(0.25);

    // The criterion above is weaker than it looks and was ALREADY satisfied by the flat
    // headcount rule (measured 27.9 against 27.1 on the untouched tree): parties are
    // generated to a weight target, so a wolf-heavy party simply has more bodies and the
    // per-body rule paid the same total. The defect was gold per unit of FIGHTING WEIGHT,
    // which spanned 2.5x — a wolf paid 12.36 and a brute 4.89, so the dominant income in
    // the campaign was running down wolf-heavy parties. That is the property asserted
    // here, and it is the one the four `gold` values were tuned against.
    const rates = Object.values(roaming).map(b => b.goldPerWeight);
    const spread = Math.max(...rates) / Math.min(...rates);
    expect(spread,
      `gold per unit of fighting weight still spans ${spread.toFixed(2)}x: ` +
      JSON.stringify(Object.fromEntries(Object.entries(roaming).map(([k, v]) => [k, v.goldPerWeight]))))
      .toBeLessThanOrEqual(1.5);
  });

  test('a warband that fought and spent storms Wolfsjaw at better odds than one that did not', { tag: '@sweep' }, async ({ page }) => {
    // EXPECTED FAILURE on 1 of 12 seeds — Plan 038 acceptance criterion 3. Do not delete
    // this annotation to tidy the suite and do not weaken the assertion.
    //
    // PLAN 039 TOOK IT FROM 3 FAILING SEEDS TO 1, by making a wipe recoverable: a defeat
    // musters the column back to the starting four instead of two, and while the warband
    // is at or below its own starting weight the floor guarantees a fight inside
    // `BALANCE.distress.partyRatio` rather than the 27.9%-win 1.30. Seed 12 is the
    // demonstration — its post-wipe fights were 1.89, 2.35 and 1.19 and it reached the hold
    // at fighting weight 2.5; they are now 1.05, 0.79 and 0.63, it wins them, and it
    // reaches the hold at 12.6. Across the sweep `farmer`, the policy that loses most,
    // dropped from 68 losses to 43 and its battle win rate went 37% -> 60%.
    //
    // Seed 1 is what is left, and it is not the death spiral: `campRaider` reaches the hold
    // at weight 6.6 having razed two camps, which is a warband that recovered — it simply
    // did not recover FAR enough to beat `claimRush`'s fixed 6.6-weight, stage-1 storm on
    // that particular map. One seed of twelve, on a policy that attempts each camp once and
    // never comes back to the one it lost, is a property of the scripted player as much as
    // of the game (see the harness header). Remove this annotation when it measures 12/12,
    // not before.
    //
    // THE PROPERTY THIS GUARDS IS NOW MOSTLY TRUE, and the record matters because it was
    // not. Measured over 12 seeds before and after (`critiques/campaign-arc-comparison.md`):
    // `campRaider`'s battle win rate went 33% -> 73%, its campaign 246 s -> 155 s, and the
    // fighting weight it reaches the hold with 4.3 -> 12.9. It now WINS 4 campaigns where
    // it used to win none, while `claimRush` — which used to be the only policy that ever
    // won a run — wins none, cannot afford more than one claim out of `startGold`, and
    // reaches the hold ENTRENCHED on 12 of 12 seeds. The dominant strategy inverted.
    //
    // Criterion 3 went from 2/12 to 9/12, and the three that remain fail for a reason that
    // has nothing to do with encounter pricing: they are the WIPE DEATH SPIRAL, which this
    // plan lists as out of scope (audit finding 5). On seeds 1, 2 and 12 the warband lost a
    // fight that cost it ten to twelve men, landed on the 25-gold defeat floor, and never
    // rebuilt — all three end the run at exactly 25 gold, at fighting weight 4.6, 6.6 and
    // 2.5. A warband that fought and LOST does not arrive at Wolfsjaw stronger, and nothing
    // in the generator can make it so; what is missing is a recovery path.
    //
    // The earlier and much larger cause is fixed. Razing the last linked camp used to
    // absorb every surviving roaming party into Wolfsjaw's garrison without bound — the one
    // force in the game that bypassed `encounterBase()` — and it was worth more than
    // everything the warband gained by fighting. Seed 3's `campRaider` reached the hold at
    // fighting weight 17.4 against `claimRush`'s 6.6 and still stormed at a WORSE ratio,
    // 1.42 against 1.33. With the absorption bounded by
    // `BALANCE.strongholdRemnantCeiling`, that same seed storms at 0.69.
    test.fail();
    test.setTimeout(1_800_000);
    const byPolicy = await sweep(page);
    for (const seed of SWEEP_SEEDS) {
      const raider = byPolicy.campRaider.find(r => r.seed === seed);
      const rush = byPolicy.claimRush.find(r => r.seed === seed);
      if (!raider.storm || !rush.storm) continue; // a run that never reached the hold says nothing
      expect(raider.storm.ratio,
        `seed ${seed}: campRaider must storm at better odds than claimRush ` +
        `(${raider.storm.ratio} vs ${rush.storm.ratio})`).toBeLessThan(rush.storm.ratio);
    }
  });
});
