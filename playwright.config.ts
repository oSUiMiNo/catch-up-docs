import { defineConfig, devices } from '@playwright/test';

const BASE_PATH = process.env.BASE_PATH ?? '/catch-up-docs/';
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://localhost:${String(PORT)}${BASE_PATH}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 文書起因の外部通信が無いことを検証するため、既定では余計な通信を持ち込まない。
    serviceWorkers: 'allow',
  },

  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
    },
  ],

  // Service Worker と PWA の検証には production build が要るため preview を使う。
  webServer: {
    command: `npm run preview -- --port ${String(PORT)} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
