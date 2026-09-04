// Plan 038 Slice A — the campaign harness.
//
// The battle layer has been measured to three digits since Plan 028. The campaign layer
// never had a harness at all: no plan records time-to-victory, the gold curve, fights per
// run, or which route a scripted player takes to Wolfsjaw. This module is that harness.
//
// It is browser-side code passed through `page.evaluate`, exactly like `raidSweep` in
// tests/e2e/stance-balance.spec.js. Everything it drives goes through the PRODUCTION
// entries — the one map verb opens the site menu, a row opens the brief, the brief opens
// the deployment phase, the deployment confirm starts the fight — and every one of those
// edges is asserted rather than skipped, so a run can never silently measure nothing.
//
// Three rules make the measurement honest, and each is a deliberate limitation:
//
//   * TRAVEL IS TELEPORT PLUS CLOCK. Riding around the rivers cannot be scripted
//     reliably (the 2026-09-02 playtest hero sat 14 s against a bank), so each leg sets
//     `hero.x/y` to the destination and then ticks `distance / HERO.speed` seconds with
//     the hero kept awake, so spawns, raids, party moods and the raid timer advance as
//     they would on a real ride. THE BLIND SPOT: a party that would have intercepted the
//     ride does not. Every number this harness produces is for a player who is never
//     ambushed in transit.
//   * THE HERO NEVER SWINGS. The harness cannot script hero input (Plan 035's stated
//     limit), so every fight is decided by the warband and the orders. The bands already
//     price the sword; a scripted swing would be an invented player.
//   * ORDERS ARE `chargeAll`. The one policy Plan 033 measured as beating pressing
//     nothing (60% against 49% on the shipped sweep).
//
// A run stops at victory, at a wall of flowing seconds, or at a battle cap, and records
// which. The same seed and policy must produce a byte-identical record twice; that
// contract is asserted by campaign-arc.spec.js and is the thing every number rests on.
//
// THE FOUR POLICIES. Each is a scripted player: a route of objectives plus a spend rule.
// They are deliberately simple and deliberately different, because the question the
// harness exists to answer is which ROUTE the campaign rewards.
//
//   claimRush        claim the four settlements nearest-first, then storm. No purchases
//                    at all, and no shopping stop. This is the route the 2026-09-02 audit
//                    called the credible fastest win.
//   campRaider       raid c1, c2, c3 in `tier` order, then storm, with a shopping stop
//                    before each.
//   captureThenRaze  claim two, raze one, claim two, raze two, storm.
//   farmer           campRaider's route, but it hunts up to three favourable roaming
//                    parties before each objective and shops at the TOWN so it can buy
//                    knights.
//
// A FIFTH POLICY WAS WRITTEN AND THEN REMOVED, which is worth recording because the
// removal is the finding. Plan 039 added `rebuilder` — campRaider's route plus "while
// `World.inDistress()`, rebuild instead of marching on" — to measure whether a wiped
// campaign can climb back. Measured over 12 seeds it took ZERO recovery fights and
// produced records indistinguishable from `campRaider` (identical on 7 seeds, and
// differing by one second of campaign time on the rest). The reason is the answer: after
// Plan 039's muster, the ordinary shopping stop every policy already makes is enough to
// lift a warband out of distress before the next objective. Recovery does not need a
// special player, so shipping a policy that duplicates another would have doubled the
// sweep's cost for no signal. See critiques/campaign-arc-comparison.md.
//
// The spend rule for the last three is: rest and heal when the column is hurt, then fill
// the column with the cheapest body this settlement quotes, then expand the column when
// it is full and the expansion is affordable — repeated until nothing is affordable.
// `farmer` buys a knight first when it is standing in a town.
//
// TWO MODELLING CHOICES worth naming, because both change the numbers:
//
//   * The heal rule reads the WARBAND, not only the hero. A troop record carries its hit
//     points between fights and `playerStrength` prices bodies at full health, so a
//     policy that only healed the hero rode half-dead columns into fights the record then
//     called even. That is a broken model of a player, not a frugal one.
//   * A camp is attempted ONCE. A policy that lost a raid moves on rather than healing up
//     and coming back, which is what most players would do. This makes `campRaider`
//     pessimistic on seeds where an early raid goes badly, and it is stated here rather
//     than tuned away.
export const DT = 1 / 60;

// A campaign is roughly 25 battles at up to 95 s of simulated time each, so these are
// the run's own bounds rather than a test timeout.
export const CAMPAIGN_DEFAULTS = Object.freeze({
  dt: DT,
  wallT: 3600,          // flowing campaign seconds before the run is called off
  maxBattles: 60,
  battleTimeoutS: 95,   // same window the shipped sweep scores an unresolved fight in
  resolve: 'real',      // 'real' fights it; 'forced' wins at the deploy confirm
  orders: { spear: 'charge', archer: 'charge', knight: 'charge' },
});

export const POLICIES = Object.freeze(['claimRush', 'campRaider', 'captureThenRaze', 'farmer']);

// ---------------------------------------------------------------------------
// The browser-side run. Serialized into the page by `runCampaign` below; it may close
// over nothing, so every helper it needs is defined inside it.
// ---------------------------------------------------------------------------
async function campaignBody(opts) {
  const { seed, policy, resolve, dt, wallT, maxBattles, battleTimeoutS, orders } = opts;
  const { WORLD, BALANCE, HERO, enemyStrength, troopMaxHp } = await import('/src/data.js');
  const { strongholdStateId, strongholdPoints } = await import('/src/region.js');
  const { perkMods } = await import('/src/progression.js');
  const { ACTIONS } = await import('/src/input-actions.js');

  const game = window.__g;
  // Outcomes depend on canvas size (the fit-to-action camera feeds hero aim, which feeds
  // FOLLOW formation), so pin it before measuring anything — same rule raidSweep keeps.
  const canvas = document.getElementById('game');
  canvas.width = 1280; canvas.height = 720;
  game.camera.w = 1280; game.camera.h = 720;

  window.game.scenario('world', { seed });
  const real = game.update.bind(game);
  game.update = () => {}; // park the live scheduler; only explicit steps advance anything

  const DONE = { done: true }; // sentinel used to unwind out of a nested route step
  const rec = {
    seed, policy, resolve,
    outcome: null, playT: 0, flowT: 0,
    battles: 0, wins: 0, losses: 0, retreats: 0,
    goldEarned: 0, goldSpent: 0, finalGold: 0, finalWeight: 0,
    razed: 0, captures: 0, raidsLanded: 0, raidsDefended: 0,
    claimsRefused: 0, floorFires: 0, unresolved: 0, raidsDispatched: 0,
    strongholdStateAtStorm: null, strongholdPointsAtStorm: null,
    storm: null,
    fights: [],
    claimVisits: [],
  };

  let world = null;          // the CURRENT World instance (rebuilt after every battle)
  let lastSave = null;       // the save object, stable across World instances
  let occupiedNow = '';      // occupation snapshot, for counting raids that landed
  let routeCommit = false;   // true while a route step's own fight is being confirmed
  let routeKind = null;      // 'hunt' when the fight was sought by the farmer policy
  let pendingFight = null;   // what the brief about to be confirmed is a fight WITH
  let drivingMenu = false;   // the site menu is open on purpose; pump must not touch it

  // --- instrumentation -----------------------------------------------------
  // `enforceBeatableFloor` is an emergency correction, and how often it fires is one of
  // the numbers this harness exists to report. Counted by observing whether the call
  // actually rewrote the map, not by counting invocations (it runs every live tick).
  function adopt(scene) {
    if (scene === world) return;
    world = scene;
    lastSave = scene.save;
    window.game.keepAwake(true); // scoped to the CURRENT scene — re-applied after each battle
    const original = scene.enforceBeatableFloor.bind(scene);
    scene.enforceBeatableFloor = function () {
      const before = scene.parties.map(p => p.comp.join('+')).join('|');
      original();
      if (scene.parties.map(p => p.comp.join('+')).join('|') !== before) rec.floorFires++;
    };
    occupiedNow = (scene.save.settlements || []).filter(s => s.occupied).map(s => s.id).join(',');
    ridingNow = scene.parties.filter(p => p.raidKind === 'regional' && p.raid).length;
  }

  // How often Wolfsjaw actually rode out, as distinct from how often it ARRIVED
  // (`raidsLanded`). Counted as a rise in the number in transit, so it is exact within one
  // World; a raid that survives a battle is re-counted once when the World is rebuilt,
  // which makes this an upper bound rather than an exact figure. It exists to tell "the
  // hold never dispatched" apart from "the campaign ended before the raid arrived".
  let ridingNow = 0;
  function noteRaids() {
    const riding = world.parties.filter(p => p.raidKind === 'regional' && p.raid).length;
    if (riding > ridingNow) rec.raidsDispatched += riding - ridingNow;
    ridingNow = riding;
  }

  function noteOccupation() {
    const now = (world.save.settlements || []).filter(s => s.occupied).map(s => s.id).join(',');
    if (now !== occupiedNow) {
      const before = occupiedNow ? occupiedNow.split(',') : [];
      for (const id of (now ? now.split(',') : [])) if (!before.includes(id)) rec.raidsLanded++;
      occupiedNow = now;
    }
  }

  // --- input ---------------------------------------------------------------
  // One production press through one full update, the exact shape a real keypress takes.
  function press(action) {
    window.game.action(action, true);
    real(dt);
    window.game.action(action, false);
  }

  function flowingTick() {
    real(dt);
    if (game.sceneName === 'world' && world) {
      if (world.timeFlowing() && !world.isBlocking()) rec.flowT += dt;
      noteOccupation();
      noteRaids();
    }
  }

  function checkStop() {
    if (rec.flowT >= wallT) { rec.outcome = 'wall'; throw DONE; }
    if (rec.battles >= maxBattles) { rec.outcome = 'cap'; throw DONE; }
  }

  // --- the modal resolver --------------------------------------------------
  // Runs after every tick. An unhandled screen kind THROWS: never `continue` past a modal,
  // or the run silently measures a campaign that is standing still behind a prompt.
  function pump() {
    for (let guard = 0; guard < 4000; guard++) {
      if (game.sceneName === 'victory') { rec.outcome = 'won'; throw DONE; }
      if (game.sceneName === 'battle') { runBattle(); continue; }
      if (game.sceneName !== 'world') {
        throw new Error('campaign left the world for an unexpected scene: ' + game.sceneName);
      }
      adopt(game.scene);
      const screen = world.screen;
      if (!screen) return;
      switch (screen.kind) {
        case 'aftermath':
          press(ACTIONS.CONFIRM);
          break;
        case 'spec':
        case 'perk': {
          // These appear unbidden on the tick the aftermath closes and refuse CONFIRM for
          // CHOICE_ARM_T. A fixture waits it out exactly like a player does.
          let armGuard = 0;
          while (world.screen && world.screen.armT > 0 && armGuard++ < 240) flowingTick();
          press(ACTIONS.CONFIRM); // commits the first option — permanent, deterministic
          break;
        }
        case 'brief':
          resolveBrief();
          break;
        case 'site':
          if (drivingMenu) return;
          throw new Error('a site menu was open outside a scripted menu step');
        default:
          throw new Error('unhandled world screen kind: ' + screen.kind);
      }
    }
    throw new Error('the modal resolver did not settle');
  }

  // The policy's fight rule: withdraw when the fight was NOT chosen by the route, the
  // brief offers the out, and the force on the other side outmatches the warband.
  function resolveBrief() {
    const d = world.pending && world.pending.descriptor;
    if (!d) throw new Error('a brief is open with no pending descriptor');
    const comp = d.comp;
    const mine = world.myStrength();
    const outmatched = comp ? enemyStrength(comp) > mine * BALANCE.oddsStronger : false;
    if (!routeCommit && d.canWithdraw && outmatched) {
      rec.retreats++;
      press(ACTIONS.WITHDRAW);
      return;
    }
    pendingFight = {
      kind: d.campId === 'strong' ? 'storm'
        : d.campId ? 'raid'
        : routeKind === 'hunt' ? 'hunt'
        : /^DEFENSE OF/.test(d.title || '') ? 'defense'
        : d.party && d.party.occupying ? 'retake'
        : 'party',
      mine,
    };
    press(ACTIONS.CONFIRM);
  }

  // --- one battle, through the production entry with every edge asserted ---
  function runBattle() {
    const b = game.scene;
    const meta = pendingFight || { kind: 'party', mine: 0 };
    pendingFight = null;
    const goldBefore = lastSave.gold;
    const earnedBefore = (lastSave.stats || {}).goldEarned || 0;
    // An idle hero aims at the cursor and FOLLOW slots hang off hero facing, so the
    // pointer is a real simulation input. Pin it, and clear any residual camera shake.
    game.input.injectMouse(640, 360, false);
    game.camera.shakeT = 0; game.camera.shakeAmp = 0; game.camera.sx = 0; game.camera.sy = 0;
    const enemyWeight = enemyStrength(b.setup.enemies);
    const startTroops = b.startTroops;

    let t = 0;
    // Orders issued during `intro` are discarded, so wait the banner out first.
    while (b.state === 'intro' && t < 3) { real(dt); t += dt; }
    // Plan 033: a chosen fight pauses on the deployment phase. Arm CONFIRM, then press it.
    // An ambush and a run-down have no deploy phase and go straight to `fight`.
    let armT = 0;
    while (b.state === 'deploy' && armT < 0.5) { real(dt); t += dt; armT += dt; }
    if (b.state === 'deploy') {
      window.game.action(ACTIONS.CONFIRM, true); real(dt); t += dt;
      window.game.action(ACTIONS.CONFIRM, false);
    }
    if (b.state !== 'fight') {
      throw new Error('the battle did not reach the fight: state=' + b.state + ', kind=' + meta.kind);
    }
    if (resolve === 'forced') {
      b.endBattle(true); // economy-only: the fight is granted, not simulated
    } else {
      if (orders) for (const squad of Object.keys(orders)) b.issueCommand(orders[squad], squad);
      while (b.state !== 'end' && t < battleTimeoutS) { real(dt); t += dt; }
    }
    // An unresolved window. The shipped stance sweep scores this as a loss and stops
    // there; a CAMPAIGN has to continue past it, and what a player does at that point is
    // ride out — which is a real production ending (`endBattle(false, true)`), unlike an
    // invented defeat. It is counted separately as `unresolved` and flagged on the fight,
    // so a policy that grinds is visible in the record instead of being laundered into
    // the win rate.
    const resolved = b.state === 'end';
    if (!resolved) { rec.unresolved++; b.endBattle(false, true); }
    const won = !!b.victory, retreated = !!b.retreated;
    const loot = won ? (b.loot || 0) : 0;
    const lost = startTroops - b.troops.length;
    const enemies = b.setup.enemies.map(e => e.type);

    // Ride the outro out: onEnd fires inside the battle scene and hands back to a NEW
    // World (or, for a won storm, straight to the victory scene).
    let outro = 0;
    while (game.sceneName === 'battle' && outro++ < 60 * 30) real(dt);
    if (game.sceneName === 'battle') throw new Error('the battle never handed back to the world');

    rec.battles++;
    if (won) rec.wins++; else if (retreated) rec.retreats++; else rec.losses++;
    if (meta.kind === 'defense' && won) rec.raidsDefended++;
    const goldDelta = game.sceneName === 'world'
      ? game.scene.save.gold - goldBefore
      : lastSave.gold - goldBefore;
    const earnedDelta = game.sceneName === 'world'
      ? ((game.scene.save.stats || {}).goldEarned || 0) - earnedBefore
      : ((lastSave.stats || {}).goldEarned || 0) - earnedBefore;
    rec.fights.push({
      kind: meta.kind,
      resolved,
      ratio: round3(meta.mine > 0 ? enemyWeight / meta.mine : 0),
      weight: round3(enemyWeight),
      won, retreated,
      durationT: round1(t),
      lost,
      loot,
      goldDelta,
      earnedDelta,
      enemies: countTypes(enemies),
    });
    if (game.sceneName === 'world') adopt(game.scene);
  }

  const round1 = n => Math.round(n * 10) / 10;
  const round3 = n => Math.round(n * 1000) / 1000;
  function countTypes(list) {
    const out = {};
    for (const t of list) out[t] = (out[t] || 0) + 1;
    return out;
  }

  // --- travel --------------------------------------------------------------
  // Deterministic standing spot near a site: the first unblocked compass offset at 100 px.
  // 100 keeps the hero inside `nearSettlement(110)` and `nearCamp(130)` without landing
  // on the site itself, and the compass order is fixed so a spot is a function of the map.
  function standNear(x, y) {
    const R = 100;
    const offsets = [[0, R], [R, 0], [-R, 0], [0, -R], [R, R], [-R, R], [R, -R], [-R, -R]];
    for (const [ox, oy] of offsets) {
      const px = x + ox, py = y + oy;
      if (px > 40 && py > 40 && px < WORLD.w - 40 && py < WORLD.h - 40 && !world.blockedAt(px, py)) {
        return { x: px, y: py };
      }
    }
    return { x, y: y + R };
  }

  // A leg: teleport to the destination and pay the clock it would have cost to ride
  // there. `grace` is cleared so the arrival is not covered by post-battle immunity.
  function ride(dest) {
    const d = Math.hypot(dest.x - world.hero.x, dest.y - world.hero.y);
    world.hero.x = dest.x; world.hero.y = dest.y; world.grace = 0;
    const steps = Math.max(1, Math.round((d / HERO.speed) / dt));
    for (let i = 0; i < steps; i++) {
      flowingTick();
      pump();
      checkStop();
    }
  }

  // Arrive and STAY arrived: a battle mid-leg can move the hero (a defeat carries him to
  // the nearest village), so the leg is re-flown until the destination is actually held.
  function rideTo(x, y) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const dest = standNear(x, y);
      if (Math.hypot(dest.x - world.hero.x, dest.y - world.hero.y) < 1 && attempt > 0) return;
      ride(dest);
      if (Math.hypot(x - world.hero.x, y - world.hero.y) < 130) return;
    }
    throw new Error('could not hold a standing spot at ' + Math.round(x) + ',' + Math.round(y));
  }

  // --- the site menu -------------------------------------------------------
  function openMenu() {
    drivingMenu = true;
    press(ACTIONS.WORLD_PRIMARY);
    pump();
    const s = world.screen;
    if (!s || s.kind !== 'site') {
      drivingMenu = false;
      throw new Error('the site menu did not open (screen: ' + ((s || {}).kind || 'none') + ')');
    }
    return s;
  }

  function closeMenu() {
    if (world.screen && world.screen.kind === 'site') press(ACTIONS.WITHDRAW);
    drivingMenu = false;
    pump();
  }

  // Walk to the named row with the menu actions and commit with CONFIRM. Naming the rows
  // it DID find is the failure a fixture standing in the wrong place actually has.
  function commitRow(rowId) {
    const s = world.screen;
    const i = s.rows.findIndex(r => r.id === rowId);
    if (i < 0) throw new Error('no "' + rowId + '" row here — rows: ' + (s.rows.map(r => r.id).join(', ') || '(none)'));
    const steps = (i - s.index + s.rows.length) % s.rows.length;
    for (let n = 0; n < steps; n++) press(ACTIONS.MENU_DOWN);
    press(ACTIONS.CONFIRM);
  }

  function rowById(id) {
    const s = world.screen;
    return s && s.kind === 'site' ? s.rows.find(r => r.id === id) || null : null;
  }

  // --- the spend rules -----------------------------------------------------
  // `column`: heal when badly hurt, then fill the column with the cheapest body, then
  // expand when full and affordable. `knightsFirst` is the farmer's extra: at a town it
  // buys the knight before the cheap bodies, which is what "knights at the town" means.
  function spend(settlement, { knightsFirst = false } = {}) {
    if (world.isSettlementOccupied(settlement)) return;
    openMenu();
    for (let step = 0; step < 24; step++) {
      const s = world.screen;
      if (!s || s.kind !== 'site') break;
      // Heal when the COLUMN is hurt, not only the hero. A troop record carries its hit
      // points across fights, so a warband that won three raids rides into the fourth
      // half dead - and `playerStrength` prices bodies at full health, so the ratio the
      // record shows would understate that fight. A scripted player who never buys the
      // 10 g rest is not a frugal player, he is a broken model of one.
      const earlier = perkMods(world.save.perks).rankEarlier;
      const hurt = world.save.heroHp < world.save.heroMaxHp * 0.6 ||
        world.save.troops.some(t => t.hp != null && t.hp < troopMaxHp(t, earlier) * 0.6);
      const heal = rowById('heal');
      if (heal && heal.enabled && hurt) { commitRow('heal'); continue; }
      const recruits = s.rows.filter(r => r.id.startsWith('recruit-') && r.enabled);
      if (knightsFirst && recruits.some(r => r.id === 'recruit-knight')) { commitRow('recruit-knight'); continue; }
      if (recruits.length) {
        // Cheapest body by the price this settlement actually quotes — read through
        // costAt, so a specialization's discount is the price the rule sees.
        let best = recruits[0], bestCost = world.costAt(settlement, best.id.slice('recruit-'.length));
        for (const r of recruits) {
          const c = world.costAt(settlement, r.id.slice('recruit-'.length));
          if (c < bestCost) { best = r; bestCost = c; }
        }
        commitRow(best.id);
        continue;
      }
      const expand = rowById('expand');
      if (expand && expand.enabled) { commitRow('expand'); continue; }
      break;
    }
    closeMenu();
  }

  // --- route steps ---------------------------------------------------------
  function claim(settlement, stage) {
    rec.claimVisits.push({ stage, id: settlement.id });
    rideTo(settlement.x, settlement.y);
    const rec0 = world.save.settlements.find(s => s.id === settlement.id);
    if (!rec0 || rec0.owner === 'player') return;
    openMenu();
    const row = rowById('claim');
    if (!row) { closeMenu(); return; }
    if (!row.enabled) { rec.claimsRefused++; closeMenu(); return; }
    // The claim closes the menu itself and raises the spec choice behind it.
    commitRow('claim');
    drivingMenu = false;
    pump();
  }

  function raid(camp) {
    rideTo(camp.x, camp.y);
    const st = world.save.camps.find(c => c.id === camp.id);
    if (st && st.razed) return;
    openMenu();
    routeCommit = true;
    try {
      commitRow('raid');
      drivingMenu = false;
      pump();
    } finally { routeCommit = false; }
  }

  function storm() {
    const hold = WORLD.camps.find(c => c.stronghold);
    rideTo(hold.x, hold.y);
    rec.strongholdStateAtStorm = strongholdStateId(world.save);
    rec.strongholdPointsAtStorm = strongholdPoints(world.save);
    rec.finalWeight = round3(world.myStrength());
    const before = rec.fights.length;
    openMenu();
    routeCommit = true;
    try {
      commitRow('storm');
      drivingMenu = false;
      pump();
    } finally { routeCommit = false; }
    const f = rec.fights[before] || null;
    rec.storm = f ? { ratio: f.ratio, won: f.won, durationT: f.durationT, lost: f.lost } : null;
  }

  // The farmer's hunt: find the weakest live party inside `ratio`, stand next to it, and
  // let `tryClash` fire through the ordinary encounter seam. Returns true if a fight
  // actually happened, so a caller can stop rather than grind against an empty map.
  function hunt(times, ratio = BALANCE.oddsFavored) {
    let fought = false;
    for (let i = 0; i < times; i++) {
      const mine = world.myStrength();
      let best = null;
      for (const p of world.parties) {
        if (p.occupying) continue;
        const s = world.strength(p.comp);
        if (s > mine * ratio) continue;
        if (!best || s < best.s) best = { p, s };
      }
      if (!best) return fought;
      const p = best.p;
      // Stand inside clash range (dh < 46) and let the ordinary encounter seam fire. A
      // party sitting inside a settlement's 130 px sanctuary cannot be clashed at all;
      // the bounded wait below simply gives up on it rather than chasing forever.
      world.hero.x = p.x + 24; world.hero.y = p.y + 24; world.grace = 0;
      routeKind = 'hunt';
      try {
        const before = rec.battles;
        for (let n = 0; n < 120; n++) {
          flowingTick();
          pump();
          checkStop();
          if (rec.battles > before) break;
        }
        if (rec.battles === before) return fought; // it slipped the net — do not chase
        fought = true;
      } finally { routeKind = null; }
    }
    return fought;
  }


  // Greedy nearest-first over the settlements still worth claiming.
  function nextUnclaimed(attempted) {
    let best = null, bd = Infinity;
    for (const s of WORLD.settlements) {
      const st = world.save.settlements.find(x => x.id === s.id);
      if (!st || st.owner === 'player' || attempted.has(s.id)) continue;
      const d = Math.hypot(s.x - world.hero.x, s.y - world.hero.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  const TOWN = WORLD.settlements.find(s => s.kind === 'town');
  const RAIDABLE = WORLD.camps.filter(c => !c.stronghold).slice().sort((a, b) => (a.tier || 1) - (b.tier || 1));

  // Where a shopping stop happens: the nearest unoccupied settlement, or the town when
  // the policy wants knights.
  function shop(atTown, knightsFirst) {
    const target = atTown ? TOWN : nearestSettlement();
    if (!target) return;
    rideTo(target.x, target.y);
    spend(target, { knightsFirst });
  }

  function nearestSettlement() {
    let best = null, bd = Infinity;
    for (const s of WORLD.settlements) {
      if (world.isSettlementOccupied(s)) continue;
      const d = Math.hypot(s.x - world.hero.x, s.y - world.hero.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Refusal is still a completed visit. Each route stage gets a fresh set so
  // the mixed policy may deliberately retry a refusal AFTER its intervening raid.
  function claimStage(stage, count) {
    const attempted = new Set();
    for (let i = 0; i < count; i++) {
      const s = nextUnclaimed(attempted);
      if (!s) break;
      attempted.add(s.id);
      claim(s, stage);
    }
  }

  // --- the policies --------------------------------------------------------
  function runPolicy() {
    if (policy === 'claimRush') {
      // The route the audit called the credible fastest win: claim everything, fight
      // nothing until the storm. No purchases at all.
      claimStage('claimRush', WORLD.settlements.length);
      storm();
      return;
    }
    if (policy === 'campRaider') {
      for (const camp of RAIDABLE) {
        shop(false, false);
        raid(camp);
      }
      shop(false, false);
      storm();
      return;
    }
    if (policy === 'captureThenRaze') {
      // claim two, raze one, claim two, raze two, storm
      claimStage('beforeRaid', 2);
      shop(false, false);
      raid(RAIDABLE[0]);
      claimStage('afterRaid', 2);
      shop(false, false);
      raid(RAIDABLE[1]);
      shop(false, false);
      raid(RAIDABLE[2]);
      shop(false, false);
      storm();
      return;
    }
    if (policy === 'farmer') {
      for (const camp of RAIDABLE) {
        hunt(3);
        shop(true, true);
        raid(camp);
      }
      hunt(3);
      shop(true, true);
      storm();
      return;
    }
    throw new Error('unknown policy: ' + policy);
  }

  // --- run -----------------------------------------------------------------
  try {
    adopt(game.scene);
    pump();
    runPolicy();
    // A won stronghold sets `save.won` during the BATTLE, and the world scene redirects to
    // the victory screen on its next tick — which for the last step of a route is a tick
    // nobody takes. Read the save rather than waiting for the scene, or the runs that
    // actually SUCCEEDED are the ones recorded as merely having finished their route.
    if (!rec.outcome) rec.outcome = lastSave && lastSave.won ? 'won' : 'route';
  } catch (err) {
    if (err !== DONE) {
      game.update = real;
      throw err;
    }
  } finally {
    game.update = real;
  }

  const save = lastSave || {};
  const stats = save.stats || {};
  rec.playT = Math.round(stats.playT || 0);
  rec.flowT = Math.round(rec.flowT);
  rec.goldEarned = stats.goldEarned || 0;
  rec.goldSpent = stats.goldSpent || 0;
  rec.finalGold = save.gold || 0;
  rec.captures = stats.captures || 0;
  rec.razed = (save.camps || []).filter(c => c.razed && c.id !== 'strong').length;
  rec.won = !!save.won;
  return rec;
}

// ---------------------------------------------------------------------------
// Node side.
// ---------------------------------------------------------------------------

// One scripted campaign. Returns the per-run record described in plans/038.
export async function runCampaign(page, options) {
  const opts = { ...CAMPAIGN_DEFAULTS, ...options };
  if (!POLICIES.includes(opts.policy)) throw new Error('unknown policy: ' + opts.policy);
  await page.goto('/');
  await page.waitForFunction(() => window.__g && window.__g.sceneName === 'menu');
  return page.evaluate(campaignBody, opts);
}

// The record, flattened to one line — what the comparison files quote.
export function summarize(record) {
  const r = record;
  return [
    `seed ${r.seed}`.padEnd(10),
    r.policy.padEnd(16),
    (r.outcome + (r.won ? '/won' : '')).padEnd(12),
    `playT ${String(r.playT).padStart(4)}s`,
    `battles ${String(r.battles).padStart(2)}`,
    `W${r.wins}/L${r.losses}/R${r.retreats}`.padEnd(10),
    `gold +${r.goldEarned}/-${r.goldSpent}=${r.finalGold}`.padEnd(24),
    `weight ${r.finalWeight}`,
    `razed ${r.razed}`,
    `cap ${r.captures}`,
    `raids ${r.raidsLanded}/${r.raidsDefended}`,
    `floor ${r.floorFires}`,
    `storm ${r.storm ? r.storm.ratio + (r.storm.won ? ' WON' : ' lost') : '-'}`,
    `state ${r.strongholdStateAtStorm || '-'}`,
  ].join('  ');
}

// Gold per fight bucketed by what was actually fought. Slice D's proof that the wolf
// farm closed: the per-body-type loot rule should flatten these against fighting weight.
export function goldByComposition(records, kinds = null) {
  const buckets = {};
  for (const r of records) {
    for (const f of r.fights) {
      if (kinds && !kinds.includes(f.kind)) continue;
      if (!f.won) continue;
      const total = Object.values(f.enemies).reduce((a, b) => a + b, 0) || 1;
      for (const type of Object.keys(f.enemies)) {
        if (f.enemies[type] / total < 0.5) continue; // "-heavy" means a majority of bodies
        const b = buckets[type] || (buckets[type] = { fights: 0, loot: 0, weight: 0 });
        b.fights++; b.loot += f.loot; b.weight += f.weight;
      }
    }
  }
  for (const type of Object.keys(buckets)) {
    const b = buckets[type];
    b.goldPerFight = Math.round(10 * b.loot / b.fights) / 10;
    b.goldPerWeight = Math.round(100 * b.loot / b.weight) / 100;
  }
  return buckets;
}
