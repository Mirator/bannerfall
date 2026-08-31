# 034 — Terrain legibility, and a crossing you can only cross where it is drawn

## Problem

Two of the combat-rehaul complaints (2026-08-31 assessment) are about the same
gap: the battlefield's terrain is gameplay-real but not drawn.

- The river's collision wall opens a hole of radius `c.w` around each crossing
  (`buildRiverChain`'s skip test), so a bridge passes ~440 units of open water
  along the river while the drawn deck is 96 units wide along the tangent — a
  warband wades beside the bridge, in the water, and nothing stops it
  (screenshot-reproduced). A ford is worse: a 520-unit hole against a 44-unit
  drawn patch.
- A wood's slow zone and LOS blocker (radius up to ~300) render as 4-8
  scattered trees; a hill's collider is a disc of radius r while its silhouette
  is a strip whose ground contact is one horizontal band; scrub's zone edge is
  invisible. The player cannot see where the effects the game applies begin.

## Change

1. **The passable window at a crossing is the drawn crossing.** The chain's
   skip radius is untouched (it exists so the big r~88 circles never leave a
   survivor footprint inside the crossing — a measured stall boundary), and the
   opened shoulders are plugged instead with small (r 26) circles covering the
   channel beyond the crossing's own opening: `openHalf` 70 for a bridge, 90
   for a ford. The drawn deck widens from 96 to 140 along the tangent and the
   ford's pale patch from 44 to 180, so the visual and the passable window are
   the same thing. Plugs are `kind: 'none'` obstacles on the same terms as the
   chain, placed from the crossing's tangent (`riverTangentAt`), no RNG.
2. **Zone footprints are drawn.** A wood pushes a `woodFloor` prop first — a
   translucent tree-shade disc at the zone's full radius with a dashed rim —
   under its trees; scrub pushes a fainter disc at its zone radius; a hill
   draws a ground-contact disc at its collider radius under the silhouette, so
   the circle units path around is the circle the player sees. All three are
   static props baked into the tile layer once per battle — zero per-frame
   cost, and the deployment screen shows them for free.

## Out of scope, recorded

Terrain combat effects (arrow cover behind blockers, high ground, woods
breaking charges) are a separate measured slice. The legacy `battle_bridge`
template arena keeps its fixed wall (ambush baseline, frozen; its gap-vs-deck
slop is 20 units, not 170). The world map's river/bridge collision is
segment-based and separate.

## Measurement

- The crossing plugs narrow a measured pathability window (`BRIDGE_W`/`FORD_W`
  were widened by Plan 024 because narrower openings stalled fights), so the
  river fixtures in `battlefield-terrain.spec.js` and the balance sweep are the
  gate: recorded after implementation.
- Baselines: the brief-derived battle scenes change by design (zone floors,
  hill footprints, wider deck/ford); recaptured in the CI-equivalent container,
  the PR gate adjudicating, per the Plan 033 provenance rule.

## Measurements

The plugs re-crossed Plan 024's pathability boundary twice before landing, and
both failures were caught by the balance sweep rather than the fixtures:

- First version (fixed ±96 plug rows against a ±88 channel): 34 units of BANK
  walled on each side of every crossing, right where crossingWaypoint funnels
  both armies. Sweep collapsed to idle 20 / chargeAll 32 / split 6, fights
  grinding past their windows.
- Second version (plugs confined to the channel via channelAt): idle 28 /
  chargeAll 58 / split 7 — charging recovered, waiting did not. The residual
  jam was crossingWaypoint's "already at the crossing" radius (c.w = 220): a
  unit released from its waypoint inside that disc steered a straight line into
  the plug wall that now occupies it. The radius is the crossing's own OPENING
  now.
- Shipped: sweep idle 52 / chargeAll 58 / split 38 — within a point of the
  pre-034 baseline (51/59/38) on every column, with the water beside every
  crossing walled. The structural coverage test samples the shoulder band
  against the real channel (channelAt) and the opening for blockage, on both
  the bridge and the ford fixtures.
