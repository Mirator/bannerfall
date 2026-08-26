# Baseline before enemy command symmetry (plans/027)

Recorded on `origin/main` at `cba5629`, before any `src/` edit, by
`scripts/zz-enemy-command-sweep.mjs`. That script is a scratch Playwright driver, not a
test: it reuses `tests/e2e/stance-balance.spec.js`'s harness conventions verbatim (frozen
scheduler, the real fixed-step update driven directly, canvas pinned to 1280x720, cursor
pinned to the canvas centre, camera shake cleared before every run) and adds the two
numbers that spec does not record — mean fight duration and per-run resolution.

Everything below is with the hero **completely idle**: zero movement, zero attacks. The
only variable is which squad orders were issued once, at the start of the fight.

## Fixture A — the standard roaming-party encounter

8 troops (4 spear / 3 archer / 1 knight) vs a 7-strength party (3 bandit / 2 raider /
2 wolf), road arena, approach `E`, deploy skipped, hero 120/120. **24 battle seeds, 1..24.**

| policy | win % | avg lost | avg seconds | avg hero HP | unresolved @90s |
|---|---|---|---|---|---|
| **idle (no order)** | **95.8** | **0.46** | 37.4 | 105 | 1 |
| chargeAll | 100 | 0.79 | 21.0 | 105 | 0 |
| split (spear charge / bow hold / horse charge) | 100 | 0.42 | 16.9 | 120 | 0 |
| holdLine (spear hold / bow hold / horse charge) | 87.5 | 1.46 | 49.2 | 37 | 0 |

The headline the owner asked about: **an idle hero wins 95.8% of these fights and loses
less than half a man on average.** Orders change the *speed* of a foregone conclusion, not
the conclusion. This reproduces the phase-4 audit's single-seed finding (seed 11: win,
~31 s, 0 lost) across a sweep.

## Fixture B — organic camp raids

The fight the campaign actually serves: real garrison rolls at camps `c1`/`c2`/`c3`, reached
through the production `E` raid input and the pre-battle brief, warband of
4 spear / 3 archer / 2 knight. **40 world seeds (1..40) x 3 camps = 120 raids per policy**,
the same sample the shipped `@sweep` test uses.

| policy | win % | avg lost | avg seconds | avg hero HP | unresolved @95s |
|---|---|---|---|---|---|
| **idle (no order)** | **75.0** | 4.02 | 46.3 | 94 | 7 |
| chargeAll | 65.0 | 5.25 | 41.8 | 82 | 6 |
| split (spear charge / bow hold / horse charge) | 31.7 | 6.34 | 59.3 | 64 | 32 |
| holdLine (spear hold / bow hold / horse charge) | 38.3 | 6.28 | 59.9 | 66 | 30 |

Idle leads the best deliberate policy by **10 points**. This is the finding the repository's
only `test.fail` annotation records, and this independent 120-raid draw lands within a point
or two of the numbers written into `tests/e2e/stance-balance.spec.js` (idle 73%, chargeAll
62%), so the harness and the shipped sweep agree.

## What the numbers say the target is

- Idle must measurably **lose** fights it currently wins. 95.8% on Fixture A and 75.0% on
  Fixture B are the numbers to move.
- A deliberate policy must beat idle on Fixture B, robustly across 120 raids — not on a
  favourable handful of seeds (Plan 019 retracted exactly that kind of claim).
- Mean duration is the feel constraint. 37.4 s (A) and 46.3 s (B) are the numbers that must
  not balloon: a fight the enemy refuses to lose by standing off is not an improvement over
  a fight it refuses to win.
- `holdLine` and `split` already produce 30/120 unresolved raids at baseline. Any design
  that makes the enemy less willing to close risks pushing that count up; the no-death stall
  clock (`STALL_NO_DEATH = 14`) is the guarantee that must keep terminating them.

Raw per-run rows are in `scripts/zz-sweep-before.json`.
