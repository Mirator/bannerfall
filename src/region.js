// Milestone 025 — regional configuration and the pure regional-state functions.
//
// This module is the single data-driven home for everything Plan 025 added to the
// campaign: settlement ownership vocabulary, the four specializations, camp-to-
// stronghold links, the stronghold power ladder and its battle-modifier table, the
// battle-objective tuning, and the raid cadence. Game logic consumes these
// definitions through the exported helpers; balance values never live as scattered
// literals in a phase or a renderer.
//
// Like constants.js, this module depends on nothing but data.js ON PURPOSE — an
// import cycle is a real hazard with no bundler, and world.js, save.js,
// battle-transition.js and the test suites all read from here.
//
// Every exported function over regional state is PURE over (save, definitions):
// they take the canonical save object and return derived facts. Nothing here reads
// presentation state, touches RNG, or mutates its inputs, so the whole regional
// model is test-addressable in plain Node (tests/e2e/region.spec.js imports this
// file directly).
import { WORLD, UNIT_TYPES, BALANCE } from './data.js?v=r47a9e4eb3305';

// ---------------------------------------------------------------------------
// Regional configuration — one named region (Milestone 025 scope: exactly one).
// ---------------------------------------------------------------------------

export const REGION = Object.freeze({
  name: 'The Ashen March',
  strongholdId: 'strong',
  // Ordinary camps linked to the stronghold: razing one removes one defensive
  // guard from the final battle (see strongholdModifiers below).
  linkedCamps: ['c1', 'c2', 'c3'],
  // A watchtower settlement scouts camps within this radius every live tick.
  watchtowerScoutR: 900,
});

// ---------------------------------------------------------------------------
// Settlement ownership vocabulary.
//   neutral  — available for peaceful interaction, may be claimed freely
//   player   — captured (owner === 'player') and providing its specialization
//   occupied — controlled by an enemy party (occupied === true); unavailable
// A player-owned settlement that is occupied keeps its specialization data but
// stops applying it until reclaimed.
// ---------------------------------------------------------------------------

export const OWNERSHIP = Object.freeze({
  NEUTRAL: 'neutral',
  PLAYER: 'player',
});

export function settlementRecord(save, id) {
  return (save.settlements || []).find(s => s.id === id) || null;
}

export function settlementState(save, id) {
  const st = settlementRecord(save, id);
  if (!st) return null;
  return st.occupied ? 'occupied' : (st.owner === OWNERSHIP.PLAYER ? 'player' : 'neutral');
}

export function isPlayerOwned(save, id) {
  const st = settlementRecord(save, id);
  return !!(st && st.owner === OWNERSHIP.PLAYER);
}

// Settlements the player controls right now (owned and not occupied). This is the
// count that feeds stronghold power and the campaign summary's "currently held".
export function heldSettlements(save) {
  return (save.settlements || []).filter(s => s.owner === OWNERSHIP.PLAYER && !s.occupied);
}

// ---------------------------------------------------------------------------
// Specializations — exactly one per captured settlement, permanent for the run.
// `effect` values are consumed by the interaction code (costAt/heal) and the
// world tick (watchtower scouting); `immediate`/`ongoing` are UI prose for the
// selection modal. Costs are absolute prices, not discounts, so the recruitment
// panel can show the resulting number directly.
// ---------------------------------------------------------------------------

export const SPECIALIZATIONS = Object.freeze({
  barracks: {
    name: 'Barracks',
    glyph: '⚒',
    effect: { spearCost: 8 },
    immediate: { grantTroops: { type: 'spear', count: 2 }, text: '2 spearmen drill with you at once' },
    ongoing: 'Spearmen recruited here for 8g',
  },
  archery: {
    name: 'Archery Range',
    glyph: '➶',
    effect: { archerCost: 15 },
    immediate: { grantTroops: { type: 'archer', count: 2 }, text: '2 archers sign on at once' },
    ongoing: 'Archers recruited here for 15g',
  },
  market: {
    name: 'Market',
    glyph: '⛃',
    effect: { healCost: Math.round(BALANCE.healCost / 2), captureGold: 80 },
    immediate: { gold: 80, text: '+80 gold trade toll, paid now' },
    ongoing: `Rest & heal here for ${Math.round(BALANCE.healCost / 2)}g`,
  },
  watchtower: {
    name: 'Watchtower',
    glyph: '👁',
    effect: { scoutR: REGION.watchtowerScoutR },
    immediate: { scout: true, text: 'Nearby camps revealed at once' },
    ongoing: 'Camps near this town stay scouted',
  },
});

export const SPEC_IDS = Object.freeze(Object.keys(SPECIALIZATIONS));

export function isValidSpec(spec) {
  return typeof spec === 'string' && Object.prototype.hasOwnProperty.call(SPECIALIZATIONS, spec);
}

export function specializationOf(save, id) {
  const st = settlementRecord(save, id);
  return st && st.owner === OWNERSHIP.PLAYER ? (st.spec || null) : null;
}

// A specialization applies exactly while its settlement is player-held.
export function isSpecActive(save, id) {
  return settlementState(save, id) === 'player' && isValidSpec((settlementRecord(save, id) || {}).spec);
}

export function findSpecSettlements(save, spec) {
  return (save.settlements || []).filter(s =>
    s.owner === OWNERSHIP.PLAYER && !s.occupied && s.spec === spec);
}

// ---------------------------------------------------------------------------
// Stronghold power — a small discrete ladder driven ONLY by deterministic inputs
// that already live in the save (owned settlements, razed linked camps). Power is
// therefore never persisted itself: it is a pure derivation, and a reloaded
// campaign recomputes the identical state.
// ---------------------------------------------------------------------------

// points = held settlements + razed linked camps. Thresholds below decide the
// state; every supported seed reaches Exposed by capturing all four settlements
// even if no camp ever falls (4 >= exposedAt), so a beatable route always exists.
export const STRONGHOLD_POWER = Object.freeze({
  states: [
    { id: 'entrenched', label: 'ENTRENCHED', minPoints: 0 },
    { id: 'weakened', label: 'WEAKENED', minPoints: 2 },
    { id: 'exposed', label: 'EXPOSED', minPoints: 4 },
  ],
  // Exposed strips the starting garrison down to this fraction of its rolled size.
  exposedGarrisonFrac: 0.55,
  // Two captured settlements remove the reinforcement wave (example mapping in
  // the milestone; the exact threshold lives here, not in a conditional).
  waveRemovalCaptures: 2,
  // Each razed linked camp removes one defensive guard from the final battle,
  // never dropping below the two-objective minimum of Break the position.
  minGuards: 2,
});

export function razedLinkedCamps(save) {
  return REGION.linkedCamps.filter(id => {
    const st = (save.camps || []).find(c => c.id === id);
    return st && st.razed;
  }).length;
}

export function strongholdPoints(save) {
  return heldSettlements(save).length + razedLinkedCamps(save);
}

export function strongholdStateId(save) {
  const points = strongholdPoints(save);
  let current = STRONGHOLD_POWER.states[0];
  for (const s of STRONGHOLD_POWER.states) if (points >= s.minPoints) current = s;
  return current.id;
}

// state id → HUD/brief label, derived from the ladder so the two cannot drift.
export const STRONGHOLD_POWER_LABELS = Object.freeze(
  Object.fromEntries(STRONGHOLD_POWER.states.map(s => [s.id, s.label])));

export function ownsWatchtower(save) {
  return findSpecSettlements(save, 'watchtower').length > 0;
}

// The full modifier bundle the finale consumes when assembling the assault. Pure
// over save: the same save always produces the same battle.
export function strongholdModifiers(save) {
  const stateId = strongholdStateId(save);
  const captures = heldSettlements(save).length;
  const razed = razedLinkedCamps(save);
  return {
    stateId,
    points: strongholdPoints(save),
    maxPoints: WORLD.settlements.length + REGION.linkedCamps.length,
    // Entrenched gets one reinforcement wave; `waveRemovalCaptures` captures remove it.
    waves: captures >= STRONGHOLD_POWER.waveRemovalCaptures ? 0 : 1,
    // Break-the-position guard count for the stronghold fight.
    guards: Math.max(STRONGHOLD_POWER.minGuards, 3 - razed),
    // The watchtower specialization reveals the enemy deployment in the brief.
    revealDeployment: ownsWatchtower(save),
    // Exposed thins the starting garrison.
    garrisonMul: stateId === 'exposed' ? STRONGHOLD_POWER.exposedGarrisonFrac : 1,
  };
}

// Human-readable summary of WHY the hold still holds — shown verbatim in the
// pre-battle brief. Derived, never hand-maintained.
export function strongholdAdvantageLines(mods) {
  const lines = [];
  lines.push(mods.waves > 0
    ? 'A reserve wave will reinforce the garrison mid-battle'
    : 'Its reserve is committed elsewhere — no reinforcements');
  lines.push(mods.guards >= 3
    ? 'All three defensive guards still stand'
    : `${mods.guards} defensive guard${mods.guards === 1 ? '' : 's'} remain${mods.guards === 1 ? 's' : ''} (camps razed broke the rest)`);
  if (mods.garrisonMul < 1) lines.push('The garrison is thin — the hold is EXPOSED');
  if (!mods.revealDeployment) lines.push('Their deployment is unscouted');
  else lines.push('Your watchtowers read their deployment');
  return lines;
}

// ---------------------------------------------------------------------------
// Battle objectives — shared tuning for Hold the ground and Break the position.
// Placement geometry lives battle-side (it needs battlefield terrain); the
// numbers here are the campaign-facing contract.
// ---------------------------------------------------------------------------

export const OBJECTIVES = Object.freeze({
  hold: {
    duration: 35,     // seconds of uncontested holding to win
    radius: 170,      // marked area radius on the battlefield
  },
  break: {
    targetHp: 260,    // explicit health, per the milestone contract
    radius: 30,       // physical footprint of one guard
    campGuards: 2,    // ordinary camps defend with two objectives...
    strongholdGuards: 3, // ...the authored stronghold with three
  },
});

// Which objective an encounter uses, decided in ONE place so a caller can never
// improvise a second mapping.
export function encounterObjective(kind) {
  if (kind === 'settlement') {
    return { kind: 'hold', duration: OBJECTIVES.hold.duration, radius: OBJECTIVES.hold.radius };
  }
  if (kind === 'camp') {
    return { kind: 'break', guards: OBJECTIVES.break.campGuards, hp: OBJECTIVES.break.targetHp, radius: OBJECTIVES.break.radius };
  }
  if (kind === 'stronghold') {
    return { kind: 'break', guards: OBJECTIVES.break.strongholdGuards, hp: OBJECTIVES.break.targetHp, radius: OBJECTIVES.break.radius };
  }
  return null; // elimination — roaming parties keep the classic fight
}

export const OBJECTIVE_LABELS = Object.freeze({
  elimination: 'Destroy every raider',
  hold: 'Hold the ground',
  break: 'Break the position',
});

// ---------------------------------------------------------------------------
// Regional pressure — stronghold raids on player settlements.
// ---------------------------------------------------------------------------

export const RAID = Object.freeze({
  intervalT: 80,            // flowing seconds between dispatched raids
  firstDelayT: 110,         // quiet time after a fresh campaign / reload
  graceAfterCaptureT: 60,   // cadence grace after capturing a settlement
  graceAfterDefenseT: 90,   // cadence grace after winning a defense
  defenseR: 560,            // hero within this range when the raid lands = defense battle
  raidSpeedBoost: 1,        // regional riders use the standard raid speed
});

// ---------------------------------------------------------------------------
// Campaign summary counters — the canonical list the victory screen renders, in
// render order. Kept declarative so the schema, the bookkeeping and the screen
// cannot drift apart.
// ---------------------------------------------------------------------------

export const SUMMARY_FIELDS = Object.freeze(['playT', 'won', 'lostBattles', 'captures', 'kills', 'lost']);
