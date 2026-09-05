# Plan 045 — the CI gate costs less

- Status: **IMPLEMENTED**.
- Scope: `playwright.config.js` and the three workflow files. **No `src/` change**, no test
  assertion changed, no budget raised, no baseline re-recorded.
- Trigger: both required checks run one worker over a 4-vCPU runner and trace 270 passing
  tests to throw the traces away.

## 1. What the gate actually spends

Measured from the step timestamps of CI run 33981660810 / 33981660800 (`6b45426`, the last
green pair on `main`):

| check | setup | test step | job |
| --- | --- | --- | --- |
| Browser QA | 28 s (22 s of it Chromium) | **228 s** | 4 m 21 s |
| Balance sweep | 42 s (32 s of it Chromium) | **188 s** | 3 m 54 s |

The two run as separate workflows, so the PR waits `max(...)` = **4 m 21 s**. Setup is 11%
of that. The test step is the whole problem, and `workers: 1` was leaving three of the
runner's four cores idle for all 228 s of it.

## 2. How many workers

Full `chromium` project, four-vCPU box, same shape as `ubuntu-latest`, one run each:

| workers | wall | summed per-test CPU | slowest ordinary test |
| --- | --- | --- | --- |
| 1 | 258 s | 254 s | 16.7 s |
| 2 | **179 s** | 351 s | 18.7 s |
| 3 | 183 s | 504 s | — |
| 4 | 178 s | 665 s | **24.5 s** |

Two workers is the knee and three is not an improvement. Past two the wall clock stops
moving while summed CPU climbs 2.6x: the extra workers buy contention, not throughput. The
right-hand column is why four is worse than useless — the per-test timeout is 30 s, and at
four workers the slowest ordinary test sits 5.5 s under it. `failOnFlakyTests` is on, so
one contended test over the line is a red build.

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

## 3. Tracing 270 passing tests

`trace: 'retain-on-failure'` records a trace for every test and then deletes the ones that
passed. All 270 pass. Measured at two workers: **179 s with it, 151 s without** — 16% of
the gate spent recording evidence of success.

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

| | before | after | |
| --- | --- | --- | --- |
| `chromium` project (local, 4 vCPU) | 258 s | **162 s** | −37% |
| `balance` project (local, 4 vCPU) | 309 s | **188 s** | −39% |

Both projects green, 270 and 4 expected, 0 unexpected, 0 flaky. The balance sweep's third
test still returns in 0.1 s, which is the memoized 48-campaign measurement proving the
file-level worker guarantee survived.

The balance check is now bounded below by a single 185 s test, `deliberate orders beat
giving no order at all`. Nothing in this plan can go further there; 360 raids is a sample
size Plan 044 argued for on statistical grounds and it is not a wall-clock decision.

## 6. Considered and not done

- **Matrix sharding `chromium` across two runners.** It works — roughly 90 s a shard — but
  it doubles runner minutes, needs a required-check aggregation job, and pays the 28 s
  setup twice. Worth revisiting only when the suite grows past ~6 minutes again.
- **Caching `~/.cache/ms-playwright`.** Once the download is the headless shell alone, the
  remaining install cost is mostly the `--with-deps` apt work, which a browser cache does
  not skip. A cache key that goes stale silently is a worse trade than the seconds.
- **Trimming the 44 s deadlock probe out of the PR gate.** It is 18% of the gate and it is
  the whole reason Plan 044 added it — the defect class it catches was invisible to the
  gate before. Left alone.
- **Raising any timeout or budget to accommodate parallelism.** The measurement says two
  workers do not need it. If a worker count ever does, the worker count is wrong.
