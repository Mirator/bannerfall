# Plan 020: Make encounters uneven, and make avoiding them cost something

**Status:** READY
**Priority:** P0 (gameplay audit, phase 4 — "the game plays itself")
**Effort:** L
**Risk:** High (save-schema version bump plus campaign balance)
**Audit finding:** `critiques/phase4/gameplay-audit.md` Finding 4; `critiques/phase4/self-playing-fix-options.md` Option 2
**Depends on:** Plan 019 (squads and non-dominated stances must land first)
**Planned at:** `2050497`

## Objective

Stop generating the player a guaranteed-winnable fight, and give avoidance a price — so deciding *whether* to fight becomes the campaign's main decision.

Two measured facts drive this. First, `src/world.js:900-925` explicitly guarantees a roaming party in the **0.7–1.2× strength band** whenever none exists, and camp tiers are 0.7 / 0.9 / 1.1: the player is never offered a fight the numbers say they lose. Second, the hero moves at 240 px/s (276 on road) while pursuit tops out at 185 (213 on road) — **every fight on the map is escapable for free.** A fight you cannot lose and a fight you can always skip are the same non-decision.

## Design decisions

These are settled; an executor changing one needs a new review.

1. **Delete the fair-band guarantee.** Replace the flat `0.6 + R() * 0.9` band in `spawnParty()` with a weighted tier draw: weak `0.45–0.7`, even `0.8–1.2`, strong `1.5–2.2`. Weights shift toward the strong tier as camps fall, so the curve rises across a run instead of tracking the player forever.
2. **Pursuit speed does not change.** Buffing chase speed to hero speed is rubber-banding and reads as the game cheating. The hero keeps his escape. What changes is what escaping *costs*.
3. **An ignored party raids.** A party that holds `chase` mood without catching the hero for a sustained window breaks off and moves on the nearest settlement. On arrival it occupies the settlement and **suspends that settlement's service** until the player defeats it there: Ashford's 12 g spears, Brindle's 20 g archers, Coldwell's free healing, Highmere's knights and army-cap expansion. Interception becomes a defensive decision instead of a gold faucet.
4. **Legibility is the fairness contract, not a polish item.** A 2× party is only fair if the player can read it before contact. Required in this slice: the existing strength badge gains an explicit outmatched marker at scouting range; a toast fires when a party breaks off to raid, naming the settlement; the threatened and occupied settlements carry map markers.
5. **A raiding party may enter a settlement's safe zone.** `BALANCE.settlementSafeR` (260) currently blocks clashes near settlements. An occupying raider must be attackable where it sits, so the sanctuary rule needs an explicit exemption for occupiers — the player must always have a way to take the settlement back.
6. **Save schema goes to version 3.** Settlement occupation is campaign state that must survive a refresh.

## In Scope

- Weighted party-strength tiers in `spawnParty()`; removal of the `fairExists` guarantee.
- Break-off-and-raid behavior in the party AI phase that already owns pursuit and encounter handoff.
- Settlement occupation state, its effect on recruiting/healing/expansion, and its recapture path.
- `SAVE_VERSION` 3: fresh-save defaults, validation, deterministic v0/v1/v2 migration (all settlements unoccupied), `syncLiveStateToSave()` coverage, and legacy/current/malformed fixtures.
- Occupation and outmatched markers on the world map, plus break-off and recapture toasts.
- A hard floor guarantee (see STOP conditions) preventing an unrecoverable campaign state.

## Out of Scope

- Camp garrison growth over time and world-map upkeep/economy (a later plan).
- Battle objectives or win-condition changes (Option 1; a separate plan).
- Any change to `HERO`, `UNIT_TYPES`, `ENEMY_TYPES`, costs, or the army cap.
- Any battle-scene change — Plan 019 owns those, and this plan must not touch them.
- Resumable battles or pending-encounter persistence.

## Files to Modify

- `src/world.js`
- `src/data.js` (tier bands, break-off timing, and per-settlement service flags)
- `src/save.js` (version 3, validation, migration)
- `tests/e2e/save-schema.spec.js`
- `tests/e2e/campaign-persistence.spec.js`
- `tests/qa_suite.js`
- `tests/e2e/visual-regression.spec.js` and its `world-*.png` baselines
- `tests/README.md`
- `AGENTS.md`
- `plans/020-uneven-encounters-with-a-price.md`
- `plans/README.md`

## Implementation Steps

1. **Land the save schema first, behavior-free.** Bump `SAVE_VERSION` to 3, add `save.settlements` with every settlement unoccupied, write the v0/v1/v2 migration, extend validation, add the three fixture classes, and carry live state through `syncLiveStateToSave()`. Run the save-schema and campaign-persistence specs green before any gameplay code changes. This keeps a schema bug from ever being confused with a balance bug.
2. **Replace the spawn band with weighted tiers** and delete the `fairExists` guarantee. Keep all draws on `simRng` through the existing world domain; do not add an RNG stream. Add a QA record asserting the tier distribution over a pinned seed, including that strong parties actually appear.
3. **Add break-off-and-raid** inside the party-AI phase that already owns pursuit and encounter handoff — do not add a second party update site. A party tracks how long it has held `chase` without clashing, then retargets the nearest settlement and occupies it on arrival.
4. **Apply occupation effects** in the settlement-interaction phase: an occupied settlement offers no recruiting, no healing, and no army-cap expansion, and says so. Add the sanctuary exemption from design decision 5 so the occupier is attackable in place, and clear occupation when the player wins there.
5. **Add the legibility layer** from design decision 4: outmatched marker at scouting range, break-off toast naming the settlement, occupied and threatened map markers.
6. **Implement the floor guarantee** so the campaign cannot deadlock (see STOP conditions), and cover it with a test that drives the worst case rather than asserting the happy path.
7. **Review the world baselines** (`world-overview.png`, `world-bridge.png`). Inspect actual/expected/diff PNGs; every changed pixel must be an intended marker.
8. **Document** the occupation lifecycle in `AGENTS.md` next to the existing roaming-party lifecycle rules, and the new records and fixtures in `tests/README.md`.
9. Run `npm run release:cache`, review the token-only import diff, then the full verification block. Mark DONE, commit, merge, push.

## Acceptance Criteria

- The 0.7–1.2× guarantee is gone; a pinned-seed run produces parties in all three tiers, including at least one above 1.5×.
- An ignored chasing party reaches a settlement and suspends its service; defeating it there restores the service, and both transitions survive a refresh.
- A version-2 save loads, migrates to version 3 with all settlements unoccupied, and is immediately safe for world construction; malformed occupation data is rejected.
- Pursuit speeds, hero speed, and all unit/enemy stats are byte-for-byte unchanged.
- A player can always identify an outmatched party before contact and always has a route back to a working settlement.
- No new RNG stream, no performance-budget change, no battle-scene change, no runtime dependency.

## STOP conditions

- **Deadlock is the fatal risk of this plan.** If a run can reach a state with every settlement occupied and no party the player can beat, stop and fix the floor before shipping: keep at least one settlement reachable and unoccupied, and keep at least one beatable party available. A campaign that can become unwinnable through no player error is worse than the AFK problem this fixes.
- If Plan 019 is not DONE, stop. Uneven fights without squad-level grip are unfair, not difficult — that ordering is the whole reason this plan is second.
- If the sanctuary exemption in design decision 5 cannot be made to work without letting ordinary parties clash inside settlements, stop and redesign the recapture path rather than weakening the safe zone.

## Verification

```powershell
npm run test:qa
npx playwright test tests/e2e/save-schema.spec.js
npx playwright test tests/e2e/campaign-persistence.spec.js
npm run test:visual
npm run test:perf
npm run test:release
npm test
git diff --check
```
