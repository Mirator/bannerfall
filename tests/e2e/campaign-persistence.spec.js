import { test, expect } from '@playwright/test';
import { collectRuntimeErrors } from './test-helpers.js';

const DT = 1 / 60;
const PARTY_KEY = 'c1';
const PARTY_HOME = { x: 1600, y: 900 };
const PARTY_COMP = ['bandit', 'bandit', 'raider'];

function assertNoRuntimeErrors(runtimeErrors) {
  expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
}

async function openPlayerGame(page, runtimeErrors) {
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  await page.evaluate(() => {
    localStorage.removeItem('bf_save');
    localStorage.removeItem('bf_save_test');
    window.__g.testMode = false;
  });
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

  await page.evaluate(({ partyCamp, home }) => {
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
    version: 1,
    storedVersion: 1,
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
  const explicitLive = await page.evaluate(({ partyCamp, home }) => {
    const world = window.__g.scene;
    world.hero.x = 1400;
    world.hero.y = 700;
    world.parties = [{
      camp: partyCamp, x: 1875, y: 1005, vx: 0, vy: 0, comp: ['bandit'], home: { ...home },
      wander: { ...home }, wanderT: 999, waryT: 0,
    }];
    window.__g.persistRun();
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
  expect(snapshot.memory.version).toBe(1);
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
