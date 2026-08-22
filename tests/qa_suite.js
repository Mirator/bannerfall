// Bannerfall QA regression suite — browser module against window.game / window.__g.
import { BALANCE, HERO, UNIT_TYPES, WORLD } from '../src/data.js';
//
// It preserves the historical window.runQaSuite / window.__qaResult browser
// globals while remaining importable by the automated Playwright runner.
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
//  - Balance and world coordinates are imported from src/data.js so this suite
//    cannot silently drift from production tuning.

// The suite body is a real function, not a one-shot IIFE — window.runQaSuite() below
// calls this again on demand, instead of replaying a cached result from paste time.
function runQaSuiteImpl() {
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

  const COST = Object.fromEntries(Object.entries(UNIT_TYPES).map(([type, unit]) => [type, unit.cost]));
  const HEAL_COST = BALANCE.healCost;
  const DEFEAT_GOLD_LOSS = BALANCE.defeatGoldLoss;
  const LOOT_BASE = BALANCE.lootBase;
  const LOOT_PER_ENEMY = BALANCE.lootPerEnemy;
  const ARMY_CAP_BASE = BALANCE.armyCapBase;
  const BATTLE_GRACE = BALANCE.battleGrace;
  const HERO_START = WORLD.heroStart;
  const SETTLEMENT_ASHFORD = WORLD.settlements.find(s => s.id === 'ashford');
  const SETTLEMENT_KEEP = WORLD.settlements.find(s => s.kind === 'town');
  const CAMP_C1 = WORLD.camps.find(c => c.id === 'c1');
  assert(SETTLEMENT_ASHFORD, 'WORLD.settlements is missing required id ashford');
  assert(SETTLEMENT_KEEP, 'WORLD.settlements has no town, so army-cap expansion has nowhere to happen');
  assert(CAMP_C1, 'WORLD.camps is missing required id c1');

  // ======================================================================
  // 1. State machine — menu -> world on Enter
  // ======================================================================
  record('menu_to_world_on_enter', () => {
    g.scenario('menu');
    assert(g.scene() === 'menu', 'scenario(menu) -> scene=' + g.scene());
    g.tap('Enter');
    assert(g.scene() === 'menu' && G.menuPanel === 'new', 'first Enter should open campaign choice');
    g.tap('Enter');
    assert(g.scene() === 'world', 'Enter on Normal campaign -> scene=' + g.scene());
    return 'menu -> campaign choice -> world on Enter confirmed';
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
  // 2c. Hero offence: the swing lands, and the dash tramples exactly once
  // ======================================================================
  // Coverage note, and the reason this record exists: no test had ever landed a hero
  // attack. The single KeyJ tap in battle_flow_invariants_and_victory has never had an
  // enemy inside the arc, and DASH (Space) appeared in no test at all — so every line
  // that applies hero damage was unexecuted, and HERO.swingDmg / dashDmg / iframeTime
  // could be set to any value without the gate noticing.
  record('hero_swing_and_dash_damage_enemies', () => {
    g.scenario('battle_small');
    const b = G.scene, h = b.hero;
    // a battle opens on its intro banner, and battle.js runs no phases at all while it is
    // up: swing and dash inputs are not read yet, so every assertion below would be
    // vacuous there. Step through it in two parts so the intro HUD draws at least once.
    assert(b.state === 'intro', 'a battle should open on the intro banner, state=' + b.state);
    g.step(0.5);
    assert(b.state === 'intro', 'the intro banner should still be up 0.5s in, state=' + b.state);
    g.step(0.8);
    assert(b.state === 'fight', 'the intro should be over 1.3s in, state=' + b.state);

    // Aim is derived from the pointer through the camera, so ask the game where it is
    // aiming and put the target on THAT ray. Re-deriving the camera transform in a test is
    // how the viewport- and cursor-dependent battle outcomes stayed hidden the first time.
    const aimRay = () => {
      const mw = G.camera.toWorld(G.input.mouse.x, G.input.mouse.y);
      return Math.atan2(mw.y - h.y, mw.x - h.x);
    };
    const place = (e, angle, distance) => { e.x = h.x + Math.cos(angle) * distance; e.y = h.y + Math.sin(angle) * distance; };
    // A LANDED hit sets battle.freeze, and battle.update() returns early while that
    // hit-stop runs — so the very next tick's input is dropped on the floor. Without
    // clearing it here the "enemy behind the hero" case below would pass because nothing
    // happened at all, which is not the same thing as the arc rejecting the target.
    const swing = () => {
      h.vx = 0; h.vy = 0; h.swingT = 0;
      g.tap('KeyJ');
      assert(h.swingT === HERO.swingCd,
        'the swing did not fire — swingT is ' + h.swingT + ', expected HERO.swingCd (' + HERO.swingCd + ')');
      g.step(0.1); // past the hit-stop, so the next input is actually read
    };

    // nothing may die while the damage numbers are being read: an enemy splice would move
    // the target out from under the assertions, and could end the battle outright
    for (const e of b.enemies) e.hp = 500;
    const target = b.enemies[0], behind = b.enemies[1];
    for (const e of b.enemies.slice(1)) { e.x = 60; e.y = 60; }

    h.x = b.W / 2; h.y = b.H / 2;
    place(target, aimRay(), 40);
    const beforeSwing = target.hp;
    swing();
    assert(target.hp === beforeSwing - HERO.swingDmg,
      'a swing at 40px on the aim ray should deal exactly HERO.swingDmg (' + HERO.swingDmg +
      '), hp went ' + beforeSwing + ' -> ' + target.hp);
    assert(b.kills === 0, 'this record must not kill anything, kills=' + b.kills);

    // an enemy directly behind the aim ray is outside the arc: the hero is a knight, not
    // a lawnmower. Park the first target out of reach so only `behind` is in question.
    place(target, aimRay(), 400);
    place(behind, aimRay() + Math.PI, 40);
    const beforeBack = behind.hp;
    swing();
    assert(behind.hp === beforeBack,
      'an enemy behind the aim ray must not be hit, hp went ' + beforeBack + ' -> ' + behind.hp);

    // Dash: with no movement axis held the dash follows the same aim ray. The trample must
    // land once per dash, not once per tick — that is what the _trampled flag is for.
    place(behind, aimRay() + Math.PI, 400);
    place(target, aimRay(), 60);
    h.vx = 0; h.vy = 0; h.dashCdT = 0; h.iframesT = 0;
    const beforeDash = target.hp;
    g.tap('Space');
    assert(h.dashT > 0, 'Space did not start a dash (dashT=' + h.dashT + ')');
    assert(h.iframesT > 0, 'a dash must grant i-frames, iframesT=' + h.iframesT);
    assert(target.hp === beforeDash,
      'the activation tick reads dashT before it is set, so no trample belongs on it; hp moved to ' + target.hp);
    g.step(0.15);
    assert(target.hp === beforeDash - HERO.dashDmg,
      'riding through an enemy should deal exactly HERO.dashDmg (' + HERO.dashDmg +
      '), hp went ' + beforeDash + ' -> ' + target.hp);
    assert(target._trampled === true,
      'the trampled enemy was not marked, so the once-per-dash guard is not holding it');
    g.step(0.1); // to the end of HERO.dashTime
    assert(target.hp === beforeDash - HERO.dashDmg,
      'the trample must hit at most once per dash, hp fell further to ' + target.hp);
    return 'swing dealt ' + HERO.swingDmg + ' on the aim ray and nothing behind it; dash dealt ' +
      HERO.dashDmg + ' once, with i-frames granted';
  });

  // ======================================================================
  // 2d. Retreat: the held escape decision, not the outcome
  // ======================================================================
  // campaign-persistence covers what a retreat DOES to the campaign by calling
  // endBattle(false, true) directly, and world-screens covers the map-side withdraw. The
  // only path a player can actually take to that outcome — riding to your entry edge and
  // holding the direction for 1.3s — reached the 1.3s completion in no test, so neither
  // the threshold nor the "held input only" rule was pinned by anything.
  record('battle_retreat_hold_disengages', () => {
    g.scenario('battle_small');
    const b = G.scene, h = b.hero;
    g.step(1.3);
    assert(b.state === 'fight', 'the intro should be over 1.3s in, state=' + b.state);
    assert(b.approach === 'E', 'this record assumes battle_small keeps the default eastern approach, got ' + b.approach);
    // approach E puts your escape edge in the west: inside x < 70, steering left
    const toEdge = () => { h.x = 50; h.y = b.H / 2; };

    // sitting in the escape strip is not a decision: without steering out, nothing fills.
    // battle.time only advances during 'fight', so ride out the 3s gate by watching it
    // rather than by assuming how much of the intro counted.
    toEdge();
    let guard = 0;
    while (b.time <= 3.2 && guard++ < 60) { g.step(0.2); toEdge(); }
    assert(b.state === 'fight', 'the fight ended while parked at the edge, state=' + b.state);
    assert(!b.retreatT, 'parking in the escape strip must not fill the bar, retreatT=' + b.retreatT);
    assert(b.time > 3, 'the bar is gated on battle.time > 3; this record needs to be past it, time=' + b.time);

    // holding out fills it, and the HUD countdown draws while it is partial
    toEdge();
    g.key('KeyA', true);
    g.step(0.5);
    assert(b.state === 'fight', 'a half-second hold must not be enough to disengage, state=' + b.state);
    assert(b.retreatT > 0 && b.retreatT < 1.3,
      'expected a partially filled bar after 0.5s, retreatT=' + b.retreatT);

    // letting go resets it: knockback, dashes and drift can never bank progress
    g.key('KeyA', false);
    g.step(0.2);
    assert(b.retreatT === 0, 'releasing the direction must reset the bar, retreatT=' + b.retreatT);

    // and a sustained hold disengages: a loss, but a retreat, not a defeat
    toEdge();
    g.key('KeyA', true);
    g.step(1.4);
    g.key('KeyA', false);
    assert(b.state === 'end', 'a 1.4s hold at the escape edge should end the battle, state=' + b.state);
    assert(b.retreated === true, 'the ending must be flagged as a retreat, retreated=' + b.retreated);
    assert(b.victory === false, 'a retreat is not a victory, victory=' + b.victory);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to the world after the retreat banner, scene=' + g.scene());
    return 'parking did not fill the bar; 0.5s held then released reset it; 1.4s held disengaged and returned to world';
  });

  // ======================================================================
  // 3. Defeat penalties (via World.startBattle, forced loss)
  // ======================================================================
  record('defeat_penalties_via_world_battle', () => {
    g.scenario('world');
    const save = G.scene.save;
    save.gold = 100;
    save.troops = [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }, { type: 'spear' }]; // odd count
    const startGold = save.gold;
    assert(save.x === HERO_START.x && save.y === HERO_START.y,
      'fresh world did not start at WORLD.heroStart (' + HERO_START.x + ',' + HERO_START.y + ')');
    G.scene.startBattle(['bandit'], 'TEST DEFEAT', null);
    assert(g.scene() === 'battle', 'startBattle did not switch scene to battle');
    // no-combat forced defeat: all 5 troops the hero rode out with survive
    G.scene.endBattle(false);
    g.step(3); // flush the end-banner hold + onEnd
    assert(g.scene() === 'world', 'did not return to world after forced defeat, scene=' + g.scene());
    const w = g.state().world;
    const expectedGold = Math.max(25, Math.round(startGold * (1 - DEFEAT_GOLD_LOSS))); // spec v2: 30% loss with a 25g comeback floor
    assert(w.gold === expectedGold, 'defeat gold penalty: expected ' + expectedGold + ' (30% loss, 25g floor), got ' + w.gold);
    assert(w.troops === 5, 'no-combat forced defeat should keep all 5 survivors, got ' + w.troops);
    // spec v3 (phase-3 coherence): survivors carry you to the nearest settlement.
    const nearest = WORLD.settlements.reduce((best, settlement) => {
      const d = (settlement.x - HERO_START.x) ** 2 + (settlement.y - HERO_START.y) ** 2;
      const bd = (best.x - HERO_START.x) ** 2 + (best.y - HERO_START.y) ** 2;
      return d < bd ? settlement : best;
    });
    assert(w.hero.x === nearest.x && w.hero.y === nearest.y + 80,
      'defeat respawn expected nearest settlement (' + nearest.x + ',' + (nearest.y + 80) + '), got (' + w.hero.x + ',' + w.hero.y + ')');
    return 'defeat penalties correct: gold ' + startGold + '->' + w.gold + ', troops 5->' + w.troops + ', respawn at nearest settlement';
  });

  // ======================================================================
  // 3b. Volunteer-rally floor: a defeat with only 1 actual survivor tops up to 2
  //     (world.js's rally-floor branch is otherwise never exercised — a no-combat
  //     forced defeat always keeps every troop, so the floor never binds)
  // ======================================================================
  record('defeat_volunteer_rally_floor_tops_up_to_two', () => {
    g.scenario('world');
    const save = G.scene.save;
    save.gold = 100;
    save.troops = [{ type: 'spear' }, { type: 'spear' }, { type: 'spear' }];
    G.scene.startBattle(['bandit'], 'TEST DEFEAT FLOOR', null);
    assert(g.scene() === 'battle', 'startBattle did not switch scene to battle');
    // simulate real combat losses: only 1 troop rides out of this fight
    G.scene.troops = [{ type: 'spear', hp: 10 }];
    G.scene.endBattle(false);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after forced defeat, scene=' + g.scene());
    const w = g.state().world;
    assert(w.troops === 2, 'expected the volunteer-rally floor to top 1 survivor up to 2, got ' + w.troops);
    return 'volunteer-rally floor confirmed: 1 actual survivor topped up to ' + w.troops;
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
    // command starts at 'follow' by default, so tap charge/hold FIRST — otherwise a
    // Digit1 -> follow check right at battle start passes even if the binding is deleted,
    // since it's just reading the untouched initial value, not a real transition.
    g.tap('Digit3'); const c3a = g.state().battle.command;
    assert(c3a === 'hold', 'Digit3 expected command=hold, got ' + c3a);
    g.tap('Digit2'); const c2 = g.state().battle.command;
    assert(c2 === 'charge', 'Digit2 expected command=charge, got ' + c2);
    g.tap('Digit1'); const c1 = g.state().battle.command;
    assert(c1 === 'follow', 'Digit1 expected command=follow, got ' + c1);
    g.tap('Digit3'); const c3 = g.state().battle.command;
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
  // 5b. Squads: Tab selects, orders narrow to the selection, hold points are per-squad
  // ======================================================================
  record('squad_selection_and_independent_squad_orders', () => {
    g.scenario('battle_big'); // the only fixture with all three squads manned
    let introGuard = 0;
    while (g.state().battle.state === 'intro' && introGuard < 50) { g.step(0.1); introGuard++; }
    assert(g.state().battle.state !== 'intro', 'battle stuck in intro');
    const b = G.scene;
    assert(b.selectedSquad === null, 'selection must start on the whole warband, got ' + b.selectedSquad);

    // With ALL selected, a number key still moves every squad at once — this is the
    // behavior the legacy command record and the input-action contract depend on.
    g.tap('Digit2');
    assert(b.command === 'charge', 'ALL + Digit2 expected command=charge, got ' + b.command);
    for (const type of ['spear', 'archer', 'knight']) {
      assert(b.squads[type].stance === 'charge', type + ' squad ignored an ALL order');
    }

    // Tab narrows to one squad; the order must reach it and nobody else.
    g.tap('Tab');
    assert(b.selectedSquad === 'spear', 'first Tab expected the spear squad, got ' + b.selectedSquad);
    g.tap('Digit3');
    assert(b.squads.spear.stance === 'hold', 'selected squad did not take the HOLD order');
    assert(b.squads.archer.stance === 'charge', 'HOLD leaked into the bow squad');
    assert(b.squads.knight.stance === 'charge', 'HOLD leaked into the horse squad');
    assert(b.command === 'mixed', 'diverging squads should report command=mixed, got ' + b.command);

    // Only the ordered squad anchors a hold position.
    const spears = b.troops.filter(t => t.type === 'spear');
    const others = b.troops.filter(t => t.type !== 'spear');
    assert(spears.length > 0 && others.length > 0, 'fixture must man more than one squad');
    for (const t of spears) {
      assert(t.holdX != null && t.holdY != null, 'ordered spear has no hold position');
    }
    for (const t of others) {
      assert(t.holdX == null && t.holdY == null, 'a squad that was never ordered to hold has a hold point');
    }

    // Tab wraps back to the whole warband after the last manned squad.
    g.tap('Tab'); g.tap('Tab'); g.tap('Tab');
    assert(b.selectedSquad === null, 'Tab did not wrap back to the whole warband, got ' + b.selectedSquad);
    return 'ALL orders reach 3 squads; Tab-selected spear held alone (mixed aggregate); ' +
      spears.length + ' hold points set, ' + others.length + ' troops untouched';
  });

  // ======================================================================
  // 6. Economy: recruit cost / cap / gold refusals + interactive-path parity
  // ======================================================================
  record('economy_recruit_cost_cap_and_gold_refusals', () => {
    g.scenario('world');
    const save = G.scene.save;
    save.gold = 100; save.troops = [{ type: 'spear' }]; save.armyCap = ARMY_CAP_BASE;
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
    // spec v3 (phase-3 coherence): settlements quote local prices.
    assert(save.gold === 100 - SETTLEMENT_ASHFORD.spearCost,
      'interactive KeyQ recruit at Ashford expected gold ' + (100 - SETTLEMENT_ASHFORD.spearCost) + ', got ' + save.gold);
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
  // 7b. Economy: army-cap expansion (town-only) — cost, refusal, escalation
  // ======================================================================
  // The third town service had neither a success nor a refusal record, so the whole
  // EXPAND_ARMY branch and armyCapCost() were unexecuted — while recruit and heal each
  // had both. It is also the only service that raises a persisted ceiling, which is why
  // the snapshot and the recruit cap are asserted here and not just the gold.
  record('economy_army_cap_expansion_and_refusals', () => {
    g.scenario('world');
    const w = G.scene, save = w.save;
    w.hero.x = SETTLEMENT_KEEP.x; w.hero.y = SETTLEMENT_KEEP.y;

    assert(save.armyCap === ARMY_CAP_BASE,
      'a fresh run should start at BALANCE.armyCapBase (' + ARMY_CAP_BASE + '), got ' + save.armyCap);
    const firstCost = w.armyCapCost();
    assert(firstCost === BALANCE.armyCapCostBase,
      'the first expansion should cost armyCapCostBase (' + BALANCE.armyCapCostBase + '), got ' + firstCost);

    save.gold = firstCost - 1;
    g.tap('KeyT');
    assert(save.armyCap === ARMY_CAP_BASE, 'a refused expansion must not raise the cap, got ' + save.armyCap);
    assert(save.gold === firstCost - 1, 'a refused expansion must not spend gold, got ' + save.gold);
    assert(w.msg === 'Need ' + firstCost + ' gold', 'expected the priced refusal, got: ' + w.msg);

    save.gold = firstCost + 5;
    g.tap('KeyT');
    assert(save.armyCap === ARMY_CAP_BASE + 2, 'expansion should add exactly 2 cap, got ' + save.armyCap);
    assert(save.gold === 5, 'expansion should spend exactly ' + firstCost + ', gold left ' + save.gold);
    assert(w.msg === 'Army capacity is now ' + save.armyCap, 'expected the success message, got: ' + w.msg);

    // the price is a formula, not a flat fee: the next two men cost a step more
    const secondCost = w.armyCapCost();
    assert(secondCost === BALANCE.armyCapCostBase + 2 * BALANCE.armyCapCostStep,
      'the second expansion should cost base + 2 steps, got ' + secondCost);

    // the raised ceiling is what the player is actually buying — prove the recruit cap
    // moved with it, and that the new cap is in the snapshot that gets persisted
    save.gold = 500;
    save.troops = [];
    for (let i = 0; i < ARMY_CAP_BASE + 2; i++) save.troops.push({ type: 'spear' });
    w.recruit('spear');
    assert(save.troops.length === ARMY_CAP_BASE + 2, 'recruiting at the RAISED cap should still refuse');
    assert(w.msg === 'Army is at capacity', 'expected the cap refusal at the raised cap, got: ' + w.msg);
    save.troops.pop();
    w.recruit('spear');
    assert(save.troops.length === ARMY_CAP_BASE + 2,
      'one under the raised cap should recruit, got ' + save.troops.length);
    assert(w.syncLiveStateToSave().armyCap === ARMY_CAP_BASE + 2,
      'the raised cap must be in the persisted snapshot, got ' + w.syncLiveStateToSave().armyCap);

    // village gate: only a town sells capacity, and a village must not even answer
    w.hero.x = SETTLEMENT_ASHFORD.x; w.hero.y = SETTLEMENT_ASHFORD.y;
    save.gold = 500;
    const capAtVillage = save.armyCap;
    w.msg = '';
    g.tap('KeyT');
    assert(save.armyCap === capAtVillage, 'a village must not sell army capacity, cap went to ' + save.armyCap);
    assert(save.gold === 500, 'a village must not charge for it either, gold ' + save.gold);
    assert(w.msg === '', 'a village should say nothing about capacity, said: ' + w.msg);
    return 'expansion cost ' + firstCost + ' for +2 cap, refused when short, escalated to ' +
      secondCost + ', raised the recruit ceiling, persisted, and stayed town-only';
  });

  // ======================================================================
  // 8. World: winning a party battle decreases parties.length by exactly 1
  // ======================================================================
  record('world_party_battle_decreases_party_count_by_one', () => {
    g.scenario('world', { seed: 424242 }); // pinned: reproducible party spawns across runs
    const scene = G.scene;
    const before = scene.parties.length;
    assert(before > 0, 'no parties spawned to test collision against');
    let target = null;
    for (const p of scene.parties) { if (!scene.inSafeZone(p.x, p.y)) { target = p; break; } }
    assert(target, 'could not find a party outside a settlement safe zone to engage');
    scene.hero.x = target.x; scene.hero.y = target.y; scene.grace = 0;
    g.step(0.1);
    // Plan 021: the clash now opens a pre-battle brief first (world-scene modal) —
    // confirm it to actually enter battle.
    assert(g.scene() === 'world' && G.scene.screen && G.scene.screen.kind === 'brief',
      'hero-party collision did not open the pre-battle brief, scene=' + g.scene());
    g.tap('Enter');
    assert(g.scene() === 'battle', 'confirming the brief did not start a battle, scene=' + g.scene());
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after party battle, scene=' + g.scene());
    const after = g.state().world.parties;
    assert(after === before - 1, 'expected parties.length ' + before + ' -> ' + (before - 1) + ', got ' + after);
    return 'party count ' + before + ' -> ' + after + ' after winning a party battle';
  });

  // ======================================================================
  // 9. World: camp raid razes the camp (and never changes the warband)
  // ======================================================================
  record('world_camp_raid_razes_camp', () => {
    g.scenario('world', { seed: 424242 }); // pinned: reproducible garrison rolls across runs
    const scene = G.scene;
    const campState = scene.save.camps.find(c => c.id === 'c1');
    assert(campState && !campState.razed, 'camp c1 expected un-razed at fresh world start');
    scene.hero.x = CAMP_C1.x; scene.hero.y = CAMP_C1.y;
    const goldBefore = scene.save.gold, troopsBefore = scene.save.troops.length;
    g.tap('KeyE');
    // Plan 021: E on a camp now opens the assault brief; confirm it to actually raid.
    assert(g.scene() === 'world' && G.scene.screen && G.scene.screen.kind === 'brief',
      'KeyE near camp did not open the assault brief, scene=' + g.scene());
    g.tap('Enter');
    assert(g.scene() === 'battle', 'confirming the assault brief did not start a battle, scene=' + g.scene());
    const nEnemies = G.scene.totalEnemies;
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after camp raid, scene=' + g.scene());
    const save2 = G.scene.save;
    const c1After = save2.camps.find(c => c.id === 'c1');
    assert(c1After.razed === true, 'camp c1 razed flag not set true after victorious raid');
    const expectedLoot = LOOT_BASE + LOOT_PER_ENEMY * nEnemies + 60; // battle loot + non-stronghold camp bonus
    assert(save2.gold === goldBefore + expectedLoot, 'expected gold ' + (goldBefore + expectedLoot) + ', got ' + save2.gold);
    // Razing a camp pays gold only — the warband grows at settlements, never from a raid.
    assert(save2.troops.length === troopsBefore,
      'expected troops to stay at ' + troopsBefore + ' after a raid, got ' + save2.troops.length);
    return 'camp c1 razed=true, gold +' + expectedLoot + ', troops unchanged at ' + troopsBefore;
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
    g.scenario('world', { seed: 424242 }); // pinned: reproducible party spawns across runs
    const scene = G.scene;
    let target = null;
    for (const p of scene.parties) { if (!scene.inSafeZone(p.x, p.y)) { target = p; break; } }
    assert(target, 'no engageable party found');
    scene.hero.x = target.x; scene.hero.y = target.y; scene.grace = 0;
    g.step(0.1);
    // Plan 021: the clash opens the pre-battle brief first; confirm it to enter battle.
    assert(g.scene() === 'world' && G.scene.screen && G.scene.screen.kind === 'brief',
      'party collision did not open the pre-battle brief, scene=' + g.scene());
    g.tap('Enter');
    assert(g.scene() === 'battle', 'confirming the brief did not start a battle, scene=' + g.scene());
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world');
    // Plan 021: battle end now opens an aftermath modal, which freezes `grace` (it only
    // decays inside updateParties, which the modal gate skips) — dismiss it before
    // sampling decay below, or the timer would never move while it sits open.
    assert(G.scene.screen && G.scene.screen.kind === 'aftermath',
      'expected the aftermath screen to be open after battle end');
    g.tap('Enter');
    assert(!G.scene.screen, 'aftermath did not dismiss on confirm');
    // isolate the rest of the observation from any other roaming party
    G.scene.hero.x = SETTLEMENT_ASHFORD.x; G.scene.hero.y = SETTLEMENT_ASHFORD.y;
    // Plan 023: `grace` only decays while world time flows, and this record parks the hero
    // in Ashford ON PURPOSE to isolate the decay curve from other contact. keepAwake()
    // keeps the world simulating without moving the hero, so the curve sampled below is the
    // timer's own decay exactly as before — the stopped-hero freeze has its own coverage in
    // world-freeze.spec.js.
    g.keepAwake(true);
    const graceAtStart = G.scene.grace;
    assert(typeof graceAtStart === 'number' && !Number.isNaN(graceAtStart),
      'World.grace was not a number right after returning to world (got ' + graceAtStart + ')');
    assert(graceAtStart > BATTLE_GRACE - 1.5 && graceAtStart <= BATTLE_GRACE + 0.01,
      'expected grace timer near ' + BATTLE_GRACE + 's (BALANCE.battleGrace) right after returning to world, got ' + graceAtStart.toFixed(2));
    g.step(3);
    assert(g.scene() === 'world', 'left world scene while observing grace decay, scene=' + g.scene());
    const graceAfter = G.scene.grace;
    assert(typeof graceAfter === 'number', 'World.grace became non-numeric after stepping 3s more (got ' + graceAfter + ')');
    assert(graceAfter >= 0 && graceAfter < graceAtStart, 'expected grace to have decayed, got ' + graceAfter.toFixed(2));
    g.step(4); // >6s total elapsed since battle end
    assert(g.scene() === 'world', 'left world scene while observing grace decay, scene=' + g.scene());
    const graceLate = G.scene.grace;
    assert(typeof graceLate === 'number', 'World.grace became non-numeric after stepping 7s total (got ' + graceLate + ')');
    assert(graceLate <= 0, 'expected grace timer to reach 0 after > ' + BATTLE_GRACE + 's total, got ' + graceLate.toFixed(2));
    return 'grace timer: ' + graceAtStart.toFixed(2) + 's at return -> ' + graceAfter.toFixed(2) + 's after 3s -> ' + graceLate.toFixed(2) + 's after 7s (decays to 0)';
  });

  // ======================================================================
  // 11. World: spawned party strength always stays within [2, 24]
  // ======================================================================
  record('world_party_strength_stays_in_2_24_band', () => {
    g.scenario('world', { seed: 424242 }); // pinned: reproducible rng stream across runs
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
  // Plan 020: weighted spawn tiers replace the deleted 0.7-1.2x fair-band guarantee.
  // Swept over several pinned seeds (lesson from Plan 019: never trust one seed for a
  // balance/distribution claim) rather than asserted from a single run.
  // ======================================================================
  record('world_party_spawn_tiers_weighted_toward_strong', () => {
    const seeds = [1, 42, 999, 20260817, 555];
    const N = 200;
    // gaps between the declared tiers (weak .45-.7, even .8-1.2, strong 1.5-2.2) — the
    // midpoints of the empty bands, so rounding noise from spawnParty's integer target
    // can never push a draw across a classification boundary.
    const tierOf = ratio => (ratio <= 0.75 ? 'weak' : ratio >= 1.35 ? 'strong' : 'even');
    let weak = 0, even = 0, strong = 0, other = 0;
    let weakAtZero = 0, strongAtZero = 0, weakAtThree = 0, strongAtThree = 0;
    for (const seed of seeds) {
      g.scenario('world', { seed });
      const scene = G.scene;
      const mine = scene.myStrength();
      for (let i = 0; i < N; i++) {
        scene.spawnParty(CAMP_C1); // no band -> the weighted tier draw under test
        const ratio = scene.strength(scene.parties[scene.parties.length - 1].comp) / mine;
        const tier = tierOf(ratio);
        if (tier === 'weak') { weak++; weakAtZero++; }
        else if (tier === 'strong') { strong++; strongAtZero++; }
        else if (tier === 'even') even++;
        else other++;
      }
      // now with every raidable camp razed, to confirm design decision 1: weights shift
      // toward `strong` (and away from `weak`) as camps fall across a run.
      for (const c of scene.save.camps) if (c.id !== 'strong') c.razed = true;
      for (let i = 0; i < N; i++) {
        scene.spawnParty(CAMP_C1);
        const ratio = scene.strength(scene.parties[scene.parties.length - 1].comp) / mine;
        const tier = tierOf(ratio);
        if (tier === 'weak') weakAtThree++;
        else if (tier === 'strong') strongAtThree++;
      }
    }
    assert(other === 0, 'a spawned party landed outside all three declared tiers: other=' + other);
    assert(weak > 0 && even > 0 && strong > 0,
      'expected all three tiers over ' + (seeds.length * N) + ' draws, got weak=' + weak + ' even=' + even + ' strong=' + strong);
    assert(strongAtThree > strongAtZero,
      'expected the strong tier to grow more common once every camp is razed: razed=0 strong=' + strongAtZero + ', razed=3 strong=' + strongAtThree);
    assert(weakAtThree < weakAtZero,
      'expected the weak tier to grow less common once every camp is razed: razed=0 weak=' + weakAtZero + ', razed=3 weak=' + weakAtThree);
    return 'over ' + seeds.length + ' seeds x ' + N + ' draws: weak=' + weak + ' even=' + even + ' strong=' + strong +
      '; razed 0->3 shifted weak ' + weakAtZero + '->' + weakAtThree + ', strong ' + strongAtZero + '->' + strongAtThree;
  });

  // ======================================================================
  // 11c. World: the spawn timer is what actually puts parties on the map
  // ======================================================================
  // Every other party record places its parties by fixture or calls spawnParty() directly,
  // so updatePartySpawns() itself — the 30s-then-40s cadence, the cap it respects, and the
  // persistParties() that follows a spawn — was never executed by the gate. The tier
  // weighting could be perfect and the campaign could still never spawn anything.
  record('world_party_spawn_timer_fills_the_map_to_its_cap', () => {
    g.scenario('world', { seed: 4242 });
    const w = G.scene;
    // Ashford is a safe zone, so parking here keeps a spawned party from clashing and
    // ending the observation early. keepAwake() runs the world with the hero stopped
    // (Plan 023 freezes it otherwise) and must be re-applied after every scenario().
    w.hero.x = SETTLEMENT_ASHFORD.x; w.hero.y = SETTLEMENT_ASHFORD.y;
    g.keepAwake(true);
    // g.step() clamps to 30 sim-seconds per call; the fixed timestep makes chunking exact
    const run = seconds => { let left = seconds; while (left > 0) { const chunk = Math.min(25, left); g.step(chunk); left -= chunk; } };

    const cap = w.partyCap();
    const start = w.parties.length;
    assert(cap === 2 + w.liveCamps().length * 2, 'partyCap() is not the documented 2 + 2 per live camp, got ' + cap);
    assert(start < cap, 'a fresh run should start below the cap so the timer has room, ' + start + ' of ' + cap);
    assert(w.spawnT === 30, 'the first spawn should be armed at 30s, spawnT=' + w.spawnT);

    run(35);
    assert(g.scene() === 'world', 'left the world scene during the first spawn window, scene=' + g.scene());
    assert(w.parties.length === start + 1,
      'expected exactly one spawn by 35s, went ' + start + ' -> ' + w.parties.length);

    // cadence: the second spawn is 40s after the first, not another 30
    run(30); // t = 65
    assert(w.parties.length === start + 1,
      'a second party arrived before 40s had passed, count ' + w.parties.length + ' at 65s');
    run(10); // t = 75
    assert(w.parties.length === start + 2,
      'expected the second spawn by 75s (30 + 40), got ' + w.parties.length);

    // and it fills to the cap and then stops
    let guard = 0;
    while (w.parties.length < cap && g.scene() === 'world' && guard++ < 20) run(40);
    assert(g.scene() === 'world', 'left the world scene while filling to the cap, scene=' + g.scene());
    assert(w.parties.length === cap, 'the map never filled to its cap of ' + cap + ', stalled at ' + w.parties.length);
    run(120); // three more spawn windows with no room left
    assert(w.parties.length === cap,
      'the spawn timer pushed past the cap of ' + cap + ' to ' + w.parties.length);

    // a spawn persists the roster: the snapshot the campaign saves must agree with the map
    const snapshot = w.syncLiveStateToSave();
    assert((snapshot.parties || []).length === w.parties.length,
      'the persisted snapshot holds ' + (snapshot.parties || []).length + ' parties but the map holds ' + w.parties.length);
    return 'spawned on the 30s arm, held the 40s cadence, filled to the cap of ' + cap +
      ' and stopped there, with the roster persisted';
  });

  // ======================================================================
  // Plan 020: an ignored chasing party breaks off, occupies the nearest settlement
  // (suspending its service), and a recapture restores it. Driven as one controlled
  // tick (matching tests/e2e/world-battle-seams.spec.js) rather than simulating 20+
  // real seconds of chase, which would let the party actually catch the stationary
  // hero first and produce a flaky fixture.
  // ======================================================================
  record('world_party_break_off_occupies_settlement_and_recapture_restores_service', () => {
    g.scenario('world', { seed: 424242 });
    const scene = G.scene;
    const mine = scene.myStrength();
    const target = WORLD.settlements.find(s => s.id === 'brindle');
    scene.parties.length = 0;
    scene.hero.x = 200; scene.hero.y = 200; // far from every settlement, and from the fixture party
    scene.grace = 0;
    const party = {
      camp: 'c1', x: target.x, y: target.y, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: Array.from({ length: Math.ceil(mine * 1.6) }, () => 'bandit'),
      home: { x: CAMP_C1.x, y: CAMP_C1.y }, wander: null, wanderT: 999, waryT: 0, clashT: 0,
      occupying: null, raid: null, mood: 'chase', chaseT: 25, chaseHoldT: BALANCE.raidBreakOffT,
    };
    scene.parties.push(party);
    assert(scene.strength(party.comp) > mine * 1.3, 'fixture party must exceed the AI\'s own outmatch threshold');

    scene.updateParties(1 / 60); // one controlled tick: the break-off timer is already at threshold
    assert(party.raid === 'brindle', 'expected the party to break off toward brindle, got raid=' + party.raid);

    scene.updateParties(1 / 60); // placed exactly at the settlement, so arrival is immediate
    assert(party.occupying === 'brindle', 'expected the party to occupy brindle, got ' + party.occupying);
    assert(scene.save.settlements.find(s => s.id === 'brindle').occupied === true,
      'save.settlements[brindle].occupied was not set true on arrival');

    // service suspension: recruiting at an occupied settlement must refuse and say so
    scene.hero.x = target.x; scene.hero.y = target.y;
    const goldBefore = scene.save.gold, troopsBefore = scene.save.troops.length;
    G.input.injectKey('KeyQ', true);
    scene.updateSettlementInteractions(G.input);
    G.input.injectKey('KeyQ', false);
    assert(scene.save.gold === goldBefore && scene.save.troops.length === troopsBefore,
      'recruiting succeeded at an occupied settlement');

    // recapture: walking onto the occupier and winning restores the service
    scene.hero.x = party.x; scene.hero.y = party.y;
    g.step(0.1);
    // Plan 021: the clash opens the pre-battle brief first; confirm it to enter battle.
    assert(g.scene() === 'world' && G.scene.screen && G.scene.screen.kind === 'brief',
      'walking onto the occupier did not open the pre-battle brief, scene=' + g.scene());
    g.tap('Enter');
    assert(g.scene() === 'battle', 'confirming the brief did not start a battle, scene=' + g.scene());
    G.scene.endBattle(true);
    g.step(3);
    assert(g.scene() === 'world', 'did not return to world after defeating the occupier, scene=' + g.scene());
    assert(G.scene.save.settlements.find(s => s.id === 'brindle').occupied === false,
      'expected brindle occupation to clear after defeating the occupier there');
    return 'break-off -> occupies brindle -> service suspended -> recapture clears occupation and restores it';
  });

  // ======================================================================
  // Plan 020 STOP condition: the campaign must never reach a state with every
  // settlement occupied and nothing on the map the player can beat. This DRIVES the
  // worst case (three settlements already occupied by overwhelming parties, plus one
  // more overwhelming roaming party) rather than asserting the happy path.
  // ======================================================================
  record('world_floor_guarantee_prevents_unwinnable_deadlock', () => {
    g.scenario('world', { seed: 424242 });
    const scene = G.scene;
    const mine = scene.myStrength();
    const overwhelming = () => Array.from({ length: Math.ceil(mine * 2) }, () => 'brute');
    const occupiedIds = ['ashford', 'coldwell', 'keep'];
    scene.save.settlements = WORLD.settlements.map(s => ({ id: s.id, occupied: occupiedIds.includes(s.id) }));
    scene.parties.length = 0;
    for (const id of occupiedIds) {
      const s = WORLD.settlements.find(x => x.id === id);
      scene.parties.push({
        camp: 'c1', x: s.x, y: s.y, vx: 0, vy: 0, facing: 0, bob: 0,
        comp: overwhelming(), home: { x: CAMP_C1.x, y: CAMP_C1.y }, wander: null, wanderT: 999,
        waryT: 0, clashT: 0, occupying: id, raid: null,
      });
    }
    // one more overwhelming roaming party, so nothing on the map is winnable yet
    scene.parties.push({
      camp: 'c1', x: 1600, y: 1000, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: overwhelming(), home: { x: CAMP_C1.x, y: CAMP_C1.y }, wander: { x: 1600, y: 1000 }, wanderT: 999,
      waryT: 0, clashT: 0, occupying: null, raid: null,
    });
    assert(scene.parties.every(p => scene.strength(p.comp) > mine * BALANCE.beatablePartyRatio),
      'fixture setup: every party must start out unbeatable');

    // 1. the beatable-party floor must produce a winnable target on the very next check
    scene.enforceBeatableFloor();
    assert(scene.parties.some(p => scene.strength(p.comp) <= mine * BALANCE.beatablePartyRatio),
      'enforceBeatableFloor left every live party unbeatable');

    // 2. the last fully unclaimed settlement (brindle) must never become claimable: a
    // party trying to break off toward it — with only one settlement free — must be refused
    const raider = {
      camp: 'c1', x: 1000, y: 1000, vx: 0, vy: 0, facing: 0, bob: 0,
      comp: overwhelming(), home: { x: CAMP_C1.x, y: CAMP_C1.y }, wander: null, wanderT: 999,
      waryT: 0, clashT: 0, occupying: null, raid: null, mood: 'chase', chaseT: 25,
      chaseHoldT: BALANCE.raidBreakOffT,
    };
    scene.parties.push(raider);
    scene.hero.x = 50; scene.hero.y = 50; scene.grace = 0; // far from everything, not in a safe zone
    scene.updateParties(1 / 60);
    assert(raider.raid === null && raider.occupying === null,
      'a break-off claimed the last fully unclaimed settlement — deadlock is now reachable (raid=' + raider.raid + ')');
    const stillFree = scene.save.settlements.filter(s => !s.occupied &&
      !scene.parties.some(p => p.raid === s.id || p.occupying === s.id));
    assert(stillFree.length >= 1, 'expected at least one settlement to remain fully unclaimed, got ' + stillFree.length);
    return 'worst case driven: the beatable floor produced a winnable party, and ' +
      stillFree.map(s => s.id).join(',') + ' stayed unclaimed and reachable';
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
  // 12b. RNG domains: presentation effects cannot perturb simulation
  // ======================================================================
  record('rng_domains_keep_simulation_independent_of_effects', () => {
    function battleSnapshot(effectsEnabled) {
      g.effects(effectsEnabled);
      g.scenario('battle_small');
      g.tap('Digit2');
      g.step(4);
      const b = G.scene;
      assert(G.sceneName === 'battle', 'battle fixture ended before RNG comparison');
      return {
        hero: { x: b.hero.x, y: b.hero.y, vx: b.hero.vx, vy: b.hero.vy, hp: b.hero.hp },
        troops: b.troops.map(t => ({ type: t.type, x: t.x, y: t.y, vx: t.vx, vy: t.vy, hp: t.hp, cd: t.cd })),
        enemies: b.enemies.map(e => ({ type: e.type, x: e.x, y: e.y, vx: e.vx, vy: e.vy, hp: e.hp, cd: e.cd })),
        projectiles: b.projectiles.map(p => ({ tx: p.tx, ty: p.ty, t: p.t, T: p.T, friendly: p.friendly, dmg: p.dmg })),
        state: b.state, kills: b.kills, time: b.time, bloodlust: b.bloodlust,
      };
    }
    const withEffects = battleSnapshot(true);
    const withoutEffects = battleSnapshot(false);
    assert(JSON.stringify(withEffects) === JSON.stringify(withoutEffects), 'effect toggle changed canonical battle simulation state');
    assert(G.scene.particles.list.length === 0, 'disabled effects still emitted particles');

    function worldSnapshot(effectsEnabled) {
      g.effects(effectsEnabled);
      g.scenario('world', { seed: 0 });
      // Exercise the same fixed-timestep input script in both modes. Movement
      // emits dust, while party navigation and campaign updates remain gameplay.
      g.key('ArrowRight', true);
      g.step(1.5);
      g.key('ArrowRight', false);
      g.step(1.5);
      const w = G.scene;
      const point = value => value ? { x: value.x, y: value.y } : null;
      return {
        time: w.time, spawnT: w.spawnT,
        hero: { x: w.hero.x, y: w.hero.y, vx: w.hero.vx, vy: w.hero.vy },
        save: {
          gold: w.save.gold, heroHp: w.save.heroHp, heroMaxHp: w.save.heroMaxHp,
          armyCap: w.save.armyCap, won: w.save.won, battleCount: w.save.battleCount,
          troops: w.save.troops.map(t => ({ type: t.type, hp: t.hp })),
          camps: w.save.camps.map(c => ({ id: c.id, razed: c.razed, garrison: c.garrison ? [...c.garrison] : null })),
        },
        parties: w.parties.map(p => ({
          camp: p.camp, x: p.x, y: p.y, vx: p.vx, vy: p.vy, comp: [...p.comp], home: point(p.home),
          waryT: p.waryT, chaseT: p.chaseT, wanderT: p.wanderT, wander: point(p.wander),
          navT: p.navT, navGoal: point(p.navGoal), navFor: point(p.navFor), mood: p.mood,
        })),
      };
    }
    const worldWithEffects = worldSnapshot(true);
    const worldWithoutEffects = worldSnapshot(false);
    assert(JSON.stringify(worldWithEffects) === JSON.stringify(worldWithoutEffects), 'effect toggle changed canonical world simulation state');
    assert(G.scene.particles.list.length === 0, 'disabled world effects still emitted particles');

    // Keep a separate replay assertion so seed zero remains covered independently
    // of the effects comparison above.
    const zeroA = worldSnapshot(false), zeroB = worldSnapshot(false);
    assert(JSON.stringify(zeroA) === JSON.stringify(zeroB), 'seed zero world replay was not deterministic');
    g.effects(true);
    return 'battle state matched with effects enabled/disabled and seed-zero world replay matched';
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
      g.scenario('world', { seed: 424242 }); // pinned: reproducible across runs
      const w = G.scene;
      w.grace = 0;
      w.hero.x = c.hx; w.hero.y = c.hy;
      w.save.troops = [{ type: 'spear' }];
      w.parties.length = 0;
      w.parties.push({ camp: 'c1', x: c.px, y: c.py, vx: 0, vy: 0, facing: 0, bob: 0,
        comp: ['bandit', 'bandit', 'bandit', 'bandit', 'brute'], home: { x: 1050, y: 1500 }, wander: null, wanderT: 0 });
      const p = w.parties[0];
      // Plan 023: party AI only runs while the hero rides, and every case here parks the
      // hero at a fixed spot to pin the pursuit geometry. Re-applied per case because
      // scenario() above builds a brand-new World each time.
      g.keepAwake(true);
      let resolved = false;
      for (let i = 0; i < 40; i++) {
        g.step(1);
        if (g.scene() !== 'world') { resolved = true; break; } // battle = pursuit succeeded
        // Plan 021: reaching the hero now opens a pre-battle brief (still scene 'world')
        // instead of committing straight to battle — equally conclusive proof the party
        // was NOT stuck, since it demonstrably reached its target. Confirm it so the
        // party is actually removed rather than leaving a screen open into the next case.
        if (G.scene.screen && G.scene.screen.kind === 'brief') { g.tap('Enter'); resolved = true; break; }
        if (Math.hypot(p.x - c.px, p.y - c.py) > 200) { resolved = true; break; } // moving with purpose
      }
      assert(resolved, 'party frozen at (' + c.px + ',' + c.py + ') vs hero (' + c.hx + ',' + c.hy + ') — moved <200px in 40s');
    }
    return 'all 5 river-pursuit cases resolved (crossed, fought, or moved on) — no freezes';
  });

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}

window.runQaSuite = function () {
  // actually re-runs the suite against the game's current (possibly edited) code,
  // instead of returning whatever __qaResult held from the last paste.
  window.__qaResult = runQaSuiteImpl();
  return window.__qaResult;
};

window.__qaResult = runQaSuiteImpl();
window.__qaResult;
