import { test, expect } from '@playwright/test';
import { WORLD, BALANCE } from '../../src/data.js';
import {
  REGION, OWNERSHIP, SPECIALIZATIONS, SPEC_IDS, isValidSpec,
  settlementRecord, settlementState, isPlayerOwned, heldSettlements,
  specializationOf, isSpecActive, findSpecSettlements,
  STRONGHOLD_POWER, razedLinkedCamps, strongholdPoints, strongholdStateId,
  STRONGHOLD_POWER_LABELS, ownsWatchtower, strongholdModifiers, strongholdAdvantageLines,
  OBJECTIVES, encounterObjective, OBJECTIVE_LABELS, RAID, SUMMARY_FIELDS,
} from '../../src/region.js';

// Milestone 025's regional model is PURE over (save, definitions): every exported
// function reads the canonical save and returns derived facts without RNG, DOM or
// presentation state. That makes the whole model test-addressable in plain Node —
// this suite imports src/region.js directly and pins the data-driven contract the
// world, battle and UI layers all consume. Balance changes owe this file a look
// before any scattered conditional is touched.

// Canonical synthetic saves. Settlement/camp ids come from production WORLD data —
// never invented (tests/README.md fixture rule).
const ALL_NEUTRAL = () => WORLD.settlements.map(s => ({ id: s.id, occupied: false, owner: OWNERSHIP.NEUTRAL }));
const ALL_CAMPS_LIVE = () => WORLD.camps.map(c => ({ id: c.id, razed: false }));
const saveWith = ({ owned = [], occupied = [], specs = {}, razedCamps = [] } = {}) => {
  const settlements = ALL_NEUTRAL();
  for (const id of owned) settlements.find(s => s.id === id).owner = OWNERSHIP.PLAYER;
  for (const id of occupied) settlements.find(s => s.id === id).occupied = true;
  for (const [id, spec] of Object.entries(specs)) settlements.find(s => s.id === id).spec = spec;
  return {
    settlements,
    camps: ALL_CAMPS_LIVE().map(c => (razedCamps.includes(c.id) ? { ...c, razed: true } : c)),
  };
};

test('the region ships the configured settlement, camp, and stronghold shape', () => {
  // Milestone scope: 4-6 settlements, 2-3 ordinary camps, exactly one stronghold.
  expect(WORLD.settlements.length).toBeGreaterThanOrEqual(4);
  expect(WORLD.settlements.length).toBeLessThanOrEqual(6);
  const strongholds = WORLD.camps.filter(c => c.stronghold);
  expect(strongholds.length).toBe(1);
  expect(REGION.strongholdId).toBe(strongholds[0].id);
  const ordinary = WORLD.camps.filter(c => !c.stronghold);
  expect(ordinary.length).toBeGreaterThanOrEqual(2);
  expect(ordinary.length).toBeLessThanOrEqual(3);
  // Every linked camp is a real, ordinary camp — a link to the stronghold itself or
  // to an invented id would silently break the power ladder.
  for (const id of REGION.linkedCamps) {
    const camp = WORLD.camps.find(c => c.id === id);
    expect(camp, `linked camp ${id} exists`).toBeTruthy();
    expect(camp.stronghold, `linked camp ${id} is ordinary`).toBeFalsy();
  }
  // Every settlement has the names and gates the map UI renders.
  for (const s of WORLD.settlements) {
    expect(typeof s.name).toBe('string');
    expect(s.name.length).toBeGreaterThan(0);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Number.isFinite(s.y)).toBe(true);
  }
});

test('stronghold power climbs the documented ladder from deterministic inputs only', () => {
  const fresh = saveWith();
  expect(strongholdStateId(fresh)).toBe('entrenched');
  expect(strongholdPoints(fresh)).toBe(0);

  // One capture alone is not weakening yet (threshold 2).
  expect(strongholdStateId(saveWith({ owned: ['ashford'] }))).toBe('entrenched');
  expect(strongholdPoints(saveWith({ owned: ['ashford'] }))).toBe(1);

  // Two captures: WEAKENED.
  expect(strongholdStateId(saveWith({ owned: ['ashford', 'brindle'] }))).toBe('weakened');

  // Camps and settlements stack on the same points scale.
  expect(strongholdStateId(saveWith({ owned: ['ashford'], razedCamps: ['c1'] }))).toBe('weakened');
  expect(strongholdPoints(saveWith({ owned: ['ashford'], razedCamps: ['c1'] }))).toBe(2);

  // Full conquest: EXPOSED with or without any camp falling.
  const allOwned = saveWith({ owned: WORLD.settlements.map(s => s.id) });
  expect(strongholdStateId(allOwned)).toBe('exposed');
  expect(strongholdStateId(saveWith({
    owned: WORLD.settlements.map(s => s.id), razedCamps: REGION.linkedCamps,
  }))).toBe('exposed');
  expect(strongholdPoints(saveWith({
    owned: WORLD.settlements.map(s => s.id), razedCamps: REGION.linkedCamps,
  }))).toBe(WORLD.settlements.length + REGION.linkedCamps.length);

  // An OCCUPIED former holding stops counting: control can visibly shift back.
  expect(strongholdStateId(saveWith({ owned: ['ashford', 'brindle'], occupied: ['brindle'] }))).toBe('entrenched');
  expect(heldSettlements(saveWith({ owned: ['ashford', 'brindle'], occupied: ['brindle'] })))
    .toEqual([expect.objectContaining({ id: 'ashford' })]);

  // Razing only counts for LINKED camps; the ladder reads save.camps, never live map state.
  const unlinkedOnly = saveWith();
  unlinkedOnly.camps.find(c => c.id === REGION.strongholdId).razed = true;
  expect(razedLinkedCamps(unlinkedOnly)).toBe(0);
  expect(strongholdPoints(unlinkedOnly)).toBe(0);
});

test('stronghold modifiers implement the milestone mapping exactly', () => {
  // Entrenched, nothing achieved: full defenses.
  const entrenched = strongholdModifiers(saveWith());
  expect(entrenched).toEqual({
    stateId: 'entrenched', points: 0, maxPoints: WORLD.settlements.length + REGION.linkedCamps.length,
    waves: 1, guards: 3, revealDeployment: false, garrisonMul: 1,
  });

  // Two captured settlements remove the reinforcement wave.
  expect(strongholdModifiers(saveWith({ owned: ['ashford', 'brindle'] })).waves).toBe(0);
  expect(strongholdModifiers(saveWith({ owned: ['ashford'] })).waves).toBe(1);

  // Each razed linked camp removes one defensive guard, floored at the two-objective
  // minimum of Break the position.
  expect(strongholdModifiers(saveWith({ razedCamps: ['c1'] })).guards).toBe(2);
  expect(strongholdModifiers(saveWith({ razedCamps: ['c1', 'c2', 'c3'] })).guards).toBe(2);

  // A watchtower holding reads the enemy deployment in the brief.
  expect(strongholdModifiers(saveWith({ owned: ['ashford'], specs: { ashford: 'watchtower' } })).revealDeployment).toBe(true);
  expect(strongholdModifiers(saveWith({ owned: ['ashford'], specs: { ashford: 'barracks' } })).revealDeployment).toBe(false);
  expect(ownsWatchtower(saveWith({ owned: ['ashford'], specs: { ashford: 'watchtower' } }))).toBe(true);

  // EXPOSED thins the starting garrison; the other states do not.
  expect(strongholdModifiers(saveWith({ owned: WORLD.settlements.map(s => s.id) })).garrisonMul)
    .toBe(STRONGHOLD_POWER.exposedGarrisonFrac);
  expect(strongholdModifiers(saveWith({ owned: ['ashford', 'brindle'] })).garrisonMul).toBe(1);

  // The same save always produces the identical bundle (pure derivation, no RNG).
  const s = saveWith({ owned: ['ashford', 'keep'], razedCamps: ['c2'] });
  expect(strongholdModifiers(s)).toEqual(strongholdModifiers(s));
});

test('the brief advantage lines are derived from the modifier bundle, never hand-maintained', () => {
  const entrenched = strongholdAdvantageLines(strongholdModifiers(saveWith()));
  expect(entrenched.some(l => l.includes('reserve wave'))).toBe(true);
  expect(entrenched.some(l => l.includes('All three defensive guards'))).toBe(true);
  expect(entrenched.some(l => l.includes('unscouted'))).toBe(true);

  const weakened = strongholdAdvantageLines(strongholdModifiers(saveWith({ owned: ['ashford', 'brindle'], razedCamps: ['c1'] })));
  expect(weakened.some(l => l.includes('no reinforcements'))).toBe(true);
  expect(weakened.some(l => l.startsWith('2 defensive guards'))).toBe(true);
  expect(weakened.some(l => l.includes('EXPOSED'))).toBe(false);

  const exposed = strongholdAdvantageLines(strongholdModifiers(saveWith({ owned: WORLD.settlements.map(s => s.id) })));
  expect(exposed.some(l => l.includes('EXPOSED'))).toBe(true);

  const scouted = strongholdAdvantageLines(strongholdModifiers(saveWith({ owned: ['ashford'], specs: { ashford: 'watchtower' } })));
  expect(scouted.some(l => l.includes('watchtowers read their deployment'))).toBe(true);
});

test('specializations are exactly the four documented benefits', () => {
  expect(SPEC_IDS).toEqual(['barracks', 'archery', 'market', 'watchtower']);
  for (const id of SPEC_IDS) {
    const def = SPECIALIZATIONS[id];
    expect(def.name, `${id} has a display name`).toBeTruthy();
    expect(def.glyph, `${id} has a map glyph`).toBeTruthy();
    expect(def.effect && typeof def.effect === 'object').toBe(true);
    expect(typeof def.ongoing).toBe('string');
    expect(def.immediate && typeof def.immediate.text).toBe('string');
  }
  // Documented mechanical effects, straight from the milestone table.
  expect(SPECIALIZATIONS.barracks.effect.spearCost).toBeLessThan(UNIT_COST('spear'));
  expect(SPECIALIZATIONS.archery.effect.archerCost).toBeLessThan(UNIT_COST('archer'));
  expect(SPECIALIZATIONS.market.effect.healCost).toBe(Math.round(BALANCE.healCost / 2));
  expect(SPECIALIZATIONS.market.immediate.gold).toBeGreaterThan(0);
  expect(SPECIALIZATIONS.watchtower.effect.scoutR).toBe(REGION.watchtowerScoutR);
  expect(typeof isValidSpec('barracks')).toBe('boolean');
  expect(isValidSpec('barracks')).toBe(true);
  expect(isValidSpec('citadel')).toBe(false);
  expect(isValidSpec(undefined)).toBe(false);

  function UNIT_COST(type) {
    // data.js owns the base prices; the spec only asserts the discount direction.
    return { spear: 10, archer: 18 }[type];
  }
});

test('specialization state follows ownership and occupation exactly', () => {
  const owned = saveWith({ owned: ['ashford'], specs: { ashford: 'market' } });
  expect(settlementState(owned, 'ashford')).toBe('player');
  expect(isPlayerOwned(owned, 'ashford')).toBe(true);
  expect(isSpecActive(owned, 'ashford')).toBe(true);
  expect(specializationOf(owned, 'ashford')).toBe('market');
  expect(findSpecSettlements(owned, 'market')).toEqual([expect.objectContaining({ id: 'ashford' })]);

  // Occupation suspends the benefit but keeps the permanent choice.
  const occupied = saveWith({ owned: ['ashford'], specs: { ashford: 'market' }, occupied: ['ashford'] });
  expect(settlementState(occupied, 'ashford')).toBe('occupied');
  expect(isSpecActive(occupied, 'ashford')).toBe(false);
  // The permanent choice is still readable while occupied (the map keeps showing
  // what the town IS); the BENEFIT gate is isSpecActive, not specializationOf.
  expect(specializationOf(occupied, 'ashford')).toBe('market');
  expect(findSpecSettlements(occupied, 'market')).toEqual([]);
  // The data is still there for the reclaim path.
  expect(settlementRecord(occupied, 'ashford').spec).toBe('market');

  // Neutral land has nothing active even if a stale spec somehow rode along —
  // a specialization is a property of captured land only.
  const stale = saveWith({ specs: { brindle: 'barracks' } });
  expect(isSpecActive(stale, 'brindle')).toBe(false);
  expect(specializationOf(stale, 'brindle')).toBe(null);
});

test('objective mapping is decided in one place', () => {
  expect(encounterObjective('settlement')).toEqual({ kind: 'hold', duration: OBJECTIVES.hold.duration, radius: OBJECTIVES.hold.radius });
  expect(encounterObjective('camp')).toEqual({ kind: 'break', guards: OBJECTIVES.break.campGuards, hp: OBJECTIVES.break.targetHp, radius: OBJECTIVES.break.radius });
  expect(encounterObjective('stronghold')).toEqual({ kind: 'break', guards: OBJECTIVES.break.strongholdGuards, hp: OBJECTIVES.break.targetHp, radius: OBJECTIVES.break.radius });
  // Roaming parties keep the classic elimination fight.
  expect(encounterObjective('party')).toBe(null);
  expect(encounterObjective('ambush')).toBe(null);
  expect(OBJECTIVES.break.campGuards).toBe(2);
  expect(OBJECTIVES.break.strongholdGuards).toBe(3);
  expect(OBJECTIVE_LABELS.hold).toBe('Hold the ground');
  expect(OBJECTIVE_LABELS.break).toBe('Break the position');
  expect(OBJECTIVE_LABELS.elimination).toBe('Destroy every raider');
});

test('a beatable route to an Exposed stronghold exists for every supported seed', () => {
  // The route is STRUCTURAL, not seed-dependent: settlements and camps are authored
  // constants, so capturing every settlement alone must always cross the Exposed
  // threshold no matter how the seeded terrain rolled.
  const exposedAt = STRONGHOLD_POWER.states.find(s => s.id === 'exposed').minPoints;
  expect(WORLD.settlements.length).toBeGreaterThanOrEqual(exposedAt);
  expect(strongholdStateId(saveWith({ owned: WORLD.settlements.map(s => s.id) }))).toBe('exposed');
  // The HUD labels derive from the same ladder, so they cannot drift from it.
  expect(STRONGHOLD_POWER_LABELS.entrenched).toBe('ENTRENCHED');
  expect(STRONGHOLD_POWER_LABELS.weakened).toBe('WEAKENED');
  expect(STRONGHOLD_POWER_LABELS.exposed).toBe('EXPOSED');
});

test('raid cadence guarantees post-migration quiet and post-capture grace', () => {
  // A migrated v3 campaign must never land mid-raid: World arms its timer from
  // firstDelayT, which must be strictly positive quiet time.
  expect(RAID.firstDelayT).toBeGreaterThan(0);
  expect(RAID.intervalT).toBeGreaterThan(0);
  expect(RAID.graceAfterCaptureT).toBeGreaterThan(0);
  expect(RAID.graceAfterDefenseT).toBeGreaterThan(0);
  expect(RAID.defenseR).toBeGreaterThan(0);
  // The defense radius must reach beyond a settlement's own service radius so a
  // hero standing AT the raided town is inside the defense battle band.
  expect(RAID.defenseR).toBeGreaterThan(130);
});

test('summary fields are the canonical render-order contract', () => {
  // The victory screen renders SUMMARY_FIELDS in order; the schema's stats carry
  // their sources. Keep the list declarative so screen and schema cannot drift.
  expect(SUMMARY_FIELDS).toEqual(['playT', 'won', 'lostBattles', 'captures', 'kills', 'lost']);
});
