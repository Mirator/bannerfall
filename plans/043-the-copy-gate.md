# Plan 043 — the copy gate

Closes the holes the 2026-09-05 UI audit measured in the visual gate
(`critiques/ui-ux-audit-2026-09-05.md`, the section "The safety net has a hole worth
knowing about"). Tests only; no production source changes.

## What was wrong

`tests/e2e/visual-regression.spec.js` compares whole canvases at `threshold: 0.20`,
`maxDiffPixelRatio: 0.015` — 13,824 pixels at 1280x720. Three consequences, all measured on
this tree rather than reasoned about:

1. **A HUD chip is smaller than the cap.** The campaign's objective chip is about 300x50 =
   15,000 pixels. Its entire text can change and the suite still passes. It did: reproducing
   `world-overview.png`'s own fixture (seed 20260817, 0.5s, DPR 1) renders
   `Weaken it (0/4)` / `Capture or raze 2 more`, while the committed baseline reads
   `Weaken it (0/7)` / `Capture settlements · raze camps`. `npm run test:visual` passed
   24/24 the whole time. `world-power-weakened.png` and `world-site-town.png` carry retired
   copy too.
2. **The cap cannot simply be tightened.** Re-run at `maxDiffPixelRatio: 0` the same suite
   reports 197–304 differing pixels on the text-light battle terrain frames and 2,700–6,300
   on the text-heavy panels, with no content change involved — that is Chromium build skew
   against antialiased glyphs. The ratio has to stay well above the size of a HUD chip, so
   pixels are structurally the wrong instrument for words.
3. **Two screens had no baseline at all.** The pause overlay is drawn by `main.js` outside
   every scene's draw path, so no scene baseline reaches it. And `victory-summary.png` is
   captured at `steps: 1.5` while the terminal CONTINUE/MAIN MENU rows only draw past
   `victoryT > 1.5` — the campaign's last choice was outside every PNG in the repository.

## What this adds

### `tests/e2e/hud-copy.spec.js` — 17 tests

`fillText` is wrapped on `CanvasRenderingContext2D.prototype` through `addInitScript`, so it
is in place before `src/main.js` builds its context and it records every string reaching any
canvas — including the offscreen ones the HUD bakes into — in draw order. The frame is then
produced through the same discipline the visual suite uses: seeded scenario, explicit fixed
steps, live scheduler replaced with a no-op, one measured `draw()`. The recording buffer is
cleared immediately before that draw, so scenario setup never leaks in.

Each test asserts the complete ordered list for one screen, so the expectation is the review
surface: a copy edit shows up in the diff as the old and new sentence side by side. Covered:
the campaign HUD chips, the pause overlay (plain and armed), the town and camp site menus,
the camp assault brief, both aftermaths, the specialization and perk choices, the battle HUD,
the hold and break objective panels, the armed victory screen, the title menu, and the
WEAKENED and EXPOSED stronghold chips.

Verified as a gate rather than assumed: changing `Q — save and quit to menu` to
`Q — save and exit to menu` in `src/main.js` fails the pause test with both strings printed;
the same mutation leaves the visual suite green.

Two of these screens — the armed abandon row and the armed victory choice — are copy a PNG
can never hold or never held: the abandon line prints a countdown to one decimal, and the
victory rows arm one tick after the existing baseline is captured.

### Two new baselines

- `victory-summary-armed.png` — `victory_summary` at `steps: 3`, so the terminal choice is
  drawn. **This baseline pins a screen that is wrong**: finding 1 of the audit is that those
  rows are drawn at `H*0.885` on top of the banner poles drawn from `H*0.80`, and the
  selected row's alpha pulse lets a pole show through the primary action. Recording it is
  not endorsing it — moving the rows is a deliberate visual change that re-records this PNG.
- `world-paused.png` — the pause overlay over a seeded world. `settle()` grew a `paused`
  option for it; the frozen-update harness is what makes capturing a pause safe.

## What this deliberately does NOT do

It does not re-record the stale baselines. `--update-snapshots` only rewrites snapshots that
fail, and these pass, so refreshing them needs `--update-snapshots=all`, which `AGENTS.md`
forbids. The sanctioned path is the `Visual baselines` workflow: dispatch it, review the
artifact PNG by PNG, and commit only the intentionally changed ones. That review is real work
— the drift measurement above cannot separate copy drift from raster skew per file, so a
human has to look at each — and it is a separate change from building the instrument that
stops the drift going unnoticed again.

Until that happens the affected PNGs still do their job for layout; they are simply no longer
the only thing guarding the words, and the words are now guarded exactly.

## Contract for whoever changes player-facing copy next

Edit the string and its expectation in the same commit. That is the whole protocol. If a
screen gains or loses a line, the list gains or loses an entry and the diff says so.
