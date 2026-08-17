# Plan 017: Replace title-screen shortcuts with safe menu navigation

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: Plan 016 (DONE)
- **Status**: DONE on branch `codex/menu-navigation-slice`

## Goal

Turn the title screen into a persistent, mouse/keyboard/action-driven menu without changing campaign simulation or save schema. A saved campaign must default to Continue, and starting a replacement run must require an explicit confirmation.

## Scope

- Add named menu up/down/back actions while preserving the existing C and H shortcuts.
- Add root, campaign-mode, overwrite-confirmation, settings, and credits menu states.
- Render persistent selection and mouse hit regions; never blink the selected action away.
- Expose menu state through the deterministic test surface.
- Add browser coverage for safe Continue, confirmed overwrite, hard-mode selection, back navigation, and mouse activation.
- Refresh release-cache tokens and run focused plus full QA.

## Implementation steps

1. Add menu state/transition helpers to `Game` and route title-screen input through them.
2. Replace instruction pills with a single selectable panel and contextual footer.
3. Extend the test API and add focused deterministic menu tests.
4. Run the web-game client, inspect screenshots/state/errors, then run release and full regression gates.
5. Mark this plan DONE, commit, merge to `main`, and push.

## Done criteria

- [x] Enter continues a valid save by default and never silently erases it.
- [x] New Normal/Hard campaigns are explicit choices and saved-run replacement is confirmed.
- [x] Keyboard, named actions, legacy C/H shortcuts, and mouse all work.
- [x] Settings and Credits can be entered and exited.
- [x] Focus styling is persistent and legible at 1280×720.
- [x] Release integrity and the full Playwright gate pass (42/42).
