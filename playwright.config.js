import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

export default defineConfig({
  testDir: './tests/e2e',
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
  projects: [
    {
      name: 'chromium',
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
