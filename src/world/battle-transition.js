// The world -> battle seam (Plan 021). Its invariants are spelled out in AGENTS.md and are
// the reason this module is small and self-contained:
//
//   * requestBattle only OPENS a brief. It must not mutate the map — no gold charged, no
//     party spliced, no save written — so backing out costs nothing.
//   * the enemy composition is rolled at CONFIRM, never at request, so a player cannot
//     scout a camp for free by opening and cancelling a brief.
//   * confirmBrief persists exactly once, while the scene is still `world`, AFTER splicing
//     the party out, so a crash mid-transition cannot resurrect a defeated band.
//   * the aftermath is handed over through game.pendingAftermath (read and cleared by the
//     next World constructor), never stored on `save` — it is not part of the schema.
//
// Changing anything here means re-reading that section of AGENTS.md and re-running
// world-screens.spec.js, campaign-persistence.spec.js and save-schema.spec.js.
import { WORLD, BALANCE, rollComposition } from '../data.js?v=r866af952ef00';
import { dist2, clamp } from '../engine.js?v=r866af952ef00';
import { ACTIONS } from '../input-actions.js?v=r866af952ef00';
import { buildBriefModel, veteranLine } from '../world-screens.js?v=r866af952ef00';
import { sampleBattlefield } from './battlefield-brief.js?v=r866af952ef00';
import { FIELD } from '../battle/constants.js?v=r866af952ef00';
import { encounterObjective, strongholdModifiers } from '../region.js?v=r866af952ef00';
import { awardVeterancy, perkMods } from '../progression.js?v=r866af952ef00';
import { performSiteAction } from './site-menu.js?v=r866af952ef00';

// Sim-seconds into the assault when an Entrenched hold's reserve arrives.
const STRONGHOLD_WAVE_AT = 25;

export function startBattle(world, comp, title, onWinExtra, arena, ambush, partyMeta, subtitle, brief = false, extras = null) {
  const save = world.save;
  // Plan 021 step 9: the roster ENTERING the fight, captured before anything about it
  // can change — result.survivors alone can't say how many of each type were lost.
  const preTroopTypes = save.troops.map(t => t.type);
  const enemyCompSnapshot = comp.slice();
  save.x = world.hero.x; save.y = world.hero.y;
  save.battleCount = (save.battleCount || 0) + 1;
  world.persistParties();
  world.game.persistRun();
  world.game.sfx.horn(147);
  const approach = world.pendingApproach || 'E';
  const battleSeed = (Math.abs(world.hero.x * 31 + world.hero.y * 17) | 0) + 7;
  world.game.startBattle({
    // Plan 029: `vet` rides in with the man, and the hero's perks ride in with the fight.
    // Both are read-only inputs to Battle — it never writes either back.
    troops: save.troops.map(t => ({ type: t.type, hp: t.hp, vet: t.vet || 0 })),
    perks: (save.perks || []).slice(),
    enemies: comp.map(c => ({ type: c })),
    seed: battleSeed,
    title,
    arena: arena || (world.nearSettlement(200) ? 'village' : world.nearRiver(world.hero.x) ? 'bridge' : 'road'),
    biome: world.biomeAt(world.hero.x),
    ambush,
    subtitle,
    // Plan 021 step 5: setup.brief keys the battle intro's trim so the three
    // scenario('battle_*') visual baselines (never routed through a brief) are
    // provably untouched — only fights reached via confirmBrief() set world.
    brief,
    // Plan 024 Phase 2: a pure, read-only sample of the map around the hero, in field
    // space. NOT named `brief` — that field above already means "reached via the
    // pre-battle modal". Derived only, never persisted (AGENTS.md save-schema rule):
    // Battle/battle-transition never write this to `save`, so no schema version is spent.
    field: sampleBattlefield(world, approach, battleSeed, FIELD.W, FIELD.H),
    deploy: world.pendingDeploy,
    approach,
    // Milestone 025 Slice C/E: the objective descriptor and any stronghold modifier
    // payload assembled by confirmBrief(). Plain serializable data — the battle side
    // builds its runtime state from it and nothing here is ever persisted.
    objective: extras ? extras.objective || null : null,
    waves: extras ? extras.waves || null : null,
    stronghold: extras ? extras.stronghold || null : null,
    revealDeployment: extras ? !!extras.revealDeployment : false,
    // (pending* are per-battle one-shots)
    heroHp: save.heroHp,
    heroMaxHp: save.heroMaxHp,
    onEnd: (result) => {
      world.pendingDeploy = undefined; world.pendingApproach = undefined;
      save.stats = save.stats || { won: 0, kills: 0, lost: 0, playT: 0 };
      for (const k of ['battlesLost', 'goldEarned', 'goldSpent', 'captures']) save.stats[k] = save.stats[k] || 0;
      save.stats.kills += result.kills || 0;
      save.stats.lost += result.lost || 0;
      if (result.victory) {
        save.stats.won++;
        save.stats.goldEarned += result.loot || 0;
      } else if (!result.retreated) {
        save.stats.battlesLost++;
      }
      // whittle down the enemy force by exactly who died (by type, not by array
      // position) — used below both for camp-garrison attrition and for the
      // roaming party you disengaged from. Reused per branch since each only
      // needs it once, but built from the same dead-type list either way.
      const removeDead = (comp) => {
        const dead = (result.deadTypes || []).slice();
        return comp.filter(t => {
          const idx = dead.indexOf(t);
          if (idx >= 0) { dead.splice(idx, 1); return false; }
          return true;
        });
      };
      const restoreRoamingParty = () => {
        // A roaming encounter is removed before battle entry. Reinsert only its
        // surviving composition at the encounter point; defeat changes save.x/y
        // to the recovery village, so those coordinates must come from metadata.
        if (!partyMeta || partyMeta.campId) return;
        const remaining = removeDead(partyMeta.comp);
        if (remaining.length === 0) {
          // A party occupying a settlement that happens to be fully wiped on a
          // retreat/defeat edge case (not a formal victory) still frees the
          // settlement — there is no occupier left to hold it.
          if (partyMeta.occupying) {
            const st = world.save.settlements.find(s => s.id === partyMeta.occupying);
            if (st) st.occupied = false;
          }
          return;
        }
        save.parties = save.parties || [];
        const restored = {
          camp: partyMeta.camp,
          x: partyMeta.x,
          y: partyMeta.y,
          comp: remaining,
          home: { ...partyMeta.home },
          waryT: partyMeta.waryT || 0,
          // re-inserted right on top of the hero on disengage — without its own
          // cooldown it would instantly re-clash the same frame grace expires
          clashT: BALANCE.battleGrace,
          ...(partyMeta.occupying ? { occupying: partyMeta.occupying } : {}),
        };
        // Milestone 025: an interrupted raid resumes where it left off — the party
        // keeps its target (and its regional kind) after a retreat or a defeat.
        if (partyMeta.raid) {
          restored.raid = partyMeta.raid;
          restored.raidKind = partyMeta.raidKind || 'breakoff';
        }
        save.parties.push(restored);
      };
      // camp garrisons no longer resurrect their dead on a failed or abandoned raid —
      // what you killed stays dead, so attrition against a camp is real
      if (partyMeta && partyMeta.campId && !result.victory) {
        const st = world.save.camps.find(c => c.id === partyMeta.campId);
        if (st && st.garrison) st.garrison = removeDead(st.garrison);
      }
      // Plan 031: what the fight cost, reported by the screen whose job is to report it.
      let goldLost = 0;
      if (result.victory) {
        save.gold += result.loot;
        // Plan 029: veterancy is battles WON and walked out of. Awarded here and only
        // here — a retreat and a defeat deliberately do not count, because "ride in, ride
        // out" would otherwise be a training montage. awardVeterancy() refuses the point
        // whenever taking it would push the body past what this banner can teach, so the
        // ceiling is enforced where the number is written rather than where it is read;
        // that is what lets playerStrength(troops) keep its Plan 028 signature.
        const earlier = perkMods(save.perks).rankEarlier;
        save.troops = result.survivors.map(t => ({
          ...t, vet: awardVeterancy(t.vet, save.banner, earlier),
        }));
        save.heroHp = Math.min(save.heroMaxHp, result.heroHp + 20);
        save.toast = null;
        onWinExtra && onWinExtra(); // camp raids set their own toast (razed count, remnants)
        if (!save.toast) {
          save.toast = result.lost > 0
            ? `Victory — ${result.lost} men lost. The camps are the objective: raid the tents.`
            : 'Victory, no losses! Raid the camps to stop the raids.';
        }
      } else if (result.retreated) {
        // disengage: keep the survivors you actually rode out with, no gold loss
        save.troops = result.survivors;
        save.heroHp = Math.max(20, result.heroHp);
        save.toast = 'You disengage and ride clear';
        // The enemy party you fled from stays at the encounter, minus its actual dead.
        restoreRoamingParty();
      } else {
        // defeat: your surviving men carry you to the NEAREST village, not magically home
        // Plan 031: the aftermath reports this. A player who loses 200 gold and finds out
        // by noticing the HUD later has been told nothing by the screen whose whole job is
        // to say what the fight cost.
        const goldBeforeDefeat = save.gold;
        save.gold = Math.max(25, Math.round(save.gold * (1 - BALANCE.defeatGoldLoss)));
        goldLost = goldBeforeDefeat - save.gold;
        save.troops = result.survivors || [];
        save.heroHp = Math.round(save.heroMaxHp * 0.5);
        let nearest = WORLD.settlements[0], bd = Infinity;
        for (const s of WORLD.settlements) {
          const d = dist2(save.x, save.y, s.x, s.y);
          if (d < bd) { bd = d; nearest = s; }
        }
        save.x = nearest.x; save.y = nearest.y + 80;
        if (save.troops.length < 2 && !save.hard) {
          while (save.troops.length < 2) save.troops.push({ type: 'spear' });
          save.toast = `Carried to ${nearest.name} — village volunteers rally to your banner`;
        } else if (save.troops.length === 0 && save.hard) {
          // hard mode: no volunteers — only your squire stays
          save.troops.push({ type: 'spear' });
          save.toast = `Carried to ${nearest.name} — only your squire remains. HARD lands breed no volunteers`;
        } else {
          save.toast = `Your men carry you to ${nearest.name} — the survivors regroup`;
        }
        // Defeat also leaves surviving roaming enemies in the world. This must run
        // after the teleport so restoration cannot accidentally use the new hero position.
        restoreRoamingParty();
      }
      // Plan 021 step 9: the aftermath payload rides on game.pendingAftermath, never on
      // `save` (no new save field, no schema bump — decision 9). Skipped when save.won:
      // a won stronghold raid's final victory screen already IS that fight's aftermath,
      // and consuming save.toast here would rob the pre-existing one-frame toast replay
      // of its message for no reason (the victory scene replaces it immediately anyway).
      if (!save.won) {
        const consequence = save.toast || null;
        save.toast = null; // consumed — must not be shown again behind a frozen msgT timer
        world.game.pendingAftermath = {
          victory: result.victory,
          retreated: result.retreated,
          loot: result.loot || 0,
          preTroopTypes,
          survivorTypes: (result.survivors || []).map(t => t.type),
          deadTypes: (result.deadTypes || []).slice(),
          enemyCompSnapshot,
          heroHp: save.heroHp, // POST-regen — result.heroHp would contradict the HUD
          heroMaxHp: save.heroMaxHp,
          goldLost,
          // Veterancy is awarded above, before this payload is built, and the aftermath is
          // the one screen where the rank was actually earned. It never said so.
          veterans: veteranLine(save.troops, perkMods(save.perks).rankEarlier),
          consequence,
        };
      }
      world.game.startWorld(save);
    },
  });
}

// Plan 021 decision 8: World.startBattle() keeps committing immediately — legacy QA
// records and window.__g call it directly and assert battle on the next line. Every
// map-initiated fight now reaches it only through requestBattle()/confirmBrief() below.
//
// `descriptor` fields: title, subtitle, arena, ambush, approach, deploy, comp (display
// snapshot; null means unscouted), canWithdraw, partyMeta, and EITHER `party` (a live
// roaming-party reference, for a clash) OR `campId` (for a camp/stronghold assault) —
// never both. onWinExtra is precomputed for a party (nothing mutates it while the brief
// blocks every other world phase) but rebuilt at confirm for a camp via
// campVictoryExtra(), since an unscouted garrison does not exist yet at request time.
export function requestBattle(world, descriptor) {
  world.pending = { descriptor, battleCountAtRequest: world.save.battleCount || 0 };
  world.screen = buildBriefModel(descriptor, world.save);
}

// Cancel charges the fled-from party (decision 6): it saw you flinch. Camps have no
// equivalent cooldown field — cancelling one just closes the brief, and the garrison
// (rolled only at confirm) stays unrolled, so it is never revealed for free.
export function cancelBrief(world) {
  const d = world.pending && world.pending.descriptor;
  if (d && d.party) {
    d.party.clashT = BALANCE.battleGrace;
    d.party.waryT = 25;
  }
  world.screen = null;
  world.pending = null;
}

export function confirmBrief(world) {
  const d = world.pending.descriptor;
  let comp = d.comp, onWinExtra = d.onWinExtra;
  let extras = null;
  if (d.party) {
    // Hold the party OBJECT, resolve indexOf at confirm — nothing else can touch
    // `world.parties` while the brief blocks every other world phase, but bail cleanly
    // rather than assume the index is still valid.
    const idx = world.parties.indexOf(d.party);
    if (idx < 0) { world.screen = null; world.pending = null; return; }
    world.parties.splice(idx, 1);
    extras = { objective: d.objective || null };
  } else if (d.campId) {
    const camp = WORLD.camps.find(c => c.id === d.campId);
    const st = world.save.camps.find(c => c.id === d.campId);
    // Decision 6: the garrison roll for an unscouted camp happens HERE, at confirm —
    // never at request time, or backing out would permanently reveal it for free.
    if (!st.garrison) st.garrison = world.rollGarrison(camp);
    comp = st.garrison.slice(); // a snapshot: the modifiers below must not rewrite camp state
    onWinExtra = world.campVictoryExtra(camp, st);
    extras = { objective: d.objective || null };
    if (camp.stronghold) {
      const mods = d.stronghold ? d.stronghold.mods : strongholdModifiers(world.save);
      // Exposed thins the STARTING garrison (example mapping: "reduce the starting
      // garrison to the beatable floor"). Deterministic: keep the first N entries in
      // the rolled order, brutes first so the thinning reads as losing mass, not teeth.
      if (mods.garrisonMul < 1) {
        const keep = Math.max(2, Math.round(comp.length * mods.garrisonMul));
        comp = [...comp.filter(t => t === 'brute'), ...comp.filter(t => t !== 'brute')].slice(0, keep);
      }
      // Entrenched reserves: one reinforcement wave, rolled now on the campaign's own
      // simRng so the whole assault stays seed-deterministic.
      const waves = [];
      for (let i = 0; i < (mods.waves || 0); i++) {
        const mine = world.myStrength();
        // Plan 028: a reserve wave is 0.8x the player's fighting weight, bounded by the
        // same encounter clamp every other generated force uses.
        const cl = BALANCE.encounterWeightClamp;
        waves.push({
          at: STRONGHOLD_WAVE_AT,
          comp: rollComposition(clamp(mine * 0.8, cl.min, cl.max), world.simRng, BALANCE.compRolls.garrison),
        });
      }
      extras.waves = waves;
      extras.stronghold = d.stronghold || null;
      extras.revealDeployment = !!mods.revealDeployment;
    }
  }
  // Splice/garrison-roll above must finish before startBattle() calls persistParties()
  // and persistRun() (AGENTS.md: finish all map-side mutations, then persist once,
  // while still `world`) — the encounter must already be gone from the checkpoint it
  // writes, not merely gone from the next one.
  world.pendingApproach = d.approach;
  world.pendingDeploy = d.deploy;
  world.screen = null;
  world.pending = null;
  world.startBattle(comp, d.title, onWinExtra, d.arena, d.ambush, d.partyMeta, d.subtitle, true, extras);
}

// Named modal phase (Plan 021 decision 7/step 6): first phase in update(), and it must
// return immediately whenever a screen is open so the SAME keypress that just opened
// or resolved a screen cannot also fall through into a world phase this tick. Opening
// a screen is handled by the callers (requestBattle()'s two call sites already `return
// true` right after calling it); this method only ever handles a screen that is
// ALREADY open, so returning true unconditionally on that branch is correct.
// The spec, perk and site panels are three instances of one interaction: a vertical list
// with a selected `index`, moved by the menu actions and committable by ENTER or by
// clicking a row. This resolves the INPUT for all three. Their draw code stays separate on
// purpose — the visual baselines pin the spec and perk panels' pixels, and a shared painter
// would put that at risk for no behavioural gain.
//
// Returns the id of a row to commit, 'dismiss' for X, or null if the press was navigation
// (or nothing at all). `key` names the block drawn by the panel, whose `rows` are the
// individual option rects.
function resolveChoiceInput(world, inp, btn, key, options) {
  const block = btn[key];
  // A modal that just opened unbidden must not be committable by the burst of presses that
  // dismissed whatever came before it. Navigation is deliberately still live — moving the
  // selection is proof the player is looking at the screen, so it disarms immediately.
  const armed = !(world.screen.armT > 0);
  if (inp.pressedAction(ACTIONS.MENU_UP)) {
    world.screen.index = (world.screen.index + options.length - 1) % options.length;
    world.screen.armT = 0;
    world.game.sfx.uiMove();
    world.game.invalidate();
    return null;
  }
  if (inp.pressedAction(ACTIONS.MENU_DOWN)) {
    world.screen.index = (world.screen.index + 1) % options.length;
    world.screen.armT = 0;
    world.game.sfx.uiMove();
    world.game.invalidate();
    return null;
  }
  // The panels return one merged block whose `rows` are the option rects (it has no single
  // `index`) — resolve the clicked row explicitly and keep keyboard/pointer selection
  // consistent.
  if (block && inp.mouse.clicked &&
      inp.mouse.x >= block.x && inp.mouse.x <= block.x + block.w &&
      inp.mouse.y >= block.y && inp.mouse.y <= block.y + block.h) {
    const rows = block.rows || [];
    const i = rows.findIndex(r => inp.mouse.y >= r.y && inp.mouse.y <= r.y + r.h);
    // A click names its own row, so it is self-evidently deliberate — but it still waits out
    // the arm, because a click aimed at the aftermath's CONTINUE button lands in the same
    // screen space a choice row now occupies.
    if (i >= 0 && options[i]) {
      world.screen.index = i;
      if (!armed) { world.screen.armT = 0; world.game.invalidate(); return null; }
      world.game.sfx.uiSelect();
      return options[i].id;
    }
  }
  if (armed && inp.pressedAction(ACTIONS.CONFIRM)) {
    world.game.sfx.uiSelect();
    return options[world.screen.index].id;
  }
  // Dismissing is never destructive on any of these three, so it needs no arm.
  if (inp.pressedAction(ACTIONS.WITHDRAW)) { world.game.sfx.uiMove(); return 'dismiss'; }
  return null;
}

export function updateWorldScreens(world, inp, dt = 0) {
  if (!world.screen) return false;
  // The arm rides on the MODEL, not on the scene, so a screen that replaces another gets a
  // fresh one for free — which is the whole case this guards (aftermath -> spec -> perk).
  if (world.screen.armT > 0) {
    world.screen.armT = Math.max(0, world.screen.armT - dt);
    world.game.invalidate(); // the panel draws the arm, so the frame is not clean
  }
  const btn = world.screenButtons || {};
  const clickedRect = (r) => !!r && inp.mouse.clicked &&
    inp.mouse.x >= r.x && inp.mouse.x <= r.x + r.w && inp.mouse.y >= r.y && inp.mouse.y <= r.y + r.h;
  if (world.screen.kind === 'brief') {
    const canWithdraw = !!(world.pending && world.pending.descriptor.canWithdraw);
    if (canWithdraw && (inp.pressedAction(ACTIONS.WITHDRAW) || clickedRect(btn.withdraw))) {
      world.cancelBrief();
      return true;
    }
    if (inp.pressedAction(ACTIONS.CONFIRM) || clickedRect(btn.confirm)) {
      world.confirmBrief();
      return true;
    }
    return true;
  }
  if (world.screen.kind === 'aftermath') {
    if (inp.pressedAction(ACTIONS.CONFIRM) || clickedRect(btn.confirm)) {
      world.screen = null;
      // Milestone 025 Slice B: a specialization choice queued behind this aftermath
      // opens on the same tick the aftermath clears, so the capture flow never shows
      // two modals at once and never loses the prompt.
      if (world.pendingSpecChoice) world.openSpecChoice(world.pendingSpecChoice);
      // Plan 029: and a perk choice behind THAT. Same one-modal-at-a-time discipline;
      // offerPerkChoice() no-ops while a screen is up and is re-asked by chooseSpec().
      else world.offerPerkChoice();
      return true;
    }
    return true;
  }
  if (world.screen.kind === 'spec') {
    // Permanent choice: navigate with the menu actions, commit with CONFIRM. Dismissing (X)
    // keeps the settlement owned but unchosen — the site menu at its gates reopens the
    // prompt later.
    if (clickedRect(btn.defer)) { world.game.sfx.uiMove(); world.dismissSpecChoice(); return true; }
    const picked = resolveChoiceInput(world, inp, btn, 'spec', world.screen.options);
    if (picked === 'dismiss') world.dismissSpecChoice();
    else if (picked) world.chooseSpec(picked);
    return true;
  }
  // Plan 029: the perk choice, on exactly the specialization modal's machinery — same
  // world.screen field, same navigation actions, same click-a-row resolution. A world
  // modal genuinely pauses the campaign (AGENTS.md), and reusing this is what buys that
  // for free rather than inventing a second pause.
  if (world.screen.kind === 'perk') {
    if (clickedRect(btn.defer)) { world.game.sfx.uiMove(); world.dismissPerkChoice(); return true; }
    const picked = resolveChoiceInput(world, inp, btn, 'perk', world.screen.options);
    // X defers rather than spends: perkChoiceDue() still reports the point, so the next
    // World offers it again. There is no way to lose one.
    if (picked === 'dismiss') world.dismissPerkChoice();
    else if (picked) world.choosePerk(picked);
    return true;
  }
  // Plan 030: the site menu, on the same machinery. It differs from spec/perk in one way
  // that matters — committing a row does NOT close it. performSiteAction rebuilds the model
  // from the save, so gold, column room and prices re-derive and a second spearman is one
  // more ENTER, not another walk up to the gates. The rows that raise a modal of their own
  // (claim, choose-a-calling, raid, storm) close or replace it from inside that call.
  if (world.screen.kind === 'site') {
    if (clickedRect(btn.leave)) { world.screen = null; world.game.invalidate(); return true; }
    const rows = world.screen.rows;
    if (!rows.length) {
      // An occupied settlement offers no rows: the only way out is out.
      if (inp.pressedAction(ACTIONS.WITHDRAW) || inp.pressedAction(ACTIONS.CONFIRM)) {
        world.screen = null;
        world.game.invalidate();
      }
      return true;
    }
    const picked = resolveChoiceInput(world, inp, btn, 'site', rows);
    if (picked === 'dismiss') { world.screen = null; world.game.invalidate(); }
    else if (picked) performSiteAction(world, picked);
    return true;
  }
  return false;
}
