/**
 * E2E for the search/browse/filter flow.
 *
 * The backend (T1.3) isn't merged yet, so we mock the FastAPI endpoints
 * via page.route() — keeps this E2E independent of backend implementation
 * and runnable on a frontend-only dev server.
 */
import { expect, test, type Page, type Route } from '@playwright/test'

const API_BASE = 'http://localhost:8000'

type Product = {
  barcode: string
  name: string
  brand: string | null
  image_url: string | null
  nutri_score: string | null
  nova_group: number | null
  score: number
}

function makeProduct(i: number, overrides: Partial<Product> = {}): Product {
  return {
    barcode: `barcode-${i}`,
    name: `Product ${i}`,
    brand: `Brand ${i}`,
    image_url: null,
    nutri_score: 'B',
    nova_group: 2,
    score: 70 + i,
    ...overrides,
  }
}

async function mockSearchAPI(
  page: Page,
  handler: (params: URLSearchParams) => {
    products: Product[]
    total: number
    page: number
  },
) {
  await page.route(`${API_BASE}/api/food/search**`, async (route: Route) => {
    const url = new URL(route.request().url())
    const body = handler(url.searchParams)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}

async function mockCategoriesAPI(page: Page) {
  await page.route(`${API_BASE}/api/food/categories`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: [
          { slug: 'snacks', label: 'Snacks', icon: '🍿' },
          { slug: 'dairy', label: 'Dairy', icon: '🥛' },
        ],
      }),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await mockCategoriesAPI(page)
})

test('home page shows SearchBar and CategoryGrid', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Clean\./i })).toBeVisible()
  await expect(page.getByRole('search')).toBeVisible()
  // CategoryGrid links
  await expect(page.getByRole('link', { name: /snacks/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /dairy/i })).toBeVisible()
})

test('submitting a query from home navigates to /search?q=...', async ({
  page,
}) => {
  await mockSearchAPI(page, () => ({
    products: [makeProduct(1, { name: 'Nutella', brand: 'Ferrero' })],
    total: 1,
    page: 1,
  }))
  await page.goto('/')
  await page.getByRole('searchbox').fill('nutella')
  await page.getByRole('searchbox').press('Enter')
  await expect(page).toHaveURL(/\/search\?q=nutella/)
  await expect(
    page.getByRole('heading', { level: 3, name: 'Nutella' }),
  ).toBeVisible()
  await expect(page.getByText('1 products')).toBeVisible()
})

test('clicking a category from home goes to /search?category=...', async ({
  page,
}) => {
  await mockSearchAPI(page, () => ({
    products: [makeProduct(1)],
    total: 1,
    page: 1,
  }))
  await page.goto('/')
  await page.getByRole('link', { name: /snacks/i }).first().click()
  await expect(page).toHaveURL(/\/search\?category=snacks/)
  await expect(page.getByText('Product 1')).toBeVisible()
})

test('shows "No results" empty state', async ({ page }) => {
  await mockSearchAPI(page, () => ({ products: [], total: 0, page: 1 }))
  await page.goto('/search?q=zzz')
  await expect(page.getByText(/no results found/i)).toBeVisible()
})

test('toggling a filter checkbox updates URL and re-fetches', async ({
  page,
}) => {
  let lastSafeFor: string[] = []
  await mockSearchAPI(page, (params) => {
    lastSafeFor = params.getAll('safe_for')
    return {
      products: [makeProduct(1)],
      total: 1,
      page: 1,
    }
  })
  await page.goto('/search?q=p')
  await expect(page.getByText('Product 1')).toBeVisible()
  // Click the desktop sidebar checkbox (force in case viewport is small)
  await page
    .getByTestId('filter-panel-sidebar')
    .getByRole('checkbox', { name: /safe for diabetes/i })
    .click()
  await expect(page).toHaveURL(/safe_for=diabetes/)
  await expect.poll(() => lastSafeFor).toEqual(['diabetes'])
  // Filter chip is now visible
  await expect(page.getByTestId('chip-safe_for-diabetes')).toBeVisible()
})

test('removing a filter chip clears that filter', async ({ page }) => {
  await mockSearchAPI(page, () => ({
    products: [makeProduct(1)],
    total: 1,
    page: 1,
  }))
  await page.goto('/search?q=p&safe_for=diabetes&safe_for=hypertension')
  await expect(page.getByTestId('chip-safe_for-diabetes')).toBeVisible()
  await page.getByRole('button', { name: /remove safe for diabetes/i }).click()
  await expect(page).not.toHaveURL(/safe_for=diabetes/)
  await expect(page).toHaveURL(/safe_for=hypertension/)
  await expect(page.getByTestId('chip-safe_for-diabetes')).toHaveCount(0)
})

test('"Clear all" preserves only the q param', async ({ page }) => {
  await mockSearchAPI(page, () => ({
    products: [makeProduct(1)],
    total: 1,
    page: 1,
  }))
  await page.goto('/search?q=p&safe_for=diabetes&min_score=60&nutri_score=A')
  await expect(page.getByRole('button', { name: /clear all/i })).toBeVisible()
  await page.getByRole('button', { name: /clear all/i }).click()
  await expect(page).toHaveURL(/\/search\?q=p$/)
})

test('"Load more" pushes ?page=2 and shows the next page', async ({
  page,
}) => {
  let requestedPage = 1
  await mockSearchAPI(page, (params) => {
    const p = Number(params.get('page') ?? '1')
    requestedPage = p
    return {
      products: [makeProduct(p), makeProduct(p + 100)],
      total: 50,
      page: p,
    }
  })
  await page.goto('/search?q=p')
  await expect(page.getByText('Product 1', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /load more/i }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect.poll(() => requestedPage).toBe(2)
  await expect(page.getByText('Product 2', { exact: true })).toBeVisible()
})

test('mobile viewport renders the Filters drawer trigger instead of the sidebar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 700 })
  await mockSearchAPI(page, () => ({
    products: [makeProduct(1)],
    total: 1,
    page: 1,
  }))
  await page.goto('/search?q=p')
  await expect(page.getByText('Product 1')).toBeVisible()
  await expect(page.getByRole('button', { name: /filters/i })).toBeVisible()
  // Sidebar is in the DOM (hidden md:block) but not visible at this viewport
  await expect(page.getByTestId('filter-panel-sidebar')).not.toBeVisible()
})

test('shows error banner when the backend fails', async ({ page }) => {
  await page.route(`${API_BASE}/api/food/search**`, async (route) => {
    await route.fulfill({ status: 500, body: 'oops' })
  })
  await page.goto('/search?q=p')
  // Next.js injects its own role=alert route announcer; scope to ours
  await expect(page.getByText(/something went wrong/i)).toBeVisible()
})
