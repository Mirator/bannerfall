// What the player can do while standing next to something: recruit and heal in a
// settlement, buy army cap in a town, raid a camp, claim a neutral settlement, and
// the toast line that reports it. Also the post-victory bookkeeping for a razed
// camp (campVictoryExtra) and the stronghold-assault request with its objective
// descriptor (Milestone 025).
import { PAL, WORLD, UNIT_TYPES, BALANCE } from '../data.js?v=r06a7e18cad00';
import { dist2 } from '../engine.js?v=r06a7e18cad00';
import { ACTIONS } from '../input-actions.js?v=r06a7e18cad00';
import {
  REGION, SPECIALIZATIONS, OWNERSHIP,
  encounterObjective, strongholdModifiers, strongholdStateId, strongholdAdvantageLines,
  settlementRecord, STRONGHOLD_POWER_LABELS,
} from '../region.js?v=r06a7e18cad00';

const P = PAL.world;

export function say(world, text, t = 2.4) { world.msg = text; world.msgT = t; }

// each settlement quotes its own prices — Ashford's farm lads are cheap, Brindle's hunters too.
// Milestone 025: an active specialization at THIS settlement overrides the local price for
// its unit type; occupied land stops applying its benefit (isSpecActive checks held state).
export function costAt(world, s, type) {
  const d = UNIT_TYPES[type];
  if (s) {
    const rec = settlementRecord(world.save, s.id);
    if (rec && rec.owner === OWNERSHIP.PLAYER && !rec.occupied && rec.spec) {
      const effect = SPECIALIZATIONS[rec.spec].effect;
      if (type === 'spear' && effect.spearCost != null) return effect.spearCost;
      if (type === 'archer' && effect.archerCost != null) return effect.archerCost;
    }
  }
  if (s && type === 'spear' && s.spearCost) return s.spearCost;
  if (s && type === 'archer' && s.archerCost) return s.archerCost;
  return d.cost;
}

// Local heal price: Coldwell's springs are free, a Market halves the standard rate.
export function healCostAt(world, s) {
  if (s && s.freeHeal) return 0;
  if (s) {
    const rec = settlementRecord(world.save, s.id);
    if (rec && rec.owner === OWNERSHIP.PLAYER && !rec.occupied && rec.spec) {
      const effect = SPECIALIZATIONS[rec.spec].effect;
      if (effect.healCost != null) return effect.healCost;
    }
  }
  return BALANCE.healCost;
}

export function recruit(world, type) {
  const s = world.nearSettlement();
  const d = UNIT_TYPES[type];
  const cost = world.costAt(s, type);
  if (world.save.troops.length >= world.save.armyCap) { world.say('Army is at capacity'); return; }
  if (world.save.gold < cost) { world.say('Not enough gold'); return; }
  world.save.gold -= cost;
  if (world.save.stats) world.save.stats.goldSpent += cost;
  world.save.troops.push({ type });
  world.game.sfx.coin();
  world.say(`${d.name} joined your warband`);
  world.particles.ring(world.hero.x, world.hero.y, 30, P.cream, 0.4, 3);
}

// which way you rode into the fight — battles keep your real map orientation
export function approachTo(world, tx, ty) {
  const dx = tx - world.hero.x, dy = ty - world.hero.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'E' : 'W') : (dy >= 0 ? 'S' : 'N');
}

// occupation state lives on save.settlements, mirroring how save.camps carries razed/garrison
export function isSettlementOccupied(world, s) {
  const st = world.save.settlements.find(x => x.id === s.id);
  return !!(st && st.occupied);
}

export function updateSettlementInteractions(world, inp) {
  const s = world.nearSettlement();
  if (s) {
    const pressedService = inp.pressedAction(ACTIONS.RECRUIT_SPEAR) || inp.pressedAction(ACTIONS.WORLD_PRIMARY) ||
      (s.kind === 'town' && inp.pressedAction(ACTIONS.RECRUIT_KNIGHT)) || inp.pressedAction(ACTIONS.HEAL) ||
      (s.kind === 'town' && inp.pressedAction(ACTIONS.EXPAND_ARMY));
    if (world.isSettlementOccupied(s)) {
      if (pressedService) world.say(`${s.name} is occupied — drive off the raiders to restore its service`);
    } else {
      if (inp.pressedAction(ACTIONS.RECRUIT_SPEAR)) world.recruit('spear');
      if (inp.pressedAction(ACTIONS.WORLD_PRIMARY)) world.recruit('archer');
      if (s.kind === 'town' && inp.pressedAction(ACTIONS.RECRUIT_KNIGHT)) world.recruit('knight');
      if (inp.pressedAction(ACTIONS.HEAL)) {
        const healCost = healCostAt(world, s);
        const heroHurt = world.save.heroHp < world.save.heroMaxHp;
        const troopsHurt = world.save.troops.some(t => t.hp != null && t.hp < UNIT_TYPES[t.type].hp);
        if (!heroHurt && !troopsHurt) world.say('Already rested');
        else if (world.save.gold < healCost) world.say('Not enough gold');
        else {
          world.save.gold -= healCost;
          world.save.stats.goldSpent += healCost;
          world.save.heroHp = world.save.heroMaxHp;
          for (const t of world.save.troops) delete t.hp;
          world.game.sfx.coin();
          world.say(s.freeHeal ? 'The hot springs of Coldwell mend every wound — free of charge' : 'Warband rested and healed');
        }
      }
      if (s.kind === 'town' && inp.pressedAction(ACTIONS.EXPAND_ARMY)) {
        const cost = world.armyCapCost();
        if (world.save.gold >= cost) {
          world.save.gold -= cost; world.save.armyCap += 2;
          world.save.stats.goldSpent += cost;
          world.game.sfx.coin(); world.say(`Army capacity is now ${world.save.armyCap}`);
        } else world.say(`Need ${cost} gold`);
      }
    }
    // Milestone 025 Slice B: claiming neutral ground. G at the gates of an
    // unoccupied, unowned settlement brings it under the banner without a fight —
    // and queues the one-time specialization choice. Occupied land must be won
    // back by the sword (the retake battle's onWinExtra).
    if (s && !world.isSettlementOccupied(s) &&
        settlementRecord(world.save, s.id)?.owner === OWNERSHIP.NEUTRAL &&
        inp.pressedAction(ACTIONS.CLAIM)) {
      if (world.claimSettlement(s)) {
        world.particles.ring(world.hero.x, world.hero.y, 44, P.hero, 0.6, 4);
      }
    }
  }
  // Scouting is deliberately after interaction: a newly revealed garrison is visible
  // to the next phase, but cannot consume the same input as a camp assault.
  for (const c of WORLD.camps) {
    const st = world.save.camps.find(x => x.id === c.id);
    if (st.razed || st.garrison || c.stronghold) continue;
    if (dist2(world.hero.x, world.hero.y, c.x, c.y) < 340 * 340) {
      st.garrison = world.rollGarrison(c);
      // Plan 021 design decision 3: report an honest headcount (bodies), not the
      // strength scalar the toast used to print while calling it a headcount.
      const bodies = st.garrison.length, heavy = st.garrison.includes('brute');
      world.say(`Your scouts count the tents — ${bodies} raider${bodies === 1 ? '' : 's'} hold the camp${heavy ? ', brutes among them' : ''}`, 3);
      world.particles.ring(c.x, c.y, 50, P.ink, 0.5, 3);
    }
  }
  return s;
}

// Plan 021: the razing/absorption logic that used to be an inline onWinExtra closure
// built at press time. It now must be rebuildable at CONFIRM time (decision 6: the
// brief can open before the garrison is rolled), so it lives here as a plain method
// parameterized on the camp/save-camp-state it needs instead of closing over
// press-time locals.
export function campVictoryExtra(world, camp, st) {
  return () => {
    st.razed = true;
    const bonus = camp.stronghold ? 200 : 60;
    world.save.gold += bonus;
    if (world.save.stats) world.save.stats.goldEarned += bonus;
    if (camp.stronghold) world.save.won = true;
    const strongCamp = WORLD.camps.find(c => c.id === 'strong');
    for (const p of (world.save.parties || [])) {
      if (p.camp === camp.id) { p.camp = 'strong'; p.home = { x: strongCamp.x, y: strongCamp.y }; }
    }
    const razedNow = world.save.camps.filter(c => c.razed && c.id !== 'strong').length;
    if (!camp.stronghold) {
      let remnantNote = '';
      if (razedNow >= 3) {
        const strongSt = world.save.camps.find(c => c.id === 'strong');
        if (!strongSt.garrison) strongSt.garrison = world.rollGarrison(strongCamp);
        const remnants = (world.save.parties || []).filter(p => p.camp === 'strong');
        let absorbed = 0;
        for (const p of remnants) { strongSt.garrison.push(...p.comp); absorbed += p.comp.length; }
        world.save.parties = (world.save.parties || []).filter(p => p.camp !== 'strong');
        remnantNote = absorbed > 0
          ? ` ${absorbed} bandit remnants withdraw into Wolfsjaw and man its walls — storm it!`
          : ' Wolfsjaw stands alone — storm it!';
      }
      world.save.toast = `Camp razed (${razedNow}/3)!` + remnantNote;
    }
  };
}

// Plan 021 decision 8: WORLD_PRIMARY on a camp/stronghold opens the brief instead
// of committing immediately. `comp` in the descriptor is display-only — an unscouted
// camp shows unknown in the brief (decision 6) and the real roll happens at confirm.
//
// Milestone 025 Slice E: the stronghold is assaultable at ANY power state once
// found — an early attack is possible but clearly dangerous. Its descriptor carries
// the Break-the-position objective (guard count already reduced by razed linked
// camps) plus the power summary the brief renders; the garrison thinning and the
// reinforcement wave are applied at CONFIRM time in battle-transition.js so an
// abandoned brief never mutates the fight the player would have faced.
export function updateCampInteraction(world, inp, settlement) {
  const camp = world.nearCamp();
  if (!camp || !inp.pressedAction(ACTIONS.WORLD_PRIMARY) || settlement) return false;
  const st = world.save.camps.find(c => c.id === camp.id);
  if (camp.stronghold) {
    const mods = strongholdModifiers(world.save);
    // The watchtower's reward is knowledge: with a watchtower held, the hold's
    // deployment is revealed even before an assault is committed.
    if (mods.revealDeployment && !st.garrison) st.garrison = world.rollGarrison(camp);
    const label = STRONGHOLD_POWER_LABELS[mods.stateId];
    world.requestBattle({
      campId: camp.id,
      title: `ASSAULT ON ${camp.name.toUpperCase()}`,
      subtitle: `${label} — ${strongholdAdvantageLines(mods)[0]}`,
      arena: 'camp',
      ambush: false,
      approach: world.approachTo(camp.x, camp.y),
      deploy: 4, // YOU are storming THEM — they scramble to arms, not a parade formup
      comp: st.garrison ? st.garrison.slice() : null,
      // The razed-camp guard reduction is part of the fight itself, not just the
      // brief prose: the objective the player must break carries mods.guards, so
      // "2 defensive guards remain" is literally how many guards stand.
      objective: { ...encounterObjective('stronghold'), guards: mods.guards },
      stronghold: { mods, advantages: strongholdAdvantageLines(mods), label },
      canWithdraw: true, // explicit WORLD_PRIMARY press — always player-initiated
      partyMeta: { campId: camp.id },
    });
    return true;
  }
  world.requestBattle({
    campId: camp.id,
    title: 'RAID THE CAMP',
    subtitle: 'Break the position — one of the linked camps feeding Wolfsjaw',
    arena: 'camp',
    ambush: false,
    approach: world.approachTo(camp.x, camp.y),
    deploy: 4, // YOU are storming THEM — they scramble to arms, not a parade formup
    comp: st.garrison ? st.garrison.slice() : null,
    objective: encounterObjective('camp'),
    canWithdraw: true, // explicit WORLD_PRIMARY press — always player-initiated
    partyMeta: { campId: camp.id },
  });
  return true;
}
