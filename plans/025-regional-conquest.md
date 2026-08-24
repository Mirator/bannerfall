# Bannerfall — Milestone 025: The First Region

## Summary

Turn the existing campaign into one complete regional conquest loop.

The player should be able to enter a region, scout its settlements, defeat or
avoid roaming parties, capture and develop territory, weaken the regional
stronghold, and win a distinctive final battle. The milestone should deepen
the decisions already present in Bannerfall without adding a large management
layer or changing its minimalist real-time identity.

This is a vertical slice of the intended larger game. It should prove that
territory, settlement choices, and varied battle objectives create a campaign
worth replaying before more regions, factions, heroes, or unit types are added.

## Player promise

> Build a small kingdom one settlement at a time, use the terrain to win
> different kinds of battles, and break the stronghold controlling the region.

## Success criteria

The milestone is successful when:

- a fresh campaign forms a coherent 45–90 minute regional conquest;
- every settlement matters after it is captured;
- the player makes at least two meaningful strategic choices before attacking
  the stronghold;
- battles include goals other than eliminating every enemy;
- control of the region can visibly shift between the player and the enemy;
- the stronghold feels mechanically different from an ordinary camp;
- the complete loop is deterministic, saveable, testable, and performant under
  the existing project constraints.

## Core campaign loop

1. Explore the region and identify settlements, enemy parties, and the
   stronghold.
2. Recruit an initial army and choose which settlement to contest first.
3. Win a field or objective battle to remove its occupier.
4. Claim the settlement and select one specialization.
5. Use the settlement benefit to expand, recover, or reveal the map.
6. Defend owned territory while targeting the next source of stronghold power.
7. Remove enough regional control to unlock a viable stronghold assault.
8. Win the stronghold battle and complete the region.

## In scope

### 1. Regional state and territory ownership

The campaign map represents one named region containing:

- 4–6 settlements;
- 2–3 ordinary enemy camps;
- 1 regional stronghold;
- roads, rivers, bridges, woods, and hills generated through the existing
  terrain pipeline;
- roaming parties produced by camps and the stronghold.

Every settlement has an explicit state:

- `neutral` — available for peaceful interaction;
- `player` — captured and providing its selected benefit;
- `occupied` — controlled by an enemy party and unavailable to the player.

Existing occupation behavior remains, but ownership becomes persistent and
visible. A hostile party can occupy a player settlement after reaching it and
winning the associated defense. Reclaiming it requires another battle.

Ownership must be readable directly from the map through restrained visual
language such as banner color, settlement accent, and one compact status icon.
Do not depend on text labels alone.

### 2. Settlement capture

A settlement becomes player-owned after the player defeats its occupying force
or completes its capture battle. Neutral settlements may join without combat
if no hostile force controls them.

Capturing a settlement must:

- update regional ownership immediately;
- create an explicit persistence checkpoint;
- open a one-time specialization choice;
- provide a safe interaction point unless it is later occupied;
- contribute to weakening the stronghold.

Settlements are not independently simulated cities. Population, construction
timers, taxation sliders, loyalty, and civilian agents are not part of this
milestone.

### 3. Settlement specializations

Each captured settlement can hold exactly one specialization. The choice is
permanent for the current campaign.

Implement four specializations:

| Specialization | Campaign effect | Player value |
| --- | --- | --- |
| Barracks | Improves local recruitment and offers spearmen | Rebuilds a durable army |
| Archery range | Offers archers and improves their local recruitment | Enables ranged army composition |
| Market | Provides a one-time capture payment and reduces local service prices | Accelerates economy |
| Watchtower | Reveals nearby camps, parties, and threatened settlements | Improves map control |

Specializations should reuse existing recruit, heal, gold, visibility, and army
cap systems wherever possible. They must create different strategic routes,
not a separate building simulation.

The selection UI must show:

- the mechanical effect;
- what is gained immediately;
- what remains available on later visits;
- that the decision is permanent for the run.

### 4. Stronghold power

The stronghold begins at full regional power. Its power is reduced by capturing
settlements and razing its linked ordinary camps.

Use a small discrete scale rather than a continuous percentage. For example:

- **Entrenched:** full garrison and all defensive advantages;
- **Weakened:** reduced reinforcements or defenses;
- **Exposed:** minimum viable final-battle configuration.

The player may attack at any stage after discovering the stronghold. An early
attack should be possible but clearly dangerous; weakening it should change the
actual battle rather than only reducing a displayed number.

The pre-battle brief must explain which stronghold advantages are still active
and how the player's campaign actions changed them.

### 5. Objective battles

Add three reusable battle objectives. Each uses the existing battlefield Brief,
terrain, squads, projectiles, and resolution pipeline.

#### Elimination

The existing default: defeat the opposing force. Retain it for roaming-party
and ordinary camp encounters.

#### Hold the ground

The player must keep at least one combat-capable squad inside a marked area
until a fixed objective timer completes.

- Enemies prioritize contesting the area.
- The timer pauses while the area is contested.
- Killing every enemy remains a valid victory.
- The objective location must be selected from traversable terrain and avoid
  blockers.

Use for settlement captures or defenses.

#### Break the position

The player must destroy or capture 2–3 fixed defensive objectives while enemy
forces resist.

- Objectives must have explicit health or capture progress.
- Destroying all objectives wins even if enemies survive.
- Eliminating every enemy also wins, preventing artificial cleanup.
- Objective placement must respect navigation and line-of-sight geometry.

Use for camps and the stronghold.

All battle outcomes must pass through `resolveBattleResult()` as the single
terminal decision point. Objective code must not create a parallel result or
persistence path.

### 6. Regional stronghold battle

The stronghold battle is the milestone finale. It uses `Break the position`
with a fixed authored encounter structure assembled on top of generated terrain.

Required characteristics:

- 3 defensive objectives;
- at least one terrain-constrained approach such as a ford, bridge, wooded
  flank, or narrow road;
- an enemy reinforcement wave while the stronghold remains Entrenched or
  Weakened;
- campaign actions that remove or reduce specific defenses;
- a distinct pre-battle brief and post-battle aftermath;
- immediate campaign completion after victory.

Example power mapping:

| Campaign achievement | Stronghold change |
| --- | --- |
| Capture two settlements | Remove one reinforcement wave |
| Raze one linked camp | Remove one defensive objective guard |
| Capture a watchtower settlement | Reveal enemy deployment in the brief |
| Reach Exposed state | Reduce the starting garrison to the beatable floor |

Exact values belong in tuning data, not scattered conditionals.

### 7. Regional pressure

Enemy activity must make ownership consequential without turning the game into
constant firefighting.

- The stronghold periodically dispatches a raiding party toward a player-owned
  settlement.
- Only one regional raid may be active at a time.
- A visible warning identifies the target.
- Time advances only while the hero rides, preserving the existing freeze
  invariant.
- Reaching the target triggers a settlement-defense encounter or occupation.
- An occupied settlement stops providing its specialization benefit.
- The raid cadence must include a grace period after capture and after a
  successful defense.

The player must be able to choose between intercepting the raid, defending at
the settlement, or accepting temporary loss of the territory.

### 8. Campaign completion and summary

Victory over the stronghold ends the regional campaign and opens a summary
showing:

- elapsed active campaign time;
- battles won and lost;
- settlements captured and currently held;
- camps razed;
- soldiers lost;
- gold earned and spent;
- final army composition;
- selected settlement specializations.

The player can start a new campaign with a new seed from this screen. Permanent
meta-progression is out of scope.

## UX requirements

- Territory status, raid warnings, and stronghold power must be understandable
  without opening a separate management screen.
- New information should extend the current map HUD and existing interaction
  modals rather than introduce a dashboard.
- Objective battles require a compact objective panel with current progress.
- The pre-battle brief must state the objective, deployment context, expected
  enemy composition, and consequences of withdrawal.
- Every permanent choice must be confirmed and described before commitment.
- Keyboard and future controller input must use named actions only.

## Data and architecture

### Data-driven definitions

Add declarative definitions for:

- regional configuration;
- settlement specialization effects;
- camp-to-stronghold links;
- stronghold power thresholds and modifiers;
- battle objective configuration;
- raid cadence and grace tuning.

Game logic should consume these definitions without importing presentation
state. Balance values must remain centralized and test-addressable.

### Persistence

Advance the save schema from v3 to v4. Persist at minimum:

- settlement ownership;
- selected settlement specialization;
- active or pending raid state;
- linked camp state;
- stronghold power state or its deterministic inputs;
- regional completion state;
- campaign summary counters.

Provide deterministic v3 → v4 migration. Existing v3 campaigns must load into
a valid region with conservative defaults and no immediately unavoidable raid.
Malformed regional state must fail validation before simulation.

Mid-battle saves remain unsupported.

### Determinism and simulation boundaries

- Regional AI and objective outcomes use `simRng` or a derived gameplay stream.
- Visual markers, particles, and celebration effects use `fxRng`.
- Standing still freezes raids, objective-independent world timers, spawns, and
  grace periods.
- Objective simulation never reads camera, HUD, animation, or render state.
- Terrain geometry continues to come from `World.buildTerrainGeometry()`.

## Acceptance criteria

### Campaign

- A seeded fresh run always contains the configured number of settlements,
  camps, and exactly one stronghold.
- Every settlement can transition through neutral, player-owned, occupied, and
  reclaimed states without losing specialization data.
- Each specialization applies exactly its documented benefit and stops applying
  while its settlement is occupied.
- Stronghold power changes deterministically from captured settlements and
  razed linked camps.
- At least one winnable route to an Exposed stronghold exists for every
  supported seed.
- Victory produces a correct campaign summary and does not continue world
  simulation behind it.

### Battles

- All three objective types can be entered through a serializable Brief.
- Hold objectives pause while contested and resolve correctly on timeout,
  elimination, defeat, and withdrawal.
- Break objectives resolve correctly when objectives are destroyed, enemies are
  eliminated, the player is defeated, or the player withdraws.
- Objective placement never overlaps impassable terrain or creates unreachable
  targets in the supported deterministic corpus.
- The stronghold battle materially differs across at least three power states.
- Every terminal outcome is produced exactly once through
  `resolveBattleResult()`.

### Persistence

- v3 saves migrate deterministically to valid v4 saves.
- All regional state survives reload from every explicit campaign checkpoint.
- A reload cannot duplicate rewards, specialization choices, raids, battle
  results, or campaign completion.
- Real and test save slots remain isolated.

### Performance and presentation

- Existing structural Canvas budgets remain unchanged.
- Added map markers and objective elements remain within current draw and
  scheduler budgets.
- No new page exceptions or console errors occur in the full campaign.
- Visual regression coverage includes all ownership states, each objective HUD,
  every stronghold power state, and the campaign summary.

## Required QA coverage

Add focused deterministic coverage for:

- regional generation and beatable-route guarantees;
- settlement capture, occupation, reclaim, and specialization effects;
- raid targeting, grace periods, interception, and time freeze;
- stronghold power calculation and modifier application;
- objective placement and each terminal battle path;
- v3 → v4 migration, malformed v4 rejection, and reload idempotency;
- stronghold victory and campaign summary counters;
- named-action input paths;
- performance budgets and visual baselines.

Before completion, run:

```text
npm run release:cache
npm run test:release
npm test
```

Any changed persisted field additionally owes the focused save-schema and
campaign-persistence suites. Any production visual change owes the visual
regression suite.

## Delivery slices

### Slice A — Regional model

- Add data-driven region configuration.
- Introduce ownership and stronghold power calculation.
- Migrate saves to v4.
- Render ownership and power state on the campaign map.

### Slice B — Settlement choices

- Implement capture flow and specialization modal.
- Add the four specialization effects.
- Verify occupation disables benefits and reclaim restores them.

### Slice C — Objective framework

- Generalize battle victory conditions behind one objective interface.
- Implement Elimination, Hold the ground, and Break the position.
- Preserve `resolveBattleResult()` as the only terminal path.

### Slice D — Pressure and defense

- Add stronghold raids, warnings, grace periods, and settlement defense.
- Integrate time-freeze behavior and persistence.

### Slice E — Stronghold finale

- Build the regional stronghold encounter.
- Connect campaign achievements to battle modifiers.
- Add aftermath, completion summary, and restart flow.

### Slice F — Balance and release

- Tune the complete seeded campaign corpus.
- Confirm a 45–90 minute target duration.
- Complete deterministic, persistence, performance, and visual gates.

Each slice must leave the game shippable and pass the full required gate before
the next begins.

## Explicitly out of scope

- multiple regions or a world-conquest layer;
- diplomacy, treaties, faction reputation, or political simulation;
- named companions or companion progression;
- direct hero combat and active hero abilities;
- additional player unit types;
- morale, food, supply chains, or inventory management;
- procedural quests or narrative event chains;
- permanent unlocks, achievements, or New Game+;
- multiplayer, accounts, or backend services;
- mid-battle save and resume;
- Steam packaging or platform APIs;
- a build step, framework, bundler, or runtime dependency.

## Follow-up milestone candidates

After this milestone is validated, choose only one major expansion direction
based on playtest evidence:

1. **Command depth:** move anchors, facing, formations, and target priorities.
2. **Army identity:** additional recruitment constraints and faction-specific
   rosters.
3. **Character layer:** companions, hero abilities, wounds, and squad leaders.
4. **Campaign breadth:** multiple regions, distinct factions, and longer runs.

Do not begin these systems during Milestone 025 unless they are strictly needed
to complete or validate the regional conquest loop.
