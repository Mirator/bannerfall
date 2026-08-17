# ADR 001: Steam desktop host boundary

- Status: Accepted for future implementation
- Date: 2026-08-17
- Scope: desktop distribution architecture, not current packaging

## Decision

Electron is the recommended first desktop host for Bannerfall. The game already
uses a Chromium renderer, Canvas, WebAudio, and native ES modules, and its QA
baseline is Chromium-based. Electron therefore minimizes renderer and visual
drift while allowing the existing buildless web app to remain the web target.

The future Electron main process owns native filesystem and Steamworks calls.
The renderer uses a narrow typed preload bridge with `nodeIntegration: false`,
`contextIsolation: true`, sandboxing where supported, and no remote navigation.
Raw IPC, Node primitives, filesystem paths, DOM nodes, Canvas contexts, and
Steamworks objects must never cross the bridge. Renderer code depends only on
the capability-oriented platform contract in `src/platform/`.

Desktop campaign and settings files live in a stable per-user data directory.
Writes use a temporary file, atomic replace, and a recoverable backup. Only
those stable files—not Chromium's profile—are eligible for Steam Cloud. The
future host must wait for the repository's `flush()` during a native quit
handshake before allowing process exit.

The web target remains first-class: `index.html` loads native modules directly,
localStorage is hidden behind the web adapter, and no Electron or Steamworks
dependency is added to the browser deployment. Tauri remains a possible later
alternative if installer size outweighs Chromium parity; it is not a parallel
implementation today.

## Deferred implementation checklist

- Create the shell/preload bridge and enforce the security settings above.
- Implement atomic files/backups and configure only those paths for Steam Cloud.
- Add controller and glyph QA, fullscreen/multi-monitor coverage, signed builds,
  crash-safe quit, overlay testing, and Steam Deck validation.
- Add Steamworks adapters only for approved product features. Achievements,
  cloud, and overlay calls consume domain outcomes at application boundaries;
  they never run inside deterministic `World` or `Battle` update phases.

## References

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Steam Cloud](https://partner.steamgames.com/doc/features/cloud)
- [Steam Input](https://partner.steamgames.com/doc/features/steam_controller)
