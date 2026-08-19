# Plan 021: Make the encounter legible — unit counts, hover details, and battle brief/aftermath screens

**Status:** IN PROGRESS

**Priority:** P1 (legibility follow-up to Plan 020's fairness contract)
**Effort:** L
**Risk:** Medium-High (no save-schema change, but it rewires the world→battle transition and touches 5 legacy QA record bodies plus the campaign-persistence fixture)
**Depends on:** Plan 020 (DONE)
**Planned at:** `594d01b`

## Context

Plan 020 deliberately made encounters uneven and named legibility as the *fairness contract*, not a
polish item: "a 2× party is only fair if the player can read it before contact." It shipped a
strength badge plus an outmatched glyph and called that sufficient. Three gaps remain, and the repo
owner raised all three:

1. **The badge number lies about size.** `enemyStrength()` (`src/data.js:129-131`) weights a brute as
   5 and everything else as 1, so a badge reading `14` is either fourteen bandits or six bodies
   (2 brutes + 4 bandits). The player cannot tell — and the scouting toast at `src/world.js:817`
   makes the confusion explicit by printing a strength scalar and calling it "bandits".
2. **There is no way to inspect anything.** The map has no mouse handling at all. Composition is
   invisible until the battlefield loads.
3. **The map→battle→map transition has no readable beats.** `World.startBattle()` switches scene
   synchronously; battle end shows a 2.6-second banner with one line of stats. The player never sees
   their force against the enemy's before committing, and never sees what a fight cost.

Intended outcome: size up a force from the map, inspect composition on hover, see both orders of
battle before committing, and read a real casualty account afterwards.

## Design decisions

Settled with the repo owner. An executor changing one needs a new review.

1. **Badges show bodies, not strength.** Party badge = `p.comp.length`; hero badge =
   `save.troops.length + 1`. Strength stays entirely internal — it still drives the odds pill, the
   `stronger`/`outmatched` colouring, every party-AI threshold, and `enforceBeatableFloor()`.
   **No strength formula, threshold, or balance constant changes.**
2. **A count-only badge would hide the thing that most decides fights, so the badge also carries a
   heavy-unit marker.** Three brutes read "3" beside nine bandits' "9" while being the harder fight.
   The badge gains a non-numeric marker (a dark ring or pip) when `comp` contains a brute. This keeps
   the "one number convention per token" rule (`src/world.js:1417-1418`) intact — a marker is not a
   second number — and it means a keyboard-only player who never hovers is not left blind.
3. **One unit of measure per surface, everywhere.** Badges are bodies; pills and proximity prompts
   are *words* (the odds judgement); hover shows both, explicitly labelled
   (`6 riders · fighting weight 14 · yours 9`). The camp proximity line
   (`src/world.js:1528-1529`) and the scouting toast (`:817`) are corrected in the same change —
   today they print strength and call it a headcount.
4. **Hover reveals composition and intent, and covers enemy parties, scouted camps, and the player's
   own warband.** Camps respect the existing house rule that what you scouted is what you fight
   (`src/world.js:553-554`): no composition until `st.garrison` exists. Hover on the warband states
   that the hero counts for three, so the "bodies" badge cannot mislead on an even fight.
   Settlements are out of scope — their proximity panel already covers them.
5. **The pre-battle brief appears on every map-initiated fight, and offers withdraw only when the
   player initiated it.** "Player initiated" is exactly two cases: an explicit `WORLD_PRIMARY` press
   on a camp or stronghold, and a party whose `mood === 'flee'` (you ran them down). An `AMBUSHED!`
   clash (`mood === 'chase'`) and a mutual `BANDIT SKIRMISH` are committed — otherwise this hands
   back the free escape that Plan 020's break-off-and-raid pressure exists to price. Making the
   *modal itself* conditional on mood was considered and rejected: `mood` is computed in the same
   tick as the clash (`src/world.js:940-953`), so which fights got a screen would be seed-dependent,
   turning deterministic fixtures into flaky ones.
6. **Withdrawing is charged, and never reveals unscouted composition.** On cancel the party gets
   `clashT = BALANCE.battleGrace` *and* `waryT = 25`, reusing the existing spooked-party mechanic
   (`src/world.js:939-948`) — it saw you flinch. For camps, the garrison roll moves from request time
   (`src/world.js:833`) to **confirm** time, and an unscouted force is shown as unknown in the brief.
   Otherwise riding to Wolfsjaw's gate and backing out would permanently reveal the final garrison
   for free, contradicting the house rule `rollGarrison()` documents.
7. **Both new screens are world-scene modals, not new scene names.** `sceneName` stays `'world'`.
   Forced by two existing contracts, not chosen for convenience:
   - AGENTS.md requires every world-to-battle transition to finish all map-side mutations and call
     `Game.persistRun()` **once while the scene is still `world`**. A cancellable brief must run
     before any of that, with the scene still `world`.
   - Legacy records and the persistence fixtures step past battle end and assert `scene() === 'world'`.
     An input-gated screen inside the `battle` scene would break every one of them.

   Accepted knowingly: the aftermath draws over a scrimmed map rather than the battlefield. In
   exchange it can report map consequences the battle scene has no access to (camp razed 2/3,
   settlement freed, carried to a village on defeat).
8. **`World.startBattle()` keeps committing immediately.** Legacy records call it directly and assert
   `g.scene() === 'battle'` on the next line (`tests/qa_suite.js:131-132, 162-163, 184-185`). The
   brief is reached only through a new `World.requestBattle()`.
9. **No new save fields, no schema bump, no new RNG stream, no morale or influence.** `parseSave`
   whitelists exactly one transient field — a *string* `toast` (`src/save.js:227-229`) — so the
   aftermath payload rides on `game.pendingAftermath` and is consumed in the `World` constructor next
   to the existing toast replay (`src/world.js:49`). A refresh mid-aftermath loses the screen, which
   is correct: the checkpoint is a map snapshot, not a battle.

## In Scope

**Slice A — map legibility** (land and gate green before starting B)
- Count badges plus the heavy-unit marker on parties and the hero; scouting toast and camp proximity
  line corrected to bodies with the odds word still derived from strength.
- A presentation-only hover system: latch, nearest-candidate hit test, screen-space panel, and
  content for parties, scouted camps, and the warband.

**Slice B — transition screens**
- `World.requestBattle()` + a named `updateWorldScreens()` phase; the brief with both orders of
  battle; a withdraw path that restores every deferred mutation.
- The aftermath modal: per-side casualties by unit type, loot, post-regen hero HP, and the map
  consequence consumed out of `save.toast`.
- `ACTIONS.WITHDRAW`, test-API surface, new specs, new baselines.

## Out of Scope

- Any change to `enemyStrength`/`playerStrength`, `UNIT_TYPES`, `ENEMY_TYPES`, `HERO`, `BALANCE`
  tuning, spawn tiers, or `enforceBeatableFloor()`.
- Resumable battles or persisting a pending encounter or an aftermath payload.
- Setting squad stances from the brief — Plan 019 owns stances, and the intro/deploy windows already
  accept orders.
- Settlement hover, a minimap, any battle-scene mechanic change.

## Files to Modify

- `src/world.js` — badges, hover state, `requestBattle()`/commit split, `updateWorldScreens()` phase,
  aftermath consumption in the constructor.
- `src/world-screens.js` **(new)** — pure functions and plain-data models only:
  `hoverTargetAt(world, wx, wy)`, `buildBriefModel()`, `buildAftermathModel()`, and the three
  `draw*Panel(ctx, cam, model)` functions. No phase ownership, no simulation state — the same shape
  as `engine.js`'s `rrect`/`tree`/`mountain` helpers, which already live outside the scenes. The
  phase and the state (`this.screen`, `this.pending`, `this.hoverTarget`) stay in `world.js` because
  AGENTS.md makes `World.update()` the owner of the ordered pipeline.
- `src/input-actions.js` — add `ACTIONS.WITHDRAW` (`['KeyX']`). Gameplay must not read raw key codes.
- `src/main.js` — `state()` additions; new `scenario()` entries; gate `stats.playT` accrual while a
  world modal is open.
- `src/battle.js` — one small change only: for `setup.brief` battles, drop the intro banner's now
  thrice-stated `N vs M` line and shorten the intro to ~0.6 s. Keyed off `setup.brief` so the three
  battle baselines and `scenario('battle_*')` are untouched.
- `tests/qa_suite.js` — 5 record bodies (see below).
- `tests/e2e/campaign-persistence.spec.js` — `installUniqueParty` only.
- `tests/e2e/world-screens.spec.js`, `tests/e2e/world-hover.spec.js` **(new)**.
- `tests/e2e/world-battle-seams.spec.js`, `tests/e2e/performance.spec.js`,
  `tests/e2e/input-actions.spec.js` — extended.
- `tests/e2e/visual-regression.spec.js` + baselines; `tests/README.md`; `AGENTS.md`;
  `plans/README.md`; this plan.

## Implementation Steps

### Slice A

1. **Badges alone.** Change `drawParty` (`src/world.js:1394-1411`) and `drawHero` (`:1484-1489`) to
   print counts, add the heavy-unit marker, and keep `stronger`/`outmatched` and the odds pill driven
   by `strength()`. Fix the scouting toast (`:817`) and the camp panel line (`:1529`).
2. Run `npm run test:visual`; inspect actual/expected/diff for `world-overview.png` and
   `world-bridge.png`; confirm every changed pixel is a badge digit or marker; only then update those
   two baselines. Full `npm test` green before continuing.
3. **Hover.** A presentation pass at the start of `World.draw()` builds hit regions from the
   already-visible parties/camps plus the hero, hit-tests `input.mouse` via `Camera.toWorld()` with a
   **nearest-candidate** rule (not first-hit, so overlapping parties resolve deterministically), and
   stores `this.hoverTarget`. Never read it from `update()` — AGENTS.md: "simulation must not read
   presentation." Draw the panel in screen space so it cannot clip at map edges.
   **Critical:** `Input.mouse` initialises to the canvas centre (`src/engine.js:62`) and the camera
   centres on the hero (`src/world.js:1115`), so the default pointer already sits on the hero token —
   without a guard the warband panel renders from frame one, in both world baselines, in the perf
   spec's 20 draws, and forever for a keyboard-only player. Gate on a presentation-owned latch
   (`this.pointerEverMoved ||= input.mouse.moved`) written and read only in `draw()`;
   `mouse.moved` alone is useless because `endFrame()` clears it every frame (`src/engine.js:84`).
   Also suppress hover while a modal is open and while the pointer is over a HUD rect.
4. Write `tests/e2e/world-hover.spec.js` and the badge assertions; add the two new hover baselines.
   Full gate green, `npm run release:cache`, commit slice A.

### Slice B

5. **Add `ACTIONS.WITHDRAW`.** Escape cannot be the cancel key: `PAUSE` binds `['Escape','KeyP']` and
   `Game.update` handles PAUSE before the scene and returns early when paused
   (`src/main.js:232-242`), so an Escape-bound cancel would silently pause instead. Confirm on
   `CONFIRM` (Enter) or a click on the on-screen button — **not** on `WORLD_PRIMARY`, because the
   same held KeyE that opened a camp brief would also satisfy the battle intro's
   `stateT > 0.6 && input.pressed.size > 0` early-out (`src/battle.js:507`) and skip the intro.
6. **Named modal phase.** Add `updateWorldScreens(inp)` returning a boolean, first in
   `World.update()`, mirroring the `updateCampInteraction` pre-empt idiom (`src/world.js:879`). It
   must **return immediately after opening a screen** and never fall through in the same `update()`,
   or the opening keypress is still in the per-frame `pressed` set and instantly confirms.
   Two consequences of gating the pipeline that must be handled, not discovered:
   - `if (this.save.won) this.game.startVictory(...)` lives *inside* `update()` at
     `src/world.js:888`, after the party phases. **Do not open the aftermath when `save.won` is
     set** — the final victory screen already is that fight's aftermath — or a won stronghold raid
     never reaches the ending.
   - `this.grace -= dt` lives inside `updateParties` (`:898`). Freezing ambush immunity while the
     player reads is the *correct* behaviour, so keep it and cover it; the affected legacy record
     gains a dismiss (step 10). Gate `stats.playT` (`src/main.js:255`) the same way via a documented
     `World.isBlocking()` predicate, so leaving the screen up cannot inflate campaign time.
7. **Split request from commit.** Extract today's `World.startBattle()` body unchanged as the commit
   path; add `requestBattle(descriptor)` that opens the brief. Rewire the two real call sites — the
   party clash (`src/world.js:1058-1082`) and `updateCampInteraction()` (`:824-871`). Defer to
   confirm: the party splice, `persistParties()`, `save.battleCount++`, `persistRun()`, the camp
   garrison roll, and writing `this.pendingApproach`/`pendingDeploy` (put those in the descriptor so
   cancel has nothing to clean up). Hold the party **object** and resolve `indexOf(p)` at confirm,
   bailing cleanly on `-1`. Snapshot `comp.slice()` into the descriptor: for a camp, `comp` is a live
   alias of `save.camps[i].garrison`, which `onEnd` reassigns (`:700`) and the stronghold branch
   mutates in place (`:859`). Deferring the splice is also what makes pause-while-brief safe — pause
   calls `persistRun()` (`src/main.js:235`), which would otherwise write a map missing a party that
   is still standing there.
8. **Draw the brief.** Both orders of battle side by side — the player's from `save.troops` grouped by
   `UNIT_TYPES` key (reuse Plan 019's `SQUAD_LABELS`, do not duplicate the strings), the enemy's from
   the snapshot grouped by `ENEMY_TYPES` key (`world.js` must add `ENEMY_TYPES` to its import at
   `src/world.js:2`) — plus totals, the odds judgement, arena, approach, and the title/subtitle the
   call site already computes. An unscouted force reads as unknown (decision 6). Footer shows confirm
   always and withdraw only when the descriptor is player-initiated.
9. **Aftermath.** In the `onEnd` closure (`src/world.js:648-746`), capture the pre-battle roster
   snapshot before `game.startBattle`, and immediately before `this.game.startWorld(save)` assign
   `game.pendingAftermath = {...}`. The new `World` consumes and clears it in its constructor beside
   the toast replay (`:49`) — a snapshot held in the old closure dies with the old instance, and
   nothing may go on `save` or into `syncLiveStateToSave()`. Player losses = snapshot minus
   `result.survivors`; enemy losses = `result.deadTypes` against the comp snapshot. Consume and clear
   `save.toast` into the payload so the map consequence is not shown twice behind a frozen `msgT`
   timer. Show the **post-regen** `save.heroHp`, not `result.heroHp`, or the panel contradicts the
   HUD the moment it is dismissed. `result` gains no new fields.
10. **Fixtures.** Fix `installUniqueParty` (`tests/e2e/campaign-persistence.spec.js:51-75`) once — it
    steps one DT and asserts `sceneName === 'battle'`, and it is the setup for AUDIT-02, AUDIT-03 and
    its fully-wiped control, AUDIT-05, retreat restoration, the grace-charging regression, and the
    clashT-cooldown regression; the stronghold-victory test enters via `injectKeyAndStep('KeyE')`
    (`:231-232`). Then add a brief-confirm step to these five legacy record **bodies** — names, order
    and count preserved exactly as `tests/e2e/qa.spec.js:4-26` asserts, no assertion weakened:
    `world_party_battle_decreases_party_count_by_one`,
    `world_camp_raid_razes_camp_and_grants_captives`,
    `world_camp_raid_captives_capped_at_army_cap`,
    `world_grace_timer_active_after_battle_then_decays` (also dismisses the aftermath before sampling
    grace decay), and
    `world_party_break_off_occupies_settlement_and_recapture_restores_service`.
11. **Test API and new specs.** Add to `state().world`: `badges` (the numbers actually drawn),
    `screen` (`kind`, `canWithdraw`, both rosters, options), `hover`, and `pending`
    (`partyStillPresent`, `battleCountAtRequest`) — all derived from the *same* models the draw
    consumes, or the tests prove nothing. Add `scenario('world_brief', {kind, seed})` and
    `scenario('world_aftermath', {result})`, both built by calling the production
    `requestBattle`/`onEnd` path, never by assigning `world.screen` directly. Drive behaviour through
    `action(ACTIONS.CONFIRM)` / `action(ACTIONS.WITHDRAW)` / `click(x,y)` — no test-only mutators.
    Write `tests/e2e/world-screens.spec.js` covering: request leaves scene `world`, party present,
    `battleCount` unchanged; confirm does exactly one `persistRun()` while still `world`, then splice,
    then `battle`; cancel keeps the party with `clashT > 0` and `waryT` charged and blocks re-clash
    for `battleGrace`; withdraw offered for camp assault and `mood==='flee'` only; aftermath gates
    input, freezes `grace`, and `grace` decays after dismissal; aftermath suppressed when `save.won`
    and the victory scene is reached instead.
12. **Extend existing specs.** `world-battle-seams.spec.js`: a second block asserting
    `worldOrder === []` while a modal is open. `performance.spec.js`: one **new** world case with
    hover latched on and a modal open, with its own budget — the existing `<10000` case must stay
    green untouched, which it will because hover is latched off with no pointer movement.
    `input-actions.spec.js`: keyboard vs injected `WITHDRAW` parity.
13. **Baselines.** New: `world-brief-party.png`, `world-brief-camp-withdraw.png`,
    `world-aftermath-victory.png`, `world-aftermath-defeat.png`. Unchanged: the menu and all three
    battle captures (guaranteed by keying the intro change off `setup.brief`).
14. **Document** the `updateWorldScreens` phase next to the `World.update()` phase list in AGENTS.md,
    the `requestBattle`/`startBattle` split next to the world-to-battle transition rule, the
    deliberate `grace`/`playT` freeze semantics, and the new specs/baselines in `tests/README.md`.
    Then `npm run release:cache` (the new module adds an import edge), review the token-only diff,
    and run the full block.

## Acceptance Criteria

- [ ] Party and hero badges show body counts, and a brute-bearing party is marked as heavy without a
      second number. `git diff src/data.js` shows no change to `enemyStrength`, `playerStrength`, or
      any `BALANCE` value.
- [ ] The scouting toast and camp proximity line no longer print a strength scalar as a headcount.
- [ ] Hover shows composition, odds and intent for parties; nothing compositional for an unscouted
      camp; and the squad breakdown plus "the hero counts for three" for the warband. No hover panel
      appears until the pointer actually moves — asserted at boot and after stepping.
- [ ] `state()` after N steps is identical with the pointer parked on a party and on empty ground
      (hover cannot touch simulation).
- [ ] Every map-initiated fight opens a brief showing both orders of battle; confirming enters battle
      with the same setup as today.
- [ ] Withdraw is offered on a camp/stronghold assault and a fleeing party, absent on an ambush and a
      mutual skirmish. Withdrawing leaves the party on the map with `clashT` and `waryT` charged,
      does not increment `save.battleCount`, does not write a checkpoint, and does not reveal an
      unscouted garrison.
- [ ] Battle end shows the banner beat, then an aftermath screen with per-side casualties by unit
      type, loot, post-regen hero HP, and the map consequence; play resumes only on input; a won
      stronghold raid reaches the victory ending instead.
- [ ] All 22 legacy records pass with names, order, count and assertion strength intact; the five
      edited bodies gained only a dismiss/confirm step.
- [ ] `npm test` green with no budget raised, no baseline updated except the two reviewed world
      captures plus the new ones, and no new runtime dependency.

## Risks and STOP conditions

- **Gate stacking.** brief (player-paced) → intro banner → deploy countdown, in front of fights tuned
  to 20-40 s (`src/data.js:57`). Step 5's intro trim is the minimal honest fix. If playtest still
  drags, shorten or fold the *intro banner* further — do not make the brief skippable by default (a
  screen the player skips is a screen that failed) and do not touch the deploy window, which is Plan
  019 territory.
- **If deferring the party splice lets one collision produce two battles, stop** and restore the
  splice-up-front order with explicit restore-on-cancel instead.
- **If the modal gate forces edits beyond the five named legacy record bodies and
  `installUniqueParty`, stop and reconsider the modal boundary** rather than broadening the edit to
  the 22-record contract.
- **If withdraw cannot be made to avoid revealing an unscouted garrison, drop withdraw for camps**
  and keep it for fleeing parties only. The house rule that what you scouted is what you fight
  outranks the convenience of backing out.
- Do not add morale or influence to make the aftermath resemble its reference screenshot, and do not
  put the aftermath payload in the save. Report only what the simulation produces.

## Verification

```powershell
npm run test:qa
npx playwright test tests/e2e/world-screens.spec.js
npx playwright test tests/e2e/world-hover.spec.js
npx playwright test tests/e2e/campaign-persistence.spec.js
npx playwright test tests/e2e/world-battle-seams.spec.js
npm run test:visual
npm run test:perf
npm run test:release
npm test
git diff --check
```

Then drive it by hand at `http://127.0.0.1:8474`: ride into a party and confirm the brief has no
withdraw; run down a fleeing party and confirm it does; withdraw, then confirm the party is still
there, is wary, and does not instantly re-engage; raid a camp, win, and read the aftermath; raze the
last camp and confirm the victory ending still fires; hover a party, a scouted camp, Wolfsjaw
(unscouted all game until assaulted), and your own warband; boot the game and confirm no hover panel
appears until you move the mouse.
