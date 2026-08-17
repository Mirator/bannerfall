import { defineConfig, devices } from '@playwright/test';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
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
