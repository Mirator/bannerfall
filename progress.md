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
- [ ] Commit, merge to main, and push.
