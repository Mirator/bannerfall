# Plan 018: Recompose the title screen around an animated campaign vignette

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM
- **Depends on**: Plan 017 (DONE)
- **Status**: DONE on branch `codex/menu-vignette-slice`

## Goal

Keep Plan 017's interaction model unchanged while giving the title screen a clearer two-column composition: compact wordmark and actions on the left, an animated in-engine campaign journey on the right, and quiet contextual controls along the bottom.

## Scope

- Reduce and reposition the banner wordmark and menu into a protected left column.
- Draw a right-side road, distant hold, terrain, rider, warband, dust, moving clouds, and banner flutter using bounded Canvas geometry only.
- Preserve a centered compact layout for narrow viewports.
- Add a deterministic title-menu visual regression baseline.
- Run the web-game client, inspect captures/state/errors, refresh release tokens, and run visual/performance/full gates.

## Implementation steps

1. Split menu scenery/layout into small drawing helpers owned by `Game`.
2. Add deterministic `menuT`-driven atmosphere and marching motion without RNG or simulation state.
3. Reposition all menu panels and hit regions through one responsive layout calculation.
4. Add and review a frozen menu screenshot baseline.
5. Mark this plan DONE, commit, merge to `main`, and push.

## Done criteria

- [x] Root and submenus remain fully operable without behavior changes.
- [x] The title/actions are readable without colliding with terrain at 1280×720.
- [x] Motion uses `menuT` only and remains deterministic under fixed stepping.
- [x] No full-map bitmap, unbounded cache, new RNG stream, or performance-budget change is introduced.
- [x] New menu baseline, existing visual suite, performance suite, release integrity, and full gate pass.
