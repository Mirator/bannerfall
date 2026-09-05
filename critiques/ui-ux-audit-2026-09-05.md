# UI/UX audit — 2026-09-05

Scope: the player-facing surface only — title menu, campaign HUD, site menu, the three
modals, the battle HUD, the pause overlay, the aftermath and victory screens. Balance,
simulation and architecture are out of scope except where they change what the screen says.

Method: read every drawing path in `src/main.js`, `src/world-screens.js`,
`src/battle/hud.js`, `src/world/render-actors.js` and `src/world/site-menu.js`, then drove
the real build headlessly through `window.game.scenario(...)` at 800x500, 1024x600, 1280x720
and 1920x1080 and captured frames the visual suite does not cover (pause overlay, settings
and credits panels, armed victory screen, mid-fight melee, a first-frame new campaign, a
first-minute ambush brief). Every finding below is either a line of source or a frame I
captured; nothing here is inferred from the plans.

The game looks good. Flat-shaded art is consistent, the modal language is genuinely one
language, and the writing on the site menu and the brief is better than most commercial
strategy UI. The problems are concentrated in three places: what a first-time player is
told (nothing), what the mouse is allowed to do (almost nothing, inconsistently), and two
screens that are drawn wrong.

---

## P1 — broken or actively misleading

### 1. The victory screen's only call to action is drawn inside the decoration

`src/main.js:1112` places the CONTINUE/MAIN MENU rows at `H * 0.885`. `src/main.js:1028`
draws seven banner poles from `H * 0.80` to `H * 0.98`. The rows land on the poles, and the
selected row is drawn at `globalAlpha` 0.65–1.0 (the pulse), so the pole shows *through* the
letters of the primary action. Captured at 1280x720: `NEW CAMPAIGN · ENTER / E` is crossed
by two poles and the tail of the hint is unreadable.

The visual suite cannot catch this: `victory-summary.png` is captured at `steps: 1.5`, and
the rows only draw at `victoryT > 1.5`, so the baseline is of a screen with no rows on it.

This is the terminal screen of the whole campaign. Fix: put the rows above the flag band
(the screen has ~280px of dead space between the summary block and the flags), or drop the
alpha pulse on the label and keep it on a separate marker.

### 2. The deployment panel shows an order the game is about to overwrite

Through the whole deployment phase the squad rows read `FOLLOW` (captured). On confirm,
`src/battle.js:653` flips every squad the player did not explicitly order to `HOLD`. The
first frame of the fight shows `HOLD · braced` on all three rows.

The intent is defensible — a placed line should stay placed — but the HUD states the
opposite of what will happen for as long as the player is looking at it, and the panel
(`src/battle/hud.js:410`) never mentions it. Fix: draw the pending stance during deploy
(`HOLD (placed)`, or `FOLLOW → HOLD`), or say it in the instruction line.

### 3. The ambush brief presents a fight it labels unwinnable, with one button

Riding right for six seconds from a fresh campaign start produces (captured):

> AMBUSHED! — your 5 bodies, fighting weight 4.6 · their 8 bodies, fighting weight 8.0
> ⚠ they outmatch you
> [ E — Confirm ]

`src/world.js:1157` sets `canWithdraw: caughtThem`, so a party that catches *you* offers no
withdraw. That is a legitimate rule, but the modal reads as a dialog with a removed option
rather than as a trap that closed. Nothing on it mentions that in-battle retreat exists —
and the retreat prompt itself (`src/battle/hud.js`, the `nearEscape || time > 45` gate) does
not appear until 45 seconds in or until the player has already wandered to the right edge.

So the first hard moment of a new campaign is a screen that says "you lose" and offers one
key. Fix: one line on the brief when `canWithdraw` is false — *"They have you — break for
the <dir> edge once the fight starts."* No mechanic change needed.

### 4. First-run onboarding does not exist

The first frame of NEW CAMPAIGN (captured) carries three unlabelled icon chips, an
objective chip, and nothing else. There is no movement prompt, no interaction prompt, no
mention of `E`. `grep` for onboarding strings across `src/world.js` and `src/world/` returns
nothing. The `[E]` pill only appears once the hero is already inside a site radius, and the
hero starts *outside* Ashford's.

The control list lives in exactly two places a new player will not look: the SETTINGS panel
(reachable only before starting) and the pause overlay. Given the whole map has one verb,
this is cheap to fix: a dismissible first-run line under the HUD (`WASD ride · E at a
banner`) that clears on first `E`.

---

## P2 — inconsistency and friction

### 5. Pointer behaviour is inconsistent between the menu and every in-game modal

- Title menu: rows highlight on hover and commit on click (`src/main.js:334`, `:357`).
- Site menu, spec, perk: rows commit on click but do **not** follow the pointer —
  `resolveChoiceInput` (`src/world/battle-transition.js:399`) hit-tests only on
  `mouse.clicked`. The mouse gets no feedback at all until the click lands.
- Pause overlay: not clickable at all (see 6).

A player who used the mouse in the title menu will try it in the site menu, get no hover,
and conclude the panel is keyboard-only. Fix: set `screen.index` on `mouse.moved` in the
same hit-test that already exists.

### 6. The pause overlay is the only menu in the game that is not a menu

`src/main.js:565` draws four lines of static text. No selection, no rows, no hit regions —
a mouse user cannot resume, quit, or reach anything. It is also the only screen where the
destructive action (`R`, twice, deletes the campaign) sits next to the non-destructive one
with no visual separation beyond colour.

Fix: reuse the menu row painter that already exists. RESUME / SAVE & QUIT / ABANDON as
three rows costs nothing and makes the arm-and-confirm behaviour of ABANDON visible as
state instead of as red text.

### 7. The cursor is a crosshair on every screen

`index.html:24` pins `cursor: crosshair` on the canvas for the whole game. That is right for
the battle scene (mouse aims the hero) and wrong for the title menu, the site menu and all
three modals, where the pointer is a pointer. Fix: swap `canvas.style.cursor` on scene and
modal transitions — one line each in `enterMenu`/`startWorld`/`startBattle` and the screen
open/close paths.

### 8. Three different counts of the same army are on screen at once

For a starting warband, simultaneously:

- HUD chip: `⚔ 4/12` (`src/world/render-actors.js:139`) — army *slots* vs cap, hero excluded.
- Map badge on the hero: `5` — bodies, hero included.
- Brief: `4 SPEARS` and `5 bodies · fighting weight 4.6`.
- Battle HUD: `Warband 14` (`src/battle/hud.js:299`) — troops, hero excluded again.

Each is individually documented and defensible; together they mean the player cannot answer
"how big is my army" from the screen. The `⚔` chip is the worst offender because it has no
label at all and its denominator (`12`) is a cap that only the site menu ever names. Fix:
pick one convention for "bodies" and use it everywhere, or label the chip.

### 9. The stronghold chip and the site menu count progress differently

Captured on one frame: the objective chip reads `Weaken it (0/4) — Capture or raze 2 more`
while the Wolfsjaw site menu behind it reads `ENTRENCHED — its camps still feed it (0/3)`.
Two `(x/y)` progress counters, same visual form, different denominators, one screen. They
measure different things (ladder points vs razed camps) and nothing on screen says so.

### 10. Battle readability collapses in melee

Captured at 10 seconds into a 14v11: friendlies, enemies and the hero occupy one overlapping
blob roughly 120px wide. The hero is distinguished by colour alone (`P.hero` yellow) and is
completely occluded when surrounded — which is exactly the moment the defeat screen's own
advice ("dash out of the scrum before you are surrounded") tells the player to react to.
There is no hero ring, no z-priority, no outline. Fix: draw the hero last with a contrast
ring, or fade unit fills at high local density.

### 11. Colour is the only channel for several states

- Stance consequence notes are green (good) / red (bad) text with no other marker
  (`src/battle/hud.js`, the `STANCE_NOTES` block).
- Friend/enemy is blue-white vs red — fine for the common deficiencies, but the objective
  panel's hold bar uses the *same* green/red pair for held/contested.
- The brief's odds line is the single most important number on it and it is 15px lowercase
  text (`favored`, `they outmatch you`) — smaller and quieter than the roster lines above it.

No colourblind mode, no option to raise it.

---

## P3 — gaps and polish

### 12. Settings exposes one toggle over an audio system with three buses

`src/main.js:254-257` gives SOUND on/off. `src/audio.js` has master, music and sfx gains
with working `setMusicVolume`/`setSfxVolume` setters (`audio.js:183`, `:188`) that no UI
reaches. Music-off-sfx-on is the single most requested setting in this genre and the
plumbing is already there.

### 13. No key rebinding, on a codebase built for it

`src/input-actions.js` is a named-action layer with a `DEFAULT_BINDINGS` table — the hard
part is done. Movement has an arrow-key alternative, but `E`, `X`, `Q`, `R`, `J`, `Tab` and
`1/2/3` are fixed. On AZERTY the letter keys are reachable but wrong-handed. For the stated
Steam-ready direction this is table stakes.

### 14. Nothing scales with viewport

Every HUD rect and font is a fixed CSS-pixel constant. At 1920x1080 (captured) the 11–13px
squad rows and the 180x127 minimap are proportionally half the size they are at 720p, while
the battle camera shows more field, making units smaller too. At 800x500 (captured) the
opposite: the site menu's rows shrink to `rowH: 34` and the label and detail lines nearly
touch, and the player's own deployed line is clipped by the left screen edge. No UI-scale
setting exists.

### 15. Two control legends on the SETTINGS screen disagree

The heading line reads `WASD ride · mouse aim · LMB swing · Space dash · 1/2/3 orders`; the
block under the frame reads `E site menu / confirm · X leave / withdraw · TAB squad` and two
more lines. Different formats, different contents, neither complete, both on the same screen
(captured). `J` (the bound ATTACK key) appears in neither.

### 16. "ENEMY LOSSES: none" on a DEFEAT screen

Captured on the defeat aftermath: `YOUR LOSSES none` / `ENEMY LOSSES none`, plus the reason
line `Your line broke` set at ~11px directly under the 30px `DEFEAT` heading, where it reads
as a clipped subtitle rather than an explanation. Losing a battle while losing nobody is
possible (the hero fell), but the screen states it without ever explaining it.

---

## The safety net has a hole worth knowing about

`tests/e2e/visual-regression.spec.js:12` sets `maxDiffPixelRatio: 0.015` — 13,824 pixels at
1280x720. The objective chip is roughly 300x50 = 15,000. That is not a hypothetical: I
reproduced `world-overview.png`'s exact fixture (seed 20260817, 0.5s, DPR 1) against the
current build and the chip reads

- baseline: `Weaken it (0/7)` / `Capture settlements · raze camps`
- current: `Weaken it (0/4)` / `Capture or raze 2 more`

plus a different party badge and position. `npx playwright test visual-regression.spec.js`
**passes 24/24** on this tree. So the entire copy of a HUD chip changed and the gate did not
notice, and the checked-in baseline no longer depicts the game.

The suite is a good structural guard and should stay as it is for layout. But HUD *copy* is
not defended by it. A dozen text assertions against `state()` (or a dedicated small-crop
snapshot of each chip) would cover what the ratio cap cannot.

Related: the armed victory screen (finding 1) and the pause overlay have no baseline at all,
which is why finding 1 has survived.

---

## Suggested order

1. Findings 1 and 2 — both are the UI saying something false, both are small diffs.
2. Finding 4, then 3 — the first ten minutes of a new campaign.
3. Findings 5, 6, 7 — pointer coherence, one afternoon together.
4. Finding 8 — pick an army-count convention before more screens are added.
5. Finding 12 — cheap, and the code is already there.

Findings 10, 11, 13 and 14 are real work and belong in their own plans.
