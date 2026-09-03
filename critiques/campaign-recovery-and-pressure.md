# A beaten warband, and a hold that rides out (Plan 039)

Measured 2026-09-02 against `9375040` (Plan 038 merged). Companion to
`critiques/campaign-arc-comparison.md`, which this file's before-column reproduces.

Commands, reproducible verbatim:

```bash
python scripts/serve.py &
node scripts/zz-campaign-probe.mjs --seeds 12 --workers 3 --label p39final
node scripts/zz-orders-wide.mjs --seeds 40 --held 0 --label stage0   # and --held 2, 4
```

Raw records in `scripts/zz-campaign-p39final.json` and `scripts/zz-orders-stage{0,2,4}.json`.
The before column is `scripts/zz-campaign-final.json`, Plan 038's shipped state.

## Slice A — a beaten warband can come back

| policy | campaigns won | battle win % | storm ratio | weight at the hold | losses | floorFires |
| --- | --- | --- | --- | --- | --- | --- |
| `claimRush` | 0 -> 0 | 0 -> 0 | 1.36 -> 1.36 | 6.6 -> 6.6 | 12 -> 12 | 0.0 -> 0.1 |
| `campRaider` | 4 -> 4 | 73 -> **75** | 1.27 -> **0.98** | 12.9 -> **14.4** | 15 -> 15 | 0.2 -> 0.2 |
| `captureThenRaze` | 4 -> 3 | 60 -> 55 | 1.67 -> 1.73 | 8.7 -> 9.0 | 20 -> 19 | 0.5 -> 0.9 |
| `farmer` | 1 -> 0 | 37 -> **60** | 2.28 -> **1.42** | 4.3 -> **7.6** | **68 -> 43** | 1.3 -> 2.5 |

Two rules did this, and `BALANCE.distress` holds both: a defeat musters the column back to
the starting four instead of two, and while the warband is at or below its own starting
weight the floor guarantees a fight inside `distress.partyRatio` (0.90) rather than the
`beatablePartyRatio` 1.30 that `data.js` records as a **27.9%** win.

**Seed 12 is the demonstration**, and it is worth reading as a sequence. Before, after its
first loss: raid 1.89 L, raid 2.35 L, raid 1.19 L, storm 3.48 L, ending at fighting weight
**2.5**. After: raid 1.05 L, party 0.90 W, party 0.63 W, raid 1.33 L, raid 0.79 W, storm
0.92, ending at **12.6**. The campaign that could only lose can now climb.

`farmer` gains most because it loses most: 68 losses to 43, and its battle win rate 37% ->
60%. `captureThenRaze` is the one row that moved the wrong way (4 campaigns won to 3, 60%
to 55%); at twelve seeds that is one campaign and inside the noise this sample can resolve,
and its losses fell 20 -> 19, so nothing about it suggests relief hurt it.

**Plan 038's acceptance criterion 3 went from 9/12 to 11/12.** Only seed 1 still fails, and
not as a death spiral: `campRaider` reaches the hold there at weight 6.6 having razed two
camps — a warband that recovered, just not far enough to beat `claimRush`'s fixed stage-1
storm on that map. The `test.fail()` annotation stays and says so.

### The policy that was written, measured, and deleted

A fifth harness policy, `rebuilder` — `campRaider`'s route plus "while `inDistress()`,
rebuild instead of marching on" — was added to measure whether recovery is reachable by a
player who tries. Over 12 seeds it took **zero recovery fights** and produced records
indistinguishable from `campRaider` (byte-identical on 7 seeds; one second of campaign time
apart on the rest). The reason is the result: after the muster, the ordinary shopping stop
every policy already makes lifts a warband out of distress before the next objective.
Recovery does not need a special player, so the policy was removed rather than shipped as a
duplicate that doubles the sweep's cost for no signal.

## Slice B — the hold rides at the March

Two defects, either of which alone made the whole regional layer dead code. Both are fixed
and both now have their own regression test in `regional-campaign.spec.js`.

1. **`updateRegionalPressure` only ever targeted player-HELD settlements.** A player who
   claimed nothing was exempt, and two of the four harness policies claim nothing by
   construction. Held ground is still targeted first — punishing expansion is the point —
   but with none, the hold seizes neutral ground instead, reusing the break-off floor rule
   verbatim so it can never take the last unclaimed settlement.
2. **`raidCdT` was armed in the World constructor**, and a World is rebuilt on every return
   from a battle — so the 110-second first delay restarted after every fight. A player who
   fought at all was never raided either. The clock now rides across the battle on
   `game.pendingRaidCdT`, the Game-level handoff `pendingAftermath` and `pendingSpecChoice`
   already use, so it costs no save field. A genuine RELOAD still re-arms, which is the
   conservative-defaults behaviour the constructor comment asks for; both directions are
   pinned by the new test. It is stashed AFTER `onWinExtra` runs, not at battle entry —
   a capture writes `raidCdT` to grant its grace, and an entry-time snapshot threw that away.

Driven directly, with no claims and no battles, the hold dispatches at t=110, seizes
Coldwell, and by t=400 holds three settlements with one left unclaimed.

**Acceptance criterion 3 of this plan — `raidsLanded` > 0 across the campaign sweep — is
NOT met, and the reason is the harness rather than the game.** A whole scripted campaign is
**17 to 20 seconds of world time**: the world clock only runs while the hero rides, and the
harness pays only straight-line distance between objectives. `RAID.firstDelayT` is 110 of
those seconds, so the cadence cannot fire inside a measured run however the target filter
behaves — and a raid then needs another 7-17 seconds to travel to its target.

The constants were deliberately NOT re-scaled to fit that, and this is the judgement call
worth recording: the harness under-counts real riding by an unknown factor (a real player
wanders, backtracks, repositions, and rides around rivers rather than teleporting), so
tuning a campaign-length constant against it would be fitting to a known-biased instrument.
What the measurement supports is the claim that the cadence is calibrated in a unit whose
whole-campaign budget is far smaller than the constants assume. Re-scaling it needs a travel
model that reflects real riding, which is a harness change, not a balance change.

## Slice C — the saturated sweep fixture

`raidSweep` installs the near-capped roster the stage curve calls stage 7 into a **stage-0**
save, which after Plan 038 is by construction the easiest fight the game can produce. It
had saturated. Measured over the same 40 seeds x 3 camps at three candidate stages:

| held settlements | idle | chargeAll | split | holdLine | margin |
| --- | --- | --- | --- | --- | --- |
| 0 (before) | 94.2 ± 2.1 | **100.0 ± 0** | 91.7 ± 2.5 | 94.2 ± 2.1 | +5.8, at the ceiling |
| 2 | 86.7 ± 3.1 | 92.5 ± 2.4 | 73.3 ± 4.0 | 80.0 ± 3.7 | +5.8 |
| **4 (chosen)** | 67.5 ± 4.3 | **75.0 ± 4.0** | 52.5 ± 4.6 | 61.7 ± 4.4 | **+7.5** |

Four is the highest stage the fixture can reach — the camps must stay un-razed, since they
are what it raids — it puts all four policies in a measurable band with nothing pinned at 0
or 100, and the guard's margin widens rather than narrows. The stage was chosen on headroom;
the assertion is untouched, and the whole grid is recorded here whichever way it fell.

## Recorded, not asserted

* `partyCap()` now bounds what LIVE CAMPS field, not every party on the map
  (`World.campParties()`). It had to: a stronghold dispatch would otherwise have suppressed
  a camp spawn forever, and after three razes the cap is 0, which would have made "the hold
  may ride out" and "the cap bounds every party" contradict each other. The QA record that
  guards the spawn timer now counts what its name says and additionally asserts that only
  one raid rides at a time and that a seizure never takes the last settlement.
* The distress predicate reads a WEIGHT, not a losing streak, so it needs no persisted
  field and no migration. A fresh campaign counts as distressed, which is correct: the
  floor only ever fires when nothing beatable is on the map, and a starting warband
  deserves the same winnable fight a beaten one does.
