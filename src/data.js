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
export const UNIT_TYPES = {
  spear: {
    name: 'Spearman', icon: 'spear',
    hp: 100, dmg: 10, range: 30, speed: 105, radius: 10,
    cooldown: 1.05, cost: 15,
  },
  archer: {
    name: 'Archer', icon: 'bow',
    hp: 60, dmg: 10, range: 230, speed: 95, radius: 10,
    cooldown: 1.7, cost: 25, ranged: true, projSpeed: 340, keepAway: 130,
  },
  knight: {
    name: 'Knight', icon: 'helm',
    hp: 170, dmg: 15, range: 34, speed: 175, radius: 12,
    cooldown: 0.95, cost: 60, mounted: true,
  },
};

export const ENEMY_TYPES = {
  bandit: {
    name: 'Bandit', icon: 'axe', hp: 110, dmg: 10, range: 28, speed: 92, radius: 10,
    cooldown: 1.3, windup: 0.5, gold: 6,
  },
  raider: {
    name: 'Raider', icon: 'bow', hp: 85, dmg: 9, range: 210, speed: 82, radius: 10,
    cooldown: 2.2, windup: 0.55, gold: 7, ranged: true, projSpeed: 300, keepAway: 150,
  },
  brute: {
    name: 'Brute', icon: 'club', hp: 420, dmg: 24, range: 52, speed: 55, radius: 18,
    cooldown: 2.8, windup: 0.95, gold: 25, slamR: 100,
  },
  wolf: {
    name: 'Wolf', icon: 'fang', hp: 55, dmg: 8, range: 24, speed: 158, radius: 8,
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

// Shared strength formulas — the single source of truth for "how strong is this force",
// used by both the world map (party/garrison badges, chase/flee thresholds) and the battle
// scene (defeat diagnosis). `comp` entries may be plain type strings (world party/garrison
// comps) or {type} objects (battle setup.enemies) — both shapes are accepted.
export function enemyStrength(comp) {
  return (comp || []).reduce((s, t) => s + ((typeof t === 'string' ? t : t.type) === 'brute' ? 5 : 1), 0);
}
export function playerStrength(troops) {
  return 3 + (troops || []).reduce((s, t) => s + (t.type === 'knight' ? 2 : 1), 0);
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
  partyTiers: {
    weak:   { min: 0.45, max: 0.7 },
    even:   { min: 0.8,  max: 1.2 },
    strong: { min: 1.5,  max: 2.2 },
  },
  // Floor guarantee: if no live party (including one occupying a settlement) sits at or
  // under this ratio, World.enforceBeatableFloor() downgrades the weakest one so the
  // campaign can never reach a state with nothing on the map the player can beat.
  beatablePartyRatio: 1.2,
  raidBreakOffT: 20,  // seconds of sustained, uncaught chase before a party gives up and raids
  raidSpeed: 150,     // travel speed while a broken-off party beelines for a settlement
  raidArrivalR: 140,  // distance at which a raiding party is considered to have occupied its target
};
