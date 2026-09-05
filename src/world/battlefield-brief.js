// Plan 024 Phase 2 — samples the campaign map's existing geometry around the hero into a
// plain, serializable `Brief` describing the patch of world a fight is happening on. This is
// the ENTIRE world -> battle contract: the battle scene never imports world.js, it only reads
// the object this function returns.
//
// sampleBattlefield is PURE and READ-ONLY on `world`. It reads already-sampled geometry
// (world.riverLines/roadLines/scenery, world.rivers[i].bridges, world.onRoad()) and the
// static WORLD table — it adds no new curve (AGENTS.md's single-source terrain rule) and
// draws from no shared world RNG stream. The only randomness it uses is a LOCAL stream
// derived from the battle seed via RNG_DOMAINS.BATTLE_TERRAIN, for ford-position jitter only.
//
// Plan 024 "The property that makes this cheap": `setup.approach` is a compass letter and
// world north is battle north, so world -> battlefield needs only a uniform scale (S) and a
// translate (origin) — no rotation.
import { WORLD } from '../data.js?v=r0254bc45c5c3';
import { makeRng, deriveSeed, RNG_DOMAINS } from '../engine.js?v=r0254bc45c5c3';
import { ENGAGE_GAP } from '../battle/constants.js?v=r0254bc45c5c3';

export const WORLD_TO_FIELD = 4;

// Crossing widths. The plan's original figures (bridge 150 / ford 190) were chosen before
// measurement: this same plan's "Where this deviates" section records that a river obstacle
// chain built from r~88 circles (stepped along the curve at r*0.9~79) only clears ONE circle
// per side of a 150-wide skip zone, leaving survivor circles whose r=88 footprint still
// reaches back into the crossing — an opening barely different from the OLD hardcoded
// 136-unit bridge gap that the same section measured stalling 80% of unit-steps. A crossing
// narrower than the obstacle DIAMETER (2*88=176) cannot guarantee a clear line through it.
// Widened here with headroom above that diameter for step-spacing slop and unit collision
// radii: bridge 220 (a built structure, tighter is fine), ford 260 (no structure funnels the
// crossing, and a ford reading wider than a bridge matches the plan's own 150-vs-190 relation,
// kept as the same +40 delta). Phase 3 owns the actual obstacle-skip implementation and must
// re-measure against these; this is a starting judgement call, not a re-derivation of Phase 3.
const BRIDGE_W = 220;
const FORD_W = 260;

// Plan 024 corrective pass: the raw mapping `rock -> r = it.s * 1.1 * S` against world rock
// sizes `s = 14-30` (src/world/terrain.js's rock scatter) yields radii of 61-132 — as large as
// a small hill (`mtn -> s * 0.72 * S` gives 130 at its smallest, `s=45`) and bigger than a
// river collision circle (channel width 22*2*S halved = 88). Measured consequence: a single
// r=131 rock landing on the straight path between the two forces in the riverside fixture
// (world 1150,1000) made that fight take 78.1s against ~41s for every other terrain type —
// tangent steering handles one large isolated circle on the direct path poorly. Capped here,
// in the sampler, because "how big a rock reads as" is a property of what a rock IS, not of
// what the battlefield can tolerate (contrast the hill corridor-safety cap in
// battle/terrain.js, which IS a placement/tolerance concern). 70 sits at roughly half the
// smallest hill's radius and comfortably under the river's 88, so a rock stays legibly a
// boulder rather than a landform. Re-measured after capping: the riverside fixture drops to
// 41.4s, matching every other terrain type.
const ROCK_R_CAP = 70;

// Plan 024 Task 1, first corrective pass: cover was nearly inert (see the coverage curve
// below), and every WOOD_R_MULT above 3.0x broke fight resolution because the mandatory
// blind-ranged fallback walked a blind unit STRAIGHT at its target — into whatever was
// occluding the shot — and kept it blind for the whole traverse. `WOOD_R_MULT` was capped at
// 3.0x (~34% corridor coverage) pending a real fix to that fallback.
//
// Second corrective pass: the fallback now sidesteps tangentially around the actual blocker
// on the sightline instead of walking into it (`blindSidestepHeading` in
// battle/ai-phases.js, reusing `steerAroundObstacle`'s tangent-around-a-circle primitive).
// Re-sweeping the four canonical brief-derived fixtures (plans/024's own measurement set)
// at increasing multipliers found the fix genuinely raises the safe ceiling, but not to the
// task's 55-70% target band:
//   3.0x (34%) -> clean.   3.5x (38%) -> clean, all four resolve, max blindT 11.9s (deep
//   country) — a real margin above the 3.0x baseline's 4.7s, but still bounded and far from
//   an explosion.   3.8x (~39%) -> still resolves, but blindT is visibly climbing (18.2s).
//   4.0x (40%) -> BREAKS: bridge+settlement stops resolving inside a 150s cap with blindT
//   climbing to 121s — the exact disqualifying failure mode this fix targets, meaning the
//   sidestep is not sufficient at this size for that fixture's specific geometry (most likely
//   two blockers positioned so every tangent detour off one immediately re-enters another,
//   which the give-up/cooldown bound converts into "keeps trying and failing" rather than an
//   infinite orbit, but still not actual resolution).
//   Independently, at 4.2x/4.6x/5.4x-6.0x the riverside fixture stalls for an UNRELATED
//   reason: two rocks (unaffected by WOOD_R_MULT) sit close enough together that a bandit can
//   get pinned in the overlap of their push-out radii with zero net displacement — a
//   pre-existing hazard in `separation.js`'s `pushOutOf`, only reachable here because the
//   wood-zone speed change shifts the bandit's approach trajectory enough to land in that
//   trap at some multipliers and not others (confirmed non-monotonic: 4.1x clean, 4.2x stalls,
//   4.3x/4.4x clean again). This is a distinct, already-latent defect that raising
//   `WOOD_R_MULT` merely exposes by chance; it is not evidence about the LOS/blind-advance fix
//   itself and is out of this task's scope to fix (see plans/024 for the record).
//
// **3.5x is the chosen value**: the highest multiplier with a clean, repeatable margin on all
// four fixtures (no observed instability below 4.0x in either failure mode). It raises
// corridor coverage from ~34% to ~38% — real, but still well short of the requested 55-70%
// band. Reaching that band needs ~7-9x (58-66% per the coverage curve below), which is deep
// inside the range now confirmed broken by the bridge+settlement failure at 4.0x alone;
// nothing found in this pass suggests the sidestep fix would hold at more than double that
// multiplier. Closing the gap needs a different lever — denser/more wood clumps rather than
// larger ones, or a sturdier blind-ranged AI — not a further increase of this constant.
//
// Coverage curve (blocker fraction 0.8, unchanged in battle/terrain.js), 273-position sweep:
//   2.2x (pre-Task-1) -> 30%     3.0x -> 34%     3.5x -> 38%     4.0x -> 40%
//   6.0x -> 52%     7.0x -> 58%     8.0x -> 62%     9.0x -> 66%
const WOOD_R_MULT = 3.5;

const DIRS = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };

function inWindow(pt, origin, halfW, halfH) {
  return Math.abs(pt[0] - origin.x) <= halfW && Math.abs(pt[1] - origin.y) <= halfH;
}

// Maximal runs of consecutive in-window points, each extended by one point at either end so
// the emitted polyline exits the field rather than stopping dead in mid-air (Phase 2 step 3).
function extractRuns(line, origin, halfW, halfH) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < line.length; i++) {
    if (inWindow(line[i], origin, halfW, halfH)) {
      if (!cur) cur = [i, i]; else cur[1] = i;
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.map(([s, e]) => line.slice(Math.max(0, s - 1), Math.min(line.length, e + 2)));
}

function fullyOutside(x, y, r, W, H) {
  return x + r < -240 || x - r > W + 240 || y + r < -240 || y - r > H + 240;
}

export function sampleBattlefield(world, approach, seed, fieldW, fieldH) {
  const S = WORLD_TO_FIELD;
  const dir = DIRS[approach] || DIRS.E;
  const adx = dir[0], ady = dir[1];
  const approachOut = DIRS[approach] ? approach : 'E';
  const heroX = world.hero.x, heroY = world.hero.y;

  // Centre the window so the hero's world position maps exactly to his field spawn
  // (Battle.js places the hero at `cx0 - adx*ENGAGE_GAP/2`, cx0 = W/2 — see Phase 1).
  const origin = { x: heroX + adx * (ENGAGE_GAP / 2) / S, y: heroY + ady * (ENGAGE_GAP / 2) / S };
  const toField = (wx, wy) => ({ x: fieldW / 2 + (wx - origin.x) * S, y: fieldH / 2 + (wy - origin.y) * S });
  const halfW = fieldW / 2 / S + 60, halfH = fieldH / 2 / S + 60;

  // Ford jitter only. Never draws from world.simRng/fxRng — see the purity contract above.
  const terrainRng = makeRng(deriveSeed(seed, RNG_DOMAINS.BATTLE_TERRAIN));

  // ---- Rivers + crossings -------------------------------------------------------------
  const rivers = [];
  const crossings = [];
  world.riverLines.forEach((line, i) => {
    for (const run of extractRuns(line, origin, halfW, halfH)) {
      const sourceStart = line.indexOf(run[0]);
      const mapWidths = world.rivers[i].widths;
      const pointWidths = run.map((_, pointIndex) => {
        const sourceIndex = sourceStart + pointIndex;
        return mapWidths[Math.min(mapWidths.length - 1, sourceIndex)] * S;
      });
      rivers.push({
        pts: run.map(([x, y]) => { const f = toField(x, y); return [f.x, f.y]; }),
        width: pointWidths.reduce((sum, width) => sum + width, 0) / pointWidths.length,
        widths: pointWidths,
      });
      const bridgesInWindow = (world.rivers[i].bridges || [])
        .filter(([bx, by]) => inWindow([bx, by], origin, halfW, halfH));
      if (bridgesInWindow.length) {
        for (const [bx, by] of bridgesInWindow) {
          const f = toField(bx, by);
          crossings.push({ x: f.x, y: f.y, kind: 'bridge', w: BRIDGE_W });
        }
      } else {
        // No bridge in range: every river needs a crossing or the fight is unwinnable.
        // Synthesise a ford at the run's own point nearest the field centre (== `origin`
        // in world space), jittered a couple of sample points along the SAME curve so
        // repeated fights don't all ford at an identical spot relative to the hero.
        let bestIdx = 0, bestD = Infinity;
        run.forEach(([x, y], idx) => {
          const d = (x - origin.x) * (x - origin.x) + (y - origin.y) * (y - origin.y);
          if (d < bestD) { bestD = d; bestIdx = idx; }
        });
        const jitter = Math.round((terrainRng() - 0.5) * 4); // +/- 2 sampled river points
        const idx = Math.max(0, Math.min(run.length - 1, bestIdx + jitter));
        const [fx, fy] = run[idx];
        const f = toField(fx, fy);
        crossings.push({ x: f.x, y: f.y, kind: 'ford', w: FORD_W });
      }
    }
  });

  // ---- Roads ----------------------------------------------------------------------------
  const roads = [];
  for (const line of world.roadLines) {
    for (const run of extractRuns(line, origin, halfW, halfH)) {
      roads.push({
        pts: run.map(([x, y]) => { const f = toField(x, y); return [f.x, f.y]; }),
        width: 28 * S,
      });
    }
  }

  // ---- Scenery ----------------------------------------------------------------------------
  const hills = [], woods = [], rocks = [], scrub = [];
  for (const it of world.scenery) {
    if (!inWindow([it.x, it.y], origin, halfW, halfH)) continue;
    const f = toField(it.x, it.y);
    if (it.kind === 'mtn') hills.push({ x: f.x, y: f.y, r: it.s * 0.72 * S });
    else if (it.kind === 'tree') woods.push({ x: f.x, y: f.y, r: it.s * WOOD_R_MULT * S });
    else if (it.kind === 'rock') rocks.push({ x: f.x, y: f.y, r: Math.min(it.s * 1.1 * S, ROCK_R_CAP), rot: it.rot });
    else if (it.kind === 'shrub') scrub.push({ x: f.x, y: f.y, r: it.s * 1.6 * S });
  }

  // ---- Settlement / camp ------------------------------------------------------------------
  const searchR = halfW * 1.6;
  let settlement = null, sBest = Infinity;
  for (const s of WORLD.settlements) {
    const d = (s.x - origin.x) * (s.x - origin.x) + (s.y - origin.y) * (s.y - origin.y);
    if (d < searchR * searchR && d < sBest) { sBest = d; settlement = s; }
  }
  let camp = null, cBest = Infinity;
  for (const c of WORLD.camps) {
    const st = world.save.camps.find(s => s.id === c.id);
    if (st && st.razed) continue;
    const d = (c.x - origin.x) * (c.x - origin.x) + (c.y - origin.y) * (c.y - origin.y);
    if (d < searchR * searchR && d < cBest) { cBest = d; camp = c; }
  }
  let settlementOut = null;
  if (settlement) {
    const f = toField(settlement.x, settlement.y);
    if (!fullyOutside(f.x, f.y, 0, fieldW, fieldH)) settlementOut = { x: f.x, y: f.y, kind: settlement.kind };
  }
  let campOut = null;
  if (camp) {
    const f = toField(camp.x, camp.y);
    if (!fullyOutside(f.x, f.y, 0, fieldW, fieldH)) campOut = { x: f.x, y: f.y };
  }

  // ---- Clip (step 8): drop anything that falls fully outside the padded field box ---------
  const clip = list => list.filter(o => !fullyOutside(o.x, o.y, o.r, fieldW, fieldH));

  return {
    scale: S,
    origin: { x: origin.x, y: origin.y },
    approach: approachOut,
    heroField: toField(heroX, heroY),
    rivers,
    crossings,
    roads,
    woods: clip(woods),
    hills: clip(hills),
    rocks: clip(rocks),
    scrub: clip(scrub),
    settlement: settlementOut,
    camp: campOut,
    onRoad: world.onRoad(heroX, heroY),
  };
}
