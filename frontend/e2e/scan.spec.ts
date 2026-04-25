/**
 * E2E for the barcode scan flow.
 *
 * The scanner needs a real camera + a printed barcode in front of it to
 * decode anything, neither of which CI has. The test is therefore
 * documented but skipped when CI=true.
 *
 * Locally (with a webcam): `npx playwright test e2e/scan.spec.ts`. You
 * will be prompted for camera permission; grant it and hold a barcode
 * up to the lens. The page should navigate to /food/<barcode>.
 */
import { expect, test } from '@playwright/test'

test.describe('barcode scan', () => {
  test.skip(!!process.env.CI, 'needs a real camera + printed barcode')

  test('home page exposes a Scan barcode link that opens /scan', async ({
    page,
  }) => {
    await page.route('**/api/food/categories', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ categories: [] }),
      })
    })
    await page.goto('/')
    const scanLink = page.getByRole('link', { name: /scan barcode/i })
    await expect(scanLink).toBeVisible()
    await scanLink.click()
    await expect(page).toHaveURL(/\/scan$/)
    await expect(
      page.getByRole('heading', { name: /scan a barcode/i }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: /start scanning/i }),
    ).toBeVisible()
  })

  test('starting the scanner shows a video preview', async ({
    page,
    context,
  }) => {
    // Grant camera in case the browser supports it; the scanner button
    // will surface a clear error if no device is attached.
    await context.grantPermissions(['camera'])
    await page.goto('/scan')
    await page.getByRole('button', { name: /start scanning/i }).click()
    // We don't actually decode in CI; locally the user must hold a
    // barcode to the lens. We assert the preview button flips state.
    await expect(
      page.getByRole('button', { name: /stop scanning/i }),
    ).toBeVisible({ timeout: 10_000 })
  })
})
