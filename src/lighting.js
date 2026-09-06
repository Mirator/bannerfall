// One sun for the whole game. This module deliberately imports nothing: both scene
// renderers, `engine.js`'s flat-shaded primitives and the art-direction contract test read
// the same frozen values, and with no bundler an import cycle here would be a real hazard.
//
// The art direction is flat-shaded low-poly (the reference is Thronefall): a single low key
// light with everything leaning one way, warm lit faces against COOL shadows rather than
// merely darker ones, and enough broad tonal variation on the ground that a large empty
// field never reads as one flat slab of paint. Nothing in here is per-object: the ground
// texture is one repeating pattern and the grading is three cached gradients, so the whole
// pass costs a handful of `fillRect`s and not a single `beginPath` against the structural
// Canvas budgets in `performance.spec.js`.

const freeze = value => Object.freeze(value);

export const LIGHT = freeze({
  // The sun sits up-left. `engine.js` derives its cast-shadow offsets from the same angle,
  // so every shadow in both scenes leans down-right, away from this one point.
  angle: Math.atan2(0.16, 0.30),
  key: '#FFEDC4',    // sunlight: what a lit face is pulled toward
  cool: '#2B3A66',   // shadow colour — blue-violet, never neutral black
  // How far each family is pulled toward those two tones. Cast shadows take the largest
  // share because an untinted shadow is the single clearest "flat vector art" tell.
  shadowMix: 0.38,
  rimMix: 0.5,
});

// ---------------------------------------------------------------- colour
const HEX = /^#([0-9a-f]{6})$/i;
const mixCache = new Map();

// Blend two #rrggbb colours. Memoised because the shadow tint below runs on every cast
// shadow of every frame — a few hundred calls — and the inputs are a tiny fixed set.
export function mix(a, b, t) {
  const key = a + b + t;
  const hit = mixCache.get(key);
  if (hit) return hit;
  if (!HEX.test(a) || !HEX.test(b)) return a;
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const r = Math.round(((na >> 16) & 255) * (1 - t) + ((nb >> 16) & 255) * t);
  const g = Math.round(((na >> 8) & 255) * (1 - t) + ((nb >> 8) & 255) * t);
  const bl = Math.round((na & 255) * (1 - t) + (nb & 255) * t);
  const out = '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  mixCache.set(key, out);
  return out;
}

// Relative luminance of a #rrggbb colour, on the usual 0.2126/0.7152/0.0722 weights.
function luma(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

// The colour a cast shadow of `color` takes under this sun: pulled toward the cool tone,
// then clamped so it can never come out BRIGHTER than the colour it was asked for. Without
// the clamp the night field's shadows went pale — its ground shade is darker than the cool
// tint, so the mix alone lifted every shadow into a light blob on dark grass.
export function shadowTint(color) {
  const mixed = mix(color, LIGHT.cool, LIGHT.shadowMix);
  const target = luma(color);
  const got = luma(mixed);
  return got <= target ? mixed : mix(mixed, '#000000', 1 - target / got);
}
// The colour of a sunlit rim on a face already painted `color`. `key` overrides the sun's
// own tone for a scene lit by something else — the night field's moon is cold, and a warm
// rim under it reads as a lighting error rather than as a highlight.
export const rimTint = (color, key = LIGHT.key) => mix(color, key, LIGHT.rimMix);

// ---------------------------------------------------------------- ground texture
// A seamless repeating tile of soil marks, baked once per key for the whole process and
// then painted as ONE fill with a `CanvasPattern`. The cache is module-level on purpose: the
// tile depends only on its spec, and a per-instance cache re-baked the same image for every
// world and every battle the suites construct. Deterministic from its own local LCG — this
// is presentation, so it must never touch `simRng` or `fxRng` (AGENTS.md: RNG domains are
// separate, and a texture that consumed a gameplay stream would move the simulation).
const TILES = new Map();

export function groundTile(key, spec) {
  const hit = TILES.get(key);
  if (hit) return hit;
  const size = spec.size || 192;
  const tile = document.createElement('canvas');
  tile.width = size; tile.height = size;
  const g = tile.getContext('2d');
  // An opaque `base` makes the tile the ground itself rather than an overlay on it, so one
  // fill paints colour and texture together instead of two.
  if (spec.base) { g.fillStyle = spec.base; g.fillRect(0, 0, size, size); }
  let s = (spec.seed >>> 0) || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Every mark is stamped at its nine wrapped positions so the tile is seamless: a mark
  // that runs off the right edge comes back on the left. One-time cost at bake.
  const WRAP = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size],
    [size, size], [size, -size], [-size, size], [-size, -size]];
  for (const mark of spec.marks) {
    g.fillStyle = mark.color;
    g.globalAlpha = mark.alpha;
    for (let i = 0; i < mark.count; i++) {
      const x = rnd() * size, y = rnd() * size;
      const rx = mark.r * (0.55 + rnd() * 0.9);
      const ry = rx * (mark.flat || 0.55);
      const rot = rnd() * Math.PI;
      for (const [ox, oy] of WRAP) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, rx, ry, rot, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  TILES.set(key, tile);
  return tile;
}

// The tile as a repeating fill for one context. The baked canvas is what is cached, not the
// pattern: the battle's four static tiles each bake on their own context, and a CanvasPattern
// is cheap to make but carries no promise of being valid on a context it did not come from.
export function groundPattern(ctx, key, spec) {
  return ctx.createPattern(groundTile(key, spec), 'repeat');
}

// ---------------------------------------------------------------- screen grading
// The frame's light: a warm key toward the sun's corner falling off into a cool vignette at
// the edges. Baked ONCE into a viewport-sized overlay bitmap and then blitted 1:1, which is
// not premature optimisation but a measured one — the legacy QA suite (the longest-running
// spec in the gate, and the one closest to its timeout) was 15.7 s before this pass, and the
// same grading measured:
//
//   live radial gradient, one fillRect per frame ......... 20.3 s
//   the same gradient under `multiply` ................... 20.0 s
//   baked small and scaled up per frame .................. 19.5 s
//   baked at viewport size, blitted 1:1 under `multiply` . 18.4 s
//   baked at viewport size, blitted 1:1 ..................  17.7 s
//
// So the cost is the per-pixel gradient maths and the resample, not the fill: CI renders in
// a software rasterizer, where a square root per pixel per frame is real money. `multiply`
// would hold saturation slightly better than `source-over`, and is not worth 0.7 s of every
// CI run at these alphas. The cache is the same bounded presentation cache as
// `world._staticPaths`: one bitmap per scene, rebuilt only when the viewport changes.
export function atmosphere(ctx, cache, w, h, spec) {
  if (cache.w !== w || cache.h !== h || cache.key !== spec.key) {
    const rgb = hex => {
      const n = parseInt(hex.slice(1), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    };
    const key = rgb(spec.keyColor || LIGHT.key), cool = rgb(spec.coolColor || LIGHT.cool);
    const bake = document.createElement('canvas');
    bake.width = w; bake.height = h;
    const bctx = bake.getContext('2d');
    // One gradient carries both halves of the light. It is centred up-left, toward the sun,
    // so the corner furthest from the key sits deepest in the falloff — which is what a
    // separate counter-shade pass would have drawn, at the price of a second full-frame fill.
    const grade = bctx.createRadialGradient(
      w * 0.34, h * 0.3, Math.min(w, h) * 0.16,
      w * 0.34, h * 0.3, Math.max(w, h) * 0.95);
    grade.addColorStop(0, `rgba(${key},${spec.sun})`);
    grade.addColorStop(0.34, `rgba(${key},0)`);
    grade.addColorStop(0.72, `rgba(${cool},${spec.shade})`);
    grade.addColorStop(1, `rgba(${cool},${spec.vignette})`);
    bctx.fillStyle = grade; bctx.fillRect(0, 0, w, h);
    cache.w = w; cache.h = h; cache.key = spec.key; cache.grade = bake;
  }
  ctx.drawImage(cache.grade, 0, 0);
}
