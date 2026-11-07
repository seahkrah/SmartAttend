/**
 * Browser tests (rubric gate `kiosk`: npx playwright test e2e/kiosk.spec.ts).
 *
 * They need the API, its face worker and a seeded database already running
 * (API_BASE, default http://127.0.0.1:5000) and the e2e fixtures
 * (E2E_FIXTURE_DIR). The web app is started here with Vite, proxying /api to
 * API_BASE, unless one is already listening (locally).
 */
import { defineConfig, devices } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:5000';
const PORT = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_API_PROXY_TARGET: API },
  },
});
