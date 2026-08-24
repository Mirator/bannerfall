// Campaign save schema — the pure boundary between persisted text and World.
import { WORLD, UNIT_TYPES, ENEMY_TYPES, HERO, BALANCE } from './data.js?v=r06a7e18cad00';
import { SPECIALIZATIONS, isValidSpec, OWNERSHIP } from './region.js?v=r06a7e18cad00';

// Version 2 made party.home a runtime invariant. Version 0 is the original
// unversioned shape; version 1 is the first explicitly versioned shape.
// Version 3 (Plan 020) added save.settlements — settlement-occupation state —
// and an optional party.occupying field.
// Version 4 (Milestone 025) makes ownership persistent: settlements gain `owner`
// ('neutral' | 'player') and an optional permanent `spec`; roaming parties gain an
// optional `raid` target (and a `raidKind` for stronghold-dispatched raids); stats
// gain the campaign-summary counters (battlesLost, goldEarned, goldSpent,
// captures). Stronghold power is deliberately NOT persisted — it is a pure
// derivation over owned settlements and razed linked camps (src/region.js).
export const SAVE_VERSION = 4;

const CAMP_IDS = new Set(WORLD.camps.map(c => c.id));
const SETTLEMENT_IDS = new Set(WORLD.settlements.map(s => s.id));
const UNIT_IDS = new Set(Object.keys(UNIT_TYPES));
const ENEMY_IDS = new Set(Object.keys(ENEMY_TYPES));
const SPEC_IDS = new Set(Object.keys(SPECIALIZATIONS));
const OWNER_IDS = new Set([OWNERSHIP.NEUTRAL, OWNERSHIP.PLAYER]);
const RAID_KINDS = new Set(['regional', 'breakoff']);
const MAX_HERO_HP = 10000;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isInteger(value) && Number.isFinite(value);
const nonNegative = value => finite(value) && value >= 0;
const nonNegativeInteger = value => integer(value) && value >= 0;
const coordinate = (value, limit) => finite(value) && value >= 0 && value <= limit;

function validPoint(value) {
  return plain(value) && coordinate(value.x, WORLD.w) && coordinate(value.y, WORLD.h);
}

function readBoolean(source, key, fallback, legacy) {
  if (!hasOwn(source, key)) return legacy ? fallback : undefined;
  return typeof source[key] === 'boolean' ? source[key] : undefined;
}

function readNumber(source, key, fallback, valid, legacy) {
  if (!hasOwn(source, key)) return legacy ? fallback : undefined;
  return valid(source[key]) ? source[key] : undefined;
}

function buildTroops(raw) {
  if (!Array.isArray(raw)) return null;
  const result = [];
  for (const troop of raw) {
    if (!plain(troop) || typeof troop.type !== 'string' || !UNIT_IDS.has(troop.type)) return null;
    const unit = { type: troop.type };
    if (hasOwn(troop, 'hp')) {
      if (!finite(troop.hp) || troop.hp < 0 || troop.hp > UNIT_TYPES[troop.type].hp) return null;
      unit.hp = troop.hp;
    }
    result.push(unit);
  }
  return result;
}

function buildEnemyComp(raw) {
  if (!Array.isArray(raw)) return null;
  const result = [];
  for (const type of raw) {
    if (typeof type !== 'string' || !ENEMY_IDS.has(type)) return null;
    result.push(type);
  }
  return result;
}

function buildCamps(raw) {
  if (!Array.isArray(raw) || raw.length !== WORLD.camps.length) return null;
  const seen = new Set();
  const result = [];
  for (const camp of raw) {
    if (!plain(camp) || typeof camp.id !== 'string' || !CAMP_IDS.has(camp.id) || seen.has(camp.id)) return null;
    if (typeof camp.razed !== 'boolean') return null;
    seen.add(camp.id);
    const next = { id: camp.id, razed: camp.razed };
    if (hasOwn(camp, 'garrison')) {
      const garrison = buildEnemyComp(camp.garrison);
      if (!garrison) return null;
      next.garrison = garrison;
    }
    result.push(next);
  }
  if (seen.size !== CAMP_IDS.size) return null;
  return result;
}

// Plan 020 introduced one entry per WORLD.settlement recording occupation.
// Milestone 025 (v4) extends each entry with persistent ownership:
//   owner — 'neutral' or 'player' (occupied enemy control is the occupied flag)
//   spec  — the permanently chosen specialization; only legal on player-owned land
// `legacy` is true when migrating a pre-version-4 save: every settlement starts
// neutral and unchosen, matching the fresh-save default and the milestone's
// "conservative defaults" requirement.
function buildSettlements(raw, legacy) {
  if (raw === undefined) {
    return legacy ? WORLD.settlements.map(s => ({ id: s.id, occupied: false, owner: OWNERSHIP.NEUTRAL })) : null;
  }
  if (!Array.isArray(raw) || raw.length !== WORLD.settlements.length) return null;
  const seen = new Set();
  const result = [];
  for (const settlement of raw) {
    if (!plain(settlement) || typeof settlement.id !== 'string' ||
        !SETTLEMENT_IDS.has(settlement.id) || seen.has(settlement.id)) return null;
    if (typeof settlement.occupied !== 'boolean') return null;
    seen.add(settlement.id);
    let owner, spec;
    if (legacy) {
      // v3 and earlier carried no ownership vocabulary.
      owner = OWNERSHIP.NEUTRAL;
      spec = undefined;
      if (hasOwn(settlement, 'owner') || hasOwn(settlement, 'spec')) return null;
    } else {
      owner = settlement.owner;
      if (!OWNER_IDS.has(owner)) return null;
      if (hasOwn(settlement, 'spec')) {
        spec = settlement.spec;
        if (!isValidSpec(spec)) return null;
        // A specialization is a property of captured land only.
        if (owner !== OWNERSHIP.PLAYER) return null;
      }
    }
    const next = { id: settlement.id, occupied: settlement.occupied, owner };
    if (spec !== undefined) next.spec = spec;
    result.push(next);
  }
  if (seen.size !== SETTLEMENT_IDS.size) return null;
  return result;
}

function canonicalCampHome(campId) {
  const camp = WORLD.camps.find(candidate => candidate.id === campId);
  return camp ? { x: camp.x, y: camp.y } : null;
}

function buildParties(raw, migrateLegacyHomes) {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const result = [];
  for (const party of raw) {
    if (!plain(party) || typeof party.camp !== 'string' || !CAMP_IDS.has(party.camp) ||
        !coordinate(party.x, WORLD.w) || !coordinate(party.y, WORLD.h)) return undefined;
    const comp = buildEnemyComp(party.comp);
    if (!comp || comp.length === 0) return undefined;
    const next = { camp: party.camp, x: party.x, y: party.y, comp };
    if (hasOwn(party, 'home')) {
      if (!validPoint(party.home)) return undefined;
      next.home = { x: party.home.x, y: party.home.y };
    } else if (migrateLegacyHomes) {
      const home = canonicalCampHome(party.camp);
      if (!home) return undefined;
      next.home = home;
    } else {
      return undefined;
    }
    if (hasOwn(party, 'waryT')) {
      if (!nonNegative(party.waryT)) return undefined;
      next.waryT = party.waryT;
    } else {
      next.waryT = 0;
    }
    if (hasOwn(party, 'clashT')) {
      if (!nonNegative(party.clashT)) return undefined;
      next.clashT = party.clashT;
    } else {
      next.clashT = 0;
    }
    if (hasOwn(party, 'occupying')) {
      if (typeof party.occupying !== 'string' || !SETTLEMENT_IDS.has(party.occupying)) return undefined;
      next.occupying = party.occupying;
    }
    // Milestone 025: a party riding to raid a settlement persists that intent so a
    // reload cannot silently cancel (or duplicate) an inbound raid.
    if (hasOwn(party, 'raid')) {
      if (typeof party.raid !== 'string' || !SETTLEMENT_IDS.has(party.raid)) return undefined;
      next.raid = party.raid;
    }
    if (hasOwn(party, 'raidKind')) {
      if (typeof party.raidKind !== 'string' || !RAID_KINDS.has(party.raidKind)) return undefined;
      next.raidKind = party.raidKind;
      // A kind without a live raid target is meaningless state.
      if (!next.raid) return undefined;
    }
    result.push(next);
  }
  return result;
}

// Milestone 025: the campaign-summary counters ride on stats. `battlesLost`
// completes the won/lost pair; goldEarned/goldSpent back the economy lines;
// captures counts settlements brought under the banner. All default to zero on
// every migration path.
function buildStats(raw, legacy) {
  if (raw === undefined) {
    return legacy ? { won: 0, kills: 0, lost: 0, playT: 0, battlesLost: 0, goldEarned: 0, goldSpent: 0, captures: 0 } : null;
  }
  if (!plain(raw)) return null;
  const won = readNumber(raw, 'won', 0, nonNegativeInteger, legacy);
  const kills = readNumber(raw, 'kills', 0, nonNegativeInteger, legacy);
  const lost = readNumber(raw, 'lost', 0, nonNegativeInteger, legacy);
  const playT = readNumber(raw, 'playT', 0, nonNegative, legacy);
  const battlesLost = readNumber(raw, 'battlesLost', 0, nonNegativeInteger, legacy);
  const goldEarned = readNumber(raw, 'goldEarned', 0, nonNegativeInteger, legacy);
  const goldSpent = readNumber(raw, 'goldSpent', 0, nonNegativeInteger, legacy);
  const captures = readNumber(raw, 'captures', 0, nonNegativeInteger, legacy);
  if (won === undefined || kills === undefined || lost === undefined || playT === undefined ||
      battlesLost === undefined || goldEarned === undefined || goldSpent === undefined ||
      captures === undefined) return null;
  return { won, kills, lost, playT, battlesLost, goldEarned, goldSpent, captures };
}

function buildV1(candidate, legacy) {
  const gold = readNumber(candidate, 'gold', undefined, nonNegativeInteger, false);
  const x = readNumber(candidate, 'x', undefined, value => coordinate(value, WORLD.w), false);
  const y = readNumber(candidate, 'y', undefined, value => coordinate(value, WORLD.h), false);
  if (gold === undefined || x === undefined || y === undefined) return null;

  const troops = buildTroops(candidate.troops);
  if (!troops) return null;
  const camps = buildCamps(candidate.camps);
  if (!camps) return null;
  const settlements = buildSettlements(candidate.settlements, legacy);
  if (!settlements) return null;
  const heroMaxHp = readNumber(candidate, 'heroMaxHp', HERO.hp,
    value => finite(value) && value > 0 && value <= MAX_HERO_HP, legacy);
  const heroHp = readNumber(candidate, 'heroHp', HERO.hp,
    value => finite(value) && value >= 0 && value <= MAX_HERO_HP, legacy);
  if (heroMaxHp === undefined || heroHp === undefined || heroHp > heroMaxHp) return null;

  let armyCap;
  if (hasOwn(candidate, 'armyCap')) {
    if (!Number.isInteger(candidate.armyCap) || candidate.armyCap < BALANCE.armyCapBase || candidate.armyCap < troops.length) return null;
    armyCap = candidate.armyCap;
  } else if (legacy) {
    armyCap = Math.max(BALANCE.armyCapBase, troops.length);
  } else {
    return null;
  }

  const won = readBoolean(candidate, 'won', false, legacy);
  const hard = readBoolean(candidate, 'hard', false, legacy);
  if (won === undefined || hard === undefined) return null;
  const parties = hasOwn(candidate, 'parties')
    ? buildParties(candidate.parties, legacy)
    : (legacy ? null : undefined);
  if (parties === undefined) return null;
  const runSeed = readNumber(candidate, 'runSeed', 777, nonNegativeInteger, legacy);
  const battleCount = readNumber(candidate, 'battleCount', 0, nonNegativeInteger, legacy);
  if (runSeed === undefined || battleCount === undefined) return null;
  const stats = buildStats(candidate.stats, legacy);
  if (!stats) return null;

  const result = {
    version: SAVE_VERSION,
    gold,
    heroHp,
    heroMaxHp,
    troops,
    armyCap,
    camps,
    settlements,
    won,
    x,
    y,
    parties,
    runSeed,
    stats,
    hard,
    battleCount,
  };
  if (hasOwn(candidate, 'toast')) {
    if (candidate.toast !== null && typeof candidate.toast !== 'string') return null;
    if (typeof candidate.toast === 'string') result.toast = candidate.toast;
  }
  return result;
}

/**
 * Migrate an object from a supported legacy format or the current schema.
 * The returned object is always detached from the candidate.
 */
export function migrateSave(candidate) {
  if (!plain(candidate)) return null;
  const version = hasOwn(candidate, 'version') ? candidate.version : 0;
  if (!integer(version) || version < 0 || version > SAVE_VERSION) return null;
  // Version 3 saves are legacy relative to v4: their settlements gain neutral
  // ownership, their parties drop nothing (raid fields did not exist yet and are
  // refused on explicit v3 input via the legacy flag), and their stats gain the
  // summary counters at zero. The conservative-defaults rule means a migrated
  // campaign never starts mid-raid pressure: World arms its raid timer from
  // RAID.firstDelayT whenever the loaded save carries no regional timer.
  if (version === SAVE_VERSION) return buildV1(candidate, false);
  // Both legacy shapes are normalized through the same current validator. A
  // version-1 party may predate the home field, so derive it from WORLD.camps.
  return buildV1(candidate, true);
}

/** Parse persisted text and return a canonical, detached save or null. */
export function parseSave(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return migrateSave(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}
