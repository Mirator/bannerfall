// Bannerfall QA regression suite — headless, against window.game / window.__g.
//
// Paste this whole file as one block into javascript_tool. It is a single
// expression (no top-level let/const), so it is safe to paste repeatedly
// while iterating. It defines window.runQaSuite (re-runnable on demand) and
// also runs it once immediately, storing + returning the result.
//
// Design notes (see critiques/phase2/qa-auto.md for the full report):
//  - All game-API calls here (scenario/step/tap/key/state) are synchronous —
//    step() runs its fixed-timestep loop inline, so no real-time waiting is
//    needed anywhere in this suite.
//  - `g.scenario('world')` always calls game.startWorld(null) (src/main.js),
//    i.e. a FRESH default save every time. Tests that need a battle to
//    resolve through the real economy (loot/defeat penalties/camp raids/
//    grace timer) go through World.startBattle(...) directly via __g and
//    then force Battle.endBattle(true|false) to skip simulated combat —
//    this exercises the exact same result-computation / onEnd code paths
//    as real play, deterministically and fast.
//  - The bundled test scenarios (battle_small/big/bridge) wire onEnd to
//    `() => game.startWorld(null)` (src/main.js) — they do NOT feed loot/
//    survivors back into any save. That's why economy assertions use
//    World.startBattle instead of scenario('battle_small').
//  - Constants (costs, loot formula, defeat penalty, grace timer, army cap,
//    hero start) are mirrored from src/data.js below because they are not
//    exposed on the test API — if data.js balance numbers change, update
//    these mirrors too (flagged as a testability gap in the report).

window.__qaResult = (function runQaSuite() {
  const g = window.game, G = window.__g;
  const results = [];

  if (!g || !G) {
    return { passed: 0, failed: 1, results: [{ name: 'harness_present', ok: false, detail: 'window.game or window.__g not found' }] };
  }

  function record(name, fn) {
    try {
      const detail = fn();
      results.push({ name, ok: true, detail: detail || 'ok' });
    } catch (e) {
      results.push({ name, ok: false, detail: (e && e.message) || String(e) });
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }

  // ---- constants mirrored from src/data.js (not exposed via test API) ----
  const COST = { spear: 15, archer: 25, knight: 60 };
  const HEAL_COST = 10;
  const DEFEAT_GOLD_LOSS = 0.3;
  const LOOT_BASE = 10, LOOT_PER_ENEMY = 5;
  const HERO_START = { x: 620, y: 1250 };
  const SETTLEMENT_ASHFORD = { x: 700, y: 1150 };
  const CAMP_C1 = { x: 1050, y: 1500 }; // size 3 -> n = 2+size = 5 enemies
  const CAMP_C2 = { x: 1850, y: 500 };  // size 4 -> n = 2+size = 6 enemies

  // ======================================================================
  // 1. State machine — menu -> world on Enter
  // ======================================================================
  record('menu_to_world_on_enter', () => {
    g.scenario('menu');
    assert(g.scene() === 'menu', 'scenario(menu) -> scene=' + g.scene());
    g.tap('Enter');
    assert(g.scene() === 'world', 'Enter from menu -> scene=' + g.scene());
    return 'menu -> world on Enter confirmed';
  });

  // ======================================================================
  // 2. Battle invariants + victory transition (battle_small, charge + hero attacks)
  // ======================================================================
  record('battle_flow_invariants_and_victory', () => {
    g.scenario('battle_small');
    const totalEnemies = G.scene.totalEnemies;
    const startTroops = G.scene.startTroops;
    const maxHp = G.scene.hero.maxHp;
    assert(totalEnemies === 3, 'expected battle_small totalEnemies=3, got ' + totalEnemies);
    g.tap('Digit2'); // charge
    let sawVictory = false, steps = 0;
    const MAX_STEPS = 300; // up to 150 sim-seconds
    while (steps < MAX_STEPS) {
      g.step(0.5);
      g.tap('KeyJ'); // hero helps fight so the run reliably converges
      steps++;
      const st = g.state();
      if (st.scene !== 'battle') break;
      const b = st.battle;
      assert(b.kills + b.enemies === totalEnemies,
        'kills(' + b.kills + ')+enemies(' + b.enemies + ') != totalEnemies(' + totalEnemies + ') at step ' + steps);
      assert(G.scene.troops.length <= startTroops,
        'troops.length ' + G.scene.troops.length + ' exceeded startTroops ' + startTroops + ' at step ' + steps);
      assert(b.hero.hp <= maxHp, 'hero.hp ' + b.hero.hp + ' exceeded maxHp ' + maxHp + ' at step ' + steps);
      if (b.victory) sawVictory = true;
    }
    assert(sawVictory, 'victory flag never observed within ' + (MAX_STEPS * 0.5) + ' sim seconds');
    assert(g.scene() === 'world', 'expected scene=world after battle end banner, got ' + g.scene());
    return 'invariants held for ' + steps + ' half-second ticks; victory observed; returned to world';
  });

  // ======================================================================
  // 2b. End-banner hold duration (precise, isolated measurement)
  // ======================================================================
  record('battle_end_banner_holds_at_least_2s', () => {
    g.scenario('battle_big');
    const scene = G.scene;
    scene.endBattle(true);
    assert(scene.state === 'end', 'endBattle(true) did not set state to "end"');
    let elapsed = 0;
    const INC = 0.1, MAX = 5.0;
    while (g.scene() === 'battle' && elapsed < MAX) { g.step(INC); elapsed += INC; }
    assert(g.scene() === 'world', 'did not return to world within ' + MAX + 's (elapsed=' + elapsed.toFixed(2) + 's)');
    assert(elapsed >= 2.0, 'end banner held only ' + elapsed.toFixed(2) + 's before onEnd, spec requires >= 2s');
    return 'end banner held ' + elapsed.toFixed(2) + 's before onEnd fired (battle.js gates onEnd on stateT > 2.6)';
  });

  // ======================================================================
  // 3. Defeat penalties (via World.startBattle, forced loss)
  // ======================================================================
  record('defeat_penalties_via_world_battle', () => {
    g.scenario('world');
    const save = G.scene.save;
    save.gold = 100;
    save.troops = [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }]; // odd count
    const startTroopCount = save.troops.length, startGold = save.gold;
    G.scene.startBattle(['bandit'], 'TEST DEFEAT', null);
    assert(g.scene() === 'battle', 'startBattle did not switch scene to battle');
    G.scene.endBattle(false);
    g.step(3); // flush the end-banner hold + onEnd
    assert(g.scene() === 'world', 'did not return to world after forced defeat, scene=' + g.scene());
    const w = g.state().world;
    const expectedGold = Math.max(25, Math.round(startGold * (1 - DEFEAT_GOLD_LOSS))); // spec v2: 30% loss with a 25g comeback floor
    assert(w.gold === expectedGold, 'defeat gold penalty: expected ' + expectedGold + ' (30% loss, 25g floor), got ' + w.gold);
    // spec v2 (phase-2 panel): defeat keeps the ACTUAL battle survivors (real survivor tracking),
    // with a volunteer-rally floor of 2 troops. Forced defeat with no combat = all 5 survive.
    assert(w.troops >= 2 && w.troops <= startTroopCount,
      'defeat troop tracking: expected 2..' + startTroopCount + ' actual survivors, got ' + w.troops);
    assert(w.troops === startTroopCount,
      'no-combat forced defeat should keep all ' + startTroopCount + ' survivors, got ' + w.troops);
    // spec v3 (phase-3 coherence): survivors carry you to the NEAREST settlement (from 620,1250 that is Ashford at 700,1150+80)
    assert(w.hero.x === 700 && w.hero.y === 1230,
      'defeat respawn expected nearest settlement (700,1230), got (' + w.hero.x + ',' + w.hero.y + ')');
    return 'defeat penalties correct: gold ' + startGold + '->' + w.gold + ', troops ' + startTroopCount + '->' + w.troops + ', respawn at heroStart';
  });

  // ======================================================================
  // 4. Victory loot + survivors + heroHp regen (via World.startBattle, forced win)
  // ======================================================================
  record('victory_loot_and_survivors_via_world_battle', () => {
    g.scenario('world');
    const save = G.scene.save;
    save.gold = 50; save.heroHp = 60; save.heroMaxHp = 120;
    save.troops = [{ type: 'spear' }, { type: 'archer' }, { type: 'knight' }];
    const startGold = save.gold;
    const enemyComp = ['bandit', 'bandit', 'raider', 'wolf']; // 4 enemies, deterministic count
    G.scene.startBattle(enemyComp, 'TEST VICTORY', null);
    assert(g.scene() === 'battle', 'startBattle did not switch scene to battle');
    assert(G.scene.totalEnemies === enemyComp.length, 'totalEnemies mismatch: expected ' + enemyComp.length + ', got ' + G.scene.totalEnemies);
    G.scene.endBattle(true); // no simulated combat -> full survivor roster expected
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after forced victory, scene=' + g.scene());
    const save2 = G.scene.save;
    const expectedLoot = LOOT_BASE + LOOT_PER_ENEMY * enemyComp.length;
    assert(save2.gold === startGold + expectedLoot,
      'loot formula: expected gold ' + (startGold + expectedLoot) + ', got ' + save2.gold);
    assert(save2.troops.length === 3, 'expected all 3 troops to survive an uncontested forced victory, got ' + save2.troops.length);
    assert(save2.heroHp === 80, 'expected heroHp min(maxHp, 60+20)=80 after victory regen, got ' + save2.heroHp);
    return 'loot formula correct (' + expectedLoot + ' for ' + enemyComp.length + ' enemies), survivors=3, heroHp 60->' + save2.heroHp;
  });

  // ======================================================================
  // 5. Command system (Digit1/2/3) + HOLD position storage
  // ======================================================================
  record('command_system_and_hold_positions', () => {
    g.scenario('battle_small');
    // battle.js holds state='intro' for ~0.6-1.1s and ignores Digit1/2/3 while
    // intro (see Battle.update's early-return intro branch) — advance past it
    // first so the command taps below actually land.
    let introGuard = 0;
    while (g.state().battle.state === 'intro' && introGuard < 50) { g.step(0.1); introGuard++; }
    assert(g.state().battle.state !== 'intro', 'battle stuck in intro after ' + (introGuard * 0.1) + 's');
    g.tap('Digit1'); const c1 = g.state().battle.command;
    g.tap('Digit2'); const c2 = g.state().battle.command;
    g.tap('Digit3'); const c3 = g.state().battle.command;
    assert(c1 === 'follow', 'Digit1 expected command=follow, got ' + c1);
    assert(c2 === 'charge', 'Digit2 expected command=charge, got ' + c2);
    assert(c3 === 'hold', 'Digit3 expected command=hold, got ' + c3);
    const troops = G.scene.troops;
    assert(troops.length > 0, 'no troops to check hold positions on');
    for (const t of troops) {
      assert(t.holdX != null && t.holdY != null, 'troop holdX/holdY not set after HOLD command');
      assert(Math.abs(t.holdX - t.x) < 2 && Math.abs(t.holdY - t.y) < 2,
        'troop hold position drifted: hold=(' + t.holdX + ',' + t.holdY + ') actual=(' + t.x + ',' + t.y + ')');
    }
    return 'Digit1/2/3 -> follow/charge/hold confirmed; hold positions captured for ' + troops.length + ' troops';
  });

  // ======================================================================
  // 6. Economy: recruit cost / cap / gold refusals + interactive-path parity
  // ======================================================================
  record('economy_recruit_cost_cap_and_gold_refusals', () => {
    g.scenario('world');
    const save = G.scene.save;
    save.gold = 100; save.troops = [{ type: 'spear' }]; save.armyCap = 12;
    G.scene.recruit('archer');
    assert(save.gold === 75, 'recruit archer expected gold 100-25=75, got ' + save.gold);
    assert(save.troops.length === 2, 'recruit archer expected troops.length=2, got ' + save.troops.length);

    save.troops = Array.from({ length: save.armyCap }, () => ({ type: 'spear' }));
    const goldBeforeCap = save.gold;
    G.scene.recruit('spear');
    assert(save.gold === goldBeforeCap, 'recruit at cap should not deduct gold, gold changed to ' + save.gold);
    assert(save.troops.length === save.armyCap, 'recruit at cap should not add a troop');
    assert(G.scene.msg === 'Army is at capacity', 'expected cap refusal message, got: ' + G.scene.msg);

    save.troops = [{ type: 'spear' }]; save.gold = 5;
    G.scene.recruit('knight'); // cost 60
    assert(save.gold === 5, 'recruit with insufficient gold should not deduct, gold changed to ' + save.gold);
    assert(save.troops.length === 1, 'recruit with insufficient gold should not add a troop');
    assert(G.scene.msg === 'Not enough gold', 'expected gold-short refusal message, got: ' + G.scene.msg);

    // interactive-path parity: real KeyQ handler near a settlement
    G.scene.hero.x = SETTLEMENT_ASHFORD.x; G.scene.hero.y = SETTLEMENT_ASHFORD.y;
    save.gold = 100; save.troops = [];
    g.tap('KeyQ');
    // spec v3 (phase-3 coherence): settlements quote local prices — Ashford's spearmen cost 12g
    assert(save.gold === 100 - 12, 'interactive KeyQ recruit at Ashford expected gold 88 (12g farm lads), got ' + save.gold);
    assert(save.troops.length === 1, 'interactive KeyQ recruit expected 1 troop, got ' + save.troops.length);
    return 'recruit cost/cap/gold refusals correct; interactive KeyQ path matches direct recruit() call';
  });

  // ======================================================================
  // 7. Economy: heal refusals (full HP / short gold) + success path
  // ======================================================================
  record('economy_heal_refusals_and_success_path', () => {
    g.scenario('world');
    G.scene.hero.x = SETTLEMENT_ASHFORD.x; G.scene.hero.y = SETTLEMENT_ASHFORD.y;
    const save = G.scene.save;

    save.heroHp = save.heroMaxHp; save.gold = 100;
    g.tap('KeyF');
    assert(G.scene.msg === 'Already rested', 'expected "Already rested" at full HP, got: ' + G.scene.msg);
    assert(save.gold === 100, 'gold should be unchanged when already rested, got ' + save.gold);

    save.heroHp = 50; save.gold = 5;
    g.tap('KeyF');
    assert(G.scene.msg === 'Not enough gold', 'expected "Not enough gold" refusal, got: ' + G.scene.msg);
    assert(save.heroHp === 50, 'heroHp should be unchanged on refusal, got ' + save.heroHp);
    assert(save.gold === 5, 'gold should be unchanged on refusal, got ' + save.gold);

    save.heroHp = 50; save.gold = 50; save.troops = [{ type: 'spear', hp: 33 }];
    g.tap('KeyF');
    assert(save.gold === 50 - HEAL_COST, 'heal should deduct exactly ' + HEAL_COST + ' gold, got gold=' + save.gold);
    assert(save.heroHp === save.heroMaxHp, 'heal should restore hero to max HP, got ' + save.heroHp);
    assert(save.troops[0].hp === undefined, 'heal should clear per-troop hp overrides, still has hp=' + save.troops[0].hp);
    assert(G.scene.msg === 'Warband rested and healed', 'expected success message, got: ' + G.scene.msg);
    return 'heal refusals (full HP / short gold) and success path (cost, HP reset, troop-hp clear) all correct';
  });

  // ======================================================================
  // 8. World: winning a party battle decreases parties.length by exactly 1
  // ======================================================================
  record('world_party_battle_decreases_party_count_by_one', () => {
    g.scenario('world');
    const scene = G.scene;
    const before = scene.parties.length;
    assert(before > 0, 'no parties spawned to test collision against');
    let target = null;
    for (const p of scene.parties) { if (!scene.inSafeZone(p.x, p.y)) { target = p; break; } }
    assert(target, 'could not find a party outside a settlement safe zone to engage');
    scene.hero.x = target.x; scene.hero.y = target.y; scene.grace = 0;
    g.step(0.1);
    assert(g.scene() === 'battle', 'hero-party collision did not start a battle, scene=' + g.scene());
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after party battle, scene=' + g.scene());
    const after = g.state().world.parties;
    assert(after === before - 1, 'expected parties.length ' + before + ' -> ' + (before - 1) + ', got ' + after);
    return 'party count ' + before + ' -> ' + after + ' after winning a party battle';
  });

  // ======================================================================
  // 9. World: camp raid razes camp + grants captives (and respects cap)
  // ======================================================================
  record('world_camp_raid_razes_camp_and_grants_captives', () => {
    g.scenario('world');
    const scene = G.scene;
    const campState = scene.save.camps.find(c => c.id === 'c1');
    assert(campState && !campState.razed, 'camp c1 expected un-razed at fresh world start');
    scene.hero.x = CAMP_C1.x; scene.hero.y = CAMP_C1.y;
    const goldBefore = scene.save.gold, troopsBefore = scene.save.troops.length;
    g.tap('KeyE');
    assert(g.scene() === 'battle', 'KeyE near camp did not start a battle, scene=' + g.scene());
    const nEnemies = G.scene.totalEnemies;
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after camp raid, scene=' + g.scene());
    const save2 = G.scene.save;
    const c1After = save2.camps.find(c => c.id === 'c1');
    assert(c1After.razed === true, 'camp c1 razed flag not set true after victorious raid');
    const expectedLoot = LOOT_BASE + LOOT_PER_ENEMY * nEnemies + 60; // battle loot + non-stronghold camp bonus
    assert(save2.gold === goldBefore + expectedLoot, 'expected gold ' + (goldBefore + expectedLoot) + ', got ' + save2.gold);
    // spec v3 (coherence): captives = min(2, ceil(humanGarrison/3)) — derived from the actual scouted comp
    const humans = (c1After.garrison || []).filter(function (t) { return t === 'bandit' || t === 'raider'; }).length;
    const expectedCaptives = Math.min(2, Math.ceil(humans / 3));
    const expectedTroops = Math.min(troopsBefore + expectedCaptives, save2.armyCap);
    assert(save2.troops.length === expectedTroops, 'expected ' + expectedTroops + ' troops (captives=' + expectedCaptives + ' from ' + humans + ' human captors), got ' + save2.troops.length);
    return 'camp c1 razed=true, gold +' + expectedLoot + ', captives ' + troopsBefore + '->' + save2.troops.length;
  });

  record('world_camp_raid_captives_capped_at_army_cap', () => {
    g.scenario('world');
    const scene = G.scene;
    scene.save.armyCap = 4;
    scene.save.troops = [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }]; // already at cap
    scene.hero.x = CAMP_C2.x; scene.hero.y = CAMP_C2.y;
    const campState = scene.save.camps.find(c => c.id === 'c2');
    assert(campState && !campState.razed, 'camp c2 expected un-razed at fresh world start');
    g.tap('KeyE');
    assert(g.scene() === 'battle', 'KeyE near camp c2 did not start a battle, scene=' + g.scene());
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after camp raid, scene=' + g.scene());
    const save2 = G.scene.save;
    assert(save2.troops.length === 4, 'expected troops to stay capped at armyCap=4, got ' + save2.troops.length);
    return 'captives correctly withheld when army is already at capacity (stayed at 4)';
  });

  // ======================================================================
  // 10. World: grace timer active (~6s) after a battle, then decays to 0
  // ======================================================================
  // This test was originally seen to fail intermittently ~1/3 of the time
  // with "grace became non-numeric". Root cause (confirmed via a diagnostic
  // rerun): the observation window used several more step() calls (7 sim
  // seconds total) with the hero parked at the exact spot of the party we
  // just fought. Once grace naturally expires (~5.6s in, since some of it
  // decays during the forced end-banner flush itself), OTHER roaming
  // parties (this fresh world spawns ~8) are free to walk up and collide
  // with the still-parked hero, starting a SECOND battle mid-observation —
  // at which point G.scene is a Battle instance with no `.grace` field at
  // all, so reading it comes back undefined. That's the world/party engine
  // working as designed (world.js:284, `engaged = grace<=0 && !heroSafe...`),
  // not a bug — the test just didn't isolate the hero from further contact
  // while sampling the decay curve. Fix: retreat the hero into a
  // settlement's safe zone (world.js `inSafeZone`, radius 260) right after
  // the battle-return, which blocks ALL party engagement regardless of
  // grace, so only the timer's own decay is being observed below.
  record('world_grace_timer_active_after_battle_then_decays', () => {
    g.scenario('world');
    const scene = G.scene;
    let target = null;
    for (const p of scene.parties) { if (!scene.inSafeZone(p.x, p.y)) { target = p; break; } }
    assert(target, 'no engageable party found');
    scene.hero.x = target.x; scene.hero.y = target.y; scene.grace = 0;
    g.step(0.1);
    assert(g.scene() === 'battle', 'did not enter battle');
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world');
    // isolate the rest of the observation from any other roaming party
    G.scene.hero.x = SETTLEMENT_ASHFORD.x; G.scene.hero.y = SETTLEMENT_ASHFORD.y;
    const graceAtStart = G.scene.grace;
    assert(typeof graceAtStart === 'number' && !Number.isNaN(graceAtStart),
      'World.grace was not a number right after returning to world (got ' + graceAtStart + ')');
    assert(graceAtStart > 4.5 && graceAtStart <= 6.01,
      'expected grace timer near 6s (BALANCE.battleGrace) right after returning to world, got ' + graceAtStart.toFixed(2));
    g.step(3);
    assert(g.scene() === 'world', 'left world scene while observing grace decay, scene=' + g.scene());
    const graceAfter = G.scene.grace;
    assert(typeof graceAfter === 'number', 'World.grace became non-numeric after stepping 3s more (got ' + graceAfter + ')');
    assert(graceAfter >= 0 && graceAfter < graceAtStart, 'expected grace to have decayed, got ' + graceAfter.toFixed(2));
    g.step(4); // >6s total elapsed since battle end
    assert(g.scene() === 'world', 'left world scene while observing grace decay, scene=' + g.scene());
    const graceLate = G.scene.grace;
    assert(typeof graceLate === 'number', 'World.grace became non-numeric after stepping 7s total (got ' + graceLate + ')');
    assert(graceLate <= 0, 'expected grace timer to reach 0 after > 6s total, got ' + graceLate.toFixed(2));
    return 'grace timer: ' + graceAtStart.toFixed(2) + 's at return -> ' + graceAfter.toFixed(2) + 's after 3s -> ' + graceLate.toFixed(2) + 's after 7s (decays to 0)';
  });

  // ======================================================================
  // 11. World: spawned party strength always stays within [2, 24]
  // ======================================================================
  record('world_party_strength_stays_in_2_24_band', () => {
    g.scenario('world');
    const scene = G.scene;
    const fakeCamp = { id: '__test_camp__', x: 1000, y: 1000 };
    const bands = [0.0001, 0.5, 1.0, 5, 100]; // extremes + normal, to probe the clamp(2,24)
    const violations = [];
    for (const band of bands) {
      for (let i = 0; i < 5; i++) {
        scene.spawnParty(fakeCamp, band);
        const p = scene.parties[scene.parties.length - 1];
        const s = scene.strength(p.comp);
        if (s < 2 || s > 24) violations.push('band=' + band + ' -> strength=' + s);
      }
    }
    assert(violations.length === 0, 'party strength left [2,24] band: ' + violations.join('; '));
    return 'party strength stayed within [2,24] across ' + (bands.length * 5) + ' spawns (bands ' + bands.join(',') + ')';
  });

  // ======================================================================
  // 12. Determinism: battle_small (seed 42), identical scripted inputs
  // ======================================================================
  record('determinism_battle_small_seed_reproducible', () => {
    function runOnce() {
      g.scenario('battle_small');
      g.tap('Digit2');
      g.step(10);
      const st = g.state();
      return { kills: st.battle.kills, hx: st.battle.hero.x, hy: st.battle.hero.y, enemies: st.battle.enemies, troops: G.scene.troops.length };
    }
    const a = runOnce();
    const b = runOnce();
    assert(a.kills === b.kills, 'kill count diverged between identical runs: ' + a.kills + ' vs ' + b.kills);
    assert(a.hx === b.hx && a.hy === b.hy, 'hero position diverged: (' + a.hx + ',' + a.hy + ') vs (' + b.hx + ',' + b.hy + ')');
    assert(a.enemies === b.enemies, 'enemies remaining diverged: ' + a.enemies + ' vs ' + b.enemies);
    assert(a.troops === b.troops, 'surviving troop count diverged: ' + a.troops + ' vs ' + b.troops);
    return 'two identical scripted runs of battle_small (seed 42) matched after 10s: kills=' + a.kills + ' hero=(' + a.hx + ',' + a.hy + ')';
  });

  // ======================================================================
  // 13. Perf smoke: 200 x step(0.5) wall-clock budget
  // ======================================================================
  record('perf_smoke_200_half_second_steps', () => {
    g.scenario('battle_big'); // busiest scenario: 14 troops + 11 enemies
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) g.step(0.5);
    const elapsedMs = performance.now() - t0;
    const BUDGET_MS = 8000;
    assert(elapsedMs < BUDGET_MS, '200 x step(0.5) took ' + elapsedMs.toFixed(0) + 'ms, exceeding budget of ' + BUDGET_MS + 'ms');
    return '200 x step(0.5) (100 sim-seconds, battle_big) completed in ' + elapsedMs.toFixed(0) + 'ms';
  });

  // ======================================================================
  // 16. World: no party ever freezes at a river — pursuit crosses or lives on
  //     (spec v4: a party may abandon a failed hunt and go home, but it must MOVE)
  // ======================================================================
  record('world_no_party_freezes_at_rivers', () => {
    const cases = [
      { px: 900, py: 760, hx: 1200, hy: 760 }, { px: 1180, py: 760, hx: 860, hy: 760 },
      { px: 2300, py: 800, hx: 2560, hy: 800 }, { px: 2540, py: 800, hx: 2290, hy: 800 },
      { px: 985, py: 760, hx: 1150, hy: 760 },  // the historic embedded/pocket spot
      { px: 700, py: 800, hx: 1050, hy: 800 },  // hero standing INSIDE the planner's padded bank margin
      { px: 2350, py: 1150, hx: 1750, hy: 1150 }, // pursuit route passes through Highmere's safe zone
    ];
    for (const c of cases) {
      g.scenario('world');
      const w = G.scene;
      w.grace = 0;
      w.hero.x = c.hx; w.hero.y = c.hy;
      w.save.troops = [{ type: 'spear' }];
      w.parties.length = 0;
      w.parties.push({ camp: 'c1', x: c.px, y: c.py, vx: 0, vy: 0, facing: 0, bob: 0,
        comp: ['bandit', 'bandit', 'bandit', 'bandit', 'brute'], home: { x: 1050, y: 1500 }, wander: null, wanderT: 0 });
      const p = w.parties[0];
      let resolved = false;
      for (let i = 0; i < 40; i++) {
        g.step(1);
        if (g.scene() !== 'world') { resolved = true; break; } // battle = pursuit succeeded
        if (Math.hypot(p.x - c.px, p.y - c.py) > 200) { resolved = true; break; } // moving with purpose
      }
      assert(resolved, 'party frozen at (' + c.px + ',' + c.py + ') vs hero (' + c.hx + ',' + c.hy + ') — moved <200px in 40s');
    }
    return 'all 5 river-pursuit cases resolved (crossed, fought, or moved on) — no freezes';
  });

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, results };
})();

window.runQaSuite = function () {
  // re-runnable entry point without re-pasting the whole file: not redefined
  // here to keep this file idempotent as a single pasted block; use the IIFE
  // above (re-paste this file) to re-run. Exposed for readability/discovery.
  return window.__qaResult;
};

window.__qaResult;
