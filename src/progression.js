// Plan 029 — what survives the end of a battle.
//
// The data-driven home for the two persistent things a run builds that are NOT balance
// tables: the hero's PERKS, and the BANNER stage that caps how far a troop's veterancy can
// go. Pure over `(save)`, importing nothing but `data.js` — the same contract `region.js`
// holds, and for the same reason: the world, the battle, the save validator and the UI all
// read these rules, so they must exist in exactly one place.
//
// The veteran rank TABLE itself lives in `data.js` beside the rest of the balance tuning,
// because `playerStrength()` has to price a ranked warband and data.js is the module that
// owns every balance table and imports nothing. This module reads it.
//
// Nothing here reads presentation, draws, or touches an RNG.
import { BALANCE, MAX_RANK, VET_RANKS, rankOf, rankName } from './data.js?v=r47adbb257074';

// ---------------------------------------------------------------- banner
// A CEILING rather than a bonus. `vet` stops ACCRUING at the ceiling rather than being
// clamped when it is read, and that is load-bearing: it is what lets
// `playerStrength(troops)` keep its Plan 028 signature, so no caller has to be handed the
// banner stage in order to ask how strong a warband is. Raising the banner later lets men
// resume earning from where they stopped.
export const BANNER_MAX = BALANCE.bannerCosts.length; // stage 0 is the free starting banner

export function bannerRankCap(stage) {
  return Math.max(1, Math.min(MAX_RANK, 1 + (Number.isFinite(stage) ? Math.floor(stage) : 0)));
}
// null once every stage is bought — the callers use that to mean "nothing left to buy"
// rather than carrying their own end-of-list check.
export function bannerCost(stage) {
  const s = Number.isFinite(stage) ? Math.floor(stage) : 0;
  return s >= 0 && s < BALANCE.bannerCosts.length ? BALANCE.bannerCosts[s] : null;
}
// What this banner lets a man become, in words — the town prompt and the perk screen both
// state the ceiling rather than the stage number, because the number means nothing.
export function bannerLabel(stage) {
  return rankName(bannerRankCap(stage));
}

// Award one battle of experience, respecting the ceiling. Returns the new `vet` value.
export function awardVeterancy(vet, bannerStage, earlier = 0) {
  const cur = Number.isFinite(vet) && vet > 0 ? Math.floor(vet) : 0;
  const next = cur + 1;
  return rankOf(next, earlier) > bannerRankCap(bannerStage) ? cur : next;
}

// Build a new recruit's record — the SINGLE seam every way of gaining a body goes through
// (the paid recruit at the gates and the specialization's granted men alike), so the
// Veteran Cadre perk cannot apply to one door and not the other. Bounded by the banner's
// own ceiling, like every other award; a rank-0 recruit carries no `vet` field at all.
export function recruitTroop(save, type) {
  const rank = Math.min(perkMods(save.perks).recruitVet, bannerRankCap(save.banner));
  const troop = { type };
  if (rank > 0) troop.vet = VET_RANKS[rank].at;
  return troop;
}

// ---------------------------------------------------------------- perks
// Nine perks, three tiers of three, a tier unlocking on how many are already taken. Every
// one of them either amplifies an ORDER's effect, removes an order's cost, or rewards an
// input the player has to press. None is a flat aura on a troop standing in the blob: an
// aura would reward exactly the behaviour Plans 027 and 028 spent two slices measuring as
// already too strong (an idle hero wins 70.8% of camp raids and 95.8% of roaming fights).
//
// `mods` keys are folded by `perkMods` below in a declared way, so two perks touching the
// same field compose rather than one silently winning.
export const PERKS = Object.freeze({
  setSpears: Object.freeze({
    id: 'setSpears', tier: 1, glyph: '⩓', name: 'Set Spears',
    text: 'Braced spears hit for 2.2x instead of 1.8x',
    note: 'pays only on HOLD, against a rush into the line’s front',
    mods: Object.freeze({ braceBonus: 2.2 }),
  }),
  steadyHands: Object.freeze({
    id: 'steadyHands', tier: 1, glyph: '◎', name: 'Steady Hands',
    text: 'Your bows on HOLD group 40% tighter',
    note: 'pays only on HOLD, against a rush into the line’s front',
    mods: Object.freeze({ bowSpreadBracedMul: 0.6 }),
  }),
  warhorn: Object.freeze({
    id: 'warhorn', tier: 1, glyph: '⌇', name: 'Warhorn',
    text: 'Charging squads take 1.18x damage instead of 1.35x',
    note: 'pays only when you order CHARGE',
    mods: Object.freeze({ chargeExposure: 1.18 }),
  }),
  hammerAnvil: Object.freeze({
    id: 'hammerAnvil', tier: 2, glyph: '⚒', name: 'Hammer and Anvil',
    text: 'Charging squads move 32% faster instead of 15%',
    note: 'a charge that actually arrives',
    mods: Object.freeze({ chargeSpeedMul: 1.32 }),
  }),
  quickRelease: Object.freeze({
    id: 'quickRelease', tier: 2, glyph: '⤺', name: 'Quick Release',
    text: 'Shields come back up the instant you rescind CHARGE',
    note: 'rewards taking an order back',
    mods: Object.freeze({ chargeRecover: 0 }),
  }),
  bodkins: Object.freeze({
    id: 'bodkins', tier: 2, glyph: '➶', name: 'Bodkin Points',
    text: 'Archers hit brutes for 2.8x instead of 2.0x',
    note: 'pays only if you brought bows to a brute',
    mods: Object.freeze({ bruteBonus: 2.8 }),
  }),
  drillyard: Object.freeze({
    id: 'drillyard', tier: 3, glyph: '⚑', name: 'Drillyard',
    text: 'Every veteran rank arrives one battle sooner',
    note: 'compounds what you already built',
    mods: Object.freeze({ rankEarlier: 1 }),
  }),
  warlord: Object.freeze({
    id: 'warlord', tier: 3, glyph: '✶', name: 'Warlord',
    text: 'Your dash rallies the troops it passes: shields up, charge speed for 1.5s',
    note: 'pays only on a pressed dash',
    mods: Object.freeze({ rally: 1.5 }),
  }),
  veteranCadre: Object.freeze({
    id: 'veteranCadre', tier: 3, glyph: '⊞', name: 'Veteran Cadre',
    text: 'Recruits join your banner already blooded',
    note: 'replacing a dead veteran is cheaper, not free',
    mods: Object.freeze({ recruitVet: 1 }),
  }),
});
export const PERK_IDS = Object.freeze(Object.keys(PERKS));
// How many perks must already be taken before a tier's options appear. Index is tier - 1.
export const PERK_TIER_GATES = Object.freeze([0, 2, 4]);

export function isValidPerk(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PERKS, id);
}

// The neutral bundle. `null` means "keep whatever the battle constant or the unit table
// already says", so a perk that is not taken and a field no perk touches behave
// identically and no consumer needs its own default.
const NEUTRAL = Object.freeze({
  braceBonus: null,
  bowSpreadBracedMul: 1,
  chargeExposure: null,
  chargeSpeedMul: null,
  chargeRecover: null,
  bruteBonus: null,
  rankEarlier: 0,
  rally: 0,
  recruitVet: 0,
});
// The bundle a force with no perks at all gets. Frozen and shared: the battle scene reads
// it every tick and must not be able to mutate it.
export const NO_PERKS = NEUTRAL;

// Fold a taken-perk list into one plain bundle. An unknown id is ignored rather than
// throwing — a save that somehow carries one should degrade to "no perk", not fail to load.
export function perkMods(perks) {
  if (!perks || perks.length === 0) return NEUTRAL;
  const out = { ...NEUTRAL };
  for (const id of perks) {
    const perk = PERKS[id];
    if (!perk) continue;
    for (const [key, value] of Object.entries(perk.mods)) {
      if (key === 'bowSpreadBracedMul') out[key] *= value;
      else if (key === 'rankEarlier' || key === 'recruitVet') out[key] += value;
      else out[key] = value;
    }
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------- milestones
// How many perk choices this campaign has EARNED, DERIVED from persisted state rather than
// incremented by an event. That is what makes the award idempotent across a reload, a
// defeat and a re-entry; an event counter would double-award or lose one at every seam,
// and there are four seams here (battle end, world construction, claim, raze).
//
// The two milestones the world already emits: a linked camp razed, and a settlement brought
// under the banner. `stats.captures` counts a capture by the sword and a peaceful claim
// alike — it is the same number the campaign summary reports, so the player is rewarded for
// exactly the thing the summary already tells him he did.
export function perkPointsEarned(save) {
  if (!save) return 0;
  const razed = (save.camps || []).filter(c => c.razed && c.id !== 'strong').length;
  const captures = (save.stats && save.stats.captures) || 0;
  return razed + captures;
}
export function perkChoiceDue(save) {
  return perkPointsEarned(save) > ((save && save.perks) || []).length;
}

// The options a choice screen may offer right now: everything not already taken whose tier
// gate is met by the number already taken. Never empty while a choice is due — tier 1 has
// three options and only three points can be spent before tier 2 opens.
export function availablePerks(save) {
  const taken = new Set((save && save.perks) || []);
  return PERK_IDS
    .map(id => PERKS[id])
    .filter(p => !taken.has(p.id) && taken.size >= PERK_TIER_GATES[p.tier - 1]);
}
