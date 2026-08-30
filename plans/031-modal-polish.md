# Plan 031: One key, one modal language, and no blind permanent choices

**Status:** DONE. `E` confirms as well as opens. The two permanent-choice modals can no
longer be committed by the burst of presses that dismissed the screen before them. Five
panels now share four drawing primitives instead of hand-repeating the same 85 lines, and
every world modal has a sound, a selected-row marker, a drop shadow, a header rule, and an
exit a mouse can reach. Three real defects were found by audit and closed; one comment
written in Plan 030 was false and has been corrected.
**Priority:** P1 (interaction feel, plus one commitment trap that can permanently mis-set a run)
**Effort:** L
**Risk:** Medium (touches every world modal's painter and the shared input path; adds the
first subset-binding pair in the action table)
**Depends on:** Plan 021 (the modal machinery), Plan 029 (the perk screen), Plan 030 (the
site menu this generalizes from)

## Objective

Plan 030 put every map interaction behind one verb. This slice makes the screens that verb
opens worth looking at, and makes the one key do the whole job.

Three audits were run over the five world modals — interaction, visual, and input hazard.
What follows is what they found and what was done about it.

## What shipped

### `E` confirms

`CONFIRM` is now `['Enter', 'KeyE']`. The hand that opened the menu is already on E, and
reaching for Enter to answer a prompt E raised is the wrong shape. Enter stays bound: it
costs nothing, it is the universal confirm affordance, and three tests drive it through the
real `keydown` listener.

This is the first pair in the binding table where one action's key set is a strict **subset**
of another's (`WORLD_PRIMARY ⊂ CONFIRM`) rather than being separated by scene. Its entire
safety rests on `updateWorldScreens()` returning `true` whenever a screen is open, so the
site-menu phase never runs in the same tick. That was already the contract; it is now
load-bearing, and `input-actions.js` says so.

Verified, not assumed:

- A single press cannot double-fire. `Input.endFrame()` runs once per fixed step and
  `e.repeat` is filtered, so one keydown is one edge, consumed by exactly one phase.
- A **held** key does nothing beyond its first tick, for the same reason.
- The battle intro's early-out is not reachable through the brief path. It reads raw
  `input.pressed`, but that set is cleared before `Battle` first ticks — and for a
  brief-routed battle `introDur` is 0.6, the same threshold the press-to-skip clause tests,
  so the clause is dead code there anyway.

### Permanent choices arm before they can be taken

The specialization and perk screens are the only two modals that appear **unbidden** — they
arrive on the tick the aftermath closes, which is the tick the player was already pressing
CONFIRM to clear that aftermath. At a normal mashing rate the next press lands ~125ms later,
on a permanent choice nobody read, and takes option 0 for the rest of the campaign.

`CHOICE_ARM_T` (0.4s) rides on the model, so a screen that replaces another gets a fresh arm
for free — which is precisely the aftermath → spec → perk case. Navigation stays live and
**disarms immediately**: moving the selection is proof of reading. While armed the hint line
says `read it first…` rather than printing a commit key that does nothing.

The victory summary already guarded itself this way (`victoryT > 1.5`). This applies the
same idea where it was actually needed.

Adding `E` to CONFIRM is what makes this mandatory rather than merely good: without the arm,
three taps of E at a camp would open the menu, commit the raid row and confirm the brief.

### Four primitives instead of five hand-drawn panels

`drawSpecPanel` and `drawPerkPanel` were 79% byte-identical — 41 of ~52 lines, and every
difference was a string or a constant. `drawModalScrim`, `drawModalFrame`, `drawModalRow`
and `rowBlock` are that shared shape.

`drawModalRow` is pixel-exact with what it replaced: its two text baselines,
`round(y + h*0.40)` and `round(y + h*0.75)`, land on the same integers at every row height
the panels actually use (64 → 26/48, 52 → 21/39). The site panel's generalized form already
*was* the spec/perk form.

`rowBlock` also closes a latent `TypeError`: both choice panels indexed
`rects[rects.length - 1]` unguarded, where the site panel already handled the empty case.

### Layout: two panels could clip, two reserved space they never used

- **`drawPerkPanel` had no height clamp at all.** Five perks is a normal mid-campaign state
  once two tiers are open; at that size the panel's own border went off-canvas on a short
  window. `drawSpecPanel` was unclamped for the same reason and survived only by the
  coincidence of having exactly four options. Both now shrink their rows and clamp, the way
  the brief and the site menu already did.
- **The brief reserved a fixed 460px base** and left ~175px of dead air under the objective
  block on every camp raid. **The aftermath reserved a fixed 440px** for as little as 200px
  of content — a no-casualty victory read as a mostly-empty box. Both are now sized from
  what they actually report.

### Text that ran past the panel border

One word-wrap existed, in the aftermath. `fitText` (measure, binary-search, ellipsis) now
guards the two places that genuinely overflow: the brief's perk line, which runs past the
panel edge once five perks are held, and the perk panel's longest detail row. Both draw copy
that lives in `progression.js` and `region.js` — files edited for gameplay reasons by people
not looking at pixel budgets — so the panels defend themselves rather than trusting the copy.

### The things the player needed and did not get

- **Defeat takes 30% of your gold and never said so.** The aftermath reported loot and hero
  HP; the number that actually hurt was discovered later by noticing the HUD. It now reads
  `Lost: −N gold`.
- **The aftermath never mentioned veterancy** — the one screen where the rank was earned.
  `veteranLine` was already computed for the brief and the summary; it is now on the
  aftermath too.
- **The perk panel hid half its own model.** `buildPerkModel` has always computed `earned`
  and `spent`; neither was ever drawn, so banked points were invisible.
- **The brief did not show hero HP.** The scrim puts the HUD's heart chip at 28% visibility,
  and riding into an assault at 22/120 is a decision made without the most important number
  on the board. The site menu added a purse header for exactly this reason; the brief never
  got the same treatment.

### Feel

- **Every world modal was mute.** `uiMove`/`uiSelect` ship, are CC0-documented in
  `assets/audio/SOURCES.md`, and were wired only into the main menu. They are now on
  navigation, commit, dismiss and site-menu open. `Sfx.play()` drops a one-shot when there
  is no AudioContext, so this cannot raise an autoplay violation.
- **A selected-row marker** (`▸`) in the gutter the rows already reserved, so it displaced
  no existing glyph.
- **A drop shadow** offset along the game's single light direction — an offset `rrect`, not
  `ctx.shadowBlur`, which costs no `beginPath` but is genuinely expensive over a rect this
  size.
- **A header rule** with diamond caps, echoing the separator the main menu draws around its
  list.
- **A mouse exit for the spec and perk panels.** They returned row rects and nothing else,
  so the only clickable thing on either was an irreversible commit. The site menu got a
  LEAVE button specifically because a mouse-only player had no way out; that reasoning never
  reached the two panels where it mattered most.

## A correction

Plan 030 left this comment in `battle-transition.js`:

> the visual baselines pin the spec and perk panels' pixels, and a shared painter would put
> that at risk

That was false. There were no spec or perk baselines, and no scenario that could open either
— they were the only world screens with zero visual coverage, and the comment asserted the
opposite. `scenario('world_choice', {kind})` and two baselines were added first, because
that is the honest prerequisite for touching those painters at all.

## Accepted, and why

**Mashing E at a settlement still buys repeatedly.** The purse in the header updates live and
the notice line names each purchase; a player pressing E four times at a shop with a 12g
spearman highlighted is buying spearmen. Arming the site menu would dull the interaction it
exists to make fast, and the outcome is neither permanent nor hidden.

**The brief is not armed either.** It opens because the player chose a row, it states the
whole fight, and it offers withdraw. Three deliberate taps to start a fight you walked up to
is a fight you walked up to.

## Tests

The three fixtures that committed a permanent choice on the tick after it opened now wait the
arm out, through a `commitChoice()` helper that ticks until `armT` reaches zero. That is the
honest change: the fixture waits like a player.

Baselines: `world-brief-party`, `world-brief-camp-withdraw`, `world-aftermath-victory` and
`world-aftermath-defeat` were recaptured — the panels deliberately changed shape — plus the
two new `world-spec-choice` / `world-perk-choice`. The two site baselines were left alone;
the marker, rule and shadow landed inside the 1.5% cap and they still pass unmodified.
