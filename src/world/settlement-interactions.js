// The settlement services themselves: local prices, recruiting, resting, buying column
// room, and the toast line that reports each one. Also the passive camp scouting that runs
// just by riding near, and the post-victory bookkeeping for a razed camp
// (campVictoryExtra).
//
// Plan 030 moved the KEYS out. Nothing here reads input any more: every service below is
// called by a row of the site menu (world/site-menu.js), which is what the one map verb
// opens. The rules — and their refusal wording — stay here, so the menu's row state and
// the charge it makes can never disagree.
import { PAL, WORLD, UNIT_TYPES, BALANCE, armySlots, troopMaxHp } from '../data.js?v=ra314b0d08bae';
import { perkMods, recruitTroop } from '../progression.js?v=ra314b0d08bae';
import { dist2 } from '../engine.js?v=ra314b0d08bae';
import { REGION, SPECIALIZATIONS, OWNERSHIP, settlementRecord } from '../region.js?v=ra314b0d08bae';

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
  // Plan 029: the cap counts PLACES IN THE COLUMN, not bodies — a knight is two, which is
  // the audit's own fix for "knights only" being strictly optimal per slot. The refusal
  // names the real reason, because "Army is at capacity" while the bar reads 11/12 would
  // read as a bug rather than as a rule.
  const slots = d.slots ?? 1;
  if (armySlots(world.save.troops) + slots > world.save.armyCap) {
    world.say(slots > 1
      ? `No room — a ${d.name.toLowerCase()} takes ${slots} places in the column`
      : 'Army is at capacity');
    return;
  }
  if (world.save.gold < cost) { world.say('Not enough gold'); return; }
  world.save.gold -= cost;
  if (world.save.stats) world.save.stats.goldSpent += cost;
  // The Veteran Cadre perk: men who join a banner with a reputation are not raw. It makes
  // replacing a dead veteran cheaper, never free — a rank-1 recruit is still three battles
  // behind an Elite. `recruitTroop` is the single seam (the specialization grant uses the
  // same one), so the perk cannot apply at this door and miss another.
  const troop = recruitTroop(world.save, type);
  world.save.troops.push(troop);
  world.game.sfx.coin();
  world.say(`${d.name} joined your warband${troop.vet ? ' — blooded already' : ''}`);
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

// Rest & heal. Extracted from the old KeyF branch unchanged, refusals included.
export function restAndHeal(world, s) {
  const healCost = healCostAt(world, s);
  const heroHurt = world.save.heroHp < world.save.heroMaxHp;
  // Plan 029: a veteran's full health is his RANKED maximum, so "already rested" must
  // compare against that or a wounded Elite would be told he is fine. The Drillyard perk's
  // threshold shift is passed for the same reason the save validator takes it — the game
  // grants rank with it applied.
  const earlier = perkMods(world.save.perks).rankEarlier;
  const troopsHurt = world.save.troops.some(t => t.hp != null && t.hp < troopMaxHp(t, earlier));
  if (!heroHurt && !troopsHurt) { world.say('Already rested'); return false; }
  if (world.save.gold < healCost) { world.say('Not enough gold'); return false; }
  world.save.gold -= healCost;
  world.save.stats.goldSpent += healCost;
  world.save.heroHp = world.save.heroMaxHp;
  for (const t of world.save.troops) delete t.hp;
  world.game.sfx.coin();
  world.say(s.freeHeal ? 'The hot springs of Coldwell mend every wound — free of charge' : 'Warband rested and healed');
  return true;
}

// Two more places in the column. A town service, and World.armyCapCost() owns the price so
// the menu's row and this charge read the same number.
export function expandArmy(world) {
  const cost = world.armyCapCost();
  if (world.save.gold < cost) { world.say(`Need ${cost} gold`); return false; }
  world.save.gold -= cost;
  world.save.armyCap += 2;
  world.save.stats.goldSpent += cost;
  world.game.sfx.coin();
  world.say(`Army capacity is now ${world.save.armyCap}`);
  return true;
}

// The phase keeps its name and its slot in World.update's order, but all it does now is the
// passive scouting below and reporting which settlement the hero stands at — the site menu
// resolves its own target, and the world screens own every press.
export function updateSettlementInteractions(world) {
  const s = world.nearSettlement();
  // Scouting stays ahead of the site menu in the tick order: a garrison revealed by riding
  // close is visible to the menu the same press opens, and it consumes no input of its own.
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
      if (razedNow >= REGION.linkedCamps.length) {
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
      world.save.toast = `Camp razed (${razedNow}/${REGION.linkedCamps.length})!` + remnantNote;
    }
  };
}
