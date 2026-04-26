/**
 * E2E for the Healthier Alternatives section on /food/[barcode].
 *
 * Same approach as detail.spec.ts: the page is a Server Component that
 * fetches via the FastAPI backend. We stand up a tiny in-process HTTP
 * stub on the same port the dev server expects (default 8000), and
 * exercise both the "alternatives present" and "alternatives empty"
 * branches.
 *
 * Acceptance criteria covered (docs/features/alternatives.md):
 * - Section shows up to 5 cards
 * - Each card: image, name, brand, score badge, "Order on Amazon"
 * - Card without amazon_url renders without the buy button
 * - Section shows "No healthier alternatives found" message when empty
 */
import { createServer, type Server } from 'http'
import { expect, test as base } from '@playwright/test'

const ALT_BARCODE = '3017620422003'
const EMPTY_BARCODE = '0000000000001'

function makeProduct(barcode: string, alternatives: unknown[]) {
  return {
    barcode,
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
    ],
    alternatives,
    body_impact: null,
    personalized: false,
  }
}

const ALTS_FIVE = [
  {
    barcode: 'A1',
    name: 'Almond Butter',
    brand: "Justin's",
    score: 80,
    image_url: 'https://images.example.com/a1.jpg',
    amazon_url: 'https://www.amazon.com/dp/A1?tag=clean-20',
  },
  {
    barcode: 'A2',
    name: 'Cashew Butter',
    brand: 'Artisana',
    score: 74,
    image_url: 'https://images.example.com/a2.jpg',
    amazon_url: null, // creds-missing path
  },
  {
    barcode: 'A3',
    name: 'Sunflower Spread',
    brand: 'SunButter',
    score: 70,
    image_url: null,
    amazon_url: 'https://www.amazon.com/dp/A3?tag=clean-20',
  },
  {
    barcode: 'A4',
    name: 'Hazelnut Butter',
    brand: null,
    score: 65,
    image_url: 'https://images.example.com/a4.jpg',
    amazon_url: 'https://www.amazon.com/dp/A4?tag=clean-20',
  },
  {
    barcode: 'A5',
    name: 'Pumpkin Seed Butter',
    brand: '88 Acres',
    score: 62,
    image_url: 'https://images.example.com/a5.jpg',
    amazon_url: 'https://www.amazon.com/dp/A5?tag=clean-20',
  },
]

const STUB_PORT = 8000

const test = base.extend<object, { stubBackend: Server }>({
  stubBackend: [
    async ({}, use) => {
      const server = createServer((req, res) => {
        const url = req.url ?? ''
        if (url.startsWith(`/api/food/barcode/${ALT_BARCODE}`)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(makeProduct(ALT_BARCODE, ALTS_FIVE)))
          return
        }
        if (url.startsWith(`/api/food/barcode/${EMPTY_BARCODE}`)) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(makeProduct(EMPTY_BARCODE, [])))
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

// Serial: stub binds to a fixed port, parallel workers would conflict.
test.describe.configure({ mode: 'serial' })

test.describe('/food/[barcode] alternatives section', () => {
  test('renders five alternative cards with correct details', async ({
    page,
  }) => {
    await page.goto(`/food/${ALT_BARCODE}`)

    const section = page.getByTestId('alternatives-section')
    await expect(section).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /healthier alternatives/i }),
    ).toBeVisible()

    const cards = page.getByTestId('alternative-card')
    await expect(cards).toHaveCount(5)

    // First card has Amazon button + correct text + tagged URL.
    const first = cards.first()
    await expect(first.getByTestId('alternative-name')).toHaveText(
      'Almond Butter',
    )
    await expect(first.getByTestId('alternative-brand')).toHaveText("Justin's")
    await expect(first.getByTestId('alternative-score-badge')).toHaveText('80')
    const amazon = first.getByTestId('alternative-amazon-button')
    await expect(amazon).toBeVisible()
    await expect(amazon).toHaveAttribute(
      'href',
      'https://www.amazon.com/dp/A1?tag=clean-20',
    )
    await expect(amazon).toHaveAttribute('target', '_blank')

    // Second card (A2) has no amazon_url → no button rendered.
    const second = cards.nth(1)
    await expect(second.getByTestId('alternative-name')).toHaveText(
      'Cashew Butter',
    )
    await expect(
      second.getByTestId('alternative-amazon-button'),
    ).toHaveCount(0)

    // Card with null brand renders the dash.
    const fourth = cards.nth(3)
    await expect(fourth.getByTestId('alternative-brand')).toHaveText('—')
  })

  test('clicking an alternative name navigates to its detail page', async ({
    page,
  }) => {
    await page.goto(`/food/${ALT_BARCODE}`)
    const firstCard = page.getByTestId('alternative-card').first()
    const link = firstCard.getByTestId('alternative-name')
    await expect(link).toHaveAttribute('href', '/food/A1')
  })

  test('renders empty-state message when no alternatives are returned', async ({
    page,
  }) => {
    await page.goto(`/food/${EMPTY_BARCODE}`)
    await expect(page.getByTestId('alternatives-empty')).toBeVisible()
    await expect(page.getByTestId('alternatives-empty')).toHaveText(
      /no healthier alternatives found/i,
    )
    await expect(page.getByTestId('alternative-card')).toHaveCount(0)
  })
})
