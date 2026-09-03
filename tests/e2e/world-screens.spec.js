import { test, expect } from '@playwright/test';
import { collectRuntimeErrors, bootToMenu as boot } from './test-helpers.js';
import { BALANCE, WORLD } from '../../src/data.js';

test('requesting a battle opens a brief without committing any map-side mutation', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 424242 });
    const world = window.__g.scene;
    const before = world.parties.length;
    const battleCountBefore = world.save.battleCount || 0;
    let target = null;
    for (const p of world.parties) { if (!world.inSafeZone(p.x, p.y)) { target = p; break; } }
    world.hero.x = target.x; world.hero.y = target.y; world.grace = 0;
    window.game.step(0.1); // one tick: enough for the collision to be detected
    return {
      scene: window.__g.sceneName,
      screenKind: world.screen && world.screen.kind,
      partiesLen: world.parties.length,
      before,
      battleCountAfter: world.save.battleCount || 0,
      battleCountBefore,
      partyPresent: world.parties.includes(target),
    };
  });
  expect(result.scene).toBe('world');
  expect(result.screenKind).toBe('brief');
  expect(result.partiesLen).toBe(result.before);
  expect(result.partyPresent).toBe(true);
  expect(result.battleCountAfter).toBe(result.battleCountBefore);
  expect(runtimeErrors).toEqual([]);
});

test('confirm persists exactly once while still world, after splicing, then enters battle', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 424242 });
    const g = window.__g, world = g.scene;
    let target = null;
    for (const p of world.parties) { if (!world.inSafeZone(p.x, p.y)) { target = p; break; } }
    world.hero.x = target.x; world.hero.y = target.y; world.grace = 0;
    window.game.step(0.1); // opens the brief
    let persistCalls = 0, partyPresentAtPersist = null, sceneAtPersist = null;
    const original = g.persistRun.bind(g);
    g.persistRun = () => {
      persistCalls++;
      partyPresentAtPersist = world.parties.includes(target);
      sceneAtPersist = g.sceneName;
      return original();
    };
    g.input.injectAction('confirm', true);
    g.update(1 / 60);
    g.input.injectAction('confirm', false);
    return { persistCalls, partyPresentAtPersist, sceneAtPersist, sceneAfter: g.sceneName };
  });
  expect(result.persistCalls).toBe(1);
  // AGENTS.md: finish all map-side mutations (encounter removal included) before the
  // single persistRun() call — the checkpoint it writes must not still show the party.
  expect(result.partyPresentAtPersist).toBe(false);
  expect(result.sceneAtPersist).toBe('world');
  expect(result.sceneAfter).toBe('battle');
  expect(runtimeErrors).toEqual([]);
});

test('withdraw keeps the party on the map, charged, and blocks an instant rematch', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate((battleGrace) => {
    window.game.scenario('world', { seed: 424242 });
    const g = window.__g, world = g.scene;
    // Away from every settlement's canClash-blocking safe zone (WORLD.heroStart itself
    // sits ~128px from Ashford, well inside BALANCE.settlementSafeR).
    world.hero.x = 1600; world.hero.y = 900;
    const mine = world.myStrength();
    world.parties.length = 0;
    const weak = {
      camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: Array.from({ length: Math.max(1, Math.round(mine * 0.4)) }, () => 'bandit'),
      home: { x: world.hero.x, y: world.hero.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    };
    world.parties.push(weak);
    world.grace = 0;
    // Plan 023: world time only flows while the hero rides, and this fixture parks the hero
    // on purpose. keepAwake() keeps the world simulating WITHOUT moving the hero, so the
    // clash classifies initiative exactly as it does mid-ride.
    window.game.keepAwake(true);
    g.update(1 / 60); // a weak party right on the hero flees -> caughtThem -> withdraw offered
    window.game.keepAwake(false);
    const canWithdraw = !!(world.screen && world.screen.canWithdraw);
    g.input.injectAction('withdraw', true);
    g.update(1 / 60);
    g.input.injectAction('withdraw', false);
    const afterWithdraw = {
      scene: g.sceneName, screenGone: !world.screen,
      partyPresent: world.parties.includes(weak), clashT: weak.clashT, waryT: weak.waryT,
    };
    // still standing on it the very next tick: must not force an instant rematch
    g.update(1 / 60);
    return { canWithdraw, afterWithdraw, screenAfterOneMoreTick: world.screen, battleGrace };
  }, BALANCE.battleGrace);
  expect(result.canWithdraw).toBe(true);
  expect(result.afterWithdraw.scene).toBe('world');
  expect(result.afterWithdraw.screenGone).toBe(true);
  expect(result.afterWithdraw.partyPresent).toBe(true);
  expect(result.afterWithdraw.clashT).toBeCloseTo(result.battleGrace, 5);
  expect(result.afterWithdraw.waryT).toBe(25);
  expect(result.screenAfterOneMoreTick).toBeNull();
  expect(runtimeErrors).toEqual([]);
});

// The settlement sanctuary is ONE radius, BALANCE.settlementSafeR: inside it the party AI
// stands its pursuit down (`engaged`) and no fight starts (`canClash`), both reading the same
// `inSafeZone` predicate. They used to disagree — canClash carried a 130px literal — so in the
// 130-260px annulus the AI wiped p.mood to null every tick while a clash still fired, and every
// fight there fell through to the ambushed/caughtThem both-false fallback: a plain BANDIT
// SKIRMISH whichever side had actually closed the distance. The 200px case is that annulus;
// before the radii were unified it opened a brief (title 'BANDIT SKIRMISH', ambush false, mood
// null), and it must now open nothing at all. The 320px case is the control: a fixture that
// could never clash anywhere would satisfy the first case for the wrong reason.
test('one sanctuary radius: no clash inside settlementSafeR, initiative still classified outside it', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const ashford = WORLD.settlements.find(s => s.id === 'ashford');
  const results = {};
  for (const off of [200, 320]) {
    // Fixture geometry, asserted rather than assumed: due south of Ashford is `off` from it
    // and clear of every OTHER settlement's safe radius, so `off` alone decides the case.
    const others = WORLD.settlements.filter(s => s.id !== 'ashford');
    const nearestOther = Math.min(...others.map(s => Math.hypot(ashford.x - s.x, ashford.y + off - s.y)));
    expect(nearestOther).toBeGreaterThan(BALANCE.settlementSafeR);
    // Read-then-act inside ONE evaluate (Plan 021 note 5): the page's own rAF loop keeps
    // ticking between calls, so a party placed in one call has already moved by the next.
    results[off] = await page.evaluate(({ sx, sy, off }) => {
      window.game.scenario('world', { seed: 424242 });
      const world = window.__g.scene;
      world.hero.x = sx; world.hero.y = sy + off;
      world.hero.vx = 0; world.hero.vy = 0;
      const mine = world.myStrength();
      world.parties.length = 0;
      const party = {
        camp: 'c1', x: world.hero.x, y: world.hero.y, vx: 0, vy: 0, facing: 0, bob: 0,
        // ~1.0x fighting weight — the band the bug was measured in, and worth intercepting,
        // so this party's mood is 'chase' wherever the AI is allowed to have one at all.
        comp: Array.from({ length: Math.max(1, Math.round(mine)) }, () => 'bandit'),
        home: { x: world.hero.x, y: world.hero.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
        occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
        _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
      };
      world.parties.push(party);
      world.grace = 0;
      // Plan 023: a frozen tick runs the encounter seam ONLY and never classifies initiative.
      // keepAwake() runs the party AI with the hero parked, so mood resolves exactly as it
      // does mid-ride — which is when a real clash always happens.
      window.game.keepAwake(true);
      let screenKind = null, dh1 = null;
      // The decisive tick is the first one, while the party is still standing on the hero;
      // with its mood stood down it then wanders off on its own. The rest of the second is
      // there to catch a fight that starts late rather than not at all.
      for (let i = 0; i < 60 && !screenKind; i++) {
        window.__g.update(1 / 60);
        screenKind = world.screen ? world.screen.kind : null;
        if (dh1 === null) dh1 = Math.round(Math.hypot(party.x - world.hero.x, party.y - world.hero.y));
      }
      window.game.keepAwake(false);
      return {
        heroSafe: world.inSafeZone(world.hero.x, world.hero.y),
        screenKind,
        mood: party.mood,
        dh1,
        partyPresent: world.parties.includes(party),
        title: world.pending ? world.pending.descriptor.title : null,
        ambush: world.pending ? world.pending.descriptor.ambush : null,
      };
    }, { sx: ashford.x, sy: ashford.y, off });
  }
  // 200px: the old annulus. The hero is in the safe zone, the party stands down, and the
  // sanctuary now covers the fight too — no brief, and the party is still there to fight
  // once the hero rides back out.
  expect(results[200].heroSafe).toBe(true);
  expect(results[200].mood).toBeNull();
  expect(results[200].dh1).toBeLessThan(46); // inside the clash shape on the tick it mattered
  expect(results[200].screenKind).toBeNull();
  expect(results[200].title).toBeNull();
  expect(results[200].partyPresent).toBe(true);
  // 320px: outside the sanctuary the same fixture fights, and initiative reads the chase
  // that actually happened instead of the both-false fallback.
  expect(results[320].heroSafe).toBe(false);
  expect(results[320].dh1).toBeLessThan(46);
  expect(results[320].mood).toBe('chase');
  expect(results[320].screenKind).toBe('brief');
  expect(results[320].title).toBe('AMBUSHED!');
  expect(results[320].ambush).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('withdraw is offered only for camp/stronghold assault and a fleeing party, never an ambush or a mutual skirmish', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const cases = ['campScouted', 'stronghold', 'partyFlee', 'ambush', 'party'];
  const results = {};
  for (const kind of cases) {
    results[kind] = await page.evaluate((k) => {
      window.game.scenario('world_brief', { kind: k, seed: 424242 });
      const world = window.__g.scene;
      const d = world.pending && world.pending.descriptor;
      return {
        screenKind: world.screen && world.screen.kind,
        canWithdraw: !!(world.screen && world.screen.canWithdraw),
        title: d && d.title,
        ambush: !!(d && d.ambush),
      };
    }, kind);
  }
  expect(results.campScouted).toEqual({ screenKind: 'brief', canWithdraw: true, title: 'RAID THE CAMP', ambush: false });
  expect(results.stronghold).toEqual({ screenKind: 'brief', canWithdraw: true, title: 'ASSAULT ON WOLFSJAW HOLD', ambush: false });
  expect(results.partyFlee).toEqual({ screenKind: 'brief', canWithdraw: true, title: 'RUN THEM DOWN!', ambush: false });
  expect(results.ambush).toEqual({ screenKind: 'brief', canWithdraw: false, title: 'AMBUSHED!', ambush: true });
  // Plan 036: 'party' rides the hero straight at a chasing party (see the world_brief
  // fixture in main.js) — mood alone used to read this as an ambush every time a party
  // worth fighting was worth chasing. Nothing guarded `.title`/`.ambush` before this;
  // only `canWithdraw` (false either way) was asserted, so the misclassification was
  // invisible here.
  expect(results.party).toEqual({ screenKind: 'brief', canWithdraw: false, title: 'BANDIT SKIRMISH', ambush: false });
  expect(runtimeErrors).toEqual([]);
});

// Plan 036: `tryClash()` used to classify initiative off `p.mood` alone — 'chase' meant
// AMBUSHED! even when the player rode the party down deliberately, because mood only
// ever recorded the party's INTENT to intercept, never who actually closed the distance.
// This test drives the hero with a REAL held movement input (not keepAwake, not a
// hand-set position) straight at a party worth chasing, so the fix has to read a genuine
// approach through production physics, not a fixture shortcut.
test('riding straight into a chasing party is a mutual skirmish, not an ambush', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world', { seed: 424242 });
    const g = window.__g, world = g.scene;
    // 1600,900 away from every settlement's canClash-blocking safe zone, same spot the
    // world_brief fixture uses. Approach from due NORTH (not east): Highmere sits at
    // 2050,1150, only ~250px off an eastward path's endpoint, inside its 260px
    // BALANCE.settlementSafeR — riding east into that radius flips `engaged` false
    // mid-approach and the party's mood back to null before the clash resolves, which
    // would test the wrong thing (a null-mood coincidence, not the closing-velocity
    // fix). Every settlement sits comfortably clear of a short run south from here.
    world.hero.x = 1600; world.hero.y = 900;
    const mine = world.myStrength();
    world.parties.length = 0;
    // 300px south, within the 430px detection radius, at 1.0x the hero's fighting
    // weight — the bug report's own measured band (0.8x-1.6x) all misread as an
    // ambush under the old rule. moveDown alone closes on it in a straight line, so
    // the hero's velocity has an unambiguous positive component toward the party.
    const per = world.strength(['bandit']);
    const comp = Array.from({ length: Math.max(1, Math.round(mine / per)) }, () => 'bandit');
    const party = {
      camp: 'c1', x: world.hero.x, y: world.hero.y + 300, vx: 0, vy: 0, facing: 0, bob: 0,
      comp, home: { x: world.hero.x, y: world.hero.y + 300 }, wander: null, wanderT: 999,
      waryT: 0, clashT: 0, occupying: null, raid: null, navT: 0, navGoal: null, navFor: null,
      _navGoalVisibility: new Float64Array(world.navNodes.length), _navGoalX: NaN, _navGoalY: NaN,
    };
    world.parties.push(party);
    world.grace = 0;
    window.game.action('moveDown', true);
    let ticks = 0;
    while (!world.screen && ticks < 300) { g.update(1 / 60); ticks++; }
    window.game.action('moveDown', false);
    const d = world.pending && world.pending.descriptor;
    return {
      screenKind: world.screen && world.screen.kind,
      moodWasChase: party.mood === 'chase',
      title: d && d.title,
      ambush: !!(d && d.ambush),
      canWithdraw: !!(d && d.canWithdraw),
      ticks,
    };
  });
  expect(result.screenKind).toBe('brief'); // sanity: the clash actually resolved
  expect(result.moodWasChase).toBe(true); // sanity: this really is the case mood alone misreads
  expect(result.title).toBe('BANDIT SKIRMISH');
  expect(result.ambush).toBe(false);
  expect(result.canWithdraw).toBe(false); // mutual is still committed (Plan 021 decision 5)
  expect(runtimeErrors).toEqual([]);
});

test('an unscouted stronghold brief shows the enemy as unknown; a scouted camp shows the true composition', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  // Wolfsjaw is never auto-scouted by proximity (unlike ordinary camps), so an assault
  // on it is the one case decision 6's "unscouted force" actually reaches.
  const unscouted = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'stronghold', seed: 424242 });
    return window.__g.scene.screen.enemy;
  });
  expect(unscouted.scouted).toBe(false);
  // An ordinary camp auto-scouts the instant you're close enough to assault it, so a
  // regular camp brief always shows the real composition.
  const scouted = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'campScouted', seed: 424242 });
    return window.__g.scene.screen.enemy;
  });
  expect(scouted.scouted).toBe(true);
  expect(scouted.bodies).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});

test('aftermath blocks world input and freezes grace, then decays only after dismissal', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world_aftermath', { seed: 424242, result: { victory: true } });
    const g = window.__g, world = g.scene;
    const screenKindAtOpen = world.screen && world.screen.kind;
    const graceAtOpen = world.grace;
    const heroXAtOpen = world.hero.x;
    g.input.injectKey('KeyD', true); // try to move — must have no effect while blocked
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    g.input.injectKey('KeyD', false);
    const heroMovedWhileBlocked = world.hero.x !== heroXAtOpen;
    const graceFrozen = world.grace === graceAtOpen;
    g.input.injectAction('confirm', true); g.update(1 / 60); g.input.injectAction('confirm', false);
    const screenGoneAfterDismiss = !world.screen;
    // Plan 023: `grace` now has TWO freezes stacked on it — the modal above (asserted by
    // graceFrozen) and a stopped hero. Keep the world awake for the post-dismissal ticks so
    // this test still measures the modal freeze lifting rather than the stopped-hero one.
    window.game.keepAwake(true);
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    window.game.keepAwake(false);
    return {
      screenKindAtOpen, graceAtOpen, heroMovedWhileBlocked, graceFrozen,
      screenGoneAfterDismiss, graceAfterDismiss: world.grace,
    };
  });
  expect(result.screenKindAtOpen).toBe('aftermath');
  expect(result.heroMovedWhileBlocked).toBe(false);
  expect(result.graceFrozen).toBe(true);
  expect(result.screenGoneAfterDismiss).toBe(true);
  expect(result.graceAfterDismiss).toBeLessThan(result.graceAtOpen);
  expect(runtimeErrors).toEqual([]);
});

test('a won stronghold raid reaches the victory ending instead of an aftermath screen', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world_brief', { kind: 'stronghold', seed: 424242 });
    const g = window.__g;
    g.input.injectAction('confirm', true); g.update(1 / 60); g.input.injectAction('confirm', false);
    if (g.sceneName !== 'battle') throw new Error('fixture setup: confirming the stronghold brief did not start a battle');
    g.scene.endBattle(true);
    for (let i = 0; i < 200 && g.sceneName === 'battle'; i++) g.update(1 / 60);
    // onEnd fires inside one of the ticks above and constructs a new World with
    // save.won already true; THAT World's own update() (not this loop) is what
    // redirects to the victory scene, so it needs a few more ticks after the loop
    // above stops (it stops the instant sceneName flips away from 'battle').
    for (let i = 0; i < 5 && g.sceneName === 'world'; i++) g.update(1 / 60);
    return { scene: g.sceneName, won: g.finalSave && g.finalSave.won };
  });
  expect(result.scene).toBe('victory');
  expect(result.won).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test('the aftermath reports per-side casualties, loot, and post-regen hero HP', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(() => {
    window.game.scenario('world_aftermath', { seed: 424242, result: { victory: true } });
    return window.__g.scene.screen;
  });
  expect(result.kind).toBe('aftermath');
  expect(result.victory).toBe(true);
  expect(typeof result.loot).toBe('number');
  expect(result.heroHp).toBeLessThanOrEqual(result.heroMaxHp);
  expect(Array.isArray(result.enemyLosses)).toBe(true);
  expect(Array.isArray(result.playerLosses)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

// ------------------------------------------------- audit 2026-09-03: what the aftermath says
// The `world_aftermath` scenario covers the three plain endings. These three cases need the
// fight to end in a specific STATE that only exists inside the battle (the column wiped, the
// lord down) or on a specific MAP (every camp razed), so they drive the same production path
// the scenario does — brief, confirm, a real Battle, a real endBattle, the real onEnd — and
// read the aftermath model the next World built from it.
async function fightTo(page, mode, opts = {}) {
  return page.evaluate(({ mode, opts }) => {
    window.game.scenario('world_brief', { kind: 'party', seed: 424242 });
    const g = window.__g, world = g.scene;
    if (opts.razeCamps) for (const c of world.save.camps) { if (c.id !== 'strong') c.razed = true; }
    const preTroops = world.save.troops.map(t => t.type);
    g.input.injectAction('confirm', true); g.update(1 / 60); g.input.injectAction('confirm', false);
    if (g.sceneName !== 'battle') throw new Error('fixture setup: confirming the brief did not start a battle');
    const battle = g.scene;
    // The two states the panel had no words for. Both are reached by putting the fight in
    // that state and then ending it, never by hand-building a result object.
    if (mode === 'wipe') battle.troops.length = 0;
    if (mode === 'heroFell') battle.hero.hp = 0;
    battle.endBattle(mode === 'victory');
    for (let i = 0; i < 400 && g.sceneName === 'battle'; i++) g.update(1 / 60);
    const after = g.scene;
    return {
      scene: g.sceneName,
      screen: after.screen,
      preTroops,
      troops: after.save.troops.map(t => t.type),
      liveCamps: after.liveCamps().length,
    };
  }, { mode, opts });
}

// The muster used to be counted as survival: `save.troops = result.survivors` ALIASED the
// result array, so Plan 039's volunteers were pushed into the very list the aftermath then
// read survivor types from. A warband of four wiped to the last man reported "YOUR LOSSES:
// none" (audit 2026-09-03, finding 1). Both facts are asserted here, because either alone
// can be satisfied by a fix that breaks the other: the panel must report four dead AND the
// save must still hold the four the muster rallied.
test('a wipe reports every man lost while the muster still refills the column', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await fightTo(page, 'wipe');
  expect(result.scene).toBe('world');
  expect(result.screen.kind).toBe('aftermath');
  expect(result.screen.victory).toBe(false);
  expect(result.preTroops.length).toBe(BALANCE.startTroops);
  const lost = result.screen.playerLosses.reduce((n, row) => n + row.count, 0);
  expect(lost).toBe(result.preTroops.length);
  // …and the recovery still happened: the column is back at the playable floor.
  expect(result.troops.length).toBe(BALANCE.distress.musterTo);
  expect(result.screen.reason).toBe('Your warband was cut down');
  // The enemy side of the ledger is unaffected by the same array (deadTypes is the enemy's
  // dead, from battle.deadEnemyTypes) — pinned so a fix on one side cannot silently rewrite
  // the other.
  expect(Array.isArray(result.screen.enemyLosses)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

// A lord cut down while his braced spears watched rendered as DEFEAT, losses none, and no
// reason at all (finding 13). The headline reason names which of the two happened.
test('the aftermath says why a defeat happened: the lord fell, or the warband was cut down', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const fell = await fightTo(page, 'heroFell');
  expect(fell.screen.kind).toBe('aftermath');
  expect(fell.screen.victory).toBe(false);
  expect(fell.screen.reason).toBe('Your lord fell');
  // The exact case the audit recorded: the men are all still standing, so the losses list
  // is genuinely empty and the reason line is the only thing that explains the DEFEAT.
  expect(fell.screen.playerLosses).toEqual([]);
  const wiped = await fightTo(page, 'wipe');
  expect(wiped.screen.reason).toBe('Your warband was cut down');
  expect(runtimeErrors).toEqual([]);
});

// "The camps are the objective: raid the tents" fired on every victory without a toast of
// its own, including after the last camp had been razed — pointing the player at nothing
// that exists (finding 17).
test('the raid-the-camps prompt is gone once no camp is left, and points at Wolfsjaw instead', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const live = await fightTo(page, 'victory');
  expect(live.liveCamps).toBeGreaterThan(0);
  expect(live.screen.consequence).toContain('raid the tents');

  const razed = await fightTo(page, 'victory', { razeCamps: true });
  expect(razed.liveCamps).toBe(0);
  expect(razed.screen.kind).toBe('aftermath');
  expect(razed.screen.victory).toBe(true);
  expect(razed.screen.consequence).not.toContain('raid the tents');
  expect(razed.screen.consequence).not.toMatch(/Raid the camps/i);
  expect(razed.screen.consequence).toContain('Wolfsjaw');
  expect(runtimeErrors).toEqual([]);
});

// ---------------------------------------------------------------- Plan 029: the perk choice
// The perk screen rides on the same world-scene modal machinery Plan 021 built for the
// brief and Milestone 025 reused for the specialization choice. These tests assert the
// three properties that machinery is supposed to buy for free, plus the one rule that is
// this plan's own: a milestone's choice can be DEFERRED but never lost, because the point
// is derived from persisted state rather than held in a counter.
test('a milestone opens the perk choice as a world modal that genuinely pauses the campaign', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const opened = await page.evaluate(() => {
    window.game.scenario('world', { seed: 515151 });
    const world = window.__g.scene;
    world.save.perks = [];
    world.save.stats.captures = 1; // one settlement taken: one perk earned
    const raised = world.offerPerkChoice();
    const before = { grace: world.grace, msgT: world.msgT };
    window.game.keepAwake(true);
    window.game.step(0.5); // half a second of world ticks with the modal up
    return {
      raised,
      kind: world.screen && world.screen.kind,
      options: world.screen ? world.screen.options.map(o => o.id) : null,
      blocking: world.isBlocking(),
      graceFrozen: world.grace === before.grace,
      sceneName: window.__g.sceneName,
    };
  });
  expect(opened.raised).toBe(true);
  expect(opened.kind).toBe('perk');
  expect(opened.sceneName).toBe('world'); // a modal, not a scene change
  expect(opened.blocking).toBe(true);
  expect(opened.graceFrozen).toBe(true);
  // Only the first tier is on offer with nothing taken — the gate is 0/2/4 perks held.
  expect(opened.options).toEqual(['setSpears', 'steadyHands', 'warhorn']);
  expect(runtimeErrors).toEqual([]);
});

test('a perk is committed permanently, and a dismissed choice is deferred rather than lost', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(async () => {
    const { perkChoiceDue } = await import('/src/progression.js');
    window.game.scenario('world', { seed: 515152 });
    const world = window.__g.scene;
    world.save.perks = [];
    world.save.stats.captures = 1;
    world.offerPerkChoice();

    // X defers. The point is still owed, because it is derived from the capture.
    world.dismissPerkChoice();
    const afterDismiss = {
      screen: world.screen,
      perks: world.save.perks.slice(),
      stillDue: perkChoiceDue(world.save),
      reopened: world.offerPerkChoice(),
      kind: world.screen && world.screen.kind,
    };

    // ENTER commits. The point is spent, and a second offer finds nothing owed.
    world.choosePerk('steadyHands');
    const afterChoose = {
      screen: world.screen,
      perks: world.save.perks.slice(),
      stillDue: perkChoiceDue(world.save),
      reopened: world.offerPerkChoice(),
    };

    // Taking the same perk twice is not something the screen can produce, and the commit
    // path refuses it rather than trusting the caller.
    world.save.stats.captures = 2;
    const duplicate = world.choosePerk('steadyHands');
    return { afterDismiss, afterChoose, duplicate, finalPerks: world.save.perks.slice() };
  });
  expect(result.afterDismiss.screen).toBe(null);
  expect(result.afterDismiss.perks).toEqual([]);
  expect(result.afterDismiss.stillDue).toBe(true);
  expect(result.afterDismiss.reopened).toBe(true);
  expect(result.afterDismiss.kind).toBe('perk');

  expect(result.afterChoose.screen).toBe(null);
  expect(result.afterChoose.perks).toEqual(['steadyHands']);
  expect(result.afterChoose.stillDue).toBe(false);
  expect(result.afterChoose.reopened).toBe(false);

  expect(result.duplicate).toBe(false);
  expect(result.finalPerks).toEqual(['steadyHands']);
  expect(runtimeErrors).toEqual([]);
});

test('the perk tiers gate on how many are already held', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const tiers = await page.evaluate(async () => {
    const { availablePerks, PERKS } = await import('/src/progression.js');
    const at = (taken) => availablePerks({ perks: taken }).map(p => PERKS[p.id].tier);
    return {
      none: at([]),
      two: at(['setSpears', 'steadyHands']),
      four: at(['setSpears', 'steadyHands', 'warhorn', 'hammerAnvil']),
    };
  });
  expect(new Set(tiers.none)).toEqual(new Set([1]));
  expect(new Set(tiers.two)).toEqual(new Set([1, 2]));
  // All three of tier 1 are taken by this point, so tier 1 is simply exhausted — the gate
  // opens later tiers, it never re-offers a perk already held.
  expect(new Set(tiers.four)).toEqual(new Set([2, 3]));
  expect(runtimeErrors).toEqual([]);
});

test('the banner is a real gold sink with a stated price and a top stage', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await boot(page);
  const result = await page.evaluate(async () => {
    const { BALANCE } = await import('/src/data.js');
    window.game.scenario('world', { seed: 515153 });
    const world = window.__g.scene;
    world.save.banner = 0;
    world.save.gold = BALANCE.bannerCosts[0] - 1;
    const short = { ok: world.upgradeBanner(), gold: world.save.gold, msg: world.msg };
    world.save.gold = 10000;
    const spent = [];
    for (let i = 0; i <= BALANCE.bannerCosts.length; i++) {
      const before = world.save.gold;
      const ok = world.upgradeBanner();
      spent.push({ ok, cost: before - world.save.gold, stage: world.save.banner });
    }
    return { short, spent, costs: BALANCE.bannerCosts, goldSpent: world.save.stats.goldSpent };
  });
  expect(result.short.ok).toBe(false);
  expect(result.short.gold).toBe(result.costs[0] - 1); // a refused purchase charges nothing
  expect(result.short.msg).toContain('gold');
  // Each stage charges exactly what the table quotes, and the last attempt finds nothing
  // left to buy rather than charging for a stage that does not exist.
  expect(result.spent.slice(0, result.costs.length).map(s => s.cost)).toEqual(result.costs);
  expect(result.spent[result.costs.length]).toMatchObject({ ok: false, cost: 0 });
  expect(result.spent[result.costs.length - 1].stage).toBe(result.costs.length);
  expect(result.goldSpent).toBe(result.costs.reduce((a, b) => a + b, 0));
  expect(runtimeErrors).toEqual([]);
});
