// Campaign save schema — the pure boundary between persisted text and World.
import {
  WORLD, UNIT_TYPES, ENEMY_TYPES, HERO, BALANCE, armySlots, troopMaxHp, rankOf,
} from './data.js?v=r719ffab26c0f';
import { SPECIALIZATIONS, isValidSpec, OWNERSHIP } from './region.js?v=r719ffab26c0f';
import {
  BANNER_MAX, PERK_IDS, PERKS, PERK_TIER_GATES, isValidPerk, bannerRankCap, perkMods,
  perkPointsEarned,
} from './progression.js?v=r719ffab26c0f';

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
// Version 5 (Plan 029) makes PROGRESSION persistent — the first state other than
// gold that carries meaning across a run. Three new fields, and no others:
//   troop.vet   — battles this body has WON and walked out of. Optional; absent
//                 means zero. Rank is DERIVED from it (data.js rankOf) and never
//                 stored, so the two can never disagree.
//   save.perks  — the hero's chosen perks, in the order taken. Unique, known ids.
//   save.banner — the banner stage, 0..BANNER_MAX. Caps the rank a troop may reach.
// Perk POINTS are deliberately not persisted: `perkPointsEarned(save)` derives them
// from razed camps plus stats.captures, so the award is idempotent across a reload
// and there is no counter that can drift from the campaign it describes.
export const SAVE_VERSION = 5;

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

// Plan 029 (v5): a troop may carry `vet`. Two rules make it safe to persist:
//   * A legacy (pre-v5) shape carrying it is REFUSED rather than silently migrated,
//     matching how buildSettlements refuses owner/spec and buildParties refuses raid.
//   * The hp bound is the RANKED maximum, because a veteran really does have more hit
//     points. `troopMaxHp` is the one function the validator and Battle.spawnTroop both
//     read, so a saved veteran can never fail to load against a different formula.
// `bannerCap` bounds the rank a record may claim: `vet` accrues only up to the banner's
// ceiling in play, so a record above it is a tampered or corrupt save, not a legal one.
// A small tolerance on hp absorbs nothing — the bound is exact — but VET_MAX keeps a
// hostile integer from being used to inflate hit points without bound.
const VET_MAX = 9999;
// `earlier` is the Drillyard perk's threshold shift, and the two bounds below use it
// DIFFERENTLY, both deliberately:
//   * The hp bound passes it through: the game writes hit points at the SHIFTED rank, so
//     a validator bounding at `earlier` 0 would cap a Drillyard Elite at the Veteran
//     maximum and refuse a save the game itself just wrote.
//   * The rank-vs-banner legality check does NOT pass it: `vet` accrues under whatever
//     shift was active AT THE TIME, so a body parked exactly at the ceiling before the
//     perk was taken (vet 6 under a stage-0 banner) exceeds the ceiling the moment the
//     thresholds shift under him. Checking the SHIFTED rank here refused that save and
//     the repository then erased the slot — taking Drillyard destroyed the campaign on
//     the next load. The invariant every legal history does satisfy is the UNSHIFTED
//     rank staying at or under the ceiling: the accrual gate never lets `vet` past it
//     (rankOf(v, e) >= rankOf(v, 0) for every shift), and the banner never goes down.
function buildTroops(raw, preV5, bannerCap, earlier) {
  if (!Array.isArray(raw)) return null;
  const result = [];
  for (const troop of raw) {
    if (!plain(troop) || typeof troop.type !== 'string' || !UNIT_IDS.has(troop.type)) return null;
    const unit = { type: troop.type };
    if (hasOwn(troop, 'vet')) {
      if (preV5) return null;
      if (!nonNegativeInteger(troop.vet) || troop.vet > VET_MAX) return null;
      if (rankOf(troop.vet) > bannerCap) return null;
      if (troop.vet > 0) unit.vet = troop.vet;
    }
    if (hasOwn(troop, 'hp')) {
      if (!finite(troop.hp) || troop.hp < 0 || troop.hp > troopMaxHp(unit, earlier)) return null;
      unit.hp = troop.hp;
    }
    result.push(unit);
  }
  return result;
}

// Plan 029 (v5): the hero's perks. Order is the order taken (the display order on the
// summary), so this is an array rather than a set; duplicates are refused because taking
// the same perk twice is not a thing the choice screen can produce.
function buildPerks(raw, legacy) {
  if (raw === undefined) return legacy ? [] : null;
  if (legacy) return null; // a pre-v5 shape carrying perks is not a pre-v5 shape
  if (!Array.isArray(raw) || raw.length > PERK_IDS.length) return null;
  const seen = new Set();
  const result = [];
  for (const id of raw) {
    if (!isValidPerk(id) || seen.has(id)) return null;
    seen.add(id);
    result.push(id);
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
// `preV4` is true when migrating a save older than version 4: every settlement starts
// neutral and unchosen, matching the fresh-save default and the milestone's
// "conservative defaults" requirement, and a pre-v4 shape carrying either field is
// refused rather than silently migrated.
//
// Plan 029 note: this takes preV4 rather than a general `legacy` flag, because a version-4
// save IS legacy now and legitimately carries owner/spec. Conflating the two versions into
// one boolean would refuse every real v4 campaign.
function buildSettlements(raw, preV4, missingOk) {
  if (raw === undefined) {
    return missingOk ? WORLD.settlements.map(s => ({ id: s.id, occupied: false, owner: OWNERSHIP.NEUTRAL })) : null;
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
    if (preV4) {
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

function buildParties(raw, preV4, missingHomeOk) {
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
    } else if (missingHomeOk) {
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
    // reload cannot silently cancel (or duplicate) an inbound raid. Raid state did
    // not exist before v4, so — matching buildSettlements' owner/spec rule — a
    // pre-v4 shape carrying either field is refused rather than silently migrated.
    if (preV4) {
      if (hasOwn(party, 'raid') || hasOwn(party, 'raidKind')) return undefined;
    } else {
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

// `version` is the shape the candidate DECLARES, not the shape it is normalized into.
// Plan 029 had to split what used to be one `legacy` boolean, because version 4 is a legacy
// shape now and legitimately carries the ownership and raid fields v3 must be refused for.
// Three distinct questions come out of that, and each is asked by name:
//   legacy — older than the current schema at all: missing fields take their defaults.
//   preV4  — settlement ownership and party raid intent did not exist yet, so a shape
//            claiming that version must not carry them.
//   preV5  — perks, the banner and troop veterancy did not exist yet, same rule.
function buildV1(candidate, version) {
  const legacy = version < SAVE_VERSION;
  const preV4 = version < 4;
  const preV5 = version < 5;
  const gold = readNumber(candidate, 'gold', undefined, nonNegativeInteger, false);
  const x = readNumber(candidate, 'x', undefined, value => coordinate(value, WORLD.w), false);
  const y = readNumber(candidate, 'y', undefined, value => coordinate(value, WORLD.h), false);
  if (gold === undefined || x === undefined || y === undefined) return null;

  // Plan 029 (v5): the banner is read BEFORE the troops, because it bounds the rank a
  // troop record may legally claim and therefore the hit points it may carry.
  let banner;
  if (hasOwn(candidate, 'banner')) {
    if (preV5) return null;
    if (!nonNegativeInteger(candidate.banner) || candidate.banner > BANNER_MAX) return null;
    banner = candidate.banner;
  } else {
    banner = preV5 ? 0 : null;
  }
  if (banner === null) return null;
  const perks = buildPerks(candidate.perks, preV5);
  if (!perks) return null;

  // The Drillyard perk shifts every rank threshold, so the bound a troop record is checked
  // against depends on the perks read just above. Perks before troops, deliberately.
  const rankEarlier = perkMods(perks).rankEarlier;
  const troops = buildTroops(candidate.troops, preV5, bannerRankCap(banner), rankEarlier);
  if (!troops) return null;
  const camps = buildCamps(candidate.camps);
  if (!camps) return null;
  const settlements = buildSettlements(candidate.settlements, preV4, preV4);
  if (!settlements) return null;
  const heroMaxHp = readNumber(candidate, 'heroMaxHp', HERO.hp,
    value => finite(value) && value > 0 && value <= MAX_HERO_HP, legacy);
  const heroHp = readNumber(candidate, 'heroHp', HERO.hp,
    value => finite(value) && value >= 0 && value <= MAX_HERO_HP, legacy);
  if (heroMaxHp === undefined || heroHp === undefined || heroHp > heroMaxHp) return null;

  // Plan 029: the cap counts PLACES IN THE COLUMN, not bodies — a knight is two. The
  // migration is deliberately GRANDFATHERING rather than strict: a legitimate v4 campaign
  // could hold twelve knights inside a cap of twelve, and that save must load with its
  // army intact rather than be refused for a rule that did not exist when it was written.
  // Raising the cap to fit what the player already has is the conservative reading; the
  // new slot cost then applies to every future recruit, which is where the decision is.
  const slots = armySlots(troops);
  let armyCap;
  if (hasOwn(candidate, 'armyCap')) {
    if (!Number.isInteger(candidate.armyCap) || candidate.armyCap < BALANCE.armyCapBase) return null;
    // A cap below the BODY count was malformed under every version — v4's own validator
    // refused it — so it stays refused rather than grandfathered: the grandfather below
    // exists for legal v4 armies the new SLOT cost outgrew (bodies <= cap < slots), and
    // widening a shape v4 itself called corrupt would reward hand-editing with a cap.
    if (candidate.armyCap < troops.length) return null;
    // Only a pre-v5 shape is grandfathered: the slot rule did not exist for it. A current
    // save whose cap does not cover its own column is malformed, not old.
    if (!preV5 && candidate.armyCap < slots) return null;
    armyCap = preV5 ? Math.max(candidate.armyCap, slots) : candidate.armyCap;
  } else if (legacy) {
    armyCap = Math.max(BALANCE.armyCapBase, slots);
  } else {
    return null;
  }

  const won = readBoolean(candidate, 'won', false, legacy);
  const hard = readBoolean(candidate, 'hard', false, legacy);
  if (won === undefined || hard === undefined) return null;
  const parties = hasOwn(candidate, 'parties')
    ? buildParties(candidate.parties, preV4, preV4)
    : (legacy ? null : undefined);
  if (parties === undefined) return null;
  const runSeed = readNumber(candidate, 'runSeed', 777, nonNegativeInteger, legacy);
  const battleCount = readNumber(candidate, 'battleCount', 0, nonNegativeInteger, legacy);
  if (runSeed === undefined || battleCount === undefined) return null;
  const stats = buildStats(candidate.stats, legacy);
  if (!stats) return null;

  // Perks are bounded the way `vet` is, and for the same reason — a shape unreachable in
  // play is a tampered or corrupt save, not a legal one. A perk exists only where a
  // milestone paid for it (perkPointsEarned derives the budget from the same razes and
  // captures validated above), and a tier only opens over perks ALREADY taken, so each
  // perk's gate is checked against its position in the taken order.
  if (perks.length > perkPointsEarned({ camps, stats })) return null;
  for (let i = 0; i < perks.length; i++) {
    if (PERK_TIER_GATES[PERKS[perks[i]].tier - 1] > i) return null;
  }

  const result = {
    version: SAVE_VERSION,
    gold,
    heroHp,
    heroMaxHp,
    troops,
    armyCap,
    camps,
    settlements,
    perks,
    banner,
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
  //
  // Version 4 saves are legacy relative to v5: every troop starts unblooded
  // (`vet` absent, rank 0), the hero has taken no perks, and the banner is stage 0.
  // Perk points are re-derived from the razed camps and captures the save already
  // carries, so a v4 campaign that has taken two settlements is offered its two
  // choices on the next world tick rather than losing them.
  return buildV1(candidate, version);
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
