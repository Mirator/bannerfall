// Battle tuning constants and the squad vocabulary, shared by the scene core, the HUD and
// (from step 4 on) the AI phases. Extracted FIRST and depending on nothing but data.js:
// with no bundler an import cycle is a real hazard, and this module is what prevents one
// between battle.js and the phase/render modules that need these values.
import { PAL, UNIT_TYPES } from '../data.js?v=rd5531dcfef09';

export const BASE = Object.freeze(Object.assign({}, PAL.battle));

// One squad per unit type, in HUD order. Derived from the unit table so a new unit
// type can never exist without a squad to command it.
export const SQUAD_TYPES = Object.freeze(Object.keys(UNIT_TYPES));
// Exported so world-screens.js (Plan 021) can label the player's roster on the brief
// screen with the exact same strings instead of duplicating them.
export const SQUAD_LABELS = Object.freeze({ spear: 'SPEARS', archer: 'BOWS', knight: 'HORSE' });

// Stance trade-offs. A braced melee line hits harder against anything closing faster than
// BRACE_SPEED, and a standing bow line shoots tighter than a walking one. See plans/019 for
// measured effects.
//
// BRACE_SPEED only ever catches wolves (158). Bandits are 92, raiders 82 and brutes 55, so
// nothing else in the roster can trigger it: this is a wolf counter, not a general
// anti-charge rule. HOLD does still beat CHARGE against brutes, but through slam avoidance
// and charge exposure rather than bracing. Do not describe it as a brute counter.
export const BRACE_SPEED = 120;
export const BRACE_BONUS = 1.8;
export const BOW_SPREAD = 0.12;
export const BOW_SPREAD_BRACED = 0.05;
// Men running at the enemy have their shields down and their formation open. This is what
// CHARGE pays for its speed, and the reason ordering everyone to charge is not free.
export const CHARGE_EXPOSURE = 1.35;
// How long shields stay down after a charge order is rescinded.
export const CHARGE_RECOVER = 1.1;
// A fight in which nobody has died for this long is not a battle, it is a grind.
export const STALL_NO_DEATH = 14;
// What each order costs or buys, per squad kind — shown on the squad's own HUD row so the
// trade-off is legible during the fight. FOLLOW is deliberately absent: it is the neutral
// order and has nothing to advertise.
export const STANCE_NOTES = Object.freeze({
  hold: { melee: 'braced', ranged: 'steady aim' },
  charge: { melee: 'shields down', ranged: 'bows down' },
});
