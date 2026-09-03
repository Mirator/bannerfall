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
// Only BALANCE is read here: `WORLD` went unused when strongholdModifiers stopped
// publishing the map's total as a point denominator (see STRONGHOLD_TOP_POINTS), and
// `UNIT_TYPES` had already been dead alongside it.
import { BALANCE } from './data.js?v=rc8cb77fab13e';

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

// points = held settlements + razed linked camps. Each state row carries BOTH of its
// requirements as fields, and strongholdStateId() applies them uniformly - there is no
// per-state conditional anywhere.
//
// PLAN 038 ADDED `minRazedCamps` AND IT INVERTS WHAT THIS COMMENT USED TO PROMISE. It
// read: "every supported seed reaches Exposed by capturing all four settlements even if
// no camp ever falls, so a beatable route always exists". Measured, that was not a safety
// net but the dominant strategy: four free claims reached EXPOSED on 12 of 12 seeds, and
// EXPOSED thins the hold's garrison to 55%, so the only policy that ever won a campaign
// was the one that never fought (`critiques/campaign-arc-baseline.md`). Supply lines are
// what leave a hold exposed, so EXPOSED now needs at least one linked camp broken.
//
// The beatable route that the old comment was protecting still exists and is now the one
// the game's own toasts point at: camp c1 at tier 0.7, priced off the campaign stage
// rather than off the warband (Plan 038 Slice B), which the harness measures at a 92%
// win rate for a fresh warband that gives orders. The `campRaider` and `captureThenRaze`
// rows of `critiques/campaign-arc-comparison.md` are the evidence, not this sentence.
export const STRONGHOLD_POWER = Object.freeze({
  states: [
    { id: 'entrenched', label: 'ENTRENCHED', minPoints: 0, minRazedCamps: 0 },
    { id: 'weakened', label: 'WEAKENED', minPoints: 2, minRazedCamps: 0 },
    { id: 'exposed', label: 'EXPOSED', minPoints: 4, minRazedCamps: 1 },
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
  const razed = razedLinkedCamps(save);
  let current = STRONGHOLD_POWER.states[0];
  for (const s of STRONGHOLD_POWER.states) {
    if (points >= s.minPoints && razed >= (s.minRazedCamps || 0)) current = s;
  }
  return current.id;
}

// state id → HUD/brief label, derived from the ladder so the two cannot drift.
export const STRONGHOLD_POWER_LABELS = Object.freeze(
  Object.fromEntries(STRONGHOLD_POWER.states.map(s => [s.id, s.label])));

// The ladder's REAL top: the highest point threshold any state asks for. It is not the
// map's total of settlements plus linked camps — that is 7 — and the HUD used the total as
// its denominator until this fix, so a campaign standing at the top of the ladder was told
// "4/7" and looked 43% short of something that does not exist. Derived from the states, so
// retuning `minPoints` moves the HUD with it.
export const STRONGHOLD_TOP_POINTS =
  STRONGHOLD_POWER.states.reduce((top, s) => Math.max(top, s.minPoints), 0);

// The rung above the current one, or null at the top. strongholdStateId() returns the last
// state whose BOTH requirements are met, so the next entry in declaration order is what is
// still owed.
function nextLadderState(save) {
  const id = strongholdStateId(save);
  const i = STRONGHOLD_POWER.states.findIndex(s => s.id === id);
  return STRONGHOLD_POWER.states[i + 1] || null;
}

// What the campaign still owes for that next rung, as one short sentence, or '' at the top.
//
// Points stopped being the whole story in Plan 038: EXPOSED needs `minPoints` AND
// `minRazedCamps`, so four free claims sit at the point threshold and stay WEAKENED. The
// HUD said nothing about the missing camp, and that is the state a playtest reached. Both
// deficits are computed here and the sentence names whichever are outstanding.
export function nextStepHint(save) {
  const next = nextLadderState(save);
  if (!next) return '';
  const needPoints = next.minPoints - strongholdPoints(save);
  const needRazed = (next.minRazedCamps || 0) - razedLinkedCamps(save);
  const camps = n => (n === 1 ? 'one linked camp' : `${n} linked camps`);
  if (needPoints <= 0 && needRazed > 0) return `Raze ${camps(needRazed)} to expose it`;
  if (needRazed > 0) {
    return `Capture or raze ${needPoints} more — ${needRazed === 1 ? 'one a linked camp' : `${needRazed} of them linked camps`}`;
  }
  return `Capture or raze ${needPoints} more`;
}

export function ownsWatchtower(save) {
  return findSpecSettlements(save, 'watchtower').length > 0;
}

// The full modifier bundle the finale consumes when assembling the assault. Pure
// over save: the same save always produces the same battle.
export function strongholdModifiers(save) {
  const stateId = strongholdStateId(save);
  const captures = heldSettlements(save).length;
  const razed = razedLinkedCamps(save);
  const points = strongholdPoints(save);
  return {
    stateId,
    points,
    // What the HUD counts against: the ladder's top, not the map's total. `maxPoints` (the
    // total) was this bundle's only denominator and nothing but the chip ever read it, so
    // it is gone rather than left here to be picked up again by mistake.
    topPoints: STRONGHOLD_TOP_POINTS,
    // Clamped progress, because razing all three camps on top of four captures scores 7
    // and a chip reading "7/4" is worse than one reading "4/4".
    ladderPoints: Math.min(points, STRONGHOLD_TOP_POINTS),
    // What is still owed, in words — '' once the hold cannot be weakened any further.
    nextStep: nextStepHint(save),
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
  // The one line about the player's next move rather than the hold's advantages. The brief
  // is where storming now is chosen, so what would weaken it first belongs in it.
  if (mods.nextStep) lines.push(mods.nextStep);
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
