import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.PORT ?? '3000'
const baseURL = `http://localhost:${PORT}`

// Auth E2E talks to a real local Supabase. CI runs without one, so it sets
// PLAYWRIGHT_SKIP_AUTH=1 to skip those specs (smoke + detail still run).
const testIgnore = process.env.PLAYWRIGHT_SKIP_AUTH ? ['**/auth.spec.ts'] : []

export default defineConfig({
  testDir: './e2e',
  testIgnore,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
