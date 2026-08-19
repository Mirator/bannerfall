import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';
import { WORLD } from '../../src/data.js';

const DT = 1 / 60;
const PARTY_KEY = 'c1';
const PARTY_HOME = { x: 1600, y: 900 };
const PARTY_COMP = ['bandit', 'bandit', 'raider'];
const OCCUPY_SETTLEMENT = WORLD.settlements.find(s => s.id === 'ashford');

function assertNoRuntimeErrors(runtimeErrors) {
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
}

async function openPlayerGame(page, runtimeErrors) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.addInitScript(() => {
    if (sessionStorage.getItem('qa-clear-campaign') !== '1') {
      localStorage.removeItem('bf_save');
      localStorage.removeItem('bf_save_test');
      sessionStorage.setItem('qa-clear-campaign', '1');
    }
  });
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => { window.__g.testMode = false; });
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('menu');
  assertNoRuntimeErrors(runtimeErrors);
}

async function startRawWorld(page, { seed = 12345, hard = false } = {}) {
  await page.evaluate(({ seed: worldSeed, hard: hardMode }) => {
    window.__g.testSeed = worldSeed;
    window.__g.hardNext = hardMode;
    window.__g.startWorld(null);
  }, { seed, hard });
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('world');
}

async function rawStep(page, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30) {
    throw new Error(`rawStep seconds must be between 0 and 30, got ${seconds}`);
  }
  const steps = Math.ceil(seconds / DT);
  await page.evaluate((count) => {
    for (let i = 0; i < count; i++) window.__g.update(1 / 60);
    window.__g.draw();
  }, steps);
}

// Plan 021: every map-initiated fight now opens a pre-battle brief first (a world-scene
// modal — sceneName stays 'world') instead of committing straight to battle. Confirming
// it (Enter, bound to ACTIONS.CONFIRM) is the one extra step every raw collision fixture
// in this file needs to reach the same battle-entry point it relied on before this plan.
async function confirmBrief(page) {
  await expect.poll(() => page.evaluate(() =>
    window.__g.sceneName === 'world' && !!(window.__g.scene.screen && window.__g.scene.screen.kind === 'brief'),
  )).toBe(true);
  await page.evaluate(() => {
    window.__g.input.injectKey('Enter', true);
    window.__g.update(1 / 60);
    window.__g.input.injectKey('Enter', false);
    window.__g.draw();
  });
}

async function installUniqueParty(page, { camp = PARTY_KEY, comp = PARTY_COMP } = {}) {
  await page.evaluate(({ partyCamp, partyComp, home }) => {
    const world = window.__g.scene;
    world.parties = [{
      camp: partyCamp,
      x: home.x,
      y: home.y,
      vx: 0,
      vy: 0,
      facing: 0,
      bob: 0,
      comp: [...partyComp],
      home: { ...home },
      wander: { ...home },
      wanderT: 999,
      waryT: 0,
    }];
    world.hero.x = home.x;
    world.hero.y = home.y;
    world.hero.vx = 0;
    world.hero.vy = 0;
    world.grace = 0;
  }, { partyCamp: camp, partyComp: comp, home: PARTY_HOME });
  await rawStep(page, DT);
  await confirmBrief(page);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('battle');
}

async function injectKeyAndStep(page, code) {
  await page.evaluate((keyCode) => {
    window.__g.input.injectKey(keyCode, true);
    window.__g.update(1 / 60);
    window.__g.input.injectKey(keyCode, false);
    window.__g.draw();
  }, code);
}

// Plan 021: battle end now opens an aftermath modal (also a world-scene screen) before
// play resumes. Every fixture that ends a battle and then wants the world simulation to
// actually keep running (a further collision, grace decay, …) must dismiss it first.
async function dismissAftermath(page) {
  await expect.poll(() => page.evaluate(() =>
    window.__g.sceneName === 'world' && !!(window.__g.scene.screen && window.__g.scene.screen.kind === 'aftermath'),
  )).toBe(true);
  await page.evaluate(() => {
    window.__g.input.injectKey('Enter', true);
    window.__g.update(1 / 60);
    window.__g.input.injectKey('Enter', false);
    window.__g.draw();
  });
}

async function battleResult(page, action) {
  await page.evaluate(actionName => {
    const battle = window.__g.scene;
    if (!battle || window.__g.sceneName !== 'battle') throw new Error(`expected battle before ${actionName}`);
    if (actionName === 'victory') battle.endBattle(true);
    else if (actionName === 'retreat') battle.endBattle(false, true);
    else throw new Error(`unknown battle result ${actionName}`);
  }, action);
  await rawStep(page, 3.2);
}

test('current-schema player save round-trips through Continue', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 901 });

  await page.evaluate(async ({ partyCamp, home }) => {
    const world = window.__g.scene;
    const save = world.save;
    save.gold = 731;
    save.heroHp = 87;
    save.heroMaxHp = 140;
    save.hard = true;
    save.stats = { won: 2, kills: 19, lost: 3, playT: 47 };
    save.troops = [{ type: 'spear' }, { type: 'archer' }, { type: 'knight' }];
    world.hero.x = 1711;
    world.hero.y = 944;
    save.x = world.hero.x;
    save.y = world.hero.y;
    world.parties = [{
      camp: partyCamp,
      x: 1811,
      y: 984,
      comp: ['bandit', 'wolf'],
      home: { ...home },
      waryT: 8,
    }];
    world.persistParties();
    window.__g.persistRun();
    await window.__g.saves.flush();
  }, { partyCamp: 'c1', home: PARTY_HOME });

  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__g.sceneName === 'world');

  const restored = await page.evaluate(() => {
    const save = window.__g.scene.save;
    return {
      gold: save.gold,
      heroHp: save.heroHp,
      heroMaxHp: save.heroMaxHp,
      hard: save.hard,
      stats: save.stats,
      troops: save.troops.map(t => t.type),
      hero: { x: window.__g.scene.hero.x, y: window.__g.scene.hero.y },
      parties: save.parties.map(p => ({ camp: p.camp, x: p.x, y: p.y, comp: p.comp, waryT: p.waryT })),
      version: save.version,
      storedVersion: JSON.parse(localStorage.getItem('bf_save')).version,
    };
  });
  expect(restored).toEqual({
    gold: 731,
    heroHp: 87,
    heroMaxHp: 140,
    hard: true,
    stats: { won: 2, kills: 19, lost: 3, playT: expect.any(Number) },
    troops: ['spear', 'archer', 'knight'],
    hero: { x: 1711, y: 944 },
    parties: [{ camp: 'c1', x: 1811, y: 984, comp: ['bandit', 'wolf'], waryT: 8 }],
    version: 3,
    storedVersion: 3,
  });
  expect(restored.stats.playT).toBeGreaterThanOrEqual(47);
  assertNoRuntimeErrors(runtimeErrors);
});

test('retreat restores the engaged party minus actual dead enemy types', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 902 });
  await installUniqueParty(page);

  await page.evaluate(() => {
    const battle = window.__g.scene;
    const killed = battle.enemies.find(enemy => enemy.type === 'bandit');
    if (!killed) throw new Error('fixture setup: expected a bandit to kill');
    battle.damageEnemy(killed, killed.hp + 1, 0, 0, 'qa');
    if (!battle.deadEnemyTypes.includes('bandit')) throw new Error('fixture setup: deadEnemyTypes did not record bandit');
    battle.endBattle(false, true);
  });
  await rawStep(page, 3.2);

  const party = await page.evaluate(() => {
    if (window.__g.sceneName !== 'world') throw new Error('fixture setup: retreat did not return to world');
    return window.__g.scene.parties.filter(p => p.camp === 'c1')
      .map(p => ({ camp: p.camp, comp: [...p.comp].sort() }));
  });
  expect(party).toEqual([{ camp: PARTY_KEY, comp: ['bandit', 'raider'] }]);
  assertNoRuntimeErrors(runtimeErrors);
});

test('hard-mode defeat retains exactly one fallback squire', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 903, hard: true });
  await installUniqueParty(page, { comp: ['bandit'] });

  await page.evaluate(() => {
    const battle = window.__g.scene;
    battle.troops = [];
    battle.damageFriendly(battle.hero, true, battle.hero.hp + 1, {
      type: 'bandit', x: battle.hero.x, y: battle.hero.y,
    });
  });
  await rawStep(page, 3.2);

  const result = await page.evaluate(() => ({
    scene: window.__g.sceneName,
    hard: window.__g.scene.save.hard,
    troops: window.__g.scene.save.troops.map(t => t.type),
  }));
  expect(result).toEqual({ scene: 'world', hard: true, troops: ['spear'] });
  assertNoRuntimeErrors(runtimeErrors);
});

test('final stronghold victory enters the victory scene and clears the run save', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 904 });

  await page.evaluate(() => {
    const world = window.__g.scene;
    for (const camp of world.save.camps) camp.razed = camp.id !== 'strong';
    world.save.camps.find(camp => camp.id === 'strong').garrison = ['bandit'];
    world.parties.length = 0;
    world.persistParties();
    world.hero.x = 2800;
    world.hero.y = 600;
    world.save.x = world.hero.x;
    world.save.y = world.hero.y;
  });
  await injectKeyAndStep(page, 'KeyE');
  await confirmBrief(page);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('battle');
  await page.evaluate(() => window.__g.scene.endBattle(true));
  await rawStep(page, 3.2);

  const result = await page.evaluate(() => ({
    scene: window.__g.sceneName,
    won: window.__g.finalSave && window.__g.finalSave.won,
    realSave: localStorage.getItem('bf_save'),
  }));
  expect(result).toEqual({ scene: 'victory', won: true, realSave: null });
  assertNoRuntimeErrors(runtimeErrors);
});

test('AUDIT-02 autosave captures live hero and roaming-party positions', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 905 });
  const explicitLive = await page.evaluate(async ({ partyCamp, home }) => {
    const world = window.__g.scene;
    world.hero.x = 1400;
    world.hero.y = 700;
    world.parties = [{
      camp: partyCamp, x: 1875, y: 1005, vx: 0, vy: 0, comp: ['bandit'], home: { ...home },
      wander: { ...home }, wanderT: 999, waryT: 0,
    }];
    window.__g.persistRun();
    await window.__g.saves.flush();
    return { hero: { x: world.hero.x, y: world.hero.y }, party: { x: 1875, y: 1005 } };
  }, { partyCamp: PARTY_KEY, home: PARTY_HOME });
  const explicitStored = await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('bf_save'));
    return { hero: { x: save.x, y: save.y }, party: { x: save.parties[0].x, y: save.parties[0].y } };
  });
  expect(explicitStored).toEqual(explicitLive);

  await page.evaluate(({ partyCamp }) => {
    const world = window.__g.scene;
    world.hero.x = 1500;
    world.hero.y = 700;
    world.parties[0].camp = partyCamp;
    world.parties[0].x = 1900;
    world.parties[0].y = 1020;
    world.parties[0].home = { x: 1900, y: 1020 };
    world.parties[0].wander = { x: 1900, y: 1020 };
    world.parties[0].wanderT = 999;
    window.__g.saveTimer = 0;
  }, { partyCamp: PARTY_KEY });
  await rawStep(page, 4.01);
  const timedLive = await page.evaluate(() => {
    const world = window.__g.scene;
    return {
      hero: { x: world.hero.x, y: world.hero.y },
      party: { x: world.parties[0].x, y: world.parties[0].y },
    };
  });
  const timedStored = await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('bf_save'));
    return { hero: { x: save.x, y: save.y }, party: { x: save.parties[0].x, y: save.parties[0].y } };
  });
  expect(timedStored.hero).toEqual(timedLive.hero);
  expect(timedStored.party.x).toBeCloseTo(timedLive.party.x, 9);
  expect(timedStored.party.y).toBeCloseTo(timedLive.party.y, 9);

  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__g.sceneName === 'world');
  const restored = await page.evaluate(() => {
    const world = window.__g.scene;
    return {
      hero: { x: world.hero.x, y: world.hero.y },
      party: { x: world.save.parties[0].x, y: world.save.parties[0].y },
    };
  });
  assertNoRuntimeErrors(runtimeErrors);
  expect(restored.hero).toEqual(timedLive.hero);
  expect(restored.party.x).toBeCloseTo(timedLive.party.x, 9);
  expect(restored.party.y).toBeCloseTo(timedLive.party.y, 9);
});

test('AUDIT-05 battle entry persists a coherent transaction', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 906 });
  await installUniqueParty(page);
  const snapshot = await page.evaluate(() => {
    const save = window.__g._lastSave;
    const stored = JSON.parse(localStorage.getItem('bf_save'));
    return {
      scene: window.__g.sceneName,
      memory: {
        version: save.version,
        x: save.x,
        y: save.y,
        battleCount: save.battleCount,
        parties: save.parties.map(p => ({ camp: p.camp, x: p.x, y: p.y, comp: p.comp, home: p.home })),
      },
      stored,
    };
  });
  assertNoRuntimeErrors(runtimeErrors);
  expect(snapshot.scene).toBe('battle');
  expect(snapshot.memory.version).toBe(3);
  expect(snapshot.stored.version).toBe(snapshot.memory.version);
  expect(snapshot.stored.x).toBe(snapshot.memory.x);
  expect(snapshot.stored.y).toBe(snapshot.memory.y);
  expect(snapshot.stored.battleCount).toBe(snapshot.memory.battleCount);
  expect(snapshot.stored.parties).toEqual(snapshot.memory.parties);
  expect(snapshot.memory.parties).toEqual([]);

  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__g.sceneName === 'world');
  const restored = await page.evaluate(() => {
    const world = window.__g.scene;
    return {
      scene: window.__g.sceneName,
      version: world.save.version,
      hero: { x: world.hero.x, y: world.hero.y },
      battleCount: world.save.battleCount,
      parties: world.save.parties.map(p => ({ camp: p.camp, x: p.x, y: p.y, comp: p.comp, home: p.home })),
    };
  });
  expect(restored).toEqual({
    scene: 'world',
    version: snapshot.memory.version,
    hero: { x: snapshot.memory.x, y: snapshot.memory.y },
    battleCount: snapshot.memory.battleCount,
    parties: snapshot.memory.parties,
  });
  assertNoRuntimeErrors(runtimeErrors);
});

test('AUDIT-03 defeat restores the surviving roaming party', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 907 });
  await installUniqueParty(page);
  const encounter = await page.evaluate(() => {
    const battle = window.__g.scene;
    const save = window.__g._lastSave;
    const killed = battle.enemies.find(enemy => enemy.type === 'bandit');
    if (!killed) throw new Error('fixture setup: expected a bandit to kill');
    battle.damageEnemy(killed, killed.hp + 1, 0, 0, 'qa');
    battle.damageFriendly(battle.hero, true, battle.hero.hp + 1, {
      type: 'bandit', x: battle.hero.x, y: battle.hero.y,
    });
    return { x: save.x, y: save.y };
  });
  await rawStep(page, 3.2);
  const result = await page.evaluate(() => {
    if (window.__g.sceneName !== 'world') throw new Error('fixture setup: defeat did not return to world');
    const parties = window.__g.scene.parties.filter(p => p.camp === 'c1');
    return {
      parties: parties.map(p => ({
        camp: p.camp,
        comp: [...p.comp].sort(),
        home: p.home,
        position: { x: p.x, y: p.y },
      })),
      hero: { x: window.__g.scene.hero.x, y: window.__g.scene.hero.y },
    };
  });
  assertNoRuntimeErrors(runtimeErrors);
  expect(result.parties).toEqual([{
    camp: PARTY_KEY,
    comp: ['bandit', 'raider'],
    home: PARTY_HOME,
    position: expect.any(Object),
  }]);
  const restoredPosition = result.parties[0].position;
  expect(Math.hypot(restoredPosition.x - encounter.x, restoredPosition.y - encounter.y)).toBeLessThan(60);
  expect(result.hero).not.toEqual(encounter);
});

test('post-battle ambush grace does not block the player from charging into a party', async ({ page }) => {
  // Regression for: running over a bandit party right after finishing any fight did
  // nothing at all — world.grace (meant only to stop OTHER parties chasing you) used
  // to gate the collision check itself, silently blocking player-initiated clashes too.
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 909 });
  await installUniqueParty(page);
  await page.evaluate(() => window.__g.scene.endBattle(false, true)); // retreat
  await rawStep(page, 3.2);
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('world');
  await dismissAftermath(page); // Plan 021: must close before any further world tick runs

  const grace = await page.evaluate(() => window.__g.scene.grace);
  expect(grace).toBeGreaterThan(0); // still inside the post-battle ambush-immunity window

  // an unrelated party dropped right on the hero must still be attackable during that window
  await page.evaluate(() => {
    const world = window.__g.scene;
    world.parties.push({
      camp: 'c2', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit'], home: { x: world.hero.x, y: world.hero.y },
      wander: null, wanderT: 999, waryT: 0, clashT: 0,
    });
  });
  await rawStep(page, DT);
  await confirmBrief(page);
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('battle');
  assertNoRuntimeErrors(runtimeErrors);
});

test('retreat leaves the fled-from party uncatchable until its own cooldown clears', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 910 });
  await installUniqueParty(page);
  await page.evaluate(() => window.__g.scene.endBattle(false, true)); // retreat
  await rawStep(page, 3.2);
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('world');
  await dismissAftermath(page); // Plan 021: must close before any further world tick runs

  const restored = await page.evaluate(() => {
    const world = window.__g.scene;
    const p = world.parties.find(party => party.camp === 'c1');
    return {
      clashT: p.clashT,
      overlapsHero: Math.hypot(p.x - world.hero.x, p.y - world.hero.y) < 46,
    };
  });
  expect(restored.clashT).toBeGreaterThan(0);
  expect(restored.overlapsHero).toBe(true);

  // still standing on the same party it fled from: must not force an instant rematch
  await rawStep(page, DT);
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('world');

  // once that party's own cooldown clears, the same collision is attackable again
  await page.evaluate(() => {
    window.__g.scene.parties.find(p => p.camp === 'c1').clashT = 0;
  });
  await rawStep(page, DT);
  await confirmBrief(page);
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('battle');
  assertNoRuntimeErrors(runtimeErrors);
});

test('AUDIT-03 fully defeated roaming parties stay removed', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 908, hard: true });
  await installUniqueParty(page, { comp: ['bandit'] });
  await page.evaluate(() => {
    const battle = window.__g.scene;
    const enemy = battle.enemies.find(candidate => candidate.type === 'bandit');
    if (!enemy) throw new Error('fixture setup: expected a bandit enemy');
    battle.damageEnemy(enemy, enemy.hp + 1, 0, 0, 'qa');
    battle.damageFriendly(battle.hero, true, battle.hero.hp + 1, {
      type: 'bandit', x: battle.hero.x, y: battle.hero.y,
    });
  });
  await rawStep(page, 3.2);
  const parties = await page.evaluate(() => {
    if (window.__g.sceneName !== 'world') throw new Error('fixture setup: defeat did not return to world');
    return window.__g.scene.parties.filter(p => p.camp === PARTY_KEY);
  });
  assertNoRuntimeErrors(runtimeErrors);
  expect(parties).toEqual([]);
});

test('an occupied settlement and its occupier survive an explicit save and Continue, service still suspended', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 911 });

  await page.evaluate(async ({ settlementId, sx, sy }) => {
    const world = window.__g.scene;
    world.save.settlements = world.save.settlements.map(s => ({ id: s.id, occupied: s.id === settlementId }));
    world.parties = [{
      camp: 'c1', x: sx, y: sy, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit'], home: { x: sx, y: sy }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: settlementId, raid: null,
    }];
    world.persistParties();
    window.__g.persistRun();
    await window.__g.saves.flush();
  }, { settlementId: OCCUPY_SETTLEMENT.id, sx: OCCUPY_SETTLEMENT.x, sy: OCCUPY_SETTLEMENT.y });

  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__g.sceneName === 'world');

  const restored = await page.evaluate((settlementId) => {
    const world = window.__g.scene;
    const st = world.save.settlements.find(s => s.id === settlementId);
    const party = world.parties.find(p => p.occupying === settlementId);
    return { occupied: st && st.occupied, hasOccupier: !!party };
  }, OCCUPY_SETTLEMENT.id);
  expect(restored).toEqual({ occupied: true, hasOccupier: true });

  // Standing near the settlement (but not overlapping the occupier, so no clash starts)
  // must still refuse recruiting after the reload, not just before it.
  const goldBefore = await page.evaluate(() => window.__g.scene.save.gold);
  await page.evaluate(({ sx, sy }) => {
    const world = window.__g.scene;
    world.hero.x = sx + 80; world.hero.y = sy;
  }, { sx: OCCUPY_SETTLEMENT.x, sy: OCCUPY_SETTLEMENT.y });
  await page.evaluate(() => {
    window.__g.input.injectKey('KeyQ', true);
    window.__g.scene.updateSettlementInteractions(window.__g.input);
    window.__g.input.injectKey('KeyQ', false);
  });
  const goldAfter = await page.evaluate(() => window.__g.scene.save.gold);
  expect(goldAfter).toBe(goldBefore);
  assertNoRuntimeErrors(runtimeErrors);
});

test('recapturing an occupied settlement survives an explicit save and Continue', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openPlayerGame(page, runtimeErrors);
  await startRawWorld(page, { seed: 912 });

  await page.evaluate(({ settlementId, sx, sy }) => {
    const world = window.__g.scene;
    world.save.settlements = world.save.settlements.map(s => ({ id: s.id, occupied: s.id === settlementId }));
    world.parties = [{
      camp: 'c1', x: sx, y: sy, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: ['bandit'], home: { x: sx, y: sy }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: settlementId, raid: null,
    }];
    world.hero.x = sx; world.hero.y = sy;
    world.hero.vx = 0; world.hero.vy = 0;
    world.grace = 0;
  }, { settlementId: OCCUPY_SETTLEMENT.id, sx: OCCUPY_SETTLEMENT.x, sy: OCCUPY_SETTLEMENT.y });
  await rawStep(page, DT);
  await confirmBrief(page);
  await expect.poll(() => page.evaluate(() => window.__g.sceneName)).toBe('battle');

  await page.evaluate(() => window.__g.scene.endBattle(true));
  await rawStep(page, 3.2);
  expect(await page.evaluate(() => window.__g.sceneName)).toBe('world');
  const occupiedRightAfter = await page.evaluate(
    (id) => window.__g.scene.save.settlements.find(s => s.id === id).occupied, OCCUPY_SETTLEMENT.id);
  expect(occupiedRightAfter).toBe(false);

  await page.evaluate(async () => { window.__g.persistRun(); await window.__g.saves.flush(); });
  await page.reload();
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.keyboard.press('c');
  await page.waitForFunction(() => window.__g.sceneName === 'world');
  const restoredOccupied = await page.evaluate(
    (id) => window.__g.scene.save.settlements.find(s => s.id === id).occupied, OCCUPY_SETTLEMENT.id);
  expect(restoredOccupied).toBe(false);
  assertNoRuntimeErrors(runtimeErrors);
});
