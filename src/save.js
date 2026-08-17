// Campaign save schema — the pure boundary between localStorage and World.
import { WORLD, UNIT_TYPES, ENEMY_TYPES, HERO, BALANCE } from './data.js?v=r10';

export const SAVE_VERSION = 1;

const CAMP_IDS = new Set(WORLD.camps.map(c => c.id));
const UNIT_IDS = new Set(Object.keys(UNIT_TYPES));
const ENEMY_IDS = new Set(Object.keys(ENEMY_TYPES));
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

function buildParties(raw) {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const result = [];
  for (const party of raw) {
    if (!plain(party) || typeof party.camp !== 'string' || !CAMP_IDS.has(party.camp) ||
        !coordinate(party.x, WORLD.w) || !coordinate(party.y, WORLD.h)) return undefined;
    const comp = buildEnemyComp(party.comp);
    if (!comp) return undefined;
    const next = { camp: party.camp, x: party.x, y: party.y, comp };
    if (hasOwn(party, 'home')) {
      if (!validPoint(party.home)) return undefined;
      next.home = { x: party.home.x, y: party.home.y };
    }
    if (hasOwn(party, 'waryT')) {
      if (!nonNegative(party.waryT)) return undefined;
      next.waryT = party.waryT;
    } else {
      next.waryT = 0;
    }
    result.push(next);
  }
  return result;
}

function buildStats(raw, legacy) {
  if (raw === undefined) {
    return legacy ? { won: 0, kills: 0, lost: 0, playT: 0 } : null;
  }
  if (!plain(raw)) return null;
  const won = readNumber(raw, 'won', 0, nonNegativeInteger, legacy);
  const kills = readNumber(raw, 'kills', 0, nonNegativeInteger, legacy);
  const lost = readNumber(raw, 'lost', 0, nonNegativeInteger, legacy);
  const playT = readNumber(raw, 'playT', 0, nonNegative, legacy);
  if (won === undefined || kills === undefined || lost === undefined || playT === undefined) return null;
  return { won, kills, lost, playT };
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
  const heroMaxHp = readNumber(candidate, 'heroMaxHp', HERO.hp, value => finite(value) && value > 0, legacy);
  const heroHp = readNumber(candidate, 'heroHp', HERO.hp, value => finite(value) && value >= 0, legacy);
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
  const parties = hasOwn(candidate, 'parties') ? buildParties(candidate.parties) : (legacy ? null : undefined);
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
 * Migrate an object from the unversioned legacy format or current schema.
 * The returned object is always detached from the candidate.
 */
export function migrateSave(candidate) {
  if (!plain(candidate)) return null;
  const version = hasOwn(candidate, 'version') ? candidate.version : 0;
  if (!integer(version) || version < 0 || version > SAVE_VERSION) return null;
  return buildV1(candidate, version === 0);
}

/** Parse localStorage text and return a canonical, detached save or null. */
export function parseSave(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return migrateSave(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}
