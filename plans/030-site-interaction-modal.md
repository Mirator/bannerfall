# Plan 030: One menu behind every map interaction

**Status:** DONE. `E` is the campaign map's only verb. Six per-service hotkeys are gone from
the action layer, the five-line prompt panel is a one-line chip, and every settlement, camp
and stronghold interaction is a row of one modal built on the existing `world.screen`
machinery. Two new visual baselines; no existing baseline was recaptured. One latent bug was
found and closed along the way — see Implementation finding 2.
**Priority:** P1 (interaction legibility; the prompt panel had grown a line per service and
was crowding the map at all times)
**Effort:** M
**Risk:** Medium (touches the world tick order, deletes six named actions, and rewrites how
five test suites drive settlement services)
**Depends on:** Plan 021 (the `world.screen` / `updateWorldScreens` modal machinery this
reuses rather than reinventing), Plan 025 (the specialization choice a claim hands off to),
Plan 029 (the banner and perk services this menu now sells)

## Objective

Standing next to Ashford painted a five-line key legend across the bottom of the map:
`Q Spearman 12g · E Archer 25g · F Rest & heal 10g`, a role line per unit sold, and
`G Claim this settlement for your banner`. The panel existed only because those bindings
were otherwise undiscoverable, so every service added to the game added a line to it — and
the panel was on screen the whole time the player stood at a gate.

The same key meant two things. `WORLD_PRIMARY` (E) bought an archer at a settlement and
opened the assault brief at a camp, disambiguated only by which check ran first
(`World.update` passed the near settlement into `updateCampInteraction` so a camp could
never steal the press).

Make `E` mean one thing everywhere — open the menu for whatever you are standing next to —
and put the prices, the roles, the odds and the claim behind it.

## What shipped

**One verb.** `updateCampInteraction` became `updateSiteInteraction` and now covers
settlements too. `nearestSite()` states the settlement-wins-over-camp precedence that used
to be implicit in the phase order. `updateSettlementInteractions` kept its name and its slot
but shrank to the passive camp scouting and its `return s`; it reads no input at all.

**One modal.** `world.screen.kind === 'site'`, on the same `world.screen` /
`world.screenButtons` / `updateWorldScreens` triple the brief, aftermath, specialization and
perk screens already use — which is what buys the "a world modal genuinely pauses the
campaign" contract for free rather than inventing a second pause. `world/site-menu.js` owns
the model and the dispatch; the rules stay in the methods each row calls, so a row's price
tag and its charge cannot disagree.

**Rows, not keys.** `RECRUIT_SPEAR`, `RECRUIT_KNIGHT`, `HEAL`, `EXPAND_ARMY`, `CLAIM` and
`UPGRADE_BANNER` were deleted from `input-actions.js` rather than left bound. Deleting them
also cleared `KeyR`'s collision with `ABANDON_RUN`, which had been disambiguated only by the
`paused` early-return in `main.js`.

**A chip, not a legend.** The bottom panel is `Village of Ashford · E` — a name and the key.
`WORLD_ART.hud.bottomSafeH` dropped 120 → 64 with it, so hover is no longer suppressed over
a band of map the HUD stopped covering, and `contextW` was deleted.

## Design decisions

1. **The menu stays open and re-derives after a purchase.** Committing a row calls
   `refreshSiteModel()`, which rebuilds the model from the save rather than patching it, so
   the purse in the header and every price are re-read. Building an army is one `E` and a
   run of `ENTER`s, not one `E` per body. The QA suite asserts both the second purchase and
   that the purse tracks it.

2. **A refused row still commits.** `recruit()` and `upgradeBanner()` own their refusal
   wording; the row's `enabled` flag only dims it. Letting the method speak is what keeps the
   flag from drifting away from the actual rule, and the panel's notice line is where the
   player reads the answer.

3. **The notice line exists because the toast is under the scrim.** `world.msg` does not
   decay while a screen is open (`updateWorldClock` sits behind the gate), so the last result
   simply stays readable for the visit. `updateSiteInteraction` clears the toast BEFORE
   building the model, so opening the menu reports this visit rather than the last ride.

4. **Rows that raise a modal of their own close this one first.** `queueSpecChoice()` and
   `offerPerkChoice()` both no-op while a screen is open, so claiming from inside an open
   menu would have silently swallowed the specialization prompt the claim earns. Claim and
   choose-a-calling null `world.screen` before calling in; raid and storm let `requestBattle`
   replace it. Withdrawing from that brief returns to the map, not to the menu.

5. **The occupied settlement offers nothing rather than refusing each service.** Its menu has
   zero rows and says why in the subtitle. That is a stronger statement than the old
   per-key refusal, and both `qa_suite.js` and `campaign-persistence.spec.js` now assert it
   structurally instead of pressing a key and checking that nothing moved.

6. **The stronghold row is offered at every power state.** The code always allowed the
   assault (Milestone 025 Slice E); only the old prompt text hid the option below three razed
   camps. The row is always there and the subtitle carries the count.

7. **The spec and perk panels' draw code was left alone.** Their input handling was folded
   into one `resolveChoiceInput()` helper — three copies of the same list navigation was two
   too many — but their painters stayed separate. Visual baselines pin their pixels, and a
   shared painter would have risked that for no behavioural gain.

## Implementation findings

1. **The two-press flow reaches the fixtures, not just the player.** `scenario('world_brief')`
   drove a single `WORLD_PRIMARY` press for its camp and stronghold kinds; it now drives the
   press and the commit. Five suites had to learn the same shape, and each got a helper
   (`chooseSiteRow` in `test-helpers.js`, `tickSiteRow` in `regional-campaign.spec.js`,
   `siteRow`/`siteRowIds` in `qa_suite.js`) rather than a copy. All three name the rows they
   found when the one asked for is missing, which is the failure a fixture standing in the
   wrong place actually has.

2. **Every world modal's vertical text placement was a hidden dependency on the HUD.**
   `drawHud()` sets `ctx.textBaseline = 'middle'` for the resource chip and never reset it,
   so `drawBriefPanel`, `drawAftermathPanel`, `drawSpecPanel` and `drawPerkPanel` all
   inherited it and had been authored against it. The new chip resets the baseline properly,
   which shifted every one of them 8px up and failed `world-brief-camp-withdraw.png`. Fixed
   by declaring the baseline in each panel rather than by removing the reset: the baselines
   are unchanged, and the coupling is gone.

3. **The existing baselines survived the chip.** The bottom panel shrank from five lines to
   one and the scouting toast stopped appearing under a freshly opened menu, but both changes
   sit under the modal scrim in every affected frame and stayed inside the 1.5% cap. Only two
   files were added — `world-site-town.png` and `world-site-camp.png` — both captured through
   the pinned-Linux workflow. Nothing was recaptured to get green.

## Accepted consequence

An open site menu pre-empts the whole pipeline, including the one seam that still runs under
a stopped hero: `updateParties(dt, true)`'s clash resolution. A party closing to clash range
cannot reach you while you shop, where before it could. This is the documented behaviour of
every other world modal, and a bespoke half-pause for this one screen would be worse than the
small exploit it leaves.
