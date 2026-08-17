# Plan 016: Introduce a Steam-ready platform and input boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update this plan and its row in
> `plans/README.md` to `DONE`.
>
> **Drift check (run first)**:
> `git diff --stat 7ad0a00..HEAD -- src/main.js src/engine.js src/world.js src/battle.js src/save.js index.html package.json tests AGENTS.md`
> If any in-scope file changed, compare the current-state excerpts below with
> the live code. Preserve later persistence, input, scheduler, and QA changes;
> stop if the platform boundary can no longer be introduced incrementally.

## Status

- **Priority**: P2 now; becomes P1 before desktop packaging begins
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plans 001-015 (DONE)
- **Category**: direction / architecture
- **Planned at**: commit `7ad0a00`, 2026-08-17
- **Status**: DONE at commit `d47c483`, independently reviewed 2026-08-17

## Why this matters

Bannerfall already runs in a Chromium-compatible renderer, so a future Steam
release does not require replacing Canvas, WebAudio, or native ES modules.
The costly future mismatch is elsewhere: campaign/settings persistence is
called synchronously through `localStorage`, lifecycle decisions read browser
globals directly, and gameplay code asks for raw keyboard codes. A desktop
host needs a stable file boundary for Steam Cloud, an asynchronous and
flushable shutdown path, a narrow renderer-to-host API, and remappable actions
for controllers/Steam Deck.

Do this boundary work before adding more menus, settings, save slots, or input
mechanics. Do **not** add Electron, a Steamworks SDK, achievements, packaging,
or a production build step in this plan. The web release must remain a direct
`index.html` + native-module deployment.

## Architectural decision

Record an ADR recommending **Electron as the eventual first desktop host**, but
do not install it yet. Bannerfall's rendering and QA are already Chromium-based;
Electron therefore minimizes renderer and visual-baseline drift and can load
the existing local app with no gameplay rewrite. The later renderer must keep
Node integration disabled and expose only a narrow, context-isolated preload
API. Tauri may be reconsidered if installer size becomes more important than
Chromium parity, but its OS WebView variance and Rust toolchain are a poor
default for this codebase today.

Official references for the ADR:

- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Steam Cloud: https://partner.steamgames.com/doc/features/cloud
- Steam Input: https://partner.steamgames.com/doc/features/steam_controller

## Current state

- `src/main.js` owns boot, scene transitions, autosave, pause, lifecycle loop,
  and the public test API.
- `src/engine.js` owns raw DOM input and WebAudio, including mute persistence.
- `src/save.js` is already a pure versioned JSON validator/migrator. Preserve it
  as the format boundary; storage location must not leak into this module.
- `src/world.js` and `src/battle.js` consume `Input` through raw key codes in
  their ordered update phases.
- Playwright provides deterministic campaign, save-schema, input, visual, and
  performance coverage. Extend these conventions rather than adding a second
  test runner.

Current direct storage coupling (`src/main.js:41-57`):

```js
get saveKey() { return this.testMode ? 'bf_save_test' : 'bf_save'; }

persistRun() {
  if (this.sceneName === 'world' && this.scene && this.scene.save && !this.scene.save.won) {
    try { localStorage.setItem(this.saveKey, JSON.stringify(this.scene.syncLiveStateToSave())); } catch (e) {}
  }
}
loadRun() {
  let raw;
  try { raw = localStorage.getItem(this.saveKey); } catch (e) { return null; }
  if (!raw) return null;
  const save = parseSave(raw);
  if (!save) { this.clearRun(); return null; }
  return save;
}
clearRun() { try { localStorage.removeItem(this.saveKey); } catch (e) {} }
```

Current raw input coupling (`src/engine.js:61-70`):

```js
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  this.keys.add(e.code); this.pressed.add(e.code);
});
window.addEventListener('keyup', e => this.keys.delete(e.code));
window.addEventListener('blur', () => this.keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) this.keys.clear(); });
```

Current settings coupling (`src/engine.js:229-236`):

```js
try { this.muted = localStorage.getItem('bf_mute') === '1'; } catch (e) {}
// ...
try { localStorage.setItem('bf_mute', m ? '1' : '0'); } catch (e) {}
```

The current conventions that must survive are documented in `AGENTS.md`:

- `World.syncLiveStateToSave()` remains the only map snapshot boundary.
- World-to-battle checkpoint ordering remains unchanged.
- `bf_save` and `bf_save_test` remain isolated semantically even after their
  physical backing store is abstracted.
- `World.update()` and `Battle.update()` phase ordering remains unchanged.
- Tests use pinned seeds and fixed steps, never timing sleeps.
- Source changes require `npm run release:cache` and `npm run test:release`.

## Target architecture

```text
Game / World / Battle / Sfx
          |
          +-- action-oriented Input (no raw key codes outside bindings/tests)
          |
          +-- SaveRepository (validated in-memory slots + ordered write queue)
                         |
                         +-- Platform.storage (async read/write/remove/flush)
                         |
                         +-- Platform.lifecycle (background/suspend/quit hooks)

Web today:      createWebPlatform() -> localStorage + browser lifecycle
Steam later:    createDesktopPlatform() -> context-isolated preload bridge
                                      -> stable atomic JSON files / Steam Cloud
```

The platform contract must be capability-oriented and small. It must not expose
Electron, Steamworks, IPC, filesystem paths, DOM nodes, or `localStorage` to
gameplay code.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Tooling contract | `npm run test:tooling` | exit 0; all Node tests pass |
| Focused save tests | `npx playwright test tests/e2e/save-schema.spec.js tests/e2e/campaign-persistence.spec.js` | all pass |
| Focused QA | `npm run test:qa` | all pass |
| Visual QA | `npm run test:visual` | five baselines pass unchanged |
| Performance QA | `npm run test:perf` | all structural budgets pass |
| Update release token | `npm run release:cache` | one current token applied |
| Verify release graph | `npm run test:release` | exit 0; graph verified |
| Full gate | `npm test` | all tests pass, no retries locally |
| Diff hygiene | `git diff --check` | no output |

## Scope

**In scope** (exact names may be adjusted only to match an established live
convention):

- `docs/adr/001-steam-desktop-host.md` (create)
- `src/platform/platform-contract.js` (create)
- `src/platform/web-platform.js` (create)
- `src/persistence/save-repository.js` (create)
- `src/input-actions.js` (create; bindings and action names)
- `src/main.js`
- `src/engine.js`
- `src/world.js`
- `src/battle.js`
- `index.html` and versioned imports changed by `release:cache`
- focused Node/Playwright tests under `tests/tooling/` and `tests/e2e/`
- `tests/README.md`
- `AGENTS.md`
- `package.json` only if a focused test script is justified
- `plans/016-steam-ready-platform-boundary.md`
- `plans/README.md`

**Out of scope**:

- Electron/Tauri/NW.js dependencies, installers, signing, notarization, depots,
  SteamPipe, Steam SDK/native modules, App IDs, or store metadata.
- Achievements, leaderboards, DLC, multiplayer, telemetry, workshop support,
  rich presence, or overlay APIs. Add these later from actual product designs;
  do not create speculative generic service managers now.
- Changing save schema version 2 or campaign semantics.
- Moving Canvas, rendering, WebAudio synthesis, RNG, or simulation into a host
  process.
- Replacing native ES modules, introducing a gameplay framework/ECS, or adding
  a production web build step.
- Updating screenshot baselines. This plan should not change pixels.
- Implementing controller polling or Steam Input glyphs. This plan creates the
  action seam they will consume later.

## Git workflow

- Branch: `codex/plan-016-steam-platform-boundary`
- Use logical commits with the repository's imperative style, for example
  `Introduce platform-backed save repository`.
- Do not push or open a PR unless the operator explicitly requests it.

## Steps

### Step 1: Characterize the browser boundary before moving it

Add focused tests that lock down current behavior before refactoring:

1. A fresh boot exposes the menu only after campaign and settings slots are
   hydrated.
2. Real and test campaign slots remain isolated.
3. Explicit save, timed autosave, battle-entry checkpoint, invalid-save cleanup,
   victory cleanup, mute persistence, and pause persistence retain their current
   behavior.
4. A synthetic suspend signal snapshots a world and requests a storage flush
   exactly once without advancing simulation.
5. Current keyboard controls still map to the same gameplay outcomes.

Use `tests/e2e/campaign-persistence.spec.js`, `save-schema.spec.js`, and
`tests/tooling/config-contract.test.js` as structural examples. Do not reach for
wall-clock sleeps.

**Verify**:
`npx playwright test tests/e2e/save-schema.spec.js tests/e2e/campaign-persistence.spec.js`
must pass before production refactoring begins.

### Step 2: Record the desktop-host ADR

Create `docs/adr/001-steam-desktop-host.md` with status `Accepted for future
implementation`. Record:

- Electron is the recommended first host because it preserves the tested
  Chromium renderer and existing ES-module/WebAudio behavior.
- The web target remains first-class and buildless.
- The future Electron main process owns native filesystem and Steamworks calls.
- The renderer runs with `nodeIntegration: false`, `contextIsolation: true`,
  sandboxing enabled where supported, no remote navigation, and a narrow typed
  preload bridge. Never expose raw IPC or Node primitives.
- Desktop campaign/settings files live in a stable per-user data directory,
  use atomic temp-write + replace and a recoverable backup, and are the only
  paths eligible for Steam Cloud configuration.
- The renderer communicates through the platform contract described here.
- Tauri is a documented alternative, not a parallel implementation.

Do not add shell scaffolding or dependencies in this step.

**Verify**: `git diff --check docs/adr/001-steam-desktop-host.md` produces no
output, and the ADR contains decisions for host, security, storage, web parity,
and deferred scope.

### Step 3: Add the asynchronous platform contract and web adapter

Create a frozen platform object with these minimum responsibilities:

```js
{
  kind: 'web',
  storage: {
    read(slot): Promise<string | null>,
    write(slot, raw): Promise<void>,
    remove(slot): Promise<void>,
    flush(): Promise<void>,
  },
  lifecycle: {
    isBackgrounded(): boolean,
    onDeactivate(listener): unsubscribe,
    onSuspend(listener): unsubscribe,
    onResume(listener): unsubscribe,
  },
}
```

Use semantic slots such as `campaign`, `testCampaign`, and `settings`; map them
to the existing localStorage keys only inside `web-platform.js`. The web
adapter may perform the localStorage mutation synchronously internally, but its
public contract remains Promise-based so the future preload/file adapter does
not require synchronous IPC.

Map browser `blur`, `visibilitychange`, and `pagehide` carefully. Deactivation
clears held input; suspend snapshots/flushes storage. Do not double-fire a
suspend callback for the same transition. Keep rAF and DOM ownership in the
renderer; replace the watchdog's direct `document.hidden` decision with
`platform.lifecycle.isBackgrounded()` and let `Input` subscribe to
`onDeactivate` instead of reading browser lifecycle globals itself.

Do not swallow storage errors. Reject operations with an `Error` whose message
names the operation and semantic slot without including save contents.

**Verify**: add a dependency-free Node contract test using a fake backing store.
It must prove semantic slot mapping, read/write/remove behavior, listener
unsubscribe behavior, and surfaced errors. Run `npm run test:tooling`; all
tooling tests must pass.

### Step 4: Introduce an initialized, write-queued SaveRepository

Create `SaveRepository` between `Game` and `platform.storage`:

- `initialize()` reads campaign, test campaign, and settings before `Game` is
  constructed. Boot must wait for it.
- Reads after initialization are synchronous from an in-memory cache so the
  fixed update loop and menu drawing never await I/O.
- Writes/removals update the cache immediately and enter one ordered Promise
  chain. Later writes to the same slot may coalesce only if ordering and the
  battle-entry checkpoint invariant remain provably intact.
- `flush()` resolves only when every queued operation settles.
- Campaign reads pass through `parseSave`; invalid raw data is removed through
  the same queue and returns `null`.
- Campaign serialization remains JSON and schema v2. The repository does not
  repair or reinterpret saves.
- Settings initially contain only mute state, with strict defaulting and no
  campaign-schema coupling.
- A failed write is retained as observable repository state and reported to
  `Game`; the player gets a concise persistent warning such as “Save failed —
  progress may not be stored.” Do not crash, log save contents, or pretend the
  write succeeded.

Use an explicit async `bootstrap()` in `src/main.js`: create the web platform,
initialize the repository, construct `Game({ platform, saves })`, resize, then
expose `window.__g`/`window.game` and start the scheduler. Tests may continue to
wait for `window.__g`; do not expose a half-initialized game.

Replace `Game`'s direct `localStorage` calls and `Sfx` mute persistence with the
repository. Preserve the public meanings of `persistRun()`, `loadRun()`, and
`clearRun()` so World/campaign callers do not learn about storage.

On a platform suspend signal: snapshot the live world once, enqueue persistence,
pause/clear held input as appropriate, and request `flush()`. Browser `pagehide`
cannot guarantee arbitrary asynchronous completion; document that the web
adapter's local mutation is immediate, while the future desktop host must use a
native quit handshake that waits for `flush()` before allowing process exit.

**Verify**:

1. Fake delayed reads prove `window.__g`/Game is not available before hydration.
2. Out-of-order artificial write delays still leave the newest queued save in
   storage.
3. A forced write rejection produces the save-warning state and no runtime
   crash/save-content log.
4. Existing save/campaign suites pass.

### Step 5: Replace raw key-code consumption with named game actions

Define a stable action vocabulary and default bindings in
`src/input-actions.js`. At minimum cover:

- movement: `moveUp`, `moveDown`, `moveLeft`, `moveRight`;
- combat: `attack`, `dash`, `commandFollow`, `commandCharge`, `commandHold`;
- world: `recruitSpear`, `worldPrimary`, `recruitKnight`, `heal`, and
  `expandArmy`. `worldPrimary` preserves the existing context-sensitive `KeyE`:
  it recruits an archer at a settlement and assaults a nearby camp when no
  settlement owns the interaction. Do not map one physical key to two
  simultaneously-fired actions;
- menus/system: `confirm`, `continueRun`, `newHardRun`, `pause`, `mute`, and
  `abandonRun`.

`Input` remains the DOM event owner but exposes `down(action)`,
`pressed(action)`, and `axis()` based on the binding map. Replace raw
`pressed.has('Key...')` / `keys.has('Key...')` checks in `Game`, `World`, and
`Battle` with actions. Preserve mouse attack and the existing
`window.game.key(...)` test API for compatibility; add
`window.game.action(name, down)` for controller-independent tests.

Keep actions separate from UI labels/glyphs. A later Gamepad/Steam Input adapter
will feed actions and provide glyph metadata without changing simulation code.
Do not implement polling, rebinding UI, dead zones, or Steam Input in this plan.

**Verify**:

- Search: `rg -n "pressed\.has\('(Key|Digit|Escape|Enter)|keys\.has\('(Key|Arrow)" src/main.js src/world.js src/battle.js`
  returns no gameplay key-code matches.
- Add deterministic tests proving keyboard and injected action paths produce
  identical canonical state for movement, attack/dash, troop commands, one
  settlement interaction, pause, and mute.
- `npm run test:qa` passes with all legacy record names unchanged.

### Step 6: Document the boundary and future desktop implementation contract

Update `AGENTS.md` and `tests/README.md` with:

- platform object ownership and the prohibition on direct storage/lifecycle
  access outside `src/platform/`;
- SaveRepository initialization, queue, flush, error, and slot-isolation rules;
- action naming/binding rules and where future Gamepad/Steam Input support plugs
  in;
- the unchanged Canvas/WebAudio/simulation boundary;
- the release-cache command after any `src/` edit;
- a desktop follow-up checklist: shell/preload, atomic files/backups, Steam Cloud
  paths, controller/glyph QA, multi-monitor/fullscreen QA, signed builds,
  crash-safe quit, overlay testing, and Steam Deck validation.

Explicitly state that Steamworks APIs belong behind a future desktop adapter
and may consume domain outcomes; they must never be called from World/Battle
simulation phases.

**Verify**: a new contributor reading only `AGENTS.md`, `tests/README.md`, and
the ADR can identify where to add a storage backend and controller input without
editing simulation code.

### Step 7: Refresh release tokens and run the complete regression gate

Run `npm run release:cache` after all source edits. Review that only recognized
module query tokens changed and that new deployable modules are reachable from
the graph. Do not add a bundler to make imports work.

Then run, in order:

```text
npm run test:tooling
npm run test:release
npx playwright test tests/e2e/save-schema.spec.js tests/e2e/campaign-persistence.spec.js
npm run test:qa
npm run test:visual
npm run test:perf
npm test
git diff --check
```

All commands must exit 0. Visual baselines must be unchanged. The full suite
must have no skipped, expected-failure, flaky, or retry-dependent result.

## Test plan

Add tests for all of the following:

- platform contract: semantic slots, async API, lifecycle subscribe/unsubscribe,
  background state, and errors;
- repository: delayed hydration, immediate cache visibility, ordered writes,
  remove ordering, flush, invalid-save cleanup, settings defaults, and failed
  write state;
- lifecycle: suspend snapshots once and requests a flush without simulation
  advancement;
- boot: no partially initialized Game/test API;
- isolation: real/test campaign slots remain separate;
- input: keyboard and injected named actions are behaviorally equivalent;
- regression: campaign/save/QA/performance/visual suites remain green.

Prefer fakes that implement the small platform contract. Do not mock Game,
World, or Battle internals when an existing deterministic browser scenario can
exercise the real boundary.

## Done criteria

- [x] The ADR records Electron as the future default host and its security,
      storage, renderer, web-parity, and alternative decisions.
- [x] `rg -n "localStorage" src` finds matches only in `src/platform/web-platform.js`.
- [x] Direct lifecycle-global reads used for game decisions are confined to the
      web platform adapter; Canvas/WebAudio/DOM event implementation may remain
      renderer-owned as explicitly documented.
- [x] No raw gameplay key-code checks remain in `Game`, `World`, or `Battle`.
- [x] Game is constructed only after repository hydration.
- [x] Campaign and settings writes are ordered, flushable, observable on error,
      and preserve real/test slot isolation.
- [x] Save schema remains version 2 and visual baselines are byte-unchanged.
- [x] No desktop runtime, Steam SDK, production dependency, or web build step is
      added.
- [x] `npm run test:tooling`, `npm run test:release`, focused persistence tests,
      `npm run test:qa`, `npm run test:visual`, `npm run test:perf`, and
      `npm test` all exit 0.
- [x] `git diff --check` has no output and only in-scope files changed.
- [x] Plan 016 and its `plans/README.md` row are `DONE`.

## STOP conditions

Stop and report; do not improvise if:

- Save schema or campaign semantics appear to require a version bump. This plan
  changes storage location/coordination, not persisted game data.
- The platform interface starts exposing Electron, Steamworks, raw IPC,
  filesystem paths, Node objects, DOM objects, or Canvas contexts.
- Async storage requires awaiting inside the fixed simulation update loop.
  Revisit repository hydration/cache/queue design instead.
- Correct quit behavior appears to require synchronous renderer IPC.
- Raw key removal requires combining unrelated actions or changes gameplay
  ordering. Expand the action vocabulary instead.
- Any visual baseline changes, deterministic state diverges, or a performance
  budget must be weakened.
- The executor believes a desktop dependency, bundler, Steam App ID, signing
  credential, or native SDK is necessary. Those belong to a later packaging
  plan and must not be introduced here.
- An in-scope file has drifted in a way that invalidates the current-state
  excerpts or established persistence/phase invariants.

## Maintenance notes

- The future desktop shell should be a new follow-up plan after this boundary is
  stable. It should implement the same platform contract through a preload
  bridge and add shell-specific tests; it should not fork gameplay modules.
- Steam Cloud should sync stable save/settings files, not Chromium's entire
  profile or localStorage database.
- Steam achievements should consume explicit domain outcomes at existing
  battle/victory boundaries. Do not put Steam calls inside deterministic update
  phases or save migrations.
- Controller support should feed the named action layer. Keep bindings,
  displayed glyphs, and device detection outside simulation.
- Reviewers should scrutinize boot ordering, lost-write behavior, suspend
  deduplication, slot isolation, storage-error UX, and accidental raw key/storage
  access more closely than file naming.
