import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

// One worker per ~2 cores, capped at 2, overridable with PW_WORKERS.
//
// The cap is a MEASUREMENT, not a guess (plans/045). On a 4-vCPU box — the shape of
// ubuntu-latest, which is what both CI checks run on — the full chromium project takes
// 258 s at one worker and 179 s at two. Three and four workers take 183 s and 178 s: the
// wall clock stops moving while the summed per-test CPU climbs from 254 s to 665 s, so
// past two workers the machine is only paying for contention. That contention is also a
// flake risk against the 30 s per-test timeout below — the slowest ordinary test measures
// 16.7 s at one worker, 18.7 s at two, and 24.5 s at four. Two is the knee; four is a red
// build waiting to happen. Nothing above 4 vCPU was measured, which is why the cap is not
// simply `cpus / 2` — raise it with numbers, not with reasoning.
const cores = os.availableParallelism?.() ?? os.cpus().length;
const workers = Number(process.env.PW_WORKERS) || Math.max(1, Math.min(2, Math.floor(cores / 2)));

export default defineConfig({
  testDir: './tests/e2e',
  // Scratch specs (screenshot captures, one-off balance sweeps) are named zz-* and must
  // never join the gate: Playwright collects everything under testDir, so gitignoring
  // them alone would still let a stray file make `npm test` unreproducible.
  testIgnore: '**/zz-*.spec.js',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Keep visual baselines shared by every local/CI platform. The visual suite
  // crops to the canvas and uses a documented raster tolerance below.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  workers,
  // LOAD-BEARING, not a default left in place. Parallelism here is per FILE: every test in
  // one spec file runs in one worker, in order. `campaign-arc.spec.js` relies on that — its
  // three @sweep tests share one 48-campaign measurement through a module-level cache, and
  // turning this on would run that measurement three times instead of once. Splitting a
  // file across workers must not be done to chase wall clock; split the FILE instead.
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8474',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    headless: true,
    // `retain-on-failure` traced all 270 tests and then deleted 270 traces, because they
    // all passed. Measured at two workers, that cost 179 s against 151 s with tracing off
    // the first attempt — 16% of the gate spent recording evidence of success. A failing
    // test is retried once in CI and the retry is traced, so a genuine failure still
    // arrives with a trace; a test that fails and then passes turns the build red through
    // `failOnFlakyTests` and leaves the error, the stack and the failure screenshot below
    // rather than a trace. That is the trade this line makes.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // Two projects over the same specs, split by tag. The `@sweep` balance measurement is
  // 360 raids and minutes of wall clock, and it is a recorded finding rather than a
  // regression guard, so it runs as its own check instead of holding up the PR gate.
  // `npm test` selects chromium; `npm run test:balance` selects balance. A bare
  // `npx playwright test` still runs both.
  projects: [
    {
      name: 'chromium',
      grepInvert: /@sweep/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'balance',
      grep: /@sweep/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'python scripts/serve.py',
    url: 'http://127.0.0.1:8474',
    reuseExistingServer: !isCi,
    timeout: 15_000,
  },
});
