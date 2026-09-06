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
    road: '#CDA773', roadShadow: '#8A5F32',
    water: '#2C9DB5', waterDeep: '#278BA5', waterLight: '#8FE0EA', waterRim: '#1B6E88', bank: '#477F82', sand: '#D8B66F',
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
    // A second, tighter ellipse right under a landmark: contact occlusion, so a village
    // sits ON the ground instead of hovering over one long soft smear.
    landmarkCore: 0.55,
  }),
  roads: freeze({
    alpha: 1, shadowExtra: 4.5, shadowAlpha: 0.24, sectionLength: 72,
    edgeFade: 64, hudFade: 46,
    widths: freeze({ minor: 5.5, secondary: 7.5, major: 10.5 }),
    endpoints: freeze({ village: 5, major: 13 }),
  }),
  rivers: freeze({
    normalWidth: 48, minRatio: 0.75, maxRatio: 1.4,
    minWidth: 36, maxWidth: 68, transitionLength: 150,
    bankShadow: 4, groundBandExtra: 18,
    highlightWidth: 7, highlightAlpha: 0.42, highlightDash: freeze([170, 58]),
    // The waterline: a pale shallow shelf inside the bank, and a cool rim ON it. Drawn as
    // strokes of the cached water path — inset by half their own width, which is why the
    // shelf is wide and soft and the rim is thin and dark.
    shelfWidth: 11, shelfAlpha: 0.22, rimWidth: 3.5, rimAlpha: 0.42,
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
    // Plan 030: the bottom safe band shrank with the prompt. It used to reserve room for a
    // five-line service legend; the interaction chip that replaced it is one 34px row, and
    // reserving more than that would keep hover suppressed over map the HUD no longer covers.
    margin: 14, radius: 9, topSafeH: 148, bottomSafeH: 64,
    resourceW: 240, resourceH: 36, objectiveW: 300, objectiveH: 56,
    toastH: 34,
  }),
  // Ground texture and screen grading (see src/lighting.js). The texture is one repeating
  // pattern painted in a single fillRect over the whole ground plane, so a bare ochre field
  // carries soil variation instead of reading as one slab of paint; the grading is three
  // cached gradients. Neither costs a beginPath against the world render budget.
  // Ground texture: ONE repeating tile, painted over the visible ground in a single
  // fillRect. It was two tiles at different periods, which hid the repeat better — but a
  // viewport-sized pattern fill measured about four milliseconds per frame in the software
  // rasterizer CI renders with, and the second layer was not worth a second one of those.
  // The repeat is instead broken up by mixing four mark sizes into one large tile, and by
  // keeping the whole thing low-contrast: it exists to stop a bare ochre field reading as
  // one slab of paint, not to be looked at.
  ground: freeze({
    tile: 768, seed: 0x5EED17,
    marks: freeze([
      freeze({ count: 34, r: 62, flat: 0.52, color: '#C57F2A', alpha: 0.08 }),
      freeze({ count: 26, r: 44, flat: 0.46, color: '#FFC978', alpha: 0.07 }),
      freeze({ count: 44, r: 17, flat: 0.42, color: '#A96A22', alpha: 0.06 }),
      freeze({ count: 30, r: 11, flat: 0.34, color: '#6E8C3A', alpha: 0.055 }),
    ]),
  }),
  atmosphere: freeze({ key: 'world', sun: 0.1, shade: 0.09, vignette: 0.3 }),
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
