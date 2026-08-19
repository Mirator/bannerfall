# Plan 020: Make encounters uneven, and make avoiding them cost something

**Status:** DONE

**Note on the blocked marker:** this plan was briefly marked BLOCKED on the argument that
uneven encounters are unfair before the player has real in-battle grip (Plan 019 shipped as
optional depth, and battles still largely resolve themselves). The repository owner reviewed
that argument and directed that the plan proceed. The design-opinion stop condition below
("If Plan 019 is not DONE, stop") is therefore satisfied and retired. **The deadlock stop
condition remains fully active** — it is a correctness risk, not a design preference.
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

- [x] The 0.7–1.2× guarantee is gone; a pinned-seed run produces parties in all three tiers, including at least one above 1.5×. (`world_party_spawn_tiers_weighted_toward_strong`, swept over 5 seeds x 200 draws each, per the Plan 019 lesson against single-seed balance claims.)
- [x] An ignored chasing party reaches a settlement and suspends its service; defeating it there restores the service, and both transitions survive a refresh. (`world_party_break_off_occupies_settlement_and_recapture_restores_service`; refresh survival covered by the version-3 save-schema round-trip test with an `occupying` party.)
- [x] A version-2 save loads, migrates to version 3 with all settlements unoccupied, and is immediately safe for world construction; malformed occupation data is rejected. (`tests/e2e/save-schema.spec.js`: "version-2 save migrates to version 3..." and the malformed-settlement-entry cases.)
- [x] Pursuit speeds, hero speed, and all unit/enemy stats are byte-for-byte unchanged. (`git diff src/data.js` is additive-only; the 185/165/195/105/80 party speeds and the 240/276 hero speed in `updateHeroMovement` are untouched — verified by diff inspection during implementation.)
- [x] A player can always identify an outmatched party before contact and always has a route back to a working settlement. (Badge-level `⚠` marker at any visible distance, not just the close-range odds pill; occupied/threatened settlement markers; the floor guarantee keeps at least one settlement unclaimed.)
- [x] No new RNG stream, no performance-budget change, no battle-scene change, no runtime dependency. (All new draws go through the existing `simRng`; `src/battle.js` diff is version-token only; `npm run test:perf` stayed green with no budget edits.)

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

## Implementation findings

Recorded during execution; each is a decision the plan left open or a fact discovered while
building it.

1. **Tier weighting formula.** The plan names the three bands (weak 0.45-0.7, even 0.8-1.2,
   strong 1.5-2.2) but not how their weights shift. Chosen: `weak = 0.40 - 0.30*t`,
   `even = 0.35` (constant), `strong` = the remainder, where `t = razed/3`. At a fresh camp
   (`t=0`) that is weak 40% / even 35% / strong 25%; once all three raidable camps are razed
   (`t=1`) it is weak 10% / even 35% / strong 55%. This is a straight-line interpolation, not
   a tuned curve — a natural target for balance follow-up once there is real playtest data.
2. **Break-off threshold, travel speed, and arrival radius are new tuning constants, not
   specified by the plan.** `BALANCE.raidBreakOffT = 20` (seconds of sustained, uncaught
   `chase` mood before giving up on the hero), `BALANCE.raidSpeed = 150` (deliberately
   between the wander speed and the pursuit speeds — it is not a pursuit speed and does not
   need to match one), and `BALANCE.raidArrivalR = 140`. None of these touch the
   design-decision-2 pursuit speeds (105/165/185/195) or hero speed (240/276), which are
   unchanged.
3. **The floor guarantee is two independent mechanisms, not one.** (a) `isSettlementClaimed()`
   refuses a break-off unless at least 2 settlements are currently fully unclaimed (unoccupied
   AND not already the target of another party's break-off), so a claim always leaves at
   least one behind — this is a hard structural invariant, not a probability. (b)
   `enforceBeatableFloor()` runs every world tick and downgrades the single weakest live party
   (including one that is occupying a settlement) to an even-tier composition whenever
   *nothing* on the map sits at or under `BALANCE.beatablePartyRatio = 1.2x` the player's
   strength. It is an emergency correction, not a routine crutch like the deleted fair-band
   guarantee — in ordinary play the weighted tiers alone keep something beatable on the map
   almost all the time.
4. **The floor's beatable ratio (1.2x) is a design call the plan didn't make.** It matches the
   top of the `even` tier, so "beatable" and "fair fight" mean the same number. A stricter
   floor (e.g. 1.0x) was considered and rejected as too generous — it would make the floor
   fire constantly instead of only at genuine risk of deadlock.
5. **A full-wipe edge case on retreat/defeat needed an explicit fix.** If a battle against an
   occupying party ends in `retreat` or `defeat` but every enemy type happens to have died
   anyway (a pre-existing edge case in `restoreRoamingParty`, not new to this plan), the party
   is not reinserted — but without an explicit check, the settlement's `occupied` flag would
   stay stuck true with no occupier left to fight. Fixed by clearing occupation in that branch
   too, not only on a formal `victory`.
6. **Visual baselines needed no update.** `spawnParty()`'s changed RNG consumption does shift
   which parties spawn in the pinned world-overview/world-bridge seeds, but the resulting
   pixel differences stayed under the suite's existing `maxDiffPixelRatio: 0.015` tolerance —
   both visual tests passed against the pre-existing baselines with no diff artifacts
   generated. Per `tests/README.md`, a passing comparison needs no review; nothing was updated
   to conceal drift.
7. **The STOP-condition deadlock test drives the worst case directly, not through gameplay.**
   `world_floor_guarantee_prevents_unwinnable_deadlock` manually constructs three occupied
   settlements plus an overwhelming roaming party (all parties above the beatable ratio), then
   asserts `enforceBeatableFloor()` produces a winnable target and that a fourth break-off
   attempt at the last free settlement is refused. This matches the plan's instruction to
   cover the deadlock risk with a test that drives the worst case rather than the happy path.
8. **The break-off/occupation QA record uses one controlled tick, not simulated real time.**
   Letting a party naturally chase for `raidBreakOffT` (20s) risks the party actually catching
   a stationary hero first (185 px/s x 20s covers most of the map), which would start a battle
   instead of exercising the break-off path — a flaky fixture. Instead the fixture pre-arms
   `chaseHoldT` at the threshold and calls `scene.updateParties(1/60)` directly once, the same
   "one controlled tick" pattern already used by `tests/e2e/world-battle-seams.spec.js`.
9. **No STOP condition was hit.** Plan 019 was DONE (as optional depth) before this plan
   started, and the design-opinion STOP tied to that was already retired by the repository
   owner per the note at the top of this plan. The sanctuary-exemption STOP (design decision
   5) was not triggered — the exemption is a single boolean (`isOccupier`) added to the
   existing `canClash` check, with no weakening of the safe zone for ordinary parties.
