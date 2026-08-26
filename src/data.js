// Palettes and unit definitions — Thronefall-style strict palette discipline.
// See references/REFERENCE.md for where these numbers come from.

export const PAL = {
  // Campaign map — Thronefall day (ochre / navy / cream)
  world: {
    ground: '#EFA33B',
    groundShade: '#D07B1F',
    ink: '#1E2A4A',        // mountains, shadows, outlines
    cream: '#F2E3C1',      // lit faces, roads
    accent: '#E0622F',     // trees, banners
    water: '#2E9BB5',
    waterLight: '#7FD9E6',
    hero: '#FFD34D',
    enemy: '#C23A2E',
    good: '#7CE06B',       // victory / in-your-favour green (same green as the battle HP bar)
  },
  // Battle — dusty rose biome (rose / grey / yellow / teal / ink). Mutated per-biome at battle start.
  battle: {
    ground: '#B8506A',
    groundShade: '#8E3549',   // shadows must READ as shadows — ~25% darker than ground, not 10%
    metal: '#EFE6CE',         // weapon strokes: bright steel so silhouettes survive dark biomes
    ink: '#232742',
    cream: '#EFE6CE',
    rock: '#C9C4B4',
    rockShade: '#8E897C',
    tree: '#F2D22E',
    treeShade: '#C9A81F',
    water: '#43AEBE',
    waterLight: '#7FD9E6',
    friend: '#BFD7E8',     // pale-blue defenders (Thronefall night defenders)
    friendDark: '#7FA3BF',
    hero: '#FFD34D',
    heroDark: '#D98F1F',
    enemy: '#C23A2E',      // crimson bandits — foe reads red at a glance
    enemyDark: '#7E1F19',
    enemyAccent: '#E8E4DA',
    hp: '#7CE06B',
    hpBack: '#1B1E33',
  },
};

// Per-biome battle palettes — every region of the map fights on different ground.
export const BIOMES = {
  rose: {},   // the base PAL.battle values
  meadow: {
    ground: '#93B85C', groundShade: '#6C8C3D', ink: '#233042', cream: '#F2E9CF',
    rock: '#C9C4B4', rockShade: '#8E897C', tree: '#3E7C4F', treeShade: '#2C5F3B',
    water: '#43AEBE', waterLight: '#7FD9E6', metal: '#F2E9CF',
  },
  night: {
    ground: '#3B3B68', groundShade: '#26264A', ink: '#15162E', cream: '#D9D4E8',
    rock: '#6E6C8A', rockShade: '#4C4A6B', tree: '#2E5876', treeShade: '#1F415C',
    water: '#1F3D74', waterLight: '#4468A8', metal: '#D9D4E8',
  },
};

export const SHADOW = { dx: 0.55, dy: 0.38 }; // hard shadow direction (unit len * height)

// Tuned for 20–40 s battles: units survive ~7–10 hits, orders have time to matter.
// `name`/`plural` are the prose names for a body of this type; every label a screen shows
// is derived from them (see world-screens.js), so a new type cannot exist without one.
export const UNIT_TYPES = {
  spear: {
    name: 'Spearman', plural: 'spearmen', icon: 'spear',
    hp: 100, dmg: 10, range: 30, speed: 105, radius: 10,
    cooldown: 1.05, cost: 15,
  },
  archer: {
    name: 'Archer', plural: 'archers', icon: 'bow',
    hp: 60, dmg: 10, range: 230, speed: 95, radius: 10,
    cooldown: 1.7, cost: 25, ranged: true, projSpeed: 340, keepAway: 130,
  },
  knight: {
    name: 'Knight', plural: 'knights', icon: 'helm',
    hp: 170, dmg: 15, range: 34, speed: 175, radius: 12,
    cooldown: 0.95, cost: 60, mounted: true,
  },
};

export const ENEMY_TYPES = {
  bandit: {
    name: 'Bandit', plural: 'bandits', icon: 'axe', hp: 110, dmg: 10, range: 28, speed: 92, radius: 10,
    cooldown: 1.3, windup: 0.5, gold: 6,
  },
  raider: {
    name: 'Raider', plural: 'raiders', icon: 'bow', hp: 85, dmg: 9, range: 210, speed: 82, radius: 10,
    cooldown: 2.2, windup: 0.55, gold: 7, ranged: true, projSpeed: 300, keepAway: 150,
  },
  brute: {
    name: 'Brute', plural: 'brutes', icon: 'club', hp: 420, dmg: 24, range: 52, speed: 55, radius: 18,
    cooldown: 2.8, windup: 0.95, gold: 25, slamR: 100,
  },
  wolf: {
    name: 'Wolf', plural: 'wolves', icon: 'fang', hp: 55, dmg: 8, range: 24, speed: 158, radius: 8,
    cooldown: 1.1, windup: 0.42, gold: 4,
  },
};

export const HERO = {
  hp: 120, speed: 315, accel: 1150, friction: 4.2,
  swingDmg: 22, swingArc: 2.2, swingRange: 86, swingCd: 0.34, swingMaxTargets: 3,
  dashSpeed: 760, dashTime: 0.20, dashCd: 2.2, dashDmg: 16, iframeTime: 0.5,
  radius: 14,
};

// Campaign world layout (hand-placed, 3200 x 2200)
export const WORLD = {
  w: 3200, h: 2200,
  heroStart: { x: 620, y: 1250 },
  // each settlement has a reason to visit: a local specialty, not a copy-paste menu
  settlements: [
    { id: 'ashford',  kind: 'village', name: 'Ashford',  x: 700,  y: 1150, spearCost: 12, flavor: 'farm lads march cheap' },
    { id: 'brindle',  kind: 'village', name: 'Brindle',  x: 1500, y: 1750, archerCost: 20, flavor: 'woodland hunters, keen eyes' },
    { id: 'coldwell', kind: 'village', name: 'Coldwell', x: 1350, y: 550,  freeHeal: true, flavor: 'hot springs mend the weary' },
    { id: 'keep',     kind: 'town',    name: 'Highmere', x: 2050, y: 1150, flavor: 'the King’s garrison town' },
  ],
  // tier scales the garrison relative to the player's strength: a difficulty curve,
  // not a wall — camp 1 is winnable for a starter warband, Wolfsjaw punishes everyone
  camps: [
    { id: 'c1', x: 1050, y: 1500, size: 3, tier: 0.7 },
    { id: 'c2', x: 1850, y: 500,  size: 4, tier: 0.9 },
    { id: 'c3', x: 2500, y: 1750, size: 5, tier: 1.1 },
    { id: 'strong', x: 2800, y: 600, size: 10, tier: 1.5, stronghold: true, name: 'Wolfsjaw Hold' },
  ],
  // mountains / forests / rivers are procedurally scattered with a fixed seed in world.js
};

// ---------------------------------------------------------------------------
// Fighting weight (Plan 028) — the single source of truth for "how strong is this
// force". Used by the encounter generator, the world map (party/garrison badges,
// chase/flee thresholds, the odds pill and the brief) and the battle scene's defeat
// diagnosis. One number, one definition, everywhere.
//
// Until Plan 028 this counted BODIES: a brute was 5 points, everything else 1, the hero
// 3 and a knight 2. That is what the encounter generator balanced on, and it is wrong by
// large factors in both directions — measured over 2544 seeded battles
// (`critiques/encounter-power-comparison.md`): a wolf counted 1 is worth 0.52 spearmen, a
// bandit counted 1 is worth 0.80, a brute counted 5 is worth 3.19, and an idle hero
// counted 3 is worth about half a spearman. Because the errors do not cancel, the same
// "12 strength" party can be anything from a rout to a real fight, and on average the map
// called fights even that were not. That is the root cause the Plan 027 retrospective named.
//
// The replacement is the Lanchester square law, which is what a fight between two lines
// that both shoot at whoever is nearest actually obeys: a force's fighting weight is
//
//     sqrt( total damage per second  x  total hit points )
//
// scaled so ONE SPEARMAN IS 1.0, which keeps the badges on the scale players already
// read. Two forces are evenly matched when this number is equal; it scales linearly with
// force size, so the tier bands and odds thresholds keep their intuitive meaning.
//
// Validated, not asserted, against two independently generated measurement sets — 1776
// battles over hand-built enemy ladders (which is what separates one body's worth from
// another's) and 768 battles over compositions drawn from the SHIPPED roller (which is
// the distribution the generator will actually produce). Pooled, it calls 89.0% of
// decisive matchups correctly against headcount's 84.7%, and 93.9% against 87.7% on the
// ladders. The stronger evidence is not the accuracy but the CONSISTENCY: across the 45
// roster-versus-enemy-family combinations in the ladder grid, the ratio at which the
// player's win rate crosses 50% has an interquartile range of 0.79-1.06 under this metric
// and 0.61-1.04 under headcount, around a target of 1.00. Headcount is not merely lower;
// it means a different thing depending on what the party is made of.
// ---------------------------------------------------------------------------

// Effective attack cadence. An enemy telegraphs its blow (`windup`) and only starts its
// cooldown once the strike lands, so its real cycle is cooldown + windup; the player's
// units have no telegraph and swing on the cooldown alone. Dividing enemy damage by
// `cooldown` alone — as the pre-028 audit arithmetic did — overstates a bandit by 38%.
export function attackCycle(d) {
  return d.cooldown + (d.windup || 0);
}

// Per-type efficiency: how much a body is really worth relative to the raw damage x
// durability product, FITTED against the measured grid rather than reasoned out (see
// scripts/zz-power-fit2.mjs). A multiplier scales both the body's damage and its hit
// points, so it scales that body's contribution to the square-law weight linearly and
// reads directly as "what this body is really worth". The spearman is the unit of account
// and is 1.00 by definition.
//
// The fit is a maximum-likelihood one with the logistic intercept pinned at zero, so a
// ratio of 1.00 means a measured coin flip by construction rather than by calibration.
// Rows from mixed-composition matchups are up-weighted, because a mixed composition is
// the only kind the encounter generator ever produces.
export const POWER_EFFICIENCY = Object.freeze({
  spear: 1.00,
  // A bow line that is screened by anything at all shoots for the whole fight, and 230 is
  // the longest reach on the field. (Fitted at 0.86 against the hand-built ladders alone,
  // which is an artefact of those ladders: a PURE wolf pack sends every one of its bodies
  // at `nearestFriendlyRanged`, so the whole archer line is eaten. A rolled composition is
  // about a fifth wolves, and against that the bow line is worth this instead. The rolled
  // grid is the distribution the generator draws from, so it is the one that decides.)
  archer: 1.30,
  // 175 px/s. A knight picks its fight, reaches it first, and can leave it.
  knight: 1.20,
  bandit: 1.00,
  // Shoots at 210 and keeps away at 150: much of a raider's output is delivered before
  // anything on the player's side can answer it. The single largest correction in the
  // table, and the one that most surprised the fit.
  raider: 1.65,
  // 420 hit points that must be ground all the way down, plus an area slam. Still worth
  // well under the 5 points the old headcount rule gave it, but nearly twice its raw
  // damage-times-durability figure.
  brute: 1.90,
  // 55 hit points: a wolf lands its bite and dies, and overkill damage is wasted on it —
  // which is exactly what the square law does not model on its own.
  wolf: 0.95,
});

function bodyPower(d, eff) {
  return { dps: (d.dmg / attackCycle(d)) * eff, hp: d.hp * eff };
}
const powerTable = (types) => Object.freeze(Object.fromEntries(
  Object.entries(types).map(([k, d]) => [k, Object.freeze(bodyPower(d, POWER_EFFICIENCY[k] ?? 1))])));

// Precomputed once per type: the per-tick strength predicates on the world map add these
// up rather than recomputing a division per body.
export const UNIT_POWER = powerTable(UNIT_TYPES);
export const ENEMY_POWER = powerTable(ENEMY_TYPES);

// One spearman is the unit of fighting weight. Derived from the table, never a literal,
// so retuning the spearman renormalises every badge in the game at once.
export const POWER_UNIT = Math.sqrt(UNIT_POWER.spear.dps * UNIT_POWER.spear.hp);

// THE HERO IS SOAK, NOT DAMAGE, and that is a deliberate design decision rather than an
// oversight. The encounter generator sizes every fight against a commander who gives no
// orders and never swings, because that is the player the phase-4 audit found winning 96%
// of roaming fights. He enters the metric as HERO.hp of hit points and no damage at all;
// everything the player actually does with the sword is his margin over the odds the map
// showed him. (Measured: letting the fit choose the hero's soak credit freely drove it to
// zero and bought 0.8 points of accuracy, which is a boundary artefact of a parameter that
// is constant across every roster in the grid. His real hit points are used instead.)
// sqrt(0 x hp) is legitimately 0 — a force that deals no damage cannot win — so
// `playerStrength` floors the warband's output at one spearman's worth, which is the
// smallest force the game ever asks anyone to fight with and keeps every ratio finite
// when the last troop dies.
export const HERO_POWER = Object.freeze({ dps: 0, hp: HERO.hp });

export function forceWeight(dps, hp) {
  return Math.sqrt(Math.max(0, dps) * Math.max(0, hp)) / POWER_UNIT;
}

// `comp` entries may be plain type strings (world party/garrison comps) or {type} objects
// (battle setup.enemies) — both shapes are accepted, as they always were.
export function enemyStrength(comp) {
  let dps = 0, hp = 0;
  for (const t of comp || []) {
    const p = ENEMY_POWER[typeof t === 'string' ? t : t.type];
    if (p) { dps += p.dps; hp += p.hp; }
  }
  return forceWeight(dps, hp);
}
export function playerStrength(troops) {
  let dps = HERO_POWER.dps, hp = HERO_POWER.hp;
  for (const t of troops || []) {
    const p = UNIT_POWER[t.type];
    if (p) { dps += p.dps; hp += p.hp; }
  }
  return forceWeight(Math.max(dps, UNIT_POWER.spear.dps), hp);
}

// Badges, pills and briefs show ONE decimal: a spearman is 1.0, so whole numbers would
// round a wolf (0.55) and a bandit (0.80) to the same figure and the map would go back to
// counting bodies. Every surface formats through here so they cannot drift.
export function weightText(w) {
  return (Math.round(w * 10) / 10).toFixed(1);
}

export const BALANCE = {
  startGold: 80,
  startTroops: 4,
  armyCapBase: 12,
  lootPerEnemy: 5,
  lootBase: 10,
  defeatGoldLoss: 0.3,   // fraction lost when hero falls
  healCost: 10,
  battleGrace: 6,        // seconds of ambush immunity after returning to the map
  settlementSafeR: 260,  // parties will not chase/engage inside this radius of a settlement
  // Plan 020: weighted spawn tiers replace the deleted 0.6-1.5x flat fair-band guarantee.
  // World.spawnParty() shifts these weights toward `strong` as camps fall, so the curve
  // rises across a run instead of tracking the player forever (see rollComp()).
  //
  // Plan 028 REDEFINED WHAT THESE RATIOS ARE RATIOS OF. They used to multiply a headcount
  // of strength points; they now multiply the player's FIGHTING WEIGHT, so 1.0 is a
  // measured coin flip rather than an equal body count. The old `even` band read 0.8-1.2
  // on the headcount scale and delivered roughly 0.72-0.90 of real power — a band the
  // player could not lose, which is why nothing downstream of the generator could make an
  // idle hero lose. `even` now straddles 1.00 on purpose.
  // Measured over 768 rolled encounters (scripts/zz-power-probe2.mjs): an idle hero wins
  // about 95% at a ratio of 0.7, about 60% at 1.0, about 44% at 1.1 and about 24% at 1.2.
  // `even` therefore straddles the measured coin flip rather than sitting below it, `weak`
  // stays a foothold a starting warband can actually take, and `strong` is a fight the
  // player has to bring something to.
  partyTiers: {
    weak:   { min: 0.55, max: 0.80 },
    even:   { min: 0.95, max: 1.20 },
    strong: { min: 1.40, max: 1.85 },
  },
  // Floor guarantee: if no live party (including one occupying a settlement) sits at or
  // under this ratio, World.enforceBeatableFloor() adds (or, at the party cap, downgrades
  // to) an even-tier fight, so the campaign can never reach a state with nothing on the
  // map the player can beat. It stays pinned to the TOP OF THE EVEN BAND — "beatable" and
  // "a fair fight" have to mean the same number, which was Plan 020's rationale and is
  // still the right one now that the number means something.
  beatablePartyRatio: 1.20,
  // Hard bounds on any generated encounter's fighting weight, replacing Plan 020's [2, 24]
  // strength-point clamp. The floor stops a wiped-out warband from being offered a fight
  // with nothing in it; the ceiling stops a maxed knight army from summoning a party the
  // battle scene has to render. 22 is about 0.9x a fully upgraded roster, the same
  // relative position the old ceiling of 24 held against the old maximum of 27.
  encounterWeightClamp: { min: 1.2, max: 22 },
  // A camp always fields SOMETHING, however weak the player is: this much fighting weight
  // per point of `camp.size`. Replaces `camp.size + 2` strength points. It only ever binds
  // for a warband well below the camp's tier, which is the case it exists for.
  campWeightPerSize: 0.9,
  // Heavy-body ceilings for a garrison roll, by the player's own fighting weight. The old
  // thresholds were 12 and 8 strength points, which are 8.2 and 5.2 on this scale.
  garrisonBruteCaps: { strongholdCap: 3, twoAt: 8, oneAt: 5 },
  // Plan 023: the world lives only while the hero rides. `worldWakeSpeed` is the same
  // 40 px/s that already gates hero bob, dust and the gallop SFX, so ONE number decides
  // "is the horse moving" for both presentation and the campaign clock and they can
  // never drift apart. The fade is asymmetric on purpose: the stale cue creeps in, but
  // resuming a ride must feel instant rather than sluggish.
  worldWakeSpeed: 40,
  worldFreezeFadeInT: 0.30,
  worldFreezeFadeOutT: 0.12,
  raidBreakOffT: 20,  // seconds of sustained, uncaught chase before a party gives up and raids
  raidSpeed: 150,     // travel speed while a broken-off party beelines for a settlement
  raidArrivalR: 140,  // distance at which a raiding party is considered to have occupied its target
  // Army-cap upgrade price, charged in World.updateSettlementInteractions and shown in
  // the town prompt — one formula (armyCapCost) so the price tag can never lie.
  armyCapCostBase: 40,
  armyCapCostStep: 20,
  // Odds-word bands: above `oddsStronger` they outmatch you, below `oddsFavored` you are
  // favoured, between is an even fight. Retuning these retunes every odds label at once
  // (party pill, camp prompt, hover panel, pre-battle brief, party badge) — see oddsWord().
  // Unchanged by Plan 028, and that is the point: they are ratios of fighting weight now,
  // and a ratio of 1.0 is a measured coin flip, so "an even fight" finally is one. The
  // party badge's outmatched marker used to carry its own hardcoded 1.3 in
  // world/render-actors.js; it reads `oddsStronger` now so one threshold decides the word
  // and the colour.
  oddsStronger: 1.15,
  oddsFavored: 0.85,
  // Enemy-composition roll weights, per source. Two tables, deliberately different: a
  // roaming party leans bandit-heavy with no brute ceiling, a camp garrison rolls brutes
  // slightly more often but caps them by camp size. They sit side by side so retuning one
  // is a choice rather than an oversight (both feed rollComposition()).
  compRolls: {
    party:    { brute: 0.20, bandit: 0.55, raider: 0.80 },
    garrison: { brute: 0.22, bandit: 0.60, raider: 0.85 },
  },
};

// The odds vocabulary. Every surface that judges a fight uses these exact strings, so a
// caller can compare against ODDS_WORDS.outmatched to colour the label without re-deriving
// the threshold (world.js's party pill and camp prompt, world-screens.js's hover + brief).
export const ODDS_WORDS = Object.freeze({
  outmatched: '⚠ they outmatch you',
  favored: 'favored',
  even: 'an even fight',
});
export function oddsWord(enemyStr, mine) {
  if (enemyStr > mine * BALANCE.oddsStronger) return ODDS_WORDS.outmatched;
  if (enemyStr < mine * BALANCE.oddsFavored) return ODDS_WORDS.favored;
  return ODDS_WORDS.even;
}

// Shared weighted composition roller: fills a force up to `target` FIGHTING WEIGHT,
// drawing exactly one R() per body so a given seed produces a given comp. `weights` is a
// BALANCE.compRolls table; `bruteCap` bounds heavy bodies (garrisons cap by camp size,
// parties do not).
//
// Plan 028 replaced the strength-point target this filled to before. Two rules survive
// from the old roller, restated honestly:
//
//   * The brute gate. A brute is the one body worth materially more than the rest, so it
//     is only ever added when the force can still absorb it without blowing past the
//     target — which is exactly what `target - str >= 5` used to say.
//   * Exactly one `R()` draw per body, so a given seed still produces a given comp.
//
// One rule is new. The old roller always STOPPED ON THE OVERSHOOT, and on a weight scale
// that is a systematic bias whose size depends on the warband: one bandit is 7% of a late
// warband's weight and 18% of a starting one, so a fresh campaign was quietly served
// harder fights than the band it drew. Rolling back the crossing body when the force
// WITHOUT it sits closer to the target removes that; ties keep the body, so a target is
// still met rather than approached from below. Measured over the tier calibration, this
// is the difference between a starting warband facing a 1.20 ratio when the generator
// drew 1.10 and facing 1.11.
//
// `MAX_BODIES` is a safety bound, not a balance knob — BALANCE.encounterWeightClamp keeps
// real targets far below it, and a runaway loop here would be a hung world tick rather
// than a bad fight.
const MAX_BODIES = 40;
export function rollComposition(target, R, weights, bruteCap = Infinity) {
  const comp = [];
  let dps = 0, hp = 0, brutes = 0;
  const brutePower = ENEMY_POWER.brute;
  let under = 0;
  while (comp.length < MAX_BODIES && (comp.length === 0 || forceWeight(dps, hp) < target)) {
    const r = R();
    const bruteFits = forceWeight(dps + brutePower.dps, hp + brutePower.hp) <= target;
    let type;
    if (brutes < bruteCap && bruteFits && r < weights.brute) { type = 'brute'; brutes++; }
    else if (r < weights.bandit) type = 'bandit';
    else if (r < weights.raider) type = 'raider';
    else type = 'wolf';
    under = forceWeight(dps, hp);
    const p = ENEMY_POWER[type];
    dps += p.dps; hp += p.hp;
    comp.push(type);
  }
  const over = forceWeight(dps, hp);
  if (comp.length > 1 && over > target && (target - under) < (over - target)) comp.pop();
  return comp;
}
