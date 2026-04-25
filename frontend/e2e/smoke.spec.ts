import { expect, test } from '@playwright/test'

/**
 * Smoke test that proves the Playwright config + dev server boot work.
 *
 * Replaced by real E2E flows in feature PRs (auth, search, detail, etc.).
 */
test('home page loads and shows the Clean. brand', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Clean/i)
  await expect(page.getByRole('heading', { name: /Clean\./i })).toBeVisible()
})
