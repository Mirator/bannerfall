// Presentation-only art direction for the campaign map. This module deliberately imports
// nothing: terrain construction, world rendering, HUD hit suppression and contract tests
// all read the same frozen values without creating a scene/data import cycle.

const freeze = value => Object.freeze(value);

export const WORLD_ART = freeze({
  palette: freeze({
    ink: '#1E2A4A', cream: '#F2E3C1', slate: '#59657F',
    west: '#F0A63E', westLight: '#F6B34A',
    center: '#E99F39', centerLight: '#F0AA43',
    east: '#DD9638', eastLight: '#E6A142',
    forestFloor: '#C98633', highlandFloor: '#C98536', riparian: '#B98948',
    tree: '#467F43', treeDark: '#255A38', treeEast: '#356B3D',
    rock: '#D9D4C6', rockDark: '#777688',
    road: '#C29D67', roadShadow: '#8F6537',
    water: '#2C9DB5', waterDeep: '#278BA5', waterLight: '#66C7D5', bank: '#477F82', sand: '#D8B66F',
    field: '#D49843', furrow: '#B87D37',
    enemy: '#C23A2E', hero: '#FFD34D', friendly: '#24569A',
  }),
  scale: freeze({
    tree: freeze({ min: 24, max: 42, main: 1.24, companions: freeze([0.82, 0.72]) }),
    rock: freeze({ min: 18, max: 32, main: 1.18, companions: freeze([0.58, 0.48]) }),
    mountain: freeze({ min: 90, max: 150, main: 1.18, companion: 0.84 }),
    bridge: freeze({ min: 55, max: 70, deckW: 58, deckH: 40 }),
    village: freeze({ min: 130, max: 160, scale: 1.28 }),
    fort: freeze({ min: 170, max: 210, scale: 1.24 }),
    camp: freeze({ scale: 1.2 }),
    unit: freeze({ heroR: 24, badgeR: 9.5, partyBadgeR: 9.5 }),
    label: freeze({ height: 20, radius: 6, font: 14 }),
  }),
  shadow: freeze({
    direction: 'down-right',
    terrainAlpha: 0.16, smallAlpha: 0.46, treeAlpha: 0.58,
    landmarkAlpha: 0.72, mountainAlpha: 0.28,
  }),
  roads: freeze({
    alpha: 1, shadowExtra: 1.8, shadowAlpha: 0.12, sectionLength: 72,
    edgeFade: 64, hudFade: 46,
    widths: freeze({ minor: 5.5, secondary: 7.5, major: 10.5 }),
    endpoints: freeze({ village: 5, major: 13 }),
  }),
  rivers: freeze({
    normalWidth: 48, minRatio: 0.75, maxRatio: 1.4,
    minWidth: 36, maxWidth: 68, transitionLength: 150,
    bankShadow: 4, groundBandExtra: 18,
    highlightWidth: 7, highlightAlpha: 0.42, highlightDash: freeze([170, 58]),
  }),
  clearance: freeze({ village: 125, town: 150, camp: 120, stronghold: 150 }),
  clusters: freeze({
    forest: freeze({ min: 3, max: 7 }), foothills: freeze({ min: 2, max: 4 }),
    rock: freeze({ min: 2, max: 4 }), farmland: freeze({ min: 2, max: 4 }),
  }),
  regions: freeze([
    freeze({ id: 'west', minX: -Infinity, maxX: 1030, ground: '#F0A63E', light: '#F6B34A', vegetation: '#467F43' }),
    freeze({ id: 'center', minX: 1030, maxX: 2430, ground: '#E99F39', light: '#F0AA43', vegetation: '#3F7641' }),
    freeze({ id: 'east', minX: 2430, maxX: Infinity, ground: '#DD9638', light: '#E6A142', vegetation: '#356B3D' }),
  ]),
  hud: freeze({
    margin: 14, radius: 9, topSafeH: 148, bottomSafeH: 120,
    resourceW: 240, resourceH: 36, objectiveW: 300, objectiveH: 56,
    contextW: 420, toastH: 34,
  }),
  framing: freeze({
    // When the hero is exactly on an interaction coordinate, lift the presentation
    // token above the landmark. Simulation and hover coordinates stay untouched.
    landmarkDockR: 76, landmarkDockY: 92,
    edgeVeil: 24, edgeVeilAlpha: 0.16,
  }),
});

export function worldRegionAt(x) {
  return WORLD_ART.regions.find(region => x >= region.minX && x < region.maxX) || WORLD_ART.regions[1];
}

// Shared draw-path coordinate for the hero token and its hover affordance. Callers pass
// the canonical landmarks so this presentation module stays dependency-free and cannot
// become a simulation/data import hub.
export function heroPresentationPosition(world, landmarks) {
  const actual = world.hero;
  let nearest = Infinity;
  for (const landmark of landmarks) {
    nearest = Math.min(nearest, Math.hypot(actual.x - landmark.x, actual.y - landmark.y));
  }
  const dockT = Math.max(0, 1 - nearest / WORLD_ART.framing.landmarkDockR);
  const dockEase = dockT * dockT * (3 - 2 * dockT);
  return dockEase > 0
    ? { x: actual.x, y: actual.y - WORLD_ART.framing.landmarkDockY * dockEase }
    : { x: actual.x, y: actual.y };
}

export function worldHudLayout(width, height) {
  const H = WORLD_ART.hud, m = H.margin;
  return {
    resource: { x: m, y: m, w: H.resourceW, h: H.resourceH },
    objective: { x: width - m - H.objectiveW, y: m, w: H.objectiveW, h: H.objectiveH },
    topSafe: { x: 0, y: 0, w: width, h: H.topSafeH },
    bottomSafe: { x: 0, y: height - H.bottomSafeH, w: width, h: H.bottomSafeH },
  };
}

export function pointInWorldHud(mx, my, width, height) {
  const layout = worldHudLayout(width, height);
  return my >= layout.topSafe.y && my <= layout.topSafe.y + layout.topSafe.h ||
    my >= layout.bottomSafe.y && my <= layout.bottomSafe.y + layout.bottomSafe.h;
}
