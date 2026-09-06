# Plan 048 — one sun for both scenes

- Status: **IMPLEMENTED**.
- Scope: a new `src/lighting.js`, the flat-shaded primitives in `src/engine.js`, both scene
  renderers, `world/visual-style.js` and `battle/constants.js`. Two visual baselines
  re-recorded. No assertion weakened, no budget raised, no test skipped; the shadow-key
  contract in `world-visual-contract.spec.js` gained the one key this plan adds.
- Trigger: "look at reference games and improve the graphics". The reference is Thronefall,
  and the gap was not detail — it was light. Both scenes painted flat colour on flat colour,
  with shadows that were the ground colour a bit darker.

## 1. What was actually missing

Compared side by side against the reference, the shipped renderer was short of four things,
in order of how much each one costs the frame:

1. **No ground.** A campaign map is mostly bare ochre and a battlefield mostly bare grass;
   both were painted as one uniform slab, so half of every screenshot was a flat area of
   solid colour.
2. **No frame.** Nothing told the eye where to look. Thronefall's shots read as photographs
   of a place because the light falls off toward the edges.
3. **Shadows that were not shadows.** `shadow()` filled the caller's colour straight. A cast
   shadow that is only a darker copy of the surface under it is the single clearest tell of
   flat vector art.
4. **Objects without a lit edge.** Trees and rocks had a light half and a dark half and
   nothing where the two meet, so they read as two triangles rather than as one solid.

## 2. What the plan does

`src/lighting.js` is a new dependency-free module holding the one sun both scenes now use:
its direction (which `engine.js`'s cast-shadow offsets already derived from, and now import),
the warm key it lights with, and the cool tone a shadow takes. It also owns the two pieces of
machinery below, because both are shared and neither belongs to a scene.

**Ground texture.** A seamless tile of soil marks, baked once per key from its own local LCG
(presentation, so it touches neither `simRng` nor `fxRng`) and painted as a repeating
pattern. The campaign map's tile carries `P.ground` as its own opaque background, which
collapses three full-viewport paints into one: the screen-space ink clear, the overscanned
ground rect and the texture over the top. The ink clear was dead paint — the ground rect
deliberately overscans a full camera in each direction, so no navy was ever visible under it.
The battlefield's tile is derived from the live biome palette and is baked into the static
prop tiles, not painted per frame.

It was two tiles at different periods for a while, which hides the repeat better than one.
One viewport-sized pattern fill measured about four milliseconds per frame in the software
rasterizer CI renders with; the second layer was not worth another one, so the repeat is
broken up by mixing four mark sizes into one large tile instead.

**Screen grading.** A warm key toward the sun's corner falling off into a cool vignette at
the edges — one gradient, centred up-left toward the sun so the far corner sits deepest in
the falloff, which is what a separate counter-shade pass had been drawing at the price of a
second full-frame fill.

**Cool shadows.** `shadow()` pulls the caller's colour toward the shared cool tone, and then
clamps the result so it can never come out brighter than what was asked for. The clamp is not
defensive coding: the night biome's ground shade is darker than the cool tint, so the mix
alone turned every night shadow into a pale blob on dark grass.

**Solids instead of pairs of triangles.** `tree()`, `rock()` and `mountain()` gained a lit
rim, a cool shade face and (for the tree) a trunk and a third tier. This costs *less* than
what it replaced: `beginPath` is what the render budgets count and subpaths are free, so a
three-tier canopy drawn as one path per face is one fewer path than two stacked two-tone
cones. The battlefield hill stopped being filled with `P.rock` — cream on grass read as a
sand-coloured sticker laid on the field — and is now the ground's own colour lifted toward
the sun, with a rocky crown.

The rim's key colour is a parameter, defaulted to the sun's. The battle scene passes the
biome's own lit tone, because the night field is lit by a cold moon and a warm rim under it
reads as a lighting error.

## 3. What it costs

`beginPath` per 20 frames, against the fixed ceilings in `performance.spec.js`:

| case | before | after | ceiling |
| --- | --- | --- | --- |
| world overview | 6480 | 6840 | 10000 |
| brief-derived river battle | 11620 | 11160 | 13000 |
| night camp battle | 12940 | 12820 | 15000 |
| wooded highland | 11540 | 11200 | — |

The world pays 360 paths for the tree and roof rims. Every battle case went *down*, because
the consolidated silhouettes more than pay for the rims.

Wall clock is where this plan had to be argued with, twice. The first version cost the legacy
QA runner — the longest spec in the gate, and the one closest to the 30 s per-test timeout —
more than fourteen seconds and turned it red. The whole of that was the grading pass, and it
was not the blend mode and not the number of pixels. One machine, same runner, same suite:

| grading | QA runner |
| --- | --- |
| none | 16.6 s |
| live radial gradient, one `fillRect` per frame | 20.3 s |
| the same gradient under `multiply` | 20.0 s |
| baked small, scaled up per frame | 19.5 s |
| baked at viewport size, blitted 1:1 under `multiply` | 18.4 s |
| baked at viewport size, blitted 1:1 | 17.7 s |
| *(a plain flat translucent `fillRect`, for scale)* | *17.1 s* |

So the cost is the per-pixel gradient maths and the resample, not the fill: a radial gradient
is a square root per destination pixel per frame, and CI renders in software. The shipped
pass bakes the gradient into a viewport-sized bitmap once and blits it. `multiply` would hold
saturation slightly better than `source-over` and is not worth 0.7 s of every CI run at these
alphas.

The same measurement is why the soil tile is cached at module level rather than per instance,
and why the battlefield's is baked into the static prop layer: the suites construct hundreds
of worlds and battles, and each was re-baking an image that depends only on its own spec.

Against `main`, on one machine: the QA runner 15.7 s -> 17.6 s, and `npm test` 174 s -> 210 s.
That is the price of one extra full-frame paint and one pattern fill in a software rasterizer,
and on a real GPU it is not measurable. It is not free and it is not hidden.

## 4. What was tried and rejected

- **A warm wash in `source-over` over the whole frame.** Desaturates everything it touches,
  which is the exact look the pass exists to remove. The first capture of the campaign map
  came back the colour of sand.
- **Fine grit in the soil texture.** At 1x it turns the map into sandpaper: every mark is the
  same size as the noise it is meant to break up. Only low frequencies survived.
- **The night field at full texture strength.** The same marks that read as soil in daylight
  read as pale soap bubbles against a dark field, so the night biome scales its texture to
  0.38. The authored light band and shade wedges also stepped back from 0.10/0.10/0.07 to
  0.05/0.06/0.045, because the graded pass now carries the scene's light and the two together
  cut hard diagonal facets across the field.

## 5. Baselines

Two of the twenty-six visual baselines moved past the comparison's tolerance
(`world-power-exposed`, `world-power-weakened`) and were re-recorded. The other twenty-four
changed too — the screenshots are visibly different — but the documented tolerance
(`threshold: 0.20`, `maxDiffPixelRatio: 0.015`) absorbs a low-contrast change spread evenly
over a frame. That is worth knowing about the instrument: it guards composition and layout,
not grading.
