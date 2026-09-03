// Plan 030 — the one door into everything on the campaign map. WORLD_PRIMARY next to a
// village, a town, a camp or the stronghold opens a single modal listing what can be done
// there; nothing on the map is a bare hotkey any more.
//
// The split is the same one the rest of the world scene keeps: this module owns the MODEL
// (which rows exist, what they cost, why one is refused) and the DISPATCH (which existing
// seam a row calls). It owns no drawing — world-screens.js draws the model — and it owns no
// rules: every row commits through the method that already held the rule, so a row's price
// tag and its charge cannot disagree.
import { PAL, UNIT_TYPES, oddsWord, ODDS_WORDS, armySlots } from '../data.js?v=rd77bf905fb0b';
import { bannerCost, bannerLabel } from '../progression.js?v=rd77bf905fb0b';
import { ACTIONS } from '../input-actions.js?v=rd77bf905fb0b';
import {
  OWNERSHIP, SPECIALIZATIONS, REGION,
  encounterObjective, strongholdModifiers, strongholdAdvantageLines, settlementRecord,
  STRONGHOLD_POWER_LABELS,
} from '../region.js?v=rd77bf905fb0b';
import { restAndHeal, expandArmy } from './settlement-interactions.js?v=rd77bf905fb0b';

const P = PAL.world;
const specName = id => (SPECIALIZATIONS[id] || {}).name || id;

// Settlement wins over camp, exactly as the old two-phase order did (World.update passed
// the near settlement into updateCampInteraction so a camp could never steal its press).
// Nothing in the world places one of each inside both radii, but the precedence is stated
// here rather than left to which check happens to run first.
export function nearestSite(world) {
  const s = world.nearSettlement();
  if (s) return { kind: 'settlement', def: s };
  const camp = world.nearCamp();
  if (camp) return { kind: 'camp', def: camp };
  return null;
}

// The one-line map chip's text. Lives here beside the model so the name the chip promises
// is the name the modal's title uses.
export function siteChipLabel(world, site) {
  if (!site) return null;
  if (site.kind === 'camp') return site.def.stronghold ? site.def.name : 'Bandit camp';
  if (world.isSettlementOccupied(site.def)) return `${site.def.name} — OCCUPIED`;
  return site.def.kind === 'town' ? site.def.name : `Village of ${site.def.name}`;
}

const slotTag = (type) => {
  const n = UNIT_TYPES[type].slots ?? 1;
  return n > 1 ? ` · ${n} places` : '';
};

// A recruit row states its price, its slot cost and its role: everything the old prompt's
// three separate lines carried, on the row that actually buys the man.
function recruitRow(world, s, type) {
  const d = UNIT_TYPES[type];
  const cost = world.costAt(s, type);
  const slots = d.slots ?? 1;
  const noRoom = armySlots(world.save.troops) + slots > world.save.armyCap;
  return {
    id: `recruit-${type}`,
    label: `${d.name} — ${cost}g${slotTag(type)}`,
    detail: d.role,
    enabled: !noRoom && world.save.gold >= cost,
    disabledReason: noRoom
      ? (slots > 1 ? `No room — takes ${slots} places` : 'Army is at capacity')
      : (world.save.gold < cost ? 'Not enough gold' : null),
  };
}

function settlementRows(world, s) {
  // Occupied land offers nothing: the raiders holding it are the only interaction, and
  // they are fought by riding into them, not chosen from a list.
  if (world.isSettlementOccupied(s)) return [];
  const rows = [recruitRow(world, s, 'spear'), recruitRow(world, s, 'archer')];
  if (s.kind === 'town') rows.push(recruitRow(world, s, 'knight'));

  const healCost = world.healCostAt(s);
  rows.push({
    id: 'heal',
    label: s.freeHeal ? 'Rest & heal — FREE' : `Rest & heal — ${healCost}g`,
    detail: s.freeHeal
      ? 'The hot springs of Coldwell mend every wound'
      : 'Your wounds and your warband\'s, back to full',
    enabled: world.save.gold >= healCost,
    disabledReason: world.save.gold < healCost ? 'Not enough gold' : null,
  });

  if (s.kind === 'town') {
    const capCost = world.armyCapCost();
    rows.push({
      id: 'expand',
      label: `Expand the column +2 — ${capCost}g`,
      detail: `Room for two more places (now ${world.save.armyCap})`,
      enabled: world.save.gold >= capCost,
      disabledReason: world.save.gold < capCost ? `Need ${capCost} gold` : null,
    });
    const bCost = bannerCost(world.save.banner);
    rows.push(bCost == null
      ? {
          id: 'banner',
          label: `Banner: ${bannerLabel(world.save.banner)}`,
          detail: 'It already flies as high as it can',
          enabled: false,
          disabledReason: 'Highest stage',
        }
      : {
          id: 'banner',
          label: `Raise the banner — ${bCost}g`,
          detail: `${bannerLabel(world.save.banner)} → ${bannerLabel(world.save.banner + 1)}s: the rank your veterans may reach`,
          enabled: world.save.gold >= bCost,
          disabledReason: world.save.gold < bCost ? `Need ${bCost} gold` : null,
        });
  }

  const rec = settlementRecord(world.save, s.id);
  if (rec?.owner === OWNERSHIP.NEUTRAL) {
    // Plan 038: a claim is a purchase, priced like every other row here — the label
    // states what it costs, the row refuses when the purse is short, and both read the
    // one formula World.claimCost() charges.
    const claimCost = world.claimCost(s);
    rows.push({
      id: 'claim',
      label: `Claim it for your banner — ${claimCost}g`,
      detail: 'No fight — nobody hostile holds it, its people want paying. Then choose what it becomes.',
      enabled: world.save.gold >= claimCost,
      disabledReason: world.save.gold < claimCost ? `Need ${claimCost} gold` : null,
    });
  } else if (rec?.owner === OWNERSHIP.PLAYER && !rec.spec) {
    rows.push({
      id: 'spec',
      label: 'Choose what it becomes',
      detail: 'One permanent calling, still undecided',
      enabled: true, disabledReason: null,
    });
  }
  return rows;
}

function campRows(world, camp) {
  if (camp.stronghold) {
    const mods = strongholdModifiers(world.save);
    return [{
      id: 'storm',
      label: 'Storm the hold',
      // Milestone 025 Slice E: assaultable at ANY power state. The row is always
      // offered and the detail line says how weakened it actually is, rather than the
      // old prompt's habit of hiding the option below three razed camps.
      detail: strongholdAdvantageLines(mods)[0],
      enabled: true, disabledReason: null,
    }];
  }
  return [{
    id: 'raid',
    label: 'Raid the camp',
    detail: `One of the linked camps feeding Wolfsjaw (counts toward the ${REGION.linkedCamps.length})`,
    enabled: true, disabledReason: null,
  }];
}

// Pure over (site, save): the same site and the same save always build the same menu.
export function buildSiteModel(world, site = nearestSite(world), index = 0) {
  if (!site) return null;
  const rows = site.kind === 'settlement' ? settlementRows(world, site.def) : campRows(world, site.def);
  let title, subtitle;
  if (site.kind === 'camp') {
    const camp = site.def;
    if (camp.stronghold) {
      const mods = strongholdModifiers(world.save);
      const razed = world.save.camps.filter(c => c.razed && c.id !== 'strong').length;
      title = camp.name.toUpperCase();
      subtitle = razed < REGION.linkedCamps.length
        ? `${STRONGHOLD_POWER_LABELS[mods.stateId]} — its camps still feed it (${razed}/${REGION.linkedCamps.length})`
        : `${STRONGHOLD_POWER_LABELS[mods.stateId]} — the supply lines are cut`;
    } else {
      // Plan 021 design decision 3: proximity prompts carry the odds WORD, never a
      // strength number. Hover the camp for the full breakdown.
      const est = world.garrisonStrength(camp);
      const odds = est == null ? null : oddsWord(est, world.myStrength());
      title = 'BANDIT CAMP';
      // The outmatched word is already a sentence with its own warning glyph; the other two
      // are bare adjectives that need the noun the old prompt gave them.
      subtitle = odds == null ? 'Ride closer to scout it'
        : (odds === ODDS_WORDS.outmatched ? odds : `The odds: ${odds}`);
    }
  } else {
    const s = site.def;
    const rec = settlementRecord(world.save, s.id);
    title = s.kind === 'town' ? s.name.toUpperCase() : `VILLAGE OF ${s.name.toUpperCase()}`;
    if (world.isSettlementOccupied(s)) {
      subtitle = 'Occupied — a raiding party has seized it. Drive them out to restore its service.';
    } else if (rec?.owner === OWNERSHIP.PLAYER && rec.spec) {
      subtitle = `${s.flavor} · yours — ${specName(rec.spec)}`;
    } else {
      subtitle = s.flavor;
    }
  }
  return {
    kind: 'site',
    site: { kind: site.kind, id: site.def.id, name: site.def.name },
    title, subtitle, rows,
    index: rows.length ? Math.min(Math.max(0, index), rows.length - 1) : 0,
    // The scrim covers the HUD's resource chip, and a shop you cannot see your purse from
    // is unusable. Carried on the model so the panel stays pure over it.
    purse: {
      gold: world.save.gold,
      slots: armySlots(world.save.troops),
      cap: world.save.armyCap,
      hp: world.save.heroHp,
      maxHp: world.save.heroMaxHp,
    },
    // The map toast is under the scrim too. Every service's refusal and confirmation
    // already goes through world.say(), so the panel reports whatever the last row said —
    // and msgT does not decay while a screen is open, so it simply stays readable.
    notice: world.msgT > 0 && world.msg ? world.msg : null,
  };
}

// Rebuilt after every mutating row, never patched: prices, slot counts and the purse in
// the header re-derive from the save, so what the panel shows is what the next press pays.
export function refreshSiteModel(world) {
  if (!world.screen || world.screen.kind !== 'site') return;
  const site = nearestSite(world);
  if (!site) { world.screen = null; return; }
  world.screen = buildSiteModel(world, site, world.screen.index);
  world.game.invalidate();
}

// Every branch commits through the method that already owned the rule — recruit(),
// upgradeBanner(), claimSettlement() and the two extracted service helpers all keep their
// own refusal wording, which is what the panel's notice line reports.
export function performSiteAction(world, rowId) {
  const site = nearestSite(world);
  if (!site) { world.screen = null; return; }
  if (site.kind === 'camp') { requestSiteAssault(world, site.def); return; }
  const s = site.def;
  if (world.isSettlementOccupied(s)) return;
  switch (rowId) {
    case 'recruit-spear': world.recruit('spear'); break;
    case 'recruit-archer': world.recruit('archer'); break;
    case 'recruit-knight': if (s.kind === 'town') world.recruit('knight'); break;
    case 'heal': restAndHeal(world, s); break;
    case 'expand': if (s.kind === 'town') expandArmy(world); break;
    case 'banner': if (s.kind === 'town') world.upgradeBanner(); break;
    // Claiming and choosing a calling both raise a modal of their own, and both
    // queueSpecChoice() and offerPerkChoice() no-op while a screen is open. Close this one
    // FIRST or the prompt they raise is silently swallowed.
    case 'claim': {
      const rec = settlementRecord(world.save, s.id);
      if (rec?.owner !== OWNERSHIP.NEUTRAL) break;
      // Plan 038: a claim can now be REFUSED for price, and a refusal must keep the
      // panel up so its notice line reports claimSettlement own wording, exactly as
      // a refused recruit or a refused expansion does. Only a claim that will land
      // closes the menu first, because the spec choice it raises is swallowed while a
      // screen is open.
      if (world.save.gold < world.claimCost(s)) { world.claimSettlement(s); break; }
      world.screen = null;
      if (world.claimSettlement(s)) world.particles.ring(world.hero.x, world.hero.y, 44, P.hero, 0.6, 4);
      return;
    }
    case 'spec': {
      const rec = settlementRecord(world.save, s.id);
      if (rec?.owner !== OWNERSHIP.PLAYER || rec.spec) break;
      world.screen = null;
      world.openSpecChoice(s.id);
      return;
    }
    default: return;
  }
  refreshSiteModel(world);
}

// Plan 021 decision 8 / Milestone 025 Slice E, moved here intact from the old
// updateCampInteraction: the assault opens a BRIEF rather than committing. `comp` is
// display-only — an unscouted camp shows unknown — and the garrison thinning and the
// reinforcement wave are applied at CONFIRM time in battle-transition.js, so an abandoned
// brief never mutates the fight the player would have faced.
function requestSiteAssault(world, camp) {
  const st = world.save.camps.find(c => c.id === camp.id);
  if (camp.stronghold) {
    const mods = strongholdModifiers(world.save);
    // The watchtower's reward is knowledge: with one held, the hold's deployment is
    // revealed even before an assault is committed.
    if (mods.revealDeployment && !st.garrison) st.garrison = world.rollGarrison(camp);
    const label = STRONGHOLD_POWER_LABELS[mods.stateId];
    world.requestBattle({
      campId: camp.id,
      title: `ASSAULT ON ${camp.name.toUpperCase()}`,
      subtitle: `${label} — ${strongholdAdvantageLines(mods)[0]}`,
      arena: 'camp',
      ambush: false,
      approach: world.approachTo(camp.x, camp.y),
      // No `deploy` field: absent means the Plan 033 deployment phase opens the assault —
      // you chose this fight. Only `deploy: 0` (you caught them) or an ambush skips it.
      comp: st.garrison ? st.garrison.slice() : null,
      // The razed-camp guard reduction is part of the fight itself, not just the brief
      // prose: the objective carries mods.guards, so "2 defensive guards remain" is
      // literally how many guards stand.
      objective: { ...encounterObjective('stronghold'), guards: mods.guards },
      stronghold: { mods, advantages: strongholdAdvantageLines(mods), label },
      canWithdraw: true, // reached by an explicit choice — always player-initiated
      partyMeta: { campId: camp.id },
    });
    return;
  }
  world.requestBattle({
    campId: camp.id,
    title: 'RAID THE CAMP',
    subtitle: 'Break the position — one of the linked camps feeding Wolfsjaw',
    arena: 'camp',
    ambush: false,
    approach: world.approachTo(camp.x, camp.y),
    comp: st.garrison ? st.garrison.slice() : null,
    objective: encounterObjective('camp'),
    canWithdraw: true,
    partyMeta: { campId: camp.id },
  });
}

// The world phase. Replaces updateCampInteraction in World.update's order: it now opens
// the menu for a settlement too, so there is exactly one press that means "interact".
//
// It MUST return true on the tick it opens the menu (AGENTS.md), or every phase below runs
// this tick with a screen already up — hero movement included, which would slide the player
// out of range of the menu they just opened.
export function updateSiteInteraction(world, inp) {
  if (!inp.pressedAction(ACTIONS.WORLD_PRIMARY)) return false;
  const site = nearestSite(world);
  if (!site) return false;
  // The map toast lives under the modal's scrim, and msgT does not decay while a screen is
  // open. Cleared BEFORE the model is built, because the model captures the notice: opening
  // the menu must report this visit, not whatever the last ride said.
  world.msg = ''; world.msgT = 0;
  const model = buildSiteModel(world, site);
  if (!model) return false;
  world.screen = model;
  world.game.sfx.uiSelect();
  world.game.invalidate();
  return true;
}
