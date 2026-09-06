# Plan 049 — read the field

- Status: **IMPLEMENTED**, with two items of the source plan deliberately not built (§7).
- Scope: `battle/{constants,terrain,ai-phases,render-scene,hud,enemy-command}.js`,
  `battle.js`, `world/battle-transition.js`, a new `src/tutorial.js`, a new
  `tests/e2e/clarity.spec.js`. Nine battle baselines re-recorded, three HUD copy
  expectations updated. No assertion weakened, no budget raised, no test skipped.
- Trigger: a written comparison against Thronefall, supplied as
  `visual_clarity_gameplay_readability_plan.md`, asking for six things: less decorative
  noise, terrain that creates decisions, roughly half the permanent UI, sequential command
  teaching, contrast around the current action, and feedback on the core interactions.

The goal was never to look like the reference. It was to adopt the same rules: a strong
visual hierarchy, low cognitive load, terrain that makes placement matter, and an interface
that gets out of the way.

## 1. Decoration (source plan §1)

Every battlefield prop is now one of three things, and only the third is negotiable:

| tier | kinds | treatment |
| --- | --- | --- |
| gameplay-critical | hill, hillFoot, woodFloor, scrub, river, road, bridgeSpan, ford, house, tent, mill, stake | untouched, full contrast |
| supporting | boulder, log, stump, crops, reeds, plank, stone | thinned, dimmed, cleared from tactical ground |
| pure decoration | tuft, pebbles, bones | thinned hardest, dimmed hardest, cleared |

`SCATTER` in `battle/constants.js` holds every area-per-prop divisor, so density still scales
with the field and every number is in one place. The families above are 37-46% thinner than
the Plan 024 detail pass; ground blotches went with them, fewer and larger, since Plan 048's
baked soil texture now carries the fine variation they used to supply.

`CLEAN_R` and `clearTacticalGround()` then strip the removable tiers from the ground the
player deploys on, fights over and decides at: both lines, the point where they meet, the
objective, and every crossing. That runs after `buildObjectiveState`, because it needs the
objective, which needs the final obstacle field.

Contrast is the other half. `DECOR_ALPHA` draws decoration at 0.45-0.8 — it is baked into the
static prop layer, so the dimming costs nothing per frame. Terrain is absent from that table
on purpose: it is Level 3 and reads at full strength.

## 2. Terrain (source plan §2)

Three rules, each one sentence long:

- **High ground.** A bow on a hill's slope shoots 20% further. The hill's disc is a hard
  collider — nobody stands on it — so the zone is the ring around it out to `HIGH_GROUND_R`,
  which is the ground a player actually puts a bow line on. It is drawn: a pale apron under
  the collider footprint, because a rule the player cannot see is not a decision.
- **Cover.** Ranged damage taken under the trees is ×0.75, sampled where the shaft lands, so
  cover is a property of the ground the TARGET stands on.
- **Horses in trees.** A mounted man takes an extra ×0.82 on wood ground.

Both sides obey all three: an enemy bow on a slope shoots as far as yours. A rule only one
army obeys is not terrain, it is a handicap.

Overlapping zones take the STRONGEST value rather than the product. Two hills whose slopes
touch are one piece of high ground, not twice as high — the product gave a bow standing
between a pair of knolls +44% range, which is a map-generation accident and not a decision.

Cost: `terrainRangeMulAt` is sampled once per ranged unit per tick and reused by every range
comparison in that unit's iteration; `terrainCoverAt` only where a shaft lands.

**The balance sweep moved by at most two points** — idle 0, chargeAll +1, split +2, holdLine
−1 against the Plan 045 baseline, all inside the recorded tolerance for 120 runs a policy. So
the rules change what a POSITION is worth without moving what an ORDER is worth, which is the
result this plan wanted and not one it can claim to have aimed at.

## 3. The permanent HUD (source plan §3)

The bottom panel used to print a stance word and a consequence note on every row, plus
`TAB pick squad · 1 follow 2 charge 3 hold` underneath — the same three commands the
deployment banner was already spelling out, on every frame of every fight. What is permanent
now is what the player needs continuously:

```
SPEARS ×4
BOWS ×2
```

A stance appears for the squad the number keys reach, and for any squad whose order is still
fresh (`orderT`, 2.6 s) — which is exactly when it is news. The panel is 250×~90 where it was
360×~130, at 0.82 alpha instead of solid; the warband plate shrank with it.

The minimap is now conditional. A field that already fits on screen was getting a second copy
of the same picture; brief-derived fields are 2500×1760 against a 1280×720 viewport and keep
theirs. The gate compares the FIELD against the viewport at unit zoom, never against the live
zoom, so a fit-to-action camera cannot make it flicker mid-fight.

## 4. Onboarding (source plan §4)

`src/tutorial.js` derives the lesson from `save.battleCount`, which the campaign already
increments once per fight. **No save schema change, and none is needed** — the same rule perk
points follow, and for the same reason: a second stored counter is one that can drift.

| battle | offered | taught |
| --- | --- | --- |
| 1 | nothing | place a man, sound the advance |
| 2 | follow | follow |
| 3 | follow, charge | charge |
| 4 | all three | hold |
| 5+ | all three | — |

The deployment banner says one thing at a time and retires each one the moment the player
does it: the drag, then this battle's new command, then the advance. The lesson follows the
player into the fight once, as a small chip, and leaves when the command is used.

**The gate is on the keys, not on `issueCommand`.** That distinction is load-bearing. The AI,
the balance sweep and the legacy QA runner all drive `issueCommand` directly; a battle that
silently refused their orders would change what those measure rather than what a new player
is taught. Building it the other way round is what turned the camp-raid deadlock fixture red
— it drives a campaign fight and issues a held line, and battle 1 had refused it.

A fight built without a lesson unlocks everything, which is every scenario fixture.

## 5. Contrast around the action (source plan §5)

`drawFocus()` draws the top two levels of the hierarchy on the ground, under every actor, and
each cue costs nothing in the state it does not belong to:

- **placing** — the ground steps back under one translucent rect while a body is dragged, so
  the line being built is the brightest thing on screen. Units draw after it and keep full
  contrast. The drag ring turns red on ground no body can stand on, which the deploy phase
  had already computed and was keeping to itself.
- **selected** — a ring under every man of the picked squad. The HUD row says which squad the
  keys reach; this says which men that is.
- **alerted** — a ring under every enemy while the other side's commander commits, from
  `enemyAlertT`, published by the commander and decayed in the tick pipeline.

## 6. Feedback (source plan §6)

- **Placement** was the most repeated interaction in the game and produced nothing at all —
  the body simply stopped following the cursor. It now gets dust, a ring at the boots and a
  short click.
- **The three orders no longer feel the same.** They shared one cream ring per body, which
  made CHARGE — the order the whole fight turns on — land as softly as re-issuing FOLLOW.
  Charge takes the widest ring, dust off the back foot and a shove of the camera; HOLD is
  tighter and in the colour the HUD already uses for a braced line; FOLLOW stays quiet.
- **Losing a squad** was indistinguishable from losing a man: the last body of a line fell
  with the same small effect as the first and the roster row just vanished. It now names the
  squad, sounds a low horn and shakes the camera, exactly once per squad.

No new audio: every cue is an existing CC0 clip, pitched. The network in this environment
cannot reach a sample library, and inventing a manifest entry for a file that does not exist
fails every spec that calls `collectRuntimeErrors`.

## 7. What was NOT built, and why

- **"Design 3-4 prototype maps around one tactical question each" (§2.7).** Bannerfall has no
  authored battle maps. Every battlefield is sampled from the campaign map around the hero
  (Plan 024's `sampleBattlefield`), which is the architecture, not an oversight. Authoring
  standalone maps would fork it. What this plan did instead is make the sampled terrain
  matter; whether the campaign map should be seeded with deliberate chokepoints and hills at
  the places the early campaign routes through is a level-design question and a separate
  slice.
- **"Build each tutorial battle around a situation where the new command is clearly useful"
  (§4.3).** Same reason: the early fights are whatever the campaign produces. The commands
  are introduced in order and taught in context, but the encounter is not authored around
  them.

Both are recorded here rather than quietly dropped, because both are the difference between
"the player is told about hold" and "the player needs hold".

## 8. Verification

`tests/e2e/clarity.spec.js` is new and asserts what neither existing suite can see — the
visual suite compares whole canvases at a tolerance that absorbs a scatter of small marks,
and it cannot press a key:

- decoration density stays under its area-derived budget, the field is still dressed, and no
  removable prop stands inside a clean zone;
- the three terrain rules, on the generated map AND on a synthetic field that pins their
  exact factors (a generated field can overlap two woods, and the speed clamp would hide the
  single-zone number);
- the lesson ladder, including monotonicity and the no-lesson default;
- and the gate itself: the key is inert for an untaught command while `issueCommand` still
  obeys.

Gate: `npm test` 278 passed, `npm run test:balance` 4 passed, tooling 23 passed, release
cache verified. Nine battle baselines re-recorded; the world baselines are untouched, because
none of this reaches the campaign map.
