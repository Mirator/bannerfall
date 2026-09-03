import { test, expect } from '@playwright/test';
import { WORLD, BALANCE, lootFor, enemyStrength } from '../../src/data.js';
import { RAID, REGION, SPECIALIZATIONS } from '../../src/region.js';
import { collectRuntimeErrors, assertNoRuntimeErrors } from './test-helpers.js';

// Milestone 025 regional-conquest loop, driven through the REAL production paths —
// named input actions, full World.update ticks, requestBattle/confirmBrief, real
// endBattle — against the isolated bf_save_test slot (every window.game call marks
// test mode). Deterministic scenario seeds; no wall-clock sleeps.
//
// Harness rules: the live rAF scheduler is parked right after the scenario swap (an
// uncontrolled tick would scout camps, move parties and fire the autosave mid-fixture)
// and every simulation step is an explicit production update through window.__tick.
// Settlement/camp coordinates come from the Node-side production data and are passed
// into the page — module imports do not exist on window.

const SEED = 20260817;
const DT = 1 / 60;
const S = id => WORLD.settlements.find(s => s.id === id);
const C = id => WORLD.camps.find(c => c.id === id);
const STRONGHOLD = C('strong');

async function openWorld(page, seed = SEED) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(seedValue => {
    window.game.scenario('world', { seed: seedValue });
    // Park the live scheduler; tests drive explicit production ticks only.
    window.__realUpdate = window.__g.update.bind(window.__g);
    window.__g.update = () => {};
    window.__tick = seconds => {
      for (let i = 0; i < Math.max(1, Math.round(seconds / (1 / 60))); i++) window.__realUpdate(1 / 60);
    };
  }, seed);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
}

// One production world tick with a named action held down — the exact shape a real
// keypress takes through Input.
async function tickAction(page, action) {
  await page.evaluate(({ action }) => {
    const g = window.game;
    g.action(action, true);
    window.__tick(1 / 60);
    g.action(action, false);
  }, { action });
}

// Plan 030: a settlement service, a claim and an assault are all rows of the site menu
// now. This opens it with the one map verb, walks to the named row with the menu actions
// and commits with CONFIRM — every step a production press through a full world tick, the
// same shape the rest of this spec uses. It names the rows it found when the one asked for
// is not offered, which is the failure a fixture standing in the wrong place actually has.
async function tickSiteRow(page, rowId) {
  await tickAction(page, 'worldPrimary');
  const steps = await page.evaluate(id => {
    const screen = window.__g.scene.screen;
    if (!screen || screen.kind !== 'site') {
      throw new Error(`site menu did not open (screen: ${(screen || {}).kind || 'none'})`);
    }
    const i = screen.rows.findIndex(r => r.id === id);
    if (i < 0) throw new Error(`no "${id}" row here — rows: ${screen.rows.map(r => r.id).join(', ') || '(none)'}`);
    return (i - screen.index + screen.rows.length) % screen.rows.length;
  }, rowId);
  for (let n = 0; n < steps; n++) await tickAction(page, 'menuDown');
  await tickAction(page, 'confirm');
}

// Plan 031: the specialization and perk modals refuse a commit for CHOICE_ARM_T after they
// open, so a burst of presses clearing an aftermath cannot pick a permanent option blind.
// A fixture has to wait it out exactly like a player does — ticking here rather than
// reaching past the guard is the point.
async function commitChoice(page, note = '') {
  await page.evaluate(() => {
    const w = window.__g.scene;
    if (!w.screen || w.screen.armT == null) return;
    let guard = 0;
    while (w.screen && w.screen.armT > 0 && guard++ < 120) window.__tick(1 / 60);
  });
  await tickAction(page, 'confirm');
  return note;
}

// Plan 038: a claim is a purchase (BALANCE.claimCost, 60 for a village and 100 for the
// town) and `startGold` is 80, so a fixture that claims more than one settlement has to
// be funded. The fixtures below say so explicitly rather than quietly depending on the
// starting purse, which is exactly the coupling that let a free claim go unnoticed.
async function fund(page, gold) {
  await page.evaluate(g => { window.__g.scene.save.gold = g; }, gold);
}

const CLAIM_COST = id => BALANCE.claimCost[S(id).kind];

test('a fresh campaign opens with the documented regional shape', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  const out = await page.evaluate(() => {
    const s = window.game.state().world;
    return {
      region: s.region,
      settlements: s.settlements,
      campIds: s.camps.map(c => c.id).sort(),
      strongholds: s.camps.filter(c => c.id === 'strong').length,
    };
  });
  expect(out.settlements.length).toBe(WORLD.settlements.length);
  expect(out.settlements.every(x => x.owner === 'neutral' && x.occupied === false)).toBe(true);
  expect(out.region.power).toBe('ENTRENCHED');
  expect(out.region.powerPoints).toBe(0);
  expect(out.region.raidTarget).toBe(null);
  expect(out.region.raidCdT).toBeGreaterThan(0); // fresh-run quiet — never mid-raid
  expect(out.campIds).toEqual(['c1', 'c2', 'c3', 'strong']);
  expect(out.strongholds).toBe(1);
  assertNoRuntimeErrors(runtimeErrors);
});

test('claiming neutral ground is a PURCHASE that checkpoints ownership and opens the permanent spec choice — and buys no grace', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(({ x, y }) => {
    window.__g.scene.hero.x = x;
    window.__g.scene.hero.y = y;
  }, { x: S('ashford').x, y: S('ashford').y });
  const beforeClaim = await page.evaluate(() => ({
    gold: window.__g.scene.save.gold,
    goldSpent: window.__g.scene.save.stats.goldSpent,
    raidCdT: window.__g.scene.raidCdT,
  }));
  await tickSiteRow(page, 'claim');
  const claimed = await page.evaluate(async () => {
    const w = window.__g.scene;
    await window.__g.saves.flush();
    const stored = JSON.parse(localStorage.getItem('bf_save_test'));
    return {
      rec: w.save.settlements.find(s => s.id === 'ashford'),
      captures: w.save.stats.captures,
      screenKind: w.screen && w.screen.kind,
      optionIds: w.screen && w.screen.options.map(o => o.id),
      raidCdT: w.raidCdT,
      gold: w.save.gold,
      goldSpent: w.save.stats.goldSpent,
      persistedOwner: stored.settlements.find(s => s.id === 'ashford').owner,
      persistedGold: stored.gold,
    };
  });
  expect(claimed.rec.owner).toBe('player');
  expect(claimed.rec.occupied).toBe(false);
  expect(claimed.captures).toBe(1);
  expect(claimed.screenKind).toBe('spec');
  expect(claimed.optionIds).toEqual(['barracks', 'archery', 'market', 'watchtower']);
  // Plan 038: the claim is bought. The purse is debited and the campaign summary's
  // spend counter sees it, exactly as a recruit or an army-cap expansion does.
  expect(claimed.gold).toBe(beforeClaim.gold - CLAIM_COST('ashford'));
  expect(claimed.goldSpent).toBe(beforeClaim.goldSpent + CLAIM_COST('ashford'));
  expect(claimed.persistedGold).toBe(claimed.gold);
  // Plan 038 INVERTS what this used to assert. Grace is earned by winning a fight, not by
  // riding past: a peaceful claim leaves the raid clock exactly where it found it. Four
  // free claims used to push it out by 60 s each on top of RAID.firstDelayT's 110, and
  // the campaign harness measured zero landed raids across 48 runs as a result. The
  // capture-by-battle case below is the half that still buys grace.
  expect(claimed.raidCdT).toBe(beforeClaim.raidCdT);
  // The claim was a persistence checkpoint written while still in `world`.
  expect(claimed.persistedOwner).toBe('player');

  // Committing the first option (Barracks) grants exactly its immediate effect and
  // checkpoints the permanent choice.
  const before = await page.evaluate(() => {
    const w = window.__g.scene;
    return { troops: w.save.troops.length, cap: w.save.armyCap };
  });
  await commitChoice(page);
  const chosen = await page.evaluate(async () => {
    const w = window.__g.scene;
    await window.__g.saves.flush();
    const stored = JSON.parse(localStorage.getItem('bf_save_test'));
    return {
      spec: w.save.settlements.find(s => s.id === 'ashford').spec,
      screenKind: w.screen && w.screen.kind,
      troopCount: w.save.troops.length,
      goldEarned: w.save.stats.goldEarned,
      persistedSpec: stored.settlements.find(s => s.id === 'ashford').spec,
    };
  });
  expect(chosen.spec).toBe('barracks');
  // Plan 029: committing the specialization closes the SPEC screen, and the perk choice
  // that same capture earned opens behind it on the next tick. One modal at a time, in a
  // queue — the assertion is that the spec choice is done, not that nothing follows it.
  expect(chosen.screenKind).not.toBe('spec');
  expect(chosen.screenKind).toBe('perk');
  expect(chosen.troopCount).toBe(before.troops + Math.min(2, before.cap - before.troops));
  expect(chosen.goldEarned).toBe(0); // barracks grants men, not gold
  expect(chosen.persistedSpec).toBe('barracks');
  assertNoRuntimeErrors(runtimeErrors);
});

test('a claim the purse cannot cover is refused at the row, and the panel says so', async ({ page }) => {
  // Plan 038 acceptance criterion 2, at the level the player meets it. `startGold` is 80
  // and the town costs 100, so a fresh campaign literally cannot buy Highmere — and the
  // refusal has to READ as a price, on the row, before the press.
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(({ x, y }) => {
    window.__g.scene.hero.x = x;
    window.__g.scene.hero.y = y;
  }, { x: S('keep').x, y: S('keep').y });
  await tickAction(page, 'worldPrimary');
  const row = await page.evaluate(() => {
    const screen = window.__g.scene.screen;
    return screen.rows.find(r => r.id === 'claim');
  });
  expect(row.label).toContain(String(CLAIM_COST('keep')));
  expect(row.enabled).toBe(false);
  expect(row.disabledReason).toBe(`Need ${CLAIM_COST('keep')} gold`);
  await tickAction(page, 'withdraw'); // close the panel, then commit the row anyway

  // Committing a disabled row must refuse in claimSettlement's own words and leave the
  // menu up carrying the notice — the same shape a refused recruit or expansion has.
  await tickSiteRow(page, 'claim');
  const refused = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      owner: w.save.settlements.find(s => s.id === 'keep').owner,
      gold: w.save.gold,
      captures: w.save.stats.captures,
      screenKind: w.screen && w.screen.kind,
      notice: w.screen && w.screen.notice,
    };
  });
  expect(refused.owner).toBe('neutral');
  expect(refused.gold).toBe(BALANCE.startGold);
  expect(refused.captures).toBe(0);
  expect(refused.screenKind).toBe('site');
  expect(refused.notice).toContain(String(CLAIM_COST('keep')));

  // Fund it and the same row lands.
  await tickAction(page, 'withdraw');
  await fund(page, CLAIM_COST('keep'));
  await tickSiteRow(page, 'claim');
  const bought = await page.evaluate(() => {
    const w = window.__g.scene;
    return { owner: w.save.settlements.find(s => s.id === 'keep').owner, gold: w.save.gold };
  });
  expect(bought.owner).toBe('player');
  expect(bought.gold).toBe(0);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a settlement taken by BATTLE is free and still buys capture grace', async ({ page }) => {
  // The other half of Plan 038's grace rule. Riding past neutral ground and paying for it
  // buys no grace; driving an occupier off it is a fight, so it does — and it costs no
  // gold, because it was won rather than bought. This is the capture-by-battle path
  // through the SAME winSettlement branch the peaceful claim skips.
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(({ x, y, hx, hy }) => {
    const w = window.__g.scene;
    // brindle is NEUTRAL and a break-off party has seized it: nothing here is owned.
    w.save.settlements.find(s => s.id === 'brindle').occupied = true;
    w.parties.length = 0;
    w.parties.push({
      camp: 'c1', x, y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit', 'bandit', 'raider'],
      home: { x: hx, y: hy },
      wander: null, wanderT: 0, waryT: 0, clashT: 0,
      occupying: 'brindle', raid: null,
      navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(w.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
    w.persistParties();
    w.raidCdT = 1; // the clock is nearly up, so grace is measurable rather than assumed
    w.hero.x = x; w.hero.y = y;
    window.game.keepAwake(true);
  }, { x: S('brindle').x + 20, y: S('brindle').y, hx: C('c1').x, hy: C('c1').y });
  const before = await page.evaluate(() => ({
    gold: window.__g.scene.save.gold,
    goldSpent: window.__g.scene.save.stats.goldSpent,
  }));

  await page.evaluate(() => { window.__tick(1 / 60); });
  expect(await page.evaluate(() => window.__g.scene.screen && window.__g.scene.screen.kind)).toBe('brief');
  await tickAction(page, 'confirm');
  await page.evaluate(() => {
    if (window.__g.sceneName !== 'battle') throw new Error('confirming the brief did not start a battle');
    window.__g.scene.endBattle(true);
  });
  await page.evaluate(() => { window.__tick(3); });
  await tickAction(page, 'confirm'); // dismiss the aftermath

  const won = await page.evaluate(() => {
    const w = window.__g.scene;
    const rec = w.save.settlements.find(s => s.id === 'brindle');
    return {
      owner: rec.owner, occupied: rec.occupied,
      captures: w.save.stats.captures,
      raidCdT: w.raidCdT,
      gold: w.save.gold, goldSpent: w.save.stats.goldSpent,
    };
  });
  expect(won.owner).toBe('player');
  expect(won.occupied).toBe(false);
  expect(won.captures).toBe(1);
  // Won, not bought: nothing was charged for it.
  expect(won.goldSpent).toBe(before.goldSpent);
  expect(won.gold).toBeGreaterThanOrEqual(before.gold); // loot only ever adds
  // And a fight DOES buy the cadence grace a ride past does not.
  expect(won.raidCdT).toBeGreaterThanOrEqual(RAID.graceAfterCaptureT);
  assertNoRuntimeErrors(runtimeErrors);
});

test('dismissing the spec choice does not lose it — the site menu at the gates reopens it', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(({ x, y }) => {
    window.__g.scene.hero.x = x;
    window.__g.scene.hero.y = y;
  }, { x: S('ashford').x, y: S('ashford').y });
  await fund(page, 500); // Plan 038: a claim is a purchase; this fixture is about the modal
  await tickSiteRow(page, 'claim'); // capture ashford — its spec modal opens
  await tickAction(page, 'withdraw'); // "decide later"
  const dismissed = await page.evaluate(() => {
    const w = window.__g.scene;
    const rec = w.save.settlements.find(s => s.id === 'ashford');
    return { screenOpen: !!w.screen, owner: rec.owner, spec: rec.spec };
  });
  expect(dismissed.screenOpen).toBe(false);
  expect(dismissed.owner).toBe('player'); // the capture itself is not undone by dismissing
  expect(dismissed.spec).toBeFalsy(); // but no specialization was chosen either

  // The menu at the same gates — still owned, still unspecialized — reopens the prompt.
  await tickSiteRow(page, 'spec');
  const reopened = await page.evaluate(() => {
    const w = window.__g.scene;
    return { kind: w.screen && w.screen.kind, id: w.screen && w.screen.settlement.id };
  });
  expect(reopened.kind).toBe('spec');
  expect(reopened.id).toBe('ashford');

  await commitChoice(page); // commit the first option (Barracks)
  const committed = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      spec: w.save.settlements.find(s => s.id === 'ashford').spec,
      screenKind: w.screen && w.screen.kind,
    };
  });
  expect(committed.spec).toBe('barracks');
  // Plan 029: the perk choice the capture earned queues behind the spec screen and opens
  // the tick it closes — the exact expected state, not merely "no longer the spec screen".
  expect(committed.screenKind).toBe('perk');
  assertNoRuntimeErrors(runtimeErrors);
});

test('capturing a second settlement while a first choice is still outstanding does not lose the first', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(({ x, y }) => {
    window.__g.scene.hero.x = x;
    window.__g.scene.hero.y = y;
  }, { x: S('ashford').x, y: S('ashford').y });
  await fund(page, 500); // Plan 038: two claims cost 120 gold, more than startGold's 80
  await tickSiteRow(page, 'claim'); // capture ashford
  await tickAction(page, 'withdraw'); // decide later — leaves ashford queued, unspecialized

  await page.evaluate(({ x, y }) => {
    window.__g.scene.hero.x = x;
    window.__g.scene.hero.y = y;
  }, { x: S('brindle').x, y: S('brindle').y });
  await tickSiteRow(page, 'claim'); // capture brindle while ashford's choice is still outstanding
  const bothPending = await page.evaluate(() => {
    const w = window.__g.scene;
    const ashford = w.save.settlements.find(s => s.id === 'ashford');
    const brindle = w.save.settlements.find(s => s.id === 'brindle');
    return {
      ashfordOwner: ashford.owner, ashfordSpec: ashford.spec,
      brindleOwner: brindle.owner, brindleSpec: brindle.spec,
      screenKind: w.screen && w.screen.kind,
      screenId: w.screen && w.screen.settlement.id,
      captures: w.save.stats.captures,
    };
  });
  // Capturing brindle opened ITS spec modal, but ashford's earlier, still-undecided
  // choice was not silently dropped by queueSpecChoice() overwriting its single pointer —
  // the settlement's own owner/spec fields are the real pending state.
  expect(bothPending.ashfordOwner).toBe('player');
  expect(bothPending.ashfordSpec).toBeFalsy();
  expect(bothPending.brindleOwner).toBe('player');
  expect(bothPending.brindleSpec).toBeFalsy();
  expect(bothPending.screenKind).toBe('spec');
  expect(bothPending.screenId).toBe('brindle');
  expect(bothPending.captures).toBe(2);

  await commitChoice(page); // commit brindle's choice
  // Plan 029: two captures have earned two perk choices, which queue behind the spec
  // modals. Take them both so the world is modal-free before the reopen is tested — the
  // property under test is that ashford's SPEC choice survived, not the perk ordering.
  await commitChoice(page);
  await commitChoice(page);
  expect(await page.evaluate(() => window.__g.scene.screen && window.__g.scene.screen.kind))
    .toBe(null);

  // Return to ashford's gates: the menu still reopens its own, still-outstanding choice.
  await page.evaluate(({ x, y }) => {
    window.__g.scene.hero.x = x;
    window.__g.scene.hero.y = y;
  }, { x: S('ashford').x, y: S('ashford').y });
  await tickSiteRow(page, 'spec');
  const ashfordReopened = await page.evaluate(() => {
    const w = window.__g.scene;
    return { kind: w.screen && w.screen.kind, id: w.screen && w.screen.settlement.id };
  });
  expect(ashfordReopened.kind).toBe('spec');
  expect(ashfordReopened.id).toBe('ashford');

  await commitChoice(page); // commit ashford's choice too
  const final = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      ashfordSpec: w.save.settlements.find(s => s.id === 'ashford').spec,
      brindleSpec: w.save.settlements.find(s => s.id === 'brindle').spec,
    };
  });
  expect(final.ashfordSpec).toBe('barracks');
  expect(final.brindleSpec).toBe('barracks'); // same default first option, distinct settlement
  assertNoRuntimeErrors(runtimeErrors);
});

test('each specialization applies exactly its documented benefit while held', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  // Fixture: three holdings with the three economically distinct specializations.
  // Direct small deterministic save mutation, the same discipline the persistence
  // specs use for a unique roaming party.
  await page.evaluate(() => {
    const w = window.__g.scene;
    for (const [id, spec] of [['ashford', 'barracks'], ['brindle', 'market'], ['coldwell', 'watchtower']]) {
      const rec = w.save.settlements.find(s => s.id === id);
      rec.owner = 'player';
      rec.spec = spec;
    }
    w.save.stats.captures = 3;
  });
  // One live tick runs the watchtower's scouting phase — the phase only runs while
  // time flows, so ride in place for it (and nothing else has input to act on).
  await page.evaluate(() => {
    window.game.keepAwake(true);
    window.__tick(1 / 60);
    window.game.keepAwake(false);
  });
  const out = await page.evaluate(() => {
    const w = window.__g.scene;
    const handle = id => ({ id });
    return {
      barracksCost: w.costAt(handle('ashford'), 'spear'),
      marketHeal: w.healCostAt(handle('brindle')),
      scouted: w.save.camps.filter(c => c.garrison).map(c => c.id).sort(),
      defaultSpear: w.costAt(handle('keep'), 'spear'),
      defaultHeal: w.healCostAt(handle('keep')),
    };
  });
  expect(out.barracksCost).toBe(SPECIALIZATIONS.barracks.effect.spearCost);
  expect(out.marketHeal).toBe(SPECIALIZATIONS.market.effect.healCost);
  // Other settlements keep their own prices — a specialization is per-settlement.
  expect(out.defaultSpear).not.toBe(SPECIALIZATIONS.barracks.effect.spearCost);
  expect(out.defaultHeal).toBeGreaterThan(SPECIALIZATIONS.market.effect.healCost);
  // The watchtower radius promise: exactly the in-radius, live camps revealed.
  const expected = WORLD.camps
    .filter(c => !c.stronghold &&
      Math.hypot(c.x - S('coldwell').x, c.y - S('coldwell').y) <= REGION.watchtowerScoutR)
    .map(c => c.id).sort();
  expect(out.scouted).toEqual(expected);

  // An OCCUPIED holding stops applying its benefit but keeps the permanent choice.
  const suspended = await page.evaluate(() => {
    const w = window.__g.scene;
    const rec = w.save.settlements.find(s => s.id === 'ashford');
    rec.occupied = true;
    const occupiedCost = w.costAt({ id: 'ashford' }, 'spear');
    const active = rec.owner === 'player' && !rec.occupied && rec.spec === 'barracks';
    rec.occupied = false;
    const restoredCost = w.costAt({ id: 'ashford' }, 'spear');
    return { specKept: rec.spec, occupiedCost, active, restoredCost };
  });
  expect(suspended.specKept).toBe('barracks');
  expect(suspended.active).toBe(false);
  expect(suspended.occupiedCost).toBe(out.defaultSpear);
  expect(suspended.restoredCost).toBe(SPECIALIZATIONS.barracks.effect.spearCost);
  assertNoRuntimeErrors(runtimeErrors);
});

test('an occupier suspends a holding and winning it back restores service without a second spec choice', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  // Fixture: ashford is ours with a Barracks; a raiding party seizes it.
  await page.evaluate(({ x, y, hx, hy }) => {
    const w = window.__g.scene;
    const rec = w.save.settlements.find(s => s.id === 'ashford');
    rec.owner = 'player';
    rec.spec = 'barracks';
    rec.occupied = true; // the occupier's seizure, as a loaded save would carry it
    w.save.stats.captures = 1;
    // Plan 029: a v5 campaign with one capture has already been OFFERED its perk, so the
    // fixture takes one. Without it the derived perk count (captures 1 > perks 0) would
    // correctly raise a choice on the next World and the test would be measuring that
    // instead of the reclaim it is about.
    w.save.perks = ['setSpears'];
    w.parties.length = 0;
    w.parties.push({
      camp: 'c1', x, y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit', 'bandit', 'raider'],
      home: { x: hx, y: hy },
      wander: null, wanderT: 0, waryT: 0, clashT: 0,
      occupying: 'ashford', raid: null,
      navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(w.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
    w.persistParties();
  }, {
    x: S('ashford').x + 20, y: S('ashford').y,
    hx: C('c1').x, hy: C('c1').y,
  });
  const occupied = await page.evaluate(() => {
    const w = window.__g.scene;
    const rec = w.save.settlements.find(s => s.id === 'ashford');
    return {
      occupied: rec.occupied,
      suspendedCost: w.costAt({ id: 'ashford' }, 'spear'),
    };
  });
  expect(occupied.occupied).toBe(true);
  expect(occupied.suspendedCost).not.toBe(SPECIALIZATIONS.barracks.effect.spearCost);

  // Win the retake battle through the real requestBattle -> confirm -> endBattle path.
  // The occupier is exempt from the settlement safe-zone block, so parking the hero on
  // it closes the clash immediately.
  await page.evaluate(({ x, y }) => {
    const w = window.__g.scene;
    w.hero.x = x;
    w.hero.y = y;
    window.game.keepAwake(true);
  }, { x: S('ashford').x + 20, y: S('ashford').y });
  await page.evaluate(() => { window.__tick(1 / 60); });
  const brief = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      kind: w.screen && w.screen.kind,
      title: w.screen && w.screen.title,
      objective: w.pending && w.pending.descriptor.objective,
      canWithdraw: w.pending && w.pending.descriptor.canWithdraw,
    };
  });
  expect(brief.kind).toBe('brief');
  expect(brief.title).toBe('RETAKE ASHFORD');
  expect(brief.objective.kind).toBe('hold');
  expect(brief.canWithdraw).toBe(false); // an occupier fight is committed, not initiated
  await tickAction(page, 'confirm');
  await page.evaluate(() => {
    if (window.__g.sceneName !== 'battle') throw new Error('confirming the retake brief did not start a battle');
    window.__g.scene.endBattle(true);
  });
  await page.evaluate(() => { window.__tick(3); }); // ride out the end banner
  await tickAction(page, 'confirm'); // dismiss the aftermath
  const reclaimed = await page.evaluate(() => {
    const w = window.__g.scene;
    const rec = w.save.settlements.find(s => s.id === 'ashford');
    return {
      scene: window.__g.sceneName,
      owner: rec.owner, spec: rec.spec, occupied: rec.occupied,
      captures: w.save.stats.captures,
      screenKind: w.screen && w.screen.kind,
      cost: w.costAt({ id: 'ashford' }, 'spear'),
    };
  });
  expect(reclaimed.scene).toBe('world');
  expect(reclaimed.owner).toBe('player'); // reclaim, not a fresh capture
  expect(reclaimed.spec).toBe('barracks'); // the permanent choice survived
  expect(reclaimed.occupied).toBe(false);
  expect(reclaimed.captures).toBe(1); // a reclaim never re-counts
  // A reclaim re-opens NEITHER choice: the spec is permanent, and Plan 029's perk points
  // are derived from stats.captures, which a reclaim deliberately does not increment.
  expect(reclaimed.screenKind).toBe(null);
  expect(reclaimed.cost).toBe(SPECIALIZATIONS.barracks.effect.spearCost); // service resumed
  assertNoRuntimeErrors(runtimeErrors);
});

test('regional raids dispatch one at a time at held ground and freeze with the world', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(() => {
    const w = window.__g.scene;
    for (const id of ['ashford', 'brindle']) {
      w.save.settlements.find(s => s.id === id).owner = 'player';
    }
    w.save.stats.captures = 2;
  });
  // Dispatch: the phase runs only on live ticks, so ride in place. The clock must
  // actually EXPIRE on the tick — set it to zero, not merely small.
  await page.evaluate(() => {
    const w = window.__g.scene;
    window.game.keepAwake(true);
    w.raidCdT = 0;
  });
  await page.evaluate(() => { window.__tick(1 / 60); });
  const dispatched = await page.evaluate(() => {
    const w = window.__g.scene;
    const raiders = w.parties.filter(p => p.raidKind === 'regional' && p.raid);
    return {
      count: raiders.length,
      target: raiders[0] && raiders[0].raid,
      raidCdT: w.raidCdT,
      regionTarget: window.game.state().world.region.raidTarget,
    };
  });
  expect(dispatched.count).toBe(1);
  expect(['ashford', 'brindle']).toContain(dispatched.target);
  expect(dispatched.target).toBe(dispatched.regionTarget);
  expect(dispatched.raidCdT).toBeGreaterThan(RAID.intervalT - 1); // rearmed at the interval

  // Single-flight: an expired clock with a raid already out dispatches nothing.
  await page.evaluate(() => {
    const w = window.__g.scene;
    w.raidCdT = 0.05;
    window.__tick(1 / 60);
  });
  const stillOne = await page.evaluate(() =>
    window.__g.scene.parties.filter(p => p.raidKind === 'regional' && p.raid).length);
  expect(stillOne).toBe(1);

  // Standing still freezes the raid with everything else: no movement, no clock.
  await page.evaluate(() => {
    window.game.keepAwake(false);
    window.__tick(1 / 60); // settle the coast so the freeze decision is final
  });
  const frozen = await page.evaluate(() => {
    const w = window.__g.scene;
    const raid = w.parties.find(p => p.raidKind === 'regional' && p.raid);
    const before = { x: raid.x, y: raid.y, cd: w.raidCdT };
    window.__tick(2); // 2 frozen seconds
    return {
      moved: raid.x !== before.x || raid.y !== before.y,
      cdDelta: w.raidCdT - before.cd,
      stillListed: window.game.state().world.region.raidTarget !== null,
    };
  });
  expect(frozen.moved).toBe(false);
  expect(frozen.cdDelta).toBe(0);
  expect(frozen.stillListed).toBe(true);
  assertNoRuntimeErrors(runtimeErrors);
});

test('a raid landing on held ground beside the hero is a Hold-the-ground defense, and winning it buys defense grace', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  // Fixture: ashford is held; put an inbound regional raid on it directly.
  await page.evaluate(({ x, y, hx, hy }) => {
    const w = window.__g.scene;
    w.save.settlements.find(s => s.id === 'ashford').owner = 'player';
    w.save.stats.captures = 1;
    w.parties.length = 0;
    w.parties.push({
      camp: 'strong', x, y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit', 'bandit', 'raider'],
      home: { x: hx, y: hy },
      wander: null, wanderT: 0, waryT: 0, clashT: 0,
      occupying: null, raid: 'ashford', raidKind: 'regional',
      navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(w.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    });
    w.persistParties();
    // Hero answers from the settlement: inside RAID.defenseR, outside clash shape.
    w.hero.x = x + 80;
    w.hero.y = y;
    window.game.keepAwake(true);
  }, { x: S('ashford').x, y: S('ashford').y, hx: STRONGHOLD.x, hy: STRONGHOLD.y });
  await page.evaluate(() => { window.__tick(1 / 60); });
  const brief = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      kind: w.screen && w.screen.kind,
      title: w.screen && w.screen.title,
      objective: w.pending && w.pending.descriptor.objective,
      canWithdraw: w.pending && w.pending.descriptor.canWithdraw,
      arena: w.pending && w.pending.descriptor.arena,
    };
  });
  expect(brief.kind).toBe('brief');
  expect(brief.title).toBe('DEFENSE OF ASHFORD');
  expect(brief.objective.kind).toBe('hold');
  expect(brief.canWithdraw).toBe(true); // accepting the loss temporarily is legal
  expect(brief.arena).toBe('village');
  await tickAction(page, 'confirm');
  await page.evaluate(() => {
    if (window.__g.sceneName !== 'battle') throw new Error('confirming the defense brief did not start a battle');
    if (window.__g.scene.objective.kind !== 'hold') throw new Error('defense battle lacks the hold objective');
    window.__g.scene.endBattle(true);
  });
  await page.evaluate(() => { window.__tick(3); });
  await tickAction(page, 'confirm'); // dismiss the aftermath
  const after = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      scene: window.__g.sceneName,
      raidersLeft: w.parties.filter(p => p.raidKind === 'regional').length,
      raidTarget: window.game.state().world.region.raidTarget,
      raidCdT: w.raidCdT,
      ashford: w.save.settlements.find(s => s.id === 'ashford'),
    };
  });
  expect(after.scene).toBe('world');
  expect(after.raidersLeft).toBe(0); // a destroyed raid does not come back
  expect(after.raidTarget).toBe(null);
  expect(after.raidCdT).toBeGreaterThanOrEqual(RAID.graceAfterDefenseT); // fresh-world quiet covers the grace
  expect(after.ashford.owner).toBe('player');
  expect(after.ashford.occupied).toBe(false);
  assertNoRuntimeErrors(runtimeErrors);
});

test('razing the last camp reinforces Wolfsjaw within its stage-priced ceiling, and the bands it cannot take stay on the March', async ({ page }) => {
  // Plan 038 follow-up. Bands with nowhere left to muster fall back on the hold, which is
  // a real cost for leaving them alive — but this was the ONE force in the game that
  // bypassed `encounterBase()`, and it was unbounded: every surviving party was pushed
  // onto the garrison and then deleted from the map. Measured, that was worth more than
  // everything a warband gained by fighting, and it emptied the March at the moment the
  // campaign asked the player to go and win it.
  //
  // The fixture stacks the deck on purpose — six full bands against a two-camp-razed
  // save — because the defect only shows when there is more to absorb than the hold has
  // room for. Both halves are asserted: the ceiling holds, and the overflow survives.
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  const before = await page.evaluate(({ x, y, cw, ceilMul, size, tier }) => {
    const w = window.__g.scene;
    // Two camps already down; c3 is the one this raid will raze.
    for (const id of ['c1', 'c2']) w.save.camps.find(c => c.id === id).razed = true;
    // A pre-scouted hold of a KNOWN weight, so what the ceiling leaves room for is
    // arithmetic rather than a roll. All one body type on both sides, because fighting
    // weight is exactly linear in body count within a type and the reader can then check
    // the absorption by counting.
    w.save.camps.find(c => c.id === 'strong').garrison = Array.from({ length: 6 }, () => 'bandit');
    // Six bands already homed on the hold, as razing their own camps would have left them.
    w.parties.length = 0;
    for (let i = 0; i < 6; i++) {
      w.parties.push({
        camp: 'strong', x: 900 + i * 40, y: 900, vx: 0, vy: 0, facing: 0, bob: 0,
        comp: ['bandit', 'bandit'],
        home: { x, y }, wander: null, wanderT: 0, waryT: 0, clashT: 0,
        occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
        _navGoalVisibility: new Float64Array(w.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
      });
    }
    w.persistParties();
    return {
      parties: w.save.parties.length,
      // The ceiling the absorption must respect, read off the production seams rather
      // than restated: the same expression rollGarrison targets, times the constant.
      ceiling: Math.max(size * cw, w.encounterBase() * tier) * ceilMul,
    };
  }, {
    x: STRONGHOLD.x, y: STRONGHOLD.y,
    cw: BALANCE.campWeightPerSize, ceilMul: BALANCE.strongholdRemnantCeiling,
    size: STRONGHOLD.size, tier: STRONGHOLD.tier,
  });
  expect(before.parties).toBe(6);

  // Raze c3 through the production path: site menu row -> brief -> forced victory.
  await page.evaluate(({ x, y }) => {
    const w = window.__g.scene;
    w.hero.x = x; w.hero.y = y; w.grace = 0;
  }, { x: C('c3').x, y: C('c3').y });
  await tickSiteRow(page, 'raid');
  await tickAction(page, 'confirm');
  await page.evaluate(() => {
    if (window.__g.sceneName !== 'battle') throw new Error('the raid brief did not start a battle');
    window.__g.scene.endBattle(true);
  });
  await page.evaluate(() => { window.__tick(3); });
  await tickAction(page, 'confirm'); // dismiss the aftermath

  const after = await page.evaluate(() => {
    const w = window.__g.scene;
    return {
      razed: w.save.camps.filter(c => c.razed && c.id !== 'strong').length,
      garrison: (w.save.camps.find(c => c.id === 'strong').garrison || []).slice(),
      partiesLeft: (w.save.parties || []).filter(p => p.camp === 'strong').length,
      toast: w.msg,
    };
  });
  expect(after.razed).toBe(3);
  // The hold IS reinforced — the mechanic still has teeth...
  expect(after.garrison.length).toBeGreaterThan(6);
  expect(after.partiesLeft).toBeLessThan(6);
  // ...but never past its own stage-priced ceiling.
  expect(enemyStrength(after.garrison),
    `the hold absorbed past its ceiling: ${enemyStrength(after.garrison).toFixed(2)} > ${before.ceiling.toFixed(2)}`)
    .toBeLessThanOrEqual(before.ceiling);
  // ...and the bands it had no room for are still out there, not deleted with the camp.
  expect(after.partiesLeft).toBeGreaterThan(0);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the hold rides at the March even when the player holds nothing, and never seizes the last settlement', async ({ page }) => {
  // Plan 039. Two defects kept the entire regional layer from ever firing, and both are
  // asserted here because each alone was enough to make it dead code:
  //
  //   1. `updateRegionalPressure` only ever targeted PLAYER-HELD settlements, so a player
  //      who claimed nothing was exempt. Two of the campaign harness's four policies claim
  //      nothing by construction.
  //   2. `raidCdT` was armed in the World constructor, and a World is rebuilt on every
  //      return from a battle — so the 110-second first delay restarted after every fight.
  //      A player who fought at all was never raided either.
  //
  // Measured across 60 scripted campaigns before the fix: `raidsLanded` was zero for every
  // policy. This drives the world with no claims and no battles at all, which is the case
  // that used to produce nothing.
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  const out = await page.evaluate(({ firstDelayT }) => {
    const w = window.__g.scene;
    w.parties.length = 0;          // isolate: only the hold's own dispatch may appear
    w.hero.x = 700; w.hero.y = 1800; // far from every settlement, so nothing becomes a defense
    window.game.keepAwake(true);
    const seen = { dispatchedAt: null, target: null, seizedAt: null };
    for (let i = 0; i < 60 * (firstDelayT + 120); i++) {
      window.__tick(1 / 60);
      if (window.__g.sceneName !== 'world') break;
      const riding = w.parties.find(p => p.raidKind === 'regional' && p.raid);
      if (riding && seen.dispatchedAt == null) {
        seen.dispatchedAt = Math.round(w.time);
        seen.target = riding.raid;
      }
      const occupied = w.save.settlements.filter(s => s.occupied);
      if (occupied.length && seen.seizedAt == null) seen.seizedAt = Math.round(w.time);
    }
    seen.owned = w.save.settlements.filter(s => s.owner === 'player').length;
    seen.occupied = w.save.settlements.filter(s => s.occupied).map(s => s.id);
    seen.unclaimed = w.save.settlements.filter(s =>
      !s.occupied && !w.parties.some(p => p.raid === s.id || p.occupying === s.id)).length;
    seen.riding = w.parties.filter(p => p.raidKind === 'regional' && p.raid).length;
    return seen;
  }, { firstDelayT: RAID.firstDelayT });

  expect(out.owned, 'the fixture must hold nothing — that is the case that used to be exempt').toBe(0);
  expect(out.dispatchedAt, 'the hold never rode out at all').not.toBeNull();
  // It rides on the documented cadence, not immediately: a fresh campaign still gets its
  // quiet opening (the conservative-defaults rule the constructor comment states).
  expect(out.dispatchedAt).toBeGreaterThanOrEqual(RAID.firstDelayT);
  expect(WORLD.settlements.some(s => s.id === out.target)).toBe(true);
  expect(out.seizedAt, 'the raid rode out but never arrived').not.toBeNull();
  expect(out.occupied.length).toBeGreaterThan(0);
  // The break-off floor rule, reused verbatim: a seizure never takes the last unclaimed
  // settlement, so the player always has somewhere to go.
  expect(out.unclaimed, 'the hold seized every settlement').toBeGreaterThanOrEqual(1);
  // And only one rides at a time.
  expect(out.riding).toBeLessThanOrEqual(1);
  assertNoRuntimeErrors(runtimeErrors);
});

test('the raid cadence is a campaign clock, not a per-battle one', async ({ page }) => {
  // The second half of the defect above, isolated. A World is rebuilt on every return from
  // a battle; before Plan 039 that re-armed `raidCdT` to RAID.firstDelayT, so a campaign
  // that fought regularly reset the stronghold's patience every time and the raid never
  // came. The clock now rides across the fight on `game.pendingRaidCdT` — the same
  // Game-level handoff `pendingAftermath` and `pendingSpecChoice` use, so it costs no save
  // field. A genuine RELOAD still re-arms, which is the behaviour the constructor's
  // conservative-defaults comment asks for and which this pins from both sides.
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  const out = await page.evaluate(() => {
    const g = window.__g;
    window.game.keepAwake(true);
    const before = g.scene.raidCdT;
    for (let i = 0; i < 60 * 30; i++) window.__tick(1 / 60);   // 30 flowing seconds
    const spent = g.scene.raidCdT;
    // A battle, driven through the production seam, and back to a fresh World.
    g.scene.startBattle(['bandit'], 'RAID CLOCK', null);
    g.scene.endBattle(true);
    window.__tick(3);
    const afterBattle = g.scene.raidCdT;
    // A reload is a different thing: a World built with no save carries nothing over.
    g.startWorld(null);
    const afterReload = g.scene.raidCdT;
    return { before, spent, afterBattle, afterReload, scene: g.sceneName };
  });
  expect(out.scene).toBe('world');
  expect(out.spent).toBeLessThan(out.before - 25);           // the clock really ran down
  expect(out.afterBattle, 'a battle re-armed the stronghold\'s patience')
    .toBeCloseTo(out.spent, 1);
  expect(out.afterReload, 'a reload must still open quiet').toBe(RAID.firstDelayT);
  assertNoRuntimeErrors(runtimeErrors);
});

test('stronghold power states materially change the final battle', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);

  // One helper, three states: fixture the save, press the assault, confirm, and read
  // the fight the player actually faces.
  async function assault(fixture) {
    await openWorld(page);
    await page.evaluate(({ x, y, fixture }) => {
      const w = window.__g.scene;
      if (fixture.owned) {
        for (const id of fixture.owned) w.save.settlements.find(s => s.id === id).owner = 'player';
        w.save.stats.captures = fixture.owned.length;
      }
      if (fixture.razed) for (const id of fixture.razed) w.save.camps.find(c => c.id === id).razed = true;
      // Pre-scout the hold so the garrison is a KNOWN 10 bandits — the Exposed
      // thinning must then be measurable against it.
      w.save.camps.find(c => c.id === 'strong').garrison = Array.from({ length: 10 }, () => 'bandit');
      w.parties.length = 0;
      w.hero.x = x; w.hero.y = y;
      w.grace = 0;
    }, { x: STRONGHOLD.x, y: STRONGHOLD.y, fixture });
    await tickSiteRow(page, 'storm');
    const brief = await page.evaluate(() => {
      const w = window.__g.scene;
      const d = w.pending && w.pending.descriptor;
      return {
        kind: w.screen && w.screen.kind,
        subtitle: w.screen && w.screen.subtitle,
        guards: d && d.objective.guards,
        mods: d && d.stronghold && d.stronghold.mods,
      };
    });
    expect(brief.kind).toBe('brief');
    await tickAction(page, 'confirm');
    const battle = await page.evaluate(() => {
      const b = window.__g.scene;
      if (window.__g.sceneName !== 'battle') throw new Error('confirming the stronghold brief did not start a battle');
      return {
        enemies: b.enemies.length,
        guards: b.objectiveTargets.length,
        waves: b.pendingWaves ? b.pendingWaves.length : 0,
      };
    });
    return { brief, battle };
  }

  // Entrenched: full garrison, three guards, one reserve wave.
  const entrenched = await assault({});
  expect(entrenched.brief.subtitle).toContain('ENTRENCHED');
  expect(entrenched.brief.mods.waves).toBe(1);
  expect(entrenched.battle).toEqual({ enemies: 10, guards: 3, waves: 1 });

  // WEAKENED by two captures: the reserve is committed elsewhere, garrison intact.
  const weakened = await assault({ owned: ['ashford', 'brindle'] });
  expect(weakened.brief.subtitle).toContain('WEAKENED');
  expect(weakened.brief.mods.waves).toBe(0);
  expect(weakened.battle).toEqual({ enemies: 10, guards: 3, waves: 0 });

  // EXPOSED: every point earned — thinned starting garrison, two guards (the floor
  // after all three linked camps fell), no wave.
  const exposed = await assault({
    owned: WORLD.settlements.map(s => s.id),
    razed: REGION.linkedCamps,
  });
  expect(exposed.brief.subtitle).toContain('EXPOSED');
  expect(exposed.battle.guards).toBe(2);
  expect(exposed.battle.waves).toBe(0);
  expect(exposed.battle.enemies).toBe(Math.max(2, Math.round(10 * 0.55)));
  assertNoRuntimeErrors(runtimeErrors);
});

test('the final stronghold victory ends the campaign with the regional summary counters', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openWorld(page);
  await page.evaluate(({ x, y }) => {
    const w = window.__g.scene;
    for (const s of w.save.settlements) s.owner = 'player';
    w.save.settlements.find(s => s.id === 'ashford').spec = 'barracks';
    w.save.settlements.find(s => s.id === 'coldwell').spec = 'watchtower';
    w.save.stats.captures = 4;
    for (const id of ['c1', 'c2', 'c3']) w.save.camps.find(c => c.id === id).razed = true;
    w.save.camps.find(c => c.id === 'strong').garrison = Array.from({ length: 6 }, () => 'bandit');
    w.save.stats.won = 8;
    w.save.stats.kills = 64;
    w.save.stats.lost = 11;
    w.save.stats.playT = 1800;
    w.save.stats.battlesLost = 2;
    w.save.stats.goldEarned = 700;
    w.save.stats.goldSpent = 520;
    w.save.gold = 180;
    w.parties.length = 0;
    w.hero.x = x; w.hero.y = y;
    w.grace = 0;
  }, { x: STRONGHOLD.x, y: STRONGHOLD.y });
  await tickSiteRow(page, 'storm');
  await tickAction(page, 'confirm');
  await page.evaluate(() => {
    if (window.__g.sceneName !== 'battle') throw new Error('confirming the stronghold brief did not start a battle');
    window.__g.scene.endBattle(true);
  });
  // save.won redirects the returning World's first tick into the victory scene —
  // no aftermath, and the summary IS the restart flow.
  await page.evaluate(() => { window.__tick(3.2); });
  const summary = await page.evaluate(async () => {
    await window.__g.saves.flush();
    return {
      scene: window.game.state().scene,
      summary: window.game.state().summary,
      runCleared: localStorage.getItem('bf_save_test') === null,
    };
  });
  expect(summary.scene).toBe('victory');
  const m = summary.summary;
  expect(m.kind).toBe('summary');
  expect(m.battlesWon).toBe(9); // the stronghold win itself is counted
  expect(m.battlesLost).toBe(2);
  expect(m.captured).toBe(4);
  expect(m.held).toBe(4);
  expect(m.totalSettlements).toBe(WORLD.settlements.length);
  expect(m.campsRazed).toBe(3);
  expect(m.foesSlain).toBe(64);
  expect(m.soldiersLost).toBe(11);
  // The pre-scouted 6-bandit hold thins to 3 under EXPOSED; the win pays the
  // stronghold's 200g razed bonus plus loot for the three bandits that deployed, and both
  // land in goldEarned as well as the purse. Plan 038: loot is per body TYPE, so the
  // figure comes from lootFor() rather than from a restated headcount formula.
  const winnings = 200 + lootFor(['bandit', 'bandit', 'bandit']);
  expect(m.goldEarned).toBe(700 + winnings);
  expect(m.finalGold).toBe(180 + winnings);
  expect(m.specs).toEqual(['Ashford: Barracks', 'Coldwell: Watchtower']);
  expect(summary.runCleared).toBe(true); // the campaign is over; Enter starts fresh
  assertNoRuntimeErrors(runtimeErrors);
});
