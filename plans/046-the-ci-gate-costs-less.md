# Plan 046 — the CI gate costs less

- Status: **IMPLEMENTED**.
- Scope: `playwright.config.js` and the three workflow files. **No `src/` change**, no test
  assertion changed, no budget raised, no baseline re-recorded.
- Trigger: both required checks ran one worker over a 4-vCPU runner and traced every passing
  test only to delete the trace.

## 1. What the gate actually spends

Step timestamps, not estimates. Two pairs of runs on the SAME code (`main` after Plan 045),
one with the old config and one with this one, on `ubuntu-latest` both times:

| step | before | after |
| --- | --- | --- |
| QA — install Chromium | 22 s | **16 s** |
| QA — test step | 226 s | **163 s** |
| QA — job total | 255 s | **186 s** |
| Sweep — install Chromium | 21 s | **18 s** |
| Sweep — test step | 362 s | **278 s** |
| Sweep — job total | 388 s | **304 s** |

The two are separate workflows, so a PR waits on the larger: **388 s → 304 s, −22%**.

The long pole moved while this plan was being written. Before Plan 045 the sweep ran three
policies in 188 s and Browser QA at 228 s was what a PR waited on; Plan 045 added `holdLine`
as a fourth column and the sweep went to 362 s. Both checks are cut here, but the sweep is
now the one that decides the wait, and §5 says what is left in it.

Setup is 8% of the after-job and was 9% of the before — caching the browser download, the
obvious first instinct, was never where the time was.

## 2. How many workers

`workers: 1` left three of the runner's four cores idle for the whole test step. Full
`chromium` project, four-vCPU box, one run each:

| workers | wall | summed per-test CPU | slowest ordinary test |
| --- | --- | --- | --- |
| 1 | 258 s | 254 s | 16.7 s |
| 2 | **179 s** | 351 s | 18.7 s |
| 3 | 183 s | 504 s | — |
| 4 | 178 s | 665 s | **24.5 s** |

Two workers is the knee and three is not an improvement. Past two the wall clock stops
moving while summed CPU climbs 2.6x: the extra workers buy contention, not throughput. The
right-hand column is why four is worse than useless — the per-test timeout is 30 s, and at
four workers the slowest ordinary test sits 5.5 s under it. `failOnFlakyTests` is on, so one
contended test over the line is a red build.

That table was taken on the tree before Plan 045 (270 tests). Plan 045 landed mid-flight and
made fights end sooner, which moves the absolute numbers — the same box now runs 300 s at one
worker over 271 tests — but not the shape, and the CI A/B in §1 is measured on the current
tree and is the number that matters. The table is left as recorded rather than half-refreshed;
re-derive it whole if the cap is ever argued with.

`fullyParallel` stays **off**, and that is now asserted rather than assumed
(`tests/tooling/config-contract.test.js`). Playwright hands a whole spec file to one
worker, which is the only reason `campaign-arc.spec.js` can memoize one 48-campaign sweep
across its three `@sweep` tests. The comment in that file and in `tests/README.md` used to
credit `workers: 1` for it. That was the wrong invariant named, and it would have made the
change here look unsafe when it is not; both now name `fullyParallel`.

Only a 4-vCPU host was measured. The config derives `workers` from the core count but caps
it at 2, and the cap is deliberate: raising it is a change that needs numbers from a bigger
machine, not an argument. `PW_WORKERS` overrides it for anyone who wants to take those
measurements.

## 3. Tracing every passing test

`trace: 'retain-on-failure'` records a trace for every test and then deletes the ones that
passed — which, on a green run, is all of them. Measured at two workers on the 270-test tree:
**179 s with it, 151 s without** — 16% of the gate spent recording evidence of success.

`on-first-retry` is the trade. A test that genuinely fails is retried once in CI and the
retry is traced, so a real failure still arrives with one. A test that fails and then
passes turns the build red through `failOnFlakyTests` with the error, the stack and a
failure screenshot but no trace; `screenshot: 'only-on-failure'` is added here to keep that
case from being error text alone. Given that this suite has no wall-clock waits and its
assertions carry named messages, that is the cheaper side of the trade — but it IS a trade,
and it is spelled out in the config so a future reversal is a decision.

## 4. Chromium, not Chrome plus Chromium

`npx playwright install chromium` fetches Chrome for Testing **and** the headless shell.
Every run in all three workflows is headless, which means Playwright launches the shell and
the ~150 MB browser is downloaded to sit unused. All three now install
`chromium-headless-shell`.

This does not touch the visual baselines, and that is checked rather than assumed, because
a font package silently dropped from the apt set would move every canvas comparison in the
suite. In `playwright-core`'s registry the `chromium-headless-shell` executable carries
`_dependencyGroup: "chromium"` — the same entry `chromium` carries — and it still pulls
FFmpeg, whose group is `tools`, which is where `fonts-liberation`, `fonts-noto-color-emoji`
and the rest live. `--with-deps` resolves the identical apt package set either way; only
the ~150 MB browser download is skipped. The rendering binary is unchanged too: the shell
is already what `headless: true` has always launched, and it is what rendered every
committed PNG. Should a run ever need a headed browser it fails loudly with "Executable
doesn't exist" rather than drifting to a different raster.

## 5. Result

Real CI, same code, old config against this one: gate latency **388 s → 304 s (−22%)**, with
QA's job at −27% and the sweep's at −22%. Both checks green on the first run; `npm test` 271
expected, `test:balance` 4 expected, 0 unexpected, 0 flaky.

The balance check is now what a PR waits on, and inside it one test — `deliberate orders beat
giving no order at all`, four policies over 120 camp raids each since Plan 045 — is the floor.
Nothing in this plan can go further there: the sample size is a statistical argument from
Plans 044 and 045, not a wall-clock decision. Cutting that wait means either sharding it or
reopening the sample size, and both are somebody's deliberate call rather than a config edit.

## 6. Considered and not done

- **Matrix sharding.** It works, roughly halving whichever project is sharded, but it doubles
  runner minutes, needs a required-check aggregation job, and pays the setup cost per shard.
  It is also aimed at the wrong check now: `chromium` is no longer the long pole, and the
  sweep's cost sits inside a single test that sharding across runners cannot split. Revisit
  by splitting that test's policies across shards, not the file list, and only if 5 minutes
  stops being acceptable.
- **Caching `~/.cache/ms-playwright`.** Once the download is the headless shell alone, the
  remaining install cost is mostly the `--with-deps` apt work, which a browser cache does
  not skip. A cache key that goes stale silently is a worse trade than the seconds.
- **Trimming the 44 s deadlock probe out of the PR gate.** It is 18% of the gate and it is
  the whole reason Plan 044 added it — the defect class it catches was invisible to the
  gate before. Left alone.
- **Raising any timeout or budget to accommodate parallelism.** The measurement says two
  workers do not need it. If a worker count ever does, the worker count is wrong.
