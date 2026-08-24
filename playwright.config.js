import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

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
  workers: 1,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  failOnFlakyTests: isCi,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8474',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    headless: true,
    trace: 'retain-on-failure',
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
