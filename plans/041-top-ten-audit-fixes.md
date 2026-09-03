# 041 — Ten verified defects from the second gameplay audit, fixed in parallel

STATUS: DONE (2026-09-03). Nine fixes, one per isolated worktree, merged onto main
in the order they finished. The gate numbers are in the "Shipped" section at the end.

## Where the list came from

`critiques/gameplay-audit-2026-09-03.md` re-ran the six-dimension audit against
`de819e0` after Plans 037-040 shipped. Its "Recommended order" put hygiene and
instrument fixes first, then one-line campaign rules, then the shell. This plan
took the first ten items that were (a) verified in source or in the headless
playtest, (b) small enough to land without a design review, and (c) separable by
file so nine agents could work at once without editing the same regions. Each
agent owned a disjoint file set; `progress.md`, `plans/README.md` and the release
cache tokens were reserved for the merge step, because every branch rewrites the
tokens and nine appends to the same log cannot merge.

## The ten issues and what shipped

| # | Issue (audit ref) | Fix | Files |
| --- | --- | --- | --- |
| 1 | A total wipe reported "YOUR LOSSES: none" — `save.troops` aliased `result.survivors`, the Plan 039 muster pushed volunteers into it, the aftermath read it afterwards | Survivor types snapshotted before any branch; retreat and defeat assign copies. A one-line reason headline ("Your lord fell", "Your warband was cut down", "You broke off and rode clear") from `heroFell` on the payload | `src/world/battle-transition.js`, `src/world-screens.js` |
| 2 | Slice 2's wolf contract test asserted against `UNIT_TYPES.spear.range` (30) while describing the 140 px hold reach | `HOLD_REACH_MELEE` named in `constants.js`, read at both uses in `ai-phases.js`; the test's lower bound is now `stand.near > HOLD_REACH_MELEE` (162 vs 140) | `src/battle/constants.js`, `src/battle/ai-phases.js`, `tests/e2e/stance-balance.spec.js` |
| 3 | 59 tracked `scripts/zz-*` scratch files (7 MB); save-version docs said v4 against code v5; criterion 3's `test.fail` swallowed 0/12 and harness throws | 23 cited JSON dumps plus 2 uncited probes untracked and removed from the working tree (the agent reported the disk untouched; it was not — the files are gone locally, their numbers survive in the critiques that cite them), `.gitignore` covers `scripts/zz-*.json`; 19 JSON dumps whose numbers appear nowhere else stay tracked; CLAUDE.md and SCOPE.md say v5; criterion 3 asserts `held >= 11` | `.gitignore`, `CLAUDE.md`, `SCOPE.md`, `tests/e2e/campaign-arc.spec.js` |
| 4 | Floor guarantee not structural (lone brute survives `trimToBeatable`); `rollGarrison` skipped `encounterWeightClamp`; floor fallback priced off `myStrength()`; re-homed remnants escaped `partyCap()`, which also went to 0 with no camps; garrison comment overclaimed; `msgT` never decayed on a frozen clock | `trimToBeatable` replaces the last body via a frozen `heaviestLightBody(cap)` table (no RNG draw); garrison target clamped; fallback prices off `encounterBase()`; `partyCap()` bounds camp-homed and hold-homed bands separately and floors at 2 with the stronghold as spawn source; comment rewritten to say the freeze remains; `msgT` decays whenever `updateWorldClock` runs | `src/world.js`, `src/data.js`, `tests/e2e/regional-campaign.spec.js`, `tests/e2e/world-freeze.spec.js`, `AGENTS.md` |
| 5 | Stronghold chip read `points/7` while EXPOSED sits at 4 points plus one razed camp | `STRONGHOLD_TOP_POINTS` (derived, 4) and `nextStepHint(save)`; `maxPoints` removed; chip, storm row and brief lines carry the hint; claim row leads with "+1 toward weakening Wolfsjaw" | `src/region.js`, `src/world/render-actors.js`, `src/world/site-menu.js`, `tests/e2e/region.spec.js`, `tests/e2e/world-hover.spec.js` |
| 6 | Stale "Raid the camps" toast after every victory; aftermath panel could overprint its Continue button; recovery mechanic announced but never explained | Toast gated on `liveCamps().length`, points at Wolfsjaw otherwise; panel height reserved from the same `wrapLines()` that draws; a distress line appears only when `inDistress()` is true after the muster | `src/world/battle-transition.js`, `src/world-screens.js` |
| 7 | Hero jammed against river banks (57 of 60 s in one seed), and the freeze wash was the only cue | Axis fallbacks accepted only when they travel; blocked headings deflect in fixed steps at 0.7x with a 12 px look-ahead; exits floored at 1.5x `worldWakeSpeed` so the clock keeps flowing under held input; `timeFlowing()` untouched; cue text "The river bars the way — cross at a bridge or ford" only in the blocked-with-input state. Measured on the same fixture: 6.5 px and 4/600 live ticks before, 324 px and 577/600 after | `src/world.js` (`moveBlocked`, hero movement), `src/world/render-scene.js`, `tests/e2e/world-movement.spec.js` |
| 8 | No `devicePixelRatio` handling; every hairline and 11 px label upscaled on scaled displays | Backing store = CSS size x min(dpr, 2) composed into the base transform once, so every mid-frame `setTransform` reset still means one CSS pixel; `camera.w/h`, layout and `Input` stay in CSS px; a resolution media query catches ratio changes. Baselines and perf counts unmoved at dpr 1 | `src/main.js`, `src/engine.js`, `tests/e2e/dpr.spec.js` |
| 9 | R deleted the only save with no confirm; Escape stacked pause over an open modal; the victory screen was a dead end with a blinking prompt | R arms for `ABANDON_ARM_T` (2 s) with the overlay stating what the second press destroys; Q (`QUIT_TO_MENU`) persists and returns to the menu; pause entry gated on `!scene.isBlocking()` so Escape closes the site menu; victory is a steady two-row choice (NEW CAMPAIGN / MAIN MENU), pulse floored at 0.65 alpha; SETTINGS names E, X, ESC, Q and R | `src/main.js`, `src/input-actions.js`, `src/world/battle-transition.js`, `tests/e2e/menu.spec.js`, `tests/e2e/input-actions.spec.js` |
| 10 | Break objective HUD read "2 guards standing" after an elimination win; the deployment camera framed the player's line with the enemy off-screen | `battle.resolvedBy` set once in `resolveBattleResult`; the panel shows "Position taken — garrison destroyed" / "Position broken" / "Ground held" / "Ground lost" at `state === 'end'`; during `deploy` the camera fits both sides plus the frontier (hero bias kept for ambushes) | `src/battle.js`, `src/battle/hud.js`, `src/battle/combat.js`, `tests/e2e/battle-objectives.spec.js`, `tests/e2e/battle-camera.spec.js` |

## Baselines

Seven battle baselines were re-recorded for issue 10 because the deploy framing
moved the camera about 230 px: `battle-small`, `battle-big-night-camp`,
`battle-river-crossing`, `battle-wooded-highland`, `battle-bridge-settlement`,
`battle-hold`, `battle-stronghold`. They were validated in the CI font container
(`npm run test:visual:linux`, 24/24). `battle-bridge-ambush` was unchanged by
construction. `battle-break.png`, the Windows-only drift on record since Plan 035,
now matches at the new framing rather than being papered over.

`world-aftermath-defeat.png` changed for issue 1 (the reason line and the distress
line) and was re-recorded at the merge step, deliberately, after reviewing the
render. No other baseline moved; the chip text in issue 5 stayed inside the
documented raster tolerance.

## Merge notes

Every branch ran `npm run release:cache`, so every merge conflicted on the token
lines of all 33 modules. Conflicts were resolved hunk by hunk: a hunk whose two
sides differ only in `?v=r...` tokens takes main's side, a file the branch changed
only in tokens takes main's side wholesale, and anything else stops the merge. Two
real hunks needed a human decision: main.js where issues 8 and 9 both appended
top-level code at the same point (both kept), and world.js where issue 4 added an
import line (branch kept). Tokens were regenerated after each merge and the full
gate ran once on the merged tree, not per branch.

## Out of scope, recorded

- Two offscreen surfaces still bake at CSS-pixel size and blit upscaled at dpr 2:
  the battle minimap (`src/battle/hud.js`) and the battle tile canvas
  (`src/battle.js`). Layout is correct; they stay soft on Retina.
- `battle.killedBy` names the killer on the defeat banner but never reaches
  `result`; plumbing it into the aftermath reason line needs `src/battle.js`.
- No victory music bed: only `campaign` and `battle` beds ship and
  `audio.spec.js` asserts silence on the summary. A third bed is an asset task.
- The 140 px hold reach guard now has ~14 percent of margin above the wolf band
  (162 vs 140); the upper bound (225 vs 230) is what catches a revert to 250.
- `npm run test:balance` was not run per branch; it ran once on the merged tree
  (see Shipped).

## Found by the audit refresh, fixed at the merge

- **The river cue and the wash.** The refresh read `drawFreezeCue`'s gate on `staleT`
  as a defect: the wall-slide keeps the clock flowing while the rider pushes along a
  bank, so the cue never shows there. Judged a design choice, not a defect, and kept:
  the slide itself is the feedback, and the line is reserved for the one case the
  wash cannot explain (every heading blocked, time stalled, key held), which is what
  `world-movement.spec.js` pins. The cue text did gain an ink plate for legibility
  over any ground colour, extracted into `drawWallCue` with the reasoning in its
  comment.
- **Issue 3's report said the disk was untouched; it was not.** The 27 untracked
  files are gone from the working tree. Their numbers survive in the critiques
  that cite them; the plan and progress text were corrected.
- `.gitignore` also ignores `scripts/zz-*.mjs`, so a new probe is not committed by
  default; the cited probes already tracked stay tracked.
- The 13 merged branches were pruned and the nine worktrees removed.

## Found by the audit refresh, recorded for the next plan

- Two of the four aftermath reason lines are unreachable in play: a real non-retreat
  defeat only comes from hero death, so "Your line broke" appears only on an
  externally ended battle, which is exactly the `world_aftermath` visual fixture.
  The re-recorded `world-aftermath-defeat.png` therefore shows a fabricated defeat
  (reason, no losses, hero at 60). Make the reason refuse cases it cannot justify or
  give the fixture a coherent result, then re-record once.
- The stronghold chip's fraction counts to the ladder top (4) while its hint counts
  to the next rung ("Capture or raze 2 more"); two targets on adjacent lines.
- `moveBlocked` now deflects instead of damping, so pinned-seed hero trajectories
  differ from every campaign measurement recorded before this plan even though the
  `simRng` stream is untouched. Re-baseline the campaign harness before quoting a
  before/after across this change.
- The DPR fix wraps `ctx.setTransform` on the live 2D context to compose the device
  scale. It works and is documented, but a future `getTransform()` reader must
  know, and the minimap and tile offscreen buffers are not covered.
- Deploy framing renders the same units smaller, so the squad-silhouette problem
  (audit finding 25) is measurably worse in six re-recorded baselines.

## Shipped

Gate on the merged tree (`main`, after the cue fix): `npm test` 234 passed with the
re-recorded defeat baseline; `npm run test:visual` 24 passed; `npm run test:perf`
10 passed; `npm run test:balance` 4 passed (the `@sweep` guard holds at the
re-based HELD = 4 fixture); `npm run test:release` verified. Per-branch, each fix
also passed the full gate on its own worktree before merge, every one reporting the
same single pre-existing failure (`battle-break.png`) that issue 10 retired.
