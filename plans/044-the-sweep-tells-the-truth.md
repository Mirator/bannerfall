# Plan 044 — the sweep was measuring the wrong thing

- Status: PROPOSED. Every number below is measured on this tree and reproduced; nothing is
  implemented yet.
- Trigger: `@sweep` `deliberate orders beat giving no order at all` has been red on `main`
  since `2df8896` (PR #34).

The short version: **the obstacle rescue shipped in PR #34 is correct, and the guard it
"broke" was never measuring what it claims.** Across four policies the rescue changed almost
nothing about who actually loses a camp raid; what it changed is how many raids never
finished inside the harness's 95-second window — and the sweep silently scores an unfinished
raid as a loss while never printing how many there were. Commanding beat pressing nothing
because a charging warband ended the fight before the palisade could deadlock it, not because
it won more of them.

Recommended reading order if you only want the conclusion: the table in §3, then §5.

## 1. What is red, and since when

The assertion is `best deliberate policy winPct > idle winPct` over 120 camp raids per
policy (40 seeds x 3 camps, held = 4). On `main`: **idle 82, chargeAll 78, split 76** —
commanding is behind, so it fails. Reproduced locally digit for digit against
[CI run 33974016061]; this harness is deterministic, so none of this is run-to-run noise.

**It was red before the merge.** The Balance sweep ran three times on
`codex/042-audit-p1-p2` and failed each time — runs 47 (`d5ccbed`), 48 (`fd280c6`) and 49
(`0dc6dd8`, a manual re-run). Plan 042's own process section says to "wait for required CI
and the balance sweep, and merge only the reviewed passing revision".

## 2. What moved it

Run 47 recorded its table, so CI attributes this without a bisect:

| revision | position in PR #34 | idle | chargeAll | split | verdict |
| --- | --- | --- | --- | --- | --- |
| `9c5270d` (Plan 041, `main` before) | — | 67.5\* | 75.0\* | 52.5\* | pass |
| `d5ccbed` | after the save/storage/terrain-RNG fixes | 63 | 79 | 58 | **pass**, +16 |
| `fd280c6` | after the obstacle-rescue rework | — | — | — | **fail** |
| `2df8896` (`main` now) | final | 82 | 78 | 76 | fail, −4 |

\* Plan 039's recorded re-base at held = 4.

Every campaign, storage and terrain-RNG fix in PR #34 was already in place at `d5ccbed`,
where the guard passed with the **widest margin in this finding's history**. The only change
between `d5ccbed` and `fd280c6` is the obstacle-rescue rework — `2597eaf` and `fd280c6`,
later bounded by `9f623ae` and `0dc6dd8`. The terrain RNG-ownership change (planks drawn from
`terrainRng` rather than `fxRng`) is not the cause, though it is what moved the plank
geometry that produced the deadlocks the rescue answers.

## 3. What the rescue actually did

Three trees, the same 120 raids per policy, each raid decomposed into a win, a **timeout**
(never reached a terminal state inside the harness's 95s window) and a real loss. The middle
column is `main` with the cluster-detour path disabled at its two entry points and nothing
else changed — an attribution control, not a proposal.

| policy | pre-#34 `9c5270d` | | | `main`, rescue OFF | | | `main` `2df8896` | | |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| | win% | t/o | loss | win% | t/o | loss | win% | t/o | loss |
| idle | 68.3 | **23** | 15 | 63.3 | **25** | 19 | **81.7** | **4** | 18 |
| chargeAll | 75.8 | 3 | 26 | 79.2 | 4 | 21 | 78.3 | 1 | 25 |
| split | 52.5 | 18 | 39 | 58.3 | 18 | 32 | 75.8 | 0 | 29 |
| holdLine | 54.2 | 25 | 30 | 51.7 | 30 | 28 | 70.8 | 7 | 28 |

Read the timeout column first.

**Before PR #34, idle timed out on 23 of 120 raids and chargeAll on 3.** That 20-raid gap is
~17 percentage points of win rate, against a recorded margin of +7.5. The guard's margin
*was* the timeout gap: chargeAll did not win more fights than idle, it finished them (median
20s against idle's 42s) before the palisade could hang them.

The rescue closed that gap — idle 23 → 4, split 18 → 0, holdLine 25 → 7 — and left the real
losses alone: idle 15 → 18, chargeAll 26 → 25, split 39 → 29, holdLine 30 → 28. Raids that
used to hit the cap now finish, and they finish as wins, because a formed line that was never
actually losing wins once the fight is allowed to end.

The control column confirms the attribution from a third direction: turning the rescue off on
`main` reproduces the pre-rework shape (idle 63.3, chargeAll 79.2, split 58.3) and CI's own
`d5ccbed` table (63 / 79 / 58) to the digit.

So the ranking did not invert because commanding got worse. **It inverted because the only
thing commanding was reliably winning on — not being alive long enough to deadlock — stopped
being worth anything.**
## 4. Why the deadlocks were there to be fixed

Two facts from the shipped constants, no measurement needed.

`placeCamp` lays the palisade as 7 circle colliders at `0.3 * 140 = 42px` centres with ±7px
jitter, radius 13, gate at index 3. The cluster path fires on simultaneous contact with more
than one collider, where contact uses the *inflated* radius `o.r + unitRadius +
TANGENT_MARGIN`:

| unit | radius | contact radius | half-spacing | touching two planks? | fits the 16px gap? |
| --- | --- | --- | --- | --- | --- |
| wolf | 8 | 27 | 21 | yes | yes (needs 16) |
| spear / archer / bandit / raider | 10 | 29 | 21 | yes | **no** (needs 20) |
| knight | 12 | 31 | 21 | yes | **no** (needs 24) |
| brute | 18 | 37 | 21 | yes | **no** (needs 36) |

So "in contact with more than one collider" is true for anything standing anywhere along the
palisade — it detects a wall, not a trap. Only the 1.5s stall timer separates the two. And
the wall is impassable except at the gate for everything but a wolf, which fits the 16px gap
exactly. A line of circles whose gaps admit exactly one unit type is a pocket generator; the
jitter decides how bad each camp is.

`steerContactCluster` then expands the envelope on each new contact "without reversing the
committed side or resetting its budget", so a unit sliding along the barrier grows its
enclosing circle along the run — gate included — and commits to going around it for up to
`2π·r/(0.55·speed) + 1.5s`: 20.7s for a bandit and 33.7s for a brute at a full-run envelope
of r ≈ 155. That is the cost the rescue pays to guarantee an exit, and it is why the fights
it rescues are slow rather than lost.

## 5. Can the guard tell anything?

Three defects, independent of the regression.

**It compares two rounded integers with a strict `>`.** The policies share seeds, so the
honest statistic is paired. `scripts/zz-orders-wide.mjs` already computes it (McNemar over
discordant pairs). On `main`:

| policy vs idle | won where idle lost | lost where idle won | margin | SE | sigma |
| --- | --- | --- | --- | --- | --- |
| chargeAll | 19 | 23 | −3.3 | 5.4 | **0.6** |
| split | 19 | 26 | −5.8 | 5.6 | 1.0 |
| holdLine | 15 | 28 | −10.8 | 5.5 | 2.0 |

chargeAll's deficit is 0.6 sigma: the sample cannot resolve it. Nor could it resolve the
margin it was *passing* on — pre-#34 the paired margin was **+7.5 ± 6.0, 1.2 sigma**, and
Plan 040 recorded +3 and called it healthy. The only reading in this whole history that
clears 2 sigma is the attribution control (+15.8 ± 6.2), i.e. the tree with the deadlocks
left in. **This guard has never once measured the property it asserts at a resolvable
confidence.**

**It cannot see its own timeouts.** The shipped `raidSweep` (`stance-balance.spec.js:142`)
returns `runs`, `winPct`, `avgLost`, `avgHeroHp` — and nothing else. `resolved` is computed in
the *other* harness in the same file (`runStance`, line 106) and never in this one. So a
policy can spend a fifth of its sample never reaching a terminal state and the printed table
looks perfectly ordinary. That is exactly what was happening — idle at 19%, holdLine at 21%,
for at least five plans — and it is why the finding survived six attempts to overturn it.

**It has no baseline to diff against.** Every plan in this finding's history reconstructed
the previous table by hand out of prose comments. There is no machine-readable record, so no
run can say what moved.

## 6. Why nobody stopped the merge

Two comments in the tree say, in as many words, that this check cannot fail.

`tests/e2e/stance-balance.spec.js:254-258`, directly above the test:

> `@sweep`: 360 raids … a recorded finding rather than a regression guard — **it cannot go
> red on a code change**, only report a different margin. … The annotation below stays.

`.github/workflows/balance-sweep.yml:3-8`, which is the description a reviewer reads beside
the red X:

> … not a regression guard: **it carries `test.fail()`** … **so it cannot go red on a code
> change** — only report a different margin.

Both are stale: Plan 033 removed the `test.fail()`, and the same spec file says so 100 lines
lower ("the assertion below now GUARDS the property"), as does `CLAUDE.md`. Anyone who read
the header, or the workflow blurb, was told the failure was expected. Two-file fix.

## 7. What to change

### Slice 1 — the instrument (no gameplay risk; do this first and alone)

1. **Delete the two stale claims** and replace them with what is true: the assertion guards a
   property, a red sweep blocks the merge, the number is recorded either way.
2. **Report `unresolved` in the sweep table**, and fail the sweep outright if any policy
   exceeds a small timeout budget. A policy that cannot finish its fights is not a
   measurement, and a metric that silently scores timeouts as losses will keep manufacturing
   margins like the one this plan just took apart.
3. **Assert the paired margin with its SE**, moving the McNemar computation out of
   `scripts/zz-orders-wide.mjs` into the spec. Fail when the best deliberate policy is behind
   by more than 2 SE; print the table and the sigma every run. The guard then says
   "commanding is behind by 3.3 ± 5.4 — not resolvable" instead of flipping on it.
4. **Commit the table as a baseline** (`tests/e2e/__baselines__/orders-sweep.json`) and print
   the per-policy delta. A run then reports *what moved*.
5. **Give the PR gate a cheap proxy**: 8 seeds x 3 camps (24 raids/policy) is roughly 30s and
   resolves an 18-point swing like this one at about 2 sigma. Run it inside `npm test`; leave
   the 120-raid measurement in its own check.

### Slice 2 — re-decide the property on a clean instrument

6. With slice 1 in place, re-measure. On this evidence the honest current reading is
   **commanding and pressing nothing are tied** (−3.3 ± 5.4) — which is where Plan 027 and
   Plan 032 also landed. Plan 033's +11, Plan 039's +7.5 and Plan 040's +3 were all measured
   on a fixture that scored deadlock timeouts as losses and never printed the timeout count,
   so none of them established the property; the deadlock gap was doing the work. The
   `test.fail()` removed on Plan 033's stated terms should probably not have come off.
7. That makes *making orders worth pressing* an open game-design question again, not a test
   fix. Do not restore a bare `test.fail()` either: record the margin with its confidence
   interval, fail on a significant move in either direction, and let the next design slice
   argue against a number that can actually be argued with.

### Slice 3 — the geometry that needed a rescue (cheapest real fix)

8. A wall of jittered circles whose gaps admit exactly one unit type is the pocket generator.
   One capsule/segment collider per palisade run with an explicit gate removes the entire
   class, and Plan 042 measured that "restoring the old physical placement alone removed that
   particular deadlock". Cost this before hardening the rescue around geometry that should
   not exist.
9. If the rescue stays, bound it: do not enclose a gap the unit can pass, cap envelope growth
   instead of letting it swallow a whole barrier, and bound the detour by angle turned rather
   than by a full circumference.

### Slice 4 — the rule that would have caught it

10. `AGENTS.md`: a change to battle navigation, obstacle geometry, or any terrain RNG stream
    invalidates every recorded balance number. Such a PR re-runs the sweep and records the new
    table in the same change, and a red sweep blocks the merge unless the plan states why the
    new number is the correct one.

## 8. Reproducing the tables

`scripts/zz-*.json` is gitignored, so the numbers above live here rather than as artifacts.
To regenerate them:

```text
python scripts/serve.py                                            # or from a worktree, below
node scripts/zz-orders-wide.mjs --seeds 40 --held 4 --label base   # ~4 min, 4 policies
```

- **pre-#34 column**: `git worktree add <dir> 9c5270d`, serve *that* directory on 8474, then
  run the script from the main checkout (it only talks to the served origin).
- **rescue-OFF column**: on `main`, disable the two entry points in
  `src/battle/ai-phases.js` — the `unit._steerCluster && steerContactCluster(...)` guard at
  the top of `steerAroundObstacle`, and the `contactStalled` assignment below it. Revert
  after measuring; this is an attribution control, not a change.
- The win/timeout/loss decomposition is `raw.<policy>[].victory` and `.resolved` in the
  emitted JSON; the shipped spec does not report it (see §5).

## 9. What this plan does not claim

- Not that the obstacle rescue should be reverted. It removed 21 deadlocked raids out of 120
  and its real-loss column is unchanged; it is doing its job.
- Not that the game is unbalanced for a human. The sweep measures a hero who stands still and
  never swings, and 3.3 points at 0.6 sigma is not a statement about play.
- Not that the counter-experiment is shippable. Disabling the rescue restores the deadlocks
  Plan 042 closed; it exists here only to attribute the swing.
