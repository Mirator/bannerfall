Original prompt: I want to amek better game menu. Look at 5 indies games like thronefall, save their menu references and suggest how this menu could be improved

## Current task

- [x] Captured and visually inspected the current Bannerfall menu at `references/menu-study/bannerfall-current/shot-0.png`.
- [x] Saved and visually inspected menu references for Bad North, Islanders, Dome Keeper, Dorfromantik, and Mini Motorways.
- [x] Wrote the attributable comparison and prioritized recommendations in `references/menu-study/MENU_REVIEW.md`.

## Findings

- The current Enter action silently clears an existing run; the proposed menu makes Continue the safe default and puts confirmation behind New Campaign.
- The current blinking primary chip fully disappears during part of its cycle; use persistent focus styling instead.
- No production source was changed in this research task, so release-cache and gameplay gates were not required.

## Implementation slice 1

- Branch: `codex/menu-navigation-slice`
- Plan: `plans/017-menu-navigation-slice.md`
- Baseline: `npm test` passed, 39/39 tests.
- [x] Implemented safe navigable menu state.
- [x] Visual QA: `shots/menu-slice-1-root/shot-0.png` inspected; state artifact matched and no console errors were emitted.
- [x] Focused menu/input/persistence suite passed, 13/13.
- [x] `npm run test:release` passed with token `raf847f688e24`.
- [x] `npm test` passed, 42/42.
- [x] Committed as `f5ca89c`, merged as `819124b`, and pushed to `origin/main`.

## Implementation slice 2

- Slice 1 committed as `f5ca89c`, merged as `819124b`, and pushed to `origin/main`.
- Branch: `codex/menu-vignette-slice`
- Plan: `plans/018-menu-vignette-slice.md`
- [x] Implemented responsive campaign-vignette composition using bounded Canvas paths and `menuT` only.
- [x] Inspected `shots/menu-slice-2-final/shot-0.png`; text state matched and no console errors were emitted.
- [x] Added and reviewed `menu-campaign-vignette.png`; visual suite passed, 6/6.
- [x] Performance suite passed, 7/7, without budget changes.
- [x] `npm run test:release` passed with token `r7584d9e97185`.
- [x] `npm test` passed, 43/43.
- [x] Ready for the verified commit, merge, and push recorded in this task's final handoff.
