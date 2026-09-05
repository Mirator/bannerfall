# Plan 047 — the sweep uses the whole machine

- Status: **IMPLEMENTED**.
- Scope: the three balance measurements, `playwright.config.js`, `scripts/serve.py`. **No
  `src/` change**, no assertion changed, no sample size reduced, no baseline re-recorded.
- Trigger: Plan 046 left the Balance sweep as the check a PR waits on, and named its cost
  as a single test that "nothing in this plan can go further" on. That was true of the
  config; it was not true of the test.

## 1. Where the sweep's time actually went

Not scheduling. Measured inside the browser, over twelve production-path camp raids:

| | |
| --- | --- |
| per-raid setup (world build, site menu, brief, deploy confirm) | 36 ms |
| per-raid fight | 680 ms |
| per battle tick | 0.229 ms |
| ticks in an average raid | 2,975 (50.7 simulated seconds) |

So the `@sweep` fixture's 480 raids are ~330 core-seconds of battle simulation, and setup
is 5% of it. There is no fat to trim: the cost IS the measurement, and the only ways to
make it smaller are fewer raids (which `AGENTS.md` forbids and Plans 044/045 argued
against on statistical grounds) or a faster battle tick (a gameplay change, with a
re-record of every balance number behind it).

What there was instead is a machine sitting idle. All 480 raids ran as one long
synchronous `page.evaluate` — one renderer process, one core, on a four-core runner.

## 2. Four policies, four cores

The policies share nothing. Each seeds its own world through `scenario()` and steps it
with an explicit dt; the same seeds and the same camps go into each; only the order set
differs. They were awaited one after another purely because that is how a `for` loop
reads.

`tests/e2e/parallel-measure.js` gives each policy its own browser context — a separate
renderer process, and separate storage, so the `bf_save_test` slot one job writes cannot
be seen by another. Three measurements use it: the `@sweep` policy table (4 policies), the
PR gate's deadlock probe (3), and `campaign-arc`'s 48-campaign sweep (4).

**This must not change a measured number, so that was checked rather than assumed.** Over
4 policies x 6 seeds x 3 camps the serial and parallel row sets are byte-identical, at
45.6 s against 17.3 s. At full size the parallel sweep reproduces
`__baselines__/orders-sweep.json` digit for digit — idle 84, chargeAll 78, split 76,
holdLine 77, every `unresolved` 0, and the paired margin at −5.8 ± 5.3.

| test | before | after |
| --- | --- | --- |
| `deliberate orders beat giving no order at all` (480 raids) | 185 s | **95 s** |
| `campaign-arc` 48-campaign sweep | 110 s | **53 s** |
| `no order policy deadlocks its way through a camp raid` (gate) | 44 s | **26 s** |

The memoized cache that shares one 48-campaign measurement across three `@sweep` tests is
untouched and still works: the third test returns in 0.0 s.

## 3. What did not work, and is therefore not shipped

`fullyParallel: true` on the `chromium` project. Every spec in that project was audited
for mutable module-level state and exactly one file has any (`campaign-arc.spec.js`,
whose cached tests are in the *other* project), so it was safe. It was also useless:
**171 s and 173 s with it on, against 167 s and 169 s off** — consistently a few seconds
worse. The reason is worth writing down because it bounds the next attempt too: that
project is not hostage to its longest file, it is bound by total CPU. Test-level
parallelism only reshuffles which core does what.

`fullyParallel` therefore stays `false` everywhere, and the contract test now asserts that
no project overrides it — so the next person who has this idea finds the measurement
instead of repeating it.

## 4. Why Browser QA did not move

It cannot, on this runner, without cutting coverage. At two workers the project reports
323 s of summed test time against a 165 s wall — that is 1.96 cores of a "4-vCPU" box, and
four workers buy nothing (Plan 046 measured 178 s; this plan measured 153 s at four with
the slowest ordinary test at 24.5 s against a 30 s timeout, which is a red build waiting
to happen). Four vCPUs behaving like two under this load is what ~2x scaling means.

So Browser QA is at its floor: ~300 core-seconds of work over ~2 real cores. Its cost is
battle simulation in a handful of tests — the deadlock probe, the two legacy-record tests
— and every one of them is coverage somebody argued for.

One duplication was found and deliberately kept: `qa.spec.js` runs the whole 28-record
`tests/runner.html` suite TWICE, once per test, which is ~16 s. Collapsing the two would
halve it, and it would also drop a real precondition — the first runs the suite with
empty storage, the second with a real `bf_save` present, and "does the QA suite trample a
player's save" is the entire point of the second. Cheaper is not better here.

## 5. Result

Measured on one machine, back to back, against `main` at `9852923`:

| check | before | after | |
| --- | --- | --- | --- |
| Balance sweep | 274 s | **153 s** | **−44%** |
| Browser QA | 166 s | 163 s | −2% |

The two run as separate workflows, so a PR waits on the larger: **274 s → 163 s, −41%**,
and the check it waits on is Browser QA again rather than the sweep. The two are now
within ten seconds of each other, which is the useful end state — there is no longer one
check to attack.

**On CI the gain is smaller, and CI is what a reviewer waits on.** Plan 046 established
that this fleet spreads ±20% on Browser QA, so these are reported against the clusters
rather than as a pair — and the sweep's clusters have been tight all along:

| step | Plan 045 config | Plan 046 config | this plan |
| --- | --- | --- | --- |
| Balance sweep | 362 s, 355 s | 282 s, 279 s, 278 s | **202 s** |
| Browser QA | — | 168 s, 167 s, 163 s | **145 s** |

−28% on the sweep against a three-run cluster it sits clearly below, and −13% on QA. That
QA number is one sample and its own cluster is a noisy instrument, but it is the number
the mechanism predicts: the deadlock probe is the only thing in that project this plan
touches, it went 44 s to 26 s, and 165 − 18 = 147. Job totals 304 s → 227 s.

The gap between −44% locally and −28% on CI is the runner: four vCPUs that behave like two
physical cores return less from four contexts than a box that gives four. The change is
worth the same either way; the ceiling is not.

`scripts/serve.py` also stops printing `BrokenPipeError` tracebacks. Several contexts now
tear down their connections at the end of every measurement, and the default handler
prints a stack for each one; CI logs filled with what look like failures and are not.

## 6. Considered and not done

- **Cutting the sweep's sample size.** 120 raids per policy is Plan 044's answer to a
  fixture that flipped on sampling noise at 15. Wall clock is not a reason to reopen it.
- **Making the battle tick faster.** 0.229 ms/tick is where all of this money goes, and a
  gameplay change to chase it would re-record every balance number in the repository. If
  anyone wants the sweep under a minute, this is the only remaining lever, and it is a
  gameplay decision rather than a CI one.
- **Sharding the sweep across two runners.** Halves it again at double the runner minutes,
  and the paired McNemar margin needs `idle`'s rows beside every other policy, so a shard
  that does not carry `idle` cannot print it. Now that the two checks are balanced, this
  would just move the wait to Browser QA anyway.
- **Collapsing the duplicated legacy-suite run** — see §4.
