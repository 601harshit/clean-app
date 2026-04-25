/**
 * E2E for /food/[barcode]: visits the Nutella detail page.
 *
 * The page is a Server Component, so its fetch happens on the Next.js
 * server (not in the browser) — which means page.route() can't mock it.
 * Instead we spin up a tiny in-process HTTP stub on a free port and point
 * NEXT_PUBLIC_API_URL at it via a worker-scoped fixture; the dev server
 * was launched before tests with the env we set in playwright.config.ts,
 * so we use the default 8000 port and run a stub there.
 *
 * Acceptance criteria covered:
 * - Page renders product header (name, brand, image)
 * - Score ring renders with the score value + label
 * - Breakdown lists factors (sorted by abs impact)
 * - Nutrition table renders rows
 * - Sign-in banner appears for guests
 * - 404 backend response → Next.js 404 page
 */
import { createServer, type Server } from 'http'
import { expect, test as base } from '@playwright/test'

const NUTELLA_FIXTURE = {
  barcode: '3017620422003',
  name: 'Nutella',
  brand: 'Ferrero',
  image_url:
    'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.820.400.jpg',
  nutri_score: 'E',
  nova_group: 4,
  nutrients: {
    energy_kcal: 539,
    fat: 30.9,
    saturated_fat: 10.6,
    carbohydrates: 57.5,
    sugars: 56.3,
    fiber: 0,
    proteins: 6.3,
    sodium: 0.107,
  },
  score: 12,
  score_label: 'Avoid',
  score_breakdown: [
    { factor: 'Nutri-Score E', impact: 20, reason: 'Base score from OFF' },
    { factor: 'NOVA 4 (ultra-processed)', impact: -20, reason: 'Highly processed' },
    { factor: 'High sugar', impact: -15, reason: 'Diabetes penalty' },
    { factor: 'High saturated fat', impact: -15, reason: 'Cholesterol penalty' },
  ],
  alternatives: [],
  body_impact: null,
  personalized: false,
}

/**
 * Stub backend on the same port the dev server expects. The dev server's
 * NEXT_PUBLIC_API_URL defaults to http://localhost:8000 (per lib/api.ts).
 */
const STUB_PORT = 8000

const test = base.extend<{ stubBackend: Server }>({
  stubBackend: [
    async ({}, use) => {
      const server = createServer((req, res) => {
        const url = req.url ?? ''
        if (url.startsWith('/api/food/barcode/0000')) {
          res.writeHead(404).end('not found')
          return
        }
        if (url.startsWith('/api/food/barcode/')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(NUTELLA_FIXTURE))
          return
        }
        res.writeHead(404).end('not stubbed')
      })
      await new Promise<void>((resolve) => server.listen(STUB_PORT, resolve))
      await use(server)
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      )
    },
    { scope: 'worker', auto: true },
  ],
})

// Run serially: the stub backend binds to a fixed port (NEXT_PUBLIC_API_URL
// default 8000), and parallel workers would fight for the bind.
test.describe.configure({ mode: 'serial' })

test.describe('/food/[barcode] detail page', () => {
  test('renders product header, score ring, breakdown, and nutrition', async ({
    page,
  }) => {
    await page.goto('/food/3017620422003')

    // Header
    await expect(page.getByRole('heading', { name: 'Nutella' })).toBeVisible()
    await expect(page.getByText('Ferrero')).toBeVisible()
    await expect(page.getByText('3017620422003')).toBeVisible()

    // Score ring
    const ring = page.getByTestId('score-ring')
    await expect(ring).toBeVisible()
    await expect(ring).toContainText('12')
    await expect(ring).toContainText(/Avoid/i)

    // Sign-in banner (guest flow)
    await expect(page.getByTestId('signin-banner')).toBeVisible()

    // Nutri-Score + NOVA badges
    await expect(page.getByTestId('nutri-card')).toContainText('E')
    await expect(page.getByTestId('nova-card')).toContainText('Ultra-processed')

    // Breakdown is collapsed by default; expand and check sort
    await page.getByRole('button', { name: /score breakdown/i }).click()
    const factors = page.getByTestId('score-factor')
    await expect(factors).toHaveCount(4)
    // Sorted by |impact| desc → first is one of the |20| entries
    await expect(factors.first()).toContainText(/Nutri-Score E|NOVA 4/)

    // Nutrition table renders all rows
    await expect(page.getByTestId('nutrient-sugars')).toContainText('56.3')
    await expect(page.getByTestId('nutrient-saturated_fat')).toContainText(
      '10.6',
    )
    // Sugars row above the threshold should be marked penalty
    await expect(page.getByTestId('nutrient-sugars')).toHaveAttribute(
      'data-penalty',
      'true',
    )
  })

  test('renders 404 when backend returns 404', async ({ page }) => {
    const res = await page.goto('/food/0000000000000')
    expect(res?.status()).toBe(404)
  })
})
